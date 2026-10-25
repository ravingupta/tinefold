import type { ExpansionInputs, NodeKind } from "../schema/common";
import { EngineError } from "../schema/errors";
import type { EventOf, ExpansionItem, GraphEvent } from "../schema/events";
import {
  ROOT_NODE_ID,
  parseRootVersionId,
  type Graph,
  type Node,
  type NodeVersion,
} from "../schema/graph";
import { currentRoot, kindOf, ownerOfVersion, parentNodeIdOf } from "../select/lookup";

/**
 * reduce(snapshot, event) → snapshot. Pure: never mutates its arguments, reads no
 * clock or randomness, and rejects an event that would break an invariant with an
 * EngineError instead of folding it.
 */
export function reduce(snapshot: Graph | null, event: GraphEvent): Graph {
  if (snapshot === null) {
    if (event.seq !== 1) fail("SeqConflict", `first event must have seq 1, got ${event.seq}`, event);
    if (event.type !== "GraphCreated") fail("ValidationFailed", `first event must be GraphCreated, got ${event.type}`, event);
    return graphCreated(event);
  }
  if (event.graphId !== snapshot.id) {
    fail("ValidationFailed", `event for graph ${event.graphId} folded into ${snapshot.id}`, event);
  }
  if (event.seq !== snapshot.seq + 1) {
    fail("SeqConflict", `expected seq ${snapshot.seq + 1}, got ${event.seq}`, event);
  }
  const g = { ...snapshot, seq: event.seq };
  switch (event.type) {
    case "GraphCreated":
      return fail("ValidationFailed", "graph already created", event);
    case "GraphRenamed":
      return graphRenamed(g, event);
    case "CommentAdded":
      return commentAdded(g, event);
    case "RootRewritten":
      return rootRewritten(g, event);
    case "NodeExpanded":
      return nodeExpanded(g, event);
    case "NodeRegenerated":
      return nodeRegenerated(g, event);
    case "SolutionSelected":
      return solutionSelected(g, event);
    case "ClarificationAnswered":
      return clarificationAnswered(g, event);
    case "NodePorted":
      return nodePorted(g, event);
    case "StaleChecked":
      return staleChecked(g, event);
    case "PrdGenerated":
      return prdGenerated(g, event);
    case "DocumentGenerated":
      return documentGenerated(g, event);
  }
}

/** Fold a whole log from nothing. */
export function replay(events: readonly GraphEvent[]): Graph {
  let g: Graph | null = null;
  for (const e of events) g = reduce(g, e);
  if (g === null) fail("ValidationFailed", "cannot replay an empty log");
  return g;
}

function fail(code: EngineError["code"], message: string, event?: GraphEvent): never {
  throw new EngineError(code, message, event && { eventId: event.id, seq: event.seq, type: event.type });
}

function graphCreated(e: EventOf<"GraphCreated">): Graph {
  if (e.payload.graphId !== e.graphId) fail("ValidationFailed", "payload graphId differs from envelope", e);
  return {
    id: e.graphId,
    createdAt: e.at,
    seq: e.seq,
    ...(e.payload.name !== undefined ? { name: e.payload.name, nameSource: "auto" as const } : {}),
    rootVersions: [{ version: 1, statement: e.payload.statement, createdAt: e.at, approvedFromCommentIds: [] }],
    comments: [],
    nodes: {},
    nodeVersions: {},
    children: {},
    expansions: {},
    selections: {},
    answers: {},
    staleChecks: {},
    prdCache: {},
    documents: {},
  };
}

function graphRenamed(g: Graph, e: EventOf<"GraphRenamed">): Graph {
  if (e.payload.source === "auto" && g.nameSource === "user") fail("ValidationFailed", "an automatic name cannot replace the user's name", e);
  return { ...g, name: e.payload.name, nameSource: e.payload.source };
}

