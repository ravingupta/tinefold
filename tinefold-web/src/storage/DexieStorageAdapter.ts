import Dexie, { type Table } from "dexie";
import { EngineError, graphName, type AiCall, type Graph, type GraphEvent, type GraphListing, type Project, type StorageAdapter } from "@ravingupta/tinefold-engine";

interface EventRow { graphId: string; seq: number; event: GraphEvent }
interface SnapshotRow { graphId: string; seq: number; snapshot: Graph; title: string; updatedAt: string }
/** `owner` is the brainstorm or project the call belongs to: its log file in a sync folder. */
interface AiCallRow { id: string; owner: string; at: string; call: AiCall }

export function aiCallOwner(call: AiCall): string {
  return call.scope.graphId ?? call.scope.projectId ?? "";
}

class TinefoldDb extends Dexie {
  events!: Table<EventRow, [string, number]>;
  snapshots!: Table<SnapshotRow, string>;
  projects!: Table<Project, string>;
  values!: Table<{ key: string; value: unknown }, string>;
  aiCalls!: Table<AiCallRow, string>;
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
    this.version(3).stores({
      events: "[graphId+seq], graphId",
      snapshots: "graphId, updatedAt",
      projects: "id, updatedAt",
      values: "key",
    });
    this.version(4).stores({
      events: "[graphId+seq], graphId",
      snapshots: "graphId, updatedAt",
      projects: "id, updatedAt",
      values: "key",
      aiCalls: "id, [owner+at]",
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
    await this.db.transaction("rw", this.db.projects, this.db.aiCalls, async () => {
      await this.db.projects.delete(projectId);
      await this.ownedCalls(projectId).delete();
    });
  }

  async deleteGraph(graphId: string): Promise<void> {
    await this.db.transaction("rw", this.db.events, this.db.snapshots, this.db.aiCalls, async () => {
      await this.db.events.where("graphId").equals(graphId).delete();
      await this.db.snapshots.delete(graphId);
      await this.ownedCalls(graphId).delete();
    });
  }

  /** Swap a brainstorm's whole log and snapshot in one transaction (sync pulls a newer copy). */
  async replaceGraph(graphId: string, events: GraphEvent[], snapshot: Graph): Promise<void> {
    await this.db.transaction("rw", this.db.events, this.db.snapshots, async () => {
      await this.db.events.where("graphId").equals(graphId).delete();
      await this.db.events.bulkAdd(events.map((event) => ({ graphId, seq: event.seq, event })));
      await this.db.snapshots.put({ graphId, seq: snapshot.seq, snapshot, title: graphName(snapshot), updatedAt: new Date().toISOString() });
    });
  }

  /** App values that can't live in localStorage, such as the sync folder's handle. */
  async readValue<T>(key: string): Promise<T | null> {
    return ((await this.db.values.get(key))?.value as T | undefined) ?? null;
  }

  async writeValue(key: string, value: unknown): Promise<void> {
    if (value === null) await this.db.values.delete(key);
    else await this.db.values.put({ key, value });
  }

  // --- AI call log (the nerd panel). Kept until its brainstorm or project is deleted. ---

  private ownedCalls(owner: string) {
    return this.db.aiCalls.where("[owner+at]").between([owner, Dexie.minKey], [owner, Dexie.maxKey]);
  }

  async appendAiCalls(calls: AiCall[]): Promise<void> {
    await this.db.aiCalls.bulkPut(calls.map((call) => ({ id: call.id, owner: aiCallOwner(call), at: call.at, call })));
  }

  /** Oldest first. */
  async listAiCalls(owner: string): Promise<AiCall[]> {
    return (await this.ownedCalls(owner).toArray()).map((r) => r.call);
  }

  /** Every logged call, grouped by owner, oldest first within each. */
  async allAiCalls(): Promise<Map<string, AiCall[]>> {
    const out = new Map<string, AiCall[]>();
    for (const r of await this.db.aiCalls.orderBy("[owner+at]").toArray()) {
      const list = out.get(r.owner);
      if (list) list.push(r.call);
      else out.set(r.owner, [r.call]);
    }
    return out;
  }
}
