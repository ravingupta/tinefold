# Brainstorm Web Client Spec

Oct 24, 2026 · @Ravin Gupta

## Purpose

The web client renders an engine snapshot and forwards user actions to the engine session. It holds no business logic: no graph walking, no staleness math, no prompt text, no provider calls of its own.

The test of the boundary: if a behaviour could be wrong, the fix belongs in brainstorm-engine. If only the pixels could be wrong, it belongs here. When the client needs a value the engine does not expose, the engine grows a selector; the client never recomputes it.

## Stack and repo setup

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite + React 18 + TypeScript | Static output, fast dev loop |
| Engine dependency | brainstorm-engine from npm, pinned exact version; pnpm link during development | Client never vendors engine code |
| Persistence | Dexie over IndexedDB, implementing the engine's StorageAdapter | Engine defines the interface |
| State in React | useSyncExternalStore over session.subscribe | Snapshot is the single store; no Redux or Zustand |
| Styling | Tailwind | Fast; no design system yet |
| Tree view | Custom collapsible outline (milestone C1) | 80% of the UX, 10% of the effort |
| Canvas | React Flow + elkjs layout (milestone C7) | Only after the outline proves the engine |
| Tests | Vitest + Testing Library; engine always MockProvider | No network in tests |
| Hosting | Cloudflare Pages or GitHub Pages | Static; no server |

Two repos:

- brainstorm-engine: the package. Changes there are released with a version bump.
- brainstorm-web: this client. Depends on the published package; during development, pnpm link --global brainstorm-engine in the client after pnpm link --global in the engine.

Upgrading the engine is a one-line version bump plus a CHANGELOG read. If the client needs a feature, the request goes to the engine repo first.

## State flow

One engine session per open graph. The snapshot is the only application state; UI-only state (which nodes are collapsed, which panel is open) lives in component state or the URL and is never persisted by the engine.

1. App start: build DexieStorageAdapter, read provider settings from localStorage, build the ProviderRegistry, call createSession.
2. Render: components read the snapshot and selectors through useSyncExternalStore. No component derives graph facts on its own.
3. User action: a component calls one session command (selectSolution, addComment, expand, ...). It shows a pending state on that node while the promise is open.
4. Engine folds the event, persists it, notifies subscribers; React re-renders from the new snapshot.
5. Provider-backed commands may take seconds. The node shows a spinner; the rest of the tree stays interactive. Only one expand per node at a time; the button is disabled while pending.
6. Errors arrive as EngineError codes. The client maps each code to a message and a recovery action (retry, open settings, shorten context) and never shows raw messages.

What the client never does: compute enabled or stale state, build prompt text, call fetch to a provider, mutate the snapshot, or write to IndexedDB outside the adapter.

## Screens and components

Three screens; the outline screen is the product for the first six milestones.

| Screen | Contents | Session calls |
| --- | --- | --- |
| Graph list | Cards from storage.listGraphs(); new graph form (statement textarea); import events JSON | createSession per selected graph |
| Outline | Header: root statement (current version), version badge, comments panel toggle, PRD button, settings. Body: collapsible tree from the root, one row per node. Right rail: comments panel, assumptions list, restart warning | All user actions and expand/regenerate |
| Settings | Provider keys, default model, per-stage overrides, token ceiling display, export/import | None; writes localStorage and rebuilds the registry |

Outline components:

- NodeRow: title, kind icon, summary on expand, marks (see rendering rules), action buttons by kind. Problem rows show their solution children as a radio group. Solution rows list sub-problems with a "next" chip on suggestedNext. Clarification rows show answer options plus a free-text field, and an answered state.
- ExpandButton: on an unexpanded enabled node. Pending spinner while the promise is open. On a stale node the label reads Regenerate.
- OptionCard: for a solution item: title, axisValue, pros, cons, recommended badge with the reason on hover. Options are listed in the order the engine returns.
- CommentsPanel: ordered comment list, add box, and a Propose rewrite button that calls proposeRootRewrite and shows the merged statement with approve, edit, reject.
- AssumptionsList: every assumptions\[\] entry from enabled expansions, each with a Correct action that opens the comment box prefilled with the assumption text.
- RestartWarning: shown when restartWarning() returns a node; names the node and the count of red descendants, with Regenerate from here.
- PrdPanel: calls generatePrd, renders markdown, shows the cached flag, offers Copy and Download .md.

Keyboard: arrow keys move between rows, Enter expands or selects, c focuses the comment box. The pace is the user's; nothing expands automatically.

## Node rendering rules

Every visual state comes from a selector. The client reads the value and applies a style; it never decides the value.

| Selector value | Rendering |
| --- | --- |
| In enabledSet, selected (solution chosen under its parent problem) | Full opacity, bold title, radio checked |
| In enabledSet, not selected | Full opacity, radio unchecked |
| Not in enabledSet | 40% opacity, collapsed by default, radio disabled, no action buttons |
| staleMarks = red | Red left border; Expand button reads Regenerate; tooltip gives the reason (root changed, ancestor changed) |
| staleMarks = yellow | Amber left border; a Check button runs checkStale; result clears the border or turns it red |
| portedFrom set | Small link icon; tooltip names the source node and its old parent |
| Clarification answered | Options collapsed to the chosen answer with an Edit action |
| Expansion has assumptions | Note icon on the parent row; count badge; click opens AssumptionsList scrolled to those entries |
| Node has multiple versions | Version chip; click shows older versions read-only, with any selections made under them |

