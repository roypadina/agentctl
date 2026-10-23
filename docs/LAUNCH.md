# Agentctl — Launch & Promotion Notes

> Launch playbook from the distribution-research workflow, on the v0.2.x command scheme
> (`agentctl` / `agentctl`). The *actual* posting is done by the author, in their own voice.
> A deeper channel-by-channel breakdown lives in `docs/DISTRIBUTION.md` (kept local).

**Positioning — lead with this everywhere:** *"Never lose a Claude Code / Codex session again — fuzzy-search and resume any past session with transcript preview, plus a frecency-sorted launcher for new ones."* The **resume-with-transcript-preview** hook is the novel part. Do **not** lead with "menu/launcher" (HN will say "just use tmux").

## #1 move (before posting anywhere)
A **10–20s demo GIF** at the top of the README: New picker (fuzzy filter) → switch to Resume → fuzzy-search a past session → **peek transcript** → resume. It's the conversion surface every channel points back to. Record against **sanitized/fake data** (never your real `~/.claude` — it has work/client names).

## Pre-launch checklist
- [ ] **Demo GIF** (`docs/demo.gif`, VHS `demo.tape`, fake data) — autoplays on GitHub/awesome-lists. (asciinema `<script>` embeds render as nothing on GitHub — must be a GIF.)
- [ ] **README** stays landing-page shaped (H1 → GIF → badges → 1-line install → pain bullets). ✅ mostly done.
- [x] **Social-preview/OG image** built → `docs/social-preview.png` (1280×640). ⚠️ Still **upload via repo Settings → General → Social preview (web UI only, no API)** before sharing (X/Slack cache unfurls). Verify with X Card Validator.
- [x] **Topics** (claude-code, codex, coding-agent, ai-agent, session-manager, cli, tui, terminal, macos, homebrew, developer-tools) + keyword About line.
- [x] **FUNDING.yml** (ko_fi: roypadina).
- [ ] Pinned **"good first issue"**.
- [x] **Working tap**.
- [ ] **Pre-written objection answers** (tmux / `claude --resume`; "phones home?" → local-only MIT; macOS-only).

**Eligibility timers (repo created 2026-06-05, 0 stars):**
- **awesome-claude-code**: the issue-form's only hard gate is **repo ≥1 week old** (first commit 2026-06-05 → eligible **2026-06-12**) + no other open issue from you in that repo. No star minimum in the form itself (stars only help the maintainer's discretionary review). Web issue form ONLY; NEVER a PR/`gh` — auto-ban. Pre-filled answers ready in `docs/awesome-claude-code-submission.md`.
- **AlternativeTo**: create an account **now** (blocks new accounts from creating pages ~1 week).
- **awesome-cli-apps**: blocked until 90 days + >20 stars — later.

## Launch sequence (~1 week; one channel/day, never a same-day blast; NEVER solicit upvotes)
| Day | When | Channel |
|---|---|---|
| T-7..T-2 | — | build assets; email Console.dev (`hello@console.dev`); warm Reddit/HN accounts |
| Day 1 (Tue/Wed) | 9–11am ET | **Show HN** (anchor) + **r/ClaudeCode** AM; tweet the **repo** (never the HN thread) |
| Day 2 | AM | **r/commandline** (TUI framing) |
| Day 3 | AM | open **Terminal Trove** submission |
| Day 4 | — | **DevHunt** + **awesome-tuis** PR |
| Day 5–6 | AM | **r/ClaudeAI** (broader) + **dev.to** "How I built" |
| Day 7+ | ≥5 stars | **awesome-claude-code** issue form + **AlternativeTo** |

Tiers: **T1** Show HN · r/ClaudeCode · awesome-claude-code · Terminal Trove · tap. **T2** r/commandline · DevHunt · dev.to · r/ClaudeAI · awesome-tuis · Console.dev. **T3** GitHub Trending (effect of T1–3 velocity) · AlternativeTo · X/Fosstodon build-in-public · Anthropic Discord #show-and-tell. **Skip:** r/programming, Product Hunt, MCP/plugin marketplaces (off-category).

