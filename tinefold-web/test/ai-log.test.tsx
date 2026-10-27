import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ROOT_NODE_ID, SYSTEM_PROMPT, createGraph, importGraph, type AiCall, type SessionOptions } from "@ravingupta/tinefold-engine";
import { loadSession, newGraph } from "../src/app/sessions";
import { GraphPage } from "../src/outline/GraphPage";
import { DexieStorageAdapter } from "../src/storage/DexieStorageAdapter";
import { DEFAULT_SETTINGS, buildProviders, buildRegistry } from "../src/settings/settings";
import { syncWith, type SyncStore } from "../src/sync/sync";
import { MemoryTarget } from "../src/sync/target";

describe("AI log (nerd panel)", () => {
  it("shows the exact prompt and reply of every call made for the brainstorm", async () => {
    const id = await newGraph("Pick a host for the catalog search service");
    await (await loadSession(id)).expand(ROOT_NODE_ID, { allowClarify: false });
    render(<GraphPage graphId={id} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI log" }));
    const panel = await screen.findByRole("dialog", { name: "AI log" });
    await waitFor(() => expect(within(panel).getAllByText("Options").length).toBeGreaterThan(0));
    expect(within(panel).getByText(/1 call ·/)).toBeTruthy();
    const pres = [...panel.querySelectorAll("pre")].map((p) => p.textContent);
    expect(pres[0]).toBe(SYSTEM_PROMPT);
    expect(pres[1]).toContain("## Root problem");
    expect(pres[1]).toContain("Pick a host for the catalog search service");
    expect(pres.at(-1)).toContain('"kind": "solutions"');
  });

  it("syncs logs through the folder as a union and removes them with their brainstorm", async () => {
    const devices = [0, 1].map(() => {
      const storage = new DexieStorageAdapter(`ailog-${Math.random()}`);
      const opts: SessionOptions = {
        storage,
        providers: buildProviders(DEFAULT_SETTINGS),
        registry: buildRegistry(DEFAULT_SETTINGS),
        onAiCall: (c: AiCall) => void storage.appendAiCalls([c]),
      };
      const store: SyncStore = { storage, importCopy: async (events) => (await importGraph(events, opts)).graphId, forget: () => {} };
      return { storage, opts, store };
    });
    const [a, b] = devices as [(typeof devices)[0], (typeof devices)[0]];
    const folder = new MemoryTarget();

    const s = await createGraph("Billing service", a.opts);
    await s.expand(ROOT_NODE_ID, { allowClarify: false });
    await waitFor(async () => expect(await a.storage.listAiCalls(s.graphId)).toHaveLength(1));
    let ha = (await syncWith(folder, a.store, {})).hashes;
    expect(JSON.parse(folder.files.logs.get(s.graphId)!)).toHaveLength(1);

    // B picks the brainstorm and its log up, adds a call of its own, and both end with both calls.
    const hb = (await syncWith(folder, b.store, {})).hashes;
    const first = (await b.storage.listAiCalls(s.graphId))[0]!;
    await b.storage.appendAiCalls([{ ...first, id: "from-b", at: new Date(Date.parse(first.at) + 1000).toISOString() }]);
    await syncWith(folder, b.store, hb);
    ha = (await syncWith(folder, a.store, ha)).hashes;
    expect((await a.storage.listAiCalls(s.graphId)).map((c) => c.id)).toEqual([first.id, "from-b"]);

    // Deleting the brainstorm deletes its log here and in the folder.
    await a.storage.deleteGraph(s.graphId);
    expect(await a.storage.listAiCalls(s.graphId)).toEqual([]);
    await syncWith(folder, a.store, ha, [s.graphId]);
    expect(folder.files.logs.has(s.graphId)).toBe(false);
    await syncWith(folder, b.store, hb);
    expect(await b.storage.listAiCalls(s.graphId)).toEqual([]);
  });
});
