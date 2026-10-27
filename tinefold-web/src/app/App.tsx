import { useRoute, go } from "./route";
import { useSettings } from "./sessions";
import { TineMark } from "./ui";
import { isDemo } from "../settings/settings";
import { HomePage } from "../home/HomePage";
import { GraphPage } from "../outline/GraphPage";
import { SettingsPage } from "../settings/SettingsPage";
import { ProjectsPage } from "../projects/ProjectsPage";
import { ProjectPage } from "../projects/ProjectPage";
import { SyncPage } from "../sync/SyncPage";
import { useSyncStatus } from "../sync/state";

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const sync = useSyncStatus();
  return (
    <div className="min-h-screen">
      <nav className="border-b border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1320px] items-center gap-4 px-4 py-2.5 sm:px-6">
          <a href="#/" className="flex items-center gap-1.5 text-[17px] font-bold tracking-[-0.02em]" aria-label="tinefold, all brainstorms">
            <TineMark className="size-5 text-cobalt" />
            tinefold
          </a>
          <span className="flex-1" />
          {isDemo(settings) && route.name !== "settings" && (
            <button type="button" onClick={() => go({ name: "settings" })} className="hidden rounded bg-amber-soft px-2 py-0.5 text-[12px] font-medium text-amber sm:inline">
              Demo mode
            </button>
          )}
          {sync.loaded && !sync.folderName && route.name !== "sync" && (
            <a href="#/sync" className="hidden rounded bg-amber-soft px-2 py-0.5 text-[12px] font-medium text-amber sm:inline" title="No sync folder chosen: your brainstorms are only in this browser.">
              Not synced
            </a>
          )}
          <a href="#/" className={`text-[14px] ${route.name === "home" ? "font-semibold" : "text-ink-2 hover:text-ink"}`}>Brainstorms</a>
          <a href="#/projects" className={`text-[14px] ${route.name === "projects" || route.name === "project" ? "font-semibold" : "text-ink-2 hover:text-ink"}`}>Projects</a>
          <a href="#/sync" className={`hidden text-[14px] sm:inline ${route.name === "sync" ? "font-semibold" : "text-ink-2 hover:text-ink"}`}>Sync</a>
          <a href="#/settings" className={`text-[14px] ${route.name === "settings" ? "font-semibold" : "text-ink-2 hover:text-ink"}`}>Settings</a>
        </div>
      </nav>
      {route.name === "home" && <HomePage />}
      {route.name === "settings" && <SettingsPage />}
      {route.name === "sync" && <SyncPage />}
      {route.name === "graph" && <GraphPage key={route.id} graphId={route.id} />}
      {route.name === "projects" && <ProjectsPage />}
      {route.name === "project" && <ProjectPage key={route.id} projectId={route.id} />}
    </div>
  );
}
