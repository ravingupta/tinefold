import { useState } from "react";
import { projects, useProjects } from "../app/sessions";
import { href } from "../app/route";
import { toUiError } from "../app/errors";

/** Which projects a brainstorm belongs to, with add/remove. Brainstorms are never changed by this. */
export function ProjectChips({ graphId }: { graphId: string }) {
  const list = useProjects();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!list) return null;
  const mine = list.filter((p) => p.graphIds.includes(graphId));

  const toggle = async (projectId: string, on: boolean) => {
    try {
      await (on ? projects.addGraph(projectId, graphId) : projects.removeGraph(projectId, graphId));
    } catch (e) {
      setError(toUiError(e).message);
    }
  };
  const create = async () => {
    if (!name.trim()) return;
    try {
      await projects.create({ name, graphIds: [graphId] });
      setName("");
    } catch (e) {
      setError(toUiError(e).message);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 text-[13px]">
      {mine.length > 0 && <span className="text-ink-3">Part of</span>}
      {mine.map((p) => (
        <a key={p.id} href={href({ name: "project", id: p.id })} className="rounded border border-line-2 bg-paper px-1.5 py-[1px] text-ink-2 hover:border-cobalt hover:text-cobalt">
          {p.name}
        </a>
      ))}
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded px-1.5 py-[1px] text-ink-3 hover:bg-black/5 hover:text-ink">
        {mine.length ? "Edit projects" : "Add to a project"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[290px] rounded-lg border border-line-2 bg-paper p-3 shadow-lg" role="dialog" aria-label="Projects for this brainstorm">
          <p className="text-[12px] text-ink-2">Projects combine brainstorms into one overview and joint documents. This brainstorm stays exactly as it is.</p>
          {list.length > 0 && (
            <ul className="mt-2 max-h-[200px] space-y-0.5 overflow-y-auto">
              {list.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-ground">
                    <input type="checkbox" checked={p.graphIds.includes(graphId)} onChange={(e) => toggle(p.id, e.target.checked)} className="accent-[#2747d0]" />
                    <span className="flex-1">{p.name}</span>
                    <span className="text-[12px] text-ink-3">{p.graphIds.length}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="New project name"
              aria-label="New project name"
              className="min-w-0 flex-1 rounded-md border border-line-2 px-2 py-1 text-[13px]"
            />
            <button type="button" onClick={create} disabled={!name.trim()} className="rounded-md bg-cobalt px-2.5 py-1 text-[13px] font-medium text-white disabled:bg-ink-3">
              Create
            </button>
          </div>
          {error && <p className="mt-1.5 text-[12px] text-brick">{error}</p>}
          <button type="button" onClick={() => setOpen(false)} className="mt-2 text-[12px] text-ink-3 hover:text-ink">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
