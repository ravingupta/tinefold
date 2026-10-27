const KEY = "tinefold.sync.deleted";

/** Ids deleted on this device since the last sync. The next sync removes them everywhere. */
export function pendingDeletes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function noteDeleted(id: string): void {
  setPending([...new Set([...pendingDeletes(), id])]);
}

/** Forget the ids a sync has already carried to the folder. */
export function clearDeleted(ids: string[]): void {
  const done = new Set(ids);
  setPending(pendingDeletes().filter((id) => !done.has(id)));
}

function setPending(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Without storage a deletion stays local; the next sync may bring the brainstorm back.
  }
}
