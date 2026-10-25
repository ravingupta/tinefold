import { EngineError } from "../schema/errors";
import { ROOT_NODE_ID, parseRootVersionId, type Graph } from "../schema/graph";
import { currentChildren, currentRoot, kindOf, parentNodeIdOf } from "./lookup";
import { memo, memoBy } from "./memo";

/**
 * Enabled node ids in depth-first order. From the root (a problem):
 * problem → its selected solution, plus clarifications on its current version;
 * solution → every child on its current version; clarification → nothing.
 * A selection is followed even when it hangs off an older version of its problem.
 * The root itself is not listed.
 */
export const enabledOrder = memo((g: Graph): readonly string[] => {
  const out: string[] = [];
  const visit = (nodeId: string): void => {
    const kind = kindOf(g, nodeId);
    const children = currentChildren(g, nodeId);
    if (kind === "solution") {
      for (const c of children) {
        out.push(c);
        visit(c);
      }
    } else if (kind === "problem") {
      const selected = g.selections[nodeId] ?? null;
      for (const c of children) {
        if (c === selected || kindOf(g, c) === "clarification") {
          out.push(c);
          visit(c);
        }
      }
      if (selected !== null && !children.includes(selected)) {
        out.push(selected);
        visit(selected);
      }
    }
  };
  visit(ROOT_NODE_ID);
  return out;
});

export const enabledSet = memo((g: Graph): ReadonlySet<string> => new Set(enabledOrder(g)));

/** Ids from the root to the node, inclusive, root first. */
export const nodePath = memoBy((g: Graph, nodeId: string): readonly string[] => {
  if (nodeId === ROOT_NODE_ID) return [ROOT_NODE_ID];
  const parent = parentNodeIdOf(g, nodeId);
  if (parent === undefined) throw new EngineError("ValidationFailed", `unknown node ${nodeId}`);
  return [...nodePath(g, parent), nodeId];
});

/** The root version a node descends from. */
export const rootVersionOf = memoBy((g: Graph, nodeId: string): number => {
  const n = g.nodes[nodeId];
  if (!n) return currentRoot(g).version;
  const rv = parseRootVersionId(n.parentVersionId);
  return rv ?? rootVersionOf(g, parentNodeIdOf(g, nodeId)!);
});

/** enabledSet restricted to descendants of the current root version, in depth-first order. */
export const activeSubtree = memo((g: Graph): ReadonlySet<string> => {
  const current = currentRoot(g).version;
  return new Set(enabledOrder(g).filter((id) => rootVersionOf(g, id) === current));
});

/** True when `ancestor` is on the path from the root to `nodeId` (inclusive). */
export function isWithin(g: Graph, nodeId: string, ancestor: string): boolean {
  return nodePath(g, nodeId).includes(ancestor);
}
