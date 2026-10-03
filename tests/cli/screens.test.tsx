import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { NewScreen } from '../../src/cli/screens/NewScreen.js';
import { AppShell } from '../../src/cli/screens/AppShell.js';
import { setScreenResult } from '../../src/cli/router.js';
import { ConfigError } from '../../src/core/config/types.js';
import type { AgentctlConfig } from '../../src/core/config/types.js';
import type { ProjectDir } from '../../src/core/groupScan.js';
import type { SessionRecord } from '../../src/core/types.js';

// Capture ink's exit() so we can assert a terminal action (resume/quit) actually unmounts —
// runApp performs the resume only AFTER ink exits, so calling setScreenResult alone is not enough.
const { exitSpy } = vi.hoisted(() => ({ exitSpy: vi.fn() }));
vi.mock('ink', async (orig) => {
  const actual = await orig<typeof import('ink')>();
  return { ...actual, useApp: () => ({ exit: exitSpy }) };
});
vi.mock('../../src/cli/router.js', () => ({ setScreenResult: vi.fn() }));

const session = (id: string, name: string): SessionRecord => ({
  id, name, transcriptName: name, cwd: '/tmp', launchCwd: '/tmp', cwdDecodeConfident: true, kind: 'interactive' as const, jsonlPath: '/x.jsonl', sizeBytes: 0,
  startedAt: new Date(), lastUpdatedAt: new Date(), active: false, status: 'inactive',
});

async function sendKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
  stdin.write(key);
  await new Promise((r) => setTimeout(r, 10));
}

const config: AgentctlConfig = {
  groups: [
    { name: 'Frontend', path: '/code/fe', pathRaw: '~/code/fe', color: '#6C91BF' },
    { name: 'Backend', path: '/code/be', pathRaw: '~/code/be', color: '#A855F7' },
  ],
  tools: [{ name: 'claude', runs: 'claude --x', label: ' c ', color: '#6C91BF' }],
  ides: [{ key: 'ctrl-v', label: 'code', cmd: 'code "$dir"' }],
  defaultTool: 'claude',
  theme: { accent: '#FF9F43', border: '#6C91BF', pointer: '#FF9F43', statusBusy: 'green', statusIdle: 'yellow', statusInactive: 'gray' },
  gui: { terminal: 'Terminal' },
};
const dir = (name: string, group: string, color: string): ProjectDir =>
  ({ name, path: `/code/${group}/${name}`, group, groupColor: color, timeMs: 1700000000000, scoreSource: 'mtime' });

describe('AppShell', () => {
  it('starts in New with a New|Resume tab bar', () => {
    const projects = [[dir('web-app', 'fe', '#6C91BF')], [dir('api', 'be', '#A855F7')]];
    const { lastFrame } = render(
      <AppShell initialTab="new" config={config} warnings={[]} projects={projects} initialSessions={null} />
    );
    const f = lastFrame() ?? '';
    expect(f).toContain('New');
    expect(f).toContain('Resume');   // inactive tab still labelled
    expect(f).toContain('switch');   // ⇥ switch hint
    expect(f).toContain('web-app');  // New content shown by default
  });

  it('Enter on a resume row sets the resume result AND exits ink', async () => {
    // Regression: Enter "did nothing" — AppShell set the result but never exited, so runApp
    // (which resumes only after ink unmounts) never ran. Resume requires BOTH.
    vi.mocked(setScreenResult).mockClear();
    exitSpy.mockClear();
    const { stdin } = render(
      <AppShell
        initialTab="resume"
        config={config}
        warnings={[]}
        projects={[]}
        initialSessions={[session('aaaa1111-0000-0000-0000-000000000000', 'pick me')]}
      />,
    );
    await sendKey(stdin, '\r'); // Enter on the (confident-cwd) session
    expect(setScreenResult).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'resume', record: expect.objectContaining({ id: 'aaaa1111-0000-0000-0000-000000000000' }) }),
    );
    expect(exitSpy).toHaveBeenCalled();
  });
});

describe('NewScreen', () => {
  it('renders group sections, dir rows, and the tool', () => {
    const projects = [[dir('web-app', 'fe', '#6C91BF')], [dir('api', 'be', '#A855F7')]];
    const { lastFrame } = render(
      <NewScreen config={config} warnings={[]} projects={projects} />
    );
    const f = lastFrame() ?? '';
    expect(f).toContain('Frontend');
    expect(f).toContain('Backend');
    expect(f).toContain('web-app');
    expect(f).toContain('api');
    expect(f).toContain('keys'); // footer points to the ? help overlay (full keymap incl. IDEs)
  });

  it('shows the no-groups hint when empty', () => {
    const empty = { ...config, groups: [] };
    const { lastFrame } = render(<NewScreen config={empty} warnings={[]} projects={[]} />);
    expect(lastFrame() ?? '').toContain('no groups configured');
  });

  it('renders the config-error panel', () => {
    const { lastFrame } = render(
      <NewScreen warnings={[]} projects={[]} configError={new ConfigError(5, 'boom at line 3')} />
    );
    const f = lastFrame() ?? '';
    expect(f).toContain('config error');
    expect(f).toContain('boom at line 3');
  });
});
