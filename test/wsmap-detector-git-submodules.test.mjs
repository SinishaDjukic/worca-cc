import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/git-submodules.mjs';
import { resolveRelativeRemote } from '../src/core/workspace-map/detectors/lib/git-remote.mjs';
import { remoteSlug } from '../src/shared/workspace-map/keys.mjs';

test('remoteSlug (P1, the origin alias extract adds) folds every .gitmodules URL form to one slug; local → null', () => {
  const same = ['https://github.com/Acme/Billing.git', 'git@github.com:acme/billing.git', 'ssh://git@github.com:22/acme/billing', 'git+ssh://git@GitHub.com/acme/billing/', 'https://user:tok@github.com/acme/billing', 'http://github.com//acme/billing.git'];
  for (const u of same) assert.equal(remoteSlug(u), 'github.com/acme/billing', u);
  assert.equal(remoteSlug('git@gitlab.acme.io:platform/libs/money.git'), 'gitlab.acme.io/platform/libs/money');
  for (const u of ['file:///srv/repos/billing.git', '/srv/repos/billing', '../billing', 'C:\\repos\\billing', 'C:/repos/billing', '', null, 'https://github.com']) assert.equal(remoteSlug(u), null, String(u));
});

test('resolveRelativeRemote: git semantics against the superproject remote', () => {
  assert.equal(resolveRelativeRemote('github.com/acme/web', '../billing.git'), 'github.com/acme/billing');
  assert.equal(resolveRelativeRemote('github.com/acme/web', './vendor/x'), 'github.com/acme/web/vendor/x');
  assert.equal(resolveRelativeRemote('github.com/acme/web', '../../../x'), null);
  const t0 = performance.now();
  assert.equal(resolveRelativeRemote('github.com/acme/web', `../${'/'.repeat(1 << 20)}x`), 'github.com/acme/x', 'a 1 MiB slash run');
  assert.ok(performance.now() - t0 < 2000, 'trailing / runs are trimmed with a loop, not /\\/+$/ (quadratic)');
});

const GITMODULES = `[submodule "libs/billing"]
\tpath = libs/billing
\turl = git@github.com:acme/billing.git
[submodule "libs/money"]
\tpath = libs/money
\turl = ../money.git
; a comment
[submodule "local"]
\tpath = local
\turl = /srv/git/local.git
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    web: { '.gitmodules': GITMODULES },
    billing: { 'README.md': '# billing\n' },
    orphan: { '.gitmodules': '[submodule "m"]\r\n\tpath = m\r\n\turl = ../m.git\r\n' },
    mixed: { '.gitmodules': '[submodule "b"]\n\tpath = b\n\turl = https://GitHub.com//Acme/Billing.git\n' },
  }, { remotes: { web: 'https://github.com/acme/web.git', billing: 'git@github.com:Acme/Billing.git' } });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('git-submodules: consumes pkg git:<slug> per submodule (target = the slug), relative URLs via origin', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), ['git:github.com/acme/billing', 'git:github.com/acme/money']);
  const b = r.facts.find((f) => f.key === 'git:github.com/acme/billing');
  assert.deepEqual([b.target, b.line, b.match, b.detail, b.norm], ['github.com/acme/billing', 3, 'git@github.com:acme/billing.git', 'git submodule libs/billing', 'pkg:git:github.com/acme/billing']);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason]), [['/srv/git/local.git', 'not a network git remote']]);
  assertEvidence(member('web'), r);
});

test('git-submodules: no alias of its own (extract adds the origin slug); absolute URLs need no origin', async () => {
  const billing = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual([billing.aliases, billing.facts], [[], []]);
});

test('git-submodules: a relative URL in a member dir that is not a git repo (or no git binary) → unresolved, no alias, no throw', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-nogit-'));
  try {
    const m = { key: 'plain', name: 'plain', dir, projectDir: dir };
    const state = { subs: [{ name: 'm', url: '../m.git', urlLine: 3, rel: '.gitmodules', lines: [] }] };
    assert.deepEqual(detector.finish({ member: m, members: [m], files: ['.gitmodules'], state }),
      { facts: [], aliases: [], unresolved: [{ kind: 'pkg', raw: '../m.git', file: '.gitmodules', line: 3, reason: 'relative submodule url without origin' }] });
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 3 }); }
});

test('git-submodules: the detector folds a URL with P1 remoteSlug (case, doubled /), and runs git only for a relative URL', async () => {
  const r = await runDetector(detector, member('mixed'), ws.members);
  assert.deepEqual(r.facts.map((f) => [f.key, f.target]), [['git:github.com/acme/billing', 'github.com/acme/billing']]);
  const reads = [];
  const m = new Proxy({ key: 'mixed', name: 'mixed', dir: member('mixed').dir, projectDir: member('mixed').dir }, { get: (o, k) => { reads.push(k); return o[k]; } });
  const ctx = { member: m, members: [m], files: ['.gitmodules'], state: {} };
  detector.detect({ rel: '.gitmodules', text: '[submodule "b"]\n\turl = git@github.com:acme/billing.git\n' }, ctx);
  detector.finish(ctx);
  assert.ok(!reads.includes('dir'), 'absolute URLs need no origin: git never runs');
});

test('git-submodules: git never borrows an origin — not from an enclosing repo, not from an inherited GIT_DIR', async () => {
  const { mkdir, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const relative = () => ({ subs: [{ name: 'm', url: '../m.git', urlLine: 3, rel: '.gitmodules', lines: [] }] });
  const call = (dir) => detector.finish({ member: { key: 'plain', name: 'plain', dir, projectDir: dir }, members: [], files: ['.gitmodules'], state: relative() });
  const inner = join(member('web').dir, 'vendored-plain'); // a plain dir inside web's checkout (web has an origin)
  await mkdir(inner, { recursive: true });
  assert.deepEqual(call(inner).unresolved.map((u) => u.reason), ['relative submodule url without origin'], 'GIT_CEILING_DIRECTORIES: never the enclosing repo\'s origin');
  const outside = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-nogit-'));
  const prev = process.env.GIT_DIR;
  process.env.GIT_DIR = join(member('web').dir, '.git');
  try {
    assert.deepEqual(call(outside).unresolved.map((u) => u.reason), ['relative submodule url without origin'], 'an inherited GIT_DIR is dropped');
  } finally {
    if (prev === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = prev;
    await rm(outside, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('git-submodules: no origin → no alias, relative URL unresolved (CRLF file)', async () => {
  const r = await runDetector(detector, member('orphan'), ws.members);
  assert.deepEqual(r.aliases, []);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason, u.line]), [['../m.git', 'relative submodule url without origin', 3]]);
});
