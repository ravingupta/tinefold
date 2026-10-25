#!/usr/bin/env node
/**
 * Build a tinefold brainstorm (an importable event log) from a plain outline.
 *
 * The outline is an ordered list of steps that mirror what a person and a model
 * would do in the app: ask a question and answer it, propose options and choose
 * one, break a chosen option into sub-problems, add a comment, rewrite the
 * problem, reuse a branch. Every step runs through the real engine with a
 * scripted provider, so ids, context hashes and staleness marks are exactly what
 * the app would have produced. The output imports with "Import a file".
 *
 *   node tools/brainstorm-from-outline.mjs tools/outlines/x.json tools/out/x.json
 *
 * Outline shape (JSON):
 * {
 *   "statement": "The root problem.",
 *   "startAt": "2026-10-25T09:00:00.000Z",        // optional; each step is +1 minute
 *   "steps": [
 *     { "type": "clarify", "node": "root", "items": [ { "title": "Q?", "summary": "...",
 *         "options": ["A", "B"], "answer": { "option": "A", "freeText": "..." } } ],
 *       "reason": "...", "assumptions": [] },
 *     { "type": "solutions", "node": "root" | "<problem title>", "axis": "...",
 *       "items": [ { "title", "summary", "axisValue", "pros": [], "cons": [] } ],
 *       "recommended": "<title>", "reason": "...", "assumptions": [], "choose": "<title>" },
 *     { "type": "subproblems", "node": "<solution title>", "items": [ { "title", "summary" } ],
 *       "suggestedNext": "<title>", "assumptions": [] },
 *     { "type": "leaf", "node": "<problem title>", "reason": "..." },
 *     { "type": "select", "node": "<problem title>", "choose": "<title>" | null },
 *     { "type": "comment", "text": "..." },
 *     { "type": "rewrite", "statement": "...", "merge": "all" | ["<comment text>", ...] },
 *     { "type": "port", "source": "<problem or solution title>", "target": "<node title>" },
 *     { "type": "check", "node": "<title>", "verdict": "fresh" | "stale", "reason": "..." },
 *     { "type": "check-all", "reason": "..." },  // run last: marks every amber node fresh with this reason
 *     { "type": "document", "docType": "prd" | "trd" | "solution" | "adr" | "brief" | "custom",
 *       "instructions": "...", "file": "path/to/existing.md" }   // attach a document you already have
 *   ]
 * }
 * "name" (optional, 1–60 chars) names the brainstorm in the list of brainstorms.
 * A node is named by its title ("root" for the root problem) or by "#<id>". When
 * several nodes share a title, the newest one wins; name it "#<id>" to be exact.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = await import(path.join(here, "..", "tinefold-engine", "dist", "index.js"));
const { MemoryStorage, MockProvider, ROOT_NODE_ID, createGraph, ExpansionOutput } = engine;

/** Validate a scripted expansion against the engine's provider contract before using it, so limit breaches name the field. */
function script(out) {
  const r = ExpansionOutput.safeParse(out);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`scripted answer rejected by the engine's limits: ${issues}`);
  }
  mock.enqueue(out);
}

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error("usage: node tools/brainstorm-from-outline.mjs <outline.json> [out.json]");
  process.exit(2);
}
const outline = JSON.parse(await readFile(inPath, "utf8"));
const target = outPath ?? path.join(here, "out", `${path.basename(inPath, ".json")}.events.json`);

// --- deterministic ids and clock, so the same outline always gives the same file ---
let n = 0;
let t = Date.parse(outline.startAt ?? "2026-10-25T09:00:00.000Z");
const PROVIDER = { providerId: outline.providerId ?? "transcript", model: outline.model ?? "claude.ai discussion" };
let current = "setup";
const mock = new MockProvider({
  id: PROVIDER.providerId,
  // Never fall back to the mock's generic answers: a step that needs a second
  // provider call (a validation retry) is a bug in the outline, so say so.
  handler: (req) => { throw new Error(`${current}: the provider was called again (${req.purpose}); the scripted answer was probably rejected`); },
});
const session = await createGraph(outline.statement, {
  storage: new MemoryStorage(),
  providers: [mock],
  registry: { default: PROVIDER, overrides: {} },
  newId: () => `n${String(++n).padStart(4, "0")}`,
  now: () => new Date((t += 60_000)).toISOString(),
});

