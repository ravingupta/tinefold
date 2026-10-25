import { describe, expect, it } from "vitest";
import { EngineError, designSessionEvents, replay, GraphEvent } from "@ravingupta/tinefold-engine";
import { DexieStorageAdapter } from "../src/storage/DexieStorageAdapter";

describe("DexieStorageAdapter contract", () => {
  it("appends, reads ranges, rejects seq conflicts, stores snapshots, deletes", async () => {
    const db = new DexieStorageAdapter(`t-${Math.random()}`);
    const events = designSessionEvents.map((e) => GraphEvent.parse(e));
    for (const e of events) await db.appendEvent(e);
    await expect(db.appendEvent(events[3]!)).rejects.toBeInstanceOf(EngineError);
    expect((await db.readEvents("design-session")).map((e) => e.seq)).toEqual(events.map((e) => e.seq));
    expect((await db.readEvents("design-session", 20)).map((e) => e.seq)).toEqual([20, 21, 22]);
    const g = replay(events);
    await db.writeSnapshot(g.id, g, g.seq);
    expect((await db.readSnapshot(g.id))?.seq).toBe(22);
    expect((await db.listGraphs())[0]?.id).toBe("design-session");
    await db.deleteGraph(g.id);
    expect(await db.readSnapshot(g.id)).toBeNull();
    expect(await db.readEvents(g.id)).toEqual([]);
  });
});
