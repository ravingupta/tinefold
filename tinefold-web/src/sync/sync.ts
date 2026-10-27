import { GraphEvent, Project, graphName, isEngineError, replay, type AiCall, type Graph } from "@ravingupta/tinefold-engine";
import type { DexieStorageAdapter } from "../storage/DexieStorageAdapter";
import { MemoryTarget, type Kind, type SyncTarget } from "./target";
import guide from "./AI-GUIDE.md?raw";

export const MANIFEST = "tinefold-sync.json";
export const GUIDE = "AI-GUIDE.md";

/** What a sync touches on this device. The app wires these to its storage and open sessions. */
export interface SyncStore {
  storage: Pick<
    DexieStorageAdapter,
    | "listGraphs"
    | "readEvents"
    | "replaceGraph"
    | "deleteGraph"
    | "listProjects"
    | "writeProject"
    | "deleteProject"
    | "allAiCalls"
    | "appendAiCalls"
  >;
  /** Keep this device's version of a brainstorm under a new id, named so it's recognisable. */
  importCopy(events: GraphEvent[], name: string): Promise<string>;
  /** Drop any open session for a brainstorm whose log was replaced or deleted. */
  forget(graphId: string): void;
}

/** Fingerprint of each file as of the last sync, keyed "brainstorms/<id>" or "projects/<id>". */
export type SyncHashes = Record<string, string>;

export interface SyncReport {
  pulled: number;
  pushed: number;
  removed: number;
  /** Names of brainstorms both sides changed; this device's version was kept as a copy. */
  copies: string[];
  /** Files that were skipped, with the reason. Nothing is written for them on either side. */
  problems: string[];
  hashes: SyncHashes;
}

/**
 * Merge this device with a target, both ways. Per file, against the fingerprint from the last sync:
 * only one side changed → that side wins; both changed → the longer log wins when the other is a
 * prefix of it, otherwise the target's version wins and this device's is kept as a copy (projects:
 * the newer updatedAt wins). Ids in the manifest's `deleted` list, plus `pendingDeletes`, are
 * removed everywhere. AI call logs are append-only, so they merge as the union of both sides.
 */
