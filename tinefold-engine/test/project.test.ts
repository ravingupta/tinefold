import { describe, expect, it } from "vitest";
import {
  MemoryStorage,
  MockProvider,
  ProjectService,
  ROOT_NODE_ID,
  createGraph,
  importGraph,
  projectOverview,
  type ProviderRegistry,
} from "../src";
import designSessionEvents from "./fixtures/design-session.events.json";

const registry: ProviderRegistry = { default: { providerId: "mock", model: "m" }, overrides: {} };
const two = (a: string, b: string) => ({
  kind: "solutions",
  axis: "x",
  items: [
    { id: "a", title: a, summary: "s", pros: [], cons: [] },
    { id: "b", title: b, summary: "s", pros: [], cons: [] },
  ],
  assumptions: [],
});

async function setup() {
  let n = 0;
  const storage = new MemoryStorage();
  const mock = new MockProvider({ queue: [two("Postgres", "DynamoDB"), two("Postgres", "SQLite")] });
  const opts = { storage, providers: [mock], registry, newId: () => `id${++n}` };
  const projects = new ProjectService({ storage, newId: () => `p${++n}` });
  const billing = await createGraph("Billing service", opts);
  const search = await createGraph("Catalog search", opts);
  for (const s of [billing, search]) {
    await s.expand(ROOT_NODE_ID, { allowClarify: false });
    await s.selectSolution(ROOT_NODE_ID, s.select.tree().children[0]!.id);
  }
  return { storage, mock, opts, projects, billing, search };
}

describe("projects", () => {
  it("combine brainstorms without changing them; a brainstorm can sit in several projects", async () => {
    const { projects, billing, search } = await setup();
    const before = JSON.stringify(billing.getSnapshot());
    const shop = await projects.create({ name: "Shop rebuild", graphIds: [billing.graphId, search.graphId] });
    const pay = await projects.create({ name: "Payments", graphIds: [billing.graphId] });
    expect((await projects.forGraph(billing.graphId)).map((p) => p.name).sort()).toEqual(["Payments", "Shop rebuild"]);
    expect(JSON.stringify(billing.getSnapshot())).toBe(before);

    const moved = await projects.moveGraph(shop.id, search.graphId, -1);
    expect(moved.graphIds).toEqual([search.graphId, billing.graphId]);
    await projects.forgetGraph(billing.graphId);
    expect((await projects.get(pay.id)).graphIds).toEqual([]);
  });

  it("renders a high-level overview by code, with shared choices across brainstorms", async () => {
    const { projects, billing, search } = await setup();
    const p = await projects.create({ name: "Shop", graphIds: [billing.graphId, search.graphId, "gone"] });
    const o = projectOverview(p, [search.getSnapshot(), billing.getSnapshot()]);
    expect(o.parts.map((x) => x.statement)).toEqual(["Billing service", "Catalog search"]);
    expect(o.parts[0]!.decisions).toEqual([{ problem: "Approach", solution: "Postgres" }]);
    expect(o.missing).toEqual(["gone"]);
    expect(o.shared).toEqual([{ solution: "Postgres", graphIds: [billing.graphId, search.graphId] }]);
    expect(o.totals).toEqual({ decisions: 2, open: 0 });
  });

  it("writes one document across its brainstorms and caches it until any of them changes", async () => {
    const { projects, billing, search, mock, opts } = await setup();
    const p = await projects.create({ name: "Shop", description: "Billing feeds search ranking", graphIds: [billing.graphId, search.graphId] });
    const ai = { providers: opts.providers, registry };
    mock.enqueue("# Overview\n\nBody");
    const graphs = () => [billing.getSnapshot(), search.getSnapshot()];
    const doc = await projects.generateDocument(p.id, graphs(), { docType: "overview" }, ai);
    expect(doc.cached).toBe(false);
    const call = mock.calls.at(-1)!;
    expect(call.user).toContain("# Brainstorm 1 of 2");
    expect(call.user).toContain("Billing feeds search ranking");
    expect(call.user).toContain("[CHOSEN] Postgres");
    expect(call.user).toContain("ONE integrated document");
    expect(call.system).toContain("Project overview");
    expect((await projects.generateDocument(p.id, graphs(), { docType: "overview" }, ai)).cached).toBe(true);
    await search.addComment("must support typos");
    mock.enqueue("# Overview v2");
    expect((await projects.generateDocument(p.id, graphs(), { docType: "overview" }, ai)).cached).toBe(false);
    expect(Object.keys((await projects.get(p.id)).documents)).toHaveLength(2);
  });

  it("refuses empty projects and works with the example graph", async () => {
    const { projects, opts } = await setup();
    const empty = await projects.create({ name: "Empty" });
    await expect(projects.generateDocument(empty.id, [], { docType: "prd" }, { providers: opts.providers, registry })).rejects.toMatchObject({ code: "ValidationFailed" });
    await expect(projects.create({ name: "  " })).rejects.toMatchObject({ code: "ValidationFailed" });
    const ex = await importGraph(designSessionEvents, opts);
    const p = await projects.create({ name: "tinefold", graphIds: [ex.graphId] });
    const o = projectOverview(p, [ex.getSnapshot()]);
    expect(o.parts[0]!.decisions).toHaveLength(4);
    expect(o.parts[0]!.open).toEqual(["staleness", "canvas UI", "PRD generation", "provider registry"]);
  });
});
