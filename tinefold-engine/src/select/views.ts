import type { NodeKind } from "../schema/common";
import { ROOT_NODE_ID, type Graph } from "../schema/graph";
import { currentChildren, currentRoot, currentVersionIdOf, isUnresolvedProblem, kindOf, titleOf } from "./lookup";
import { memo, memoBy } from "./memo";
import { activeSubtree, enabledOrder, nodePath } from "./traversal";

export interface Completeness {
  /** Unresolved problems plus unanswered clarifications. */
  count: number;
  /** Enabled problems (the root included) with no selection and no leaf expansion, depth-first. */
  unresolvedProblemIds: string[];
  /** Enabled clarifications with no answer, depth-first. */
  unansweredClarificationIds: string[];
}

export const completeness = memo((g: Graph): Completeness => {
  const ids = [ROOT_NODE_ID, ...enabledOrder(g)];
  const unresolvedProblemIds = ids.filter((id) => isUnresolvedProblem(g, id));
  const unansweredClarificationIds = ids.filter((id) => kindOf(g, id) === "clarification" && !g.answers[id]);
  return {
    count: unresolvedProblemIds.length + unansweredClarificationIds.length,
    unresolvedProblemIds,
    unansweredClarificationIds,
  };
});

export interface Decision {
  problemNodeId: string;
  solutionNodeId: string;
  problemTitle: string;
  solutionTitle: string;
}

export interface DecisionSummary {
  /** Deterministic text: root statement, open comments, one line per decision. */
  text: string;
  decisions: Decision[];
}

/** Decisions of the active subtree, depth-first, rendered by code so it cannot drift. */
export const decisionSummary = memo((g: Graph): DecisionSummary => {
  const active = activeSubtree(g);
  const decisions: Decision[] = [];
  for (const id of [ROOT_NODE_ID, ...active]) {
    const sel = g.selections[id] ?? null;
    if (kindOf(g, id) !== "problem" || sel === null || !active.has(sel)) continue;
    decisions.push({ problemNodeId: id, solutionNodeId: sel, problemTitle: titleOf(g, id), solutionTitle: titleOf(g, sel) });
  }
  const root = currentRoot(g);
  const comments = g.comments.filter((c) => c.mergedIntoRootVersion === undefined);
  const text = [
    `Root problem (v${root.version}): ${root.statement}`,
    "Comments:",
    ...(comments.length ? comments.map((c) => `- ${c.text}`) : ["- none"]),
    "Decisions:",
    ...(decisions.length ? decisions.map((d) => `- ${d.problemTitle} → ${d.solutionTitle}`) : ["- none"]),
  ].join("\n");
  return { text, decisions };
});

export interface ChainLink {
  nodeId: string;
  kind: NodeKind;
  title: string;
}

/**
 * Titles from the root to the node, inclusive. The path alternates problem and
 * solution, so each problem level is followed by the solution that leads down.
 * The root link carries the current root statement.
 */
export const ancestorChain = memoBy((g: Graph, nodeId: string): ChainLink[] =>
  nodePath(g, nodeId).map((id) => ({
    nodeId: id,
    kind: kindOf(g, id)!,
    title: id === ROOT_NODE_ID ? currentRoot(g).statement : titleOf(g, id),
  })),
);

/**
 * From the deepest expanded enabled solution with unresolved sub-problems: the
 * suggestedNextId of its expansion if still unresolved, else its first unresolved
 * sub-problem. Null when nothing qualifies.
 */
export const suggestedNext = memo((g: Graph): string | null => {
  let best: { depth: number; pick: string } | null = null;
  for (const id of enabledOrder(g)) {
    if (kindOf(g, id) !== "solution") continue;
    const exps = g.expansions[currentVersionIdOf(g, id)!] ?? [];
    const exp = exps.filter((x) => x.kind === "subproblems").at(-1);
    if (!exp) continue;
    const unresolved = currentChildren(g, id).filter((c) => isUnresolvedProblem(g, c));
    if (unresolved.length === 0) continue;
    const depth = nodePath(g, id).length;
    if (best && best.depth >= depth) continue;
    const s = exp.suggestedNextId;
    best = { depth, pick: s !== undefined && unresolved.includes(s) ? s : unresolved[0]! };
  }
  return best?.pick ?? null;
});
