import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, realpathSync, statSync } from 'node:fs';

export function claudeHome(): string {
  return process.env.AGENTCTL_HOME ?? join(homedir(), '.claude');
}

export function projectsDir(): string {
  return join(claudeHome(), 'projects');
}

export function sessionsDir(): string {
  return join(claudeHome(), 'sessions');
}

/**
 * Every Claude home on this machine: `~/.claude` plus side profiles created with
 * `CLAUDE_CONFIG_DIR` (`~/.claude2`, `~/.claude3`, `~/.claude-work`, …). Each profile
 * keeps its own `sessions/` dir, so scanning only the primary reports every session
 * running under a side profile as inactive. `AGENTCTL_HOME` pins the scan to one home.
 */
export function claudeHomes(): string[] {
  const pinned = process.env.AGENTCTL_HOME;
  if (pinned) return [pinned];
  const home = homedir();
  const homes = [join(home, '.claude')];
  try {
    for (const name of readdirSync(home)) {
      if (name === '.claude' || !name.startsWith('.claude')) continue;
      const p = join(home, name);
      try {
        if (statSync(p).isDirectory()) homes.push(p);
      } catch {
        // unreadable entry
      }
    }
  } catch {
    // unreadable home — primary only
  }
  return homes;
}

/** Existing paths only, with symlinked duplicates collapsed (profiles often share `projects/`). */
function existingUnique(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(p);
  }
  return out;
}

export function projectsDirs(): string[] {
  return existingUnique(claudeHomes().map(h => join(h, 'projects')));
}

export function sessionsDirs(): string[] {
  return existingUnique(claudeHomes().map(h => join(h, 'sessions')));
}
