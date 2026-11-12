// T-replay-tree: E7's replay tree (plan §4.11): positional hunk apply, hunk-to-call assignment, tool inputs, blob ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyCall, assignHunks, toolInputFor, gitBlobId, parsePatch, seedTree, checkFinal } from '../lib/replay-tree.mjs';

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const BASE = 'a\nb\nc\nd\ne\nf\ng\n';

test('positional apply with an offset: later hunks land after earlier ones grew the file', () => {
  const h1 = { oldStart: 2, oldCount: 1, lines: ['-b', '+b1', '+b2'] };
  const h2 = { oldStart: 5, oldCount: 2, lines: [' e', '-f', '+F'] };
  const r1 = applyCall(BASE, [h1], 0);
  assert.deepEqual([r1.text, r1.offset, r1.ok, r1.unapplied], ['a\nb1\nb2\nc\nd\ne\nf\ng\n', 1, true, 0]);
  const r2 = applyCall(r1.text, [h2], r1.offset);
  assert.deepEqual([r2.text, r2.offset, r2.ok], ['a\nb1\nb2\nc\nd\ne\nF\ng\n', 1, true]);
});

test('a mismatching hunk → unapplied 1 and the text unchanged; it is not searched for elsewhere', () => {
  const r = applyCall(BASE, [{ oldStart: 2, oldCount: 1, lines: ['-c', '+C'] }], 0);
  assert.deepEqual([r.text, r.offset, r.ok, r.unapplied], [BASE, 0, false, 1]);
});

test('a missing trailing newline is kept exactly', () => {
  const r = applyCall('x\ny', [{ oldStart: 2, oldCount: 1, lines: ['-y', '\\ No newline at end of file', '+y', '+z'] }], 0);
  assert.equal(r.text, 'x\ny\nz\n');
  const back = applyCall('x\ny\n', [{ oldStart: 2, oldCount: 1, lines: ['-y', '+y2', '\\ No newline at end of file'] }], 0);
  assert.equal(back.text, 'x\ny2');
});

const fixture = (calls, files) => ({ v: 2, phases: [{ ordinal: 1, tasks: [{ id: 'p1t1', files: [] }] }], calls, files, review: { cycles: [] } });
const call = (t, path, tool = 'Edit', task = 'p1t1', phase = 1) => ({ t, task, phase, tool, path });

test('leftover hunks join the last call; extra calls are counted contentless; fix and Bash calls are not armed', () => {
  const hunks = [1, 2, 3].map((i) => ({ oldStart: i, oldCount: 1, lines: [`-l${i}`, `+L${i}`] }));
  const fx = fixture(
    [call(0, 'a.mjs'), call(1, 'b.mjs'), call(2, 'a.mjs', 'Write'), { t: 3, task: 'p1t1', phase: 1, tool: 'Bash', cmd0: 'npm' }, call(4, 'a.mjs', 'Edit', 'fix', 'fix'), call(5, 'b.mjs')],
    [{ path: 'a.mjs', status: 'modified', baseBlob: 'x', finalBlob: 'y', hunks }, { path: 'b.mjs', status: 'modified', baseBlob: 'x', finalBlob: 'y', hunks: [hunks[0]] }],
  );
  const m = assignHunks(fx);
  assert.deepEqual(m.get(0).hunks, [hunks[0]]);
  assert.deepEqual(m.get(2).hunks, [hunks[1], hunks[2]]);
  assert.deepEqual(m.get(1).hunks, [hunks[0]]);
  assert.deepEqual(m.get(5).hunks, []);
  assert.equal(m.get(5).contentless, true);
  assert.equal(m.has(3), false);
  assert.equal(m.has(4), false);
});

test('a created file split into chunks reproduces the final text; the first call is a Write', () => {
  const final = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const hunk = { oldStart: 0, oldCount: 0, lines: final.trimEnd().split('\n').map((l) => `+${l}`) };
  const fx = fixture([call(0, 'n.mjs', 'Edit'), call(1, 'n.mjs'), call(2, 'n.mjs')], [{ path: 'n.mjs', status: 'created', baseBlob: null, finalBlob: gitBlobId(final).slice(0, 9), hunks: [hunk] }]);
  const m = assignHunks(fx);
  assert.equal(m.get(0).tool, 'Write');
  let text = '';
  let offset = 0;
  for (const i of [0, 1, 2]) ({ text, offset } = applyCall(text, m.get(i).hunks, offset));
  assert.equal(text, final);
  assert.ok(gitBlobId(text).startsWith(fx.files[0].finalBlob));
});

