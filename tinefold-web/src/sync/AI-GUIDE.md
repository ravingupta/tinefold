# tinefold sync folder: guide for AI assistants

This folder is a tinefold sync folder. tinefold is a browser app for brainstorming software decisions as a tree:
a problem gets solution **options**, the person **chooses** one, and the chosen option breaks into **sub-problems**,
which get options of their own, until every part is decided.

The person who owns this folder may ask you to read it, summarise it, or change it. This guide explains the format
so your changes load. The app reads the folder when the person clicks **Sync now**. It checks every file, and it
skips (and names) any file it can't load, without changing that file or anything else.

## Layout

```
AI-GUIDE.md                this file (rewritten by the app on every sync; don't edit it)
tinefold-sync.json         manifest: { "format": "tinefold-sync", "version": 1, "deleted": [ids] }
brainstorms/<graphId>.json one brainstorm: a JSON array of events
projects/<projectId>.json  one project: a JSON object that groups brainstorms
logs/<id>.json             every AI request and reply for one brainstorm or project (written by the app; read only)
```

- The file name must be the id inside it: every event in `brainstorms/X.json` has `"graphId": "X"`, and
  `projects/Y.json` has `"id": "Y"`.
- `deleted` lists ids removed on some device. The app deletes those everywhere and never brings them back, so
  don't reuse a deleted id.
- To delete a brainstorm or project, delete its file **and** add its id to `deleted`. If you only delete the file,
  the next device that syncs will write it back.

## The golden rules

1. **A brainstorm is an append-only log.** The app rebuilds the tree by replaying the events in order. The safest
   change is to **append new events at the end**. Editing or removing earlier events works only if every later
   event still makes sense. If it doesn't, the file is rejected.
2. **`seq` runs 1, 2, 3, … with no gaps.** Each new event's `seq` is the last one + 1.
3. **Ids are unique strings** across the whole brainstorm: event ids, node ids, version ids, comment ids. Use new
   random ids (for example a ULID, or a prefix plus random letters like `ai-7f3k2q`). Never reuse an id.
4. **Times** are ISO 8601 UTC with milliseconds: `"2026-10-26T14:05:00.000Z"`. Use times later than the last event.
5. **Keep the JSON valid.** Write the whole file back with 2-space indentation.
6. **Fields not listed below are rejected or dropped.** Don't add your own.

If the person's change is large, for example a whole new brainstorm from meeting notes, consider the outline script
in the tinefold repository (`tools/brainstorm-from-outline.mjs`). It runs the real engine and produces a valid file.

## The tree model

| Node kind | What it is | Its children |
| --- | --- | --- |
| root problem | The problem the brainstorm is about. Node id `"root"`. Its versions are `"root-v1"`, `"root-v2"`, … | clarifications, options, or nothing (a leaf) |
| `problem` | A sub-problem of a chosen option | clarifications, options, or nothing (a leaf) |
| `solution` | An option for a problem | clarifications, sub-problems |
| `clarification` | A question with answer choices | none |

Every node has **versions**. A node's content (title, summary, pros, cons) lives on its version, and versions never
change: editing a node means adding a new version (`NodeRegenerated`). **Children attach to a version, not to a
node.** Options under the root hang from `"root-v1"`. Sub-problems under an option hang from that option's
`versionId`, not its `nodeId`.

A problem's **chosen** option is set by `SolutionSelected`. Only the chosen option's sub-problems are active;
unchosen options and everything under them stay in the log as history.

## Event envelope

Every event has these fields, then `type` and `payload`:

```json
{ "id": "<unique id>", "graphId": "<brainstorm id>", "seq": 12, "at": "2026-10-26T14:05:00.000Z", "type": "...", "payload": { } }
```

## Shared shapes

