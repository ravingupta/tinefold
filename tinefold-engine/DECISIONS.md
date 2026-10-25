# Decisions

Places where the spec was ambiguous or silent. Each entry says what was chosen and why. The guiding rule: keep `reduce()` pure and deterministic, and keep the log self-describing.

## Spec ambiguities resolved (E0/E1)

### D1. The root is a pseudo problem node
The fixture expands `root-v1` into solutions and selects `root → A-server`, while the enabledSet definition says "root → every root-level problem". Chosen: the root behaves as a **problem** with id `"root"` (`ROOT_NODE_ID`). Root versions are addressed as parent versions `root-v1`, `root-v2`, … (`rootVersionId(n)`); they are not stored as ids on `RootVersion`. Selections on the root use the key `"root"`.

### D2. enabledSet traversal rules
- problem → its selected solution, plus clarification children of its **current** version
- solution → every child of its **current** version
- clarification → nothing

A problem's selection is followed even if the selected solution hangs off an older version of the problem. This is required by the fixture: after the root rewrite (seq 15) the root still selects A-server (a child of root-v1), and the checkpoint expects A1–A3 to be **red**. Marks apply only to enabled nodes, so A1–A3 must still be enabled. Solution children follow only the current version, so after a solution is regenerated, the sub-problems under its old version are disabled (dimmed, as the client spec describes). The root itself is not a member of `enabledSet`.

### D3. Fixture: an expansion of A2-spa was missing, so the log has 22 events, not 21
The table never expands A2-spa into sub-problems, yet seq 20 expands "A2p-contract (new under A2-spa)", and completeness expects four open problems under A2-spa. I inserted `NodeExpanded A2-spa → subproblems [contract, staleness, canvas UI, PRD generation, provider registry]` (suggestedNext: provider registry) **after the two ports**. Seq 1–17 are unchanged, so the 14/15/17 checkpoints keep their numbers. The table's seq 18–21 become 18, 19, 21, 22. Placing it after the ports matches the PRD story (storage and context ported, the rest re-expanded) and gives the depth-first decision order the spec lists: storage, context, contract. The determinism test folds all 22 events.

### D4. Clarify expansions create one clarification node with answer options
Node kinds are problem, solution and clarification, but the contract says clarify items are "answer options for one question". Chosen: a `NodeExpanded` of kind `clarify` creates one clarification node per item (the fixture has exactly one, Q1). Each node's version carries the answer choices in a new optional field, **`NodeVersion.options: {id, title}[]`**. `ClarificationAnswered.itemId` must be one of those options; `itemId` and `freeText` may both be present (the fixture's seq 3 has both). At least one is required.

### D5. Answer ids are event ids
`inputs.answerIds` needs an id that changes when an answer changes. `Answer.id` is the id of the `ClarificationAnswered` event, so re-answering produces a new id. The payload shape is unchanged.

### D6. ancestorSelectionIds / decisionIds / answerIds: exact definitions
Inputs describe the context of the **parent being expanded** (P), which also matches the hash's `nodeVersionId` = parent version id. These are implemented in `currentInputs(g, parentVersionId)`; E2's compiler must record the same values.
- `ancestorSelectionIds`: the current selection at each problem strictly above P, in order from the root.
- `decisionIds`: the selections of enabled problems that are neither on P's path nor inside P's subtree (sibling branches), sorted. If P's own subtree counted, selecting a child would immediately mark its siblings yellow.
- `commentIds`: unmerged comments in seq order.
- `answerIds`: answers on clarifications in the active subtree, depth-first.

### D7. Staleness evaluation order
Red rules first (the root version differs, or a recorded ancestor selection is no longer selected). Next, a `StaleChecked` whose hash equals the **current** hash for that version: `fresh` → none, `stale` → red. Otherwise yellow if decisions differ, or a current comment or answer is missing from the inputs. A node is never yellow because of an answer on itself or beneath it. Only the current version of each enabled node gets an entry; disabled nodes have **no entry** rather than `"none"`. The spec lists the ClarificationAnswered effect as "descendants of the clarification go yellow"; I followed the staleness rules table instead (any enabled version whose inputs miss the answer).

