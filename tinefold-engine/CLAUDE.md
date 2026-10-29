# tinefold-engine

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
- src/prompts/    prompt templates, PROMPT_VERSION (bump on any prompt change)
- test/fixtures/  design-session.events.json + expected snapshots

## Working rules
- Start each milestone by writing or extending the fixture test, then implement until green.
- Do not add a feature the spec does not name. Propose it in a comment on the spec instead.
- Keep public API changes in CHANGELOG.md; the web client pins versions.

## Commands
- npm test        Vitest
- npm run build   tsup to dist/ (ESM + d.ts). The web client depends on the published npm package. To try unreleased engine changes in the client: `npm run build && npm link` here, then `npm link @ravingupta/tinefold-engine` in tinefold-web (undo with `npm unlink`). Release: bump the version and CHANGELOG, then push a tag `engine-v<version>` (publishes via GitHub Actions when the repo has an `NPM_TOKEN` secret) or run `npm publish` here: this folder's git-ignored `.npmrc` holds the token for this package only, so the user's other npm projects are unaffected.

## Status
E0–E7 done. Published to npm as @ravingupta/tinefold-engine. Next ideas live in the web client's README.
