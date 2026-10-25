import { useEffect, useRef, useState } from "react";
import { hasExample, importEvents, newGraph, openExample, useGraphList, useProjects, useSettings } from "../app/sessions";
import { go, href } from "../app/route";
import { Button, relativeTime } from "../app/ui";
import { toUiError } from "../app/errors";
import { isDemo } from "../settings/settings";

export function HomePage() {
  const graphs = useGraphList();
  const projectList = useProjects() ?? [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "tinefold";
  }, []);

  const start = async () => {
    if (!text.trim()) return;
    setBusy("start");
    try {
      go({ name: "graph", id: await newGraph(text) });
    } catch (e) {
      setError(toUiError(e).message);
      setBusy(null);
    }
  };

  const load = async (events: unknown[], label: string) => {
    setBusy(label);
    setError(null);
    try {
      go({ name: "graph", id: await importEvents(events) });
    } catch (e) {
      setError(`That file isn't a tinefold export. ${toUiError(e).message}`);
      setBusy(null);
    }
  };

  const example = async () => {
    setBusy("example");
    setError(null);
    try {
      go({ name: "graph", id: await openExample() });
    } catch (e) {
      setError(toUiError(e).message);
      setBusy(null);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data)) throw new Error("not a list of events");
      await load(data, "import");
    } catch {
      setError("That file isn't a tinefold export. Exports are .json files made with the Export button.");
    }
  };

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
      <label htmlFor="problem" className="block max-w-[22ch] text-[clamp(2rem,4.4vw,3.1rem)] font-bold leading-[1.04] tracking-[-0.025em]">
        What problem are you working through?
      </label>
      <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
        Describe it in a few sentences. You'll get a handful of approaches, choose one, and break it down until every part is decided. Then write it up as whatever document you need.
      </p>
      <textarea
        id="problem"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void start()}
        rows={5}
        placeholder="We need search for our e-commerce catalog: about 2M products, updated hourly. We already run Elasticsearch for logs, and the team is four backend engineers."
        className="mt-6 w-full rounded-lg border border-line-2 bg-paper px-4 py-3 text-[17px] leading-snug placeholder:text-ink-3"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!text.trim()} busy={busy === "start"} onClick={start}>
          Start brainstorming
        </Button>
        {isDemo(settings) && (
          <span className="text-[13px] text-ink-2">
            Demo mode: answers are placeholders.{" "}
            <button type="button" className="text-cobalt underline-offset-2 hover:underline" onClick={() => go({ name: "settings" })}>
              Add an API key
            </button>{" "}
            for real ones.
          </span>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-[14px] text-brick">{error}</p>}

      <section className="mt-16" aria-labelledby="list-h">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="list-h" className="text-[18px] font-bold">Your brainstorms</h2>
          <span className="flex-1" />
          {graphs && !hasExample(graphs) && (
            <Button size="sm" variant="ghost" busy={busy === "example"} onClick={example}>
              Open the example
            </Button>
          )}
          <Button size="sm" variant="ghost" busy={busy === "import"} onClick={() => fileRef.current?.click()}>
            Import a file
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {graphs === null ? null : graphs.length === 0 ? (
          <p className="mt-3 max-w-[60ch] text-[14px] text-ink-2">
            None yet. Start one above, or open the example: the session that designed this tool, with a root rewrite and reused branches.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {graphs.map((g) => (
              <li key={g.id}>
                <div className="flex gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <a href={href({ name: "graph", id: g.id })} className="block truncate text-[15px] font-semibold leading-snug hover:text-cobalt">{g.title}</a>
                    {g.statement && <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-2" title={g.statement}>{g.statement}</p>}
                    {projectList.some((p) => p.graphIds.includes(g.id)) && (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {projectList.filter((p) => p.graphIds.includes(g.id)).map((p) => (
                          <a key={p.id} href={href({ name: "project", id: p.id })} className="rounded border border-line-2 px-1.5 text-[12px] text-ink-2 hover:border-cobalt hover:text-cobalt">
                            {p.name}
                          </a>
                        ))}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 pt-0.5 text-[13px] text-ink-3">{relativeTime(g.updatedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {graphs && graphs.length > 1 && (
          <p className="mt-4 text-[13px] text-ink-2">
            Several brainstorms belong together?{" "}
            <a href={href({ name: "projects" })} className="text-cobalt hover:underline">Combine them in a project</a> for one overview and joint documents.
          </p>
        )}
        <p className="mt-4 text-[13px] text-ink-3">Everything is stored in this browser only. Export a brainstorm to keep a copy or move it to another machine.</p>
      </section>
    </div>
  );
}
