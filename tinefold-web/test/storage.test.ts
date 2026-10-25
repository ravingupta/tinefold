import { describe, expect, it } from "vitest";
import { EngineError, replay, GraphEvent } from "@ravingupta/tinefold-engine";
import { exampleEvents } from "../src/examples";
import { DexieStorageAdapter } from "../src/storage/DexieStorageAdapter";

describe("DexieStorageAdapter contract", () => {
  it("appends, reads ranges, rejects seq conflicts, stores snapshots, deletes", async () => {
    const db = new DexieStorageAdapter(`t-${Math.random()}`);
    const events = exampleEvents.map((e) => GraphEvent.parse(e));
    for (const e of events) await db.appendEvent(e);
    await expect(db.appendEvent(events[3]!)).rejects.toBeInstanceOf(EngineError);
    expect((await db.readEvents(events[0]!.graphId)).map((e) => e.seq)).toEqual(events.map((e) => e.seq));
    expect((await db.readEvents(events[0]!.graphId, 93)).map((e) => e.seq)).toEqual([93, 94, 95]);
    const g = replay(events);
    await db.writeSnapshot(g.id, g, g.seq);
    expect((await db.readSnapshot(g.id))?.seq).toBe(95);
    expect((await db.listGraphs())[0]?.id).toBe(events[0]!.graphId);
    await db.deleteGraph(g.id);
    expect(await db.readSnapshot(g.id)).toBeNull();
    expect(await db.readEvents(g.id)).toEqual([]);
  });
});
