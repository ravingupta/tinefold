import { z } from "zod";

/** Opaque id. ULIDs in production; fixtures use readable ids. */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const IsoTime = z.iso.datetime();
export type IsoTime = z.infer<typeof IsoTime>;

/** SHA-256 hex of canonical JSON. */
export const Hash = z.string().regex(/^[0-9a-f]{64}$/);
export type Hash = z.infer<typeof Hash>;

export const NodeKind = z.enum(["problem", "solution", "clarification"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const ExpansionKind = z.enum(["clarify", "solutions", "subproblems", "leaf"]);
export type ExpansionKind = z.infer<typeof ExpansionKind>;

export const Tokens = z.object({
  in: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
});
export type Tokens = z.infer<typeof Tokens>;

export const GeneratedBy = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  /** Prompt template version; kept out of the context hash on purpose. */
  promptVersion: z.string().min(1),
});
export type GeneratedBy = z.infer<typeof GeneratedBy>;

/** What a generation saw. Recorded on every NodeVersion; drives staleness. */
export const ExpansionInputs = z.object({
  rootVersion: z.number().int().positive(),
  /** Selected solution ids on the path from the root down to the generating parent, root first. */
  ancestorSelectionIds: z.array(Id),
  /** Selected solution ids of enabled problems outside the generating parent's path and subtree. */
  decisionIds: z.array(Id),
  /** Unmerged comment ids, in seq order. */
  commentIds: z.array(Id),
  /** Answer ids of answered clarifications in the active subtree. */
  answerIds: z.array(Id),
});
export type ExpansionInputs = z.infer<typeof ExpansionInputs>;

export const StaleVerdict = z.enum(["fresh", "stale"]);
export type StaleVerdict = z.infer<typeof StaleVerdict>;
