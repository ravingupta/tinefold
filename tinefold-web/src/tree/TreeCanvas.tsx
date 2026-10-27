import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { ROOT_NODE_ID, type TreeNode } from "@ravingupta/tinefold-engine";
import { useGraph } from "../outline/GraphContext";

/** Card sizes. Fixed so the layout is a pure function of the tree. */
const W = 236;
const ROOT_W = 340;
const H: Record<string, number> = { root: 132, problem: 96, solution: 104, clarification: 96 };
const GAP_X = 28;
const GAP_Y = 64;
/** Below this zoom card text is unreadable, so the first view never starts smaller. */
const READABLE = 0.72;

interface CardData extends Record<string, unknown> {
  node: TreeNode;
  /** Children hidden because this is an unchosen option you explored earlier. */
  hiddenCount: number;
  expandedHere: boolean;
  onToggle: (id: string) => void;
}

type CardNode = Node<CardData, "card">;

/**
 * What the canvas shows. "all": every option, chosen or not. "outcome": only the chosen path and what is still
 * open, so the tree reads as the decision it has become. Switching is presentation only; nothing is stored.
 */
export type Lens = "all" | "outcome";

/**
 * Which children are drawn as cards: a problem shows its options; only chosen (or opened) options show their
 * sub-problems. Questions are never cards (nothing to choose between); the card that asked them carries a
 * badge, and the inspector lists them with their answers. Under the outcome lens, unchosen options and
 * disabled branches are left out entirely.
 */
function visibleChildren(n: TreeNode, opened: ReadonlySet<string>, lens: Lens): TreeNode[] {
  if (n.kind === "solution" && !n.selected && (lens === "outcome" || !opened.has(n.id))) return [];
  return n.children.filter((c) => {
    if (c.kind === "clarification") return false;
    if (lens === "outcome") return c.state !== "disabled" && !(c.kind === "solution" && !c.selected);
    return true;
  });
}

function questionsOf(n: TreeNode): { answered: number; open: number } {
  const qs = n.children.filter((c) => c.kind === "clarification" && c.state !== "disabled");
  const open = qs.filter((q) => !q.answer).length;
  return { answered: qs.length - open, open };
}

function heightOf(n: TreeNode): number {
  return n.isRoot ? H.root! : H[n.kind]!;
}

export function TreeCanvas({ tree, lens = "all" }: { tree: TreeNode; lens?: Lens }) {
  return (
    <ReactFlowProvider>
      <Canvas tree={tree} lens={lens} />
    </ReactFlowProvider>
  );
}

