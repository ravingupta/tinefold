export type Stage = "expand" | "staleCheck" | "summarize" | "document";
export const STAGES: readonly Stage[] = ["expand", "staleCheck", "summarize", "document"];

/** What the request is for. Lets MockProvider answer sensibly; real providers ignore it. */
export type Purpose =
  | "expand-problem"
  | "expand-solution"
  | "regenerate"
  | "staleCheck"
  | "rewrite"
  | "summarize"
  | "document";

export interface CompletionRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  purpose: Purpose;
  /** When set, the provider should return JSON matching this schema. */
  schema?: { name: string; description: string; json: Record<string, unknown> };
  signal?: AbortSignal;
}

export interface CompletionResult {
  text?: string;
  json?: unknown;
  tokens: { in: number; out: number };
}

export interface Provider {
  id: string;
  label: string;
  capabilities: { structuredOutput: boolean; tokenizer: boolean };
  complete(req: CompletionRequest): Promise<CompletionResult>;
  countTokens?(text: string): Promise<number>;
}

export interface ModelRef {
  providerId: string;
  model: string;
}

export interface ProviderRegistry {
  default: ModelRef;
  overrides: Partial<Record<Stage, ModelRef>>;
}

export function resolveStage(registry: ProviderRegistry, stage: Stage): ModelRef {
  return registry.overrides[stage] ?? registry.default;
}
