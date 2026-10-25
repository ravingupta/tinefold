import { useSyncExternalStore, useEffect, useState } from "react";
import {
  ProjectService,
  createGraph,
  importGraph,
  openSession,
  type Graph,
  type GraphListing,
  type Project,
  type Session,
  type SessionOptions,
} from "@ravingupta/tinefold-engine";
import { DexieStorageAdapter } from "../storage/DexieStorageAdapter";
import { exampleEvents } from "../examples";
import { buildProviders, buildRegistry, loadSettings, saveSettings, type Settings } from "../settings/settings";

/** One storage adapter and one session per open graph for the whole app. */
export const storage = new DexieStorageAdapter();
export const projects = new ProjectService({ storage });
const sessions = new Map<string, Promise<Session>>();
const settingsListeners = new Set<() => void>();
let settings = loadSettings();

function sessionOptions(): SessionOptions {
  return { storage, providers: buildProviders(settings), registry: buildRegistry(settings) };
}

export function getSettings(): Settings {
  return settings;
}

export function updateSettings(next: Settings): void {
  settings = next;
  saveSettings(next);
  for (const p of sessions.values()) {
    void p.then((s) => {
      s.setProviders(buildProviders(next));
      s.setRegistry(buildRegistry(next));
    });
  }
  for (const l of settingsListeners) l();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    () => settings,
  );
}

export function loadSession(graphId: string): Promise<Session> {
  let p = sessions.get(graphId);
  if (!p) {
    p = openSession(graphId, sessionOptions());
    p.catch(() => sessions.delete(graphId));
    sessions.set(graphId, p);
  }
  return p;
}

export async function newGraph(statement: string, projectId?: string): Promise<string> {
  const s = await createGraph(statement, sessionOptions());
  sessions.set(s.graphId, Promise.resolve(s));
  if (projectId) await projects.addGraph(projectId, s.graphId);
  bumpGraphs();
  return s.graphId;
}

export async function importEvents(events: unknown[]): Promise<string> {
  const s = await importGraph(events, sessionOptions());
  sessions.set(s.graphId, Promise.resolve(s));
  bumpGraphs();
  return s.graphId;
}

const EXAMPLE_KEY = "tinefold.exampleIds";

/** Ids of brainstorms opened from the bundled example (UI state, this browser only). */
function exampleIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(EXAMPLE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Import the example, mark its name so it's recognisable, and remember its id. */
export async function openExample(): Promise<string> {
  const s = await importGraph(exampleEvents, sessionOptions());
  sessions.set(s.graphId, Promise.resolve(s));
  await s.rename(`[Example] ${s.name()}`.slice(0, 60));
  try {
    localStorage.setItem(EXAMPLE_KEY, JSON.stringify([...exampleIds(), s.graphId]));
  } catch {
    // Without storage the button just stays visible.
  }
  bumpGraphs();
  return s.graphId;
}

/** True while an opened example is still in the list; deleting it brings the button back. */
export function hasExample(graphs: GraphListing[]): boolean {
  const ids = new Set(exampleIds());
  return graphs.some((g) => ids.has(g.id));
}

export async function removeGraph(graphId: string): Promise<void> {
  sessions.delete(graphId);
  await storage.deleteGraph(graphId);
  await projects.forgetGraph(graphId);
  bumpGraphs();
}

export function aiOptions() {
  return { providers: buildProviders(settings), registry: buildRegistry(settings) };
}

// --- lists that refresh when projects or brainstorms change ---

let listVersion = 0;
const listListeners = new Set<() => void>();
function bumpGraphs() {
  listVersion++;
  for (const l of listListeners) l();
}
projects.subscribe(() => bumpGraphs());

function useListVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listListeners.add(cb);
      return () => listListeners.delete(cb);
    },
    () => listVersion,
  );
}

export function useProjects(): Project[] | null {
  const v = useListVersion();
  const [list, setList] = useState<Project[] | null>(null);
  useEffect(() => {
    let live = true;
    projects.list().then((l) => live && setList(l), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [v]);
  return list;
}

export function useGraphList(): GraphListing[] | null {
  const v = useListVersion();
  const [list, setList] = useState<GraphListing[] | null>(null);
  useEffect(() => {
    let live = true;
    storage.listGraphs().then((l) => live && setList(l), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [v]);
  return list;
}

/** Current snapshots of several brainstorms, re-rendered when any of them changes. */
export function useGraphs(ids: string[]): Graph[] | null {
  const key = ids.join("|");
  const [graphs, setGraphs] = useState<Graph[] | null>(null);
  useEffect(() => {
    let live = true;
    const unsubs: (() => void)[] = [];
    Promise.allSettled(ids.map((id) => loadSession(id))).then((results) => {
      if (!live) return;
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const refresh = () => live && setGraphs(ok.map((s) => s.getSnapshot()));
      ok.forEach((s) => unsubs.push(s.subscribe(refresh)));
      refresh();
    });
    return () => {
      live = false;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return graphs;
}

export function useSession(graphId: string): { session: Session | null; error: unknown } {
  const [state, setState] = useState<{ session: Session | null; error: unknown }>({ session: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ session: null, error: null });
    loadSession(graphId).then(
      (session) => live && setState({ session, error: null }),
      (error) => live && setState({ session: null, error }),
    );
    return () => {
      live = false;
    };
  }, [graphId]);
  return state;
}

/** Re-render on every snapshot change. The snapshot is the only app state. */
export function useSnapshot(session: Session): Graph {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.getSnapshot(),
  );
}