function Canvas({ tree, lens }: { tree: TreeNode; lens: Lens }) {
  const { focusId, setFocusId, busy } = useGraph();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const flow = useReactFlow();
  // Growth detection below reads the lens without re-running on every switch.
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const toggle = useCallback((id: string) => {
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { nodes, edges } = useMemo(() => layout(tree, opened, toggle, focusId, lens), [tree, opened, toggle, focusId, lens]);

  // Fit when the whole tree stays readable; otherwise start at the problem at a readable zoom.
  const fitReadable = useCallback(
    (duration: number) =>
      void flow.fitView({ padding: 0.12, maxZoom: 1, duration }).then(() => {
        if (flow.getViewport().zoom >= READABLE) return;
        const root = flow.getNode(tree.id);
        if (!root) return;
        const el = document.querySelector(".react-flow") as HTMLElement | null;
        const h = el?.clientHeight ?? 600;
        flow.setCenter(root.position.x + ROOT_W / 2, root.position.y + h / 2 / READABLE - 40, { zoom: READABLE, duration });
      }),
    [flow, tree.id],
  );

  // Switching lens changes what is on the canvas, so refit around it.
  const lensMounted = useRef(false);
  useEffect(() => {
    if (!lensMounted.current) {
      lensMounted.current = true;
      return;
    }
    requestAnimationFrame(() => fitReadable(300));
  }, [lens, fitReadable]);

  // When a node gains children, bring them into view (the user just asked for them).
  const childCount = useRef(new Map<string, number>());
  const first = useRef(true);
  useEffect(() => {
    const prev = childCount.current;
    const grown: string[] = [];
    const walk = (n: TreeNode) => {
      const c = visibleChildren(n, new Set(), lensRef.current).length;
      if ((prev.get(n.id) ?? c) < c) grown.push(n.id);
      prev.set(n.id, c);
      n.children.forEach(walk);
    };
    walk(tree);
    if (first.current) {
      first.current = false;
      requestAnimationFrame(() => requestAnimationFrame(() => fitReadable(0)));
      return;
    }
    if (grown.length) {
      const target = grown[grown.length - 1]!;
      const t = findNode(tree, target);
      const ids = [target, ...(t ? visibleChildren(t, new Set(), lensRef.current).map((c) => c.id) : [])];
      requestAnimationFrame(() => flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, maxZoom: 1, duration: 450 }));
    }
  }, [tree, flow, fitReadable]);

  // Focusing a node from elsewhere (the rail, a link) pans to it.
  useEffect(() => {
    if (!focusId) return;
    const n = flow.getNode(focusId);
    if (!n) return;
    const { zoom } = flow.getViewport();
    const w = (n.width ?? W) / 2;
    const h = (n.height ?? 90) / 2;
    flow.setCenter(n.position.x + w, n.position.y + h, { zoom: Math.max(zoom, 0.8), duration: 350 });
  }, [focusId, flow]);

  const anyBusy = Object.keys(busy).length > 0;

  return (
    <div className="relative h-full w-full" data-busy={anyBusy || undefined}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => setFocusId(n.id)}
        onPaneClick={() => setFocusId(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        panOnScroll
        zoomOnPinch
        aria-label="Brainstorm tree"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#c4ccc5" />
        <Controls showInteractive={false} position="top-left" />
        <MiniMap
          className="!hidden sm:!block"
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => {
            const d = (n as CardNode).data.node;
            if (d.state === "disabled") return "#d3d9d3";
            if (d.kind === "problem") return "#2f7a5a";
            return d.selected ? "#2747d0" : "#bcc5bd";
          }}
          maskColor="rgba(236,239,235,0.7)"
          style={{ width: 150, height: 100, border: "1px solid #d3d9d3", borderRadius: 8 }}
        />
      </ReactFlow>
      <Legend lens={lens} />
    </div>
  );
}

