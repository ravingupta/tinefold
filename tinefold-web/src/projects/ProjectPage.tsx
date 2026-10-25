import { useEffect, useMemo, useState } from "react";
import { projectOverview, type Graph, type Project } from "@ravingupta/tinefold-engine";
import { aiOptions, newGraph, projects, useGraphList, useGraphs, useProjects } from "../app/sessions";
import { go, href } from "../app/route";
import { Button } from "../app/ui";
import { toUiError } from "../app/errors";
import { DocumentPanel, type DocumentSource } from "../documents/DocumentPanel";

export function ProjectPage({ projectId }: { projectId: string }) {
  const list = useProjects();
  if (!list) return <p className="thinking px-6 py-16 text-ink-2">Opening…</p>;
  const project = list.find((p) => p.id === projectId);
  if (!project) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <p className="text-[17px] font-semibold">This project doesn't exist any more.</p>
        <Button className="mt-4" onClick={() => go({ name: "projects" })}>All projects</Button>
      </div>
    );
  }
  return <Loaded project={project} />;
}

function Loaded({ project }: { project: Project }) {
  const graphs = useGraphs(project.graphIds);
  const [docOpen, setDocOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = `${project.name} · tinefold`;
  }, [project.name]);
  const overview = useMemo(() => (graphs ? projectOverview(project, graphs) : null), [project, graphs]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toUiError(e).message);
    }
  };

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-24 pt-6 sm:px-6">
      <Header project={project} onWrite={() => setDocOpen(true)} canWrite={(overview?.parts.length ?? 0) > 0} />
      {error && <p role="alert" className="mt-3 rounded-md bg-brick-soft px-3 py-2 text-[14px] text-brick">{error}</p>}

      {overview && overview.parts.length > 0 && (
        <p className="mt-6 text-[14px] text-ink-2">
          {overview.parts.length} {overview.parts.length === 1 ? "brainstorm" : "brainstorms"}, {overview.totals.decisions} decisions made, {overview.totals.open} still open.
        </p>
      )}
      {overview && overview.shared.length > 0 && (
        <div className="mt-3 rounded-lg border border-cobalt/30 bg-cobalt-soft/60 px-4 py-2.5 text-[14px]">
          <span className="font-semibold">Where they connect: </span>
          {overview.shared.map((s, i) => (
            <span key={s.solution}>
              {i > 0 && "; "}“{s.solution}” is chosen in {s.graphIds.length} brainstorms
            </span>
          ))}
          .
        </div>
      )}

      {graphs === null ? (
        <p className="thinking mt-8 text-ink-2">Loading brainstorms…</p>
      ) : (
        <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
          {overview!.parts.map((part, i) => (
            <article key={part.graphId} className="flex flex-col rounded-lg border border-line bg-paper p-4" aria-label={`Brainstorm ${i + 1}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <a href={href({ name: "graph", id: part.graphId })} className="block truncate text-[15px] font-semibold leading-snug hover:text-cobalt">
                    {part.name}
                  </a>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2" title={part.statement}>{part.statement}</p>
                </div>
              </div>
              {part.notStarted ? (
                <p className="mt-3 text-[13px] text-ink-3">No approach chosen yet.</p>
              ) : (
                <ol className="mt-3 space-y-1.5 border-l-[3px] border-cobalt pl-3">
                  {part.decisions.map((d, j) => (
                    <li key={j} className="text-[13px] leading-snug">
                      <span className="text-ink-3">{d.problem}: </span>
                      <span className="font-medium">{d.solution}</span>
                    </li>
                  ))}
                </ol>
              )}
              {part.open.length > 0 && (
                <p className="mt-3 text-[13px] text-amber">
                  Open: {part.open.slice(0, 4).join(", ")}
                  {part.open.length > 4 ? ` and ${part.open.length - 4} more` : ""}
                </p>
              )}
              <span className="flex-1" />
              <div className="mt-4 flex items-center gap-1 border-t border-line pt-2 text-[12px]">
                <a href={href({ name: "graph", id: part.graphId })} className="rounded px-1.5 py-0.5 font-medium text-cobalt hover:bg-cobalt-soft">
                  Open
                </a>
                <span className="flex-1" />
                <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => act(() => projects.moveGraph(project.id, part.graphId, -1))} className="rounded px-1.5 py-0.5 text-ink-3 hover:bg-black/5 disabled:opacity-30">
                  ←
                </button>
                <button type="button" aria-label="Move later" disabled={i === overview!.parts.length - 1} onClick={() => act(() => projects.moveGraph(project.id, part.graphId, 1))} className="rounded px-1.5 py-0.5 text-ink-3 hover:bg-black/5 disabled:opacity-30">
                  →
                </button>
                <button type="button" onClick={() => act(() => projects.removeGraph(project.id, part.graphId))} className="rounded px-1.5 py-0.5 text-ink-3 hover:bg-black/5 hover:text-brick">
                  Remove
                </button>
              </div>
            </article>
          ))}
          <AddBrainstorm project={project} onError={setError} />
        </div>
      )}
      {overview && overview.missing.length > 0 && (
        <p className="mt-4 text-[13px] text-ink-3">
          {overview.missing.length} brainstorm{overview.missing.length > 1 ? "s" : ""} listed here no longer exist{overview.missing.length > 1 ? "" : "s"}.{" "}
          <button type="button" className="text-cobalt hover:underline" onClick={() => act(async () => { for (const id of overview.missing) await projects.removeGraph(project.id, id); })}>
            Clean up
          </button>
        </p>
      )}
      {docOpen && graphs && <DocumentPanel source={projectDocSource(project, graphs)} onClose={() => setDocOpen(false)} />}
    </div>
  );
}

function Header({ project, onWrite, canWrite }: { project: Project; onWrite: () => void; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description);
  const [confirm, setConfirm] = useState(false);

  const save = async () => {
    await projects.update(project.id, { name, description: desc });
    setEditing(false);
  };

  return (
    <header>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <a href={href({ name: "projects" })} className="hover:text-ink">Projects</a>
        <span className="flex-1" />
        {!confirm ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Delete project</Button>
        ) : (
          <>
            <span className="text-brick">Delete the project? Its brainstorms are kept.</span>
            <Button size="sm" variant="danger" onClick={() => projects.delete(project.id).then(() => go({ name: "projects" }))}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
          </>
        )}
      </div>
      {!editing ? (
        <>
          <h1 className="mt-2 text-[clamp(1.6rem,2.6vw,2.35rem)] font-bold leading-[1.12] tracking-[-0.018em]">{project.name}</h1>
          <p className={`mt-2 max-w-[70ch] text-[15px] leading-relaxed ${project.description ? "text-ink-2" : "text-ink-3"}`}>
            {project.description || "Add a line on how these brainstorms relate. It's given to the model when writing project documents."}
          </p>
        </>
      ) : (
        <div className="mt-2 max-w-[760px] space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" className="w-full rounded-md border border-line-2 bg-paper px-3 py-1.5 text-[20px] font-bold" />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            aria-label="How these brainstorms relate"
            placeholder="Billing feeds the search ranking; both share the same Postgres cluster."
            className="w-full rounded-md border border-line-2 bg-paper px-3 py-2 text-[14px] placeholder:text-ink-3"
          />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!editing ? (
          <>
            <Button variant="primary" disabled={!canWrite} onClick={onWrite} title={canWrite ? undefined : "Add a brainstorm first"}>
              Write a project document
            </Button>
            <Button variant="ghost" onClick={() => { setName(project.name); setDesc(project.description); setEditing(true); }}>
              Edit name and description
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" disabled={!name.trim()} onClick={save}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </>
        )}
      </div>
    </header>
  );
}

function AddBrainstorm({ project, onError }: { project: Project; onError: (m: string) => void }) {
  const all = useGraphList();
  const [mode, setMode] = useState<"idle" | "existing" | "new">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const others = (all ?? []).filter((g) => !project.graphIds.includes(g.id));

  const start = async () => {
    setBusy(true);
    try {
      go({ name: "graph", id: await newGraph(text, project.id) });
    } catch (e) {
      onError(toUiError(e).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[180px] flex-col rounded-lg border border-dashed border-line-2 p-4">
      {mode === "idle" && (
        <div className="m-auto flex flex-col items-center gap-2 text-center">
          <Button variant="quiet" onClick={() => setMode("new")}>Start a new brainstorm here</Button>
          {others.length > 0 && <Button variant="ghost" size="sm" onClick={() => setMode("existing")}>Add an existing one</Button>}
        </div>
      )}
      {mode === "new" && (
        <>
          <label htmlFor="np" className="text-[13px] font-medium">What problem is this part about?</label>
          <textarea id="np" value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-1 w-full flex-1 rounded-md border border-line-2 bg-paper px-2.5 py-2 text-[14px]" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" disabled={!text.trim()} busy={busy} onClick={start}>Start brainstorming</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </>
      )}
      {mode === "existing" && (
        <>
          <p className="text-[13px] font-medium">Add a brainstorm</p>
          <ul className="mt-1 max-h-[220px] space-y-0.5 overflow-y-auto">
            {others.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => projects.addGraph(project.id, g.id).catch((e) => onError(toUiError(e).message))} className="line-clamp-2 w-full rounded px-1.5 py-1 text-left text-[13px] hover:bg-ground">
                  {g.title}
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2 self-start" onClick={() => setMode("idle")}>Done</Button>
        </>
      )}
    </div>
  );
}

function projectDocSource(project: Project, graphs: Graph[]): DocumentSource {
  const n = project.graphIds.length;
  return {
    intro: `Written across all ${n} brainstorms in project order, as one document. Contradictions between them are flagged, not resolved for you.`,
    types: ["overview", "solution", "prd", "trd", "adr", "brief", "custom"],
    history: Object.values(project.documents).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    generate: (req) => projects.generateDocument(project.id, graphs, req, aiOptions()),
    busyLabel: `Reading ${n} brainstorms…`,
  };
}
