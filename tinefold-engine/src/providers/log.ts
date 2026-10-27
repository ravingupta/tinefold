import { isEngineError } from "../schema/errors";
import { ulid } from "../session/ids";
import type { CompletionRequest, Provider, Purpose } from "./types";

/** One provider call exactly as sent and as answered. Retries are separate calls. */
export interface AiCall {
  id: string;
  /** ISO time the request was sent. */
  at: string;
  /** What the call belongs to: a brainstorm, or a project (with the brainstorms it covered). */
  scope: { graphId?: string; projectId?: string; graphIds?: string[] };
  purpose: Purpose;
  providerId: string;
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  /** The JSON Schema the provider was asked to enforce natively. Absent for free text, or when it went in the prompt. */
  schema?: { name: string; description: string; json: Record<string, unknown> };
  ok: boolean;
  text?: string;
  json?: unknown;
  error?: { code?: string; message: string };
  tokens: { in: number; out: number };
  ms: number;
}

export type AiCallSink = (call: AiCall) => void;

/**
 * Wrap a provider so every completion is reported to `sink`, success or failure.
 * A sink that throws never fails the call.
 */
export function loggedProvider(
  provider: Provider,
  sink: AiCallSink,
  scope: AiCall["scope"],
  clock: { now?: () => string; newId?: () => string } = {},
): Provider {
  const now = clock.now ?? (() => new Date().toISOString());
  const newId = clock.newId ?? (() => ulid());
  const report = (call: AiCall) => {
    try {
      sink(call);
    } catch {
      // Logging is best effort.
    }
  };
  return {
    id: provider.id,
    label: provider.label,
    capabilities: provider.capabilities,
    countTokens: provider.countTokens?.bind(provider),
    async complete(req: CompletionRequest) {
      const base = {
        id: newId(),
        at: now(),
        scope,
        purpose: req.purpose,
        providerId: provider.id,
        model: req.model,
        maxTokens: req.maxTokens,
        system: req.system,
        user: req.user,
        schema: req.schema,
      };
      const t0 = Date.now();
      try {
        const res = await provider.complete(req);
        report({ ...base, ok: true, text: res.text || undefined, json: res.json, tokens: res.tokens, ms: Date.now() - t0 });
        return res;
      } catch (e) {
        const error = { code: isEngineError(e) ? e.code : undefined, message: e instanceof Error ? e.message : String(e) };
        report({ ...base, ok: false, error, tokens: { in: 0, out: 0 }, ms: Date.now() - t0 });
        throw e;
      }
    },
  };
}
