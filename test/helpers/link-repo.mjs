// test/helpers/link-repo.mjs — the chat-links fixture repo (issue 1064): a git repo on `dev` with a `feat` branch that
// adds src/only-on-branch.js, plus credential files, worca's own files, links in and out, and a binary file.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeLinkRepo(prefix = 'chat-links-') {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}out-`)));
  const sh = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  const put = (rel, text) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text); };
  writeFileSync(join(outside, 'secret.txt'), 'x');
  execFileSync('git', ['init', '-q', '-b', 'dev', repo]);
  put('src/a.js', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  put('src/dup/app.js', 'a\n'); put('lib/app.js', 'b\n'); put('uniq.md', '# u\n');
  put('.env', 'K=v\n'); put('keys/id_rsa', 'k\n'); put('.claude/rules/worca/x.md', 'm\n');
  writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 0, 2, 3]));
  symlinkSync(outside, join(repo, 'out'));
  symlinkSync('src/a.js', join(repo, 'inlink'));
  symlinkSync('.env', join(repo, 'envlink'));
  sh('add', '-A'); sh('commit', '-qm', 'base');
  sh('checkout', '-qb', 'feat'); put('src/only-on-branch.js', 'x\ny\n'); sh('add', '-A'); sh('commit', '-qm', 'feat'); sh('checkout', '-q', 'dev');
  return { repo, outside, sh };
}
