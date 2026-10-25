import { EngineError } from "../schema/errors";
import type { GraphEvent } from "../schema/events";
import type { Graph } from "../schema/graph";
import type { Project } from "../project/schema";
import type { GraphListing, StorageAdapter } from "./types";

/** In-memory StorageAdapter for tests and Node scripts. Copies on read and write. */
export class MemoryStorage implements StorageAdapter {
  private readonly events = new Map<string, GraphEvent[]>();
  private readonly snapshots = new Map<string, { snapshot: Graph; seq: number }>();
  private readonly projects = new Map<string, Project>();

  async listGraphs(): Promise<GraphListing[]> {
    return [...this.snapshots.entries()]
      .map(([id, s]) => ({ id, title: s.snapshot.rootVersions.at(-1)!.statement, updatedAt: lastAt(this.events.get(id)) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async appendEvent(e: GraphEvent): Promise<void> {
    const list = this.events.get(e.graphId) ?? [];
    if (list.some((x) => x.seq === e.seq)) throw new EngineError("SeqConflict", `seq ${e.seq} already stored for ${e.graphId}`);
    list.push(clone(e));
    this.events.set(e.graphId, list);
  }

  async readEvents(graphId: string, fromSeq = 1): Promise<GraphEvent[]> {
    return (this.events.get(graphId) ?? []).filter((e) => e.seq >= fromSeq).sort((a, b) => a.seq - b.seq).map(clone);
  }

  async readSnapshot(graphId: string): Promise<{ snapshot: Graph; seq: number } | null> {
    const s = this.snapshots.get(graphId);
    return s ? clone(s) : null;
  }

  async writeSnapshot(graphId: string, snapshot: Graph, seq: number): Promise<void> {
    this.snapshots.set(graphId, clone({ snapshot, seq }));
  }

  async deleteGraph(graphId: string): Promise<void> {
    this.events.delete(graphId);
    this.snapshots.delete(graphId);
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async readProject(projectId: string): Promise<Project | null> {
    const p = this.projects.get(projectId);
    return p ? clone(p) : null;
  }

  async writeProject(project: Project): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
  }
}

function lastAt(list: GraphEvent[] | undefined): string {
  return list?.at(-1)?.at ?? "";
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