```jsonc
// ExpansionInputs: what the generation "saw". Drives the amber/red "may be out of date" marks.
"inputs": {
  "rootVersion": 1,              // current root version number
  "ancestorSelectionIds": [],    // chosen option ids on the path from the root down to the parent, root first
  "decisionIds": [],             // chosen option ids in other branches, sorted
  "commentIds": [],              // ids of comments not yet merged into a root rewrite, in order
  "answerIds": []                // ids of ClarificationAnswered events in the active tree
}
"contextHash": "<64 lowercase hex characters>",
"generatedBy": { "providerId": "manual", "model": "ai-edit", "promptVersion": "manual" },
"tokens": { "in": 0, "out": 0 }
```

When you write events by hand:
- `contextHash` must be 64 lowercase hex characters. You can't compute the app's hash, so copy the one from the most
  recent `NodeExpanded` under the same parent, or use `"0"` repeated 64 times.
- For `inputs`, copy them from a sibling made under the same parent, or work them out from the definitions above.
  If they're slightly off, the app may mark the node "may be out of date", which is harmless. The person can
  re-check it in the app.
- Set `generatedBy` to `{ "providerId": "manual", "model": "<your name>", "promptVersion": "manual" }`.

An **item** (one generated node, used in `NodeExpanded` and `NodeRegenerated`):

```json
{ "nodeId": "<new id>", "versionId": "<new id>", "title": "Short title", "summary": "One or two sentences.",
  "axisValue": "optional: where this option sits on the expansion's axis",
  "pros": ["..."], "cons": ["..."],
  "options": [ { "id": "o1", "title": "Answer choice" } ] }
```

`options` is only for clarification items (at least two choices). `pros` and `cons` are required: use `[]` if none.

## Event types

### GraphCreated (always seq 1, exactly once)
```json
"payload": { "graphId": "<same as envelope graphId>", "statement": "The full problem statement.", "name": "Two To Four Words" }
```
`name` is optional, 1–60 characters.

### GraphRenamed
```json
"payload": { "name": "New name", "source": "user" }
```

### CommentAdded
A note on the whole problem, to fold into the next root rewrite.
```json
"payload": { "commentId": "<new id>", "text": "We must also support SSO." }
```

### RootRewritten
A new version of the root problem statement. `version` is exactly the current root version + 1. `mergedCommentIds`
lists unmerged comments folded into it. Earlier branches stay in the log, and the new root version starts empty
(its children hang from `"root-v2"`, …).
```json
"payload": { "version": 2, "statement": "The rewritten statement.", "mergedCommentIds": ["<comment id>"] }
```

### NodeExpanded: add children under a version
```json
"payload": {
  "parentVersionId": "root-v1",
  "kind": "solutions",
  "items": [ /* items */ ],
  "axis": "optional: the dimension the options vary along",
  "recommendedId": "optional: nodeId of one item",
  "reason": "optional: why the recommendation",
  "suggestedNextId": "optional: nodeId of the sub-problem to work on first",
  "assumptions": [],
  "leafReason": "only for kind leaf",
  "contextHash": "...", "inputs": { }, "generatedBy": { }, "tokens": { }
}
```

| Parent version belongs to | Allowed `kind` | Items become |
| --- | --- | --- |
| root or `problem` | `clarify`, `solutions`, `leaf` | clarifications, options, (leaf: no items) |
| `solution` | `clarify`, `subproblems` | clarifications, sub-problems |

`leaf` means "small enough to act on directly". It needs `"items": []` and a `leafReason`. Every other kind needs
at least one item. `recommendedId` and `suggestedNextId` must be the `nodeId` of one of the items. Expanding the
same version again adds more children after the existing ones.

### NodeRegenerated: edit a node (new version)
```json
"payload": { "nodeId": "<existing node>", "newVersion": { /* item with the same nodeId and a NEW versionId */ },
             "contextHash": "...", "inputs": { }, "generatedBy": { }, "tokens": { } }
```
Children made under the old version stay attached to the old version, so the new version starts with none.

### SolutionSelected: choose an option, or clear the choice
```json
"payload": { "problemNodeId": "root", "solutionNodeId": "<option nodeId under that problem, or null>" }
```

