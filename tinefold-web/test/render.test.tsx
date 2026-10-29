import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { createGraph, MemoryStorage, MockProvider, ROOT_NODE_ID } from "@ravingupta/tinefold-engine";
import { exampleEvents } from "../src/examples";
import { importEvents } from "../src/app/sessions";
import { GraphPage } from "../src/outline/GraphPage";

describe("graph page, outline view", () => {
  beforeEach(() => localStorage.setItem("tinefold.view", "outline"));

  it("renders the example graph from the engine's tree with no logic of its own", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    // The heading is the short name; the full statement sits under it as plain text.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tinefold Design");
    expect(screen.getByText(/No backend is required: the app runs in the browser/)).toBeTruthy();
    // Chosen root option is checked; the progress rail lists 6 open items.
    expect(screen.getByRole("radio", { name: /Undo choice: Browser-only SPA/ })).toBeTruthy();
    expect(screen.getByText("6 still open")).toBeTruthy();
    // Ported nodes are labelled, the old root version is archived.
    expect(screen.getAllByText("Reused").length).toBeGreaterThan(0);
    expect(screen.getByText("Earlier versions of the problem")).toBeTruthy();
  });

  it("renames the brainstorm inline", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => screen.getByRole("button", { name: "Rename this brainstorm" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename this brainstorm" }));
    fireEvent.change(screen.getByLabelText("Brainstorm name"), { target: { value: "Tinefold design" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tinefold design"));
    // Escape leaves the name untouched.
    fireEvent.click(screen.getByRole("button", { name: "Rename this brainstorm" }));
    fireEvent.change(screen.getByLabelText("Brainstorm name"), { target: { value: "Something else" } });
    fireEvent.keyDown(screen.getByLabelText("Brainstorm name"), { key: "Escape" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tinefold design");
  });

  it("offers fresh options for a problem and fresh sub-problems for a chosen option", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => screen.getByRole("button", { name: "Regenerate approaches" }));
    const chosen = screen.getByRole("article", { name: "Option: Browser-only SPA (chosen)" });
    expect(within(chosen).getByRole("button", { name: "Regenerate sub-problems" })).toBeTruthy();
    // An unchosen option offers neither: it has nothing below it to redo.
    const other = screen.getByRole("article", { name: "Option: Browser + optional thin server" });
    expect(within(other).queryByRole("button", { name: /Regenerate/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate approaches" }));
    // The demo provider answers a replacement round with a different set; the old choice stays.
    await waitFor(() => expect(screen.getByText("Buy a managed service")).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText("Browser + optional thin server")).toBeNull();
    expect(screen.getByRole("radio", { name: /Undo choice: Browser-only SPA/ })).toBeTruthy();
    expect(screen.getByText("From earlier options")).toBeTruthy();
    expect(screen.getByText("6 still open")).toBeTruthy();
  });

  it("adds a comment and marks nodes as possibly out of date", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => screen.getByLabelText("Add a comment"));
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "Must work offline" } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    const before = screen.queryAllByText(/Possibly out of date/).length;
    const rail = screen.getByRole("heading", { name: "Comments" }).parentElement!;
    await waitFor(() => expect(within(rail).getAllByRole("listitem").map((l) => l.textContent)).toContain("Must work offline"));
    // Every enabled node now carries "a comment was added".
    expect(screen.getAllByText(/a comment was added/).length).toBeGreaterThan(before);
  });
});

describe("graph page, tree view (default)", () => {
  it("draws every node as a card, opens the inspector on click, and chooses from it", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Tree" }).getAttribute("aria-checked")).toBe("true"));
    await waitFor(() => expect(screen.getAllByText(/^Adapter per provider/).length).toBeGreaterThan(0));
    // Chosen-path cards and the start-here hint come straight from renderTree().
    expect(screen.getAllByText("Start here").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chosen").length).toBeGreaterThanOrEqual(4);

    fireEvent.click(screen.getAllByText("Per-node notes")[0]!);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Per-node notes" })).toBeTruthy());
    const panel = screen.getByRole("heading", { level: 2, name: "Per-node notes" }).closest(".space-y-4") as HTMLElement;
    expect(within(panel).getByRole("button", { name: "Suggest options" })).toBeTruthy();
    expect(within(panel).getByText(/^Up to “Tree canvas with tidy layout/)).toBeTruthy();
    fireEvent.click(screen.getByText("← Overview"));
    await waitFor(() => expect(screen.getByText("6 still open")).toBeTruthy());
  });
});

describe("graph page, tree view: questions", () => {
  async function askedAndAnswered(): Promise<string> {
    const mock = new MockProvider({
      queue: [
        { kind: "clarify", items: [{ id: "q", title: "Who uses it?", summary: "Changes hosting.", pros: [], cons: [], options: [{ id: "solo", title: "Just me" }, { id: "team", title: "A team" }] }], assumptions: [] },
        { kind: "solutions", axis: "hosting", items: [{ id: "a", title: "Static SPA", summary: "Browser only.", pros: [], cons: [] }, { id: "b", title: "Thin server", summary: "Small API.", pros: [], cons: [] }], assumptions: [] },
      ],
    });
    const s = await createGraph("Build a brainstorming tool", { storage: new MemoryStorage(), providers: [mock], registry: { default: { providerId: "mock", model: "m" }, overrides: {} } });
    await s.expand(ROOT_NODE_ID);
    const q = s.select.tree().children.find((c) => c.kind === "clarification")!;
    await s.answerClarification(q.id, { itemId: "solo" });
    await s.expand(ROOT_NODE_ID);
    return importEvents(await s.exportEvents());
  }

  it("draws questions as a badge on the card that asked them, not as cards", async () => {
    render(<GraphPage graphId={await askedAndAnswered()} />);
    await waitFor(() => expect(screen.getAllByText("Static SPA").length).toBeGreaterThan(0));
    const canvas = screen.getByLabelText("Brainstorm tree");
    expect(within(canvas).queryByText("Who uses it?")).toBeNull();
    fireEvent.click(within(canvas).getByRole("button", { name: "1 question answered" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Questions answered" })).toBeTruthy());
    expect(screen.getByText("Who uses it?")).toBeTruthy();
  });
});

describe("graph page, focus mode", () => {
  it("fills the screen with the tree, keeps comments one icon away, and leaves on Esc", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Focus" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    // Header and side rail are gone; only the canvas and the toolbar remain.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText("Write a document")).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Focus tools" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/^Adapter per provider/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "Comments" }));
    expect(screen.getByLabelText("Add a comment")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    expect(localStorage.getItem("tinefold.focus")).toBe("0");
  });
});

describe("graph page on a phone", () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) =>
      ({ matches: q === "(max-width: 767px)", media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it("never renders the tree or outline; offers progress and comments only", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    expect(screen.queryByRole("radio", { name: "Tree" })).toBeNull();
    expect(screen.queryByLabelText("Brainstorm tree")).toBeNull();
    expect(screen.queryByRole("radio", { name: /Undo choice/ })).toBeNull();
    expect(screen.queryByText("Write a document")).toBeNull();
    expect(screen.getByText("6 still open")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "From the train" } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    const rail = screen.getByRole("heading", { name: "Comments" }).parentElement!;
    await waitFor(() => expect(within(rail).getAllByRole("listitem").map((l) => l.textContent)).toContain("From the train"));
  });
});

describe("graph page, outcome lens", () => {
  it("hides unchosen options and comes back on demand", async () => {
    const id = await importEvents(exampleEvents);
    render(<GraphPage graphId={id} />);
    const unchosen = "Browser + optional thin server";
    await waitFor(() => expect(screen.getAllByText(unchosen).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("radio", { name: "Outcome" }));
    await waitFor(() => expect(screen.queryByText(unchosen)).toBeNull());
    // The chosen path and the open sub-problems stay.
    expect(screen.getAllByText("Browser-only SPA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Graph canvas UI").length).toBeGreaterThan(0);
    expect(screen.getByText(/Alternatives are hidden/)).toBeTruthy();
    expect(localStorage.getItem("tinefold.lens")).toBe("outcome");
    fireEvent.keyDown(window, { key: "o" });
    await waitFor(() => expect(screen.getAllByText(unchosen).length).toBeGreaterThan(0));
    expect(screen.getByRole("radio", { name: "Everything" }).getAttribute("aria-checked")).toBe("true");
  });
});
