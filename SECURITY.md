# Security Policy

## Reporting a Vulnerability

agentctl launches shell commands and reads your Claude Code session files, so security
reports are taken seriously. Please **do not** open a public issue for security problems.

Instead, use GitHub's private vulnerability reporting
(**Security → Report a vulnerability**).

You'll get an acknowledgement within a few days. Once a fix is available it will be released
and the report disclosed, with credit unless you prefer otherwise.

## Scope

agentctl runs entirely on-device and makes no network calls of its own. Relevant areas:

- **Command launching** — tool/IDE commands from your config are executed in a shell; session
  ids are interpolated into the resume command (validated against a strict charset first).
- **Config parsing** — the shared TOML config is read from `~/.config/agentctl/`.
- **Session reading** — `~/.claude/` transcripts are parsed read-only.
