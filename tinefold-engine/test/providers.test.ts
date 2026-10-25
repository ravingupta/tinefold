import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider, OpenAIProvider, MemoryStorage, ROOT_NODE_ID, createGraph, extractJson } from "../src";

afterEach(() => vi.unstubAllGlobals());

const solutions = {
  kind: "solutions",
  axis: "cost",
  items: [
    { id: "a", title: "A", summary: "a", pros: [], cons: [] },
    { id: "b", title: "B", summary: "b", pros: [], cons: [] },
  ],
  recommendedId: "a",
  assumptions: [],
};

describe("AnthropicProvider", () => {
  it("sends a forced tool call with browser header and reads tool_use input", async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "tool_use", name: "emit_expansion", input: solutions }], usage: { input_tokens: 120, output_tokens: 40 } }),
      _body: init.body,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await createGraph("Pick a database", {
      storage: new MemoryStorage(),
      providers: [new AnthropicProvider({ apiKey: "k", browser: true })],
      registry: { default: { providerId: "anthropic", model: "claude-sonnet-5-5" }, overrides: {} },
    });
    const exp = await s.expand(ROOT_NODE_ID);
    expect(exp.kind).toBe("solutions");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_expansion" });
    expect(body.tools[0].input_schema.required).toContain("kind");
    expect(s.getSnapshot().nodeVersions[s.select.tree().children[0]!.versionId]!.tokens).toEqual({ in: 120, out: 40 });
  });

  it("turns HTTP errors into ProviderFailed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "invalid x-api-key" } }) })));
    const p = new AnthropicProvider({ apiKey: "bad" });
    await expect(p.complete({ system: "s", user: "u", model: "m", maxTokens: 10, purpose: "document" })).rejects.toMatchObject({
      code: "ProviderFailed",
      message: "anthropic returned 401: invalid x-api-key",
    });
  });
});

describe("OpenAIProvider (prompted-schema path)", () => {
  it("puts the schema in the prompt, asks for JSON mode, and parses the reply", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "Here:\n```json\n" + JSON.stringify(solutions) + "\n```" } }], usage: { prompt_tokens: 5, completion_tokens: 6 } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await createGraph("Pick a queue", {
      storage: new MemoryStorage(),
      providers: [new OpenAIProvider({ apiKey: "k" })],
      registry: { default: { providerId: "openai", model: "gpt-5" }, overrides: {} },
    });
    await s.expand(ROOT_NODE_ID);
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("JSON Schema");
  });
});

describe("extractJson", () => {
  it("finds the first balanced object, ignoring braces in strings", () => {
    expect(extractJson('noise {"a": "}{", "b": {"c": 1}} tail')).toEqual({ a: "}{", b: { c: 1 } });
  });
});