### D8. NodePorted carries the copies' ids and re-recorded inputs
"Copy its selection" requires the selected solution to be a **child** of the copy (the selection invariant), and "inherit no mark" requires the copy's inputs to reflect the new position. Added to the payload: `newVersionId`, `contextHash`, `inputs`, and an optional `selection: {sourceSolutionNodeId, newNodeId, newVersionId, contextHash, inputs}`. The selected solution is copied under the new problem, with `portedFrom` set, and the selection points at the copy. The command that emits the event (E5 `portNode`) computes the inputs with `currentInputs`, so the reducer does no context work. Copied versions keep `generatedBy`, start at version 1, and record `tokens: {in: 0, out: 0}` so the original call isn't counted twice.

Consequence in the fixture: after seq 22, the ported solutions `A1p-doclog` and `A3p-full` are **yellow**. Sibling decisions (context, contract) were made after they were re-recorded. The ported problems A1p and A3p carry no mark. The test asserts this exact yellow set.

### D9. Leaf problems are resolved
Read literally, completeness would count a problem expanded as `leaf` as unresolved forever. A problem whose current version's latest expansion is a leaf counts as resolved.

### D10. decisionSummary scope and format
It uses the active subtree (the current root version's descendants), so between a root rewrite and the next root selection it lists no decisions. It returns `{ text, decisions[] }` rather than a bare string. The text includes only **unmerged** comments, since merged ones are already in the root statement. The root problem's title in a decision line is `root`. Text format:
```
Root problem (v2): <statement>
Comments:
- <text>
Decisions:
- root → Browser-only SPA
```

### D11. Errors from the reducer
The reducer throws an `EngineError` class (`code`, `message`, `details: {eventId, seq, type}`), never a string. Codes: `SeqConflict` (gap, duplicate, or non-1 first seq), `InvalidSelection` (non-child solution, bad clarification option), `ValidationFailed` (everything else: unknown ids, reused ids, wrong expansion kind for the parent, root version not +1, …). No new codes were added.

## Shape changes vs the spec

| Shape | Change | Reason |
| --- | --- | --- |
| Graph | added `seq` | The reducer must reject gaps without a side channel |
| Graph | added `children: parentVersionId → nodeId[]` | Deterministic child order that survives a JSON round trip (object key order does not) |
| Graph | added `expansions: parentVersionId → Expansion[]` | The spec has the Expansion entity but no field to hold it. An array, because one version can be expanded more than once (root-v1: clarify, then solutions) |
| Graph | added `staleChecks: nodeVersionId → latest StaleCheck` | StaleChecked results are the only stored staleness state |
| Expansion | added `leafReason`, `contextHash`, `seq` | Leaf expansions create no versions, so their reason and hash would otherwise be lost |
| NodeVersion | added optional `options` | D4 |
| NodeExpanded | items are `{nodeId, versionId, title, summary, axisValue?, pros, cons, options?}`; added `leafReason` | Ids come from the event, so replay is deterministic |
| NodeRegenerated | added `generatedBy`, `tokens` | NodeVersion requires them |
| NodePorted | added `newVersionId`, `contextHash`, `inputs`, `selection?` | D8 |
| GeneratedBy | defined as `{providerId, model, promptVersion}` | The spec names the prompt version as part of generatedBy without giving a shape |
| Log schemas | no length limits on titles, summaries, pros or cons | Limits live on `ExpansionOutput` only, so tightening the provider contract later never makes old logs unreadable |

## Tooling
- **TypeScript pinned to 5.9.** pnpm resolved TypeScript 7, which ships only the native compiler with no JS API, and tsup's d.ts build needs that API.
- **`@noble/hashes` for SHA-256.** Selectors are synchronous and must run in browsers too. WebCrypto is async-only and `node:crypto` is Node-only.
- **`ExpansionOutput` is transcribed exactly as written.** Its sense checks (axis required for solutions, recommendedId among items) belong to E3's validation step.
- **No in-memory storage adapter.** No E1 test needed one.

## E2–E7 decisions

### D12. Clarify items carry their answer options
`ExpansionOutput.items[].options` (2–5 `{id, title}`) is added so one clarify call can ask 1–3 questions, each with choices. Title and summary limits were raised to 120 / 600 characters: real models overflowed 80 / 400 on ordinary options.

### D13. One clarify round per node
The first expansion of a node may ask questions. Once a node has a clarify expansion, the next expansion is told the questions and answers and forbidden from asking again. The user can also skip unanswered questions ("Continue without answering" → `expand(id, {allowClarify: false})`).

### D14. Documents replace the PRD-only output
The user asked for "a document at the end which can be PRD, TRD, solution document or something else". `DocType` = prd | trd | solution | adr | brief | custom. `DocumentGenerated` stores `{key, docType, instructions?, contextHash, markdown}` where key = sha256 of {docType, instructions, contextHash}. `contextHash` is `graphHash()`: root version, open comments, answers, decisions, every enabled version id, and open problems, so any change to the active tree invalidates the cache. `PrdGenerated` and `prdCache` remain readable for old logs.

### D15. Documents see rejected options too
`compileGraphContext()` renders the whole active tree with every option marked CHOSEN or rejected, its pros and cons, the axis, assumptions, and OPEN for undecided problems. The per-node decision summary was not enough for a TRD or ADR, which need the alternatives.

### D16. Regenerate is the node only
`regenerate(nodeId)` rewrites one node's content for the current context (a new version with no children). The client chains `regenerate` then `expand` when the user regenerates an expanded problem.

### D17. canExpand
A node offers expansion when it is on the active path, has no solutions/subproblems/leaf expansion on its current version, and, for problems, has no selection among its current children. A ported problem arrives with its choice, so it is not offered fresh options; the root after a rewrite still selects an old-version solution, so it is.

### D18. renderTree is the client contract
Clients draw `renderTree()` and nothing else: state (active / option / disabled), mark and reasons, recommended, canExpand, canRegenerate, parentId, and an `archive` of branches under earlier root versions (so they can be ported after a new root choice). This keeps graph walking out of the client.

### D19. Engine stays DOM-free
`src/globals.d.ts` declares only fetch, Response, AbortSignal, setTimeout and crypto.getRandomValues, instead of adding the DOM lib.

### D20. Default models
The web client defaults to demo mode (MockProvider) so the flow works with no key. Suggested Anthropic models: claude-sonnet-5-5 (expand, documents), claude-haiku-5-5 (stale checks). Model ids are free text in settings.

## Projects (0.2.0)

### D21. A project is a lens over brainstorms, not a container
The user's framing: brainstorming stays the focus; projects only combine brainstorms into holistic documents or a high-level structure. So a project stores an ordered list of brainstorm ids, a description of how they relate, and its documents. Brainstorms never read from a project: no event in a brainstorm's log refers to one, its context and staleness are unchanged, and one brainstorm can sit in several projects. (A first version pushed shared project notes into every brainstorm with staleness marks; it was dropped before shipping because it made projects steer brainstorms.)

### D22. Projects are records, not event logs
A project is small, user-edited metadata with no derived state worth replaying, so it is stored as a record (`writeProject`) and validated with Zod on every save. Brainstorm logs remain the only event-sourced data.

### D23. The high-level structure is rendered by code
`projectOverview()` uses each brainstorm's `decisionSummary` and `completeness`, so it is free, instant and always current. "Where they connect" is a deliberately cheap signal: identical solution titles chosen in more than one brainstorm. Deeper connections (dependencies, conflicts) are the job of the `overview` document, which a model writes on request.

### D24. Project document cache key
sha256 of the description plus every included brainstorm's `graphHash`, in project order, combined with doc type and instructions. Reordering brainstorms or editing any of them produces a new document; untouched projects return the cached one.
