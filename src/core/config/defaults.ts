import type { AgentctlConfig, PermissionMode, ThemeConfig, ToolConfig } from './types.js';

/** Hex colour fallback. */
export const DEFAULT_COLOR = '#8888aa';

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';

/** CLI args that start Claude Code in the given permission mode. */
export function permissionArgs(mode: PermissionMode): string[] {
  return mode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'auto'];
}

/** Built-in tools. Used when config omits a [[tool]] of this name. */
export function defaultTools(mode: PermissionMode = DEFAULT_PERMISSION_MODE): Record<string, ToolConfig> {
  return {
    claude: { name: 'claude', runs: ['claude', ...permissionArgs(mode)].join(' '), label: ' ⚡ Projects ', color: '#6C91BF' },
    cdx: { name: 'cdx', runs: 'codex --dangerously-bypass-approvals-and-sandbox', label: ' ✦ Codex ', color: '#A855F7' },
  };
}

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

export const DEFAULT_CONFIG: AgentctlConfig = {
  groups: [],
  tools: Object.values(defaultTools()),
  ides: [],
  defaultTool: 'claude',
  permissionMode: DEFAULT_PERMISSION_MODE,
  theme: DEFAULT_THEME,
};
