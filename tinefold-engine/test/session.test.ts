import { describe, expect, it } from "vitest";
import {
  EngineError,
  MemoryStorage,
  MockProvider,
  ROOT_NODE_ID,
  canonicalJson,
  createGraph,
  designSessionEvents,
  importGraph,
  openSession,
  type ProviderRegistry,
  type Session,
} from "../src";

const registry: ProviderRegistry = { default: { providerId: "mock", model: "m" }, overrides: {} };

function setup(queue: unknown[] = []) {
  let n = 0;
  let t = Date.parse("2026-10-24T10:00:00.000Z");
  const storage = new MemoryStorage();
  const mock = new MockProvider({ queue });
  const opts = {
    storage,
    providers: [mock],
    registry,
    newId: () => `id${String(++n).padStart(4, "0")}`,
    now: () => new Date((t += 1000)).toISOString(),
  };
  return { storage, mock, opts };
}

const solutions = {
  kind: "solutions",
  axis: "hosting",
  items: [
    { id: "a", title: "Static SPA", summary: "Browser only.", axisValue: "none", pros: ["cheap"], cons: ["no sync"] },
    { id: "b", title: "Thin server", summary: "Small API.", axisValue: "some", pros: ["sync"], cons: ["ops"] },
  ],
  recommendedId: "a",
  reason: "Simplest.",
  assumptions: ["Hundreds of nodes per graph"],
};
const clarify = {
  kind: "clarify",
  items: [{ id: "q", title: "Who uses it?", summary: "Changes hosting.", pros: [], cons: [], options: [{ id: "solo", title: "Just me" }, { id: "team", title: "A team" }] }],
  assumptions: [],
};
const subproblems = {
  kind: "subproblems",
  items: [
    { id: "s1", title: "Storage", summary: "Where data lives.", pros: [], cons: [] },
    { id: "s2", title: "Providers", summary: "Which models.", pros: [], cons: [] },
    { id: "s3", title: "UI", summary: "How it looks.", pros: [], cons: [] },
  ],
  suggestedNextId: "s1",
  assumptions: [],
};
const storageOptions = {
  kind: "solutions",
  axis: "durability",
  items: [
    { id: "x", title: "IndexedDB", summary: "Local.", pros: [], cons: [] },
    { id: "y", title: "Files", summary: "Export only.", pros: [], cons: [] },
  ],
  recommendedId: "x",
  assumptions: [],
};

async function walk(s: Session) {
  const tree = () => s.select.tree();
  await s.expand(ROOT_NODE_ID);
  const q = tree().children.find((c) => c.kind === "clarification")!;
  await s.answerClarification(q.id, { itemId: "solo", freeText: "maybe open source later" });
  await s.expand(ROOT_NODE_ID);
  const spa = tree().children.find((c) => c.title === "Static SPA")!;
  await s.selectSolution(ROOT_NODE_ID, spa.id);
  await s.expand(spa.id);
  return { spa: tree().children.find((c) => c.id === spa.id)! };
}