export async function syncWith(target: SyncTarget, store: SyncStore, prev: SyncHashes, pendingDeletes: string[] = []): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, pushed: 0, removed: 0, copies: [], problems: [], hashes: { ...prev } };
  const { storage } = store;
  const remote = { brainstorms: await target.list("brainstorms"), projects: await target.list("projects"), logs: await target.list("logs") };
  const localGraphs = new Set((await storage.listGraphs()).map((g) => g.id));
  const localProjects = new Map((await storage.listProjects()).map((p) => [p.id, p]));

  // Deletions first, so a brainstorm deleted on one device is not pulled back by another.
  const manifestText = await target.readRoot(MANIFEST);
  const deleted = new Set([...readManifest(manifestText), ...pendingDeletes]);
  for (const id of deleted) {
    let hit = false;
    if (localGraphs.delete(id)) {
      await storage.deleteGraph(id);
      store.forget(id);
      hit = true;
    }
    if (localProjects.delete(id)) {
      await storage.deleteProject(id);
      hit = true;
    }
    for (const kind of ["brainstorms", "projects"] as const) {
      if (remote[kind].delete(id)) await target.remove(kind, id);
      delete report.hashes[`${kind}/${id}`];
    }
    if (remote.logs.delete(id)) await target.remove("logs", id);
    if (hit) report.removed++;
  }
  const manifest = serialize({ format: "tinefold-sync", version: 1, deleted: [...deleted].sort() });
  if (manifestText !== manifest) await target.writeRoot(MANIFEST, manifest);
  if ((await target.readRoot(GUIDE)) !== guide) await target.writeRoot(GUIDE, guide);

  const copies: string[] = [];
  for (const id of new Set([...localGraphs, ...remote.brainstorms.keys()])) {
    const parsed = remote.brainstorms.has(id) ? parseBrainstorm(id, remote.brainstorms.get(id)!) : null;
    if (typeof parsed === "string") {
      report.problems.push(`brainstorms/${id}.json: ${parsed}`);
      continue;
    }
    const local = localGraphs.has(id) ? await storage.readEvents(id) : null;
    const merged = await merge(target, report, "brainstorms", id, local, parsed?.events ?? null, remote.brainstorms.get(id), {
      take: async (events) => {
        await storage.replaceGraph(id, events, parsed!.snapshot);
        store.forget(id);
      },
      conflict: async (mine, theirs) => {
        if (isPrefix(theirs, mine)) return "local";
        if (isPrefix(mine, theirs)) return "remote";
        const name = graphName(replay(mine));
        copies.push(await store.importCopy(mine, `${name.slice(0, 44)} (this device)`));
        report.copies.push(name);
        return "remote";
      },
    });
    if (merged) report.hashes[`brainstorms/${id}`] = merged;
  }
  // Copies made above are new here, so they go to the target in this same sync.
  for (const id of copies) {
    const events = await storage.readEvents(id);
    await target.write("brainstorms", id, serialize(events));
    report.hashes[`brainstorms/${id}`] = fingerprint(events);
    report.pushed++;
  }

  for (const id of new Set([...localProjects.keys(), ...remote.projects.keys()])) {
    const parsed = remote.projects.has(id) ? parseProject(id, remote.projects.get(id)!) : null;
    if (typeof parsed === "string") {
      report.problems.push(`projects/${id}.json: ${parsed}`);
      continue;
    }
    const merged = await merge(target, report, "projects", id, localProjects.get(id) ?? null, parsed, remote.projects.get(id), {
      take: (p) => storage.writeProject(p),
      conflict: async (mine, theirs) => (mine.updatedAt >= theirs.updatedAt ? "local" : "remote"),
    });
    if (merged) report.hashes[`projects/${id}`] = merged;
  }

  const localLogs = await storage.allAiCalls();
  for (const id of new Set([...localLogs.keys(), ...remote.logs.keys()])) {
    if (deleted.has(id)) continue;
    const text = remote.logs.get(id);
    const theirs = text === undefined ? [] : parseLog(id, text);
    if (typeof theirs === "string") {
      report.problems.push(`logs/${id}.json: ${theirs}`);
      continue;
    }
    const mine = localLogs.get(id) ?? [];
    const known = new Set(mine.map((c) => c.id));
    const missing = theirs.filter((c) => !known.has(c.id));
    if (missing.length) await storage.appendAiCalls(missing);
    const all = [...mine, ...missing].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const out = serialize(all);
    if (text !== out) await target.write("logs", id, out);
  }
  return report;
}

/** A log is written by the app only, so it's checked just enough to merge safely. */
function parseLog(id: string, text: string): AiCall[] | string {
  try {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return "expected a list of AI calls";
    for (const c of data as Partial<AiCall>[]) {
      if (typeof c?.id !== "string" || typeof c.at !== "string" || typeof c.scope !== "object" || c.scope === null) return "every call needs an id, at and scope";
      if ((c.scope.graphId ?? c.scope.projectId) !== id) return `every call must belong to "${id}", the file's name`;
    }
    return data as AiCall[];
  } catch (e) {
    return reason(e);
  }
}

