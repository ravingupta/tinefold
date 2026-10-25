import type { Graph } from "../schema/graph";

/** Memoise a selector by snapshot identity. Snapshots are immutable, so identity is enough. */
export function memo<R>(fn: (g: Graph) => R): (g: Graph) => R {
  const cache = new WeakMap<Graph, R>();
  return (g) => {
    if (cache.has(g)) return cache.get(g)!;
    const r = fn(g);
    cache.set(g, r);
    return r;
  };
}

/** Memoise a keyed selector by snapshot identity, then by key. */
export function memoBy<R>(fn: (g: Graph, key: string) => R): (g: Graph, key: string) => R {
  const cache = new WeakMap<Graph, Map<string, R>>();
  return (g, key) => {
    let byKey = cache.get(g);
    if (!byKey) cache.set(g, (byKey = new Map()));
    if (byKey.has(key)) return byKey.get(key)!;
    const r = fn(g, key);
    byKey.set(key, r);
    return r;
  };
}
