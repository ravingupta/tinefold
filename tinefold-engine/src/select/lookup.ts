import type { NodeKind } from "../schema/common";
import { ROOT_NODE_ID, parseRootVersionId, rootVersionId, type Graph, type RootVersion } from "../schema/graph";

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

/** Child node ids attached to the node's current version, in creation order. */
export function currentChildren(g: Graph, nodeId: string): readonly string[] {
  const v = currentVersionIdOf(g, nodeId);
  return v === undefined ? [] : (g.children[v] ?? []);
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
