import { useEffect, useState } from "react";
import { STAGES, type Stage } from "@ravingupta/tinefold-engine";
import { getSettings, updateSettings, useSettings } from "../app/sessions";
import { Button, Tag } from "../app/ui";
import { MODEL_LABELS, STAGE_LABELS, SUGGESTED_MODELS, keyFor, type ProviderId, type Settings } from "./settings";

const PROVIDERS: { id: ProviderId; label: string; hint: string }[] = [
  { id: "mock", label: "Demo", hint: "No key, no cost. Placeholder answers so you can try the flow." },
  { id: "anthropic", label: "Anthropic", hint: "Claude models, called straight from your browser with your key." },
  { id: "openai", label: "OpenAI-compatible", hint: "OpenAI, or any server that speaks its API (set a base URL)." },
];

const providerLabel = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.label ?? id;
const modelLabel = (m: string) => MODEL_LABELS[m] ?? m;
const keyTail = (k: string) => `…${k.slice(-4)}`;
const CUSTOM = "__custom";

export function SettingsPage() {
  const current = useSettings();
  const [s, setS] = useState<Settings>(getSettings());
  const [saved, setSaved] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(current);
  useEffect(() => {
    document.title = "Settings · tinefold";
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch: Partial<Settings>) => {
    setS((x) => ({ ...x, ...patch }));
    setSaved(false);
  };
  const pickDefault = (id: ProviderId) => set({ defaultProvider: id, defaultModel: SUGGESTED_MODELS[id][0]! });
  const setOverride = (stage: Stage, providerId: ProviderId | "", model?: string) => {
    const overrides = { ...s.overrides };
    if (!providerId) delete overrides[stage];
    else overrides[stage] = { providerId, model: model ?? (overrides[stage]?.providerId === providerId ? overrides[stage]!.model : SUGGESTED_MODELS[providerId][0]!) };
    set({ overrides });
  };
  const save = () => {
    updateSettings(s);
    setSaved(true);
  };
  const needsKey = (id: ProviderId) => keyFor(s, id) === "";

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-24 pt-10 sm:px-6">
      <h1 className="text-[28px] font-bold tracking-[-0.015em]">Settings</h1>

      <InUse settings={current} dirty={dirty} />

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
          <div className="mt-3">
            <label htmlFor="model-default" className="text-[13px] font-medium">Model</label>
            <ModelSelect
              key={s.defaultProvider}
              id="model-default"
              provider={s.defaultProvider}
              value={s.defaultModel}
              onChange={(m) => set({ defaultModel: m })}
              className="mt-1 max-w-[360px]"
            />
          </div>
        )}
        {needsKey(s.defaultProvider) && <p className="mt-2 text-[13px] text-amber">Add a {providerLabel(s.defaultProvider)} key below, or every call will fail.</p>}
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
          <KeyField
            label="Anthropic API key"
            placeholder="sk-ant-…"
            value={s.anthropicKey}
            savedValue={current.anthropicKey}
            show={showKeys}
            onChange={(v) => set({ anthropicKey: v })}
          />
          <KeyField
            label="OpenAI-compatible API key"
            placeholder="sk-…"
            value={s.openaiKey}
            savedValue={current.openaiKey}
            show={showKeys}
            onChange={(v) => set({ openaiKey: v })}
          />
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
              <div key={stage} className="grid gap-2 py-3 sm:grid-cols-[1fr_170px_220px] sm:items-center">
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
                  <ModelSelect
                    key={o.providerId}
                    provider={o.providerId}
                    value={o.model}
                    onChange={(m) => setOverride(stage, o.providerId, m)}
                    ariaLabel={`${STAGE_LABELS[stage].label}: model`}
                  />
                ) : (
                  <span className="text-[13px] text-ink-3">{s.defaultProvider === "mock" ? "Demo" : modelLabel(s.defaultModel)}</span>
                )}
                {o && needsKey(o.providerId) && <p className="text-[12px] text-amber sm:col-span-3">This step needs a {providerLabel(o.providerId)} key.</p>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-8 flex items-center gap-3 bg-ground/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button variant="primary" onClick={save} disabled={!dirty}>Save settings</Button>
        <span role="status" className="text-[13px] text-ink-2">
          {dirty ? <span className="text-amber">Unsaved changes. Leaving or refreshing now loses them.</span> : saved ? "Settings saved. Open brainstorms use them right away." : null}
        </span>
      </div>
    </div>
  );
}

