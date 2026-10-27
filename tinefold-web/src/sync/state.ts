import { useSyncExternalStore } from "react";
import { bumpGraphs, forgetSession, importCopy, storage } from "../app/sessions";
import { clearDeleted, pendingDeletes } from "./deleted";
import { makeBackup, restoreBackup, syncWith, type Backup, type SyncHashes, type SyncReport, type SyncStore } from "./sync";
import { FolderTarget, ensureAccess, pickFolder } from "./target";

const STATE_KEY = "tinefold.sync";
const HANDLE_KEY = "syncFolder";

export interface SyncStatus {
  /** False until the saved folder (if any) has been read back from storage. */
  loaded: boolean;
  folderName: string | null;
  syncedAt: string | null;
  busy: boolean;
  last: SyncReport | null;
}

interface Saved {
  folderName: string;
  syncedAt: string | null;
  hashes: SyncHashes;
}

const store: SyncStore = { storage, importCopy, forget: forgetSession };
let folder: FileSystemDirectoryHandle | null = null;
let status: SyncStatus = { loaded: false, folderName: null, syncedAt: null, busy: false, last: null };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

function readSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as Saved | null;
  } catch {
    return null;
  }
}

function writeSaved(s: Saved | null) {
  try {
    if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    // Without storage every sync compares from scratch; nothing is lost, only more copies.
  }
}

void storage.readValue<FileSystemDirectoryHandle>(HANDLE_KEY).then(
  (h) => {
    folder = h;
    const saved = h ? readSaved() : null;
    set({ loaded: true, folderName: h?.name ?? null, syncedAt: saved?.syncedAt ?? null });
  },
  () => set({ loaded: true }),
);

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

/** Pick a folder, remember it, and sync into it right away. */
export async function chooseFolder(): Promise<SyncReport | null> {
  const h = await pickFolder();
  folder = h;
  await storage.writeValue(HANDLE_KEY, h);
  writeSaved({ folderName: h.name, syncedAt: null, hashes: {} });
  set({ folderName: h.name, syncedAt: null, last: null });
  return syncNow();
}

/** Stop syncing. Files already in the folder stay there. */
export async function disconnect(): Promise<void> {
  folder = null;
  await storage.writeValue(HANDLE_KEY, null);
  writeSaved(null);
  set({ folderName: null, syncedAt: null, last: null });
}

export async function syncNow(): Promise<SyncReport | null> {
  if (!folder || status.busy) return null;
  if (!(await ensureAccess(folder))) throw new Error("The browser didn't allow access to the folder. Click Sync now and choose Allow.");
  set({ busy: true });
  try {
    const pending = pendingDeletes();
    const report = await syncWith(new FolderTarget(folder), store, readSaved()?.hashes ?? {}, pending);
    clearDeleted(pending);
    const syncedAt = new Date().toISOString();
    writeSaved({ folderName: folder.name, syncedAt, hashes: report.hashes });
    set({ syncedAt, last: report });
    return report;
  } finally {
    set({ busy: false });
    bumpGraphs();
  }
}

export function backup(): Promise<Backup> {
  return makeBackup(store, pendingDeletes());
}

export async function restore(data: unknown): Promise<SyncReport> {
  try {
    return await restoreBackup(store, data);
  } finally {
    bumpGraphs();
  }
}
