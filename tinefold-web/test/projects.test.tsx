import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { designSessionEvents } from "@ravingupta/tinefold-engine";
import { importEvents, projects, newGraph } from "../src/app/sessions";
import { ProjectPage } from "../src/projects/ProjectPage";
import { DexieStorageAdapter } from "../src/storage/DexieStorageAdapter";

describe("projects", () => {
  it("persist in IndexedDB", async () => {
    const db = new DexieStorageAdapter(`p-${Math.random()}`);
    const p = { id: "p1", name: "Shop", description: "", graphIds: ["a"], createdAt: "2026-10-24T10:00:00.000Z", updatedAt: "2026-10-24T10:00:00.000Z", documents: {} };
    await db.writeProject(p);
    expect(await db.readProject("p1")).toEqual(p);
    expect((await db.listProjects()).map((x) => x.id)).toEqual(["p1"]);
    await db.deleteProject("p1");
    expect(await db.readProject("p1")).toBeNull();
  });

  it("render the high-level structure of their brainstorms", async () => {
    const example = await importEvents(designSessionEvents);
    const fresh = await newGraph("Pricing for the hosted version");
    const p = await projects.create({ name: "tinefold launch", graphIds: [example, fresh] });
    render(<ProjectPage projectId={p.id} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("tinefold launch"));
    await waitFor(() => expect(screen.getByText("Browser-only SPA")).toBeTruthy());
    expect(screen.getByText("No approach chosen yet.")).toBeTruthy();
    expect(screen.getByText(/2 brainstorms, 4 decisions made/)).toBeTruthy();
    expect(screen.getByText(/Open: staleness, canvas UI, PRD generation, provider registry/)).toBeTruthy();
  });
});
