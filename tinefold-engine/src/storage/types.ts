import type { GraphEvent } from "../schema/events";
import type { Graph } from "../schema/graph";
import type { Project } from "../project/schema";

export interface GraphListing {
  id: string;
  /** The brainstorm's short name (graphName). */
  title: string;
  /** The current full problem statement. */
  statement?: string;
  updatedAt: string;
}

/** Implemented by clients (IndexedDB in the web app). The engine never imports a database. */
export interface StorageAdapter {
  listGraphs(): Promise<GraphListing[]>;
  /** Must reject (ideally with EngineError SeqConflict) when [graphId, seq] already exists. */
  appendEvent(e: GraphEvent): Promise<void>;
  readEvents(graphId: string, fromSeq?: number): Promise<GraphEvent[]>;
  readSnapshot(graphId: string): Promise<{ snapshot: Graph; seq: number } | null>;
  writeSnapshot(graphId: string, snapshot: Graph, seq: number): Promise<void>;
  deleteGraph(graphId: string): Promise<void>;
  listProjects(): Promise<Project[]>;
  readProject(projectId: string): Promise<Project | null>;
  writeProject(project: Project): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}
