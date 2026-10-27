import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tag, download, relativeTime } from "../app/ui";
import { backup, chooseFolder, disconnect, restore, syncNow, useSyncStatus } from "./state";
import { canPickFolder } from "./target";
import type { SyncReport } from "./sync";
import guide from "./AI-GUIDE.md?raw";

const PROVIDERS: { name: string; free: string; steps: ReactNode[] }[] = [
  {
    name: "Google Drive",
    free: "15 GB free, shared with Gmail and Photos",
    steps: [
      <>Install <b>Google Drive for desktop</b> from google.com/drive/download and sign in with your Google account.</>,
      <>Open <b>Google Drive → My Drive</b> (in the Finder sidebar on a Mac, or as the <b>G:</b> drive on Windows) and make a folder called <b>tinefold</b>.</>,
      <>Right-click the folder and choose <b>Offline access → Available offline</b>, so the files are always on disk.</>,
    ],
  },
  {
    name: "iCloud Drive",
    free: "5 GB free, built into every Mac",
    steps: [
      <>On a Mac, turn on <b>System Settings → your name → iCloud → iCloud Drive</b>. On Windows, install <b>iCloud for Windows</b> from the Microsoft Store and turn on iCloud Drive.</>,
      <>Open <b>iCloud Drive</b> and make a folder called <b>tinefold</b>.</>,
      <>On a Mac, right-click the folder and choose <b>Keep Downloaded</b>, so macOS doesn't move the files off the disk.</>,
    ],
  },
  {
    name: "OneDrive",
    free: "5 GB free, built into Windows",
    steps: [
      <>Sign in to <b>OneDrive</b> (built into Windows; on a Mac, install it from the App Store).</>,
      <>Open your <b>OneDrive</b> folder and make a folder called <b>tinefold</b>.</>,
      <>Right-click the folder and choose <b>Always keep on this device</b>.</>,
    ],
  },
  {
    name: "Dropbox",
    free: "2 GB free; the free plan links up to three devices",
    steps: [
      <>Install the <b>Dropbox</b> desktop app from dropbox.com/install and sign in.</>,
      <>Open your <b>Dropbox</b> folder and make a folder called <b>tinefold</b>.</>,
      <>If you use online-only files, right-click the folder and choose <b>Make available offline</b>.</>,
    ],
  },
];

