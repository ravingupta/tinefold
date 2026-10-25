# Brainstorm Engine Spec

Oct 24, 2026 · @Ravin Gupta

## Purpose and boundary

The engine owns all state and all logic; clients only render it and forward user actions. It is a TypeScript package with no DOM, no React and no direct IndexedDB: storage and LLM providers reach it through adapter interfaces.

| In the engine | Out of the engine |
| --- | --- |
| Event log, reducer, graph model, versioning | Any UI framework, components, layout |
| Derived state: enabled set, stale marks, completeness, decision summary | IndexedDB implementation (client implements StorageAdapter) |
| Context compiler and hashing | Key management UI, settings screens |
| Expansion contract, validation, prompts | Rendering of PRD or export formatting |
| Provider adapter interface, MockProvider, AnthropicProvider, OpenAIProvider | Canvas layout |
| Staleness rules and the cheap stale check |  |
| PRD generation and cache |  |

Rules that keep the boundary honest:

- The engine runs under Node and Vitest with the in-memory storage adapter and MockProvider. Every feature is tested there first.
- Package name: brainstorm-engine (scope to be chosen). Published to npm with semver; the client pins a version. Local development links the two repos with pnpm link.
- Exports are typed. A client never reaches into internals; if it needs something, the engine grows an export.
- Provider HTTP calls use the global fetch, so adapters live in the engine and work in both Node and browser. The Anthropic adapter sets the browser-access header when configured.

## Domain model

A graph is one brainstorming session. It holds a versioned root, a set of nodes, and node versions; selections live on problem nodes. Everything else is derived.

| Entity | Fields | Notes |
| --- | --- | --- |
| Graph | id, createdAt, rootVersions\[\], comments\[\], nodes{}, nodeVersions{}, selections{}, answers{}, prdCache{} | The snapshot shape. Rebuilt from events or loaded whole |
| RootVersion | version, statement, createdAt, approvedFromCommentIds\[\] | v1 is the original statement; later versions are approved rewrites |
| Comment | id, text, createdAt, mergedIntoRootVersion? | Global amendments. mergedIntoRootVersion set when a rewrite absorbed it |
| Node | id, kind (problem, solution, clarification), parentVersionId, currentVersionId, portedFrom? | Identity across versions. parentVersionId is the version of the parent that generated it |
| NodeVersion | id, nodeId, version, title, summary, axisValue, pros\[\], cons\[\], contextHash, inputs, generatedBy, tokens, createdAt | Immutable. Regeneration appends a new version with the same nodeId |
| ExpansionInputs | rootVersion, ancestorSelectionIds\[\], decisionIds\[\], commentIds\[\], answerIds\[\] | Recorded at generation time; drives staleness |
| Selection | problemNodeId → solutionNodeId or null | The only mutable state per problem node |
| Answer | clarificationNodeId → itemId or freeText | Answers to clarification nodes |
| Expansion | parentVersionId → kind, itemNodeIds\[\], axis, recommendedId, reason, suggestedNextId, assumptions\[\] | What one expand call produced for one parent version |

Node kinds and what their children mean:

- A problem's children are solutions; one may be selected.
- A solution's children are sub-problems; all are required.
- A clarification's children are answer items; one is answered, or free text. Answering adds an Answer, no new nodes.

Ids are ULIDs. Hashes are SHA-256 hex of canonical JSON (sorted keys).

## Event log

The event log is the source of truth. The snapshot is a cache of folding the log. Every event carries id, graphId, seq (monotonic per graph), at (ISO time), and type plus payload.

| Event | Payload | Effect in the reducer |
| --- | --- | --- |
| GraphCreated | graphId, statement | Root v1, empty graph |
| CommentAdded | commentId, text | Append comment; mark all enabled node versions yellow |
| RootRewritten | version, statement, mergedCommentIds\[\] | New root version; mark every node version red |
| NodeExpanded | parentVersionId, kind, items\[\] (new nodeIds + versions), axis, recommendedId, reason, suggestedNextId, assumptions\[\], contextHash, inputs, generatedBy, tokens | Create nodes and versions; record the Expansion |
| NodeRegenerated | nodeId, newVersion (same shape as one item), contextHash, inputs | Append a version; children of the old version stay attached to it |
| SolutionSelected | problemNodeId, solutionNodeId or null | Set selection; mark descendants of the old selection as disabled (derived), mark versions under the new path for re-check |
| ClarificationAnswered | clarificationNodeId, itemId or freeText | Set answer; mark enabled descendants of the clarification yellow |
| NodePorted | sourceNodeId, targetParentVersionId, newNodeId | Copy the node and its current version under a new parent with portedFrom set; copy its selection if it had one |
| StaleChecked | nodeVersionId, verdict (fresh, stale), reason, contextHash | Clear or confirm a yellow mark for that hash |
| PrdGenerated | contextHash, markdown, generatedBy, tokens | Cache entry; not a graph change |

