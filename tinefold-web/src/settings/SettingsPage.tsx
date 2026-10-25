import { useEffect, useState } from "react";
import { STAGES, type Stage } from "@ravingupta/tinefold-engine";
import { getSettings, updateSettings } from "../app/sessions";
import { Button } from "../app/ui";
import { STAGE_LABELS, SUGGESTED_MODELS, type ProviderId, type Settings } from "./settings";

const PROVIDERS: { id: ProviderId; label: string; hint: string }[] = [
  { id: "mock", label: "Demo", hint: "No key, no cost. Placeholder answers so you can try the flow." },
  { id: "anthropic", label: "Anthropic", hint: "Claude models, called straight from your browser with your key." },
  { id: "openai", label: "OpenAI-compatible", hint: "OpenAI, or any server that speaks its API (set a base URL)." },
];

export function SettingsPage() {
  const [s, setS] = useState<Settings>(getSettings());
  const [saved, setSaved] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  useEffect(() => {
    document.title = "Settings · tinefold";
  }, []);

  const set = (patch: Partial<Settings>) => {
    setS((x) => ({ ...x, ...patch }));
    setSaved(false);
  };
  const pickDefault = (id: ProviderId) => set({ defaultProvider: id, defaultModel: SUGGESTED_MODELS[id][0]! });
  const setOverride = (stage: Stage, providerId: ProviderId | "", model?: string) => {
    const overrides = { ...s.overrides };
    if (!providerId) delete overrides[stage];
    else overrides[stage] = { providerId, model: model ?? overrides[stage]?.model ?? SUGGESTED_MODELS[providerId][0]! };
    set({ overrides });
  };
  const save = () => {
    updateSettings(s);
    setSaved(true);
  };
  const needsKey = (id: ProviderId) => (id === "anthropic" && !s.anthropicKey) || (id === "openai" && !s.openaiKey);

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-24 pt-10 sm:px-6">
      <h1 className="text-[28px] font-bold tracking-[-0.015em]">Settings</h1>

      <section className="mt-8" aria-labelledby="model-h">
        <h2 id="model-h" className="text-[17px] font-semibold">Which model thinks for you</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Default provider">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={s.defaultProvider === p.id}
              onClick={() => pickDefault(p.id)}
              className={`rounded-lg border bg-paper px-3 py-2.5 text-left ${s.defaultProvider === p.id ? "border-cobalt ring-1 ring-cobalt" : "border-line-2 hover:border-ink-3"}`}
            >
              <span className="block text-[14px] font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-2">{p.hint}</span>
            </button>
          ))}
        </div>
        {s.defaultProvider !== "mock" && (
          <label className="mt-3 block">
            <span className="text-[13px] font-medium">Model</span>
            <input
              list="models-default"
              value={s.defaultModel}
              onChange={(e) => set({ defaultModel: e.target.value })}
              className="mt-1 w-full max-w-[360px] rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-[14px]"
            />
            <datalist id="models-default">
              {SUGGESTED_MODELS[s.defaultProvider].map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>
        )}
        {needsKey(s.defaultProvider) && <p className="mt-2 text-[13px] text-amber">Add a key below, or every call will fail.</p>}
      </section>

      <section className="mt-10" aria-labelledby="keys-h">
        <div className="flex items-baseline gap-3">
          <h2 id="keys-h" className="text-[17px] font-semibold">API keys</h2>
          <button type="button" className="text-[13px] text-cobalt hover:underline" onClick={() => setShowKeys((v) => !v)}>
            {showKeys ? "Hide" : "Show"} keys
          </button>
        </div>
        <p className="mt-1 max-w-[62ch] text-[13px] text-ink-2">
          Keys stay in this browser's local storage and go only to the provider they belong to. Anyone with access to this browser profile can read them, so use a key with a spending limit.
        </p>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-[13px] font-medium">Anthropic API key</span>
            <input type={showKeys ? "text" : "password"} autoComplete="off" value={s.anthropicKey} onChange={(e) => set({ anthropicKey: e.target.value.trim() })} placeholder="sk-ant-…" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 font-[ui-monospace,monospace] text-[13px]" />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium">OpenAI-compatible API key</span>
            <input type={showKeys ? "text" : "password"} autoComplete="off" value={s.openaiKey} onChange={(e) => set({ openaiKey: e.target.value.trim() })} placeholder="sk-…" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 font-[ui-monospace,monospace] text-[13px]" />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium">OpenAI-compatible base URL (optional)</span>
            <input value={s.openaiBaseUrl} onChange={(e) => set({ openaiBaseUrl: e.target.value.trim() })} placeholder="https://api.openai.com/v1" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-[13px]" />
          </label>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="stages-h">
        <h2 id="stages-h" className="text-[17px] font-semibold">Different models for different steps</h2>
        <p className="mt-1 max-w-[62ch] text-[13px] text-ink-2">Optional. Cheap models are fine for quick checks; keep the strong one for options and documents.</p>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {STAGES.map((stage) => {
            const o = s.overrides[stage];
            return (
              <div key={stage} className="grid gap-2 py-3 sm:grid-cols-[1fr_170px_200px] sm:items-center">
                <div>
                  <p className="text-[14px] font-medium">{STAGE_LABELS[stage].label}</p>
                  <p className="text-[12px] text-ink-2">{STAGE_LABELS[stage].hint}</p>
                </div>
                <select
                  value={o?.providerId ?? ""}
                  onChange={(e) => setOverride(stage, e.target.value as ProviderId | "")}
                  className="rounded-md border border-line-2 bg-paper px-2 py-1.5 text-[13px]"
                  aria-label={`${STAGE_LABELS[stage].label}: provider`}
                >
                  <option value="">Same as above</option>
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {o ? (
                  <>
                    <input
                      list={`models-${stage}`}
                      value={o.model}
                      onChange={(e) => setOverride(stage, o.providerId, e.target.value)}
                      className="rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-[13px]"
                      aria-label={`${STAGE_LABELS[stage].label}: model`}
                    />
                    <datalist id={`models-${stage}`}>
                      {SUGGESTED_MODELS[o.providerId].map((m) => <option key={m} value={m} />)}
                    </datalist>
                  </>
                ) : (
                  <span className="text-[13px] text-ink-3">{s.defaultModel}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-8 flex items-center gap-3 bg-ground/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button variant="primary" onClick={save}>Save settings</Button>
        {saved && <span role="status" className="text-[13px] text-ink-2">Settings saved. Open brainstorms use them right away.</span>}
      </div>
    </div>
  );
}
