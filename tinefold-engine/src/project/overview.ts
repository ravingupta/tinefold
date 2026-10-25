import { currentRoot } from "../select/lookup";
import { completeness, decisionSummary } from "../select/views";
import { titleOf } from "../select/lookup";
import type { Graph } from "../schema/graph";
import type { Project } from "./schema";

export interface OverviewPart {
  graphId: string;
  statement: string;
  rootVersion: number;
  decisions: { problem: string; solution: string }[];
  open: string[];
  /** Nothing chosen at the root yet. */
  notStarted: boolean;
}

export interface SharedChoice {
  /** The solution title, as first seen. */
  solution: string;
  graphIds: string[];
}

export interface ProjectOverview {
  parts: OverviewPart[];
  /** Brainstorm ids the project lists that are missing from storage. */
  missing: string[];
  /** The same solution chosen in more than one brainstorm: a cheap hint of where they connect. */
  shared: SharedChoice[];
  totals: { decisions: number; open: number };
}

/**
 * The high-level structure of a project, rendered by code from each brainstorm's
 * snapshot: no model call, always current. `graphs` may arrive in any order.
 */
export function projectOverview(project: Project, graphs: Graph[]): ProjectOverview {
  const byId = new Map(graphs.map((g) => [g.id, g]));
  const parts: OverviewPart[] = [];
  const missing: string[] = [];
  for (const id of project.graphIds) {
    const g = byId.get(id);
    if (!g) {
      missing.push(id);
      continue;
    }
    const done = completeness(g);
    const decisions = decisionSummary(g).decisions.map((d) => ({
      problem: d.problemNodeId === "root" ? "Approach" : d.problemTitle,
      solution: d.solutionTitle,
    }));
    parts.push({
      graphId: id,
      statement: currentRoot(g).statement,
      rootVersion: currentRoot(g).version,
      decisions,
      open: [...done.unansweredClarificationIds, ...done.unresolvedProblemIds].map((x) => (x === "root" ? "Choose an approach" : titleOf(g, x))),
      notStarted: decisions.length === 0,
    });
  }
  const seen = new Map<string, SharedChoice>();
  for (const p of parts) {
    for (const d of p.decisions) {
      const key = d.solution.trim().toLowerCase();
      const entry = seen.get(key) ?? { solution: d.solution, graphIds: [] };
      if (!entry.graphIds.includes(p.graphId)) entry.graphIds.push(p.graphId);
      seen.set(key, entry);
    }
  }
  return {
    parts,
    missing,
    shared: [...seen.values()].filter((s) => s.graphIds.length > 1),
    totals: {
      decisions: parts.reduce((n, p) => n + p.decisions.length, 0),
      open: parts.reduce((n, p) => n + p.open.length, 0),
    },
  };
}
