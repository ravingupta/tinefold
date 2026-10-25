import Dexie, { type Table } from "dexie";
import { EngineError, graphName, type Graph, type GraphEvent, type GraphListing, type Project, type StorageAdapter } from "@ravingupta/tinefold-engine";

interface EventRow { graphId: string; seq: number; event: GraphEvent }
interface SnapshotRow { graphId: string; seq: number; snapshot: Graph; title: string; updatedAt: string }

class TinefoldDb extends Dexie {
  events!: Table<EventRow, [string, number]>;
  snapshots!: Table<SnapshotRow, string>;
  projects!: Table<Project, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      events: "[graphId+seq], graphId",
      snapshots: "graphId, updatedAt",
    });
    this.version(2).stores({
      events: "[graphId+seq], graphId",
      snapshots: "graphId, updatedAt",
      projects: "id, updatedAt",
    });
  }
}

/** The only place this app touches IndexedDB. */
export class DexieStorageAdapter implements StorageAdapter {
  private readonly db: TinefoldDb;
  constructor(name = "tinefold") {
    this.db = new TinefoldDb(name);
  }

  async listGraphs(): Promise<GraphListing[]> {
    const rows = await this.db.snapshots.orderBy("updatedAt").reverse().toArray();
    // Derived from the snapshot so rows written before names existed list a name too.
    return rows.map((r) => ({ id: r.graphId, title: graphName(r.snapshot), statement: r.snapshot.rootVersions.at(-1)?.statement, updatedAt: r.updatedAt }));
  }

  async appendEvent(e: GraphEvent): Promise<void> {
    try {
      await this.db.transaction("rw", this.db.events, async () => {
        await this.db.events.add({ graphId: e.graphId, seq: e.seq, event: e });
      });
    } catch (err) {
      if (err instanceof Dexie.ConstraintError || (err as { name?: string })?.name === "ConstraintError") {
        throw new EngineError("SeqConflict", `seq ${e.seq} already stored for ${e.graphId}`);
      }
      throw err;
    }
  }

  async readEvents(graphId: string, fromSeq = 1): Promise<GraphEvent[]> {
    const rows = await this.db.events.where("[graphId+seq]").between([graphId, fromSeq], [graphId, Dexie.maxKey]).toArray();
    return rows.map((r) => r.event);
  }

  async readSnapshot(graphId: string): Promise<{ snapshot: Graph; seq: number } | null> {
    const row = await this.db.snapshots.get(graphId);
    return row ? { snapshot: row.snapshot, seq: row.seq } : null;
  }

  async writeSnapshot(graphId: string, snapshot: Graph, seq: number): Promise<void> {
    try {
      await this.db.snapshots.put({
        graphId,
        seq,
        snapshot,
        title: graphName(snapshot),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      // Best effort: the next load repairs the snapshot from the event log.
      console.warn("snapshot write failed", err);
    }
  }

  async listProjects(): Promise<Project[]> {
    return this.db.projects.orderBy("updatedAt").reverse().toArray();
  }

  async readProject(projectId: string): Promise<Project | null> {
    return (await this.db.projects.get(projectId)) ?? null;
  }

  async writeProject(project: Project): Promise<void> {
    await this.db.projects.put(project);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.db.projects.delete(projectId);
  }

  async deleteGraph(graphId: string): Promise<void> {
    await this.db.transaction("rw", this.db.events, this.db.snapshots, async () => {
      await this.db.events.where("graphId").equals(graphId).delete();
      await this.db.snapshots.delete(graphId);
    });
  }
}
