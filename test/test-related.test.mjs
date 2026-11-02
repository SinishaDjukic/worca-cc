import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildGraph, changedFiles, relatedTests, FULL_SUITE } from '../tools/test-related.mjs';

const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

/** A throwaway repo laid out like this one: { 'src/a.mjs': '…', … }. */
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'worca-cc-related-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const related = (root, changed) => relatedTests(root, changed, buildGraph(root));

const FIXTURE = {
  'src/a.mjs': 'export const a = 1;\n',
  'src/b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n",
  'src/lazy.mjs': 'export const lazy = 1;\n',
  'src/c.mjs': "export const load = () => import('./lazy.mjs');\n",
  'src/prose.mjs': "export const P = 'edit files under src/ and test/ only';\n",
  'src/registry.mjs': "export const AGENTS = new URL('../agents/', import.meta.url);\n",
  'agents/x.md': '# x\n',
  'ui/x.js': 'export {};\n',
  'docs/d.md': '# d\n',
  'test/helpers/h.mjs': "export { b } from '../../src/b.mjs';\n",
  'test/static.test.mjs': "import { a } from '../src/a.mjs';\n",
  'test/chain.test.mjs': "import { b } from './helpers/h.mjs';\n",
  'test/dynamic.test.mjs': "import { load } from '../src/c.mjs';\n",
  'test/url.test.mjs': "const p = new URL('../ui/x.js', import.meta.url);\n",
  'test/quoted.test.mjs': "const f = 'src/lazy.mjs';\n",
  'test/joined.test.mjs': "import { join } from 'node:path';\nconst d = join(ROOT, 'docs', 'd.md');\n",
  'test/registry.test.mjs': "import { AGENTS } from '../src/registry.mjs';\n",
  'test/prose.test.mjs': "import { P } from '../src/prose.mjs';\n",
  'src/commented.mjs': "// see 'src/a.mjs' and `ui/x.js`\n/* also 'docs/d.md' */\nexport const u = 'https://example.com/x'; const why = `ui/x.js answers 400`;\n",
  'test/commented.test.mjs': "import { u } from '../src/commented.mjs';\n",
};

test('each kind of reference makes an edge: static and dynamic import, new URL, a quoted repo path, join() segments', () => {
  const root = repo(FIXTURE);
  assert.deepEqual(related(root, ['src/a.mjs']).tests, ['test/chain.test.mjs', 'test/static.test.mjs']);
  assert.deepEqual(related(root, ['src/lazy.mjs']).tests, ['test/dynamic.test.mjs', 'test/quoted.test.mjs']);
  assert.deepEqual(related(root, ['ui/x.js']).tests, ['test/url.test.mjs']);
  assert.deepEqual(related(root, ['docs/d.md']).tests, ['test/joined.test.mjs']);
});

test('a chain test -> helper -> module is followed to the end', () => {
  const root = repo(FIXTURE);
  assert.deepEqual(related(root, ['src/b.mjs']).tests, ['test/chain.test.mjs']);
});

test('a directory reference covers every file in it; a directory named in prose does not', () => {
  const root = repo(FIXTURE);
  assert.deepEqual(related(root, ['agents/x.md']).tests, ['test/registry.test.mjs']);
  assert.ok(!related(root, ['src/a.mjs']).tests.includes('test/prose.test.mjs'), 'prose "src/" is not a read of src/');
});

test('a path named in a comment or in backticked prose is not a dependency', () => {
  const root = repo(FIXTURE);
  for (const f of ['src/a.mjs', 'ui/x.js', 'docs/d.md']) assert.ok(!related(root, [f]).tests.includes('test/commented.test.mjs'), f);
  assert.deepEqual(related(root, ['src/commented.mjs']).tests, ['test/commented.test.mjs']);
});

test('the runner, its config and the dependency set ask for the full suite', () => {
  const root = repo(FIXTURE);
  for (const f of ['package.json', 'npm-shrinkwrap.json', 'tools/test.mjs', 'tools/test-run.mjs', 'tools/test-related.mjs',
    'test/tiers.json', 'test/helpers/no-real-claude/claude', '.nvmrc']) {
    assert.ok(FULL_SUITE.some((re) => re.test(f)), f);
    const r = related(root, ['src/a.mjs', f]);
    assert.equal(r.full, true, f);
    assert.match(r.reason, new RegExp(f.replace(/[.]/g, '\\.')));
  }
});

test('a changed test selects itself; deleted or unknown files select nothing and do not throw', () => {
  const root = repo(FIXTURE);
  assert.deepEqual(related(root, ['test/prose.test.mjs']).tests, ['test/prose.test.mjs']);
  assert.deepEqual(related(root, ['test/gone.test.mjs', 'src/gone.mjs']), { full: false, tests: [] });
});

test('changedFiles: tracked changes against the base, plus untracked files', () => {
  const root = repo(FIXTURE);
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'src/a.mjs'), 'export const a = 2;\n');
  git('commit', '-q', '-am', 'two');
  writeFileSync(join(root, 'src/b.mjs'), 'export const b = 3;\n');
  writeFileSync(join(root, 'src/new.mjs'), 'export {};\n');
  assert.deepEqual(changedFiles(root), ['src/b.mjs', 'src/new.mjs']);
  assert.deepEqual(changedFiles(root, first), ['src/a.mjs', 'src/b.mjs', 'src/new.mjs']);
});
