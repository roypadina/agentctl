# Changelog

All notable changes to Agentctl are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [Unreleased]

### Changed — BREAKING

- **The GUI's binary-override env var is now `$AGENTCTL_BIN`** (the previous name is no longer
  read). The Swift CLI client type is now `AgentctlCLI`.
- **Default launcher tool renamed** to `claude`. Existing configs that name their own tools are
  unaffected; only the built-in default and the `default_tool` fallback change.

### Removed — BREAKING

- **Legacy config migration and fallbacks.** The one-time move of the previous config directory,
  and every fallback to the previous environment variable names (config path, home, Claude binary,
  recap model), are gone. Only `AGENTCTL_*` variables and `~/.config/agentctl` are read.

## [0.7.0] — 2026-08-29

### Fixed

- **Resuming could ask you to log in.** 0.5.0 started pinning `CLAUDE_CONFIG_DIR` to the profile a
  session was found under. For the *default* profile that is wrong: its config lives at
  `~/.claude.json`, beside the directory, so pinning `~/.claude` sent Claude to
  `~/.claude/.claude.json` — a different, usually logged-out profile. The default profile is now
  left unpinned, as Claude Code itself expects; side profiles are still pinned.

### Added

- **Choose which Claude account a session resumes under.** `agentctl profiles` lists them;
  `agentctl resume <id> --profile <email|name|path>` overrides; `a` cycles it in the menu and the
  app has an account menu. Which account owns an already-exited session is not recorded anywhere
  when profiles share a `projects/` dir, so the override is the answer rather than a better guess.
  **On a single-account machine none of this is shown.**
- **Multi-select.** `space` marks sessions in the menu; `h`, `x` and `d` then act on every marked
  one. The CLI takes several ids too: `agentctl hide a1b2 c3d4 e5f6`. Prefixes resolve against a
  single scan — resolving them concurrently opened enough files at once to make some come back
  empty.
- **The cursor stays put** after hiding or deleting, instead of jumping to the top of the list.
- **Copy a resume command to the clipboard.** `c` in the terminal menu, or the copy button beside
  the session id in the app, puts `agentctl resume <id>` on your clipboard — paste it in any other
  terminal to pick that session back up, with its working directory and Claude profile intact.
- **A short session-id column** in the terminal list, on terminals at least 110 columns wide. The
  full id was already in the details pane; now you can see it at a glance while scanning.

## [0.6.2] — 2026-08-29

### Changed

- **The terminal menu no longer shows deleted sessions.** `v` now toggles normal ↔ hidden only.
  Deleting is meant to make clutter go away, so the menu stops offering it back; recovery lives in
  `agentctl delete --undo` and the menu-bar app's Deleted view. Hidden sessions are unaffected —
  `v` still shows them.
- **`h` (hide), `x` (delete) and `v` (hidden) now appear in the footer**, from 100 columns up. They
  existed in 0.6.0 but only in the `?` help, which made them undiscoverable.

### Fixed

- `agentctl annotations` printed `(unknown session)` for hidden and deleted sessions — its name
  lookup used the default view, which by definition excludes them.

## [0.6.1] — 2026-08-29

### Fixed

