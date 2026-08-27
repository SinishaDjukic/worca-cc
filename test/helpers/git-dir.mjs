// test/helpers/git-dir.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/** A throwaway git repo with one empty commit — the shape every orchestrator
 *  suite needs (a checkpoint ref must be resolvable). Same one-liner the
 *  orchestrator-* suites inline today. */
export function gitDir(tag = 'graph') {
  const dir = mkdtempSync(join(tmpdir(), `worca-cc-${tag}-`));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}