---

## Ready-to-post copy (v0.2.0 commands)

### Show HN
**Title:** `Show HN: Agentctl – Start and resume Claude Code / Codex sessions from one menu (macOS)`

**First comment (post immediately):**
```
I built this because I juggle a dozen+ Claude Code and Codex sessions across repos, and resuming
the *right* one was a constant "wait, which terminal was that in?" problem. I'd already hacked
together two personal tools — a session launcher and a session manager — so I merged them.

What it does: one menu to (a) start a new agent session in any project dir — projects are grouped
and frecency-sorted with a fuzzy filter, one keypress to launch in your IDE / tmux / after a git
pull — and (b) fuzzy-search *past* Claude Code sessions and resume them, with a transcript preview
so you can see which conversation it is before jumping back in. Works for Claude Code and Codex.

It ships as a terminal TUI (agentctl).

MIT, runs fully local — reads your local session files, nothing leaves your machine. No signup.

  brew install --cask roypadina/tap/agentctl

Repo + demo (GIF in the README): https://github.com/roypadina/Agentctl

Most want feedback on: (1) is the transcript-preview-on-resume enough to identify a session?
(2) Linux/Windows interest — the TUI is Node/ink so it's portable in principle. Happy to answer anything.
```

### Reddit — r/ClaudeCode
**Title:** `I kept losing track of which Claude Code session was which, so I built a one-key launcher + fuzzy session-resumer (TUI, MIT)`
```
Full disclosure: I'm the solo dev, this is free and MIT.

The problem: 15+ Claude Code sessions across repos (+ some Codex), and every time I came back I'd
waste minutes finding the one I actually wanted to resume.

So I built Agentctl. Two things:

1. Start a NEW session — project dirs show up grouped + frecency-sorted (most-used float up),
   fuzzy-filter, one keypress launches (IDE / tmux / git pull first).
2. RESUME a past Claude Code session — fuzzy-search across past sessions with a transcript preview,
   so you see which conversation it is before resuming. This is the part I use constantly.

Terminal TUI (agentctl). Handles Claude Code and Codex.

[GIF: new-session picker → fuzzy-resume with transcript preview]

Runs fully local. Install:  brew install --cask roypadina/tap/agentctl
Repo: https://github.com/roypadina/Agentctl

How do you all juggle multiple agent sessions today — tmux, separate terminals, `claude --resume`
and hope? Want to know if transcript-preview resume is the right solve.
```

### X / Twitter thread
```
1/ I kept losing track of which Claude Code session was which — 40+ across repos.
So I built Agentctl: one menu to start a new Claude Code / Codex session in any repo, or
fuzzy-resume a past one. Free, MIT, local. 🧵 [hero GIF]

2/ The killer feature: fuzzy-search your PAST Claude Code sessions and resume them — with a
transcript preview, so you see which conversation it is before jumping back in.
Most tools spin up new parallel sessions. This finds the one you already had.

3/ New sessions too: project dirs grouped + frecency-sorted, fuzzy-filter, one keypress to launch
in your IDE / tmux / with a git pull. Claude Code AND Codex.

4/ A terminal TUI (agentctl).

5/ macOS, one line:  brew install --cask roypadina/tap/agentctl
Repo + demo: github.com/roypadina/Agentctl
Building in public, solo, no budget — feedback welcome 🙏 #ClaudeCode #buildinpublic
```

### awesome-claude-code (web issue form — NOT a PR)
- Category: Tooling · Sub-category: Orchestrators / Config Managers
- Display Name: Agentctl · Primary Link: repo · License: MIT
- Include install **and** uninstall; disclose: local-only beyond the Anthropic tooling/brew fetch.
- Attach the demo GIF + a validation recipe (`brew install --cask roypadina/tap/agentctl`, run `agentctl`).

## Don'ts
Never solicit upvotes / cross-link vote requests (HN voting-ring shadowban). No marketing language on HN. Don't name your HN/Reddit account after the project. Don't PR to awesome-claude-code (issue form only). Don't buy stars. Don't same-day duplicate-post across subreddits.
