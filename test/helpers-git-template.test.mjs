// test/helpers-git-template.test.mjs — the template-repo helpers hand out independent copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitDir, templateRepo, templateWorld } from './helpers/git-dir.mjs';

const made = [];
const g = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const keep = (d) => (made.push(d), d);
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

test('templateRepo: two copies are independent repos, and the default shape is gitDir()\'s', () => {
  const a = keep(templateRepo('tpl-a')); const b = keep(templateRepo('tpl-b')); const ref = keep(gitDir('tpl-ref'));
  const headB = g(b, 'rev-parse', 'HEAD');
  g(a, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'second');
  assert.notEqual(g(a, 'rev-parse', 'HEAD'), headB);
  assert.equal(g(b, 'rev-parse', 'HEAD'), headB);
  assert.equal(g(a, 'symbolic-ref', '--short', 'HEAD'), g(ref, 'symbolic-ref', '--short', 'HEAD'));
  assert.equal(g(b, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(spawnSync('git', ['config', '--local', 'user.email'], { cwd: b }).status, 1, 'no stored identity, like gitDir');
});

test('templateRepo: freshRepo shape (main, stored identity, committed seed) and init-only', () => {
  const r = keep(templateRepo('tpl-fresh', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } }));
  assert.equal(g(r, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(g(r, 'config', 'user.email'), 't@t');
  assert.equal(g(r, 'ls-files'), 'README.md');
  assert.equal(g(r, 'status', '--porcelain'), '');
  writeFileSync(join(r, 'x.txt'), 'x\n'); g(r, 'add', '-A'); g(r, 'commit', '-qm', 'x'); // works with no -c: identity stored
  const i = keep(templateRepo('tpl-init', { commit: false }));
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: i }).status, 1);
  assert.equal(g(i, 'rev-parse', '--is-inside-work-tree'), 'true');
});

/** origin + clone a (absolute path: git stores it as given) + clone b (relative: git stores the
 *  REALPATH, /private/var/… on macOS) — both spellings must be rewritten. */
function trio(root) {
  g(root, 'init', '-q', '--bare', '-b', 'dev', 'origin.git');
  g(root, 'clone', '-q', join(root, 'origin.git'), 'a');
  writeFileSync(join(root, 'a', 'f.txt'), 'one\n');
  g(join(root, 'a'), 'add', '-A');
  g(join(root, 'a'), '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  g(join(root, 'a'), 'push', '-q', 'origin', 'HEAD:dev');
  g(root, 'clone', '-q', 'origin.git', 'b');
  g(join(root, 'b'), 'fetch', '-q', 'origin'); // FETCH_HEAD names the template origin
  mkdirSync(join(root, 'links'));
  symlinkSync('../a/f.txt', join(root, 'links', 'f'));
}

test('templateWorld: a copied clone pushes to its own copied origin, never the template\'s', () => {
  const w1 = keep(templateWorld('trio', trio)); const w2 = keep(templateWorld('trio', trio));
  for (const c of ['a', 'b']) {
    const url = g(join(w1, c), 'config', 'remote.origin.url');
    assert.ok(url.endsWith(join('origin.git')) && !url.includes('worca-cc-tplw-'), `${c}: ${url}`);
  }
  const before2 = g(join(w2, 'origin.git'), 'rev-parse', 'dev');
  writeFileSync(join(w1, 'b', 'g.txt'), 'two\n'); g(join(w1, 'b'), 'add', '-A');
  g(join(w1, 'b'), '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'teammate');
  g(join(w1, 'b'), 'push', '-q', 'origin', 'HEAD:dev');
  assert.equal(g(join(w1, 'origin.git'), 'rev-parse', 'dev'), g(join(w1, 'b'), 'rev-parse', 'HEAD'));
  assert.equal(g(join(w2, 'origin.git'), 'rev-parse', 'dev'), before2, 'the other copy is untouched');
  const w3 = keep(templateWorld('trio', trio));
  assert.equal(g(join(w3, 'origin.git'), 'rev-parse', 'dev'), before2, 'the template is untouched');
  assert.equal(readlinkSync(join(w1, 'links', 'f')), '../a/f.txt', 'relative symlinks stay relative');
  assert.equal(readFileSync(join(w1, 'links', 'f'), 'utf8'), 'one\n');
  assert.ok(!readFileSync(join(w2, 'b', '.git', 'FETCH_HEAD'), 'utf8').includes('worca-cc-tplw-'), 'FETCH_HEAD rewritten');
});

test('templateRepo into: copies into a given member dir', () => {
  const root = keep(templateRepo('tpl-root', { commit: false }));
  const m = join(root, 'web');
  assert.equal(templateRepo('x', { commit: false, branch: 'main', user: true, into: m }), m);
  assert.equal(g(m, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.ok(g(m, 'rev-parse', '--show-toplevel').endsWith('web'));
});

test('templateWorld: the key is required and distinct keys give distinct worlds', () => {
  assert.throws(() => templateWorld((r) => trio(r)), /key must be a non-empty string/);
  const x = keep(templateWorld('one', (r) => writeFileSync(join(r, 'one'), '1')));
  const y = keep(templateWorld('two', (r) => writeFileSync(join(r, 'two'), '2')));
  assert.deepEqual([readFileSync(join(x, 'one'), 'utf8'), readFileSync(join(y, 'two'), 'utf8')], ['1', '2']);
});

test('a template build starts no background git maintenance (it would race the copy)', () => {
  // A commit normally starts `git maintenance run --auto --detach`, which takes .git/objects/maintenance.lock
  // while copyOf is still copying the template; cpSync then fails with ENOENT on the vanished lock.
  const before = process.env.GIT_CONFIG_COUNT;
  let trace = null;
  keep(templateWorld('no-maintenance', (root) => {
    g(root, 'init', '-q');
    trace = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TRACE: '1' } }).stderr;
  }));
  assert.equal(/maintenance run/.test(trace), false, trace);
  assert.equal(process.env.GIT_CONFIG_COUNT, before, 'the setting is scoped to the build');
  keep(templateRepo('tpl-maint', { files: { 'a.md': 'a\n' } }));
  assert.equal(process.env.GIT_CONFIG_COUNT, before);
});
