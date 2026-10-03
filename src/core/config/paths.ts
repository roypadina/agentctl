import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { ConfigWarning } from './types.js';

/**
 * Config path resolution chain:
 *   $AGENTCTL_CONFIG  →  $XDG_CONFIG_HOME/agentctl/config.toml  →  ~/.config/agentctl/config.toml
 */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), '.config');
  return join(base, 'agentctl');
}

export function configPath(): string {
  const explicit = process.env.AGENTCTL_CONFIG;
  if (explicit && explicit.trim()) return explicit;
  return join(configDir(), 'config.toml');
}

/** Resolve the shipped example config relative to the package root (walks up to package.json). */
export function exampleConfigPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'config.example.toml');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: alongside this module's package root guess.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config.example.toml');
}

const VAR_ALLOWLIST = new Set(['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']);

/**
 * Expand a config path string: leading ~ → home, and a closed allowlist of $VAR / ${VAR}.
 * Unknown $VAR is left literal and reported via a warning. No general envsubst.
 */
export function expandPath(p: string): { path: string; warning?: ConfigWarning } {
  let warning: ConfigWarning | undefined;
  let out = p;

  if (out === '~') out = homedir();
  else if (out.startsWith('~/')) out = join(homedir(), out.slice(2));

  out = out.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (match, name: string) => {
    if (name === 'HOME') return homedir();
    if (VAR_ALLOWLIST.has(name)) {
      const v = process.env[name];
      if (v && v.trim()) return v;
    }
    warning = { code: 'unknown-var', message: `left unexpanded: ${match} in "${p}"` };
    return match;
  });

  return { path: out, warning };
}
