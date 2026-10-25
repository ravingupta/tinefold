import { describe, expect, it } from "vitest";
import raw from "./fixtures/design-session.events.json";
import {
  EngineError,
  GraphEvent,
  ROOT_NODE_ID,
  ancestorChain,
  canonicalJson,
  completeness,
  decisionSummary,
  enabledSet,
  hashContext,
  reduce,
  replay,
  staleMarks,
  suggestedNext,
  type Graph,
} from "../src";

const events: GraphEvent[] = (raw as unknown[]).map((e) => GraphEvent.parse(e));
const upTo = (seq: number) => replay(events.filter((e) => e.seq <= seq));
const final = replay(events);

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

function expectEngineError(fn: () => unknown, code: EngineError["code"]) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
}

const markOf = (g: Graph, nodeId: string) => staleMarks(g)[g.nodes[nodeId]!.currentVersionId];

describe("design-session fixture", () => {
  it("parses and its context hashes match the recorded inputs", () => {
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    for (const e of events) {
      if (e.type === "NodeExpanded") {
        expect(e.payload.contextHash).toBe(hashContext(e.payload.inputs, e.payload.parentVersionId));
      }
      if (e.type === "NodePorted") {
        expect(e.payload.contextHash).toBe(hashContext(e.payload.inputs, e.payload.targetParentVersionId));
        const sel = e.payload.selection!;
        expect(sel.contextHash).toBe(hashContext(sel.inputs, e.payload.newVersionId));
      }
    }
  });

  describe("state after the last event", () => {
    it("is on root version 2 with c8 merged and c7 open", () => {
      expect(final.rootVersions.map((r) => r.version)).toEqual([1, 2]);
      const c7 = final.comments.find((c) => c.id === "c7")!;
      const c8 = final.comments.find((c) => c.id === "c8")!;
      expect(c8.mergedIntoRootVersion).toBe(2);
      expect(c7.mergedIntoRootVersion).toBeUndefined();
      expect(decisionSummary(final).text).toContain(c7.text);
      expect(decisionSummary(final).text).not.toContain(c8.text);
    });

    it("enables the A2-spa subtree and nothing under A-server", () => {
      const enabled = enabledSet(final);
      for (const id of ["A2-spa", "A1p", "A1p-doclog", "A3p", "A3p-full", "A2p", "A2p-adapter", "A4p", "A5p", "A6p", "A7p"]) {
        expect(enabled.has(id), id).toBe(true);
      }
      for (const id of ["A-server", "A1", "A1-doclog", "A2", "A2-provider", "A3", "A3-full", "A7", "B2-optional-server", "A2p-prompted", "Q1"]) {
        expect(enabled.has(id), id).toBe(false);
      }
    });

    it("has no red marks; ported nodes carry portedFrom and no mark", () => {
      const marks = staleMarks(final);
      expect(Object.values(marks)).not.toContain("red");
      expect(final.nodes["A1p"]!.portedFrom).toBe("A1");
      expect(final.nodes["A3p"]!.portedFrom).toBe("A3");
      expect(final.nodes["A1p-doclog"]!.portedFrom).toBe("A1-doclog");
      expect(markOf(final, "A1p")).toBe("none");
      expect(markOf(final, "A3p")).toBe("none");
      // Only enabled current versions are marked; versions under root v1 are absent.
      for (const id of ["A1", "A2", "A3", "A-server"]) expect(markOf(final, id)).toBeUndefined();
      // Ported solutions were re-recorded before sibling decisions were made: possibly stale.
      expect(Object.entries(marks).filter(([, m]) => m === "yellow").map(([v]) => v).sort()).toEqual([
        "A1p-doclog-v1",
        "A3p-full-v1",
      ]);
    });

    it("reports 4 unresolved problems under A2-spa", () => {
      const c = completeness(final);
      expect(c.count).toBe(4);
      expect(c.unresolvedProblemIds).toEqual(["A4p", "A5p", "A6p", "A7p"]);
      expect(c.unansweredClarificationIds).toEqual([]);
      expect(c.unresolvedProblemIds.map((id) => final.nodeVersions[final.nodes[id]!.currentVersionId]!.title)).toEqual([
        "staleness",
        "canvas UI",
        "PRD generation",
        "provider registry",
      ]);
    });

    it("lists exactly the four decisions in depth-first order", () => {
      const lines = decisionSummary(final).decisions.map((d) => `${d.problemTitle} → ${d.solutionTitle}`);
      expect(lines).toEqual([
        "root → Browser-only SPA",
        "storage → doc + event log",
        "context → full + summarize",
        "contract → adapter per provider",
      ]);
    });

    it("suggests the expansion's suggestedNext and walks ancestor chains", () => {
      expect(suggestedNext(final)).toBe("A7p");
      expect(ancestorChain(final, "A1p-doclog").map((l) => l.nodeId)).toEqual([ROOT_NODE_ID, "A2-spa", "A1p", "A1p-doclog"]);
      expect(ancestorChain(final, "A1p-doclog").map((l) => l.title).slice(1)).toEqual([
        "Browser-only SPA",
        "storage",
        "doc + event log",
      ]);
    });
  });

  describe("checkpoints", () => {
    it("after seq 14: A1, A2, A3 are yellow", () => {
      const g = upTo(14);
      for (const id of ["A1", "A2", "A3"]) expect(markOf(g, id), id).toBe("yellow");
    });

    it("after seq 15: A1, A2, A3 are red", () => {
      const g = upTo(15);
      for (const id of ["A1", "A2", "A3"]) expect(markOf(g, id), id).toBe("red");
    });

    it("after seq 17: A1, A2, A3 are disabled and unmarked", () => {
      const g = upTo(17);
      for (const id of ["A1", "A2", "A3"]) {
        expect(enabledSet(g).has(id), id).toBe(false);
        expect(markOf(g, id), id).toBeUndefined();
      }
      expect(Object.values(staleMarks(g))).not.toContain("red");
    });
  });

  describe("determinism and purity", () => {
    it("folding the log twice gives byte-identical canonical snapshots", () => {
      const a = canonicalJson(replay(events));
      const b = canonicalJson(replay(JSON.parse(JSON.stringify(events)) as GraphEvent[]));
      expect(a).toBe(b);
    });

    it("never mutates events or earlier snapshots", () => {
      const frozen = deepFreeze(JSON.parse(JSON.stringify(events)) as GraphEvent[]);
      let g: Graph | null = null;
      for (const e of frozen) g = deepFreeze(reduce(g, e));
      expect(canonicalJson(g)).toBe(canonicalJson(final));
    });

    it("a snapshot round-tripped through JSON derives the same views", () => {
      const reloaded = JSON.parse(canonicalJson(final)) as Graph;
      expect([...enabledSet(reloaded)]).toEqual([...enabledSet(final)]);
      expect(decisionSummary(reloaded).text).toBe(decisionSummary(final).text);
      expect(staleMarks(reloaded)).toEqual(staleMarks(final));
    });

    it("memoises selectors by snapshot identity", () => {
      expect(enabledSet(final)).toBe(enabledSet(final));
      expect(staleMarks(final)).toBe(staleMarks(final));
    });
  });

  describe("invariants", () => {
    const at15 = upTo(15);
    const next = <T extends GraphEvent>(e: Omit<T, "id" | "graphId" | "seq" | "at">, seq = 16) =>
      ({ id: "x", graphId: "design-session", seq, at: "2026-10-24T12:00:00.000Z", ...e }) as GraphEvent;

    it("rejects a seq gap or duplicate", () => {
      expectEngineError(() => reduce(at15, events[16]!), "SeqConflict");
      expectEngineError(() => reduce(at15, events[14]!), "SeqConflict");
    });

    it("rejects a SolutionSelected with a non-child id", () => {
      expectEngineError(
        () => reduce(at15, next({ type: "SolutionSelected", payload: { problemNodeId: "A1", solutionNodeId: "A2-provider" } })),
        "InvalidSelection",
      );
    });

    it("rejects a RootRewritten that skips a version", () => {
      expectEngineError(
        () => reduce(at15, next({ type: "RootRewritten", payload: { version: 4, statement: "x", mergedCommentIds: [] } })),
        "ValidationFailed",
      );
    });

    it("refuses to overwrite an existing node version", () => {
      const e = events.find((x) => x.type === "NodeExpanded" && x.payload.parentVersionId === "A1-v1")!;
      expectEngineError(() => reduce(at15, { ...e, seq: 16 }), "ValidationFailed");
    });
  });
});