describe("session", () => {
  it("runs clarify → answer → solutions → select → subproblems, and renders the tree", async () => {
    const { opts, mock } = setup([clarify, solutions, subproblems]);
    const s = await createGraph("Build a brainstorming tool", opts);
    const { spa } = await walk(s);

    expect(spa.state).toBe("active");
    expect(spa.selected).toBe(true);
    expect(spa.recommended).toBe(true);
    expect(spa.children.map((c) => c.title)).toEqual(["Storage", "Providers", "UI"]);
    expect(spa.children[0]!.isSuggestedNext).toBe(true);
    const thin = s.select.tree().children.find((c) => c.title === "Thin server")!;
    expect(thin.state).toBe("option");
    expect(s.select.completeness().unresolvedProblemIds).toHaveLength(3);
    expect(s.select.assumptions().map((a) => a.text)).toContain("Hundreds of nodes per graph");

    // The second root expansion must forbid clarify: the question was already asked.
    expect(mock.calls[1]!.user).toContain('Do not return kind "clarify"');
    expect(mock.calls[1]!.user).toContain("Who uses it? → Just me — maybe open source later");
    // Expanding the chosen solution sees the decision and the answer.
    expect(mock.calls[2]!.user).toContain("root → Static SPA");
  });

  it("marks yellow on a comment and clears it with a fresh stale check", async () => {
    const { opts, mock } = setup([clarify, solutions, subproblems]);
    const s = await createGraph("Build a brainstorming tool", opts);
    const { spa } = await walk(s);
    await s.addComment("Team is three people");
    const storageNode = () => s.select.tree().children.find((c) => c.id === spa.id)!.children[0]!;
    expect(storageNode().mark).toBe("yellow");
    expect(storageNode().staleReasons).toEqual(["a comment was added"]);

    mock.enqueue({ verdict: "fresh", reason: "Team size does not change storage." });
    const v = await s.checkStale(storageNode().id);
    expect(v.verdict).toBe("fresh");
    expect(storageNode().mark).toBe("none");
    expect(storageNode().checkedReason).toBe("Team size does not change storage.");
  });

  it("rewrites the root: old tree turns red with a restart warning, then ports into the new tree", async () => {
    const { opts, mock } = setup([clarify, solutions, subproblems]);
    const s = await createGraph("Build a brainstorming tool", opts);
    const { spa } = await walk(s);
    const storageProblem = spa.children[0]!;
    mock.enqueue(storageOptions);
    await s.expand(storageProblem.id);
    const idb = s.select.tree().children.find((c) => c.id === spa.id)!.children[0]!.children[0]!;
    await s.selectSolution(storageProblem.id, idb.id);

    await s.addComment("No backend at all");
    const commentId = s.getSnapshot().comments[0]!.id;
    mock.enqueue({ statement: "Browser-only brainstorming tool, no backend.", mergedCommentIds: [commentId, "bogus"] });
    const proposal = await s.proposeRootRewrite();
    expect(proposal.mergedCommentIds).toEqual([commentId]);
    await s.approveRootRewrite(proposal.statement, proposal.mergedCommentIds);

    const t = s.select.tree();
    expect(t.summary).toBe("Browser-only brainstorming tool, no backend.");
    expect(t.version).toBe(2);
    expect(t.canExpand).toBe(true);
    const oldSpa = t.children.find((c) => c.id === spa.id)!;
    expect(oldSpa.fromOlderVersion).toBe(true);
    expect(oldSpa.mark).toBe("red");
    expect(s.select.restartWarning()).toEqual({ nodeId: spa.id, title: "Static SPA", count: 5 });

    mock.enqueue(solutions);
    await s.expand(ROOT_NODE_ID);
    const newSpa = s.select.tree().children.find((c) => c.title === "Static SPA" && !c.fromOlderVersion)!;
    await s.selectSolution(ROOT_NODE_ID, newSpa.id);
    expect(s.select.restartWarning()).toBeNull();
    const ported = await s.portNode(storageProblem.id, newSpa.id);
    const node = s.select.tree().children.find((c) => c.id === newSpa.id)!.children.find((c) => c.id === ported)!;
    expect(node.portedFrom).toEqual({ nodeId: storageProblem.id, title: "Storage" });
    expect(node.mark).toBe("none");
    expect(node.children[0]!.selected).toBe(true);
    expect(node.canExpand).toBe(false); // a reused problem keeps its choice; no fresh options offered
    expect(s.select.decisionSummary().decisions.map((d) => `${d.problemTitle} → ${d.solutionTitle}`)).toEqual([
      "root → Static SPA",
      "Storage → IndexedDB",
    ]);
  });

  it("generates documents by type, caches per type and graph state", async () => {
    const { opts, mock } = setup([clarify, solutions, subproblems]);
    const s = await createGraph("Build a brainstorming tool", opts);
    await walk(s);
    mock.enqueue("# PRD\n\nBody", "# TRD\n\nBody");
    const prd = await s.generatePrd();
    expect(prd.cached).toBe(false);
    expect(prd.markdown).toBe("# PRD\n\nBody");
    expect((await s.generatePrd()).cached).toBe(true);
    const trd = await s.generateDocument({ docType: "trd" });
    expect(trd.markdown).toBe("# TRD\n\nBody");
    const docCall = mock.calls.at(-1)!;
    expect(docCall.user).toContain("[CHOSEN] Static SPA");
    expect(docCall.user).toContain("[rejected] Thin server");
    expect(docCall.user).toContain("(OPEN: no decision yet)");
    expect(docCall.system).toContain("Technical design");
    await expect(s.generateDocument({ docType: "custom" })).rejects.toMatchObject({ code: "ValidationFailed" });
    await s.addComment("changes things");
    mock.enqueue("# PRD v2");
    expect((await s.generatePrd()).cached).toBe(false);
    expect(s.select.documents()).toHaveLength(3);
  });

  it("retries once on invalid provider output, then fails with a typed error", async () => {
    const { opts } = setup([{ kind: "solutions", items: [], assumptions: [] }, solutions]);
    const s = await createGraph("x", opts);
    const exp = await s.expand(ROOT_NODE_ID, { allowClarify: false });
    expect(exp.kind).toBe("solutions");

    const bad = { kind: "subproblems", items: [], assumptions: [] };
    const s2 = await createGraph("y", setup([bad, bad]).opts);
    await expect(s2.expand(ROOT_NODE_ID)).rejects.toMatchObject({ code: "ValidationFailed" });
  });

  it("refuses contexts above the hard ceiling and missing providers", async () => {
    const { opts } = setup([]);
    const s = await createGraph("z".repeat(400), { ...opts, hardCeiling: 50 });
    await expect(s.expand(ROOT_NODE_ID)).rejects.toMatchObject({ code: "ContextTooLarge" });
    s.setRegistry({ default: { providerId: "nope", model: "m" }, overrides: {} });
    const s3 = await createGraph("q", { ...opts, registry: { default: { providerId: "nope", model: "m" }, overrides: {} } });
    await expect(s3.expand(ROOT_NODE_ID)).rejects.toBeInstanceOf(EngineError);
  });

  it("reloads from storage to the same snapshot, and imports the design fixture", async () => {
    const { opts } = setup([clarify, solutions, subproblems]);
    const s = await createGraph("Build a brainstorming tool", opts);
    await walk(s);
    const reopened = await openSession(s.graphId, opts);
    expect(canonicalJson(reopened.getSnapshot())).toBe(canonicalJson(s.getSnapshot()));

    const imported = await importGraph(designSessionEvents, opts);
    expect(imported.select.decisionSummary().decisions).toHaveLength(4);
    expect(imported.select.completeness().count).toBe(4);
    expect((await imported.exportEvents())).toHaveLength(designSessionEvents.length);
  });

  it("serialises concurrent writes without seq conflicts", async () => {
    const { opts } = setup([]);
    const s = await createGraph("concurrency", opts);
    await Promise.all(["a", "b", "c", "d"].map((t) => s.addComment(t)));
    expect(s.getSnapshot().comments.map((c) => c.text)).toEqual(["a", "b", "c", "d"]);
    expect(s.getSnapshot().seq).toBe(5);
  });
});