function commentAdded(g: Graph, e: EventOf<"CommentAdded">): Graph {
  if (g.comments.some((c) => c.id === e.payload.commentId)) fail("ValidationFailed", "duplicate commentId", e);
  return { ...g, comments: [...g.comments, { id: e.payload.commentId, text: e.payload.text, createdAt: e.at }] };
}

function rootRewritten(g: Graph, e: EventOf<"RootRewritten">): Graph {
  const { version, statement, mergedCommentIds } = e.payload;
  if (version !== currentRoot(g).version + 1) fail("ValidationFailed", "root version must increment by exactly one", e);
  for (const id of mergedCommentIds) {
    const c = g.comments.find((x) => x.id === id);
    if (!c) fail("ValidationFailed", `unknown comment ${id}`, e);
    if (c.mergedIntoRootVersion !== undefined) fail("ValidationFailed", `comment ${id} already merged`, e);
  }
  const merged = new Set(mergedCommentIds);
  return {
    ...g,
    rootVersions: [...g.rootVersions, { version, statement, createdAt: e.at, approvedFromCommentIds: [...mergedCommentIds] }],
    comments: g.comments.map((c) => (merged.has(c.id) ? { ...c, mergedIntoRootVersion: version } : c)),
  };
}

const ALLOWED_EXPANSIONS: Record<NodeKind, readonly string[]> = {
  problem: ["clarify", "solutions", "leaf"],
  solution: ["clarify", "subproblems"],
  clarification: [],
};

const ITEM_KIND = { clarify: "clarification", solutions: "solution", subproblems: "problem" } as const;

/** Where a node of each kind may hang. */
const ALLOWED_PARENTS: Record<NodeKind, readonly NodeKind[]> = {
  problem: ["solution"],
  solution: ["problem"],
  clarification: ["problem", "solution"],
};

function nodeExpanded(g: Graph, e: EventOf<"NodeExpanded">): Graph {
  const p = e.payload;
  const parent = ownerOfVersion(g, p.parentVersionId);
  if (!parent) fail("ValidationFailed", `unknown parent version ${p.parentVersionId}`, e);
  if (!ALLOWED_EXPANSIONS[parent.kind].includes(p.kind)) {
    fail("ValidationFailed", `a ${parent.kind} cannot expand into ${p.kind}`, e);
  }
  if (p.kind === "leaf" ? p.items.length > 0 : p.items.length === 0) {
    fail("ValidationFailed", `${p.kind} expansion with ${p.items.length} items`, e);
  }
  const itemIds = p.items.map((i) => i.nodeId);
  if (p.recommendedId !== undefined && !itemIds.includes(p.recommendedId)) fail("ValidationFailed", "recommendedId is not an item", e);
  if (p.suggestedNextId !== undefined && !itemIds.includes(p.suggestedNextId)) fail("ValidationFailed", "suggestedNextId is not an item", e);
  assertFreshIds(g, p.items.flatMap((i) => [i.nodeId, i.versionId]), e);

  const nodes = { ...g.nodes };
  const nodeVersions = { ...g.nodeVersions };
  if (p.kind !== "leaf") {
    const kind = ITEM_KIND[p.kind];
    for (const item of p.items) {
      nodes[item.nodeId] = { id: item.nodeId, kind, parentVersionId: p.parentVersionId, currentVersionId: item.versionId };
      nodeVersions[item.versionId] = versionFromItem(item, 1, p, e.at);
    }
  }
  return {
    ...g,
    nodes,
    nodeVersions,
    children: appendChildren(g, p.parentVersionId, itemIds),
    expansions: {
      ...g.expansions,
      [p.parentVersionId]: [
        ...(g.expansions[p.parentVersionId] ?? []),
        {
          parentVersionId: p.parentVersionId,
          kind: p.kind,
          itemNodeIds: itemIds,
          axis: p.axis,
          recommendedId: p.recommendedId,
          reason: p.reason,
          suggestedNextId: p.suggestedNextId,
          assumptions: [...p.assumptions],
          leafReason: p.leafReason,
          contextHash: p.contextHash,
          seq: e.seq,
        },
      ],
    },
  };
}

