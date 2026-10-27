import { describe, expect, it } from "vitest";
import {
  EngineError,
  MemoryStorage,
  MockProvider,
  ProjectService,
  ROOT_NODE_ID,
  SYSTEM_PROMPT,
  createGraph,
  loggedProvider,
  type AiCall,
  type ProviderRegistry,
} from "../src";

const registry: ProviderRegistry = { default: { providerId: "mock", model: "m" }, overrides: {} };
const solutions = {
  kind: "solutions",
  axis: "hosting",
  items: [
    { id: "a", title: "Static SPA", summary: "Browser only.", pros: ["cheap"], cons: [] },
    { id: "b", title: "Thin server", summary: "Small API.", pros: [], cons: ["ops"] },
  ],
  recommendedId: "a",
  reason: "Simplest.",
  assumptions: [],
};

describe("AI call log", () => {
  it("reports every call a session makes, with the exact prompt and reply", async () => {
    const calls: AiCall[] = [];
    const mock = new MockProvider({ queue: [{ kind: "solutions", items: [], assumptions: [] }, solutions] });
    const s = await createGraph("Pick a host", { storage: new MemoryStorage(), providers: [mock], registry, onAiCall: (c) => calls.push(c) });
    await s.expand(ROOT_NODE_ID, { allowClarify: false });

    // The first reply fails validation, so the retry is a second logged call.
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(first!.scope).toEqual({ graphId: s.graphId });
    expect(first!.purpose).toBe("expand-problem");
    expect(first!.system).toBe(SYSTEM_PROMPT);
    expect(first!.user).toBe(mock.calls[0]!.user);
    expect(first!.user).toContain("## Root problem");
    expect(first!.schema?.name).toBe("emit_expansion");
    expect(second!.user).toContain("Your previous reply was invalid");
    expect(second!.json).toEqual(solutions);
    expect(second!.ok).toBe(true);
    expect(new Set(calls.map((c) => c.id)).size).toBe(2);
  });

  it("logs failures and never lets a broken sink fail the call", async () => {
    const calls: AiCall[] = [];
    const failing = new MockProvider({
      handler: () => {
        throw new EngineError("ProviderFailed", "rate limited");
      },
    });
    const p = loggedProvider(failing, (c) => calls.push(c), { graphId: "g" });
    await expect(p.complete({ system: "s", user: "u", model: "m", maxTokens: 10, purpose: "summarize" })).rejects.toThrow("rate limited");
    expect(calls[0]).toMatchObject({ ok: false, error: { code: "ProviderFailed", message: "rate limited" }, user: "u" });

    const ok = loggedProvider(new MockProvider({ handler: () => "fine" }), () => {
      throw new Error("disk full");
    }, {});
    expect((await ok.complete({ system: "s", user: "u", model: "m", maxTokens: 10, purpose: "summarize" })).text).toBe("fine");
  });

  it("reports project documents with the project and its brainstorms as scope", async () => {
    const storage = new MemoryStorage();
    const opts = { storage, providers: [new MockProvider({ queue: [solutions] })], registry };
    const g = await createGraph("Billing", opts);
    await g.expand(ROOT_NODE_ID, { allowClarify: false });
    const projects = new ProjectService({ storage });
    const p = await projects.create({ name: "Platform", graphIds: [g.graphId] });
    const calls: AiCall[] = [];
    await projects.generateDocument(p.id, [g.getSnapshot()], { docType: "brief" }, { ...opts, onAiCall: (c) => calls.push(c) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ purpose: "document", scope: { projectId: p.id, graphIds: [g.graphId] }, ok: true });
    expect(calls[0]!.text).toBeTruthy();
  });
});
