/** Where a sync reads and writes: a folder on disk, or a backup file held in memory. */
export type Kind = "brainstorms" | "projects";

export interface SyncTarget {
  /** id → raw file text for every `<id>.json` in the kind's folder. */
  list(kind: Kind): Promise<Map<string, string>>;
  write(kind: Kind, id: string, text: string): Promise<void>;
  remove(kind: Kind, id: string): Promise<void>;
  /** Files at the top of the target (the manifest and the AI guide). */
  readRoot(name: string): Promise<string | null>;
  writeRoot(name: string, text: string): Promise<void>;
}

// The File System Access API is Chromium-only, so TypeScript's DOM library leaves these out.
type Permission = "granted" | "denied" | "prompt";
declare global {
  interface FileSystemHandle {
    queryPermission?(d: { mode: "readwrite" }): Promise<Permission>;
    requestPermission?(d: { mode: "readwrite" }): Promise<Permission>;
  }
  interface Window {
    showDirectoryPicker?(o?: { id?: string; mode?: "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

/** True in browsers that can keep a folder (Chrome, Edge, other Chromium desktops). */
export function canPickFolder(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function pickFolder(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker!({ id: "tinefold-sync", mode: "readwrite" });
}

/** Ask again for write access after a reload. Must run inside a click. */
export async function ensureAccess(dir: FileSystemDirectoryHandle): Promise<boolean> {
  if (!dir.queryPermission) return true;
  if ((await dir.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await dir.requestPermission?.({ mode: "readwrite" })) === "granted";
}

export class FolderTarget implements SyncTarget {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async list(kind: Kind): Promise<Map<string, string>> {
    const dir = await this.root.getDirectoryHandle(kind, { create: true });
    const out = new Map<string, string>();
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== "file" || !name.endsWith(".json")) continue;
      out.set(name.slice(0, -".json".length), await (await (h as FileSystemFileHandle).getFile()).text());
    }
    return out;
  }

  async write(kind: Kind, id: string, text: string): Promise<void> {
    await writeText(await this.root.getDirectoryHandle(kind, { create: true }), `${id}.json`, text);
  }

  async remove(kind: Kind, id: string): Promise<void> {
    const dir = await this.root.getDirectoryHandle(kind, { create: true });
    await dir.removeEntry(`${id}.json`).catch((e: unknown) => {
      if ((e as { name?: string })?.name !== "NotFoundError") throw e;
    });
  }

  async readRoot(name: string): Promise<string | null> {
    try {
      return await (await (await this.root.getFileHandle(name)).getFile()).text();
    } catch {
      return null;
    }
  }

  writeRoot(name: string, text: string): Promise<void> {
    return writeText(this.root, name, text);
  }
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

/** A backup file's contents as a target, so restoring one runs the same merge as a folder sync. */
export class MemoryTarget implements SyncTarget {
  readonly files: Record<Kind, Map<string, string>> = { brainstorms: new Map(), projects: new Map() };
  readonly root = new Map<string, string>();

  async list(kind: Kind) {
    return new Map(this.files[kind]);
  }
  async write(kind: Kind, id: string, text: string) {
    this.files[kind].set(id, text);
  }
  async remove(kind: Kind, id: string) {
    this.files[kind].delete(id);
  }
  async readRoot(name: string) {
    return this.root.get(name) ?? null;
  }
  async writeRoot(name: string, text: string) {
    this.root.set(name, text);
  }
}