/** Decide one file, apply it, and return the fingerprint both sides now share. */
async function merge<T>(
  target: SyncTarget,
  report: SyncReport,
  kind: Kind,
  id: string,
  local: T | null,
  remote: T | null,
  remoteText: string | undefined,
  apply: { take: (v: T) => Promise<void>; conflict: (mine: T, theirs: T) => Promise<"local" | "remote"> },
): Promise<string> {
  const base = report.hashes[`${kind}/${id}`];
  const hL = local === null ? null : fingerprint(local);
  const hR = remote === null ? null : fingerprint(remote);
  let winner: "local" | "remote";
  if (remote === null) winner = "local";
  else if (local === null) winner = "remote";
  else if (hL === hR) winner = "local";
  else if (base === hL) winner = "remote";
  else if (base === hR) winner = "local";
  else winner = await apply.conflict(local, remote);

  const value = (winner === "local" ? local : remote)!;
  if (winner === "remote" && hL !== hR) {
    await apply.take(value);
    report.pulled++;
  }
  // Rewritten even after a pull when the file was hand-edited, so both sides match byte for byte.
  const text = serialize(value);
  if (remoteText !== text) {
    await target.write(kind, id, text);
    if (winner === "local" && hL !== hR) report.pushed++;
  }
  return fingerprint(value);
}

function parseBrainstorm(id: string, text: string): { events: GraphEvent[]; snapshot: Graph } | string {
  try {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return "expected a list of events";
    const events = data.map((e) => GraphEvent.parse(e));
    if (events.some((e) => e.graphId !== id)) return `every event's graphId must be "${id}", the file's name`;
    return { events, snapshot: replay(events) };
  } catch (e) {
    return reason(e);
  }
}

function parseProject(id: string, text: string): Project | string {
  try {
    const p = Project.parse(JSON.parse(text));
    return p.id === id ? p : `the project's id must be "${id}", the file's name`;
  } catch (e) {
    return reason(e);
  }
}

function readManifest(text: string | null): string[] {
  try {
    const d = JSON.parse(text ?? "{}") as { deleted?: unknown };
    return Array.isArray(d.deleted) ? d.deleted.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function reason(e: unknown): string {
  if (isEngineError(e)) return e.message;
  const issue = (e as { issues?: { path: PropertyKey[]; message: string }[] })?.issues?.[0];
  if (issue) return `${issue.path.map(String).join(".") || "value"}: ${issue.message}`;
  return e instanceof Error ? e.message : String(e);
}

function isPrefix(a: readonly GraphEvent[], b: readonly GraphEvent[]): boolean {
  return a.length <= b.length && a.every((e, i) => JSON.stringify(e) === JSON.stringify(b[i]));
}

function serialize(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

/** cyrb53: a fast 53-bit string hash. Only compares a file with itself across syncs. */
function fingerprint(v: unknown): string {
  const s = JSON.stringify(v);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// --- one-file backup, for browsers that can't keep a folder ---

export interface Backup {
  format: "tinefold-backup";
  version: 1;
  exportedAt: string;
  deleted: string[];
  brainstorms: Record<string, unknown>;
  projects: Record<string, unknown>;
}

export async function makeBackup(store: SyncStore, pendingDeletes: string[]): Promise<Backup> {
  const t = new MemoryTarget();
  await syncWith(t, store, {}, pendingDeletes);
  const read = (m: Map<string, string>) => Object.fromEntries([...m].map(([id, text]) => [id, JSON.parse(text) as unknown]));
  return {
    format: "tinefold-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    deleted: readManifest(t.root.get(MANIFEST) ?? null),
    brainstorms: read(t.files.brainstorms),
    projects: read(t.files.projects),
  };
}

/** Merge a backup into this device. Brainstorms changed on both sides keep this device's version as a copy. */
export async function restoreBackup(store: SyncStore, data: unknown): Promise<SyncReport> {
  const b = data as Partial<Backup> | null;
  if (b?.format !== "tinefold-backup") throw new Error("not a tinefold backup file");
  const t = new MemoryTarget();
  t.root.set(MANIFEST, serialize({ deleted: b.deleted ?? [] }));
  for (const kind of ["brainstorms", "projects"] as const) {
    for (const [id, v] of Object.entries(b[kind] ?? {})) t.files[kind].set(id, serialize(v));
  }
  return syncWith(t, store, {});
}
