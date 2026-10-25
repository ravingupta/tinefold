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

/** Which children are drawn: a problem shows its questions and options; only chosen (or opened) options show their sub-problems. */
function visibleChildren(n: TreeNode, opened: ReadonlySet<string>): TreeNode[] {
  if (n.kind === "solution" && !n.selected && !opened.has(n.id)) return [];
  return n.children;
}

function heightOf(n: TreeNode): number {
  return n.isRoot ? H.root! : H[n.kind]!;
}

export function TreeCanvas({ tree }: { tree: TreeNode }) {
  return (
    <ReactFlowProvider>
      <Canvas tree={tree} />
    </ReactFlowProvider>
  );
}

function Canvas({ tree }: { tree: TreeNode }) {
  const { focusId, setFocusId, busy } = useGraph();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const flow = useReactFlow();
  const toggle = useCallback((id: string) => {
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { nodes, edges } = useMemo(() => layout(tree, opened, toggle, focusId), [tree, opened, toggle, focusId]);

  // When a node gains children, bring them into view (the user just asked for them).
  const childCount = useRef(new Map<string, number>());
  const first = useRef(true);
  useEffect(() => {
    const prev = childCount.current;
    const grown: string[] = [];
    const walk = (n: TreeNode) => {
      const c = n.children.length;
      if ((prev.get(n.id) ?? c) < c) grown.push(n.id);
      prev.set(n.id, c);
      n.children.forEach(walk);
    };
    walk(tree);
    if (first.current) {
      first.current = false;
      // Fit when the whole tree stays readable; otherwise start at the problem at a readable zoom.
      const start = () => {
        void flow.fitView({ padding: 0.12, maxZoom: 1, duration: 0 }).then(() => {
          if (flow.getViewport().zoom >= READABLE) return;
          const root = flow.getNode(tree.id);
          if (!root) return;
          const el = document.querySelector(".react-flow") as HTMLElement | null;
          const h = el?.clientHeight ?? 600;
          flow.setCenter(root.position.x + ROOT_W / 2, root.position.y + h / 2 / READABLE - 40, { zoom: READABLE, duration: 0 });
        });
      };
      requestAnimationFrame(() => requestAnimationFrame(start));
      return;
    }
    if (grown.length) {
      const target = grown[grown.length - 1]!;
      const ids = [target, ...(findNode(tree, target)?.children.map((c) => c.id) ?? [])];
      requestAnimationFrame(() => flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, maxZoom: 1, duration: 450 }));
    }
  }, [tree, flow]);

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
            return d.selected || d.isRoot || (d.kind === "problem" && d.state === "active") ? "#2747d0" : "#bcc5bd";
          }}
          maskColor="rgba(236,239,235,0.7)"
          style={{ width: 150, height: 100, border: "1px solid #d3d9d3", borderRadius: 8 }}
        />
      </ReactFlow>
      <Legend />
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

function layout(tree: TreeNode, opened: ReadonlySet<string>, onToggle: (id: string) => void, focusId: string | null) {
  const root = hierarchy(tree, (n) => visibleChildren(n, opened));
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
    const hidden = n.kind === "solution" && !n.selected ? n.children.length : 0;
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
  const { session, busy, run } = useGraph();
  const pending = !!busy[`expand:${n.id}`] || !!busy[`select:${n.parentId}`] || !!busy[`answer:${n.id}`] || !!busy[`check:${n.id}`];
  const problemId = n.parentId ?? ROOT_NODE_ID;
  const dim = n.state === "disabled";

  const frame =
    n.kind === "clarification"
      ? "border-dashed border-line-2 bg-ground"
      : n.kind === "solution"
        ? n.selected
          ? "border-cobalt border-2 bg-paper"
          : "border-line-2 bg-paper"
        : n.isRoot
          ? "border-ink border-2 bg-paper"
          : "border-ink/70 bg-paper";
  const markBar = n.mark === "red" ? "bg-brick" : n.mark === "yellow" ? "bg-amber" : null;

  const action =
    n.canExpand && n.kind !== "clarification"
      ? n.openQuestions > 0
        ? { label: "Answer questions", onClick: null }
        : { label: n.kind === "solution" ? "Break down" : n.isRoot ? "Suggest approaches" : "Suggest options", onClick: () => run(`expand:${n.id}`, () => session.expand(n.id)) }
      : null;

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-lg border px-3 py-2 text-left shadow-[0_1px_2px_rgba(24,33,43,0.06)] transition-shadow ${frame} ${dim ? "opacity-50" : ""} ${selected ? "ring-2 ring-cobalt ring-offset-2 ring-offset-ground" : ""} ${n.isSuggestedNext ? "shadow-[0_0_0_4px_rgba(39,71,208,0.12)]" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
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
        <span className={n.selected || n.isRoot ? "font-medium text-cobalt" : ""}>{kindLabel(n)}</span>
        {n.recommended && !n.selected && <span className="rounded bg-cobalt-soft px-1 text-cobalt">Suggested</span>}
        {n.isSuggestedNext && <span className="rounded bg-cobalt-soft px-1 text-cobalt">Start here</span>}
        {n.isLeaf && <span className="rounded bg-ground px-1 text-ink-2">Ready to build</span>}
        {n.portedFrom && <span className="rounded bg-ground px-1 text-ink-2">Reused</span>}
        {n.mark === "yellow" && <span className="text-amber">may be stale</span>}
        {n.mark === "red" && <span className="text-brick">stale</span>}
      </div>
      <p className={`mt-1 font-semibold leading-snug text-ink ${n.isRoot ? "line-clamp-3 text-[14px]" : "line-clamp-2 text-[13px]"}`} title={n.title}>
        {n.title}
      </p>
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

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-md sm:block border border-line bg-paper/90 px-3 py-2 text-[11px] text-ink-2 backdrop-blur">
      <div className="flex items-center gap-2">
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
