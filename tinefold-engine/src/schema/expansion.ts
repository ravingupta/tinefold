import { z } from "zod";

/**
 * What a provider must return for every expansion. From the spec, plus `options`
 * on items (clarify only) so one clarify call can ask 1–3 questions with answer
 * choices (DECISIONS D12).
 */
export const ExpansionOutput = z.object({
  kind: z.enum(["clarify", "solutions", "subproblems", "leaf"]),
  axis: z.string().optional(), // required when kind = solutions
  items: z
    .array(
      z.object({
        id: z.string(), // provider-local, remapped to ULIDs
        title: z.string().max(120),
        summary: z.string().max(600),
        axisValue: z.string().optional(),
        pros: z.array(z.string()).max(4),
        cons: z.array(z.string()).max(4),
        /** clarify only: answer choices for this question. */
        options: z.array(z.object({ id: z.string(), title: z.string().max(120) })).max(5).optional(),
      }),
    )
    .min(0)
    .max(6),
  recommendedId: z.string().optional(),
  reason: z.string().max(400).optional(),
  suggestedNextId: z.string().optional(), // only for subproblems
  assumptions: z.array(z.string()).max(5),
  leafReason: z.string().optional(), // only for leaf
});
export type ExpansionOutput = z.infer<typeof ExpansionOutput>;

/** One regenerated node: same shape as an expansion item. */
export const RegenerationOutput = z.object({
  title: z.string().max(120),
  summary: z.string().max(600),
  axisValue: z.string().optional(),
  pros: z.array(z.string()).max(4),
  cons: z.array(z.string()).max(4),
});
export type RegenerationOutput = z.infer<typeof RegenerationOutput>;

export const StaleCheckOutput = z.object({
  verdict: z.enum(["fresh", "stale"]),
  reason: z.string().max(400),
});
export type StaleCheckOutput = z.infer<typeof StaleCheckOutput>;

export const RootRewriteOutput = z.object({
  statement: z.string().min(1),
  mergedCommentIds: z.array(z.string()),
});
export type RootRewriteOutput = z.infer<typeof RootRewriteOutput>;

/** Hand-written JSON Schemas for providers that enforce structure natively. */
const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;

export const EXPANSION_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["clarify", "solutions", "subproblems", "leaf"] },
    axis: str,
    items: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          id: str,
          title: str,
          summary: str,
          axisValue: str,
          pros: strArr,
          cons: strArr,
          options: {
            type: "array",
            items: { type: "object", properties: { id: str, title: str }, required: ["id", "title"] },
          },
        },
        required: ["id", "title", "summary", "pros", "cons"],
      },
    },
    recommendedId: str,
    reason: str,
    suggestedNextId: str,
    assumptions: strArr,
    leafReason: str,
  },
  required: ["kind", "items", "assumptions"],
} as const;

export const REGENERATION_JSON_SCHEMA = {
  type: "object",
  properties: { title: str, summary: str, axisValue: str, pros: strArr, cons: strArr },
  required: ["title", "summary", "pros", "cons"],
} as const;

export const STALE_CHECK_JSON_SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["fresh", "stale"] }, reason: str },
  required: ["verdict", "reason"],
} as const;

export const ROOT_REWRITE_JSON_SCHEMA = {
  type: "object",
  properties: { statement: str, mergedCommentIds: strArr },
  required: ["statement", "mergedCommentIds"],
} as const;
