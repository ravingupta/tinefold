import type { NodeKind } from "../schema/common";
import { DOC_TYPE_LABELS, ROOT_NODE_ID, rootVersionId, type DocType, type Graph } from "../schema/graph";
import { currentRoot } from "../select/lookup";
import { nameIsAuto } from "../select/name";

/** Bumped whenever prompt text changes. Recorded in generatedBy, never in the hash. */
export const PROMPT_VERSION = "p2";

export type ContextTask =
  | { kind: "expand"; allowClarify?: boolean }
  | { kind: "regenerate" };

export const SYSTEM_PROMPT = `You are the expansion engine of a brainstorming tool for IT and software problems.
The user explores an AND-OR graph: a PROBLEM is answered by choosing ONE solution; a SOLUTION is done only when ALL of its sub-problems are solved.
The user makes every choice. You propose; you never decide for them.

Rules:
- Ground every option in the root problem, the comments, the decisions so far and the answers. Never contradict a decision already made.
- Later comments override earlier ones.
- Options must genuinely differ along one named axis (cost, complexity, managed vs self-hosted, build vs buy...). Never return rewordings of one idea.
- List the cheapest or simplest option first. Prefer "measure first" options when facts are missing.
- Label any number you invent as illustrative.
- Keep titles under 10 words and summaries to 1–2 plain sentences.
- If you had to assume a fact, list it in "assumptions" so the user can correct it.`;

/**
 * Ask for a brainstorm name on a root expansion while the user hasn't named it and
 * the current root version has no options yet (first expansion, or after a rewrite).
 */
export function wantsName(g: Graph, nodeId: string): boolean {
  if (nodeId !== ROOT_NODE_ID || !nameIsAuto(g)) return false;
  return !(g.expansions[rootVersionId(currentRoot(g).version)] ?? []).some((x) => x.kind !== "clarify");
}

const NAME_ASK = `\nAlso set "name": a 2–4 word title for this whole brainstorm, in Title Case with no punctuation, that the user will recognise in a list (e.g. "Catalog Search Rebuild").`;

export function taskFor(
  g: Graph,
  nodeId: string,
  kind: NodeKind,
  task: ContextTask,
  asked: { question: string; answer: string | null }[],
): string {
  if (task.kind === "regenerate") {
    return `Rewrite THIS NODE (title, summary, pros, cons, axisValue) so it fits the current context above. Keep its intent; update anything the new comments, answers or decisions invalidate.`;
  }
  const askedText = asked.length
    ? `\nQuestions already asked here:\n${asked.map((a) => `- ${a.question} → ${a.answer ?? "(unanswered)"}`).join("\n")}\nDo NOT ask clarifying questions again; work with these answers.`
    : "";
  const clarify = task.allowClarify !== false && asked.length === 0
    ? `If a missing fact would materially change the options (scale, team, budget, constraints), return kind "clarify" with 1–3 questions as items: title = the question, summary = why it matters, options = 2–4 short answer choices, pros/cons empty.`
    : `Do not return kind "clarify".`;
  if (kind === "problem") {
    const what = nodeId === ROOT_NODE_ID ? "the root problem" : "this problem";
    return `Expand ${what}.
${clarify}
Otherwise return kind "solutions": 2–4 options as items, set "axis" to the single dimension they differ on and each item's "axisValue" to its position on it, give 1–3 pros and cons each, set "recommendedId" and a one-sentence "reason".
If the problem is already small enough for one engineer to do in a few days without further design choices, return kind "leaf" with an empty items list and a "leafReason".${askedText}${wantsName(g, nodeId) ? NAME_ASK : ""}`;
  }
  return `This solution was chosen. Break it into the sub-problems that must ALL be solved for it to work.
${clarify}
Otherwise return kind "subproblems": 2–6 items, each a problem phrased as a question or need (title) with a one-sentence summary of why it matters. pros/cons empty. Set "suggestedNextId" to the most constraining sub-problem (the one the others depend on).${askedText}`;
}

export const STALE_CHECK_SYSTEM = `You check whether previously generated brainstorming options are still valid after the context changed. Answer "fresh" if the options are still reasonable choices given the change, "stale" if the change makes any of them wrong, impossible, or clearly incomplete. Be concise.`;

export const REWRITE_SYSTEM = `You maintain the root problem statement of a brainstorming session. Merge the given comments into one clear, complete problem statement in plain language (3–8 sentences). Keep every constraint, resolve contradictions in favour of later comments, and drop nothing that still applies. Return the statement and the ids of the comments you merged (normally all of them).`;

export const SUMMARIZE_SYSTEM = `Condense the list of decisions into the shortest text that keeps every decision and constraint an engineer would need. One line per decision group. No commentary.`;

const DOC_GUIDES: Record<Exclude<DocType, "custom">, string> = {
  prd: `Sections: Problem statement; Users and scope; Goals and non-goals; Requirements (functional, non-functional); Decisions with rationale; Assumptions; Open questions (every OPEN problem, marked TBD); Risks.`,
  trd: `Sections: Overview; Architecture (components and how they interact); Key technical decisions (chosen option, alternatives rejected and why); Data model and interfaces where implied; Non-functional concerns (scale, security, cost, operability); Assumptions; Open technical questions (every OPEN problem, marked TBD); Rollout / build order.`,
  solution: `Sections: Summary of the chosen solution in one paragraph; Problem and constraints; Solution walkthrough following the decision tree top-down; Alternatives considered (rejected options with one-line reasons); Trade-offs accepted; Assumptions; Open items (every OPEN problem); Next steps.`,
  adr: `Write one Architecture Decision Record per decision in the tree, in tree order. Each: Title; Status (Accepted, or Proposed for OPEN problems); Context; Options considered; Decision; Consequences.`,
  overview: `A high-level structure of the whole project. Sections: What the project is (2–3 sentences); The parts (one short paragraph per brainstorm: its problem and the path chosen); How they connect (dependencies between brainstorms, shared decisions, interfaces between parts); Conflicts and gaps (contradicting decisions across brainstorms, problems nobody has decided yet); Suggested order of work.`,
  brief: `One page maximum. Sections: The problem (2–3 sentences); The approach (bullets of the key decisions); What is still open; Next step.`,
};

export function documentPrompt(docType: DocType, instructions?: string, scope?: { brainstorms: number }): { system: string; task: string } {
  const label = DOC_TYPE_LABELS[docType];
  const guide = docType === "custom"
    ? `The user wants this document: ${instructions?.trim() || "a clear write-up of the solution"}. Choose sections that serve that purpose.`
    : DOC_GUIDES[docType] + (instructions?.trim() ? `\nAdditional instructions from the user: ${instructions.trim()}` : "");
  return {
    system: `You write ${label} documents from a brainstorming decision tree. The tree is the source of truth: never contradict a CHOSEN option, never invent a decision for an OPEN problem (list it as open instead), and keep rejected options only as alternatives. Output GitHub-flavoured markdown only, starting with a # title. Be specific and concise.`,
    task: `Write the document.\n${guide}${
      scope && scope.brainstorms > 1
        ? `\nThe material covers ${scope.brainstorms} brainstorms in one project. Write ONE integrated document: merge overlapping decisions, call out where one brainstorm's decision constrains another, and flag any contradictions between them as open questions.`
        : ""
    }`,
  };
}
