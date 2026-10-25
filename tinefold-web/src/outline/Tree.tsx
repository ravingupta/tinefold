import { useState } from "react";
import { ROOT_NODE_ID, type TreeNode } from "@ravingupta/tinefold-engine";
import { Button, Tag } from "../app/ui";
import { useGraph } from "./GraphContext";

/** A problem: its questions, its options (one may be chosen), and the chosen option's breakdown. */
export function ProblemView({ node, depth }: { node: TreeNode; depth: number }) {
  const { session, busy, run } = useGraph();
  const questions = node.children.filter((c) => c.kind === "clarification");
  const options = node.children.filter((c) => c.kind === "solution");
  const chosen = options.some((o) => o.selected);
  const key = `expand:${node.id}`;
  const dim = node.state === "disabled";

  const expand = (allowClarify?: boolean) => run(key, () => session.expand(node.id, allowClarify === false ? { allowClarify: false } : {}));
  const regenerate = () =>
    run(key, async () => {
      const wasExpanded = node.expanded;
      await session.regenerate(node.id);
      if (wasExpanded) await session.expand(node.id);
    });

  return (
    <section id={`n-${node.id}`} className={`scroll-mt-24 ${dim ? "opacity-55" : ""}`} aria-label={node.isRoot ? "Root problem" : `Problem: ${node.title}`}>
      {!node.isRoot && (
        <header className="mb-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className={`font-semibold leading-snug ${depth <= 2 ? "text-[17px]" : "text-[15px]"}`}>{node.title}</h3>
            {node.isSuggestedNext && <Tag tone="cobalt" title="The most constraining open problem. Others depend on it.">Start here</Tag>}
            {node.isLeaf && <Tag title={node.leafReason}>Ready to build</Tag>}
            {node.portedFrom && <Tag title={`Reused from “${node.portedFrom.title}” in an earlier branch`}>Reused</Tag>}
            {node.versionCount > 1 && <Tag title="This node was regenerated">v{node.version}</Tag>}
          </div>
          {node.summary && <p className="mt-0.5 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{node.summary}</p>}
          {node.isLeaf && node.leafReason && <p className="mt-1 text-[13px] text-ink-2">{node.leafReason}</p>}
          <StaleLine node={node} onRegenerate={regenerate} busy={!!busy[key]} />
        </header>
      )}

      {(questions.length > 0 || options.length > 0) && (
        <div className={`tine ${node.state === "active" && (chosen || questions.length > 0) ? "is-chosen" : ""}`}>
          {questions.map((q) => (
            <div key={q.id} className="prong is-chosen pb-3">
              <ClarificationView node={q} />
            </div>
          ))}
          {options.length > 0 && (
            <p className="pb-2 text-[13px] text-ink-3">
              {chosen ? "Options" : "Pick one"}
              {node.axis ? ` · they differ on ${node.axis}` : ""}
            </p>
          )}
          {options.map((o) => (
            <div key={o.id} className={`prong pb-3 ${o.selected ? "is-chosen" : ""}`}>
              <SolutionView node={o} depth={depth} />
            </div>
          ))}
        </div>
      )}

      {node.state !== "disabled" && (node.canExpand || node.canRegenerate) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {node.canExpand && node.openQuestions === 0 && (
            <Button variant={node.isRoot || node.isSuggestedNext ? "primary" : "quiet"} busy={!!busy[key]} onClick={() => expand()}>
              {node.isRoot ? "Suggest approaches" : "Suggest options"}
            </Button>
          )}
          {node.canExpand && node.openQuestions > 0 && (
            <>
              <span className="text-[13px] text-ink-2">Answer the {node.openQuestions === 1 ? "question" : "questions"} above for sharper options, or</span>
              <Button size="sm" busy={!!busy[key]} onClick={() => expand(false)}>
                Continue without answering
              </Button>
            </>
          )}
          {!node.canExpand && node.expanded && node.canRegenerate && !node.mark?.match(/red/) && (
            <Button size="sm" variant="ghost" busy={!!busy[key]} onClick={regenerate} title="Rewrite this problem for the current context and suggest fresh options. Earlier options stay in history.">
              Regenerate options
            </Button>
          )}
        </div>
      )}
      {dim && <PortControl node={node} />}
    </section>
  );
}