Invariants the reducer enforces, and tests assert:

- seq is contiguous per graph; a gap or duplicate is rejected before folding.
- A SolutionSelected whose solutionNodeId is not a child of problemNodeId is rejected.
- A NodeVersion is never mutated after NodeExpanded or NodeRegenerated.
- RootRewritten increments version by exactly one.
- Folding the same log twice yields byte-identical canonical snapshots (determinism).

## Reducer and derived state

reduce(snapshot, event) → snapshot is a pure function. Derived views are computed from the snapshot by pure selectors and never stored in the log.

| Derived view | Definition | Used by |
| --- | --- | --- |
| enabledSet | Node ids reachable from the root by following: root → every root-level problem; problem → its selected solution only; solution → all its sub-problems; clarification → nothing | Client dimming, context compiler, stale marking |
| activeSubtree | enabledSet restricted to the current root version's descendants | Decision summary |
| staleMarks | nodeVersionId → red, yellow, or none (see Staleness rules) | Client marks, regenerate prompts |
| completeness | Count of enabled problem nodes with no selection, plus enabled clarifications with no answer | Client progress, PRD readiness |
| decisionSummary | Deterministic text: root statement, comments in order, then one line per enabled problem with a selection: "\<problem title> → \<solution title>" in depth-first order | Context compiler, PRD prompt |
| ancestorChain(nodeId) | Titles from root to the node, with the selected solution at each problem level | Context compiler |
| suggestedNext | From the lowest expanded enabled solution with unresolved sub-problems, the suggestedNextId of its Expansion, else the first unresolved | Client "next" affordance |

Selectors are memoised by snapshot identity. A client renders from the snapshot and these selectors only.

## Context compiler and hashing

compileContext(snapshot, nodeId) returns the exact text sent to a provider plus the hash and the inputs record. It is deterministic: same snapshot and node in, same bytes out.

Sections, in order, each under a fixed heading:

1. Root problem: the current root version statement.
2. Comments: every comment not yet merged into the current root version, in seq order.
3. Decisions so far: the decisionSummary.
4. Answers so far: every answered clarification in the active subtree, as "Q → A".
5. This node: the ancestorChain, then the node's own title and summary.
6. Task: the kind-specific instruction (expand a problem into solutions, a solution into sub-problems, or decide whether to ask a clarification first).

Hashing: contextHash = sha256(canonical JSON of {rootVersion, commentIds, decisionIds, answerIds, ancestorSelectionIds, nodeVersionId}). The hash is over ids, not text, so a cosmetic prompt change does not mark the whole graph stale. A prompt template version is a separate field on NodeVersion.generatedBy.

Budget: count tokens with the provider's tokenizer when available, else characters divided by 4. Log the count on every call. Above a hard ceiling (default 24,000 tokens), replace section 3 with a cached LLM condensation keyed on the same hash; above a second ceiling (default 48,000), refuse with a clear error rather than truncating silently.

## Expansion contract

One Zod schema covers every expansion. The provider returns JSON matching it; the engine validates, then additionally checks sense (non-empty items, recommendedId present among items, axis set for solutions).

```typescript
const ExpansionOutput = z.object({
  kind: z.enum(["clarify", "solutions", "subproblems", "leaf"]),
  axis: z.string().optional(),            // required when kind = solutions
  items: z.array(z.object({
    id: z.string(),                       // provider-local, remapped to ULIDs
    title: z.string().max(80),
    summary: z.string().max(400),
    axisValue: z.string().optional(),
    pros: z.array(z.string()).max(4),
    cons: z.array(z.string()).max(4),
  })).min(0).max(6),
  recommendedId: z.string().optional(),
  reason: z.string().max(300).optional(),
  suggestedNextId: z.string().optional(), // only for subproblems
  assumptions: z.array(z.string()).max(5),
  leafReason: z.string().optional(),      // only for leaf
});
```

