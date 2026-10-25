import { describe, expect, it } from "vitest";
import raw from "./fixtures/design-session.events.json";
import {
  EngineError,
  GraphEvent,
  completeness,
  currentInputs,
  enabledSet,
  hashContext,
  reduce,
  replay,
  staleMarks,
  type Graph,
} from "../src";

const events: GraphEvent[] = (raw as unknown[]).map((e) => GraphEvent.parse(e));
const upTo = (seq: number) => replay(events.filter((e) => e.seq <= seq));
const by = { providerId: "mock", model: "mock-1", promptVersion: "expand@1" };
const tokens = { in: 1, out: 1 };

function apply(g: Graph, type: GraphEvent["type"], payload: unknown): Graph {
  const e = GraphEvent.parse({ id: `x${g.seq + 1}`, graphId: g.id, seq: g.seq + 1, at: "2026-10-24T12:00:00.000Z", type, payload });
  return reduce(g, e);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof EngineError ? e.code : "not an EngineError";
  }
  return undefined;
}

const markOf = (g: Graph, nodeId: string) => staleMarks(g)[g.nodes[nodeId]!.currentVersionId];

describe("StaleChecked", () => {
  const at14 = upTo(14);
  const a1 = at14.nodes["A1"]!;
  const hashNow = hashContext(currentInputs(at14, a1.parentVersionId), a1.parentVersionId);

  it("fresh at the current hash clears a yellow mark", () => {
    const g = apply(at14, "StaleChecked", { nodeVersionId: a1.currentVersionId, verdict: "fresh", reason: "ok", contextHash: hashNow });
    expect(markOf(g, "A1")).toBe("none");
    expect(markOf(g, "A2")).toBe("yellow");
  });

  it("stale at the current hash shows red", () => {
    const g = apply(at14, "StaleChecked", { nodeVersionId: a1.currentVersionId, verdict: "stale", reason: "contradicts root", contextHash: hashNow });
    expect(markOf(g, "A1")).toBe("red");
  });

  it("a check against an older hash is ignored", () => {
    const g = apply(at14, "StaleChecked", { nodeVersionId: a1.currentVersionId, verdict: "fresh", reason: "ok", contextHash: "0".repeat(64) });
    expect(markOf(g, "A1")).toBe("yellow");
  });
});

describe("NodeRegenerated", () => {
  it("appends a version and leaves children and selection on the old one", () => {
    const at13 = upTo(13);
    const g = apply(at13, "NodeRegenerated", {
      nodeId: "A1",
      newVersion: { nodeId: "A1", versionId: "A1-v2", title: "storage", summary: "again", pros: [], cons: [] },
      contextHash: "1".repeat(64),
      inputs: currentInputs(at13, "A-server-v1"),
      generatedBy: by,
      tokens,
    });
    expect(g.nodes["A1"]!.currentVersionId).toBe("A1-v2");
    expect(g.nodeVersions["A1-v2"]!.version).toBe(2);
    expect(g.nodeVersions["A1-v1"]).toBe(at13.nodeVersions["A1-v1"]);
    expect(g.children["A1-v1"]).toEqual(["A1-relational", "A1-doclog", "A1-events"]);
    expect(g.selections["A1"]).toBe("A1-doclog");
    expect(enabledSet(g).has("A1-doclog")).toBe(true);
  });
});

describe("leaf and clarification", () => {
  it("a leaf problem does not count as unresolved", () => {
    const at17 = upTo(17);
    const g1 = apply(at17, "NodeExpanded", {
      parentVersionId: "A2-spa-v1",
      kind: "subproblems",
      items: [{ nodeId: "P", versionId: "P-v1", title: "small thing", summary: "", pros: [], cons: [] }],
      assumptions: [],
      contextHash: "2".repeat(64),
      inputs: currentInputs(at17, "A2-spa-v1"),
      generatedBy: by,
      tokens,
    });
    expect(completeness(g1).unresolvedProblemIds).toEqual(["P"]);
    const g2 = apply(g1, "NodeExpanded", {
      parentVersionId: "P-v1",
      kind: "leaf",
      items: [],
      assumptions: [],
      leafReason: "one engineer, one day",
      contextHash: "3".repeat(64),
      inputs: currentInputs(g1, "P-v1"),
      generatedBy: by,
      tokens,
    });
    expect(completeness(g2).count).toBe(0);
  });

  it("rejects an answer that is not one of the options", () => {
    const at2 = upTo(2);
    expect(codeOf(() => apply(at2, "ClarificationAnswered", { clarificationNodeId: "Q1", itemId: "nope" }))).toBe("InvalidSelection");
  });

  it("rejects a solutions expansion of a solution", () => {
    const at7 = upTo(7);
    expect(
      codeOf(() =>
        apply(at7, "NodeExpanded", {
          parentVersionId: "A-server-v1",
          kind: "solutions",
          items: [{ nodeId: "S", versionId: "S-v1", title: "s", summary: "", pros: [], cons: [] }],
          assumptions: [],
          contextHash: "4".repeat(64),
          inputs: currentInputs(at7, "A-server-v1"),
          generatedBy: by,
          tokens,
        }),
      ),
    ).toBe("ValidationFailed");
  });
});
