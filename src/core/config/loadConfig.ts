import { readFileSync, statSync } from 'node:fs';
import { parse, TomlError } from 'smol-toml';
import { configPath } from './paths.js';
import { validateConfig } from './validate.js';
import { DEFAULT_CONFIG, DEFAULT_RESERVED_KEYS, DEFAULT_TOOLS, DEFAULT_COLOR } from './defaults.js';
import {
  ConfigError,
  type AgentctlConfig,
  type LoadConfigResult,
  type ToolConfig,
} from './types.js';

interface CacheEntry {
  mtimeMs: number;
  sizeBytes: number;
  result: LoadConfigResult;
}
const cache = new Map<string, CacheEntry>();

export function clearConfigCache(): void {
  cache.clear();
}

export interface LoadConfigOptions {
  path?: string;
  reservedKeys?: Set<string>;
}

/**
 * Load + validate the config. Missing file → defaults (no throw). A TOML syntax error throws
 * ConfigError(5) (caller decides whether to surface or fall back) — see B8: only the explicit
 * `agentctl config` paths let it propagate; interactive screens catch it.
 * Note: readFileSync is fine here — config is KB-scale. The streaming rule is for MB JSONL.
 */
export function loadConfig(opts: LoadConfigOptions = {}): LoadConfigResult {
  const path = opts.path ?? configPath();
  const reservedKeys = opts.reservedKeys ?? DEFAULT_RESERVED_KEYS;

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        config: structuredCloneConfig(DEFAULT_CONFIG),
        warnings: [],
        source: 'default',
        path,
        mtimeMs: 0,
        sizeBytes: 0,
      };
    }
    throw e;
  }

  const cached = cache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.sizeBytes === st.size) {
    return cached.result;
  }

  const text = readFileSync(path, 'utf8');
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    if (e instanceof TomlError) {
      const line = (e as unknown as { line?: number }).line;
      const col = (e as unknown as { column?: number }).column;
      const where = line !== undefined ? ` at line ${line}${col !== undefined ? `:${col}` : ''}` : '';
      throw new ConfigError(5, `config parse error in ${path}${where}: ${e.message}`);
    }
    throw e;
  }

  const { config, warnings } = validateConfig(raw, { reservedKeys });
  // Always guarantee claude/cdx exist as launchers.
  if (config.tools.length === 0) {
    config.tools = [DEFAULT_TOOLS.claude, DEFAULT_TOOLS.cdx];
  }

  const result: LoadConfigResult = {
    config,
    warnings,
    source: 'file',
    path,
    mtimeMs: st.mtimeMs,
    sizeBytes: st.size,
  };
  cache.set(path, { mtimeMs: st.mtimeMs, sizeBytes: st.size, result });
  return result;
}

/** Resolve a tool by name: config > built-in defaults > synthesized (run the name itself). */
export function getTool(config: AgentctlConfig, name: string): ToolConfig {
  const found = config.tools.find(t => t.name === name);
  if (found) return found;
  if (DEFAULT_TOOLS[name]) return DEFAULT_TOOLS[name];
  return { name, runs: name, label: ` ${name} `, color: DEFAULT_COLOR };
}

function structuredCloneConfig(c: AgentctlConfig): AgentctlConfig {
  return {
    groups: c.groups.map(g => ({ ...g })),
    tools: c.tools.map(t => ({ ...t })),
    ides: c.ides.map(i => ({ ...i })),
    defaultTool: c.defaultTool,
    theme: { ...c.theme },
    gui: { ...c.gui },
  };
}
