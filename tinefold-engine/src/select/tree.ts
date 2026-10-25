import type { NodeKind } from "../schema/common";
import { ROOT_NODE_ID, type ClarificationOption, type Graph } from "../schema/graph";
import { currentChildren, currentRoot, currentVersionIdOf, isLeaf, kindOf, parentNodeIdOf, titleOf } from "./lookup";
import { memo } from "./memo";
import { staleDetails, type StaleMark } from "./stale";
import { enabledOrder, enabledSet, isWithin } from "./traversal";
import { suggestedNext } from "./views";

export type NodeState = "active" | "option" | "disabled";

export interface TreeNode {
  id: string;
  kind: NodeKind;
  isRoot: boolean;
  /** The node this one hangs under (null for the root). */
  parentId: string | null;
  versionId: string;
  version: number;
  versionCount: number;
  title: string;
  summary: string;
  axisValue?: string;
  pros: string[];
  cons: string[];
  /** clarification only */
  options?: ClarificationOption[];
  answer?: { itemId?: string; freeText?: string; label: string };
  /** active: on the chosen path; option: an unchosen solution of an active problem; disabled: off the path. */
  state: NodeState;
  /** solution only: chosen by its parent problem. */
  selected: boolean;
  /** solution only: hangs off an older version of its problem (kept because it is still selected). */
  fromOlderVersion: boolean;
  recommended: boolean;
  mark: StaleMark | null;
  staleReasons: string[];
  checkedReason?: string;
  portedFrom?: { nodeId: string; title: string };
  isLeaf: boolean;
  leafReason?: string;
  /** problem: the axis its solutions differ on. */
  axis?: string;
  recommendReason?: string;
  assumptions: string[];
  /** solution: the sub-problem its expansion suggested tackling first. */
  suggestedNextId?: string;
  /** The single globally suggested next problem. */
  isSuggestedNext: boolean;
  /** Has a solutions / subproblems / leaf expansion on its current version. */
  expanded: boolean;
  /** Clarifications were asked on its current version. */
  clarified: boolean;
  canExpand: boolean;
  canRegenerate: boolean;
  /** Unanswered clarifications directly under this node. */
  openQuestions: number;
  children: TreeNode[];
  /** Root only: branches generated under earlier root versions, kept for reference and porting. */
  archive?: { version: number; statement: string; children: TreeNode[] }[];
}

