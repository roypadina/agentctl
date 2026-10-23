# Agentctl — Launch-Day Runbook (paste-and-go)

Anchor day: **Thu 2026-06-12** (repo is >1 week old → awesome-claude-code eligible; concentrate the star burst for Changelog Nightly trending). Post **one channel at a time**, stay and reply, and **NEVER ask for upvotes**.

Reusable bits:
- Repo: `https://github.com/roypadina/Agentctl`
- Install: `brew install --cask roypadina/tap/agentctl`
- Demo GIF (TUI): `docs/demo.gif` (upload where an image is allowed)

> ⚠️ Reddit was blocked from the dev machine, so the submit links below are the standard per-sub URLs. **Flair must be picked in the submit page** (can't be pre-linked) — I note which flair each time. If a sub's flair name differs, pick the closest "Showcase / I built this / Project" one.

---

## Pre-flight (morning of, ~10 min)
- [ ] Logged into HN (`roypadina`), Reddit, X — all on stable, non-project-named accounts.
- [ ] Social preview uploaded (done) — confirm `https://github.com/roypadina/Agentctl` unfurls a card.
- [ ] `docs/demo.gif` open in a Finder window, ready to drag-drop.
- [ ] README looks right on github.com (hero GIF autoplays).
- [ ] You have **no other open issue** in `hesreallyhim/awesome-claude-code` (needed for the form).

---

## Day 1 — Thu Jun 12, 9–11am ET

### A. Show HN — the anchor (do this first)
**Submit:** https://news.ycombinator.com/submit
- **Title** (paste exactly; no `!`, no version/domain):
```
Show HN: Agentctl – Start and resume Claude Code / Codex sessions from one menu (macOS)
```
- **URL field:** `https://github.com/roypadina/Agentctl`
- **Text field:** leave blank.
- **Immediately post this as the first comment:**
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

Repo + demo: https://github.com/roypadina/Agentctl

Most want feedback on: (1) is the transcript-preview-on-resume enough to identify a session?
(2) Linux/Windows interest — the TUI is Node/ink so it's portable in principle. Happy to answer anything.
```
- **After:** keep the tab open all day, answer every comment. Do **not** tweet the HN link or ask anyone to upvote.

### B. r/ClaudeCode (same morning)
**Submit (text post):** https://www.reddit.com/r/ClaudeCode/submit  → pick **flair: Showcase**
- **Title:**
```
I kept losing track of which Claude Code session was which, so I built a one-key launcher + fuzzy session-resumer (TUI, MIT)
```
- **Body** (paste; then drag in `docs/demo.gif` where marked):
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

[drag in docs/demo.gif here]

Runs fully local. Install:  brew install --cask roypadina/tap/agentctl
Repo: https://github.com/roypadina/Agentctl

How do you all juggle multiple agent sessions today — tmux, separate terminals, `claude --resume`
and hope? Want to know if transcript-preview resume is the right solve.
```

### C. X / Twitter (same morning — link the REPO, never the HN thread)
Post as a thread (paste):
```
1/ I kept losing track of which Claude Code session was which — 40+ across repos.
So I built Agentctl: one menu to start a new Claude Code / Codex session in any repo, or
fuzzy-resume a past one. Free, MIT, local. 🧵 [attach docs/demo.gif]

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

### D. awesome-claude-code (web issue form — NOT a PR, auto-ban if you PR)
**Form:** https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml
- Paste each field from **`docs/awesome-claude-code-submission.md`** (already filled, incl. the local-only + `--dangerously-skip-permissions` disclosure).
- Tick all 5 checklist boxes (all true now).

---

## Day 2 (Fri) — r/commandline
**Submit:** https://www.reddit.com/r/commandline/submit  → best-fit TUI flair · link straight to GitHub (no shorteners)
- **Title:**
```
Agentctl — a terminal session manager/launcher for coding-agent sessions (frecency launcher + fuzzy resume)
```
- **Body** (frame as a *session manager*, not an "LLM tool" — Rule 6; list alternatives — Rule 8):
```
I'm the author (free, MIT). Sharing a TUI I built to manage coding-agent sessions from the terminal.

Two halves in one menu:
- New: a frecency-sorted, fuzzy project launcher across your repos — one key opens a session there
  (in your IDE, in tmux, or after a git pull), shows the git branch per row.
- Resume: fuzzy-search every past session by name, path, or full transcript text, with an inline
  transcript peek and a working-directory confidence gate before it resumes you anywhere.

Built on ink (Node/TS).

Alternatives I knew about: tmux/sesh for window/session juggling, `claude --resume` (id-only, no
search), and various parallel-agent runners. This one's angle is fuzzy *transcript* search to find
the exact past session, plus the frecency launcher.

Note: parts of the codebase were written with AI assistance.
Repo (direct): https://github.com/roypadina/Agentctl
Install: brew install --cask roypadina/tap/agentctl
```

---

## Day 3 (Sat) — Terminal Trove
**Terminal Trove submit:** https://terminaltrove.com/post/ — submit the TUI (`agentctl`); macOS, TS/JS, MIT; tagline + 250–300-char overview + brew install + **a PNG/GIF preview is mandatory** (use `docs/demo.gif`).

---

## Day 4 (Sun/Mon) — r/tmux + dev.to
**r/tmux submit:** https://www.reddit.com/r/tmux/submit → flair: **Showcase** (lead with the tmux hook)
- **Title:**
```
agentctl — a fuzzy project launcher that opens Claude Code / Codex sessions straight into tmux
```
- **Body:**
```
I'm the author (MIT). I kept context-switching between repos and wanted one key from a project
picker into a tmux session running an agent.

Agentctl: frecency-sorted, fuzzy project launcher — pick a repo, it opens your tool
(Claude Code / Codex) right there, and it can open into tmux (or your IDE, or after a git pull).
The other half fuzzy-searches and resumes your past sessions by transcript text.

[attach a GIF of launch → tmux]

Install: brew install --cask roypadina/tap/agentctl
Repo: https://github.com/roypadina/Agentctl
```
**dev.to:** https://dev.to/new → tags `#showdev #cli #ai #macos` (max 4)
- **Title:** `Show DEV: Agentctl — fuzzy-resume your Claude Code & Codex sessions by transcript text`
- Short post: the problem (losing which session is which) → what it does (frecency launcher + transcript-search resume) → `docs/demo.gif` → `brew install --cask roypadina/tap/agentctl` → repo. Show WHAT it does (a HOW-to tutorial gets the #showdev tag stripped). Set canonical_url if you cross-post.

---

## Day 5–6 — r/ClaudeAI + r/codex
**r/ClaudeAI submit:** https://www.reddit.com/r/ClaudeAI/submit → pick the "I built this / Made with Claude" flair; check for a pinned self-promo megathread and use it if present.
- **Title:**
```
I kept losing which Claude session was which — built a fuzzy session-resumer with transcript preview (TUI, MIT)
```
- Body: reuse the r/ClaudeCode body above.

**r/codex submit:** https://www.reddit.com/r/codex/submit → flair: **Showcase** (lead with the Codex angle)
- **Title:**
```
A TUI that starts and resumes your Codex CLI sessions (also Claude Code) — fuzzy transcript search, MIT
```
- **Body:**
```
I'm the author (MIT, free). I run both Codex CLI and Claude Code and kept losing track of sessions.

Agentctl starts a new Codex/Claude session in any project (frecency-sorted fuzzy launcher),
or fuzzy-searches your past sessions by transcript text and resumes the right one with a preview.
Terminal TUI (agentctl).

Install: brew install --cask roypadina/tap/agentctl
Repo: https://github.com/roypadina/Agentctl
```

---

## Ongoing (after launch week)
- [ ] **AlternativeTo** (account already created): User menu → "Suggest new application" → Platform = **Mac OS**, License = **Open Source**, tags `cli`/`developer-tools`/`ai`; list as an alternative to other agent CLIs.
- [ ] **Watch the 5 awesome-list PRs**; reply to any maintainer questions: cli-coding-agents #115 · awesome-tuis #710 · ai-devtools #625 · awesome-mac #2161 · open-source-mac-os-apps #1145.
- [ ] When stars climb: PR **awesome-cli-apps** (≥20★ + >90d) and **awesome-shell** (≥50★).
- [ ] **Console.dev** pitch (email `hello@console.dev`, frame as pre-1.0 beta) + **Changelog News** submit form.

## Hard don'ts
Never ask for upvotes / no vote-ring (HN shadowban). No PR to awesome-claude-code (form only). Don't name your HN/Reddit account after the project. Don't buy stars. Don't same-day duplicate-post across subreddits. No URL shorteners on r/commandline.