/** A solution option. When chosen, its sub-problems hang below it. */
export function SolutionView({ node, depth }: { node: TreeNode; depth: number }) {
  const { session, busy, run } = useGraph();
  const [showExplored, setShowExplored] = useState(false);
  const problemId = node.parentId ?? ROOT_NODE_ID;
  const subproblems = node.children.filter((c) => c.kind === "problem");
  const questions = node.children.filter((c) => c.kind === "clarification");
  const key = `expand:${node.id}`;
  const selKey = `select:${problemId}`;
  const explored = !node.selected && subproblems.length > 0;
  const tone =
    node.mark === "red" ? "border-l-brick" : node.mark === "yellow" ? "border-l-amber" : node.selected ? "border-l-cobalt" : "border-l-line-2";

  return (
    <div id={`n-${node.id}`} className={`scroll-mt-24 ${node.state === "disabled" ? "opacity-55" : ""}`}>
      <article
        className={`max-w-[760px] rounded-lg border border-line border-l-[3px] bg-paper px-4 py-3 ${tone} ${node.selected ? "shadow-[0_1px_0_rgba(24,33,43,0.06)]" : ""}`}
        aria-label={`Option: ${node.title}${node.selected ? " (chosen)" : ""}`}
      >
        <div className="flex items-start gap-3">
          {node.state !== "disabled" ? (
            <button
              type="button"
              role="radio"
              aria-checked={node.selected}
              aria-label={node.selected ? `Undo choice: ${node.title}` : `Choose ${node.title}`}
              disabled={!!busy[selKey]}
              onClick={() => run(selKey, () => session.selectSolution(problemId, node.selected ? null : node.id))}
              className={`mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border-2 ${node.selected ? "border-cobalt" : "border-ink-3 hover:border-cobalt"}`}
            >
              {node.selected && <span className="size-2 rounded-full bg-cobalt" />}
            </button>
          ) : (
            <span className="mt-[3px] size-[18px] shrink-0 rounded-full border-2 border-line-2" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h4 className="text-[15px] font-semibold leading-snug">{node.title}</h4>
              {node.axisValue && <span className="text-[13px] text-ink-3">{node.axisValue}</span>}
              {node.recommended && <Tag tone="cobalt" title={node.recommendReason}>Suggested</Tag>}
              {node.portedFrom && <Tag title={`Reused from an earlier branch`}>Reused</Tag>}
              {node.fromOlderVersion && <Tag tone="brick" title="Chosen before the options above were regenerated">From earlier options</Tag>}
              {node.versionCount > 1 && <Tag>v{node.version}</Tag>}
            </div>
            <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">{node.summary}</p>
            {(node.pros.length > 0 || node.cons.length > 0) && (
              <div className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                <ul className="space-y-0.5">
                  {node.pros.map((p) => (
                    <li key={p} className="flex gap-1.5"><span className="text-cobalt" aria-label="Pro">+</span>{p}</li>
                  ))}
                </ul>
                <ul className="space-y-0.5">
                  {node.cons.map((c) => (
                    <li key={c} className="flex gap-1.5"><span className="text-brick" aria-label="Con">−</span>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {node.recommended && node.recommendReason && !node.selected && node.state === "option" && (
              <p className="mt-2 text-[13px] text-ink-3">Why suggested: {node.recommendReason}</p>
            )}
            <StaleLine
              node={node}
              busy={!!busy[key]}
              onRegenerate={() => run(key, () => session.regenerate(node.id))}
            />
            {node.selected && node.canExpand && questions.every((q) => q.answer) && (
              <div className="mt-3">
                <Button variant={depth === 0 ? "primary" : "quiet"} size="sm" busy={!!busy[key]} onClick={() => run(key, () => session.expand(node.id))}>
                  Break into sub-problems
                </Button>
              </div>
            )}
            {node.selected && node.canExpand && questions.some((q) => !q.answer) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                Answer the questions below, or
                <Button size="sm" busy={!!busy[key]} onClick={() => run(key, () => session.expand(node.id, { allowClarify: false }))}>
                  Continue without answering
                </Button>
              </div>
            )}
            {explored && (
              <button type="button" className="mt-2 text-[13px] text-ink-3 underline-offset-2 hover:underline" onClick={() => setShowExplored((v) => !v)}>
                {showExplored ? "Hide" : "Show"} what you explored here ({subproblems.length} sub-problems)
              </button>
            )}
          </div>
        </div>
      </article>
      {node.state === "disabled" && <PortControl node={node} />}

      {(node.selected || showExplored) && (questions.length > 0 || subproblems.length > 0) && (
        <div className={`tine mt-3 ${node.selected && node.state === "active" ? "is-chosen" : ""} ${!node.selected ? "opacity-55" : ""}`}>
          {questions.map((q) => (
            <div key={q.id} className="prong is-chosen pb-3">
              <ClarificationView node={q} />
            </div>
          ))}
          {subproblems.length > 0 && <p className="pb-2 text-[13px] text-ink-3">Solve all of these</p>}
          {subproblems.map((p) => (
            <div key={p.id} className={`prong pb-5 ${node.selected && node.state === "active" ? "is-chosen" : ""}`}>
              <ProblemView node={p} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClarificationView({ node }: { node: TreeNode }) {
  const { session, busy, run } = useGraph();
  const [editing, setEditing] = useState(!node.answer);
  const [text, setText] = useState(node.answer?.freeText ?? "");
  const [pick, setPick] = useState<string | undefined>(node.answer?.itemId);
  const key = `answer:${node.id}`;
  const disabled = node.state === "disabled";

  const save = async (itemId: string | undefined) => {
    if (!itemId && !text.trim()) return;
    const ok = await run(key, () => session.answerClarification(node.id, { itemId, freeText: text }));
    if (ok) setEditing(false);
  };

  return (
    <div id={`n-${node.id}`} className={`max-w-[760px] rounded-lg border border-dashed border-line-2 bg-ground/60 px-4 py-3 ${disabled ? "opacity-55" : ""}`}>
      <p className="text-[15px] font-semibold leading-snug">{node.title}</p>
      {node.summary && <p className="mt-0.5 text-[13px] text-ink-2">{node.summary}</p>}
      {node.answer && !editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
          <span className="rounded bg-cobalt-soft px-2 py-0.5 font-medium text-cobalt">{node.answer.label}</span>
          {!disabled && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change answer
            </Button>
          )}
        </div>
      ) : (
        !disabled && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={node.title}>
              {(node.options ?? []).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={pick === o.id}
                  onClick={() => setPick(pick === o.id ? undefined : o.id)}
                  className={`rounded-md border px-2.5 py-1 text-[13px] ${pick === o.id ? "border-cobalt bg-cobalt text-white" : "border-line-2 bg-paper hover:border-ink-3"}`}
                >
                  {o.title}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void save(pick)}
                placeholder={node.options?.length ? "Add detail, or answer in your own words" : "Your answer"}
                className="min-w-0 flex-1 rounded-md border border-line-2 bg-paper px-2.5 py-1.5 text-[14px] placeholder:text-ink-3"
                aria-label={`Answer in your own words: ${node.title}`}
              />
              <Button size="sm" variant="primary" disabled={!pick && !text.trim()} busy={!!busy[key]} onClick={() => save(pick)}>
                Save answer
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export function StaleLine({ node, onRegenerate, busy }: { node: TreeNode; onRegenerate: () => void; busy: boolean }) {
  const { session, busy: allBusy, run } = useGraph();
  const key = `check:${node.id}`;
  if (node.mark === "yellow") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-soft px-2.5 py-1.5 text-[13px] text-[#6d4a08]">
        <span>Possibly out of date: {node.staleReasons.join("; ")}.</span>
        <Button size="sm" variant="ghost" busy={!!allBusy[key]} onClick={() => run(key, () => session.checkStale(node.id))}>
          Check
        </Button>
      </div>
    );
  }
  if (node.mark === "red") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-brick-soft px-2.5 py-1.5 text-[13px] text-brick">
        <span>Out of date: {node.staleReasons.join("; ")}.</span>
        <Button size="sm" variant="ghost" busy={busy} onClick={onRegenerate}>
          Regenerate
        </Button>
      </div>
    );
  }
  if (node.checkedReason && node.mark === "none") {
    return <p className="mt-1.5 text-[12px] text-ink-3">Checked after a change: {node.checkedReason}</p>;
  }
  return null;
}

export function PortControl({ node }: { node: TreeNode }) {
  const { session, busy, run, portTargets } = useGraph();
  const [open, setOpen] = useState(false);
  if (node.kind === "clarification") return null;
  const targets = portTargets(node);
  if (targets.length === 0) return null;
  const key = `port:${node.id}`;
  return (
    <div className="mt-1.5 text-[13px]">
      {!open ? (
        <button type="button" className="text-cobalt underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
          Reuse in the current plan…
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">Copy {node.kind === "problem" ? "this problem and its choice" : "this option"} under</span>
          <select
            className="rounded-md border border-line-2 bg-paper px-2 py-1"
            aria-label="Target"
            defaultValue=""
            disabled={!!busy[key]}
            onChange={(e) => e.target.value && run(key, () => session.portNode(node.id, e.target.value)).then(() => setOpen(false))}
          >
            <option value="" disabled>
              choose where
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

