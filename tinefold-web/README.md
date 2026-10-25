# tinefold-web

The web app for tinefold. It renders the engine's state and forwards your clicks to it. All graph logic lives in `../tinefold-engine`.

## Run it

```sh
cd ../tinefold-engine && npm install && npm run build
cd ../tinefold-web && npm install && npm run dev
```

Open the printed URL (default http://localhost:5173). It starts in **demo mode** with placeholder answers. Open **Settings**, pick Anthropic or an OpenAI-compatible provider, and paste a key to get real ones.

## Using it

Each brainstorm opens as a **tree**: the problem at the top, options beneath it, sub-problems beneath the chosen option. The chosen path is a solid blue line, alternatives are dashed, and unchosen branches you explored earlier fold into a "+n explored" badge. Act right on a card (choose an option, Suggest options, Break down), or click it to open the full details and every action on the right. Pan by dragging or scrolling, zoom with pinch or the controls; the view follows new branches as they appear. **Outline** (toggle beside Write a document) shows the same brainstorm as a readable list, plus earlier versions of the problem.

1. Describe the problem. The app suggests 2–4 approaches, or asks 1–3 questions first if a missing fact would change them.
2. Choose an approach and break it into sub-problems. Every sub-problem must be solved; keep choosing until nothing is open.
3. Add comments any time (team size, budget, constraints). Nodes they might affect turn amber; **Check** asks a cheap model whether they still hold.
4. **Fold into the problem** rewrites the problem statement with your comments. The old tree turns red, then moves to "Earlier versions", where **Reuse in the current plan** copies decisions across.
5. **Write a document**: solution design, PRD, TRD, decision records, a one-page brief, or a custom document you describe. Each is saved with the brainstorm and returned instantly if nothing changed.

6. **Projects** combine brainstorms that belong together (Projects in the top bar, or "Add to a project" on any brainstorm). A project page shows each brainstorm's chosen path and open items side by side, flags choices made in more than one brainstorm, and writes documents across all of them, including a **project overview** of how they fit together. Brainstorms are never changed by a project, and one brainstorm can be in several.

Everything is stored in this browser (IndexedDB). **Export** downloads the event log; **Import a file** restores it anywhere.

## Develop

```sh
npm test         # Vitest + fake IndexedDB, engine MockProvider, no network
npm run build    # typecheck + static build in dist/
```

After changing the engine, rebuild it (`npm run build` there, or `npx tsup --watch`) and Vite picks it up.

Deploy: `npm run build`, then host `dist/` on any static host (Cloudflare Pages, GitHub Pages). Paths are relative, so a subfolder works.

## Not built yet

- Publishing the engine to npm (E7); the app links the sibling folder instead.
- Local models (Ollama / LM Studio) need CORS enabled on that server, then work through the OpenAI-compatible provider with a base URL.
