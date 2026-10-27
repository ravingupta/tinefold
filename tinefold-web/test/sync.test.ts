import { describe, expect, it } from "vitest";
import { importGraph, openSession, type SessionOptions } from "@ravingupta/tinefold-engine";
import { exampleEvents } from "../src/examples";
import { DexieStorageAdapter } from "../src/storage/DexieStorageAdapter";
import { DEFAULT_SETTINGS, buildProviders, buildRegistry } from "../src/settings/settings";
import { GUIDE, MANIFEST, makeBackup, restoreBackup, syncWith, type SyncHashes, type SyncStore } from "../src/sync/sync";
import { MemoryTarget } from "../src/sync/target";

/** One browser: its own IndexedDB and the fingerprints from its last sync. */
function device() {
  const storage = new DexieStorageAdapter(`sync-${Math.random()}`);
  const opts: SessionOptions = { storage, providers: buildProviders(DEFAULT_SETTINGS), registry: buildRegistry(DEFAULT_SETTINGS) };
  const store: SyncStore = {
    storage,
    importCopy: async (events, name) => {
      const s = await importGraph(events, opts);
      await s.rename(name);
      return s.graphId;
    },
    forget: () => {},
  };
  let hashes: SyncHashes = {};
  return {
    storage,
    open: (id: string) => openSession(id, opts),
    sync: async (t: MemoryTarget, deletes: string[] = []) => {
      const r = await syncWith(t, store, hashes, deletes);
      hashes = r.hashes;
      return r;
    },
    store,
    opts,
  };
}

async function names(d: ReturnType<typeof device>) {
  return (await d.storage.listGraphs()).map((g) => g.title).sort();
}

describe("folder sync", () => {
  it("carries brainstorms across devices, keeps both sides of a conflict, and honours hand edits and deletions", async () => {
    const folder = new MemoryTarget();
    const a = device();
    const b = device();
    const id = (await importGraph(exampleEvents, a.opts)).graphId;

    expect((await a.sync(folder)).pushed).toBe(1);
    expect(folder.root.get(GUIDE)).toContain("tinefold sync folder");
    expect([...folder.files.brainstorms.keys()]).toEqual([id]);

    // A second device gets the same brainstorm under the same id.
    expect((await b.sync(folder)).pulled).toBe(1);
    expect(await b.storage.readEvents(id)).toEqual(await a.storage.readEvents(id));
    expect((await b.sync(folder)).pulled + (await a.sync(folder)).pulled).toBe(0);

    // A change on one side travels to the other.
    await (await b.open(id)).rename("Renamed on B");
    expect((await b.sync(folder)).pushed).toBe(1);
    expect((await a.sync(folder)).pulled).toBe(1);
    expect(await names(a)).toEqual(["Renamed on B"]);

    // Both change before syncing: the folder's version wins, the other is kept as a copy.
    await (await a.open(id)).rename("Renamed on A");
    await (await b.open(id)).rename("Renamed on B again");
    await a.sync(folder);
    const r = await b.sync(folder);
    expect(r.copies).toEqual(["Renamed on B again"]);
    expect(await names(b)).toEqual(["Renamed on A", "Renamed on B again (this device)"]);
    await a.sync(folder);
    expect(await names(a)).toEqual(await names(b));

    // A hand edit in the folder (an AI tool fixing a title) is pulled in.
    const events = JSON.parse(folder.files.brainstorms.get(id)!) as { type: string; payload: { items?: { title: string }[] } }[];
    events.find((e) => e.type === "NodeExpanded" && e.payload.items?.length)!.payload.items![0]!.title = "Edited by hand";
    folder.files.brainstorms.set(id, JSON.stringify(events));
    expect((await a.sync(folder)).pulled).toBe(1);
    const g = (await a.open(id)).getSnapshot();
    expect(Object.values(g.nodeVersions).some((v) => v.title === "Edited by hand")).toBe(true);
    expect(folder.files.brainstorms.get(id)).toBe(`${JSON.stringify(await a.storage.readEvents(id), null, 2)}\n`);

    // A broken file is skipped and named; nothing else changes.
    const before = await a.storage.readEvents(id);
    folder.files.brainstorms.set(id, JSON.stringify(events.slice(0, 3).concat(events.slice(4))));
    const bad = await a.sync(folder);
    expect(bad.problems).toEqual([expect.stringMatching(new RegExp(`^brainstorms/${id}\\.json: .*seq`))]);
    expect(await a.storage.readEvents(id)).toEqual(before);
    folder.files.brainstorms.set(id, JSON.stringify(before));

    // A deletion on one device removes the brainstorm everywhere and is not pulled back.
    await a.storage.deleteGraph(id);
    expect((await a.sync(folder, [id])).removed).toBe(0);
    expect(folder.files.brainstorms.has(id)).toBe(false);
    expect(JSON.parse(folder.root.get(MANIFEST)!).deleted).toEqual([id]);
    expect((await b.sync(folder)).removed).toBe(1);
    expect(await names(b)).toEqual(["Renamed on B again (this device)"]);
  });

  it("restores a backup file into another device by merging", async () => {
    const a = device();
    const b = device();
    const id = (await importGraph(exampleEvents, a.opts)).graphId;
    const backup = JSON.parse(JSON.stringify(await makeBackup(a.store, [])));
    expect(Object.keys(backup.brainstorms)).toEqual([id]);

    expect((await restoreBackup(b.store, backup)).pulled).toBe(1);
    expect(await b.storage.readEvents(id)).toEqual(await a.storage.readEvents(id));
    // Restoring again changes nothing.
    expect((await restoreBackup(b.store, backup)).pulled).toBe(0);
    await expect(restoreBackup(b.store, { hello: 1 })).rejects.toThrow("not a tinefold backup");
  });
});
