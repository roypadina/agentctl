# Agentctl — Mac GUI

A native menu-bar + window app (SwiftUI, `LSUIElement`) that **is** the menu — it shows your
projects and sessions in a real UI and opens the chosen one in your configured terminal. It is a
thin view: all data + launching + config comes from `agentctl gui …`, so the GUI never parses TOML or
reads `~/.claude` itself. The GUI and the terminal TUI share one config (`~/.config/agentctl/config.toml`).

## Build / run

```sh
./build-app.sh                 # → gui/Agentctl.app (release, ad-hoc signed)
open "./Agentctl.app"          # ✦ appears in the menu bar
```

`agentctl` must be on `PATH` (or at `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`). Until brew
ships it: `cd .. && npm run build && npm link`. For dev you can also set `$AGENTCTL_BIN`.

- **Left-click ✦** → popover. **Right-click ✦** → Open / Open in window / Quit.
- **New** tab: groups → all dirs (frecency-sorted, git branch shown). Filter box. Pick a tool
  (claude/cdx…) bottom-right. Click a dir → opens a session there. **＋ New dir** creates a dir under
  any existing dir, then opens it.
- **Resume** tab: searchable list of existing sessions → click to resume.
- **⚙ Settings**: edit the shared config — groups, tools, IDEs, default tool, and the terminal
  sessions open in (default = system default; Terminal, iTerm, Ghostty, Warp, kitty, WezTerm,
  cmux, or a custom command).
- **macwindow** button: detach the popover into a resizable window.

## GUI ↔ CLI contract (`agentctl gui …`)

| Command | Returns / does |
|---------|----------------|
| `agentctl gui projects` | JSON: groups → dirs (branch, age), tools, defaultTool |
| `agentctl gui sessions` | JSON: resumable sessions |
| `agentctl gui new-dir --base <d> --name <n>` | mkdir, prints `{path}` |
| `agentctl gui launch --dir <d> [--tool <t>]` | open the tool in `<d>` in the configured terminal |
| `agentctl gui resume --id <id>` | resume a session in the configured terminal |
| `agentctl gui terminals` / `set-terminal <v> [--command <t>]` | terminal picker read/write |
| `agentctl gui config-get` / `config-save` | full config read / write (shared with the TUI) |

The terminal opener writes a temp `*.command` (`cd <dir>; exec <cmd>`) and:
`default` → `open <script>` (system default terminal) · app name → `open -a <App> <script>` ·
`custom` → runs `launch_command` with `{{script}}` / `{{cmd}}` / `{{dir}}`.

## Notes

- Ad-hoc signed for local/team use (not notarized) — a future brew cask can ship it.
- `CM_GUI_SHOW_WINDOW=1` opens the window on launch (used for headless screenshots).
