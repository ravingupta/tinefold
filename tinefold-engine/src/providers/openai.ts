import { EngineError } from "../schema/errors";
import { postJson } from "./http";
import type { CompletionRequest, CompletionResult, Provider } from "./types";

export interface OpenAIOptions {
  apiKey: string;
  /** Any OpenAI-compatible endpoint (OpenRouter, a local server with CORS, ...). */
  baseUrl?: string;
}

/**
 * OpenAI chat completions in JSON mode. Uses the prompted-schema fallback path
 * (structuredOutput: false) so it also works with OpenAI-compatible servers.
 */
export class OpenAIProvider implements Provider {
  readonly id = "openai";
  readonly label = "OpenAI-compatible";
  readonly capabilities = { structuredOutput: false, tokenizer: false };
  constructor(private readonly opts: OpenAIOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.opts.apiKey) throw new EngineError("ProviderFailed", "OpenAI API key is not set", { providerId: this.id });
    const wantsJson = /JSON Schema/.test(req.user);
    const data = await postJson(
      `${this.opts.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
      { authorization: `Bearer ${this.opts.apiKey}` },
      {
        model: req.model,
        max_completion_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        ...(wantsJson ? { response_format: { type: "json_object" } } : {}),
      },
      this.id,
      req.signal,
    );
    return {
      text: data?.choices?.[0]?.message?.content ?? "",
      tokens: { in: data?.usage?.prompt_tokens ?? 0, out: data?.usage?.completion_tokens ?? 0 },
    };
  }
}
