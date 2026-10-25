import { z } from "zod";
import { GeneratedBy, Hash, Id, IsoTime, Tokens } from "../schema/common";
import { DocType } from "../schema/graph";

export const ProjectDocument = z.object({
  key: Hash,
  docType: DocType,
  instructions: z.string().optional(),
  /** The brainstorms it was written from, in project order. */
  graphIds: z.array(Id),
  contextHash: Hash,
  markdown: z.string(),
  generatedBy: GeneratedBy,
  tokens: Tokens,
  createdAt: IsoTime,
});
export type ProjectDocument = z.infer<typeof ProjectDocument>;

/**
 * A project is a lens over brainstorms, not a container that changes them: it
 * names a set of brainstorms (a brainstorm can sit in several projects), keeps a
 * note on how they relate, and holds documents written across them. Brainstorms
 * never read from a project, so they stay independent and replayable on their own.
 */
export const Project = z.object({
  id: Id,
  name: z.string().min(1),
  /** How the brainstorms fit together, in the user's words. Used only for project documents. */
  description: z.string(),
  graphIds: z.array(Id),
  createdAt: IsoTime,
  updatedAt: IsoTime,
  documents: z.record(Hash, ProjectDocument),
});
export type Project = z.infer<typeof Project>;
