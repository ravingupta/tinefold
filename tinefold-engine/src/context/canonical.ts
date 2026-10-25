import { EngineError } from "../schema/errors";

/**
 * Canonical JSON: object keys sorted, undefined members dropped, no whitespace.
 * Same value in, same bytes out; the basis of every hash and of the determinism test.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EngineError("ValidationFailed", "canonicalJson: non-finite number", { value });
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const members = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${members.join(",")}}`;
  }
  throw new EngineError("ValidationFailed", `canonicalJson: unsupported type ${typeof value}`);
}
