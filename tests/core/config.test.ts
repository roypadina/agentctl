import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getTool, clearConfigCache } from '../../src/core/config/loadConfig.js';
import { ConfigError } from '../../src/core/config/types.js';

let dir: string;
function cfg(contents: string): string {
  const p = join(dir, `c-${Math.abs(hashStr(contents))}.toml`);
  writeFileSync(p, contents);
  return p;
}
function hashStr(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentctl-cfg-')); clearConfigCache(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('loadConfig', () => {
  it('returns defaults when the file is missing (no throw)', () => {
    const r = loadConfig({ path: join(dir, 'nope.toml') });
    expect(r.source).toBe('default');
    expect(r.config.groups).toEqual([]);
    expect(r.config.tools.map(t => t.name)).toEqual(['claude', 'cdx']);
    expect(r.warnings).toEqual([]);
  });

  it('parses groups/tools/ides and expands paths', () => {
    const p = cfg(`
[[group]]
name = "FE"
path = "~/fe"
color = "#6c91bf"
[[group]]
name = "Env"
path = "$HOME/env"
color = "#A855F7"
[[tool]]
name = "claude"
runs = "claude --x"
label = " c "
color = "#6C91BF"
[[ide]]
key = "ctrl-v"
label = "code"
cmd = 'code "$dir"'
`);
    const { config } = loadConfig({ path: p });
    expect(config.groups[0].path).toBe(join(homedir(), 'fe'));
    expect(config.groups[0].color).toBe('#6C91BF'); // uppercased
    expect(config.groups[1].path).toBe(join(homedir(), 'env'));
    expect(config.ides).toHaveLength(1);
    expect(config.tools.find(t => t.name === 'claude')?.runs).toBe('claude --x');
  });

  it('drops a reserved ide key with a warning (never throws)', () => {
    const p = cfg(`[[ide]]\nkey="ctrl-p"\nlabel="x"\ncmd="echo"\n`);
    const { config, warnings } = loadConfig({ path: p });
    expect(config.ides).toHaveLength(0);
    expect(warnings.some(w => w.code === 'reserved-key')).toBe(true);
  });

  it('dedupes ide keys and tool names', () => {
    const p = cfg(`
[[ide]]
key="ctrl-v"
cmd="a"
[[ide]]
key="ctrl-v"
cmd="b"
[[tool]]
name="t"
runs="x"
[[tool]]
name="t"
runs="y"
`);
    const { config, warnings } = loadConfig({ path: p });
    expect(config.ides).toHaveLength(1);
    expect(config.tools.filter(t => t.name === 't')).toHaveLength(1);
    expect(warnings.some(w => w.code === 'dup-ide-key')).toBe(true);
    expect(warnings.some(w => w.code === 'dup-tool-name')).toBe(true);
  });

  it('coerces a bad color and warns', () => {
    const p = cfg(`[[group]]\nname="g"\npath="/tmp"\ncolor="not-a-color"\n`);
    const { config, warnings } = loadConfig({ path: p });
    expect(config.groups[0].color).toBe('#8888aa');
    expect(warnings.some(w => w.code === 'bad-color')).toBe(true);
  });

  it('warns on unknown $VAR but keeps it literal', () => {
    const p = cfg(`[[group]]\nname="g"\npath="$NOPE/x"\n`);
    const { config, warnings } = loadConfig({ path: p });
    expect(config.groups[0].path).toContain('$NOPE');
    expect(warnings.some(w => w.code === 'unknown-var')).toBe(true);
  });

  it('falls back default_tool to the first configured tool with a warning', () => {
    const p = cfg(`default_tool="ghost"\n[[tool]]\nname="real"\nruns="x"\n`);
    const { config, warnings } = loadConfig({ path: p });
    expect(config.defaultTool).toBe('real');
    expect(warnings.some(w => w.code === 'unknown-default-tool')).toBe(true);
  });

  it('throws ConfigError(5) on a TOML syntax error', () => {
    const p = cfg(`this is = = broken\n`);
    expect(() => loadConfig({ path: p })).toThrowError(ConfigError);
    try { loadConfig({ path: p }); } catch (e) { expect((e as ConfigError).code).toBe(5); }
  });

  it('caches by mtime+size and re-reads after a change', () => {
    const p = join(dir, 'cache.toml');
    writeFileSync(p, `default_tool="a"\n[[tool]]\nname="a"\nruns="x"\n`);
    const r1 = loadConfig({ path: p });
    const r2 = loadConfig({ path: p });
    expect(r2).toBe(r1); // cached identity
    writeFileSync(p, `default_tool="b"\n[[tool]]\nname="b"\nruns="yy"\n`);
    const r3 = loadConfig({ path: p });
    expect(r3).not.toBe(r1);
    expect(r3.config.defaultTool).toBe('b');
  });
});

describe('getTool', () => {
  it('resolves config > defaults > synthesized', () => {
    const p = cfg(`[[tool]]\nname="foo"\nruns="foo --go"\n`);
    const { config } = loadConfig({ path: p });
    expect(getTool(config, 'foo').runs).toBe('foo --go');
    expect(getTool(config, 'claude').runs).toBe('claude --dangerously-skip-permissions');
    expect(getTool(config, 'bar').runs).toBe('bar'); // synthesized
  });
});