- **The GUI can now do everything the TUI can.** Two gaps closed: it had no show/hide-done control
  (the TUI'''s `H`), and its reminder and due-date menus only offered fixed presets, so times like
  `friday 17:00` were terminal-only. The view menu gained a done toggle, and both dates now have a
  free-text field accepting anything the CLI parses, with the preset menus kept as shortcuts.

## [0.6.0] — 2026-08-29

### Added

- **Hide and delete sessions**, in the CLI, the TUI and the GUI. Both are *listing preferences* —
  **neither touches the Claude Code transcript**, removes anything from `~/.claude`, or stops a
  session resuming if you address it by id.
  - `agentctl hide` keeps a session out of the default list; it stays under `agentctl ls --hidden`.
  - `agentctl delete` keeps it out of every list except `agentctl ls --deleted`.
  - Both take `--undo`. Deleted outranks hidden. `agentctl ls --all` shows everything.
  - TUI: `h` hides, `x` deletes (twice — it drops out of every view), `v` cycles normal → hidden →
    deleted, and the old hide-done toggle moves from `h` to `H`.
  - GUI: Hide and Delete buttons in the details pane, plus a view menu in the toolbar.
- **The GUI reached parity with the CLI** — it can now read and edit labels and due dates as well as
  names, notes, flags, reminders and done state, shows a badge for each, and searches labels.
- `/agentctl-hide` and `/agentctl-delete` in the plugin, and the skill now knows both — with an
  explicit rule that Claude must never delete a session it was not asked to.

## [0.5.0] — 2026-08-29

### Changed — BREAKING

- **Renamed to `agentctl`.** One name everywhere, replacing the several the project used to ship.
  The command is now **`agentctl`**; the previous command names are gone. The cask is
  `roypadina/tap/agentctl`, the app is `Agentctl.app` (`com.roypadina.agentctl` — the previous
  bundle id used a domain we don't own), and config lives in `~/.config/agentctl`. Shell aliases or
  Raycast/tmux binds pointing at the previous command need updating, and the new bundle id means the
  global hotkey, Login Item and Accessibility grants have to be given to the app once more.

### Added

- **Labels** — link a session to a ticket, repo or topic (`agentctl label RD-12345 catalog`, or
  `--auto` to take the issue key straight from the git branch). Labels keep their case, are matched
  by the picker's filter, and filter the listing (`agentctl annotations --label RD-12345`). `l` in
  the TUI, pre-filled with the branch's issue key.
- **Due dates** — `agentctl due "friday 17:00"`, distinct from a reminder: a due date is when the
  work is due, and the session shows overdue once it passes. `u` in the TUI, `✱` badge, red when
  overdue.
- **A skill in the [`agentctl-sessions` plugin](https://github.com/roypadina/padina-claude-code-plugins)** (which now lives in its own marketplace repo) teaching Claude the whole toolset — to name and
  label sessions unprompted, to drive every command from plain requests, and to offer to install
  `agentctl` when it is missing instead of failing quietly. Plus `/agentctl-label` and
  `/agentctl-due` commands, and a `SessionStart` hook that now reports labels, due dates and the
  issue key it found in your branch.

## [0.4.0] — 2026-08-29

### Added

- **Names, notes, flags, done and reminders on any session.** Rename a session as often as you like
  (`e`), pin a note to it (`n`), tag it (`f`), set a reminder (`t`), mark it finished (`d`) and hide
  finished ones (`h`) — or from the shell with `agentctl name/note/flag/remind/done/annotations`. Run
  inside a Claude session those commands target *that* session with no id. Rows show `✓ ⚑ ✎ ◆`
  badges (the reminder turns red once due) and the fuzzy filter searches flags and notes.
  Everything lives in `~/.config/agentctl/annotations/<id>.json`, one file per session, written
  atomically and kept outside `~/.claude` so it can never corrupt a transcript.
- **`agentctl-sessions` Claude Code plugin** (`plugins/agentctl-sessions`) — `/agentctl-name`, `/agentctl-note`,
  `/agentctl-flag`, `/agentctl-remind`, `/agentctl-done`, and a `SessionStart` hook that hands each session its own
  name, note and flags back, reports reminders that came due, and asks an unnamed session to name
  itself once its first task is clear.
- **Multi-profile support.** Several Claude accounts via `CLAUDE_CONFIG_DIR` (`~/.claude`,
  `~/.claude2`, …) are all scanned, so their sessions appear with correct live status.
- **`±N` dirty count** on the highlighted New-screen row (#1) — one `git status` for the selection
  only, debounced and cached, never on the scan path.
- **`pgup`/`pgdn` and `g`/`G`** in Resume and New; `↑/↓` now works while the filter box is open.

### Fixed

- **Resuming used the wrong Claude account.** Resume inherited whatever `CLAUDE_CONFIG_DIR` was set,
  so a session found under one profile could be resumed under another — and when profiles share a
  `projects/` dir that *succeeds silently as the wrong account*. Resume now pins the profile the
  session actually belongs to.
- **Sessions running under a side profile showed as `inactive`.** Live status only looked in
  `~/.claude/sessions`; every `~/.claude*` profile is scanned now.
- **A held-down arrow scrolled one row.** ink parses only the first key of each stdin chunk, so five
  presses arriving together moved the cursor once. The full repeat count is applied now.
- **Full-text search rendered every hit at once**, blowing past the terminal and scrolling the header
  away. Results are windowed, with a position counter.
- **The list could push the header off screen** whenever a note, a recap, a prompt or the ▲/▼ hints
  appeared. Its height is derived from what is actually on screen, and a scrollbar shows position.
- **A long cwd shifted every column left** — ink was flex-shrinking the fixed cells.
- **Arrow keys felt dead right after filtering** (the cursor kept a stale index), and fast typing in
  the New filter dropped characters.

## [0.3.0] — 2026-06-09

### Added

- **Session recap.** Press `r` in Resume (or run `agentctl recap <id>`) to generate a short
  AI summary of a session — what it was working on, key decisions, current state, open follow-ups —
  so you can decide whether to resume it without reading the whole transcript. Runs `claude -p`
  with the cheap/fast **haiku** model (override with `AGENTCTL_RECAP_MODEL`) on a token-capped head+tail
  excerpt, and caches the result to `~/.config/agentctl/recaps/<id>.md` so re-opening is instant.
  `^r` now refreshes the session list; `r` recaps. The GUI gets a **Generate recap** button in the
  details pane.
- **Last-used timestamp** shown for every session in both the TUI and GUI.
- **Always-on details pane.** Highlighting a session now shows its full metadata (id, status, branch,
  started, last used, cwd) plus the recap — in the TUI, and in the GUI when a row is selected (no need
  to open it first).

### Changed

- **Redesigned Resume + New as bordered tables** — aligned columns (name · branch · last-used / age),
  far more readable than the old stacked cards.
- **GUI window dismissal** — clicking outside the window or pressing `esc` now closes it (menu-bar-panel feel).
- **Resizable GUI split** — drag the divider between the session list and the preview/details pane.

### Fixed

- **Wrong session on resume.** The fuzzy matcher could return a scattered, negative-scoring
  subsequence match, so searching a name (e.g. "LanGuard") sometimes resumed an unrelated session.
  Matches below a relevance floor are now rejected (TUI and GUI fuzzy stay in parity).
- **`↵` did nothing in the TUI menu.** Resume/quit set the result but never exited ink, so the
  deferred resume never ran. Enter now resumes the highlighted session.
- **Wrong "started" time.** Session timestamps are ISO strings, but the JSONL scan only parsed
  numeric ones, so "started" fell back to the file ctime. ISO timestamps are now parsed correctly.
- **GUI search didn't filter** (stale install) and **GUI recap reported an opaque "exit 1"** — the
  back-end now always exits 0 and conveys success/failure in its JSON so the GUI shows the real reason.

## [0.2.1] — 2026-06-05

### Changed

- **App bundle renamed to `Agentctl.app`** (+ `CFBundleName` = "Agentctl") so Spotlight,
  Raycast, and Finder show the spaced display name instead of "Agentctl". `brew upgrade --cask
  agentctl` swaps the bundle. Identifiers (`agentctl` token, repo, `com.roypadina.agentctl`,
  the `agentctl` binary) are unchanged.

## [0.2.0] — 2026-06-05

### Changed (breaking)

- **Commands renamed.** The three separate commands are replaced by a single **`agentctl`**. It
  opens **New** by default; **`-r`** / **`--resume`** opens **Resume**. Want `claude`/`cdx`-style
  per-tool shortcuts? Add your own shell aliases. After `brew upgrade --cask agentctl`, the previous
  command symlinks are removed.
- **Display name** is now "Agentctl" (spaces) in the app, menu bar, and docs. The cask token
  (`agentctl`), repo, and bundle id are unchanged.

## [0.1.1] — 2026-06-05

### Fixed

- **GUI launch shortcut is now a recorder.** The Settings field used to require typing the spec
  by hand (`cmd+shift+m`); you can now click it and press the combo. Only shortcuts the app can
  actually register are accepted, and Esc clears it.

## [0.1.0] — 2026-06-05

First public release. Agentctl merges two tools — a project launcher and a
session manager — into one, with a native macOS GUI.

### Added

- **New-session launcher** (the New tab): grouped project directories, frecency sort
  (`z`, falls back to mtime), fuzzy filter, per-row git branch, and one-key open-in-IDE / tmux /
  `git pull` / Finder / new-directory.
- **Resume** (the Resume tab): fuzzy-search every Claude Code session by name, path, or
  id; full-text search across transcripts; an inline transcript **peek** (side-by-side on wide
  terminals); and a cwd-confidence gate that warns before resuming into an uncertain directory.
- **Unified TUI**: `agentctl` opens the menu (New ⇄ Resume via `⇥`, tool cycle via `⇧⇥`), with a `?`
  help overlay and a windowed viewport for long lists.
- **Native macOS GUI** (`gui/`): a SwiftUI menu-bar + window app — keyboard-driven picker
  (custom search field with arrow/enter/esc/tab handling), full-row selection, transcript preview
  pane, in-app config editor with color pickers, a configurable terminal, and a global hotkey.
- **Shared TOML config** at `~/.config/agentctl/config.toml`, edited by hand or in the GUI.
- Homebrew cask (`roypadina/tap/agentctl`) bundling the GUI app and the CLI.

[0.3.0]: https://github.com/roypadina/Agentctl/releases/tag/v0.3.0
[0.2.1]: https://github.com/roypadina/Agentctl/releases/tag/v0.2.1
[0.2.0]: https://github.com/roypadina/Agentctl/releases/tag/v0.2.0
[0.1.1]: https://github.com/roypadina/Agentctl/releases/tag/v0.1.1
[0.1.0]: https://github.com/roypadina/Agentctl/releases/tag/v0.1.0
