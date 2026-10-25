import { z } from "zod";
import {
  ExpansionInputs,
  ExpansionKind,
  GeneratedBy,
  Hash,
  Id,
  IsoTime,
  NodeKind,
  StaleVerdict,
  Tokens,
} from "./common";

/** The root problem is addressed as a pseudo problem node with this id. */
export const ROOT_NODE_ID = "root";

/** Root versions are addressed as parent versions by a fixed id scheme. */
export function rootVersionId(version: number): string {
  return `root-v${version}`;
}

/** Inverse of rootVersionId; null when the id is not a root version id. */
export function parseRootVersionId(id: string): number | null {
  const m = /^root-v([1-9][0-9]*)$/.exec(id);
  return m ? Number(m[1]) : null;
}

export const RootVersion = z.object({
  version: z.number().int().positive(),
  statement: z.string().min(1),
  createdAt: IsoTime,
  approvedFromCommentIds: z.array(Id),
});
export type RootVersion = z.infer<typeof RootVersion>;

export const Comment = z.object({
  id: Id,
  text: z.string().min(1),
  createdAt: IsoTime,
  mergedIntoRootVersion: z.number().int().positive().optional(),
});
export type Comment = z.infer<typeof Comment>;

export const Node = z.object({
  id: Id,
  kind: NodeKind,
  /** The version of the parent that generated (or received) this node. */
  parentVersionId: Id,
  currentVersionId: Id,
  portedFrom: Id.optional(),
});
export type Node = z.infer<typeof Node>;

/** An answer option on a clarification node. */
export const ClarificationOption = z.object({
  id: Id,
  title: z.string().min(1),
});
export type ClarificationOption = z.infer<typeof ClarificationOption>;

/** Immutable. Regeneration appends a new version with the same nodeId. */
export const NodeVersion = z.object({
  id: Id,
  nodeId: Id,
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  axisValue: z.string().optional(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  /** Clarification nodes only: the answer options. */
  options: z.array(ClarificationOption).optional(),
  contextHash: Hash,
  inputs: ExpansionInputs,
  generatedBy: GeneratedBy,
  tokens: Tokens,
  createdAt: IsoTime,
});
export type NodeVersion = z.infer<typeof NodeVersion>;

/** What one expand call produced for one parent version. */
export const Expansion = z.object({
  parentVersionId: Id,
  kind: ExpansionKind,
  itemNodeIds: z.array(Id),
  axis: z.string().optional(),
  recommendedId: Id.optional(),
  reason: z.string().optional(),
  suggestedNextId: Id.optional(),
  assumptions: z.array(z.string()),
  leafReason: z.string().optional(),
  contextHash: Hash,
  seq: z.number().int().positive(),
});
export type Expansion = z.infer<typeof Expansion>;

export const Answer = z.object({
  /** The id of the ClarificationAnswered event; changes on every re-answer. */
  id: Id,
  clarificationNodeId: Id,
  itemId: Id.optional(),
  freeText: z.string().optional(),
  answeredAt: IsoTime,
});
export type Answer = z.infer<typeof Answer>;

export const StaleCheck = z.object({
  nodeVersionId: Id,
  verdict: StaleVerdict,
  reason: z.string(),
  contextHash: Hash,
  checkedAt: IsoTime,
});
export type StaleCheck = z.infer<typeof StaleCheck>;

export const PrdCacheEntry = z.object({
  contextHash: Hash,
  markdown: z.string(),
  generatedBy: GeneratedBy,
  tokens: Tokens,
  createdAt: IsoTime,
});
export type PrdCacheEntry = z.infer<typeof PrdCacheEntry>;

/** Output document types. "custom" carries free-text instructions. */
export const DocType = z.enum(["prd", "trd", "solution", "adr", "brief", "overview", "custom"]);
export type DocType = z.infer<typeof DocType>;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  prd: "Product requirements (PRD)",
  trd: "Technical design (TRD)",
  solution: "Solution design",
  adr: "Decision record (ADR)",
  brief: "One-page brief",
  overview: "Project overview",
  custom: "Custom document",
};

export const DocumentEntry = z.object({
  /** sha256 of {docType, instructions, contextHash}. */
  key: Hash,
  docType: DocType,
  instructions: z.string().optional(),
  contextHash: Hash,
  markdown: z.string(),
  generatedBy: GeneratedBy,
  tokens: Tokens,
  createdAt: IsoTime,
});
export type DocumentEntry = z.infer<typeof DocumentEntry>;

/** One brainstorming session. The snapshot: a cache of folding the event log. */
export const Graph = z.object({
  id: Id,
  createdAt: IsoTime,
  /** seq of the last event folded into this snapshot. */
  seq: z.number().int().positive(),
  /** Short display name (2–4 words). Absent on graphs created before names existed. */
  name: z.string().optional(),
  /** "user" once the user has named it; automatic names never overwrite a user's. */
  nameSource: z.enum(["auto", "user"]).optional(),
  rootVersions: z.array(RootVersion),
  comments: z.array(Comment),
  nodes: z.record(Id, Node),
  nodeVersions: z.record(Id, NodeVersion),
  /** parentVersionId → child node ids in creation order. */
  children: z.record(Id, z.array(Id)),
  /** parentVersionId → expansions of that version in seq order. */
  expansions: z.record(Id, z.array(Expansion)),
  /** problemNodeId (or ROOT_NODE_ID) → selected solutionNodeId or null. */
  selections: z.record(Id, Id.nullable()),
  /** clarificationNodeId → its current answer. */
  answers: z.record(Id, Answer),
  /** nodeVersionId → latest StaleChecked result. */
  staleChecks: z.record(Id, StaleCheck),
  /** contextHash → generated PRD. */
  prdCache: z.record(Hash, PrdCacheEntry),
  /** document key → generated document (any DocType). */
  documents: z.record(Hash, DocumentEntry).default({}),
});
export type Graph = z.infer<typeof Graph>;
