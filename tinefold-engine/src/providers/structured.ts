import type { ZodType } from "zod";
import { EngineError } from "../schema/errors";
import type { CompletionRequest, Provider } from "./types";

/** Pull the first balanced JSON object out of free text. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1]! : text;
  const start = src.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in reply");
}

/**
 * Call a provider for structured output and validate it. Native enforcement when
 * the provider has it, else the schema goes in the prompt. Either way the result is
 * validated with Zod and retried once with the validation error appended.
 */
export async function callStructured<T>(
  provider: Provider,
  req: CompletionRequest & { schema: NonNullable<CompletionRequest["schema"]> },
  zod: ZodType<T>,
  check?: (value: T) => string | null,
): Promise<{ value: T; tokens: { in: number; out: number } }> {
  let lastError = "";
  const tokens = { in: 0, out: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastError
      ? `\n\nYour previous reply was invalid: ${lastError}\nReturn corrected JSON only.`
      : "";
    const native = provider.capabilities.structuredOutput;
    const user = native
      ? req.user + retryNote
      : `${req.user}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(req.schema.json)}${retryNote}`;
    let res;
    try {
      res = await provider.complete({ ...req, user, schema: native ? req.schema : undefined });
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError("ProviderFailed", e instanceof Error ? e.message : String(e), { providerId: provider.id });
    }
    tokens.in += res.tokens.in;
    tokens.out += res.tokens.out;
    let raw: unknown;
    try {
      raw = res.json !== undefined ? res.json : extractJson(res.text ?? "");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    const parsed = zod.safeParse(raw);
    if (!parsed.success) {
      lastError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      continue;
    }
    const problem = check?.(parsed.data) ?? null;
    if (problem) {
      lastError = problem;
      continue;
    }
    return { value: parsed.data, tokens };
  }
  throw new EngineError("ValidationFailed", `provider output failed validation twice: ${lastError}`, { providerId: provider.id });
}
