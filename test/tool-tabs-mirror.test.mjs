// test/tool-tabs-mirror.test.mjs — the server's copy of the tool panel's tabs (issue 1064 slice 3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home, mirror, _resetForTests;
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-tabmirror-'));
  Object.assign(process.env, { WORCA_HOME: home, HOME: home, USERPROFILE: home });
  ({ _resetForTests } = await import('../src/core/db.mjs'));
  _resetForTests();
  const { createToolTabsMirror } = await import('../src/core/tool-tabs-mirror.mjs');
  let t = 1000;
  mirror = createToolTabsMirror({ now: () => (t += 1) });
});
after(() => { _resetForTests(); rmSync(home, { recursive: true, force: true }); });

const C = 'chat:ask_0000aaaa';
const ids = (list) => list.map((t) => t.id);

test('a page list replaces the scope; who opened a tab is the server\'s record, never the page\'s', () => {
  mirror.replace('', C, [{ id: 'tab_u1', kind: 'files' }, { id: 'tab_b1', kind: 'browser', url: 'http://localhost:4400/', openedBy: 'assistant' }]);
  assert.deepEqual(mirror.list('', C).map((t) => [t.id, t.openedBy, t.url, t.delivered]),
    [['tab_u1', 'user', null, true], ['tab_b1', 'user', 'http://localhost:4400/', true]]);
});

test('an assistant tab survives a page that never saw it, leaves once the page saw and closed it', () => {
  const a = mirror.add('', C, { kind: 'browser', url: 'http://localhost:4400/x' });
  assert.equal(a.delivered, false);
  mirror.replace('', C, [{ id: 'tab_u1', kind: 'files' }]);                      // a stale page: it has not taken the tab in
  assert.deepEqual(ids(mirror.list('', C)), ['tab_u1', a.id]);
  mirror.replace('', C, [{ id: 'tab_u1', kind: 'files' }, { id: a.id, kind: 'browser', url: 'http://localhost:4400/x' }]);
  const got = mirror.list('', C).find((t) => t.id === a.id);
  assert.deepEqual([got.openedBy, got.delivered], ['assistant', true], 'taken in: delivered, still marked as the assistant\'s');
  mirror.replace('', C, [{ id: 'tab_u1', kind: 'files' }], { seen: [a.id] });  // closed in the page
  assert.deepEqual(ids(mirror.list('', C)), ['tab_u1']);
  // `seen` on its own: a page took an undelivered tab in and closed it before any PUT listed it.
  const b = mirror.add('', C, { kind: 'files' });
  mirror.replace('', C, [{ id: 'tab_u1', kind: 'files' }]);
  assert.deepEqual(ids(mirror.list('', C)), ['tab_u1', b.id], 'not seen: kept');
  mirror.replace('', C, [{ id: 'tab_u1', kind: 'files' }], { seen: [b.id] });
  assert.deepEqual(ids(mirror.list('', C)), ['tab_u1'], 'seen and gone from the list: closed');
});

test('owners, caps and bad input', async () => {
  const { TAB_MIRROR_LIMITS } = await import('../src/core/tool-tabs-mirror.mjs');
  mirror.replace('alice@x', 'project:app-1', [{ id: 'tab_p1', kind: 'files' }]);
  assert.deepEqual(mirror.list('bob@x', 'project:app-1'), [], 'one person\'s project tabs are not another\'s');
  for (let i = 0; i < TAB_MIRROR_LIMITS.pendingPerChat; i += 1) mirror.add('', 'chat:ask_0000bbbb', { kind: 'files' });
  assert.throws(() => mirror.add('', 'chat:ask_0000bbbb', { kind: 'files' }), { code: 'PENDING' });
  assert.throws(() => mirror.replace('', 'run:abc', []), { code: 'BAD_SCOPE' });
  mirror.replace('', 'chat:ask_0000cccc', [{ id: 'nope', kind: 'files' }, { id: 'tab_x', kind: 'browser', url: 'javascript:alert(1)' }]);
  assert.deepEqual(mirror.list('', 'chat:ask_0000cccc').map((t) => [t.id, t.url]), [['tab_x', null]]);
  mirror.dropScope('chat:ask_0000bbbb');
  assert.deepEqual(mirror.list('', 'chat:ask_0000bbbb'), []);
});

test('a Files tab keeps its target; a bad one is dropped; a Browser tab never has one', () => {
  const m = mirror;   // the file's mirror from before() (createToolTabsMirror is imported inside before(), not in scope here)
  const S = 'chat:ask_0000c0de';
  m.replace('', S, [
    { id: 'tab_f1', kind: 'files', target: { path: 'src/a.js', line: 3, endLine: 9, root: 'run:abcd1234' }, at: 1 },
    { id: 'tab_f2', kind: 'files', target: { path: '../x' }, at: 2 },
    { id: 'tab_b1', kind: 'browser', url: 'https://example.org/', target: { path: 'a.js' }, at: 3 },
  ]);
  assert.deepEqual(m.list('', S).map((t) => [t.id, t.target]), [['tab_f1', { path: 'src/a.js', line: 3, endLine: 9, root: 'run:abcd1234' }], ['tab_f2', null], ['tab_b1', null]]);
  m.setTarget('', S, 'tab_f1', { path: 'src/a.js', line: 7 });
  assert.deepEqual(m.list('', S)[0].target, { path: 'src/a.js', line: 7 });
  const added = m.add('', S, { kind: 'files', target: { path: 'src', dir: true, line: 4 } });
  assert.deepEqual(added.target, { path: 'src', dir: true });
});

test('extra: an undelivered tab keeps its target through a stale page; a bad root or member is dropped', () => {
  const S = 'chat:ask_0000c0df';
  const a = mirror.add('', S, { kind: 'files', target: { path: 'src/a.js', line: 2, root: 'run:zz', member: '../x' } });
  assert.deepEqual(a.target, { path: 'src/a.js', line: 2 });
  mirror.replace('', S, []);
  assert.deepEqual(mirror.list('', S).find((t) => t.id === a.id).target, { path: 'src/a.js', line: 2 });
});

test('root out kept; a junk root dropped', () => {
  const S = 'chat:ask_0000c0e0';
  const a = mirror.add('', S, { kind: 'files', target: { path: 'report.md', root: 'out' } });
  assert.deepEqual(a.target, { path: 'report.md', root: 'out' });
  for (const root of ['out/x', 'outs', 'run:abcd1234x']) {
    const b = mirror.add('', S, { kind: 'files', target: { path: 'a.md', root } });
    assert.deepEqual(b.target, { path: 'a.md' }, root);
  }
});
