import { expandPath } from './paths.js';
import { DEFAULT_COLOR, DEFAULT_THEME, DEFAULT_GUI } from './defaults.js';
import {
  ConfigError,
  type AgentctlConfig,
  type ConfigWarning,
  type GroupConfig,
  type IdeConfig,
  type ThemeConfig,
  type ToolConfig,
} from './types.js';

export interface ValidateOptions {
  reservedKeys: Set<string>;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;
const IDE_KEY_RE = /^ctrl-[a-z]$/;

function normalizeColor(raw: unknown, warnings: ConfigWarning[], where: string): string {
  if (typeof raw === 'string') {
    const m = raw.trim().match(HEX_RE);
    if (m) return '#' + m[1].toUpperCase();
  }
  if (raw !== undefined) {
    warnings.push({ code: 'bad-color', message: `${where}: invalid color "${String(raw)}" → ${DEFAULT_COLOR}` });
  }
  return DEFAULT_COLOR;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function expectArray(raw: Record<string, unknown>, key: string): unknown[] {
  const v = raw[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    throw new ConfigError(6, `config: [[${key}]] must be a table-array, got ${typeof v}`);
  }
  return v;
}

function buildTheme(raw: unknown): ThemeConfig {
  const t = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    accent: asString(t.accent) ?? DEFAULT_THEME.accent,
    border: asString(t.border) ?? DEFAULT_THEME.border,
    pointer: asString(t.pointer) ?? DEFAULT_THEME.pointer,
    statusBusy: asString(t.status_busy) ?? DEFAULT_THEME.statusBusy,
    statusIdle: asString(t.status_idle) ?? DEFAULT_THEME.statusIdle,
    statusInactive: asString(t.status_inactive) ?? DEFAULT_THEME.statusInactive,
  };
}

/**
 * Validate a parsed-TOML object into a AgentctlConfig + warnings.
 * Throws ConfigError(6) only on top-level shape errors. Everything else degrades + warns.
 */
export function validateConfig(
  rawInput: unknown,
  opts: ValidateOptions,
): { config: AgentctlConfig; warnings: ConfigWarning[] } {
  const warnings: ConfigWarning[] = [];
  if (rawInput !== undefined && (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput))) {
    throw new ConfigError(6, 'config: top-level must be a TOML table');
  }
  const raw = (rawInput ?? {}) as Record<string, unknown>;

  // groups
  const groups: GroupConfig[] = [];
  for (const g of expectArray(raw, 'group')) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const name = asString(o.name) ?? '';
    const pathRaw = asString(o.path) ?? '';
    if (!pathRaw) {
      warnings.push({ code: 'missing-group-path', message: `group "${name || '(unnamed)'}" has no path → dropped` });
      continue;
    }
    const { path, warning } = expandPath(pathRaw);
    if (warning) warnings.push(warning);
    groups.push({ name: name || pathRaw, path, pathRaw, color: normalizeColor(o.color, warnings, `group "${name}"`) });
  }

  // tools (dedup by name, first wins)
  const tools: ToolConfig[] = [];
  const seenTool = new Set<string>();
  for (const t of expectArray(raw, 'tool')) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const name = asString(o.name) ?? '';
    if (!name) continue;
    if (seenTool.has(name)) {
      warnings.push({ code: 'dup-tool-name', message: `duplicate tool "${name}" → kept first` });
      continue;
    }
    seenTool.add(name);
    tools.push({
      name,
      runs: asString(o.runs) ?? name,
      label: asString(o.label) ?? ` ${name} `,
      color: normalizeColor(o.color, warnings, `tool "${name}"`),
    });
  }

  // ides (validate key, drop reserved, dedup by key)
  const ides: IdeConfig[] = [];
  const seenKey = new Set<string>();
  for (const it of expectArray(raw, 'ide')) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const key = (asString(o.key) ?? '').toLowerCase();
    const cmd = asString(o.cmd) ?? '';
    if (!IDE_KEY_RE.test(key)) {
      warnings.push({ code: 'bad-ide-key', message: `ide key "${key}" must match ctrl-<a-z> → dropped` });
      continue;
    }
    if (opts.reservedKeys.has(key)) {
      warnings.push({ code: 'reserved-key', message: `ide key "${key}" is reserved → dropped` });
      continue;
    }
    if (seenKey.has(key)) {
      warnings.push({ code: 'dup-ide-key', message: `duplicate ide key "${key}" → kept first` });
      continue;
    }
    seenKey.add(key);
    ides.push({ key, label: asString(o.label) ?? key, cmd });
  }

  // default tool
  let defaultTool = asString(raw.default_tool) ?? 'claude';
  if (tools.length > 0 && !tools.some(t => t.name === defaultTool)) {
    warnings.push({ code: 'unknown-default-tool', message: `default_tool "${defaultTool}" not configured → using "${tools[0].name}"` });
    defaultTool = tools[0].name;
  }

  // gui
  const guiRaw = (raw.gui && typeof raw.gui === 'object') ? raw.gui as Record<string, unknown> : {};
  const gui = {
    terminal: asString(guiRaw.terminal) ?? DEFAULT_GUI.terminal,
    launchCommand: asString(guiRaw.launch_command),
    hotkey: asString(guiRaw.hotkey),
  };

  const config: AgentctlConfig = {
    groups,
    tools,
    ides,
    defaultTool,
    theme: buildTheme(raw.theme),
    gui,
  };
  return { config, warnings };
}
