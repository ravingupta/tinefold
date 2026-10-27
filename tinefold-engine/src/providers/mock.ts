import type { CompletionRequest, CompletionResult, Provider } from "./types";

export type MockHandler = (req: CompletionRequest) => unknown | Promise<unknown>;

/**
 * Deterministic provider for tests and demo mode. Answers from a scripted queue
 * first, then from `handler`, then from built-in generic responses. Records calls.
 */
export class MockProvider implements Provider {
  readonly id: string;
  readonly label = "Demo (mock)";
  readonly capabilities = { structuredOutput: true, tokenizer: false };
  readonly calls: CompletionRequest[] = [];
  private readonly queue: unknown[];

  constructor(opts: { id?: string; queue?: unknown[]; handler?: MockHandler; delayMs?: number } = {}) {
    this.id = opts.id ?? "mock";
    this.queue = [...(opts.queue ?? [])];
    this.handler = opts.handler;
    this.delayMs = opts.delayMs ?? 0;
  }
  private readonly handler?: MockHandler;
  private readonly delayMs: number;

  enqueue(...responses: unknown[]): void {
    this.queue.push(...responses);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    if (this.delayMs) await new Promise<void>((r) => setTimeout(() => r(), this.delayMs));
    const out = this.queue.length ? this.queue.shift() : this.handler ? await this.handler(req) : genericResponse(req);
    const tokens = { in: Math.ceil((req.system.length + req.user.length) / 4), out: 50 };
    return typeof out === "string" ? { text: out, tokens } : { json: out, tokens };
  }
}

let counter = 0;
function genericResponse(req: CompletionRequest): unknown {
  const n = ++counter;
  const focus = /## This node\n[\s\S]*?Title: (.*)/.exec(req.user)?.[1] ?? /## Root problem\n\(v\d+\) (.*)/.exec(req.user)?.[1] ?? "this";
  const clean = focus.replace(/[?.!]+$/, "");
  const short = clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
  // A second round for the same node: hand back a visibly different set.
  const again = /now being replaced/.test(req.user);
  switch (req.purpose) {
    case "expand-problem":
      if (/return kind "clarify"/.test(req.user) && !/Do not return kind "clarify"/.test(req.user) && n % 3 === 0) {
        return {
          kind: "clarify",
          items: [{ id: "q1", title: `What scale do you expect here?`, summary: "Scale changes which options are viable.", pros: [], cons: [], options: [{ id: "s", title: "Small (prototype)" }, { id: "m", title: "Medium (one team)" }, { id: "l", title: "Large (many teams)" }] }],
          assumptions: [],
        };
      }
      if (again) {
        return {
          kind: "solutions",
          axis: "build vs buy",
          items: [
            { id: "a", title: "Buy a managed service", summary: `For “${short}”: pay for something that already does this.`, axisValue: "buy", pros: ["Nothing to run"], cons: ["Recurring cost", "Lock-in"] },
            { id: "b", title: "Adopt an open-source base", summary: "Self-host a proven project and adapt it.", axisValue: "adapt", pros: ["No licence cost", "Full code access"], cons: ["You operate it"] },
            { id: "c", title: "Build only the core", summary: "Write the differentiating part; buy or borrow the rest.", axisValue: "build", pros: ["Tight fit"], cons: ["Longer to first result"] },
          ],
          recommendedId: "b",
          reason: "Demo mode: a different cut of the same problem, as asked.",
          assumptions: ["Demo mode: responses are generic placeholders, not real analysis."],
        };
      }
      return {
        kind: "solutions",
        axis: "effort vs control",
        items: [
          { id: "a", title: "Simplest path", summary: `For “${short}”: use the most off-the-shelf approach and measure before investing more.`, axisValue: "low effort", pros: ["Fast to try", "Cheap"], cons: ["Less control"] },
          { id: "b", title: `Balanced approach`, summary: "Build a thin custom layer over proven components.", axisValue: "medium", pros: ["Good fit", "Room to grow"], cons: ["More moving parts"] },
          { id: "c", title: `Full custom build`, summary: "Design and own every part end to end.", axisValue: "high control", pros: ["Maximum control"], cons: ["Slow", "Expensive to maintain"] },
        ],
        recommendedId: "a",
        reason: "Demo mode: the simplest option is recommended until real constraints are known.",
        assumptions: ["Demo mode: responses are generic placeholders, not real analysis."],
      };
    case "expand-solution":
      if (again) {
        return {
          kind: "subproblems",
          items: [
            { id: "p1", title: "What must be true for this to count as done?", summary: "Acceptance criteria shape everything below.", pros: [], cons: [] },
            { id: "p2", title: "Which existing systems does it touch?", summary: "Integrations set the hard constraints.", pros: [], cons: [] },
            { id: "p3", title: "How do we roll it out safely?", summary: "Migration, flags and rollback.", pros: [], cons: [] },
            { id: "p4", title: "Who owns it after launch?", summary: "Operations and support cost.", pros: [], cons: [] },
          ],
          suggestedNextId: "p1",
          assumptions: [],
        };
      }
      return {
        kind: "subproblems",
        items: [
          { id: "p1", title: "How is data stored?", summary: "Everything else reads and writes it.", pros: [], cons: [] },
          { id: "p2", title: "How do users interact with it?", summary: "Defines the surface and the main flows.", pros: [], cons: [] },
          { id: "p3", title: "How is it deployed and operated?", summary: "Cost and reliability live here.", pros: [], cons: [] },
        ],
        suggestedNextId: "p1",
        assumptions: [],
      };
    case "regenerate":
      return { title: `${short} (revised)`, summary: "Regenerated in demo mode to reflect the current context.", pros: ["Up to date"], cons: [] };
    case "staleCheck":
      return { verdict: "fresh", reason: "Demo mode: the change does not affect these options." };
    case "rewrite": {
      const ids = [...req.user.matchAll(/\[id: ([^\]]+)\]/g)].map((m) => m[1]!);
      const root = /## Root problem\n\(v\d+\) ([\s\S]*?)\n\n/.exec(req.user)?.[1] ?? "";
      const comments = [...req.user.matchAll(/\[id: [^\]]+\] (.*)/g)].map((m) => m[1]).join(" ");
      return { statement: `${root} ${comments}`.trim(), mergedCommentIds: ids };
    }
    case "summarize":
      return "Decisions (condensed in demo mode).";
    case "document":
      return `# Demo document\n\nThis was generated in demo mode, so it only echoes the decision tree.\n\n${/## Decisions so far\n([\s\S]*?)\n\n/.exec(req.user)?.[1] ?? ""}\n`;
  }
}
