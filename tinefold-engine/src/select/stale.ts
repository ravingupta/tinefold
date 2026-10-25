import { hashContext } from "../context/hash";
import type { ExpansionInputs } from "../schema/common";
import { EngineError } from "../schema/errors";
import { ROOT_NODE_ID, type Graph } from "../schema/graph";
import { currentRoot, kindOf, ownerOfVersion, parentNodeIdOf } from "./lookup";
import { memo } from "./memo";
import { activeSubtree, enabledOrder, isWithin, nodePath } from "./traversal";

export type StaleMark = "red" | "yellow" | "none";

/**
 * The inputs a generation under `parentVersionId` would record if it ran now.
 * - ancestorSelectionIds: current selection at each problem strictly above the parent.
 * - decisionIds: selections of enabled problems that are neither on the parent's path
 *   nor inside its subtree (sibling branches), sorted.
 * - commentIds: unmerged comments in seq order.
 * - answerIds: answers on clarifications in the active subtree, depth-first.
 */
export function currentInputs(g: Graph, parentVersionId: string): ExpansionInputs {
  const owner = ownerOfVersion(g, parentVersionId);
  if (!owner) throw new EngineError("ValidationFailed", `unknown version ${parentVersionId}`);
  const path = nodePath(g, owner.nodeId);

  const ancestorSelectionIds: string[] = [];
  for (const id of path.slice(0, -1)) {
    const sel = kindOf(g, id) === "problem" ? (g.selections[id] ?? null) : null;
    if (sel !== null) ancestorSelectionIds.push(sel);
  }

  const decisionIds: string[] = [];
  for (const id of [ROOT_NODE_ID, ...enabledOrder(g)]) {
    const sel = g.selections[id] ?? null;
    if (sel === null || kindOf(g, id) !== "problem") continue;
    if (path.includes(id) || isWithin(g, id, owner.nodeId)) continue;
    decisionIds.push(sel);
  }
  decisionIds.sort();

  return {
    rootVersion: currentRoot(g).version,
    ancestorSelectionIds,
    decisionIds,
    commentIds: g.comments.filter((c) => c.mergedIntoRootVersion === undefined).map((c) => c.id),
    answerIds: [...activeSubtree(g)].flatMap((id) => {
      const a = g.answers[id];
      return a ? [a.id] : [];
    }),
  };
}

export interface StaleDetail {
  mark: StaleMark;
  /** Plain-language reasons, for tooltips. Empty when mark is "none". */
  reasons: string[];
  /** Set when a StaleChecked verdict decided the mark. */
  checkedReason?: string;
}

/**
 * nodeVersionId → mark + reasons, for the current version of every enabled node.
 * Disabled nodes carry no entry. Red: the root or an ancestor selection changed.
 * Yellow: sibling decisions changed, or a comment or answer arrived since generation.
 * A StaleChecked recorded against the current context hash overrides yellow.
 */
export const staleDetails = memo((g: Graph): Readonly<Record<string, StaleDetail>> => {
  const out: Record<string, StaleDetail> = {};
  const root = currentRoot(g).version;
  for (const nodeId of enabledOrder(g)) {
    const node = g.nodes[nodeId]!;
    const v = g.nodeVersions[node.currentVersionId]!;
    const recorded = v.inputs;

    const reasons: string[] = [];
    if (recorded.rootVersion !== root) reasons.push(`the root problem was rewritten (v${recorded.rootVersion} → v${root})`);
    for (const s of recorded.ancestorSelectionIds) {
      const problem = parentNodeIdOf(g, s);
      if (problem === undefined || (g.selections[problem] ?? null) !== s) reasons.push("a choice above this node changed");
    }
    if (reasons.length) {
      out[v.id] = { mark: "red", reasons: [...new Set(reasons)] };
      continue;
    }

    const now = currentInputs(g, node.parentVersionId);
    const check = g.staleChecks[v.id];
    if (check && check.contextHash === hashContext(now, node.parentVersionId)) {
      out[v.id] = check.verdict === "fresh"
        ? { mark: "none", reasons: [], checkedReason: check.reason }
        : { mark: "red", reasons: [check.reason], checkedReason: check.reason };
      continue;
    }

    // A node is never stale because of its own answer or anything beneath it.
    const ownAnswerIds = new Set(
      Object.values(g.answers)
        .filter((a) => isWithin(g, a.clarificationNodeId, nodeId))
        .map((a) => a.id),
    );
    if (!sameSet(recorded.decisionIds, now.decisionIds)) reasons.push("a decision in another branch changed");
    if (now.commentIds.some((id) => !recorded.commentIds.includes(id))) reasons.push("a comment was added");
    if (now.answerIds.some((id) => !ownAnswerIds.has(id) && !recorded.answerIds.includes(id))) reasons.push("a clarification was answered");
    out[v.id] = { mark: reasons.length ? "yellow" : "none", reasons };
  }
  return out;
});

/** nodeVersionId → mark. See staleDetails. */
export const staleMarks = memo((g: Graph): Readonly<Record<string, StaleMark>> => {
  const out: Record<string, StaleMark> = {};
  for (const [k, d] of Object.entries(staleDetails(g))) out[k] = d.mark;
  return out;
});

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const s = new Set(a);
  return s.size === new Set(b).size && b.every((x) => s.has(x));
}
