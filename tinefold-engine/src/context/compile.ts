import { EngineError } from "../schema/errors";
import type { ExpansionInputs } from "../schema/common";
import { ROOT_NODE_ID, type Graph } from "../schema/graph";
import { currentChildren, currentRoot, currentVersionIdOf, kindOf, titleOf } from "../select/lookup";
import { currentInputs } from "../select/stale";
import { activeSubtree, enabledOrder } from "../select/traversal";
import { ancestorChain, completeness, decisionSummary } from "../select/views";
import { canonicalJson } from "./canonical";
import { hashContext, sha256Hex } from "./hash";
import { taskFor, type ContextTask } from "../prompts";

export interface ContextSections {
  root: string;
  comments: string;
  decisions: string;
  answers: string;
  node: string;
  task: string;
}

export interface CompiledContext {
  /** The exact user-prompt text sent to the provider. */
  text: string;
  sections: ContextSections;
  /** Hash over ids (not text): what staleness compares against. */
  hash: string;
  inputs: ExpansionInputs;
  /** The version whose context this is: the parent being expanded / regenerated under. */
  versionId: string;
  tokens: number;
}

export const DEFAULT_SOFT_CEILING = 24_000;
export const DEFAULT_HARD_CEILING = 48_000;

/** Provider-agnostic estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function renderSections(s: ContextSections): string {
  return [
    `## Root problem\n${s.root}`,
    `## Comments (global amendments, later ones win)\n${s.comments}`,
    `## Decisions so far\n${s.decisions}`,
    `## Answers so far\n${s.answers}`,
    `## This node\n${s.node}`,
    `## Task\n${s.task}`,
  ].join("\n\n");
}

function rootSection(g: Graph): string {
  const r = currentRoot(g);
  return `(v${r.version}) ${r.statement}`;
}

function commentsSection(g: Graph): string {
  const open = g.comments.filter((c) => c.mergedIntoRootVersion === undefined);
  return open.length ? open.map((c, i) => `${i + 1}. ${c.text}`).join("\n") : "none";
}

function decisionsSection(g: Graph): string {
  const d = decisionSummary(g).decisions;
  return d.length ? d.map((x) => `- ${x.problemTitle} → ${x.solutionTitle}`).join("\n") : "none";
}

function answersSection(g: Graph): string {
  const lines: string[] = [];
  for (const id of [ROOT_NODE_ID, ...activeSubtree(g)]) {
    const a = g.answers[id];
    if (!a) continue;
    const v = g.nodeVersions[g.nodes[id]!.currentVersionId]!;
    const opt = a.itemId ? v.options?.find((o) => o.id === a.itemId)?.title : undefined;
    const ans = [opt, a.freeText].filter(Boolean).join(" — ");
    lines.push(`- ${v.title} → ${ans}`);
  }
  return lines.length ? lines.join("\n") : "none";
}

function nodeSection(g: Graph, nodeId: string): string {
  const chain = ancestorChain(g, nodeId);
  const path = chain
    .map((l, i) => (i === 0 ? `[root problem] ${l.title}` : `[${l.kind}] ${l.title}`))
    .join("\n  → ");
  if (nodeId === ROOT_NODE_ID) return `Path: ${path}`;
  const v = g.nodeVersions[g.nodes[nodeId]!.currentVersionId]!;
  const detail = [`Title: ${v.title}`, `Summary: ${v.summary}`];
  if (v.axisValue) detail.push(`Position on axis: ${v.axisValue}`);
  if (v.pros.length) detail.push(`Pros: ${v.pros.join("; ")}`);
  if (v.cons.length) detail.push(`Cons: ${v.cons.join("; ")}`);
  return `Path: ${path}\n${detail.join("\n")}`;
}

/** Clarifications already asked directly under this node, with their answers. */
export function askedHere(g: Graph, nodeId: string): { question: string; answer: string | null }[] {
  const vId = currentVersionIdOf(g, nodeId);
  if (!vId) return [];
  return (g.children[vId] ?? [])
    .filter((c) => kindOf(g, c) === "clarification")
    .map((c) => {
      const v = g.nodeVersions[g.nodes[c]!.currentVersionId]!;
      const a = g.answers[c];
      const opt = a?.itemId ? v.options?.find((o) => o.id === a.itemId)?.title : undefined;
      return { question: v.title, answer: a ? [opt, a.freeText].filter(Boolean).join(" — ") : null };
    });
}

/** Titles of the items the latest solutions / subproblems expansion of this version produced. */
function previousItems(g: Graph, versionId: string): string[] {
  const main = (g.expansions[versionId] ?? []).filter((x) => x.kind !== "clarify").at(-1);
  return main ? main.itemNodeIds.map((id) => titleOf(g, id)) : [];
}

/**
 * Deterministic context for expanding `nodeId` (or regenerating it, when
 * task.kind = "regenerate": then the context is the node's parent's).
 */
