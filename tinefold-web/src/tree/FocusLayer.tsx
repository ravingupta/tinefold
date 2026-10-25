import { useEffect, useState, type ReactNode } from "react";
import type { Graph, TreeNode } from "@ravingupta/tinefold-engine";
import { Icon } from "../app/icons";
import { useGraph } from "../outline/GraphContext";
import { Comments, Progress } from "../outline/Rail";
import { Inspector } from "./Inspector";
import { TreeCanvas } from "./TreeCanvas";

type Panel = "comments" | "progress";

/**
 * Focus: the tree fills the viewport and everything else is gone. A strip of icons at the top right
 * opens one floating panel at a time (comments, progress, the inspector for a clicked card).
 * Esc closes the panel, then leaves focus.
 */
export function FocusLayer({ tree, snapshot, onWrite, onExit }: { tree: TreeNode; snapshot: Graph; onWrite: () => void; onExit: () => void }) {
  const { session, focusId, setFocusId } = useGraph();
  const [panel, setPanel] = useState<Panel | null>(null);
  // A clicked card always wins; the icon panels come back when it is closed.
  const shown: Panel | "inspector" | null = focusId ? "inspector" : panel;
  const openComments = snapshot.comments.filter((c) => c.mergedIntoRootVersion === undefined).length;
  const openItems = session.select.completeness().count;

  const toggle = (p: Panel) => {
    if (focusId) setFocusId(null);
    setPanel((cur) => (cur === p && !focusId ? null : p));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (focusId) setFocusId(null);
      else if (panel) setPanel(null);
      else onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, panel, setFocusId, onExit]);

  return (
    <div className="fixed inset-0 z-30 bg-[#f3f5f2]" data-focus-mode>
      <TreeCanvas tree={tree} />

      <div role="toolbar" aria-label="Focus tools" className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border border-line bg-paper/90 p-1 shadow-sm backdrop-blur">
        <FocusButton label="Comments" active={shown === "comments"} badge={openComments} onClick={() => toggle("comments")}>
          <Icon name="comment" />
        </FocusButton>
        <FocusButton label="Progress" active={shown === "progress"} badge={openItems} onClick={() => toggle("progress")}>
          <Icon name="progress" />
        </FocusButton>
        <FocusButton label="Write a document" onClick={onWrite}>
          <Icon name="document" />
        </FocusButton>
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <FocusButton label="Leave focus (Esc)" onClick={onExit}>
          <Icon name="exit" />
        </FocusButton>
      </div>

      {shown && (
        <aside
          aria-label={shown === "inspector" ? "Selected node" : shown === "comments" ? "Comments" : "Progress"}
          className="absolute bottom-4 right-3 top-16 w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-line bg-paper p-4 shadow-lg"
        >
          {shown === "inspector" && focusId && <Inspector tree={tree} nodeId={focusId} />}
          {shown === "comments" && <Comments snapshot={snapshot} />}
          {shown === "progress" && <Progress snapshot={snapshot} />}
        </aside>
      )}
    </div>
  );
}

function FocusButton({ label, active, badge, onClick, children }: { label: string; active?: boolean; badge?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      className={`relative grid size-9 place-items-center rounded-md transition-colors ${active ? "bg-ink text-white" : "text-ink-2 hover:bg-black/5 hover:text-ink"}`}
    >
      {children}
      {badge ? (
        <span className={`absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full px-1 text-[10px] font-semibold leading-4 ${active ? "bg-white text-ink" : "bg-cobalt text-white"}`}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}
