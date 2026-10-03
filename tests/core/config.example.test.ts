import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/core/config/loadConfig.js';
import { exampleConfigPath } from '../../src/core/config/paths.js';
import { existsSync } from 'node:fs';

describe('config.example.toml', () => {
  it('resolves to a real file', () => {
    expect(existsSync(exampleConfigPath())).toBe(true);
  });

  it('loads with zero warnings (guards a broken seed)', () => {
    const r = loadConfig({ path: exampleConfigPath() });
    expect(r.source).toBe('file');
    expect(r.warnings).toEqual([]);
    expect(r.config.groups.length).toBeGreaterThan(0);
    expect(r.config.tools.map(t => t.name)).toContain('claude');
    expect(r.config.ides.length).toBeGreaterThan(0);
  });
});