Kind rules:

| Parent kind | Allowed output kinds | Item meaning |
| --- | --- | --- |
| problem | clarify, solutions, leaf | clarify: answer options for one question; solutions: options differing on axis; leaf: actionable by one engineer in a few days, no expansion |
| solution | clarify, subproblems | subproblems: all required; suggestedNextId names the most constraining |
| clarification | none | Clarifications are never expanded |

Prompt requirements, enforced by eval fixtures rather than code: options must differ on the named axis, not be rewordings; cheapest or simplest option listed first; every made-up number labeled illustrative; ask (clarify) only when a missing fact would change the options.

## Provider adapter

A provider is anything that turns a compiled context into an ExpansionOutput or a text completion. The engine ships three; the client registers which to use per stage.

```typescript
interface Provider {
  id: string;                                   // "anthropic", "openai", "mock"
  capabilities: { structuredOutput: boolean; tokenizer: boolean };
  complete(req: {
    system: string; user: string;
    schema?: ZodSchema; maxTokens: number; model: string;
  }): Promise<{ text?: string; json?: unknown; tokens: { in: number; out: number } }>;
  countTokens?(text: string): Promise<number>;
}

type Stage = "expand" | "staleCheck" | "summarize" | "prd";
interface ProviderRegistry {
  default: { providerId: string; model: string };
  overrides: Partial<Record<Stage, { providerId: string; model: string }>>;
}
```

| Adapter | Enforcement | Notes |
| --- | --- | --- |
| MockProvider | Returns fixtures keyed by contextHash or by a scripted queue | Used by every engine test; never calls the network |
| AnthropicProvider | Tool-use with the Zod schema converted to JSON Schema | Sets the direct-browser-access header when options.browser is true |
| OpenAIProvider | Structured outputs (json\_schema) | Milestone 7; not needed for MVP |

Fallback path: when capabilities.structuredOutput is false, the engine appends the JSON schema to the prompt, parses the first JSON object in the reply, validates, and retries once with the validation error appended. Two failures surface as a typed EngineError, never a thrown string.

## Storage adapter

The engine defines the interface and ships an in-memory implementation. The web client implements it over IndexedDB. The engine never imports a database.

```typescript
interface StorageAdapter {
  listGraphs(): Promise<{ id: string; title: string; updatedAt: string }[]>;
  appendEvent(e: GraphEvent): Promise<void>;        // must reject on seq conflict
  readEvents(graphId: string, fromSeq?: number): Promise<GraphEvent[]>;
  readSnapshot(graphId: string): Promise<{ snapshot: Graph; seq: number } | null>;
  writeSnapshot(graphId: string, snapshot: Graph, seq: number): Promise<void>;
  deleteGraph(graphId: string): Promise<void>;
}
```

Load path: read the snapshot, then fold any events with seq above the snapshot's seq. Write path: append the event first, then update the snapshot. If the snapshot write fails, the next load repairs it from the log. The snapshot is a cache; the log is the truth.

## Staleness rules

A node version is stale when the context it was generated under no longer matches the current state. Marks are derived from ExpansionInputs against the snapshot; nothing is stored except StaleChecked results.

| Condition | Mark | Resolution |
| --- | --- | --- |
| inputs.rootVersion differs from current root version | Red | Regenerate (new version) or port |
| Any id in inputs.ancestorSelectionIds no longer matches the current selection at that ancestor | Red | Regenerate or port |
| inputs.decisionIds differs from current enabled decisions (sibling branches changed) | Yellow | Cheap check on open, then StaleChecked |
| inputs.commentIds misses a current comment, or inputs.answerIds misses a current answer in the active subtree | Yellow | Cheap check on open |
| A StaleChecked exists for this version with the current contextHash | Its verdict | fresh clears the mark; stale shows as red |

Rules:

- Only enabled node versions carry marks. Disabled branches are re-evaluated when they become enabled.
- The cheap check uses the staleCheck stage of the registry. Prompt: given the old context and the new context diff, are these items still valid options? Returns {verdict, reason}.
- The restart warning is computed, not stored: for the highest red node in the active subtree, count red descendants; the client shows "restart from here" when the count is 3 or more.
- Regeneration never deletes. The old version and any selections under it remain, attached to the old version id.

