import { useEffect, useRef, useState } from "react";
import type { Graph } from "@ravingupta/tinefold-engine";
import { Button } from "../app/ui";
import { useGraph } from "./GraphContext";

export function Rail({ snapshot }: { snapshot: Graph }) {
  return (
    <aside className="space-y-6 text-[14px]">
      <Progress snapshot={snapshot} />
      <Comments snapshot={snapshot} />
      <Assumptions />
    </aside>
  );
}

/** Outline: scroll to the node. Tree: open it in the inspector (the canvas pans to it). */
export function useJump(): (id: string) => void {
  const { setFocusId } = useGraph();
  return (id: string) => {
    const el = document.getElementById(`n-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else setFocusId(id);
  };
}

/** What is still open and how many decisions are made. `jump` absent (phones) lists items without links. */
export function Progress({ snapshot, jump: jumpProp }: { snapshot: Graph; jump?: ((id: string) => void) | null }) {
  const { session } = useGraph();
  const defaultJump = useJump();
  const jump = jumpProp === undefined ? defaultJump : jumpProp;
  const done = session.select.completeness();
  const next = session.select.suggestedNext();
  const warn = session.select.restartWarning();
  const titles = (id: string) => (id === "root" ? "Pick an approach for the problem" : snapshot.nodeVersions[snapshot.nodes[id]?.currentVersionId ?? ""]?.title ?? id);
  const decisions = session.select.decisionSummary().decisions;

  return (
    <div className="space-y-6 text-[14px]">
      {warn && (
        <div className="rounded-lg border border-brick/30 bg-brick-soft px-4 py-3 text-brick">
          <p className="font-semibold">{warn.count} nodes are out of date</p>
          <p className="mt-1 text-[13px]">
            They all sit under “{warn.title}”. Regenerating from there is faster than fixing them one by one.
          </p>
          {jump && (
            <Button size="sm" variant="danger" className="mt-2" onClick={() => jump(warn.nodeId)}>
              Go to “{warn.title}”
            </Button>
          )}
        </div>
      )}

      <section aria-labelledby="progress-h">
        <h2 id="progress-h" className="text-[15px] font-semibold">
          {done.count === 0 ? "Nothing left open" : `${done.count} still open`}
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {decisions.length} {decisions.length === 1 ? "decision" : "decisions"} made on the chosen path.
        </p>
        {done.count > 0 && (
          <ul className="mt-2 space-y-1">
            {[...done.unansweredClarificationIds, ...done.unresolvedProblemIds].map((id) => (
              <li key={id}>
                {jump ? (
                  <button type="button" onClick={() => jump(id)} className="text-left text-[13px] leading-snug hover:text-cobalt">
                    <OpenItem id={id} next={next} title={titles(id)} question={done.unansweredClarificationIds.includes(id)} />
                  </button>
                ) : (
                  <span className="text-[13px] leading-snug">
                    <OpenItem id={id} next={next} title={titles(id)} question={done.unansweredClarificationIds.includes(id)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OpenItem({ id, next, title, question }: { id: string; next: string | null | undefined; title: string; question: boolean }) {
  return (
    <>
      <span className={id === next ? "font-semibold text-cobalt" : ""}>{title}</span>
      {id === next && <span className="text-cobalt"> · start here</span>}
      {question && <span className="text-ink-3"> · question</span>}
    </>
  );
}

export function Comments({ snapshot }: { snapshot: Graph }) {
  const { session, busy, run, prefillComment, setPrefillComment } = useGraph();
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<{ statement: string; mergedCommentIds: string[] } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const open = snapshot.comments.filter((c) => c.mergedIntoRootVersion === undefined);
  const merged = snapshot.comments.filter((c) => c.mergedIntoRootVersion !== undefined);

  useEffect(() => {
    if (prefillComment !== null) {
      setText(prefillComment);
      setPrefillComment(null);
      ref.current?.focus();
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [prefillComment, setPrefillComment]);

  const add = async () => {
    if (!text.trim()) return;
    if (await run("comment", () => session.addComment(text))) setText("");
  };

  return (
    <section aria-labelledby="comments-h">
      <h2 id="comments-h" className="text-[15px] font-semibold">Comments</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">Extra context for the whole problem. Later comments win.</p>
      {open.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {open.map((c) => (
            <li key={c.id} className="rounded-md bg-paper px-3 py-2 text-[13px] leading-snug">
              {c.text}
            </li>
          ))}
        </ol>
      )}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void add()}
        rows={3}
        placeholder="Team is three people. Must stay on AWS. Budget is tight…"
        className="mt-2 w-full resize-y rounded-md border border-line-2 bg-paper px-3 py-2 text-[14px] placeholder:text-ink-3"
        aria-label="Add a comment"
      />
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!text.trim()} busy={!!busy.comment} onClick={add}>
          Add comment
        </Button>
        {open.length > 0 && !proposal && (
          <Button
            size="sm"
            busy={!!busy.rewrite}
            title="Rewrite the root problem to include these comments. The current tree will be marked out of date."
            onClick={() => run("rewrite", async () => setProposal(await session.proposeRootRewrite()))}
          >
            Fold into the problem
          </Button>
        )}
      </div>
      {proposal && (
        <div className="mt-3 rounded-lg border border-cobalt/40 bg-paper p-3">
          <p className="text-[13px] font-semibold">Proposed problem statement</p>
          <p className="mt-0.5 text-[12px] text-ink-2">
            Applying it creates version {snapshot.rootVersions.length + 1} of the problem. Everything below the root is marked out of date; nothing is deleted.
          </p>
          <textarea
            value={proposal.statement}
            onChange={(e) => setProposal({ ...proposal, statement: e.target.value })}
            rows={6}
            className="mt-2 w-full rounded-md border border-line-2 bg-ground/40 px-2.5 py-2 text-[13px]"
            aria-label="Proposed problem statement"
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              busy={!!busy.apply}
              onClick={() => run("apply", () => session.approveRootRewrite(proposal.statement, proposal.mergedCommentIds)).then((ok) => ok && setProposal(null))}
            >
              Apply rewrite
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {merged.length > 0 && (
        <details className="mt-3 text-[13px] text-ink-2">
          <summary className="cursor-pointer">{merged.length} folded into the problem</summary>
          <ul className="mt-1 space-y-1">
            {merged.map((c) => (
              <li key={c.id}>v{c.mergedIntoRootVersion}: {c.text}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function Assumptions() {
  const { session, setPrefillComment } = useGraph();
  const list = session.select.assumptions();
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="assume-h">
      <h2 id="assume-h" className="text-[15px] font-semibold">Assumptions made for you</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">Facts the model guessed instead of asking. Correct any that are wrong.</p>
      <ul className="mt-2 space-y-2">
        {list.map((a) => (
          <li key={`${a.nodeId}|${a.text}`} className="text-[13px] leading-snug">
            <p>{a.text}</p>
            <p className="mt-0.5 text-ink-3">
              under {a.nodeTitle} ·{" "}
              <button type="button" className="text-cobalt hover:underline" onClick={() => setPrefillComment(`Correction: “${a.text}” is wrong. Actually, `)}>
                correct this
              </button>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
