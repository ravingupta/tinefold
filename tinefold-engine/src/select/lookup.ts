import type { NodeKind } from "../schema/common";
import { ROOT_NODE_ID, parseRootVersionId, rootVersionId, type Expansion, type Graph, type RootVersion } from "../schema/graph";

/** Plain lookups over a snapshot. The root is treated as a problem node with id ROOT_NODE_ID. */

export function currentRoot(g: Graph): RootVersion {
  return g.rootVersions[g.rootVersions.length - 1]!;
}

/** The node owning a version id (a root version or a node version), or undefined. */
export function ownerOfVersion(g: Graph, versionId: string): { nodeId: string; kind: NodeKind } | undefined {
  const rv = parseRootVersionId(versionId);
  if (rv !== null) {
    return rv <= g.rootVersions.length ? { nodeId: ROOT_NODE_ID, kind: "problem" } : undefined;
  }
  const v = g.nodeVersions[versionId];
  const n = v && g.nodes[v.nodeId];
  return n ? { nodeId: n.id, kind: n.kind } : undefined;
}

export function kindOf(g: Graph, nodeId: string): NodeKind | undefined {
  return nodeId === ROOT_NODE_ID ? "problem" : g.nodes[nodeId]?.kind;
}

export function currentVersionIdOf(g: Graph, nodeId: string): string | undefined {
  return nodeId === ROOT_NODE_ID ? rootVersionId(currentRoot(g).version) : g.nodes[nodeId]?.currentVersionId;
}

export function parentNodeIdOf(g: Graph, nodeId: string): string | undefined {
  const n = g.nodes[nodeId];
  return n && ownerOfVersion(g, n.parentVersionId)?.nodeId;
}

/** Title of the node's current version; the root problem is titled "root". */
export function titleOf(g: Graph, nodeId: string): string {
  if (nodeId === ROOT_NODE_ID) return "root";
  const n = g.nodes[nodeId];
  return (n && g.nodeVersions[n.currentVersionId]?.title) ?? "";
}

/**
 * Child node ids attached to the node's current version, in creation order. Items of a
 * solutions / subproblems / leaf expansion that a later one replaced are left out: they
 * stay in g.children as history (a selection among them is still followed).
 */
export function currentChildren(g: Graph, nodeId: string): readonly string[] {
  const v = currentVersionIdOf(g, nodeId);
  if (v === undefined) return [];
  const kids = g.children[v] ?? [];
  const main = (g.expansions[v] ?? []).filter((x) => x.kind !== "clarify");
  if (main.length < 2) return kids;
  const superseded = new Set(main.slice(0, -1).flatMap((x) => x.itemNodeIds));
  return kids.filter((c) => !superseded.has(c));
}

/** The expansions that still describe the version: clarifications plus the latest main one. */
export function liveExpansions(g: Graph, versionId: string): readonly Expansion[] {
  const exps = g.expansions[versionId] ?? [];
  const main = exps.filter((x) => x.kind !== "clarify").at(-1);
  return exps.filter((x) => x.kind === "clarify" || x === main);
}

/** A problem whose current version was expanded as a leaf needs no selection. */
export function isLeaf(g: Graph, nodeId: string): boolean {
  const v = currentVersionIdOf(g, nodeId);
  const exps = v ? g.expansions[v] : undefined;
  return exps !== undefined && exps.length > 0 && exps[exps.length - 1]!.kind === "leaf";
}

export function isUnresolvedProblem(g: Graph, nodeId: string): boolean {
  return kindOf(g, nodeId) === "problem" && (g.selections[nodeId] ?? null) === null && !isLeaf(g, nodeId);
}
