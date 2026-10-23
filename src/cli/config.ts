import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { configPath, exampleConfigPath } from '../core/config/paths.js';
import { clearConfigCache } from '../core/config/loadConfig.js';

/** Seed the config from the shipped example (no rc edits — the bins are installed by brew). */
export function runSetup(): void {
  const cfg = configPath();
  if (existsSync(cfg)) {
    console.log(`config already exists: ${cfg}`);
  } else {
    mkdirSync(dirname(cfg), { recursive: true });
    copyFileSync(exampleConfigPath(), cfg);
    console.log(`seeded config at ${cfg}`);
  }
  console.log('edit it with:  agentctl config --edit');
}

export function runEdit(): void {
  const editor = process.env.EDITOR ?? 'vi';
  spawnSync(editor, [configPath()], { stdio: 'inherit' });
  clearConfigCache();
}

export function registerConfigCommands(program: Command): void {
  program
    .command('config')
    .description('manage the Agentctl config')
    .option('--setup', 'create the config from the example')
    .option('--edit', 'open the config in $EDITOR')
    .option('--path', 'print the config path')
    .action((opts: { setup?: boolean; edit?: boolean; path?: boolean }) => {
      if (opts.path) { console.log(configPath()); return; }
      if (opts.setup) { runSetup(); return; }
      if (opts.edit) { runEdit(); return; }
      console.log(configPath());
    });
}
