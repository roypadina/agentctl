import React from 'react';
import { render as inkRender } from 'ink';
import { listSessions } from '../core/sessionRepo.js';
import { listProjects } from '../core/groupScan.js';
import { loadConfig } from '../core/config/loadConfig.js';
import { ConfigError } from '../core/config/types.js';
import { resume, ResumeError } from './resume.js';
import { executePlan, LaunchError } from './launch.js';
import { RESERVED_KEYS } from './keys.js';
import { AppShell, type Tab } from './screens/AppShell.js';
import type { LaunchPlan } from '../core/launchSpec.js';
import type { SessionRecord } from '../core/types.js';

export type Screen = 'root' | 'new' | 'resume';

export type ScreenResult =
  | { kind: 'quit' }
  | { kind: 'launch'; plan: LaunchPlan }
  | { kind: 'resume'; record: SessionRecord; yes?: boolean; cwdOverride?: string };

let pending: ScreenResult = { kind: 'quit' };
export function setScreenResult(r: ScreenResult): void { pending = r; }

/** Restore a clean TTY before handing fd 0 to a child (B1: drain ink's type-ahead). */
function drainTty(): void {
  try {
    process.stdin.pause();
    if (process.stdin.isTTY) (process.stdin as NodeJS.ReadStream).setRawMode?.(false);
    (process.stdin as NodeJS.ReadStream).removeAllListeners?.('readable');
  } catch { /* noop */ }
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h');
}

/** Mount the app (New by default, switchable to Resume), then run any deferred launch. */
export async function runApp(initial: Screen, opts: { find?: string } = {}): Promise<void> {
  pending = { kind: 'quit' } as ScreenResult;
  const tab: Tab = initial === 'resume' ? 'resume' : 'new';

  let configResult: ReturnType<typeof loadConfig> | undefined;
  let configError: ConfigError | undefined;
  try {
    configResult = loadConfig({ reservedKeys: RESERVED_KEYS });
  } catch (e) {
    if (e instanceof ConfigError) configError = e; else throw e;
  }
  const projects = configResult
    ? await listProjects(configResult.config.groups, { withGit: true })
    : [];
  const initialSessions: SessionRecord[] | null = tab === 'resume' ? await listSessions({ view: 'all' }) : null;

  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  const instance = inkRender(
    <AppShell
      initialTab={tab}
      config={configResult?.config}
      warnings={configResult?.warnings ?? []}
      projects={projects}
      configError={configError}
      initialSessions={initialSessions}
      initialFind={opts.find}
    />,
  );
  await instance.waitUntilExit();
  await new Promise((r) => setImmediate(r)); // let ink's last readable handler detach

  const r = pending;
  if (r.kind === 'quit') return;
  if (r.kind === 'launch') {
    drainTty();
    try {
      const code = executePlan(r.plan);
      if (r.plan.requiresTeardown) process.exit(code);
      return;
    } catch (e) {
      if (e instanceof LaunchError) { console.error(e.message); process.exit(e.code); }
      throw e;
    }
  }
  // resume
  drainTty();
  try {
    resume(r.record, { yes: r.yes, cwdOverride: r.cwdOverride });
  } catch (e) {
    if (e instanceof ResumeError) { console.error(e.message); process.exit(e.code); }
    throw e;
  }
}
