import { useEffect, useMemo, useState } from "react";
import type { Session } from "@ravingupta/tinefold-engine";
import { useSession, useSnapshot, removeGraph } from "../app/sessions";
import { go } from "../app/route";
import { Button, download, Tag } from "../app/ui";
import { toUiError } from "../app/errors";
import { GraphProvider, useGraph } from "./GraphContext";
import { ProblemView, SolutionView } from "./Tree";
import { Rail } from "./Rail";
import { DocumentPanel, type DocumentSource } from "../documents/DocumentPanel";
import { ProjectChips } from "../projects/ProjectChips";
import { TreeCanvas } from "../tree/TreeCanvas";
import { Inspector } from "../tree/Inspector";
import { FocusLayer } from "../tree/FocusLayer";
import { PhonePage } from "./PhonePage";
import { useIsPhone } from "../app/viewport";
import { Icon } from "../app/icons";

type View = "tree" | "outline";
const VIEW_KEY = "tinefold.view";
const FOCUS_KEY = "tinefold.focus";
function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "outline" ? "outline" : "tree";
  } catch {
    return "tree";
  }
}
function loadFocus(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export function GraphPage({ graphId }: { graphId: string }) {
  const { session, error } = useSession(graphId);
  if (error) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <p className="text-[17px] font-semibold">This brainstorm couldn't be opened.</p>
        <p className="mt-1 text-ink-2">{toUiError(error).message}</p>
        <Button className="mt-4" onClick={() => go({ name: "home" })}>Back to all brainstorms</Button>
      </div>
    );
  }
  if (!session) return <p className="thinking px-6 py-16 text-ink-2">Opening…</p>;
  return <Loaded session={session} />;
}

function Loaded({ session }: { session: Session }) {
  const snapshot = useSnapshot(session);
  const tree = useMemo(() => session.select.tree(), [session, snapshot]);
  const [docOpen, setDocOpen] = useState(false);
  const [view, setViewState] = useState<View>(loadView);
  const [focus, setFocusState] = useState<boolean>(loadFocus);
  const phone = useIsPhone();
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer convenience only
    }
  };
  const setFocus = (on: boolean) => {
    setFocusState(on);
    try {
      localStorage.setItem(FOCUS_KEY, on ? "1" : "0");
    } catch {
      // per-viewer convenience only
    }
  };
  useEffect(() => {
    document.title = `${tree.title.slice(0, 60)} · tinefold`;
  }, [tree.title]);
  // "f" enters focus from the tree view; the focus layer handles Esc itself.
  useEffect(() => {
    if (focus || view !== "tree" || phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) setFocus(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, view, phone]);

  if (phone) {
    return (
      <GraphProvider session={session} tree={tree}>
        <PhonePage snapshot={snapshot} tree={tree} />
      </GraphProvider>
    );
  }

  if (view === "tree" && focus) {
    return (
      <GraphProvider session={session} tree={tree}>
        <FocusLayer tree={tree} snapshot={snapshot} onWrite={() => setDocOpen(true)} onExit={() => setFocus(false)} />
        {docOpen && <DocumentPanel source={graphDocSource(session)} onClose={() => setDocOpen(false)} />}
      </GraphProvider>
    );
  }

  if (view === "tree") {
    return (
      <GraphProvider session={session} tree={tree}>
        <div className="mx-auto grid max-w-[1680px] gap-6 px-4 pb-6 pt-4 sm:px-6 lg:h-[calc(100vh-48px)] lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="flex min-w-0 flex-col lg:min-h-0">
            <RootHeader onWrite={() => setDocOpen(true)} view={view} onView={setView} onFocus={() => setFocus(true)} compact />
            <ErrorBar />
            <div className="mt-4 h-[72vh] min-h-[420px] overflow-hidden rounded-xl border border-line bg-[#f3f5f2] lg:h-auto lg:flex-1">
              <TreeCanvas tree={tree} />
            </div>
            {tree.archive && tree.archive.length > 0 && (
              <p className="mt-3 text-[13px] text-ink-3">
                {tree.archive.length === 1 ? "An earlier version of the problem is kept." : `${tree.archive.length} earlier versions of the problem are kept.`}{" "}
                <button type="button" className="text-cobalt hover:underline" onClick={() => setView("outline")}>See them in the outline</button>
              </p>
            )}
          </main>
          <SidePanel snapshot={snapshot} tree={tree} />
        </div>
        {docOpen && <DocumentPanel source={graphDocSource(session)} onClose={() => setDocOpen(false)} />}
      </GraphProvider>
    );
  }

  return (
    <GraphProvider session={session} tree={tree}>
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 pb-24 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <RootHeader onWrite={() => setDocOpen(true)} view={view} onView={setView} />
          <ErrorBar />
          <div className="mt-6">
            <ProblemView node={tree} depth={0} />
          </div>
          {tree.archive && tree.archive.length > 0 && <Archive />}
        </main>
        <div className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pb-6">
          <Rail snapshot={snapshot} />
        </div>
      </div>
      {docOpen && <DocumentPanel source={graphDocSource(session)} onClose={() => setDocOpen(false)} />}
    </GraphProvider>
  );
}

