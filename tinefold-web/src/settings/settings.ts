import {
  AnthropicProvider,
  MockProvider,
  OpenAIProvider,
  STAGES,
  type Provider,
  type ProviderRegistry,
  type Stage,
} from "@ravingupta/tinefold-engine";

export type ProviderId = "anthropic" | "openai" | "mock";

export interface Settings {
  anthropicKey: string;
  openaiKey: string;
  openaiBaseUrl: string;
  defaultProvider: ProviderId;
  defaultModel: string;
  overrides: Partial<Record<Stage, { providerId: ProviderId; model: string }>>;
}

export const STAGE_LABELS: Record<Stage, { label: string; hint: string }> = {
  expand: { label: "Options and breakdowns", hint: "The main thinking. Use your strongest model." },
  staleCheck: { label: "Staleness checks", hint: "Short yes/no calls. A small, cheap model is enough." },
  summarize: { label: "Summaries and rewrites", hint: "Condensing context and folding comments into the problem." },
  document: { label: "Documents", hint: "Long-form writing at the end." },
};

export const SUGGESTED_MODELS: Record<ProviderId, string[]> = {
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-haiku-5-5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
  mock: ["demo"],
};

export const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-5-5": "Claude Sonnet 5.5 · balanced",
  "claude-opus-5-5": "Claude Opus 5.5 · strongest",
  "claude-fable-5-1": "Claude Fable 5.1 · most capable",
  "claude-haiku-5-5": "Claude Haiku 5.5 · fast, cheap",
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 mini · cheaper",
  "gpt-5-nano": "GPT-5 nano · cheapest",
  demo: "Demo",
};

export function keyFor(s: Settings, id: ProviderId): string | null {
  if (id === "anthropic") return s.anthropicKey;
  if (id === "openai") return s.openaiKey;
  return null;
}

const KEY = "tinefold.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  anthropicKey: "",
  openaiKey: "",
  openaiBaseUrl: "",
  defaultProvider: "mock",
  defaultModel: "demo",
  overrides: {},
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: settings live for this tab only.
  }
}

export function buildProviders(s: Settings): Provider[] {
  return [
    new MockProvider({ id: "mock", delayMs: 450 }),
    new AnthropicProvider({ apiKey: s.anthropicKey, browser: true }),
    new OpenAIProvider({ apiKey: s.openaiKey, baseUrl: s.openaiBaseUrl || undefined }),
  ];
}

export function buildRegistry(s: Settings): ProviderRegistry {
  const overrides: ProviderRegistry["overrides"] = {};
  for (const stage of STAGES) {
    const o = s.overrides[stage];
    if (o && o.model.trim()) overrides[stage] = { providerId: o.providerId, model: o.model.trim() };
  }
  return { default: { providerId: s.defaultProvider, model: s.defaultModel.trim() || "demo" }, overrides };
}

export function isDemo(s: Settings): boolean {
  return s.defaultProvider === "mock";
}