## PRD generation

generatePrd(snapshot) is on demand and cached. Input is the compiled context with a PRD task section instead of a node section; output is markdown. The cache key is the same contextHash scheme over the whole active subtree, so an unchanged graph returns the cached PRD without a call.

The prompt asks for these sections, in order: problem statement, users and scope, decisions with rationale, assumptions, open sub-problems marked TBD, non-goals, decision history. Unresolved problems are listed, never invented. The decision summary is passed verbatim and the prompt forbids contradicting it.

## Public API

The client sees one factory and the types. Commands are async because they may call a provider; dispatch is sync because it only folds an event.

```typescript
const session = await createSession({ storage, providers, registry, graphId? });

session.getSnapshot(): Graph;
session.subscribe((snapshot) => void): Unsubscribe;
session.select: {
  enabledSet(), staleMarks(), completeness(), decisionSummary(),
  ancestorChain(nodeId), suggestedNext(), restartWarning()
};

// user actions: fold an event, persist it
session.addComment(text): Promise<void>;
session.selectSolution(problemNodeId, solutionNodeId | null): Promise<void>;
session.answerClarification(nodeId, itemId | { freeText }): Promise<void>;
session.approveRootRewrite(statement, mergedCommentIds): Promise<void>;
session.portNode(sourceNodeId, targetParentVersionId): Promise<void>;

// provider-backed commands
session.expand(nodeId): Promise<Expansion>;
session.regenerate(nodeId): Promise<NodeVersion>;
session.proposeRootRewrite(): Promise<{ statement: string; mergedCommentIds: string[] }>;
session.checkStale(nodeVersionId): Promise<StaleVerdict>;
session.generatePrd(): Promise<{ markdown: string; cached: boolean }>;

// utilities
session.compileContext(nodeId): { text: string; hash: string; tokens: number };
session.exportEvents(): Promise<GraphEvent[]>;
```

Errors are typed EngineError values with a code (ValidationFailed, ProviderFailed, ContextTooLarge, SeqConflict, InvalidSelection). The client switches on code; it never parses messages.

## Test fixture: the design session

The session that produced this spec, replayed as an event log. Every NodeExpanded uses MockProvider fixtures, so the whole run is deterministic and needs no network. Ids are readable here; the fixture file uses them as given.

| seq | Event | Key payload |
| --- | --- | --- |
| 1 | GraphCreated | statement: "AI-driven brainstorming tool for IT/software problems, AND-OR graph, user controls selection" |
| 2 | NodeExpanded | parent root-v1 → kind clarify, node Q1 (audience, collab, surface) |
| 3 | ClarificationAnswered | Q1 → solo, one user, web canvas; freeText "later open source, pluggable models and task types" |
| 4 | CommentAdded | c7: "Later open source; others attach own models for classify, describe, plan" |
| 5 | NodeExpanded | parent root-v1 → kind solutions, axis "where engine and state live", items A-server, B-local, C-library; recommended C |
| 6 | SolutionSelected | root → A-server |
| 7 | NodeExpanded | parent A-server → kind subproblems, items A1-storage … A7-api; suggestedNext A1 |
| 8 | NodeExpanded | parent A1 → solutions, items relational, doc+log, pure-events; recommended doc+log |
| 9 | SolutionSelected | A1 → doc+log |
| 10 | NodeExpanded | parent A2 → solutions; recommended provider-enforced |
| 11 | SolutionSelected | A2 → provider-enforced |
| 12 | NodeExpanded | parent A3 → solutions |
| 13 | SolutionSelected | A3 → full+summarize |
| 14 | CommentAdded | c8: "doc + event log means no backend; pure API, multiple providers per stage" |
| 15 | RootRewritten | version 2, mergedCommentIds \[c8\] |
| 16 | NodeExpanded | parent root-v2 → solutions, axis "runtime host", items A2-spa, B2-optional-server, C2-desktop; recommended A2-spa |
| 17 | SolutionSelected | root → A2-spa |
| 18 | NodePorted | A1 → under A2-spa as A1p (selection doc+log copied) |
| 19 | NodePorted | A3 → under A2-spa as A3p |
| 20 | NodeExpanded | parent A2p-contract (new under A2-spa) → solutions; recommended adapter-per-provider |
| 21 | SolutionSelected | A2p → adapter-per-provider |