function nodeRegenerated(g: Graph, e: EventOf<"NodeRegenerated">): Graph {
  const p = e.payload;
  const node = g.nodes[p.nodeId];
  if (!node) fail("ValidationFailed", `unknown node ${p.nodeId}`, e);
  if (p.newVersion.nodeId !== p.nodeId) fail("ValidationFailed", "newVersion.nodeId differs from nodeId", e);
  assertFreshIds(g, [p.newVersion.versionId], e);
  const current = g.nodeVersions[node.currentVersionId]!;
  return {
    ...g,
    nodes: { ...g.nodes, [node.id]: { ...node, currentVersionId: p.newVersion.versionId } },
    nodeVersions: {
      ...g.nodeVersions,
      [p.newVersion.versionId]: versionFromItem(p.newVersion, current.version + 1, p, e.at),
    },
  };
}

function solutionSelected(g: Graph, e: EventOf<"SolutionSelected">): Graph {
  const { problemNodeId, solutionNodeId } = e.payload;
  if (kindOf(g, problemNodeId) !== "problem") fail("InvalidSelection", `${problemNodeId} is not a problem`, e);
  if (solutionNodeId !== null) {
    if (kindOf(g, solutionNodeId) !== "solution" || parentNodeIdOf(g, solutionNodeId) !== problemNodeId) {
      fail("InvalidSelection", `${solutionNodeId} is not a solution under ${problemNodeId}`, e);
    }
  }
  return { ...g, selections: { ...g.selections, [problemNodeId]: solutionNodeId } };
}

function clarificationAnswered(g: Graph, e: EventOf<"ClarificationAnswered">): Graph {
  const { clarificationNodeId, itemId, freeText } = e.payload;
  const node = g.nodes[clarificationNodeId];
  if (!node || node.kind !== "clarification") fail("InvalidSelection", `${clarificationNodeId} is not a clarification`, e);
  if (itemId !== undefined) {
    const options = g.nodeVersions[node.currentVersionId]!.options ?? [];
    if (!options.some((o) => o.id === itemId)) fail("InvalidSelection", `${itemId} is not an option of ${clarificationNodeId}`, e);
  }
  return {
    ...g,
    answers: {
      ...g.answers,
      [clarificationNodeId]: { id: e.id, clarificationNodeId, itemId, freeText, answeredAt: e.at },
    },
  };
}

function nodePorted(g: Graph, e: EventOf<"NodePorted">): Graph {
  const p = e.payload;
  const source = g.nodes[p.sourceNodeId];
  if (!source) fail("ValidationFailed", `unknown source node ${p.sourceNodeId}`, e);
  const target = ownerOfVersion(g, p.targetParentVersionId);
  if (!target) fail("ValidationFailed", `unknown target version ${p.targetParentVersionId}`, e);
  if (!ALLOWED_PARENTS[source.kind].includes(target.kind)) {
    fail("ValidationFailed", `a ${source.kind} cannot be ported under a ${target.kind}`, e);
  }
  const sourceSelection = g.selections[source.id] ?? null;
  if ((sourceSelection === null) !== (p.selection === undefined)) {
    fail("ValidationFailed", "selection copy must be present exactly when the source has a selection", e);
  }
  if (p.selection && p.selection.sourceSolutionNodeId !== sourceSelection) {
    fail("ValidationFailed", "selection copy does not match the source selection", e);
  }
  assertFreshIds(
    g,
    [p.newNodeId, p.newVersionId, ...(p.selection ? [p.selection.newNodeId, p.selection.newVersionId] : [])],
    e,
  );

  let next: Graph = copyNode(g, source, p.targetParentVersionId, p, e.at);
  if (p.selection) {
    const sol = g.nodes[p.selection.sourceSolutionNodeId]!;
    next = copyNode(next, sol, p.newVersionId, p.selection, e.at);
    next = { ...next, selections: { ...next.selections, [p.newNodeId]: p.selection.newNodeId } };
  }
  return next;
}

