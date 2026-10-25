import { z } from "zod";
import {
  ExpansionInputs,
  ExpansionKind,
  GeneratedBy,
  Hash,
  Id,
  IsoTime,
  StaleVerdict,
  Tokens,
} from "./common";
import { ClarificationOption, DocType } from "./graph";

/** One generated item as it appears in the log: content plus the ids it was assigned. */
export const ExpansionItem = z.object({
  nodeId: Id,
  versionId: Id,
  title: z.string(),
  summary: z.string(),
  axisValue: z.string().optional(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  options: z.array(ClarificationOption).optional(),
});
export type ExpansionItem = z.infer<typeof ExpansionItem>;

const envelope = {
  id: Id,
  graphId: Id,
  seq: z.number().int().positive(),
  at: IsoTime,
};

export const GraphCreated = z.object({
  ...envelope,
  type: z.literal("GraphCreated"),
  payload: z.object({
    graphId: Id,
    statement: z.string().min(1),
  }),
});

export const CommentAdded = z.object({
  ...envelope,
  type: z.literal("CommentAdded"),
  payload: z.object({
    commentId: Id,
    text: z.string().min(1),
  }),
});

export const RootRewritten = z.object({
  ...envelope,
  type: z.literal("RootRewritten"),
  payload: z.object({
    version: z.number().int().positive(),
    statement: z.string().min(1),
    mergedCommentIds: z.array(Id),
  }),
});

export const NodeExpanded = z.object({
  ...envelope,
  type: z.literal("NodeExpanded"),
  payload: z.object({
    parentVersionId: Id,
    kind: ExpansionKind,
    items: z.array(ExpansionItem),
    axis: z.string().optional(),
    recommendedId: Id.optional(),
    reason: z.string().optional(),
    suggestedNextId: Id.optional(),
    assumptions: z.array(z.string()),
    leafReason: z.string().optional(),
    contextHash: Hash,
    inputs: ExpansionInputs,
    generatedBy: GeneratedBy,
    tokens: Tokens,
  }),
});

export const NodeRegenerated = z.object({
  ...envelope,
  type: z.literal("NodeRegenerated"),
  payload: z.object({
    nodeId: Id,
    newVersion: ExpansionItem,
    contextHash: Hash,
    inputs: ExpansionInputs,
    generatedBy: GeneratedBy,
    tokens: Tokens,
  }),
});

export const SolutionSelected = z.object({
  ...envelope,
  type: z.literal("SolutionSelected"),
  payload: z.object({
    problemNodeId: Id,
    solutionNodeId: Id.nullable(),
  }),
});

export const ClarificationAnswered = z.object({
  ...envelope,
  type: z.literal("ClarificationAnswered"),
  payload: z
    .object({
      clarificationNodeId: Id,
      itemId: Id.optional(),
      freeText: z.string().min(1).optional(),
    })
    .refine((p) => p.itemId !== undefined || p.freeText !== undefined, {
      message: "itemId or freeText is required",
    }),
});

/** A copy made at port time: new ids plus the inputs it was re-recorded under. */
const PortedCopy = z.object({
  newNodeId: Id,
  newVersionId: Id,
  contextHash: Hash,
  inputs: ExpansionInputs,
});

export const NodePorted = z.object({
  ...envelope,
  type: z.literal("NodePorted"),
  payload: z.object({
    sourceNodeId: Id,
    targetParentVersionId: Id,
    ...PortedCopy.shape,
    /** Present when the source problem had a selection: the selected solution is copied too. */
    selection: PortedCopy.extend({ sourceSolutionNodeId: Id }).optional(),
  }),
});

export const StaleChecked = z.object({
  ...envelope,
  type: z.literal("StaleChecked"),
  payload: z.object({
    nodeVersionId: Id,
    verdict: StaleVerdict,
    reason: z.string(),
    contextHash: Hash,
  }),
});

export const PrdGenerated = z.object({
  ...envelope,
  type: z.literal("PrdGenerated"),
  payload: z.object({
    contextHash: Hash,
    markdown: z.string(),
    generatedBy: GeneratedBy,
    tokens: Tokens,
  }),
});

export const DocumentGenerated = z.object({
  ...envelope,
  type: z.literal("DocumentGenerated"),
  payload: z.object({
    key: Hash,
    docType: DocType,
    instructions: z.string().optional(),
    contextHash: Hash,
    markdown: z.string(),
    generatedBy: GeneratedBy,
    tokens: Tokens,
  }),
});

export const GraphEvent = z.discriminatedUnion("type", [
  GraphCreated,
  CommentAdded,
  RootRewritten,
  NodeExpanded,
  NodeRegenerated,
  SolutionSelected,
  ClarificationAnswered,
  NodePorted,
  StaleChecked,
  PrdGenerated,
  DocumentGenerated,
]);
export type GraphEvent = z.infer<typeof GraphEvent>;
export type GraphEventType = GraphEvent["type"];
export type EventOf<T extends GraphEventType> = Extract<GraphEvent, { type: T }>;
