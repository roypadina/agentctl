export type SessionStatus = 'busy' | 'idle' | 'inactive';

/**
 * Who drove the session. `interactive` is a real session you sat in front of; `tool` is a run
 * started by something else — `claude -p`, the SDK, an MCP client, an IDE bridge. Derived from
 * the transcript's `entrypoint`, so it is known for dead sessions too.
 */
export type SessionKind = 'interactive' | 'tool';

export interface SessionRecord {
  id: string;
  /** Display name: the annotation's name override when set, else `transcriptName`. */
  name: string;
  /** Name derived from the JSONL alone (custom-title → ai-title → first prompt). */
  transcriptName: string;
  /**
   * Where the work actually happened — the last directory the transcript recorded, which follows
   * the session as it moves. Falls back to `launchCwd` when the transcript names nowhere that
   * still exists. This is what gets listed, and what a resume drops you into.
   */
  cwd: string;
  /**
   * Where `claude` was launched, decoded from the project directory name. Often a parent of
   * `cwd` — you start in ~/Code and end up working three directories down.
   */
  launchCwd: string;
  /** `~/ClaudWork/<folder>` the session did its work in, when that folder still exists. */
  workDir?: string;
  cwdDecodeConfident: boolean;
  jsonlPath: string;
  sizeBytes: number;
  startedAt: Date;
  lastUpdatedAt: Date;
  active: boolean;
  status: SessionStatus;
  pid?: number;
  version?: string;
  gitBranch?: string;
  /** Interactive session or a tool-driven run — see SessionKind. */
  kind: SessionKind;
  /** Raw `entrypoint` from the transcript (`cli`, `sdk-cli`, …); undefined on older transcripts. */
  entrypoint?: string;
  /**
   * Claude home this session belongs to (`~/.claude`, `~/.claude3`, …). Resuming must run under
   * it — a mismatch silently resumes the transcript as the WRONG ACCOUNT when profiles share a
   * `projects/` dir. Undetectable for a dead session under symlinked profiles; see core/paths.ts.
   */
  configDir?: string;
  /** User annotation (name override already applied to `name`). */
  annotation?: Annotation;
}

/** User-attached metadata for a session, stored outside ~/.claude (see core/annotations.ts). */
export interface Annotation {
  sessionId: string;
  /** Overrides every JSONL-derived title when set. */
  name?: string;
  note?: string;
  /** Short status markers you set for yourself: todo, later, blocked. Rendered as badges. */
  flags: string[];
  /** Descriptive tags that link a session to something: a Jira key, a repo, a topic. Searchable. */
  labels: string[];
  done: boolean;
  /**
   * Kept out of the default listing but shown in the hidden view. Purely a listing preference —
   * the Claude Code transcript is never touched.
   */
  hidden: boolean;
  /**
   * Kept out of every listing except the explicit deleted view. Recoverable with
   * `agentctl delete --undo`. Still only a listing preference — the transcript is never touched
   * and nothing is removed from ~/.claude.
   */
  deleted: boolean;
  /** ISO timestamp — nudge me at this time. */
  remindAt?: string;
  /** ISO timestamp — the work itself is due at this time. */
  dueAt?: string;
  updatedAt?: string;
}

/** Which slice of the sessions to list. `normal` hides both hidden and deleted ones. */
export type SessionView = 'normal' | 'hidden' | 'deleted' | 'all';

export interface ListOptions {
  cwd?: string;
  activeOnly?: boolean;
  view?: SessionView;
  /** Keep only interactive sessions, or only tool-driven runs. Omit for both. */
  kind?: SessionKind;
  sortBy?: 'updated' | 'started' | 'name';
  limit?: number;
}

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  status: 'busy' | 'idle';
  version?: string;
  /** Claude home the pid file was found in — authoritative profile while the process lives. */
  profile?: string;
}

export type TranscriptRole = 'user' | 'assistant' | 'system' | 'tool';
export type TranscriptKind =
  | 'text'
  | 'thinking'
  | 'tool-use'
  | 'tool-result'
  | 'summary'
  | 'attachment';

export interface TranscriptTurn {
  role: TranscriptRole;
  kind: TranscriptKind;
  text: string;
}