Expected state after seq 21, asserted by the test:

- Root version is 2; comment c8 has mergedIntoRootVersion 2; c7 is unmerged and appears in compiled context.
- enabledSet contains A2-spa, A1p, A3p, A2p and their selected children; it excludes A-server and everything under it.
- Every version generated under root v1 that is still enabled is red; after seq 17 none are enabled, so staleMarks has no red entries. A1p and A3p carry the portedFrom link and inherit no mark.
- completeness reports 4 unresolved problems under A2-spa (staleness, canvas UI, PRD generation, provider registry).
- decisionSummary lists exactly: root → Browser-only SPA; storage → doc + event log; context → full + summarize; contract → adapter per provider.
- Folding seq 1–21 twice gives byte-identical canonical snapshots.
- Checkpoint after seq 14: A1, A2, A3 versions are yellow; after seq 15 they are red; after seq 17 they are disabled and unmarked.

Additional fixtures to add as they are found: a comment that appends without a rewrite (yellow only, cheap check returns fresh), a regenerate that leaves a selection on the old version, a rejected SolutionSelected with a non-child id.

## Milestones

One milestone per Claude Code session. Each ends green under Vitest with MockProvider and the in-memory adapter; no milestone needs an API key until E3.

| # | Milestone | Done when |
| --- | --- | --- |
| E0 | Contract as code | Zod schemas for Graph, GraphEvent, NodeVersion, ExpansionOutput, EngineError; package builds to ESM + types; no runtime code yet |
| E1 | Reducer, selectors, fixture | reduce() and all selectors implemented; the design-session fixture replays and every assertion in that section passes; determinism test passes |
| E2 | Context compiler | compileContext() produces the six sections; hash is stable across runs; token counting with fallback; ceilings enforced with typed errors |
| E3 | Providers and expand | Provider interface, MockProvider, AnthropicProvider (browser header option); session.expand() and regenerate() run end to end from a Node script against the real API once, then against mocks in CI |
| E4 | Staleness | staleMarks selector matches the rules table; checkStale() via the staleCheck stage; restartWarning(); fixture checkpoints at seq 14, 15, 17 pass |
| E5 | Root rewrite and porting | proposeRootRewrite() returns a merged statement; approveRootRewrite() and portNode() fold correctly; fixture seq 15–19 covered |
| E6 | PRD generation | generatePrd() with cache keyed on hash; cached flag correct; prompt forbids contradicting the decision summary |
| E7 | Publish | npm publish with semver 0.1.0; README covers createSession, adapters, and how to implement StorageAdapter; OpenAIProvider added |

Order matters: E1 before E2 so the hash has real inputs; E4 after E3 so the cheap check has a provider; E7 last so the client never pins a moving target during development (use pnpm link until then).

## CLAUDE.md for the engine repo

Copy this into the repo root as CLAUDE.md.

```markdown
# brainstorm-engine

Pure TypeScript engine for an AND-OR brainstorming graph. No DOM, no React, no database imports.

## Non-negotiables
- Event log is the source of truth. The snapshot is a cache. Never mutate a NodeVersion.
- reduce() and every selector are pure and deterministic. If a test is flaky, the bug is here.
- Storage and LLM providers go through adapters. Ship in-memory + MockProvider; real adapters use global fetch only.
- Every feature lands with a Vitest test that runs under MockProvider. No test hits the network.
- Errors are typed EngineError with a code. Never throw strings.

## Layout
- src/schema/     Zod schemas and types (E0)
- src/reducer/    reduce(), invariants
- src/select/     memoised selectors (enabledSet, staleMarks, decisionSummary, ...)
- src/context/    compileContext(), hashing, token budget
- src/providers/  Provider interface, mock, anthropic, openai
- src/storage/    StorageAdapter interface, memory adapter
- src/session/    createSession() and commands
- test/fixtures/  design-session.events.json + expected snapshots

## Working rules
- Start each milestone by writing or extending the fixture test, then implement until green.
- Do not add a feature the spec does not name. Propose it in a comment on the spec instead.
- Keep public API changes in CHANGELOG.md; the web client pins versions.

## Commands
- pnpm test        Vitest
- pnpm build       tsup to dist/ (ESM + d.ts)
- pnpm link --global   for local development with the web client
```
