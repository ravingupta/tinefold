import { EngineError } from "../schema/errors";
import { postJson } from "./http";
import type { CompletionRequest, CompletionResult, Provider } from "./types";

export interface AnthropicOptions {
  apiKey: string;
  /** Set when calling straight from a browser: adds the direct-browser-access header. */
  browser?: boolean;
  baseUrl?: string;
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  readonly capabilities = { structuredOutput: true, tokenizer: false };
  constructor(private readonly opts: AnthropicOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.opts.apiKey) throw new EngineError("ProviderFailed", "Anthropic API key is not set", { providerId: this.id });
    const headers: Record<string, string> = {
      "x-api-key": this.opts.apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (this.opts.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    };
    if (req.schema) {
      // Current Claude models reject forced tool_choice ("tool"/"any"), so ask for the call
      // in the prompt instead. A plain-text JSON reply still works: callStructured extracts it.
      body.system = `${req.system}\n\nGive your answer by calling the \`${req.schema.name}\` tool exactly once. Do not answer in plain text.`;
      body.tools = [{ name: req.schema.name, description: req.schema.description, input_schema: req.schema.json }];
      body.tool_choice = { type: "auto", disable_parallel_tool_use: true };
    }
    const data = await postJson(`${this.opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, headers, body, this.id, req.signal);
    const tokens = { in: data?.usage?.input_tokens ?? 0, out: data?.usage?.output_tokens ?? 0 };
    const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
    const tool = blocks.find((b) => b.type === "tool_use");
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    return tool ? { json: tool.input, text, tokens } : { text, tokens };
  }
}