function staleChecked(g: Graph, e: EventOf<"StaleChecked">): Graph {
  const p = e.payload;
  if (!g.nodeVersions[p.nodeVersionId]) fail("ValidationFailed", `unknown node version ${p.nodeVersionId}`, e);
  return { ...g, staleChecks: { ...g.staleChecks, [p.nodeVersionId]: { ...p, checkedAt: e.at } } };
}

function prdGenerated(g: Graph, e: EventOf<"PrdGenerated">): Graph {
  const p = e.payload;
  return {
    ...g,
    prdCache: {
      ...g.prdCache,
      [p.contextHash]: { contextHash: p.contextHash, markdown: p.markdown, generatedBy: p.generatedBy, tokens: p.tokens, createdAt: e.at },
    },
  };
}

function documentGenerated(g: Graph, e: EventOf<"DocumentGenerated">): Graph {
  const p = e.payload;
  return {
    ...g,
    documents: { ...(g.documents ?? {}), [p.key]: { ...p, createdAt: e.at } },
  };
}

// --- helpers ---

function assertFreshIds(g: Graph, ids: readonly string[], e: GraphEvent): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || id === ROOT_NODE_ID || parseRootVersionId(id) !== null || g.nodes[id] || g.nodeVersions[id]) {
      fail("ValidationFailed", `id ${id} is already in use; node versions are immutable`, e);
    }
    seen.add(id);
  }
}

function appendChildren(g: Graph, parentVersionId: string, ids: readonly string[]): Graph["children"] {
  if (ids.length === 0) return g.children;
  return { ...g.children, [parentVersionId]: [...(g.children[parentVersionId] ?? []), ...ids] };
}

function cloneInputs(i: ExpansionInputs): ExpansionInputs {
  return {
    rootVersion: i.rootVersion,
    ancestorSelectionIds: [...i.ancestorSelectionIds],
    decisionIds: [...i.decisionIds],
    commentIds: [...i.commentIds],
    answerIds: [...i.answerIds],
  };
}

function versionFromItem(
  item: ExpansionItem,
  version: number,
  gen: { contextHash: string; inputs: ExpansionInputs; generatedBy: NodeVersion["generatedBy"]; tokens: NodeVersion["tokens"] },
  at: string,
): NodeVersion {
  return {
    id: item.versionId,
    nodeId: item.nodeId,
    version,
    title: item.title,
    summary: item.summary,
    axisValue: item.axisValue,
    pros: [...item.pros],
    cons: [...item.cons],
    options: item.options?.map((o) => ({ ...o })),
    contextHash: gen.contextHash,
    inputs: cloneInputs(gen.inputs),
    generatedBy: { ...gen.generatedBy },
    tokens: { ...gen.tokens },
    createdAt: at,
  };
}

/** Copy a node's current version under a new parent with fresh ids and re-recorded inputs. */
function copyNode(
  g: Graph,
  source: Node,
  parentVersionId: string,
  copy: { newNodeId: string; newVersionId: string; contextHash: string; inputs: ExpansionInputs },
  at: string,
): Graph {
  const v = g.nodeVersions[source.currentVersionId]!;
  const node: Node = {
    id: copy.newNodeId,
    kind: source.kind,
    parentVersionId,
    currentVersionId: copy.newVersionId,
    portedFrom: source.id,
  };
  const version: NodeVersion = {
    ...v,
    id: copy.newVersionId,
    nodeId: copy.newNodeId,
    version: 1,
    contextHash: copy.contextHash,
    inputs: cloneInputs(copy.inputs),
    tokens: { in: 0, out: 0 },
    createdAt: at,
  };
  return {
    ...g,
    nodes: { ...g.nodes, [node.id]: node },
    nodeVersions: { ...g.nodeVersions, [version.id]: version },
    children: appendChildren(g, parentVersionId, [node.id]),
  };
}