Old versions are never hidden and never editable. A selection that lives under an old version stays visible there, dimmed, so the user can see what regeneration orphaned.

## Persistence

DexieStorageAdapter implements the engine's StorageAdapter. Two tables, both keyed to allow the engine's load path (snapshot, then events above its seq).

| Table | Key | Indexes | Holds |
| --- | --- | --- | --- |
| events | \[graphId+seq\] | graphId | One row per GraphEvent, as emitted |
| snapshots | graphId | updatedAt | { snapshot, seq, title, updatedAt } |

Rules:

- appendEvent writes inside a transaction and rejects with SeqConflict if \[graphId+seq\] exists.
- writeSnapshot is best effort; a failure is logged, not surfaced, because the next load repairs from events.
- Export is the event array as JSON; import appends events to a new graphId. This is also how a bug report is filed: attach the export.
- Provider keys are not in IndexedDB; see the next section.
- Clearing site data loses everything. The graph list screen shows this once as a notice, with the Export action beside it.

## Provider keys and settings

Keys live in localStorage under one JSON object and are sent only to the provider they belong to, by the engine's adapter. The client never logs, exports or displays a key after entry.

| Setting | Default | Notes |
| --- | --- | --- |
| Anthropic key | empty | Required for expand until another provider is configured |
| Default provider and model | anthropic, a current mid-tier model | Used for every stage without an override |
| Per-stage override | staleCheck → cheapest available model | expand, summarize and prd use the default unless set |
| Token ceiling display | from the engine | Read-only; shows the last call's count against the ceiling |

Browser-call quirks are the adapter's job, but the settings screen explains them in one line each: Anthropic needs the direct-browser-access header (the adapter sets it); OpenAI keys in a browser are at the user's own risk; local models are out of scope for MVP.

## Milestones

One milestone per Claude Code session. Each client milestone names the engine milestone it needs; do not start a client milestone before its engine dependency is green and linked.

| # | Milestone | Needs | Done when |
| --- | --- | --- | --- |
| C0 | Scaffold | E0 | Vite app builds; engine linked via pnpm link; types import; Tailwind and Vitest configured |
| C1 | Read-only outline | E1 | Loads the design-session fixture through an in-memory adapter and renders the tree with enabled/disabled styling; no actions yet |
| C2 | Interactions | E1 | Select solution, add comment, answer clarification; pending states; keyboard navigation |
| C3 | Persistence | E1 | DexieStorageAdapter passes the engine's adapter contract test; graph list screen; export/import |
| C4 | Expand with a real provider | E3 | Settings screen with key entry; Expand and Regenerate buttons; OptionCard with recommended badge; AssumptionsList with Correct action |
| C5 | Staleness UI | E4, E5 | Red and amber borders, Check button, RestartWarning, propose-rewrite flow with approve/edit/reject, port action on red nodes |
| C6 | PRD panel | E6 | Generate, cached flag, copy, download .md |
| C7 | Canvas | E7 | React Flow view beside the outline; elkjs layout; same selectors drive both views; selection sync between them |
| C8 | Deploy | E7 | Static build on Cloudflare Pages or GitHub Pages; README with setup and key instructions |

C1 is the proof that the boundary holds: a full tree rendered from a replayed fixture, with zero logic in the client.

## CLAUDE.md for the client repo

Copy this into the repo root as CLAUDE.md.

```markdown
# brainstorm-web

React + Vite client for brainstorm-engine. This repo renders engine state and forwards user actions. It contains no graph logic.

## Non-negotiables
- All graph facts come from the engine snapshot and selectors. Never recompute enabled, stale, completeness or ordering here.
- Never call an LLM provider from this repo. Never build prompt text here.
- IndexedDB is touched only inside src/storage/DexieStorageAdapter.ts.
- If a feature needs something the engine does not expose, stop and write the request as an issue for brainstorm-engine. Do not work around it.
- Tests use the engine's MockProvider and in-memory adapter, plus the design-session fixture. No network.

## Layout
- src/app/          routes, providers, session bootstrap
- src/storage/      DexieStorageAdapter + contract test
- src/settings/     keys, registry, localStorage
- src/outline/      NodeRow, OptionCard, ExpandButton, CommentsPanel, AssumptionsList, RestartWarning
- src/prd/          PrdPanel
- src/canvas/       React Flow view (C7)
- src/hooks/        useSession, useSnapshot, useSelector

## Working rules
- Start each milestone by rendering the fixture, then add the interaction, then the test.
- Pending state per node, never a global spinner.
- Map every EngineError code to a message and a recovery action in src/app/errors.ts.

## Commands
- pnpm dev / pnpm build / pnpm test
- pnpm link --global brainstorm-engine   (after pnpm link --global in the engine repo)
```