function findNode(t: TreeNode, id: string): TreeNode | undefined {
  if (t.id === id) return t;
  for (const c of t.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}

function layout(tree: TreeNode, opened: ReadonlySet<string>, onToggle: (id: string) => void, focusId: string | null, lens: Lens) {
  const root = hierarchy(tree, (n) => visibleChildren(n, opened, lens));
  const laid = d3tree<TreeNode>()
    .nodeSize([W + GAP_X, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.25) * (a.data.isRoot || b.data.isRoot ? ROOT_W / W : 1))(root);

  // Depth → y offset, using the tallest card at each depth so rows never overlap.
  const rowH = new Map<number, number>();
  laid.each((n) => rowH.set(n.depth, Math.max(rowH.get(n.depth) ?? 0, heightOf(n.data))));
  const rowY = new Map<number, number>();
  let y = 0;
  for (let d = 0; d <= (laid.height ?? 0); d++) {
    rowY.set(d, y);
    y += (rowH.get(d) ?? 0) + GAP_Y;
  }

  const nodes: CardNode[] = [];
  const edges: Edge[] = [];
  laid.each((p: HierarchyPointNode<TreeNode>) => {
    const n = p.data;
    const width = n.isRoot ? ROOT_W : W;
    const hidden = lens === "all" && n.kind === "solution" && !n.selected ? n.children.length : 0;
    nodes.push({
      id: n.id,
      type: "card",
      position: { x: p.x - width / 2, y: rowY.get(p.depth)! },
      data: { node: n, hiddenCount: hidden, expandedHere: opened.has(n.id), onToggle },
      width,
      height: heightOf(n),
      selected: focusId === n.id,
      ariaLabel: `${kindLabel(n)}: ${n.title}`,
    });
    if (p.parent) edges.push(edgeFor(p.parent.data, n));
  });
  return { nodes, edges };
}

function edgeFor(parent: TreeNode, child: TreeNode): Edge {
  const chosenPath = child.state === "active" && parent.state === "active";
  let style: React.CSSProperties;
  if (child.kind === "clarification") style = { stroke: "#9aa59c", strokeWidth: 1.5, strokeDasharray: "2 4" };
  else if (child.kind === "solution" && child.selected && chosenPath) style = { stroke: "#2747d0", strokeWidth: 3 };
  else if (child.kind === "solution") style = { stroke: "#a9b3ab", strokeWidth: 1.5, strokeDasharray: "6 5" };
  else if (chosenPath) style = { stroke: "#2747d0", strokeWidth: 2.25 };
  else style = { stroke: "#a9b3ab", strokeWidth: 1.5 };
  if (child.state === "disabled") style = { ...style, opacity: 0.55 };
  return { id: `${parent.id}->${child.id}`, source: parent.id, target: child.id, type: "smoothstep", style, focusable: false };
}

function kindLabel(n: TreeNode): string {
  if (n.isRoot) return n.version > 1 ? `The problem · v${n.version}` : "The problem";
  if (n.kind === "clarification") return "Question";
  if (n.kind === "solution") return n.selected ? "Chosen" : "Option";
  return "Sub-problem";
}

const Card = memo(function Card({ data, selected }: NodeProps<CardNode>) {
  const { node: n, hiddenCount, expandedHere, onToggle } = data;
  const { session, busy, run, setFocusId } = useGraph();
  const q = questionsOf(n);
  const pending = !!busy[`expand:${n.id}`] || !!busy[`select:${n.parentId}`] || !!busy[`answer:${n.id}`] || !!busy[`check:${n.id}`];
  const problemId = n.parentId ?? ROOT_NODE_ID;
  const dim = n.state === "disabled";

  // Two silhouettes: problems are tinted, square-cornered, with a moss spine on the left;
  // options are white, rounder, and only the chosen one takes cobalt.
  const isProblem = n.kind === "problem";
  const frame =
    n.kind === "clarification"
      ? "rounded-lg border-dashed border-line-2 bg-ground"
      : n.kind === "solution"
        ? n.selected
          ? "rounded-xl border-cobalt border-2 bg-paper"
          : "rounded-xl border-line-2 bg-paper"
        : n.isRoot
          ? "rounded-md border-moss border-2 bg-moss-soft pl-4"
          : "rounded-md border-moss-line bg-moss-soft pl-4";
  const markBar = n.mark === "red" ? "bg-brick" : n.mark === "yellow" ? "bg-amber" : null;

  const action =
    n.canExpand && n.kind !== "clarification"
      ? n.openQuestions > 0
        ? { label: "Answer questions", onClick: () => setFocusId(n.id) }
        : { label: n.kind === "solution" ? "Break down" : n.isRoot ? "Suggest approaches" : "Suggest options", onClick: () => run(`expand:${n.id}`, () => session.expand(n.id)) }
      : null;

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden border px-3 py-2 text-left shadow-[0_1px_2px_rgba(24,33,43,0.06)] transition-shadow ${frame} ${dim ? "opacity-50" : ""} ${selected ? "ring-2 ring-cobalt ring-offset-2 ring-offset-ground" : ""} ${n.isSuggestedNext ? "shadow-[0_0_0_4px_rgba(39,71,208,0.12)]" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      {isProblem && <span className="absolute inset-y-0 left-0 w-[4px] bg-moss" aria-hidden />}
      {markBar && <span className={`absolute inset-x-0 top-0 h-[3px] ${markBar}`} aria-hidden />}
      <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
        {n.kind === "solution" && !dim && (
          <button
            type="button"
            role="radio"
            aria-checked={n.selected}
            aria-label={n.selected ? `Undo choice: ${n.title}` : `Choose ${n.title}`}
            onClick={(e) => {
              e.stopPropagation();
              void run(`select:${problemId}`, () => session.selectSolution(problemId, n.selected ? null : n.id));
            }}
            className={`nodrag grid size-[14px] shrink-0 place-items-center rounded-full border-2 ${n.selected ? "border-cobalt" : "border-ink-3 hover:border-cobalt"}`}
          >
            {n.selected && <span className="size-1.5 rounded-full bg-cobalt" />}
          </button>
        )}
        <span className={n.selected ? "font-medium text-cobalt" : isProblem ? "font-medium text-moss" : ""}>{kindLabel(n)}</span>
        {n.recommended && !n.selected && <span className="rounded bg-cobalt-soft px-1 text-cobalt">Suggested</span>}
        {n.isSuggestedNext && <span className="rounded bg-cobalt-soft px-1 text-cobalt">Start here</span>}
        {n.isLeaf && <span className="rounded bg-ground px-1 text-ink-2">Ready to build</span>}
        {n.portedFrom && <span className="rounded bg-ground px-1 text-ink-2">Reused</span>}
        {n.mark === "yellow" && <span className="text-amber">may be stale</span>}
        {n.mark === "red" && <span className="text-brick">stale</span>}
      </div>
      <p className={`mt-1 font-semibold leading-snug text-ink ${n.isRoot ? "line-clamp-2 text-[14px]" : "line-clamp-2 text-[13px]"}`} title={n.isRoot ? n.summary : n.title}>
        {n.title}
      </p>
      {n.isRoot && <p className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-ink-2">{n.summary}</p>}
      {n.kind === "clarification" && n.answer && (
        <p className="mt-1 line-clamp-1 text-[12px] font-medium text-cobalt">{n.answer.label}</p>
      )}
      {n.kind === "clarification" && !n.answer && !dim && <p className="mt-1 text-[12px] text-amber">Needs an answer</p>}
      {n.kind === "solution" && n.axisValue && !n.selected && <p className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{n.axisValue}</p>}
      <span className="flex-1" />
      <div className="flex items-center gap-2">
        {pending ? (
          <span className="thinking text-[12px] font-medium text-cobalt">Thinking…</span>
        ) : action ? (
          action.onClick ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void action.onClick!();
              }}
              className={`nodrag rounded px-2 py-0.5 text-[12px] font-medium ${n.isSuggestedNext || n.isRoot ? "bg-cobalt text-white hover:bg-[#1f3bb3]" : "border border-line-2 bg-paper text-ink hover:border-ink-3"}`}
            >
              {action.label}
            </button>
          ) : (
            <span className="text-[12px] text-amber">{action.label}</span>
          )
        ) : null}
        <span className="flex-1" />
        {q.answered + q.open > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFocusId(n.id);
            }}
            className={`nodrag rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 ${q.open ? "font-medium text-amber" : "text-ink-3 hover:text-ink"}`}
            title="Questions asked here, with their answers. Click to see or change them."
            aria-label={q.open ? `${q.open} ${q.open === 1 ? "question needs" : "questions need"} an answer` : `${q.answered} ${q.answered === 1 ? "question" : "questions"} answered`}
          >
            {q.open ? `${q.open} to answer` : `${q.answered} answered`}
          </button>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(n.id);
            }}
            className="nodrag rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-black/5 hover:text-ink"
            title="Sub-problems you explored under this option before choosing another"
          >
            {expandedHere ? "Fold" : `+${hiddenCount} explored`}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
    </div>
  );
});

