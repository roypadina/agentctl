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

## Reporting bugs / requesting features

Use the [issue templates](https://github.com/roypadina/Agentctl/issues/new/choose). For bugs,
include your macOS + Node versions and how you launched it.