test('toolInputFor: a Write carries the whole text; an Edit region expands until unique, else counts nonUnique', () => {
  assert.deepEqual(toolInputFor('Write', 'a\n', 'b\n'), { content: 'b\n' });
  const before = 'x\nsame\ny\nsame\nz\n';
  const after = 'x\nsame\ny\nsame\nZ\n';
  const e = toolInputFor('Edit', before, after);
  assert.equal(before.split(e.old_string).length - 1, 1);
  assert.equal(before.replace(e.old_string, e.new_string), after);
  const rep = 'k\n'.repeat(30);
  const stats = { nonUnique: 0 };
  const amb = toolInputFor('Edit', `${rep}k\n${rep}`, `${rep}k\nk\n${rep}`, stats);
  assert.equal(stats.nonUnique, 1);
  assert.equal(typeof amb.old_string, 'string');
  const unchanged = toolInputFor('Edit', 'p\nq\n', 'p\nq\n');
  assert.equal(unchanged.old_string, unchanged.new_string);
});

test('gitBlobId equals git hash-object', () => {
  const d = mkdtempSync(join(tmpdir(), 'bus-blob-'));
  dirs.push(d);
  const text = 'export const é = "ü";\n';
  writeFileSync(join(d, 'f'), text);
  assert.equal(gitBlobId(text), execFileSync('git', ['hash-object', join(d, 'f')], { encoding: 'utf8' }).trim());
});

test('parsePatch reads statuses, blob ids and hunks', () => {
  const patch = [
    'diff --git a/m.mjs b/m.mjs', 'index 1111111..2222222 100644', '--- a/m.mjs', '+++ b/m.mjs', '@@ -1,2 +1,2 @@ ctx', ' a', '-b', '+B',
    'diff --git a/n.mjs b/n.mjs', 'new file mode 100644', 'index 0000000..3333333', '--- /dev/null', '+++ b/n.mjs', '@@ -0,0 +1 @@', '+n', '',
  ].join('\n');
  assert.deepEqual(parsePatch(patch), [
    { path: 'm.mjs', status: 'modified', baseBlob: '1111111', finalBlob: '2222222', hunks: [{ oldStart: 1, oldCount: 2, lines: [' a', '-b', '+B'] }] },
    { path: 'n.mjs', status: 'created', baseBlob: null, finalBlob: '3333333', hunks: [{ oldStart: 0, oldCount: 0, lines: ['+n'] }] },
  ]);
});

test('seedTree commits every modified base and reports a missing blob', () => {
  const d = mkdtempSync(join(tmpdir(), 'bus-seed-'));
  dirs.push(d);
  const fx = fixture([], [
    { path: 'src/m.mjs', status: 'modified', baseBlob: 'aaa', finalBlob: 'x', hunks: [] },
    { path: 'gone.mjs', status: 'modified', baseBlob: 'bbb', finalBlob: 'x', hunks: [] },
    { path: 'new.mjs', status: 'created', baseBlob: null, finalBlob: 'x', hunks: [] },
  ]);
  const r = seedTree(d, fx, (id) => (id === 'aaa' ? 'base\n' : null));
  assert.deepEqual(r, { seeded: ['src/m.mjs'], baseMissing: ['gone.mjs'] });
  assert.equal(execFileSync('git', ['-C', d, 'show', 'HEAD:src/m.mjs'], { encoding: 'utf8' }), 'base\n');
});

test('checkFinal: a replayed text that is not the final blob is a mismatch (a corrupted fixture is caught)', () => {
  const texts = { 'a.mjs': 'export const a = 1;\n', 'b.mjs': 'export const b = 2;\n' };
  const files = new Map(Object.entries(texts).map(([path, t]) => [path, { path, finalBlob: gitBlobId(t).slice(0, 9) }]));
  const read = (p) => texts[p] ?? null;
  assert.deepEqual(checkFinal(['a.mjs', 'b.mjs'], files, read), []);
  // a wrong finalBlob, a hunk that left other text, and a deleted file's leftover each count
  const wrong = new Map([...files, ['b.mjs', { path: 'b.mjs', finalBlob: 'deadbeef0' }]]);
  assert.deepEqual(checkFinal(['a.mjs', 'b.mjs'], wrong, read), ['b.mjs']);
  assert.deepEqual(checkFinal(['a.mjs', 'b.mjs'], files, (p) => (p === 'a.mjs' ? 'export const a = 9;\n' : texts[p])), ['a.mjs']);
  assert.deepEqual(checkFinal(['a.mjs'], files, () => null), ['a.mjs']);
  // a missing text equals the empty blob only
  assert.deepEqual(checkFinal(['e.mjs'], new Map([['e.mjs', { path: 'e.mjs', finalBlob: gitBlobId('').slice(0, 9) }]]), () => null), []);
  assert.deepEqual(checkFinal(['d.mjs'], new Map([['d.mjs', { path: 'd.mjs', finalBlob: null }]]), () => 'left over\n'), ['d.mjs']);
});
