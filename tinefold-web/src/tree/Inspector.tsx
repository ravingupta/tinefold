import type { TreeNode } from "@ravingupta/tinefold-engine";
import { ROOT_NODE_ID } from "@ravingupta/tinefold-engine";
import { Button, Tag } from "../app/ui";
import { useGraph } from "../outline/GraphContext";
import { ClarificationView, PortControl, StaleLine } from "../outline/Tree";

export function findInTree(t: TreeNode, id: string): TreeNode | undefined {
  if (t.id === id) return t;
  for (const c of t.children) {
    const f = findInTree(c, id);
    if (f) return f;
  }
  return undefined;
}

/** Everything about one node, and every action on it. The tree canvas stays the map. */
export function Inspector({ tree, nodeId }: { tree: TreeNode; nodeId: string }) {
  const { session, busy, run, setFocusId } = useGraph();
  const n = findInTree(tree, nodeId);
  if (!n) {
    return (
      <div className="text-[14px] text-ink-2">
        That node is no longer in the tree.{" "}
        <button type="button" className="text-cobalt hover:underline" onClick={() => setFocusId(null)}>Back to the overview</button>
      </div>
    );
  }
  const parent = n.parentId ? findInTree(tree, n.parentId) : undefined;
  const key = `expand:${n.id}`;
  const questions = n.children.filter((c) => c.kind === "clarification");
  const options = n.children.filter((c) => c.kind === "solution");
  const subs = n.children.filter((c) => c.kind === "problem");
  const problemId = n.parentId ?? ROOT_NODE_ID;
  const regenerate = () =>
    run(key, async () => {
      const wasExpanded = n.expanded;
      await session.regenerate(n.id);
      if (wasExpanded && n.kind === "problem") await session.expand(n.id);
    });

  return (
    <div className="space-y-4 text-[14px]">
      <div className="flex items-center gap-2 text-[13px]">
        <button type="button" onClick={() => setFocusId(null)} className="text-ink-2 hover:text-ink">← Overview</button>
        {parent && (
          <>
            <span className="text-ink-3">·</span>
            <button type="button" onClick={() => setFocusId(parent.id)} className="truncate text-ink-2 hover:text-cobalt" title={parent.title}>
              Up to {parent.isRoot ? "the problem" : `“${parent.title.slice(0, 32)}${parent.title.length > 32 ? "…" : ""}”`}
            </button>
          </>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
          <span>{n.isRoot ? "The problem" : n.kind === "clarification" ? "Question" : n.kind === "solution" ? (n.selected ? "Chosen option" : "Option") : "Sub-problem"}</span>
          {n.recommended && <Tag tone="cobalt" title={n.recommendReason}>Suggested</Tag>}
          {n.isSuggestedNext && <Tag tone="cobalt">Start here</Tag>}
          {n.isLeaf && <Tag>Ready to build</Tag>}
          {n.portedFrom && <Tag title={`Reused from “${n.portedFrom.title}”`}>Reused</Tag>}
          {n.versionCount > 1 && <Tag>v{n.version}</Tag>}
          {n.state === "disabled" && <Tag>Not on the chosen path</Tag>}
        </div>
        <h2 className={`mt-1 font-bold leading-snug ${n.isRoot ? "text-[17px]" : "text-[18px]"}`}>{n.title}</h2>
        {n.summary && <p className="mt-1 leading-relaxed text-ink-2">{n.summary}</p>}
        {n.axisValue && <p className="mt-1 text-[13px] text-ink-3">Position: {n.axisValue}</p>}
        {n.isLeaf && n.leafReason && <p className="mt-1 text-[13px] text-ink-2">{n.leafReason}</p>}
        {(n.pros.length > 0 || n.cons.length > 0) && (
          <ul className="mt-2 space-y-0.5 text-[13px]">
            {n.pros.map((p) => <li key={`p${p}`} className="flex gap-1.5"><span className="text-cobalt">+</span>{p}</li>)}
            {n.cons.map((c) => <li key={`c${c}`} className="flex gap-1.5"><span className="text-brick">−</span>{c}</li>)}
          </ul>
        )}
        {n.recommended && n.recommendReason && <p className="mt-2 text-[13px] text-ink-3">Why suggested: {n.recommendReason}</p>}
        <StaleLine node={n} busy={!!busy[key]} onRegenerate={regenerate} />
        {n.state === "disabled" && <PortControl node={n} />}
      </div>

      {n.kind === "clarification" && <ClarificationView node={n} />}

      {n.kind === "solution" && n.state !== "disabled" && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={n.selected ? "quiet" : "primary"}
            busy={!!busy[`select:${problemId}`]}
            onClick={() => run(`select:${problemId}`, () => session.selectSolution(problemId, n.selected ? null : n.id))}
          >
            {n.selected ? "Undo this choice" : "Choose this option"}
          </Button>
          {n.selected && n.canExpand && n.openQuestions === 0 && (
            <Button size="sm" variant="primary" busy={!!busy[key]} onClick={() => run(key, () => session.expand(n.id))}>
              Break into sub-problems
            </Button>
          )}
          {n.canRegenerate && n.mark !== "red" && (
            <Button size="sm" variant="ghost" busy={!!busy[key]} onClick={regenerate} title="Rewrite this option for the current context">
              Regenerate
            </Button>
          )}
        </div>
      )}

      {n.kind === "problem" && n.state !== "disabled" && (
        <div className="flex flex-wrap items-center gap-2">
          {n.canExpand && n.openQuestions === 0 && (
            <Button size="sm" variant="primary" busy={!!busy[key]} onClick={() => run(key, () => session.expand(n.id))}>
              {n.isRoot ? "Suggest approaches" : "Suggest options"}
            </Button>
          )}
          {n.canExpand && n.openQuestions > 0 && (
            <Button size="sm" busy={!!busy[key]} onClick={() => run(key, () => session.expand(n.id, { allowClarify: false }))}>
              Continue without answering
            </Button>
          )}
          {!n.isRoot && n.expanded && n.canRegenerate && n.mark !== "red" && (
            <Button size="sm" variant="ghost" busy={!!busy[key]} onClick={regenerate} title="Rewrite this problem and suggest fresh options. Earlier ones stay in history.">
              Regenerate options
            </Button>
          )}
        </div>
      )}

      {questions.length > 0 && n.kind !== "clarification" && (
        <section>
          <h3 className="text-[13px] font-semibold">{questions.some((q) => !q.answer) ? "Answer first" : "Questions answered"}</h3>
          <div className="mt-2 space-y-2">
            {questions.map((q) => <ClarificationView key={q.id} node={q} />)}
          </div>
        </section>
      )}

      {options.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold">Options{n.axis ? `, by ${n.axis}` : ""}</h3>
          <ul className="mt-1.5 space-y-1">
            {options.map((o) => (
              <li key={o.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${o.selected ? "bg-cobalt-soft" : "hover:bg-ground"}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={o.selected}
                  aria-label={o.selected ? `Undo choice: ${o.title}` : `Choose ${o.title}`}
                  disabled={o.state === "disabled" || !!busy[`select:${n.id}`]}
                  onClick={() => run(`select:${n.id}`, () => session.selectSolution(n.id, o.selected ? null : o.id))}
                  className={`mt-[3px] grid size-[15px] shrink-0 place-items-center rounded-full border-2 ${o.selected ? "border-cobalt" : "border-ink-3 hover:border-cobalt"}`}
                >
                  {o.selected && <span className="size-1.5 rounded-full bg-cobalt" />}
                </button>
                <button type="button" onClick={() => setFocusId(o.id)} className="min-w-0 flex-1 text-left">
                  <span className="block text-[13px] font-medium leading-snug">{o.title}{o.recommended && <span className="text-cobalt"> · suggested</span>}</span>
                  <span className="line-clamp-2 block text-[12px] text-ink-2">{o.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {subs.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold">Sub-problems, all required</h3>
          <ul className="mt-1.5 space-y-1">
            {subs.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setFocusId(s.id)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-ground">
                  <span className="block text-[13px] font-medium leading-snug">
                    {s.title}
                    {s.isSuggestedNext && <span className="text-cobalt"> · start here</span>}
                  </span>
                  <span className="block text-[12px] text-ink-3">
                    {s.isLeaf ? "Ready to build" : s.children.some((c) => c.selected) ? `Decided: ${s.children.find((c) => c.selected)!.title}` : s.expanded ? "Options waiting for a choice" : "Not explored yet"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {n.assumptions.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold">Assumed here</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
            {n.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
