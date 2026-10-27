# tinefold-web

React + Vite client for tinefold-engine. This repo renders engine state and forwards user actions. It contains no graph logic.

## Non-negotiables
- All graph facts come from `session.select.*` (mainly `tree()`). Never recompute enabled, stale, completeness, parents or ordering here.
- Never call an LLM provider from this repo. Never build prompt text here.
- IndexedDB is touched only inside src/storage/DexieStorageAdapter.ts.
- If a feature needs something the engine does not expose, add it to the engine first (with a test there).
- Tests use the engine's MockProvider and fake-indexeddb, plus the example brainstorm in src/examples/. No network.

## Layout
- src/app/          App shell, routes, session/settings store (sessions.ts), errors.ts, ui.tsx, icons.tsx, viewport.ts (phone gate)
- src/storage/      DexieStorageAdapter
- src/settings/     settings model + Settings page (keys in localStorage)
- src/outline/      GraphPage, Tree (problem / option / question views), Rail (Progress, Comments, Assumptions), GraphContext, PhonePage (phones: progress + comments only, never the tree)
- src/documents/    DocumentPanel (PRD, TRD, solution design, ADR, brief, custom)
- src/home/         HomePage (brainstorm-first: the problem input is the hero)
- src/tree/         TreeCanvas (React Flow + d3-hierarchy tidy layout over renderTree(); `lens` "all" | "outcome" hides unchosen options), Inspector, FocusLayer (full-screen tree with an icon strip; f enters, Esc leaves, o flips the lens)
- src/projects/     ProjectsPage, ProjectPage (overview + project documents), ProjectChips
- src/nerd/        AiLogPanel: the "AI log" nerd panel (every prompt and raw reply, from the engine's onAiCall; stored by DexieStorageAdapter, synced as logs/<id>.json)
- src/examples/     the bundled example brainstorm (Tinefold Design event log), loaded by "Open the example"

## Working rules
- Pending state is per node (GraphContext.run with a key), never a global spinner.
- Every EngineError code maps to a message and a recovery action in src/app/errors.ts.
- Layout (positions, what is folded) is presentation and lives in src/tree; what each node *is* (state, chosen, stale, canExpand) always comes from renderTree().
- Brainstorming is the focus. Projects only combine brainstorms (overview + documents); they never change a brainstorm.
- Design tokens live in src/index.css (@theme). Cobalt is reserved for the chosen path; moss marks problems and sub-problems (tinted, square-cornered cards with a left spine). Options are neutral paper, rounder.

## Engine dependency
- `@ravingupta/tinefold-engine` comes from npm (pinned by package-lock). To test unreleased engine changes: `npm run build && npm link` in ../tinefold-engine, then `npm link @ravingupta/tinefold-engine` here. Never commit a `file:` dependency: Vercel and CI build this folder on its own.

## Commands
- npm run dev / npm run build / npm test
