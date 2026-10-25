# Contributing to tinefold

Thanks for your interest! Bug reports, ideas, docs and code are all welcome.

## Ground rules

- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security problems go through [private reporting](SECURITY.md), not public issues.
- Never paste API keys in issues, screenshots or exported brainstorm files you attach.

## Ways to help

- **Report a bug** or **suggest a feature** with the [issue templates](../../issues/new/choose).
- Pick up an issue labelled [`good first issue`](../../labels/good%20first%20issue) or
  [`help wanted`](../../labels/help%20wanted).
- **Try it on a real problem** and tell us where the flow felt wrong. That feedback is as valuable as code.
- Open items worth tackling: publishing the engine to npm, local models (Ollama / LM Studio), and more
  document types.

## How the code is organised

The repo has two packages with a strict boundary. Read both `CLAUDE.md` files before your first change:
they're short, and they list the rules the code relies on.

- **[tinefold-engine/](tinefold-engine/)**: all graph logic. Pure TypeScript, no DOM or React. The event log
  is the source of truth; `reduce()` and every selector are pure. Every feature lands with a Vitest test that
  runs under `MockProvider`. No test touches the network.
- **[tinefold-web/](tinefold-web/)**: renders engine state and forwards clicks. It never recomputes graph
  facts and never calls a model provider directly. If the web app needs something new, add it to the
  engine first (with a test there).

The specs in [docs/specs/](docs/specs/) describe the intended behaviour. Where the code deliberately differs,
[tinefold-engine/DECISIONS.md](tinefold-engine/DECISIONS.md) explains why. Add an entry there if your change
makes a similar call.

## Development setup

```sh
git clone https://github.com/ravingupta/tinefold && cd tinefold
cd tinefold-engine && npm install && npm run build
npx tsup --watch            # keep the engine rebuilding while you work (optional)
cd ../tinefold-web && npm install && npm run dev
```

## Before opening a pull request

```sh
cd tinefold-engine && npm run typecheck && npm test && npm run build
cd ../tinefold-web && npm test && npm run build
```

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Fork the repo and create a branch: `git checkout -b feat/short-description`.
3. Engine API changes go in [tinefold-engine/CHANGELOG.md](tinefold-engine/CHANGELOG.md). Any prompt change
   bumps `PROMPT_VERSION`.
4. UI changes: include a screenshot in the pull request.
5. Commit with a clear message and open a pull request using the template. CI runs typecheck, tests and
   builds for both packages.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