/** A render-ready tree from the root. Clients draw this and nothing else. */
export const renderTree = memo((g: Graph): TreeNode => {
  const enabled = enabledSet(g);
  const stale = staleDetails(g);
  const next = suggestedNext(g);

  const build = (id: string, parentState: NodeState | null, parentProblemSelected: string | null, fromOlder: boolean, parentId: string | null = null): TreeNode => {
    const isRoot = id === ROOT_NODE_ID;
    const kind = kindOf(g, id)!;
    const versionId = currentVersionIdOf(g, id)!;
    const node = isRoot ? undefined : g.nodes[id]!;
    const v = node ? g.nodeVersions[versionId]! : undefined;
    const exps = g.expansions[versionId] ?? [];

    let state: NodeState;
    if (isRoot || enabled.has(id)) state = "active";
    else if (kind === "solution" && parentState === "active") state = "option";
    else state = "disabled";

    const mainExp = exps.filter((x) => x.kind !== "clarify").at(-1);
    const solExp = exps.filter((x) => x.kind === "solutions").at(-1);
    const parentExp = node
      ? (g.expansions[node.parentVersionId] ?? []).find((x) => x.itemNodeIds.includes(id))
      : undefined;
    const selected = kind === "solution" && parentProblemSelected === id;
    const children = currentChildren(g, id);
    const childIds = [...children];
    const sel = kind === "problem" ? (g.selections[id] ?? null) : null;
    const olderSel = sel !== null && !children.includes(sel) ? sel : null;
    if (olderSel) childIds.push(olderSel);
    const clarIds = children.filter((c) => kindOf(g, c) === "clarification");
    const detail = v ? stale[v.id] : undefined;
    const answer = node && kind === "clarification" ? g.answers[id] : undefined;
    const versionCount = isRoot
      ? g.rootVersions.length
      : Object.values(g.nodeVersions).filter((x) => x.nodeId === id).length;

    const expandable = (kind === "problem" || (kind === "solution" && state === "active")) && state !== "disabled";
    return {
      id,
      kind,
      isRoot,
      parentId,
      versionId,
      version: isRoot ? currentRoot(g).version : v!.version,
      versionCount,
      title: isRoot ? currentRoot(g).statement : v!.title,
      summary: isRoot ? "" : v!.summary,
      axisValue: v?.axisValue,
      pros: v ? [...v.pros] : [],
      cons: v ? [...v.cons] : [],
      options: v?.options?.map((o) => ({ ...o })),
      answer: answer && {
        itemId: answer.itemId,
        freeText: answer.freeText,
        label: [v?.options?.find((o) => o.id === answer.itemId)?.title, answer.freeText].filter(Boolean).join(" — "),
      },
      state,
      selected,
      fromOlderVersion: fromOlder,
      recommended: parentExp?.recommendedId === id,
      recommendReason: solExp?.reason,
      mark: detail ? detail.mark : null,
      staleReasons: detail ? [...detail.reasons] : [],
      checkedReason: detail?.checkedReason,
      portedFrom: node?.portedFrom ? { nodeId: node.portedFrom, title: titleOf(g, node.portedFrom) } : undefined,
      isLeaf: kind === "problem" && isLeaf(g, id),
      leafReason: mainExp?.kind === "leaf" ? mainExp.leafReason : undefined,
      axis: solExp?.axis,
      assumptions: exps.flatMap((x) => x.assumptions),
      suggestedNextId: kind === "solution" ? exps.filter((x) => x.kind === "subproblems").at(-1)?.suggestedNextId : undefined,
      isSuggestedNext: next === id,
      expanded: mainExp !== undefined,
      clarified: clarIds.length > 0,
      canExpand: expandable && mainExp === undefined && (kind !== "problem" || sel === null || olderSel !== null),
      canRegenerate: !isRoot && kind !== "clarification" && state !== "disabled",
      openQuestions: clarIds.filter((c) => !g.answers[c]).length,
      children: childIds.map((c) => build(c, state, sel, c === olderSel, id)),
    };
  };
  const root = build(ROOT_NODE_ID, null, null, false);
  const shown = new Set(root.children.map((c) => c.id));
  root.archive = g.rootVersions
    .slice(0, -1)
    .map((rv) => ({
      version: rv.version,
      statement: rv.statement,
      children: (g.children[`root-v${rv.version}`] ?? [])
        .filter((c) => !shown.has(c) && kindOf(g, c) !== "clarification")
        .map((c) => build(c, "disabled", g.selections[ROOT_NODE_ID] ?? null, false, ROOT_NODE_ID)),
    }))
    .filter((a) => a.children.length > 0)
    .reverse();
  return root;
});

export interface AssumptionEntry {
  nodeId: string;
  nodeTitle: string;
  text: string;
}

/** Every assumption recorded by expansions on the active path, depth-first. */
export const assumptions = memo((g: Graph): AssumptionEntry[] => {
  const out: AssumptionEntry[] = [];
  const seen = new Set<string>();
  const versionsFor = (id: string): string[] => {
    const vs = [currentVersionIdOf(g, id)!];
    const sel = g.selections[id] ?? null;
    if (sel !== null) {
      const pv = g.nodes[sel]?.parentVersionId;
      if (pv && !vs.includes(pv)) vs.push(pv);
    }
    return vs;
  };
  for (const id of [ROOT_NODE_ID, ...enabledOrder(g)]) {
    for (const vId of versionsFor(id)) {
      for (const exp of g.expansions[vId] ?? []) {
        for (const text of exp.assumptions) {
          const key = `${id}|${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ nodeId: id, nodeTitle: id === ROOT_NODE_ID ? "Root problem" : titleOf(g, id), text });
        }
      }
    }
  }
  return out;
});

export interface RestartWarning {
  nodeId: string;
  title: string;
  /** Red nodes in that subtree, the node itself included. */
  count: number;
}

/**
 * The highest red node on the active path, when it has at least `threshold` red
 * nodes in its subtree: the place to suggest "restart from here".
 */
export function restartWarning(g: Graph, threshold = 3): RestartWarning | null {
  const stale = staleDetails(g);
  const red = enabledOrder(g).filter((id) => stale[g.nodes[id]!.currentVersionId]?.mark === "red");
  const redSet = new Set(red);
  for (const id of red) {
    const parent = parentNodeIdOf(g, id);
    if (parent !== undefined && redSet.has(parent)) continue;
    const count = red.filter((r) => isWithin(g, r, id)).length;
    if (count >= threshold) return { nodeId: id, title: titleOf(g, id), count };
  }
  return null;
}
