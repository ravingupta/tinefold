import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { DOC_TYPE_LABELS, type DocType } from "@ravingupta/tinefold-engine";
import { Button, download, relativeTime } from "../app/ui";
import { toUiError } from "../app/errors";
import { go } from "../app/route";

const DESCRIPTIONS: Record<DocType, string> = {
  prd: "What to build and why: goals, requirements, open questions.",
  trd: "How to build it: architecture, technical decisions, interfaces.",
  solution: "The chosen solution end to end, with the alternatives you rejected.",
  adr: "One decision record per choice you made.",
  brief: "One page someone can read in five minutes.",
  overview: "How the brainstorms fit together: dependencies, shared choices, conflicts, gaps.",
  custom: "Describe the document you need.",
};
/** What the panel needs from a saved document; brainstorm and project documents both fit. */
export interface DocLike {
  key: string;
  docType: DocType;
  markdown: string;
  createdAt: string;
}

export interface DocumentSource {
  /** Shown under the heading. */
  intro: string;
  types: DocType[];
  history: DocLike[];
  generate(req: { docType: DocType; instructions?: string; force?: boolean }): Promise<{ entry: DocLike; cached: boolean }>;
  busyLabel: string;
}

export function DocumentPanel({ source, onClose }: { source: DocumentSource; onClose: () => void }) {
  const ORDER = source.types;
  const [docType, setDocType] = useState<DocType>(ORDER[0]!);
  const [instructions, setInstructions] = useState("");
  const [current, setCurrent] = useState<DocLike | null>(null);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toUiError> | null>(null);
  const [copied, setCopied] = useState(false);
  const history = source.history;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const html = useMemo(() => (current ? DOMPurify.sanitize(marked.parse(current.markdown, { async: false }) as string) : ""), [current]);

  const generate = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await source.generate({ docType, instructions: instructions.trim() || undefined, force });
      setCurrent(res.entry);
      setCached(res.cached);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(current.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fileName = current ? `${(current.markdown.match(/^#\s+(.+)/m)?.[1] ?? DOC_TYPE_LABELS[current.docType]).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "document"}.md` : "";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/25" role="dialog" aria-modal="true" aria-labelledby="doc-h" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[980px] flex-col overflow-hidden bg-ground shadow-2xl md:flex-row">
        <div className="w-full shrink-0 overflow-y-auto border-b border-line p-5 md:w-[300px] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between">
            <h2 id="doc-h" className="text-[18px] font-bold">Write a document</h2>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-black/5 hover:text-ink">
              Close
            </button>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{source.intro}</p>
          <fieldset className="mt-4 space-y-1">
            <legend className="sr-only">Document type</legend>
            {ORDER.map((t) => (
              <label key={t} className={`block cursor-pointer rounded-md px-3 py-2 ${docType === t ? "bg-paper ring-1 ring-cobalt" : "hover:bg-paper/70"}`}>
                <input type="radio" name="doctype" value={t} checked={docType === t} onChange={() => setDocType(t)} className="sr-only" />
                <span className="block text-[14px] font-semibold">{DOC_TYPE_LABELS[t]}</span>
                <span className="block text-[12px] leading-snug text-ink-2">{DESCRIPTIONS[t]}</span>
              </label>
            ))}
          </fieldset>
          <label className="mt-3 block text-[13px] font-medium" htmlFor="doc-instr">
            {docType === "custom" ? "What should it be?" : "Extra instructions (optional)"}
          </label>
          <textarea
            id="doc-instr"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder={docType === "custom" ? "A migration plan for the ops team, with a rollback section" : "Audience is the platform team; keep it under two pages"}
            className="mt-1 w-full rounded-md border border-line-2 bg-paper px-2.5 py-2 text-[13px] placeholder:text-ink-3"
          />
          <Button variant="primary" className="mt-2 w-full justify-center" busy={busy} disabled={docType === "custom" && !instructions.trim()} onClick={() => generate(false)}>
            Write {DOC_TYPE_LABELS[docType].replace(/ \(.*\)/, "").toLowerCase()}
          </Button>
          {history.length > 0 && (
            <div className="mt-6">
              <h3 className="text-[13px] font-semibold">Written earlier</h3>
              <ul className="mt-1 space-y-0.5">
                {history.map((d) => (
                  <li key={d.key}>
                    <button type="button" onClick={() => { setCurrent(d); setCached(true); }} className={`w-full rounded px-2 py-1 text-left text-[13px] hover:bg-paper ${current?.key === d.key ? "bg-paper" : ""}`}>
                      {DOC_TYPE_LABELS[d.docType]} <span className="text-ink-3">· {relativeTime(d.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-paper p-6 md:p-8">
          {error && (
            <div className="mb-4 rounded-md bg-brick-soft px-3 py-2 text-[13px] text-brick">
              {error.message}
              {error.action === "settings" && (
                <button type="button" className="ml-2 underline" onClick={() => go({ name: "settings" })}>
                  Open settings
                </button>
              )}
            </div>
          )}
          {busy && !current && <p className="thinking text-ink-2">{source.busyLabel}</p>}
          {current ? (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-3">
                <span className="text-[13px] text-ink-2">
                  {DOC_TYPE_LABELS[current.docType]} · {cached ? `written ${relativeTime(current.createdAt)}, nothing has changed since` : "just written"}
                </span>
                <span className="flex-1" />
                <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy markdown"}</Button>
                <Button size="sm" onClick={() => download(fileName, current.markdown, "text/markdown")}>Download .md</Button>
                <Button size="sm" variant="ghost" busy={busy} onClick={() => generate(true)} title="Ask for a fresh draft even though nothing changed">
                  Rewrite
                </Button>
              </div>
              <article className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          ) : (
            !busy && (
              <div className="max-w-[52ch] pt-10 text-ink-2">
                <p className="text-[15px]">Pick the kind of document on the left. It's written from what you decided, so it never contradicts a choice, and anything still open stays marked as open.</p>
                <p className="mt-3 text-[13px]">Each document is saved with the graph. If nothing changes, asking again returns the saved copy instantly.</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