export function SyncPage() {
  const status = useSyncStatus();
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderOk = canPickFolder();
  useEffect(() => {
    document.title = "Sync · tinefold";
  }, []);

  const run = async (f: () => Promise<SyncReport | null | void>) => {
    setError(null);
    try {
      const r = await f();
      if (r) setReport(r);
    } catch (e) {
      // Closing the folder picker is not an error.
      if ((e as { name?: string })?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveBackup = () =>
    run(async () => {
      const b = await backup();
      download(`tinefold-backup-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b, null, 2), "application/json");
    });

  const onFile = (f: File | undefined) =>
    f && run(async () => {
      let data: unknown;
      try {
        data = JSON.parse(await f.text());
      } catch {
        throw new Error("That file isn't a tinefold backup. Backups are .json files made with Download a backup.");
      }
      return restore(data);
    });

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-24 pt-10 sm:px-6">
      <h1 className="text-[28px] font-bold tracking-[-0.015em]">Sync</h1>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
        Keep your brainstorms and projects on every computer you use. tinefold writes them as files into a folder you choose; the free desktop app of
        Google Drive, iCloud Drive, OneDrive or Dropbox uploads that folder, and your other computers read it back. No account to connect, nothing sent
        to tinefold.
      </p>

      <section className="mt-6 rounded-lg border border-line-2 bg-paper px-4 py-4" aria-label="Sync status">
        {!status.loaded ? (
          <p className="thinking text-[14px] text-ink-2">Checking…</p>
        ) : status.folderName ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="cobalt">Syncing</Tag>
              <span className="text-[14px]">
                Folder <b>{status.folderName}</b>
                {status.syncedAt ? <span className="text-ink-2">, last synced {relativeTime(status.syncedAt)}</span> : null}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" disabled={status.busy} onClick={() => run(syncNow)}>{status.busy ? "Syncing…" : "Sync now"}</Button>
              <Button disabled={status.busy} onClick={() => run(chooseFolder)}>Change folder</Button>
              <Button variant="ghost" disabled={status.busy} onClick={() => run(disconnect)}>Stop syncing</Button>
            </div>
            <p className="mt-3 text-[13px] text-ink-2">Click <b>Sync now</b> when you finish on this computer and when you start on another. It sends your changes and brings in theirs.</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="amber">Not synced</Tag>
              <span className="text-[14px]">No folder chosen. Your brainstorms are only in this browser, and clearing its data deletes them.</span>
            </div>
            {folderOk ? (
              <div className="mt-3">
                <Button variant="primary" disabled={status.busy} onClick={() => run(chooseFolder)}>Choose a sync folder</Button>
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-ink-2">
                This browser can't keep a folder. Open tinefold in <b>Chrome</b> or <b>Edge</b> on a computer to sync, or use a backup file below.
              </p>
            )}
          </>
        )}
        {report && <ReportLine report={report} />}
        {error && <p role="alert" className="mt-3 text-[14px] text-brick">{error}</p>}
      </section>

      <section className="mt-10" aria-labelledby="setup-h">
        <h2 id="setup-h" className="text-[17px] font-semibold">1. Make a cloud folder (free)</h2>
        <p className="mt-1 max-w-[62ch] text-[13px] text-ink-2">Pick one service and use it on every computer. The free plans are far bigger than tinefold needs: a large brainstorm is well under a megabyte.</p>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {PROVIDERS.map((p) => (
            <details key={p.name} className="group py-3">
              <summary className="flex cursor-pointer list-none items-baseline gap-3">
                <span className="text-[15px] font-semibold group-open:text-cobalt">{p.name}</span>
                <span className="text-[13px] text-ink-2">{p.free}</span>
              </summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[14px] leading-snug">
                {p.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="connect-h">
        <h2 id="connect-h" className="text-[17px] font-semibold">2. Connect tinefold to it</h2>
        <ol className="mt-2 max-w-[62ch] list-decimal space-y-1.5 pl-5 text-[14px] leading-snug">
          <li>Open tinefold in Chrome or Edge and click <b>Choose a sync folder</b> above.</li>
          <li>Pick the <b>tinefold</b> folder you made, then choose <b>Edit files</b> or <b>Allow</b> when the browser asks.</li>
          <li>tinefold copies everything into the folder straight away.</li>
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="other-h">
        <h2 id="other-h" className="text-[17px] font-semibold">3. On your other computers</h2>
        <ol className="mt-2 max-w-[62ch] list-decimal space-y-1.5 pl-5 text-[14px] leading-snug">
          <li>Install the same cloud app and sign in with the same account. Wait until the <b>tinefold</b> folder appears.</li>
          <li>Open tinefold, go to <b>Sync</b>, and choose that same folder. Your brainstorms show up, and anything already on this computer is added to the folder.</li>
          <li>From then on, click <b>Sync now</b> when you start and when you finish. After a reload the browser may ask for access once more.</li>
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="know-h">
        <h2 id="know-h" className="text-[17px] font-semibold">Good to know</h2>
        <ul className="mt-2 max-w-[62ch] list-disc space-y-1.5 pl-5 text-[14px] leading-snug">
          <li>If you change the same brainstorm on two computers before syncing, the folder's version wins and yours is kept as a copy named "… (this device)". Nothing is thrown away.</li>
          <li>Deleting a brainstorm or project removes it from the folder and from your other computers at their next sync.</li>
          <li>Settings and API keys are not synced. They stay in each browser.</li>
          <li>If Chrome says it can't open a folder because it contains system files, pick a folder you made yourself (not your home folder or the cloud drive's top level). If it still refuses, use a backup file.</li>
          <li>Phones and tablets can't sync a folder from the browser.</li>
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="ai-h">
        <h2 id="ai-h" className="text-[17px] font-semibold">Edit with an AI assistant</h2>
        <p className="mt-1 max-w-[62ch] text-[14px] leading-snug text-ink-2">
          The folder holds plain JSON: one file per brainstorm in <code>brainstorms/</code> and one per project in <code>projects/</code>. tinefold also writes{" "}
          <code>AI-GUIDE.md</code> next to them, which explains the format to an AI tool (Claude, ChatGPT, Cursor and others). Point the tool at the folder, ask for the change, then click{" "}
          <b>Sync now</b>. A file the app can't read is skipped and named here; nothing else is touched.
        </p>
        <div className="mt-3">
          <Button size="sm" variant="ghost" onClick={() => download("AI-GUIDE.md", guide, "text/markdown")}>Download the AI guide</Button>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="backup-h">
        <h2 id="backup-h" className="text-[17px] font-semibold">Backup file</h2>
        <p className="mt-1 max-w-[62ch] text-[14px] leading-snug text-ink-2">
          For Safari, Firefox, or a quick copy: one file with every brainstorm and project. Save it into your cloud folder, then restore it on the other
          computer. Restoring merges; it never replaces what's already here.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={saveBackup}>Download a backup</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>Restore from a backup</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </section>
    </div>
  );
}

function ReportLine({ report }: { report: SyncReport }) {
  const parts = [
    report.pulled && `${report.pulled} brought in`,
    report.pushed && `${report.pushed} sent`,
    report.removed && `${report.removed} removed`,
  ].filter(Boolean);
  return (
    <div role="status" className="mt-3 text-[13px] text-ink-2">
      <p>{parts.length ? `Done: ${parts.join(", ")}.` : "Everything was already up to date."}</p>
      {report.copies.length > 0 && <p className="mt-1 text-amber">Changed in both places, kept a copy of this computer's version: {report.copies.join(", ")}.</p>}
      {report.problems.length > 0 && (
        <div className="mt-1 text-brick">
          <p>Skipped files tinefold can't read (fix or delete them, then sync again):</p>
          <ul className="list-disc pl-5">{report.problems.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
        </div>
      )}
    </div>
  );
}
