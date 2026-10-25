import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "graph"; id: string }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "settings" };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("g/")) return { name: "graph", id: decodeURIComponent(h.slice(2)) };
  if (h.startsWith("p/")) return { name: "project", id: decodeURIComponent(h.slice(2)) };
  if (h === "projects") return { name: "projects" };
  if (h === "settings") return { name: "settings" };
  return { name: "home" };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  for (const l of listeners) l();
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function go(r: Route): void {
  location.hash = href(r);
}

export function href(r: Route): string {
  switch (r.name) {
    case "graph":
      return `#/g/${encodeURIComponent(r.id)}`;
    case "project":
      return `#/p/${encodeURIComponent(r.id)}`;
    case "projects":
      return "#/projects";
    case "settings":
      return "#/settings";
    default:
      return "#/";
  }
}
