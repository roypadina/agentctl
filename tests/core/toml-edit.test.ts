import { describe, it, expect } from 'vitest';
import { upsertKeyInSection } from '../../src/core/config/toml-edit.js';
import { parse } from 'smol-toml';

describe('upsertKeyInSection', () => {
  it('replaces an existing key in the section, preserving comments + other keys', () => {
    const src = `# header comment
default_tool = "claude"

[gui]
terminal = "Terminal"
# launch_command = 'x'
`;
    const out = upsertKeyInSection(src, 'gui', 'terminal', 'iTerm');
    expect(out).toContain('terminal = "iTerm"');
    expect(out).not.toContain('terminal = "Terminal"');
    expect(out).toContain('# header comment');
    expect(out).toContain('default_tool = "claude"');
    expect((parse(out) as any).gui.terminal).toBe('iTerm');
  });

  it('inserts the key after the header when missing', () => {
    const src = `[gui]\nother = "x"\n`;
    const out = upsertKeyInSection(src, 'gui', 'terminal', 'default');
    expect((parse(out) as any).gui.terminal).toBe('default');
    expect((parse(out) as any).gui.other).toBe('x');
  });

  it('appends a new section when absent', () => {
    const src = `default_tool = "claude"\n`;
    const out = upsertKeyInSection(src, 'gui', 'terminal', 'Ghostty');
    expect((parse(out) as any).gui.terminal).toBe('Ghostty');
  });

  it('does not bleed into the next section', () => {
    const src = `[gui]\nterminal = "Terminal"\n\n[theme]\naccent = "#fff"\n`;
    const out = upsertKeyInSection(src, 'gui', 'launch_command', 'cmd');
    const parsed = parse(out) as any;
    expect(parsed.gui.launch_command).toBe('cmd');
    expect(parsed.theme.accent).toBe('#fff');
    expect(parsed.theme.launch_command).toBeUndefined();
  });

  it('escapes quotes in the value', () => {
    const out = upsertKeyInSection('[gui]\n', 'gui', 'launch_command', 'open -a "iTerm" {{script}}');
    expect((parse(out) as any).gui.launch_command).toBe('open -a "iTerm" {{script}}');
  });
});
