import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Session, TreeNode } from "@ravingupta/tinefold-engine";
import { toUiError, type UiError } from "../app/errors";

interface Ctx {
  session: Session;
  /** key → label of the action in flight. Pending is per node, never global. */
  busy: Record<string, string>;
  run: (key: string, fn: () => Promise<unknown>) => Promise<boolean>;
  error: (UiError & { key: string }) | null;
  dismissError: () => void;
  /** Where a node from an old branch can be reused. */
  portTargets: (node: TreeNode) => { id: string; title: string }[];
  prefillComment: string | null;
  setPrefillComment: (t: string | null) => void;
  /** The node open in the inspector (tree view). */
  focusId: string | null;
  setFocusId: (id: string | null) => void;
}

const GraphCtx = createContext<Ctx | null>(null);

export function GraphProvider({ session, tree, children }: { session: Session; tree: TreeNode; children: ReactNode }) {
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<(UiError & { key: string }) | null>(null);
  const [prefillComment, setPrefillComment] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [key]: key }));
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError({ ...toUiError(e), key });
      return false;
    } finally {
      setBusy((b) => {
        const { [key]: _, ...rest } = b;
        return rest;
      });
    }
  }, []);

  const portTargets = useCallback(
    (node: TreeNode) => {
      const out: { id: string; title: string }[] = [];
      const walk = (n: TreeNode) => {
        if (n.state !== "active") return;
        if (node.kind === "problem" && n.kind === "solution" && n.selected) out.push({ id: n.id, title: n.title });
        if (node.kind === "solution" && n.kind === "problem" && !n.isRoot) out.push({ id: n.id, title: n.title });
        n.children.forEach(walk);
      };
      walk(tree);
      return out;
    },
    [tree],
  );

  const value = useMemo(
    () => ({ session, busy, run, error, dismissError: () => setError(null), portTargets, prefillComment, setPrefillComment, focusId, setFocusId }),
    [session, busy, run, error, portTargets, prefillComment, focusId],
  );
  return <GraphCtx.Provider value={value}>{children}</GraphCtx.Provider>;
}

export function useGraph(): Ctx {
  const c = useContext(GraphCtx);
  if (!c) throw new Error("useGraph outside GraphProvider");
  return c;
}