// --- helpers ---
const snap = () => session.getSnapshot();
const titleOf = (g, id) => g.nodeVersions[g.nodes[id].currentVersionId].title;

function resolve(ref, want) {
  if (ref === "root" || ref === ROOT_NODE_ID) return ROOT_NODE_ID;
  const g = snap();
  if (typeof ref === "string" && ref.startsWith("#")) {
    const id = ref.slice(1);
    if (!g.nodes[id]) throw new Error(`no node with id ${id}`);
    return id;
  }
  const matches = Object.keys(g.nodes).filter((id) => titleOf(g, id) === ref && (!want || g.nodes[id].kind === want));
  if (matches.length === 0) throw new Error(`no ${want ?? "node"} titled "${ref}"`);
  return matches.at(-1); // newest wins
}

function childByTitle(parentId, title, kind) {
  const g = snap();
  const vId = parentId === ROOT_NODE_ID ? `root-v${g.rootVersions.at(-1).version}` : g.nodes[parentId].currentVersionId;
  const kids = (g.children[vId] ?? []).filter((c) => g.nodes[c].kind === kind);
  const hit = kids.filter((c) => titleOf(g, c) === title).at(-1);
  if (!hit) {
    const have = kids.map((c) => `"${titleOf(g, c)}"`).join(", ") || "nothing";
    throw new Error(`"${title}" is not a ${kind} under "${parentId === ROOT_NODE_ID ? "root" : titleOf(g, parentId)}" (version ${vId} has: ${have})`);
  }
  return hit;
}

const localIds = (items) => items.map((it, i) => ({ ...it, id: `i${i + 1}` }));
const byTitle = (items, title) => (title == null ? undefined : items.find((it) => it.title === title)?.id ?? fail(`"${title}" is not among the items`));
const fail = (msg) => { throw new Error(msg); };

