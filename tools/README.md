# tools

Scripts that sit beside the engine and the web app. Nothing here is part of either package.

## brainstorm-from-outline.mjs

Turns a plain outline into a tinefold brainstorm you can import with **Import a file**.

Use it to bring a brainstorm that happened somewhere else (a chat, a meeting, a document) into
tinefold with every decision already recorded, so you continue from where that discussion ended
instead of repeating it.

```sh
cd tinefold-engine && npm install && npm run build      # the script runs the engine's dist/
node tools/brainstorm-from-outline.mjs tools/outlines/tinefold-design.json tools/out/tinefold-design.events.json
```

Every step in the outline runs through the real engine with a scripted provider, so ids, context
hashes and staleness marks are exactly what the app would have produced. The script prints the tree
it built, with `(chosen)`, `(option)`, `(open)` and any stale marks, and refuses an outline the engine
would refuse (an option list with one option, a question without answer choices, a reference to a
node that does not exist).

The outline format is documented at the top of the script. Steps, in the order they happened:

| Step | What it records |
| --- | --- |
| `clarify` | Questions the model asked at a node, with answer choices and the answer given |
| `solutions` | Options for a problem (axis, pros, cons, recommendation, assumptions) and which one was chosen |
| `subproblems` | How a chosen option breaks down; leave a sub-problem unexpanded to keep it open for the model |
| `leaf` | A problem small enough to act on directly |
| `select` | Change or undo a choice |
| `comment` | A global amendment to the problem |
| `rewrite` | Fold open comments into a new version of the problem statement (the old tree is archived) |
| `port` | Reuse a decided problem from an earlier version under the new branch |
| `check` / `check-all` | Record a staleness verdict on one node, or mark every amber node fresh (run last) |
| `document` | Attach a markdown file you already have as a PRD, TRD, brief, ADR, solution design or custom document |

Nodes are named by title (`"root"` for the problem itself). When two nodes share a title, the newest
wins; use `"#<id>"` to be exact.

## outlines/tinefold-design.json

The design discussion behind tinefold itself, reconstructed from `docs/specs/prd-v0.md`,
`tinefold-engine/DECISIONS.md` and the READMEs: the server-backed first attempt, the comment that
removed the backend, the rewrite to a browser-only app, the decisions made since (engine/client split,
projects, documents), and the problems still open (npm publishing, local models, sync and sharing,
sharing sub-problems across branches, per-node notes, relevance filtering). Its output is
`out/tinefold-design.events.json`.
