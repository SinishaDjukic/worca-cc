// tools/demo/extension-video/lib/sample-project.mjs — copy sample-app/ (+ Worca's Poppins/JetBrains Mono woff2) into a
// fresh git repo and commit it. git runs with the sandbox HOME/gitconfig the caller passes in env.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_DIR = new URL('../sample-app/', import.meta.url);
export const FONT_DIR = new URL('../../../../ui/public/fonts/', import.meta.url);

export function createSampleProject(dest, { env = process.env } = {}) {
  mkdirSync(dest, { recursive: true });
  cpSync(fileURLToPath(SAMPLE_DIR), dest, { recursive: true });
  mkdirSync(join(dest, 'fonts'), { recursive: true });
  for (const f of readdirSync(FONT_DIR)) if (/^(poppins|jetbrains-mono)-.*\.woff2$/.test(f)) cpSync(fileURLToPath(new URL(f, FONT_DIR)), join(dest, 'fonts', f));
  const git = (...a) => execFileSync('git', a, { cwd: dest, env, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Acme Pulse: landing and pricing page');
  return dest;
}