function SidePanel({ snapshot, tree }: { snapshot: ReturnType<Session["getSnapshot"]>; tree: ReturnType<Session["select"]["tree"]> }) {
  const { focusId } = useGraph();
  return (
    <div className="lg:min-h-0 lg:overflow-y-auto lg:pb-2">
      {focusId ? (
        <div className="rounded-xl border border-line bg-paper p-4">
          <Inspector tree={tree} nodeId={focusId} />
        </div>
      ) : (
        <>
          <p className="mb-4 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-2">Click any card in the tree to see it in full and act on it.</p>
          <Rail snapshot={snapshot} />
        </>
      )}
    </div>
  );
}

function ViewSwitch({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex rounded-md border border-line-2 bg-paper p-0.5 text-[13px]">
      {(["tree", "outline"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => onView(v)}
          className={`rounded px-2.5 py-1 font-medium ${view === v ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
        >
          {v === "tree" ? "Tree" : "Outline"}
        </button>
      ))}
    </div>
  );
}

function RootHeader({ onWrite, view, onView, onFocus, compact }: { onWrite: () => void; view: View; onView: (v: View) => void; onFocus?: () => void; compact?: boolean }) {
  const { session, busy, run } = useGraph();
  const tree = session.select.tree();
  const snapshot = session.getSnapshot();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(tree.summary);
  const [renaming, setRenaming] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const decisions = session.select.decisionSummary().decisions.length;

  const exportJson = async () => {
    const events = await session.exportEvents();
    download(`tinefold-${session.graphId}.json`, JSON.stringify(events, null, 2), "application/json");
  };

  return (
    <header>
      <ProjectChips graphId={session.graphId} />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span>The problem</span>
        {snapshot.rootVersions.length > 1 && (
          <Tag tone="cobalt" title={snapshot.rootVersions.map((r) => `v${r.version}: ${r.statement}`).join("\n\n")}>
            version {tree.version}
          </Tag>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={exportJson} title="Download the full event log. Import it on any machine to get this exact brainstorm back.">
          Export
        </Button>
        {!confirmDelete ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
        ) : (
          <>
            <span className="text-brick">Delete this brainstorm for good?</span>
            <Button size="sm" variant="danger" onClick={() => removeGraph(session.graphId).then(() => go({ name: "home" }))}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          </>
        )}
      </div>
      {!editing ? (
        <>
          {renaming ? (
            <NameEditor onDone={() => setRenaming(false)} />
          ) : (
            <div className={`${compact ? "mt-1.5" : "mt-2"} flex min-w-0 items-center gap-1`}>
              <h1
                className={`truncate font-bold tracking-[-0.015em] ${compact ? "text-[clamp(1.15rem,1.6vw,1.4rem)] leading-[1.2]" : "text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.15]"}`}
              >
                {tree.title}
              </h1>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="shrink-0 rounded p-1.5 text-ink-3 hover:bg-ground hover:text-cobalt"
                aria-label="Rename this brainstorm"
                title="Rename"
              >
                <Icon name="pencil" className="size-4" />
              </button>
            </div>
          )}
          <p
            className={`mt-1 max-w-[80ch] text-[15px] leading-relaxed text-ink-2 ${showAll ? "" : compact ? "line-clamp-1" : "line-clamp-2"}`}
            title={showAll ? undefined : tree.summary}
          >
            {tree.summary}
          </p>
          {tree.summary.length > (compact ? 100 : 180) && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="mt-0.5 text-[13px] text-ink-3 hover:text-cobalt">
              {showAll ? "Less" : "More"}
            </button>
          )}
        </>
      ) : (
        <div className="mt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full max-w-[760px] rounded-md border border-line-2 bg-paper px-3 py-2 text-[17px] leading-snug"
            aria-label="Problem statement"
          />
          <p className="mt-1 text-[13px] text-ink-2">Saving creates a new version of the problem. The tree under it is marked out of date, not deleted.</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!text.trim() || text.trim() === tree.summary}
              busy={!!busy.edit}
              onClick={() => run("edit", () => session.approveRootRewrite(text, [])).then((ok) => ok && setEditing(false))}
            >
              Save new version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(tree.summary); }}>Cancel</Button>
          </div>
        </div>
      )}
      {!editing && (
        <div className={`${compact ? "mt-2.5" : "mt-4"} flex flex-wrap items-center gap-2`}>
          <ViewSwitch view={view} onView={onView} />
          {onFocus && (
            <Button size="sm" variant="ghost" onClick={onFocus} title="Only the tree, full screen. Press f; Esc leaves.">
              <Icon name="focus" className="size-4" />
              Focus
            </Button>
          )}
          <Button variant={decisions > 0 ? "primary" : "quiet"} size={compact ? "sm" : "md"} onClick={onWrite}>
            Write a document
          </Button>
          <Button variant="ghost" size={compact ? "sm" : "md"} onClick={() => { setText(tree.summary); setEditing(true); }}>
            Edit the problem
          </Button>
        </div>
      )}
    </header>
  );
}

/** Inline rename. Enter saves, Escape cancels. */
function NameEditor({ onDone }: { onDone: () => void }) {
  const { session, busy, run } = useGraph();
  const current = session.select.tree().title;
  const [name, setName] = useState(current);
  const save = () => {
    const next = name.trim();
    if (!next || next === current) return onDone();
    void run("rename", () => session.rename(next)).then((ok) => ok && onDone());
  };
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input
        autoFocus
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Brainstorm name"
        placeholder="A short name, 2–4 words"
        className="w-full max-w-[420px] rounded-md border border-line-2 bg-paper px-3 py-1.5 text-[clamp(1.15rem,1.8vw,1.5rem)] font-bold leading-tight"
      />
      <Button type="submit" variant="primary" size="sm" busy={!!busy.rename} disabled={!name.trim()}>Save</Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
    </form>
  );
}

function ErrorBar() {
  const { error, dismissError } = useGraph();
  if (!error) return null;
  return (
    <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-brick-soft px-3 py-2 text-[14px] text-brick">
      <span className="flex-1">{error.message}</span>
      {error.action === "settings" && (
        <Button size="sm" variant="danger" onClick={() => go({ name: "settings" })}>Open settings</Button>
      )}
      <Button size="sm" variant="ghost" onClick={dismissError}>Dismiss</Button>
    </div>
  );
}

function Archive() {
  const { session } = useGraph();
  const archive = session.select.tree().archive ?? [];
  return (
    <section className="mt-14 border-t border-line pt-6" aria-labelledby="archive-h">
      <h2 id="archive-h" className="text-[15px] font-semibold">Earlier versions of the problem</h2>
      <p className="mt-0.5 max-w-[68ch] text-[13px] text-ink-2">
        What you explored before the problem changed. Nothing here affects the current plan; reuse any part of it with “Reuse in the current plan”.
      </p>
      {archive.map((a) => (
        <details key={a.version} className="mt-4">
          <summary className="cursor-pointer text-[14px]">
            <span className="font-medium">Version {a.version}:</span> <span className="text-ink-2">{a.statement.slice(0, 120)}{a.statement.length > 120 ? "…" : ""}</span>
          </summary>
          <div className="tine mt-3">
            {a.children.map((c) => (
              <div key={c.id} className="prong pb-3">
                <SolutionView node={c} depth={1} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}


function graphDocSource(session: Session): DocumentSource {
  const open = session.select.completeness().count;
  return {
    intro: `Built from the chosen path, with rejected options as alternatives.${open > 0 ? ` ${open} open ${open === 1 ? "item is" : "items are"} listed as open, not invented.` : ""}`,
    types: ["solution", "prd", "trd", "adr", "brief", "custom"],
    history: session.select.documents(),
    generate: (req) => session.generateDocument(req),
    busyLabel: `Writing from ${session.select.decisionSummary().decisions.length} decisions…`,
  };
}
