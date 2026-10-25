import { z } from "zod";

export const EngineErrorCode = z.enum([
  "ValidationFailed",
  "ProviderFailed",
  "ContextTooLarge",
  "SeqConflict",
  "InvalidSelection",
]);
export type EngineErrorCode = z.infer<typeof EngineErrorCode>;

/** Serialisable form of an EngineError. Clients switch on code, never parse message. */
export const EngineErrorShape = z.object({
  code: EngineErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
});
export type EngineErrorShape = z.infer<typeof EngineErrorShape>;

export class EngineError extends Error {
  override readonly name = "EngineError";
  readonly code: EngineErrorCode;
  readonly details: unknown;

  constructor(code: EngineErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }

  toJSON(): EngineErrorShape {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function isEngineError(e: unknown): e is EngineError {
  return e instanceof EngineError;
}
