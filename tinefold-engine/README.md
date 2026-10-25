# @ravingupta/tinefold-engine

[![npm](https://img.shields.io/npm/v/@ravingupta/tinefold-engine)](https://www.npmjs.com/package/@ravingupta/tinefold-engine)

```sh
npm install @ravingupta/tinefold-engine
```

The engine behind tinefold, an AI brainstorming tool built on an AND-OR graph: a **problem** is answered by choosing one **solution**; a solution is done when all of its **sub-problems** are solved. The engine owns every rule; clients only render `renderTree()` and call session commands.

Pure TypeScript, no DOM, React or database code. The event log is the source of truth, the snapshot is a fold of it, and every view is a pure selector.

## Use it

```ts
import { createGraph, MemoryStorage, AnthropicProvider, MockProvider, ROOT_NODE_ID } from "@ravingupta/tinefold-engine";

const session = await createGraph("We need search for a 2M-product catalog…", {
  storage: new MemoryStorage(),                       // or your own StorageAdapter
  providers: [new AnthropicProvider({ apiKey }), new MockProvider()],
  registry: {
    default: { providerId: "anthropic", model: "claude-sonnet-5-5" },
    overrides: { staleCheck: { providerId: "anthropic", model: "claude-haiku-5-5" } },
  },
});

await session.expand(ROOT_NODE_ID);                   // clarify questions, or options
const tree = session.select.tree();                   // render-ready tree
await session.selectSolution(ROOT_NODE_ID, tree.children[0].id);
await session.addComment("Team is three people");     // marks affected nodes yellow
await session.checkStale(nodeId);                     // cheap model resolves yellow
const doc = await session.generateDocument({ docType: "trd" }); // prd | trd | solution | adr | brief | custom
```

Commands: `addComment`, `selectSolution`, `answerClarification`, `expand`, `regenerate`, `checkStale`, `proposeRootRewrite`, `approveRootRewrite`, `portNode`, `generateDocument`, `exportEvents`. Selectors under `session.select`: `tree`, `completeness`, `decisionSummary`, `staleMarks`, `restartWarning`, `assumptions`, `suggestedNext`, `documents`.

Errors are `EngineError` with a `code`: `ValidationFailed`, `ProviderFailed`, `ContextTooLarge`, `SeqConflict`, `InvalidSelection`.

## Projects

A project combines brainstorms without changing them: one high-level structure and documents written across all of them. A brainstorm can belong to several projects.

```ts
const projects = new ProjectService({ storage });
const p = await projects.create({ name: "Shop rebuild", description: "Billing feeds search ranking", graphIds: [a.graphId, b.graphId] });
projectOverview(p, [a.getSnapshot(), b.getSnapshot()]);   // decisions + open items per brainstorm, shared choices
await projects.generateDocument(p.id, [a.getSnapshot(), b.getSnapshot()], { docType: "overview" }, { providers, registry });
```

## Storage

Implement `StorageAdapter` (six graph methods, four project methods). `appendEvent` must reject an existing `[graphId, seq]`. Load = snapshot + events above its seq; a bad snapshot is repaired from the log.

## Develop

```sh
npm install      # or pnpm install
npm test         # Vitest, MockProvider only, no network
npm run build    # tsup → dist/
```

`DECISIONS.md` records every place this implementation interprets or extends the spec. `test/fixtures/design-session.events.json` is the design session replayed as an event log; the tests use it. It is not shipped in the package.
