import { useEffect, useRef, useState } from "react";
import type { AiCall, Purpose } from "@ravingupta/tinefold-engine";
import { useAiCalls } from "../app/sessions";
import { Button, Tag, download } from "../app/ui";

const PURPOSES: Record<Purpose, string> = {
  "expand-problem": "Options",
  "expand-solution": "Breakdown",
  regenerate: "Regenerate",
  staleCheck: "Stale check",
  rewrite: "Problem rewrite",
  summarize: "Condense",
  document: "Document",
};

/** The nerd panel: every request sent to the AI for this brainstorm or project, and what came back. */
export function AiLogPanel({ owner, onClose }: { owner: string; onClose: () => void }) {
  const calls = useAiCalls(owner);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = calls?.find((c) => c.id === selectedId) ?? calls?.[0] ?? null;
  const totals = (calls ?? []).reduce((t, c) => ({ in: t.in + c.tokens.in, out: t.out + c.tokens.out }), { in: 0, out: 0 });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/25" role="dialog" aria-modal="true" aria-labelledby="ailog-h" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[1180px] flex-col overflow-hidden bg-ground shadow-2xl md:flex-row">
        <div className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-line md:max-h-none md:w-[320px] md:border-b-0 md:border-r">
          <div className="p-5 pb-3">
            <div className="flex items-center justify-between">
              <h2 id="ailog-h" className="text-[18px] font-bold">AI log</h2>
              <button ref={closeRef} type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-black/5 hover:text-ink">
                Close
              </button>
            </div>
            <p className="mt-1 text-[13px] text-ink-2">Every request sent to the AI and the raw reply, kept on this device and in your sync folder.</p>
            {calls && calls.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                <span>
                  {calls.length} {calls.length === 1 ? "call" : "calls"} · {totals.in.toLocaleString()} in · {totals.out.toLocaleString()} out
                </span>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => download(`tinefold-ai-log-${owner}.json`, JSON.stringify([...calls].reverse(), null, 2), "application/json")}>
                  Download
                </Button>
              </div>
            )}
          </div>
          <ol className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            {calls === null && <li className="thinking px-2 text-[13px] text-ink-2">Loading…</li>}
            {calls?.length === 0 && <li className="px-2 text-[13px] text-ink-3">No AI calls yet. Ask for options and they show up here.</li>}
            {calls?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-current={selected?.id === c.id}
                  className={`block w-full rounded-md px-3 py-2 text-left ${selected?.id === c.id ? "bg-paper ring-1 ring-cobalt" : "hover:bg-paper/70"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{PURPOSES[c.purpose] ?? c.purpose}</span>
                    {!c.ok && <Tag tone="brick">failed</Tag>}
                    <span className="flex-1" />
                    <span className="text-[12px] text-ink-3">{time(c.at)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-ink-2">
                    {c.providerId} · {c.model} · {c.tokens.in.toLocaleString()} → {c.tokens.out.toLocaleString()} tokens · {seconds(c.ms)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-5">{selected ? <CallDetail call={selected} /> : null}</div>
      </div>
    </div>
  );
}

function CallDetail({ call }: { call: AiCall }) {
  const reply = call.json !== undefined ? JSON.stringify(call.json, null, 2) : call.text;
  return (
    <article aria-label="AI call">
      <h3 className="text-[16px] font-bold">{PURPOSES[call.purpose] ?? call.purpose}</h3>
      <p className="mt-0.5 text-[13px] text-ink-2">
        {new Date(call.at).toLocaleString()} · {call.providerId} · {call.model} · max {call.maxTokens.toLocaleString()} output tokens · {seconds(call.ms)}
      </p>
      {call.error && (
        <p role="alert" className="mt-3 rounded-md bg-brick-soft px-3 py-2 text-[13px] text-brick">
          {call.error.code ? `${call.error.code}: ` : ""}
          {call.error.message}
        </p>
      )}
      <Block title="System prompt" text={call.system} />
      <Block title="User prompt" text={call.user} note={`~${Math.ceil(call.user.length / 4).toLocaleString()} tokens`} />
      {call.schema && <Block title={`Output schema (${call.schema.name})`} text={JSON.stringify(call.schema.json, null, 2)} folded />}
      {reply !== undefined && <Block title={call.json !== undefined ? "Reply (JSON)" : "Reply"} text={reply} note={`${call.tokens.out.toLocaleString()} tokens`} />}
      {call.json !== undefined && call.text && <Block title="Reply text alongside the JSON" text={call.text} folded />}
    </article>
  );
}

function Block({ title, text, note, folded }: { title: string; text: string; note?: string; folded?: boolean }) {
  const [open, setOpen] = useState(!folded);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-[13px] font-semibold text-ink hover:text-cobalt">
          {open ? "▾" : "▸"} {title}
        </button>
        {note && <span className="text-[12px] text-ink-3">{note}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      {open && (
        <pre className="mt-1.5 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink">
          {text}
        </pre>
      )}
    </section>
  );
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