### ClarificationAnswered
```json
"payload": { "clarificationNodeId": "<node id>", "itemId": "o2", "freeText": "optional extra detail" }
```
Give `itemId` (one of the question's option ids), `freeText`, or both. Answering again replaces the answer.

### NodePorted: reuse a node from elsewhere in the tree
```json
"payload": { "sourceNodeId": "...", "targetParentVersionId": "...", "newNodeId": "<new>", "newVersionId": "<new>",
             "contextHash": "...", "inputs": { },
             "selection": { "sourceSolutionNodeId": "...", "newNodeId": "<new>", "newVersionId": "<new>", "contextHash": "...", "inputs": { } } }
```
A problem can be ported only under an option, an option only under a problem, and a clarification under either.
Include `selection` exactly when the source problem has a chosen option, and name that option in it.

### StaleChecked
A verdict on whether a node is still valid after changes elsewhere. Usually written by the app.
```json
"payload": { "nodeVersionId": "...", "verdict": "fresh", "reason": "Still holds because ...", "contextHash": "..." }
```

### DocumentGenerated
A written document (PRD, technical design, ADR, …), stored as markdown.
`docType` is one of `prd`, `trd`, `solution`, `adr`, `brief`, `overview`, `custom`.
```json
"payload": { "key": "<64 hex>", "docType": "prd", "instructions": "optional", "contextHash": "<64 hex>",
             "markdown": "# ...", "generatedBy": { }, "tokens": { } }
```
`key` identifies the document. Reuse an existing document's `key` to replace it, or use a new 64-hex value to add one.

### PrdGenerated
An older form of a PRD document, still found in some logs. Prefer `DocumentGenerated` for new documents.
```json
"payload": { "contextHash": "<64 hex>", "markdown": "# ...", "generatedBy": { }, "tokens": { } }
```

## Projects

A project groups brainstorms for one overview and shared documents. It never changes the brainstorms.

```json
{
  "id": "<project id>",
  "name": "Checkout revamp",
  "description": "How the brainstorms fit together.",
  "graphIds": ["<brainstorm id>", "..."],
  "createdAt": "2026-10-20T09:00:00.000Z",
  "updatedAt": "2026-10-26T14:05:00.000Z",
  "documents": {}
}
```

When you change a project, set `updatedAt` to now. If the same project changed in two places, the newer `updatedAt`
wins. `documents` maps a 64-hex key to `{ key, docType, instructions?, graphIds, contextHash, markdown,
generatedBy, tokens, createdAt }`.

## Recipes

**Read a brainstorm.** Replay it in your head. Start at `"root"`. `NodeExpanded` events with
`parentVersionId: "root-vN"` (N = the latest `RootRewritten.version`, or 1) give the root's options. Follow
`SolutionSelected` for `"root"` to the chosen option, then the `NodeExpanded` whose `parentVersionId` is that
option's current `versionId` to its sub-problems, and repeat. A node's current content is its latest
`NodeRegenerated`, or else its item in `NodeExpanded`.

**Add options to a problem.** Append a `NodeExpanded` with `kind: "solutions"` and `parentVersionId` = the problem's
current version id (`"root-vN"` for the root).

**Choose an option.** Append a `SolutionSelected`.

**Break a chosen option down.** Append a `NodeExpanded` with `kind: "subproblems"` and `parentVersionId` = the
option's current version id.

**Fix a typo in an option.** Append a `NodeRegenerated` with the corrected item and a new `versionId`. Don't edit the
old event: sub-problems hang from the old version id, so a new version would detach them. If the option already has
sub-problems you want to keep, editing `title`/`summary` in place inside the original `NodeExpanded` item also loads,
because ids are unchanged.

**New brainstorm.** Create `brainstorms/<new id>.json` with a `GraphCreated` event (seq 1) whose `graphId` and
`payload.graphId` both equal the new id, then any further events.

## After you edit

Tell the person to click **Sync now** in tinefold. If a file is rejected, the app shows the file and the first
problem it found (for example `payload.items: ...` or `expected seq 13, got 14`). Fix that and sync again.
