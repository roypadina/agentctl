// Agentctl config model. Pure data — no ink, no fs here (see loadConfig.ts).

export interface GroupConfig {
  name: string;
  /** Expanded, absolute (or as-resolved) path scanned one level deep. */
  path: string;
  /** Original string from the TOML, before ~ / $VAR expansion (for display/debug). */
  pathRaw: string;
  /** #RRGGBB used for the section header + accents. */
  color: string;
}

export interface ToolConfig {
  /** Generates a launcher command of this name (claude, cdx, …). */
  name: string;
  /** Shell command line run in the chosen dir (e.g. "claude --dangerously-skip-permissions"). */
  runs: string;
  /** fzf-style border label. */
  label: string;
  color: string;
}

export interface IdeConfig {
  /** ctrl-<letter>; validated against reserved keys at load. */
  key: string;
  label: string;
  /** Shell snippet eval'd with $dir = selected absolute path. */
  cmd: string;
}

export interface ThemeConfig {
  accent: string;
  border: string;
  pointer: string;
  statusBusy: string;
  statusIdle: string;
  statusInactive: string;
}

export interface GuiConfig {
  /** terminal kind: "Terminal" | "iTerm" | "cmux" | "custom" | …  Consumed only by the Mac GUI. */
  terminal: string;
  /** for terminal = "custom": a shell template with {{cmd}} substituted. */
  launchCommand?: string;
  /** global shortcut to open the GUI window, e.g. "cmd+shift+m" (Mac GUI only). */
  hotkey?: string;
}

export interface AgentctlConfig {
  groups: GroupConfig[];
  tools: ToolConfig[];
  ides: IdeConfig[];
  defaultTool: string;
  theme: ThemeConfig;
  gui: GuiConfig;
}

export type ConfigWarningCode =
  | 'reserved-key'
  | 'bad-ide-key'
  | 'dup-ide-key'
  | 'bad-color'
  | 'missing-group-path'
  | 'dup-tool-name'
  | 'unknown-default-tool'
  | 'unknown-var';

export interface ConfigWarning {
  code: ConfigWarningCode;
  message: string;
}

export interface LoadConfigResult {
  config: AgentctlConfig;
  warnings: ConfigWarning[];
  source: 'file' | 'default';
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}

/** Thrown only on the explicit config command paths (agentctl config / --setup / --edit). */
export class ConfigError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