const nodeTypes = { card: Card };

function Legend({ lens }: { lens: Lens }) {
  if (lens === "outcome") {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-md sm:block border border-line bg-paper/90 px-3 py-2 text-[11px] text-ink-2 backdrop-blur">
        <p className="font-medium text-ink">Outcome</p>
        <p className="mt-0.5">What you chose and what is still open. Alternatives are hidden.</p>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-md sm:block border border-line bg-paper/90 px-3 py-2 text-[11px] text-ink-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="relative h-[14px] w-[28px] overflow-hidden rounded-[3px] border border-moss-line bg-moss-soft" aria-hidden>
          <span className="absolute inset-y-0 left-0 w-[3px] bg-moss" />
        </span>
        Problem to solve
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-[14px] w-[28px] rounded-[6px] border border-line-2 bg-paper" aria-hidden />
        Option to pick
      </div>
      <div className="mt-2 flex items-center gap-2">
        <svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#2747d0" strokeWidth="3" /></svg>
        Chosen path
      </div>
      <div className="mt-1 flex items-center gap-2">
        <svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#a9b3ab" strokeWidth="1.5" strokeDasharray="6 5" /></svg>
        Alternatives: pick one
      </div>
      <div className="mt-1 flex items-center gap-2">
        <svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="#46525e" strokeWidth="1.5" /></svg>
        Sub-problems: solve all
      </div>
    </div>
  );
}