export function compileContext(g: Graph, nodeId: string, task: ContextTask): CompiledContext {
  const kind = kindOf(g, nodeId);
  if (!kind) throw new EngineError("ValidationFailed", `unknown node ${nodeId}`);
  const versionId =
    task.kind === "regenerate"
      ? g.nodes[nodeId]?.parentVersionId
      : currentVersionIdOf(g, nodeId);
  if (!versionId) throw new EngineError("ValidationFailed", `cannot compile context for ${nodeId}`);
  const inputs = currentInputs(g, versionId);
  const previous = task.kind === "expand" && task.replace ? previousItems(g, versionId) : [];
  const sections: ContextSections = {
    root: rootSection(g),
    comments: commentsSection(g),
    decisions: decisionsSection(g),
    answers: answersSection(g),
    node: nodeSection(g, nodeId),
    task: taskFor(g, nodeId, kind, task, askedHere(g, nodeId), previous),
  };
  const text = renderSections(sections);
  return { text, sections, hash: hashContext(inputs, versionId), inputs, versionId, tokens: estimateTokens(text) };
}

/**
 * Hash of the whole active graph: what a generated document depends on. Changes
 * when the root, comments, answers, decisions, or any enabled version changes.
 */
export function graphHash(g: Graph): string {
  const versions = enabledOrder(g).map((id) => g.nodes[id]!.currentVersionId);
  return sha256Hex(
    canonicalJson({
      rootVersion: currentRoot(g).version,
      comments: g.comments.filter((c) => c.mergedIntoRootVersion === undefined).map((c) => c.id),
      answers: Object.values(g.answers).map((a) => a.id).sort(),
      decisions: decisionSummary(g).decisions.map((d) => `${d.problemNodeId}:${d.solutionNodeId}`),
      versions,
      open: completeness(g).unresolvedProblemIds,
    }),
  );
}

export function documentKey(docType: string, instructions: string | undefined, contextHash: string): string {
  return sha256Hex(canonicalJson({ docType, instructions: instructions?.trim() || undefined, contextHash }));
}

/** Full graph context for documents and root rewrites: every decision with its alternatives. */
export function compileGraphContext(g: Graph): { text: string; hash: string; tokens: number } {
  const lines: string[] = [];
  const visit = (nodeId: string, depth: number): void => {
    const pad = "  ".repeat(depth);
    const vId = currentVersionIdOf(g, nodeId)!;
    const exps = g.expansions[vId] ?? [];
    const sel = g.selections[nodeId] ?? null;
    const kids = currentChildren(g, nodeId);
    if (kindOf(g, nodeId) === "problem") {
      const leaf = exps.at(-1)?.kind === "leaf" ? exps.at(-1) : undefined;
      if (leaf) lines.push(`${pad}  (leaf: ${leaf.leafReason ?? "actionable as is"})`);
      const sols = kids.filter((c) => kindOf(g, c) === "solution");
      const solExp = exps.filter((x) => x.kind === "solutions").at(-1);
      if (solExp?.axis) lines.push(`${pad}  options differ on: ${solExp.axis}`);
      for (const c of sols) {
        const v = g.nodeVersions[g.nodes[c]!.currentVersionId]!;
        const mark = c === sel ? "CHOSEN" : "rejected";
        lines.push(`${pad}  - [${mark}] ${v.title}: ${v.summary}`);
        if (v.pros.length) lines.push(`${pad}      pros: ${v.pros.join("; ")}`);
        if (v.cons.length) lines.push(`${pad}      cons: ${v.cons.join("; ")}`);
      }
      if (sel !== null && !sols.includes(sel)) lines.push(`${pad}  - [CHOSEN] ${titleOf(g, sel)}`);
      if (solExp?.assumptions.length) lines.push(`${pad}  assumptions: ${solExp.assumptions.join("; ")}`);
      if (sel !== null) visit(sel, depth + 1);
      else if (!leaf) lines.push(`${pad}  (OPEN: no decision yet)`);
    } else {
      const subs = kids.filter((c) => kindOf(g, c) === "problem");
      for (const c of subs) {
        lines.push(`${pad}  * Sub-problem: ${titleOf(g, c)} — ${g.nodeVersions[g.nodes[c]!.currentVersionId]!.summary}`);
        visit(c, depth + 2);
      }
    }
  };
  lines.push(`Root problem: ${currentRoot(g).statement}`);
  visit(ROOT_NODE_ID, 0);
  const sections: ContextSections = {
    root: rootSection(g),
    comments: commentsSection(g),
    decisions: decisionsSection(g),
    answers: answersSection(g),
    node: `Full decision tree (chosen and rejected options):\n${lines.join("\n")}`,
    task: "",
  };
  const history = g.rootVersions.length > 1
    ? `\n\n## Root history\n${g.rootVersions.map((r) => `- v${r.version}: ${r.statement}`).join("\n")}`
    : "";
  const text = renderSections(sections).replace(/\n\n## Task\n$/, "") + history;
  return { text, hash: graphHash(g), tokens: estimateTokens(text) };
}