/** What the app uses right now: always the saved settings, never the draft being edited below. */
function InUse({ settings: c, dirty }: { settings: Settings; dirty: boolean }) {
  const key = keyFor(c, c.defaultProvider);
  const overridden = STAGES.filter((st) => c.overrides[st]?.model.trim());
  return (
    <section aria-labelledby="inuse-h" className="mt-6 rounded-lg border border-line-2 bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="inuse-h" className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">In use now</h2>
        {dirty && <Tag tone="amber">You have unsaved changes</Tag>}
      </div>
      <p className="mt-1.5 text-[15px] font-semibold">
        {c.defaultProvider === "mock" ? "Demo mode: placeholder answers, no AI calls" : `${providerLabel(c.defaultProvider)} · ${modelLabel(c.defaultModel)}`}
      </p>
      {c.defaultProvider !== "mock" && MODEL_LABELS[c.defaultModel] && (
        <p className="font-[ui-monospace,monospace] text-[12px] text-ink-3">{c.defaultModel}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {key === null ? null : key ? (
          <Tag title="Stored in this browser's local storage">{providerLabel(c.defaultProvider)} key saved ({keyTail(key)})</Tag>
        ) : (
          <Tag tone="brick">No {providerLabel(c.defaultProvider)} key saved: calls will fail</Tag>
        )}
        {c.defaultProvider === "openai" && c.openaiBaseUrl && <Tag>Base URL: {c.openaiBaseUrl}</Tag>}
      </div>
      {overridden.length > 0 && (
        <ul className="mt-2.5 space-y-0.5 border-t border-line pt-2 text-[13px] text-ink-2">
          {overridden.map((st) => {
            const o = c.overrides[st]!;
            const k = keyFor(c, o.providerId);
            return (
              <li key={st}>
                {STAGE_LABELS[st].label}: <span className="text-ink">{providerLabel(o.providerId)} · {modelLabel(o.model)}</span>
                {k === "" && <span className="text-brick"> (no key)</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ModelSelect({
  provider,
  value,
  onChange,
  id,
  ariaLabel,
  className = "",
}: {
  provider: ProviderId;
  value: string;
  onChange: (model: string) => void;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const options = SUGGESTED_MODELS[provider];
  const [custom, setCustom] = useState(!options.includes(value));
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) setCustom(true);
          else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
        className="w-full rounded-md border border-line-2 bg-paper px-2 py-1.5 text-[13px]"
      >
        {options.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
        <option value={CUSTOM}>Other model ID…</option>
      </select>
      {custom && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="exact model ID, e.g. gpt-4.1"
          aria-label={`${ariaLabel ?? "Model"}: custom model ID`}
          className="w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 font-[ui-monospace,monospace] text-[13px]"
        />
      )}
    </div>
  );
}

function KeyField({
  label,
  placeholder,
  value,
  savedValue,
  show,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  savedValue: string;
  show: boolean;
  onChange: (v: string) => void;
}) {
  const changed = value !== savedValue;
  return (
    <div>
      <label className="block">
        <span className="text-[13px] font-medium">{label}</span>
        <input type={show ? "text" : "password"} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder} className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2.5 py-1.5 font-[ui-monospace,monospace] text-[13px]" />
      </label>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
        {changed ? (
          <span className="text-amber">{value ? "New key, not saved yet." : "Key will be removed when you save."}</span>
        ) : savedValue ? (
          <>
            <span>Saved in this browser · ends in {savedValue.slice(-4)}</span>
            <button type="button" className="text-brick hover:underline" onClick={() => onChange("")}>Remove</button>
          </>
        ) : (
          <span className="text-ink-3">No key saved.</span>
        )}
      </p>
    </div>
  );
}
