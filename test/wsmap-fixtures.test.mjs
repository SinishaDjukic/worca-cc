import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';

const ws = await makeWorkspace({
  zeta: { 'a/one.txt': 'alpha\r\nneedle here\r\n', 'b.md': 'x' },
  alpha: { 'src/test/t.txt': 'needle\n' },
}, { remotes: { zeta: 'https://github.com/acme/zeta.git' } });
after(() => ws.cleanup());

// A detector that records what the harness hands it.
const seen = { detect: [], finish: 0, states: new Set() };
const probe = Object.freeze({
  id: 'probe',
  claims: (rel) => rel.endsWith('.txt'),
  detect({ rel, text }, ctx) {
    seen.detect.push(rel);
    seen.states.add(ctx.state);
    ctx.state.n = (ctx.state.n || 0) + 1;
    const lines = text.split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes('needle'));
    return { facts: [{ kind: 'other', dir: 'provides', key: `n ${rel}`, file: rel, line: i + 1, match: 'needle', label: 'probe' }], stack: ['probe'] };
  },
  finish(ctx) { seen.finish += 1; return { aliases: [{ value: `count-${ctx.state.n}`, source: 'probe' }], role: { text: 'r', source: 'readme' } }; },
});

test('makeWorkspace: one committed git repo per member, members sorted by key, dir = projectDir, origin remote', () => {
  assert.deepEqual(ws.members.map((m) => m.key), ['alpha', 'zeta']);
  for (const m of ws.members) {
    assert.equal(m.dir, m.projectDir);
    assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: m.dir, encoding: 'utf8' }).stdout, '', 'everything committed');
  }
  const zeta = ws.members[1];
  assert.equal(spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: zeta.dir, encoding: 'utf8' }).stdout.trim(), 'https://github.com/acme/zeta.git');
  assert.ok(existsSync(join(zeta.dir, 'a', 'one.txt')));
});

test('runDetector: claimed files only, one fresh state per run, finish once, norm + test stamped, alias member defaulted', async () => {
  const zeta = ws.members[1];
  const r = await runDetector(probe, zeta, ws.members);
  assert.deepEqual(seen.detect, ['a/one.txt']);
  assert.equal(seen.finish, 1);
  assert.deepEqual(r.aliases, [{ value: 'count-1', source: 'probe', member: 'zeta' }]);
  assert.deepEqual(r.stack, ['probe']);
  assert.deepEqual(r.role, { text: 'r', source: 'readme' });
  assert.deepEqual(keysOf(r, 'other', 'provides'), ['n a/one.txt']);
  assert.equal(r.facts[0].norm, 'other:n a/one.txt');
  assert.equal(r.facts[0].test, false);
  assertEvidence(zeta, r);
  const alpha = await runDetector(probe, ws.members[0], ws.members);
  assert.equal(alpha.facts[0].test, true, 'src/test/… is a test path');
  assert.equal(seen.states.size, 2, 'a fresh ctx.state per (detector, member)');
});

test('assertEvidence: a match that is not on its cited line fails', async () => {
  const zeta = ws.members[1];
  const r = await runDetector(probe, zeta, ws.members);
  r.facts[0].line = 1;
  assert.throws(() => assertEvidence(zeta, r), /not on line/);
});