async function run(step, i) {
  const where = `step ${i + 1} (${step.type})`;
  current = where;
  try {
    switch (step.type) {
      case "clarify": {
        const node = resolve(step.node);
        const items = localIds(step.items).map((it) => ({
          id: it.id,
          title: it.title,
          summary: it.summary ?? "",
          pros: [],
          cons: [],
          options: (it.options ?? []).map((title, k) => ({ id: `o${k + 1}`, title })),
        }));
        script({ kind: "clarify", items, reason: step.reason, assumptions: step.assumptions ?? [] });
        await session.expand(node, { allowClarify: true });
        for (const it of step.items) {
          if (!it.answer) continue;
          const q = childByTitle(node, it.title, "clarification");
          const v = snap().nodeVersions[snap().nodes[q].currentVersionId];
          const itemId = it.answer.option == null ? undefined : (v.options.find((o) => o.title === it.answer.option)?.id ?? fail(`"${it.answer.option}" is not an option of "${it.title}"`));
          await session.answerClarification(q, { itemId, freeText: it.answer.freeText || undefined });
        }
        return;
      }
      case "solutions": {
        const node = resolve(step.node, "problem");
        const items = localIds(step.items).map((it) => ({
          id: it.id, title: it.title, summary: it.summary ?? "", axisValue: it.axisValue, pros: it.pros ?? [], cons: it.cons ?? [],
        }));
        script({
          kind: "solutions", axis: step.axis ?? "approach", items,
          recommendedId: byTitle(items, step.recommended), reason: step.reason, assumptions: step.assumptions ?? [],
        });
        await session.expand(node, { allowClarify: false });
        if (step.choose) await session.selectSolution(node, childByTitle(node, step.choose, "solution"));
        return;
      }
      case "subproblems": {
        const node = resolve(step.node, "solution");
        const items = localIds(step.items).map((it) => ({ id: it.id, title: it.title, summary: it.summary ?? "", pros: [], cons: [] }));
        script({ kind: "subproblems", items, suggestedNextId: byTitle(items, step.suggestedNext), reason: step.reason, assumptions: step.assumptions ?? [] });
        await session.expand(node, { allowClarify: false });
        return;
      }
      case "leaf": {
        const node = resolve(step.node, "problem");
        script({ kind: "leaf", items: [], leafReason: step.reason, assumptions: step.assumptions ?? [] });
        await session.expand(node, { allowClarify: false });
        return;
      }
      case "select": {
        const node = resolve(step.node, "problem");
        await session.selectSolution(node, step.choose == null ? null : childByTitle(node, step.choose, "solution"));
        return;
      }
      case "comment":
        await session.addComment(step.text);
        return;
      case "rewrite": {
        const open = snap().comments.filter((c) => c.mergedIntoRootVersion === undefined);
        const ids = step.merge === "all" || step.merge == null
          ? open.map((c) => c.id)
          : step.merge.map((text) => open.find((c) => c.text === text)?.id ?? fail(`no open comment "${text}"`));
        await session.approveRootRewrite(step.statement, ids);
        return;
      }
      case "port":
        await session.portNode(resolve(step.source), resolve(step.target));
        return;
      case "check-all": {
        const yellow = [];
        const walk = (node) => {
          if (node.mark === "yellow") yellow.push(node.id);
          for (const c of node.children ?? []) walk(c);
        };
        walk(session.select.tree());
        for (const id of yellow) {
          mock.enqueue({ verdict: "fresh", reason: step.reason ?? "" });
          await session.checkStale(id);
        }
        return;
      }
      case "document": {
        const markdown = await readFile(path.resolve(path.dirname(inPath), step.file), "utf8");
        mock.enqueue(markdown);
        await session.generateDocument({ docType: step.docType, instructions: step.instructions, force: true });
        return;
      }
      case "check": {
        const node = resolve(step.node);
        mock.enqueue({ verdict: step.verdict ?? "fresh", reason: step.reason ?? "" });
        await session.checkStale(node);
        return;
      }
      default:
        fail(`unknown step type "${step.type}"`);
    }
  } catch (e) {
    throw new Error(`${where}: ${e.message}`, { cause: e });
  }
}

for (const [i, step] of outline.steps.entries()) await run(step, i);

const events = await session.exportEvents();
if (outline.name) {
  // Newer engines read an optional name on GraphCreated; older ones ignore it.
  const created = events.find((e) => e.type === "GraphCreated");
  created.payload = { ...created.payload, name: outline.name };
}
await writeFile(target, JSON.stringify(events, null, 2) + "\n");

// --- report: what the app will show ---
const tree = session.select.tree();
const done = session.select.completeness();
const lines = [];
const walk = (node, depth) => {
  const mark = node.mark && node.mark !== "none" ? ` [${node.mark.toUpperCase()}: ${node.staleReasons.join("; ")}]` : "";
  const flags = [node.selected ? "chosen" : null, node.state === "option" ? "option" : null, node.state === "disabled" ? "disabled" : null, node.canExpand ? "open" : null].filter(Boolean);
  lines.push(`${"  ".repeat(depth)}${node.kind === "problem" ? "?" : node.kind === "solution" ? "=" : "Q"} ${node.title}${flags.length ? ` (${flags.join(", ")})` : ""}${mark}`);
  for (const c of node.children ?? []) walk(c, depth + 1);
};
lines.push(`root v${tree.version}: ${outline.name ?? tree.title}`);
for (const c of tree.children ?? []) walk(c, 1);
console.log(lines.join("\n"));
console.log(`\n${events.length} events → ${target}`);
console.log(`${done.unresolvedProblemIds.length} open problem(s)${tree.archive?.length ? `, ${tree.archive.length} archived branch(es)` : ""}`);
