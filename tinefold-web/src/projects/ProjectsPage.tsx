import { useEffect, useState } from "react";
import { projects, useGraphList, useProjects } from "../app/sessions";
import { go, href } from "../app/route";
import { Button, relativeTime } from "../app/ui";
import { toUiError } from "../app/errors";

export function ProjectsPage() {
  const list = useProjects();
  const graphs = useGraphList();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Projects · tinefold";
  }, []);

  const create = async () => {
    try {
      const p = await projects.create({ name, graphIds: picked });
      go({ name: "project", id: p.id });
    } catch (e) {
      setError(toUiError(e).message);
    }
  };
  const titleOf = (id: string) => graphs?.find((g) => g.id === id)?.title;

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-24 pt-10 sm:px-6">
      <h1 className="text-[28px] font-bold tracking-[-0.015em]">Projects</h1>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
        A project puts several brainstorms side by side: one high-level structure, and documents written across all of them. Each brainstorm keeps working on its own, and can be part of more than one project.
      </p>

      <section className="mt-8 rounded-lg border border-line-2 bg-paper p-4" aria-labelledby="new-p">
        <h2 id="new-p" className="text-[15px] font-semibold">New project</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Shop rebuild"
          aria-label="Project name"
          className="mt-2 w-full max-w-[420px] rounded-md border border-line-2 px-3 py-1.5 text-[15px]"
        />
        {graphs && graphs.length > 0 && (
          <fieldset className="mt-3">
            <legend className="text-[13px] text-ink-2">Brainstorms to combine (you can change this later)</legend>
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
              {graphs.map((g) => (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-[13px] hover:bg-ground">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#2747d0]"
                      checked={picked.includes(g.id)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, g.id] : p.filter((x) => x !== g.id)))}
                    />
                    <span className="line-clamp-2">{g.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <Button className="mt-3" variant="primary" disabled={!name.trim()} onClick={create}>
          Create project
        </Button>
        {error && <p className="mt-2 text-[13px] text-brick">{error}</p>}
      </section>

      {list && list.length > 0 && (
        <ul className="mt-10 divide-y divide-line border-y border-line">
          {list.map((p) => (
            <li key={p.id}>
              <a href={href({ name: "project", id: p.id })} className="block py-3 hover:text-cobalt">
                <span className="flex items-baseline gap-3">
                  <span className="flex-1 text-[16px] font-semibold">{p.name}</span>
                  <span className="text-[13px] text-ink-3">
                    {p.graphIds.length} {p.graphIds.length === 1 ? "brainstorm" : "brainstorms"} · {relativeTime(p.updatedAt)}
                  </span>
                </span>
                {p.graphIds.length > 0 && (
                  <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                    {p.graphIds.map(titleOf).filter(Boolean).map((t) => (t!.length > 50 ? `${t!.slice(0, 50)}…` : t)).join("  ·  ")}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="mt-8 text-[14px] text-ink-2">No projects yet. Create one when two or more brainstorms belong together.</p>}
    </div>
  );
}
