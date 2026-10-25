import { describe, expect, it } from "vitest";
import raw from "./fixtures/design-session.events.json";
import {
  EngineError,
  GraphEvent,
  MemoryStorage,
  MockProvider,
  ROOT_NODE_ID,
  createGraph,
  graphName,
  reduce,
  renderTree,
  replay,
  suggestName,
  type ProviderRegistry,
} from "../src";

const registry: ProviderRegistry = { default: { providerId: "mock", model: "m" }, overrides: {} };

function setup(queue: unknown[] = []) {
  let n = 0;
  let t = Date.parse("2026-10-25T10:00:00.000Z");
  const storage = new MemoryStorage();
  const mock = new MockProvider({ queue });
  const opts = {
    storage,
    providers: [mock],
    registry,
    newId: () => `id${String(++n).padStart(4, "0")}`,
    now: () => new Date((t += 1000)).toISOString(),
  };
  return { storage, mock, opts };
}

const solutions = (name?: string) => ({
  kind: "solutions",
  axis: "hosting",
  items: [
    { id: "a", title: "Static SPA", summary: "Browser only.", pros: [], cons: [] },
    { id: "b", title: "Thin server", summary: "Small API.", pros: [], cons: [] },
  ],
  assumptions: [],
  ...(name ? { name } : {}),
});

const STATEMENT = "We need search for a 2M-product catalog that ranks by margin and stock, with typo tolerance.";

describe("suggestName", () => {
  it.each([
    ["AI-driven brainstorming tool for IT/software problems, AND-OR graph, user controls selection", "AI-Driven Brainstorming Tool"],
    [STATEMENT, "Search 2M-Product Catalog"],
    ["How can we cut our AWS bill by half without slowing deploys?", "Cut AWS Bill"],
    ["Migrate the billing service from a monolith to event-driven microservices", "Migrate Billing Service"],
    ["   ", "Untitled brainstorm"],
  ])("%s → %s", (statement, name) => {
    expect(suggestName(statement)).toBe(name);
  });

  it("never exceeds four words or 60 characters", () => {
    const name = suggestName("Supercalifragilisticexpialidocious ".repeat(5));
    expect(name.split(" ").length).toBeLessThanOrEqual(4);
    expect(name.length).toBeLessThanOrEqual(60);
  });
});

describe("brainstorm names", () => {
  it("graphs from before names existed derive one from the statement", () => {
    const g = replay((raw as unknown[]).map((e) => GraphEvent.parse(e)));
    expect(g.name).toBeUndefined();
    expect(graphName(g)).toBe(suggestName(g.rootVersions.at(-1)!.statement));
  });

  it("a new graph is named from its statement; the tree root shows name over statement", async () => {
    const { opts, storage } = setup();
    const s = await createGraph(STATEMENT, opts);
    expect(s.name()).toBe("Search 2M-Product Catalog");
    expect(s.getSnapshot().nameSource).toBe("auto");
    const root = renderTree(s.getSnapshot());
    expect(root.title).toBe("Search 2M-Product Catalog");
    expect(root.summary).toBe(STATEMENT);
    expect((await storage.listGraphs())[0]).toMatchObject({ title: "Search 2M-Product Catalog", statement: STATEMENT });
  });

  it("a name given at creation is the user's", async () => {
    const { opts } = setup([solutions("Margin Aware Search")]);
    const s = await createGraph(STATEMENT, opts, { name: "  Shop search  " });
    expect(s.name()).toBe("Shop search");
    expect(s.getSnapshot().nameSource).toBe("user");
    await s.expand(ROOT_NODE_ID, { allowClarify: false });
    expect(s.name()).toBe("Shop search");
  });

  it("the first root expansion asks for a name and applies it while the name is automatic", async () => {
    const { opts, mock } = setup([solutions("Margin Aware Search")]);
    const s = await createGraph(STATEMENT, opts);
    await s.expand(ROOT_NODE_ID, { allowClarify: false });
    expect(mock.calls[0]!.user).toContain('Also set "name"');
    expect(s.name()).toBe("Margin Aware Search");
    expect(s.getSnapshot().nameSource).toBe("auto");
  });

  it("does not ask again once the root has options, and never overrides a rename", async () => {
    const { opts, mock } = setup([solutions()]);
    const s = await createGraph(STATEMENT, opts);
    await s.rename("Catalog search");
    await s.expand(ROOT_NODE_ID, { allowClarify: false });
    expect(mock.calls[0]!.user).not.toContain('Also set "name"');
    expect(s.name()).toBe("Catalog search");
    await expect(s.rename("   ")).rejects.toBeInstanceOf(EngineError);
  });

  it("the reducer refuses an automatic name over the user's", async () => {
    const { opts } = setup();
    const s = await createGraph(STATEMENT, opts);
    await s.rename("Mine");
    const g = s.getSnapshot();
    const e = GraphEvent.parse({ id: "x", graphId: g.id, seq: g.seq + 1, at: "2026-10-25T12:00:00.000Z", type: "GraphRenamed", payload: { name: "Theirs", source: "auto" } });
    expect(() => reduce(g, e)).toThrow(EngineError);
  });
});
