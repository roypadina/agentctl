import type { AgentctlConfig, ThemeConfig, ToolConfig } from './types.js';

/** Hex colour fallback. */
export const DEFAULT_COLOR = '#8888aa';

/** Built-in tools. Used when config omits a [[tool]] of this name. */
export const DEFAULT_TOOLS: Record<string, ToolConfig> = {
  claude: { name: 'claude', runs: 'claude --dangerously-skip-permissions', label: ' ⚡ Projects ', color: '#6C91BF' },
  cdx: { name: 'cdx', runs: 'codex --dangerously-bypass-approvals-and-sandbox', label: ' ✦ Codex ', color: '#A855F7' },
};

/** Colors duplicated (NOT imported) from tui.tsx to keep core ink-free. */
export const DEFAULT_THEME: ThemeConfig = {
  accent: '#FF9F43',
  border: '#6C91BF',
  pointer: '#FF9F43',
  statusBusy: 'green',
  statusIdle: 'yellow',
  statusInactive: 'gray',
};

/** enter + the reserved launcher keys. Convenience default; the New screen owns the real set (B12). */
export const DEFAULT_RESERVED_KEYS = new Set(['enter', 'ctrl-f', 'ctrl-p', 'ctrl-t', 'ctrl-n']);

export const DEFAULT_GUI = { terminal: 'default' as const };

export const DEFAULT_CONFIG: AgentctlConfig = {
  groups: [],
  tools: [DEFAULT_TOOLS.claude, DEFAULT_TOOLS.cdx],
  ides: [],
  defaultTool: 'claude',
  theme: DEFAULT_THEME,
  gui: { ...DEFAULT_GUI },
};
