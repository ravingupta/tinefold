# Changelog

## 0.4.1

- Fix: `AnthropicProvider` no longer forces the tool call. Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 reject `tool_choice` `tool`/`any` with a 400; it now sends `auto` (one call at most) and asks for the tool in the system prompt. A plain-text JSON reply still parses through `callStructured()`.

## 0.4.0

- AI call log: `onAiCall` on `SessionOptions` and on `ProjectService.generateDocument()`'s `ai` argument receives an `AiCall` for every provider request (system and user prompt, schema, raw text or JSON reply, tokens, duration, error), scoped to the brainstorm or the project. Retries and condensing calls are logged separately. `loggedProvider()` wraps any provider the same way. A sink that throws never fails the call.

## 0.3.0

- First release on npm (`@ravingupta/tinefold-engine`). The web client now depends on the published package instead of the sibling folder.
- **Removed:** the `designSessionEvents` export. The example brainstorm moved into the web app (`tinefold-web/src/examples/`); the engine keeps its design-session log as a test fixture only.

- Brainstorm names: a short (2–4 word) editable name per graph. New event `GraphRenamed`, optional `name` on `GraphCreated`, snapshot fields `name` and `nameSource`. `session.name()` and `session.rename()`; `createGraph(statement, opts, { name })`; selectors `graphName()` and `suggestName()`.
- The first root expansion also suggests a name (optional `name` on `ExpansionOutput`; prompt version `p2`). It never replaces a name the user set.
- **Behaviour change:** `renderTree()` root `title` is now the name; the full statement moved to the root's `summary`. `GraphListing.title` is the name, with the new `statement` field alongside. `OverviewPart` gains `name`.

## 0.2.0

- Projects: a lens that combines brainstorms without changing them. `Project` (name, description, ordered `graphIds`, documents), `ProjectService` (create, update, addGraph, removeGraph, moveGraph, forgetGraph, delete, forGraph, subscribe), `projectOverview()` (code-rendered high-level structure: each brainstorm's decisions and open items, plus solutions chosen in more than one brainstorm).
- `ProjectService.generateDocument()` writes one integrated document across a project's brainstorms, cached on the project until any of them (or the description) changes.
- New document type `overview` (how the brainstorms fit together: dependencies, shared choices, conflicts, gaps).
- `StorageAdapter` gains `listProjects`, `readProject`, `writeProject`, `deleteProject`.

## 0.1.0

- E2 Context compiler: `compileContext()` (six fixed sections, id-based hash, ~4 chars/token estimate), `compileGraphContext()` for whole-graph documents, `graphHash()`, `documentKey()`. Soft ceiling (24k) condenses decisions via the summarize stage; hard ceiling (48k) throws `ContextTooLarge`.
- E3 Providers: `Provider` interface, `ProviderRegistry` with per-stage overrides (`expand`, `staleCheck`, `summarize`, `document`), `MockProvider` (queue, handler, or generic demo answers), `AnthropicProvider` (forced tool use, browser header), `OpenAIProvider` (any OpenAI-compatible endpoint, prompted-schema path). `callStructured()` validates with Zod and retries once with the error appended.
- E4 Staleness: `staleDetails()` (mark + plain-language reasons), `checkStale()` command, `restartWarning()`.
- E5 Root rewrite and porting: `proposeRootRewrite()`, `approveRootRewrite()`, `portNode()`.
- E6 Documents: `generateDocument({docType, instructions?, force?})` for `prd`, `trd`, `solution`, `adr`, `brief`, `custom`; cached per type + instructions + graph state. New event `DocumentGenerated`, new snapshot field `documents`. `generatePrd()` kept as a shortcut.
- Session: `createSession`, `createGraph`, `openSession`, `importGraph`; writes serialised so concurrent commands never race on seq.
- Storage: `StorageAdapter` interface, `MemoryStorage`.
- Render selectors for clients: `renderTree()` (state, marks, reasons, recommendations, canExpand, parentId, archive of earlier root versions), `assumptions()`.
- `designSessionEvents` exported as a demo graph.

## 0.0.0

- E0: Zod schemas and types for Graph, GraphEvent (all ten event types), NodeVersion, ExpansionOutput, EngineError.
- E1: `reduce()`, `replay()`; selectors `enabledSet`, `activeSubtree`, `staleMarks`, `completeness`, `decisionSummary`, `ancestorChain`, `suggestedNext`; helpers `currentInputs`, `hashContext`, `canonicalJson`, `sha256Hex`.
