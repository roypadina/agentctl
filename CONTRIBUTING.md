# Contributing to Agentctl

Thanks for your interest in improving Agentctl! Contributions of all kinds are welcome —
bug reports, feature ideas, docs, and code.

## Ground rules

- **`main` is protected.** No direct pushes. All changes land via Pull Request and are
  reviewed/merged by the maintainer ([@roypadina](https://github.com/roypadina)).
- Be respectful — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Keep changes focused. One logical change per PR.

## Getting started

```bash
git clone https://github.com/roypadina/Agentctl.git
cd Agentctl
npm install

npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # tsup → dist/

# run from source without building:
npx tsx src/cli/index.ts        # agentctl (New; -r for Resume)
```

Requirements: Node 18+, macOS.

## Architecture

A strict two-layer split — please keep it intact:

- **`src/core/`** — pure data, **zero** React/ink imports. New core modules ship with a
  `tests/core/<name>.test.ts`.
- **`src/cli/`** — the ink TUI and the non-interactive subcommands. The only layer that touches
  presentation. UI in `tui.tsx` / screens gets smoke tests only; full UX validation is manual in a
  real terminal.

See [`CLAUDE.md`](CLAUDE.md) for the full module map and conventions.

## Conventions

- **ESM only.** Import siblings with the `.js` extension even from `.ts` (`moduleResolution: Bundler`).
- **Streaming, never load whole files.** Session `.jsonl` can be MB-scale — use `readline` + `for await`.
- **Tiny dependencies.** The runtime dep list is intentionally small (`chalk`, `commander`, `ink`,
  `ink-text-input`, `react`, `smol-toml`). Adding one needs justification.
- Match the surrounding code style.

## Workflow

1. **Fork** and branch: `git checkout -b feature/my-thing`.
2. Make your change. **Add or update tests.**
3. `npm test && npm run typecheck && npm run build` — everything must pass.
4. Commit with a clear message and open a **Pull Request** against `main`.
5. CI must be green and the maintainer must approve before merge.

## Feature requests and bugs

- **Feature requests:** [open one](https://github.com/roypadina/Agentctl/issues/new?template=feature_request.yml) and say what you're trying to do; that matters more than the exact feature. Search the [open requests](https://github.com/roypadina/Agentctl/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) first and 👍 an existing one if it's there.
- **Bugs:** use the [bug report](https://github.com/roypadina/Agentctl/issues/new?template=bug_report.yml); include your macOS + Node versions and how you launched it.
- **Ko-fi supporters:** add your Ko-fi name to the request and it goes to the front of my queue. It's a thank-you, not a purchase: no promise on what ships or when.
- **Bigger changes:** open an issue before the PR so we agree on the shape first. Small, focused PRs can come straight in.
- Replies are best effort, evenings and weekends. I read everything.
