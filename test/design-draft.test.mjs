// test/design-draft.test.mjs — the draft store: tool input turned into text splices, path helpers, layer count (P2 Task 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, classifyDraftPath, toWorkRel, countLayers } from '../src/core/design/draft.mjs';

const P = 'sections/hero/index.html';
const setup = (disk = {}, opts = {}) => {
  const out = []; let timers = [];
  const s = createDraftStore({ onSplice: (x) => out.push(x), readDisk: (p) => disk[p] ?? null,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => { timers = []; }, ...opts });
  return { s, out, fire: () => { const t = timers; timers = []; for (const f of t) f(); } };
};
const write = (s, id = 't1', path = P) => s.startTool({ toolUseId: id, agentId: 'a', name: 'Write', path });

test('Write: chunks inside one window make one frame, splice at end', () => {
  const { s, out, fire } = setup(); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: '<h1>', done: false });
  s.field({ toolUseId: 't1', field: 'content', chunk: 'Ship', done: false });
  assert.equal(out.length, 0); fire();
  assert.deepEqual(out, [{ agentId: 'a', path: P, rev: 1, splice: { at: 0, del: 0, text: '<h1>Ship' } }]);
  s.field({ toolUseId: 't1', field: 'content', chunk: '</h1>', done: true });
  assert.deepEqual(out[1], { agentId: 'a', path: P, rev: 2, splice: { at: 8, del: 0, text: '</h1>' } });
});
test('4 KiB flushes at once; a 20 KiB burst splits to at most 16 KiB with no split character', () => {
  const { s, out } = setup(); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: 'x'.repeat(4096), done: false });
  assert.equal(out.length, 1);
  s.field({ toolUseId: 't1', field: 'content', chunk: '😀'.repeat(5000), done: true });
  assert.ok(out.every((f) => Buffer.byteLength(f.splice.text) <= 16384));
  assert.equal(out.map((f) => f.splice.text).join(''), 'x'.repeat(4096) + '😀'.repeat(5000));
  assert.ok(!out.some((f) => /[\ud800-\udbff]$/.test(f.splice.text)));
  assert.deepEqual(out.map((f) => f.rev), out.map((_, i) => i + 1));
});
test('Write over an existing draft deletes first, then appends from 0', () => {
  const { s, out } = setup({ [P]: 'old' }); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: 'new', done: true });
  assert.deepEqual(out.map((f) => f.splice), [{ at: 0, del: 3, text: '' }, { at: 0, del: 0, text: 'new' }]);
});
test('a new Write sends the pending text of the previous one first, so its delete covers it', () => {
  const { s, out } = setup(); write(s, 't1');
  s.field({ toolUseId: 't1', field: 'content', chunk: 'abc', done: false });
  assert.equal(out.length, 0, 'held by the window');
  write(s, 't2');
  s.field({ toolUseId: 't2', field: 'content', chunk: 'X', done: true });
  let text = '';
  for (const { splice: { at, del, text: t } } of out) text = text.slice(0, at) + t + text.slice(at + del);
  assert.equal(text, 'X');
  assert.deepEqual(out.map((f) => f.splice), [{ at: 0, del: 0, text: 'abc' }, { at: 0, del: 3, text: '' }, { at: 0, del: 0, text: 'X' }]);
});
test('Edit: one deleting splice at the index, then appends, in either field order', () => {
  for (const order of [['old_string', 'new_string'], ['new_string', 'old_string']]) {
    const { s, out } = setup({ [P]: '<p>aa</p>' });
    s.startTool({ toolUseId: 't', agentId: 'a', name: 'Edit', path: P });
    const v = { old_string: 'aa', new_string: 'bb' };
    for (const f of order) s.field({ toolUseId: 't', field: f, chunk: v[f], done: false });
    for (const f of order) s.field({ toolUseId: 't', field: f, chunk: '', done: true });
    assert.deepEqual(out.map((x) => x.splice), [{ at: 3, del: 2, text: '' }, { at: 3, del: 0, text: 'bb' }]);
  }
});
test('Edit whose old_string is not in the draft waits for the disk', () => {
  const { s, out } = setup({ [P]: '<p>aa</p>' });
  s.startTool({ toolUseId: 't', agentId: 'a', name: 'Edit', path: P });
  s.field({ toolUseId: 't', field: 'old_string', chunk: 'zz', done: true });
  s.field({ toolUseId: 't', field: 'new_string', chunk: 'bb', done: true });
  assert.deepEqual(out, []);
  assert.equal(s.landed(P, '<p>bb</p>'), 1);
  assert.deepEqual(s.snapshot(), [{ path: P, rev: 1, text: '<p>bb</p>' }]);
});
test('landed drops pending text, bumps rev, and a settled tool writes no more', () => {
  const { s, out, fire } = setup(); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: 'half', done: false });
  assert.equal(s.landed(P, ''), 1);
  fire();
  s.field({ toolUseId: 't1', field: 'content', chunk: 'more', done: true });
  assert.deepEqual(out, []);
  assert.deepEqual(s.snapshot(), [{ path: P, rev: 1, text: '' }]);
});
test('snapshot during a pending batch never doubles text', () => {
  const { s, out } = setup(); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: 'abc', done: false });
  const [snap] = s.snapshot();
  assert.deepEqual(snap, { path: P, rev: 1, text: 'abc' });
  s.field({ toolUseId: 't1', field: 'content', chunk: 'def', done: true });
  assert.deepEqual(out.at(-1), { agentId: 'a', path: P, rev: 2, splice: { at: 3, del: 0, text: 'def' } });
});
test('revBase starts a path above it', () => {
  const { s } = setup({}, { revBase: 1000 });
  assert.equal(s.landed(P, 'x'), 1001);
});
test('landFirst: a path\'s first use lands its disk text before any splice, empty when missing', () => {
  const seen = [];
  const { s, out } = setup({ [P]: '<p>a</p>' }, { revBase: 1000, landFirst: true, onLand: (x) => seen.push(x) });
  s.startTool({ toolUseId: 't', agentId: 'a', name: 'Edit', path: P });
  write(s, 'u', 'sections/hero/style.css');
  assert.deepEqual(seen, [{ path: P, rev: 1001, text: '<p>a</p>' }, { path: 'sections/hero/style.css', rev: 1001, text: '' }]);
  s.field({ toolUseId: 'u', field: 'content', chunk: 'x', done: true });
  assert.deepEqual(out.map((f) => [f.path, f.rev]), [['sections/hero/style.css', 1002]]);
});
test('applyWhole is level 2: applies once, and never after a streamed tool', () => {
  const { s, out } = setup();
  s.applyWhole({ toolUseId: 'w', agentId: 'a', name: 'Write', path: P, input: { content: 'abc' } });
  assert.deepEqual(out.map((f) => f.splice), [{ at: 0, del: 0, text: 'abc' }]);
  write(s, 't2'); assert.equal(s.hasTool('t2'), true);
  s.applyWhole({ toolUseId: 't2', agentId: 'a', name: 'Write', path: P, input: { content: 'zzz' } });
  assert.equal(out.length, 2, 'the delete for the Write over an existing draft, nothing from applyWhole');
});
test('classifyDraftPath', () => {
  const rows = [['sections/hero/index.html', { sectionId: 'hero', part: 'html' }], ['sections/hero/style.css', { sectionId: 'hero', part: 'css' }], ['sections/hero/script.js', { sectionId: 'hero', part: 'js' }],
    ['tokens.css', { sectionId: null, part: 'css' }], ['global.css', { sectionId: null, part: 'css' }], ['global.js', null], ['shell.html', null],
    ['plan.json', null], ['.asks/a.json', null], ['.kit/x.css', null], ['sections/hero/assets/a.css', null], ['sections/Hero/index.html', null], ['sections/hero/other.html', null]];
  for (const [rel, want] of rows) assert.deepEqual(classifyDraftPath(rel), want, rel);
});
test('toWorkRel: POSIX, the macOS alias, relative to cwd, Windows forms, escapes', () => {
  const w = { workDir: '/var/h/design/d/work', realWorkDir: '/private/var/h/design/d/work', cwd: '/var/h/design/d/work/sections/hero', platform: 'linux' };
  assert.equal(toWorkRel('/var/h/design/d/work/tokens.css', w), 'tokens.css');
  assert.equal(toWorkRel('/private/var/h/design/d/work/tokens.css', w), 'tokens.css');
  assert.equal(toWorkRel('index.html', w), 'sections/hero/index.html');
  assert.equal(toWorkRel('../../tokens.css', w), 'tokens.css');
  assert.equal(toWorkRel('/var/h/design/d/work/../other', w), null);
  assert.equal(toWorkRel('/etc/passwd', w), null);
  const win = { workDir: 'C:\\h\\design\\d\\work', realWorkDir: 'C:\\h\\design\\d\\work', cwd: 'C:\\h\\design\\d\\work', platform: 'win32' };
  assert.equal(toWorkRel('c:\\H\\design\\d\\WORK\\sections\\hero\\index.html', win), 'sections/hero/index.html');
  assert.equal(toWorkRel('/c/h/design/d/work/tokens.css', win), 'tokens.css');
  assert.equal(toWorkRel('D:\\x', win), null);
  assert.equal(toWorkRel('/var/h/design/d/work_sections/hero/index.html', w), null, 'a sibling folder whose name starts like work');
  assert.equal(toWorkRel('/private/var/h/design/d/workx/tokens.css', w), null);
  assert.equal(toWorkRel('c:\\h\\design\\d\\work2\\tokens.css', win), null);
});
test('countLayers counts start tags, not comments or closing tags', () => {
  assert.equal(countLayers('<section data-section="x"><h1>a</h1><!-- <p> --><br/></section>'), 3);
});

// Rows beyond the plan's list: the guards the store adds so a draft never corrupts.
test('untracked paths make no draft, read no disk and land nothing', () => {
  const reads = [];
  const { s, out } = setup({}, { readDisk: (p) => { reads.push(p); return 'disk'; } });
  for (const path of ['shell.html', 'global.js', 'plan.json', null]) {
    s.startTool({ toolUseId: `t-${path}`, agentId: 'a', name: 'Write', path });
    s.field({ toolUseId: `t-${path}`, field: 'content', chunk: 'x', done: true });
    s.applyWhole({ toolUseId: `w-${path}`, agentId: 'a', name: 'Write', path, input: { content: 'x' } });
    assert.equal(s.landed(path, 'x'), null, String(path));
  }
  assert.deepEqual([out, reads, s.snapshot()], [[], [], []]);
});
test('a deleting splice flushes the pending append first; an empty old_string locates only in an empty draft', () => {
  const { s, out } = setup(); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: 'abc', done: false });
  s.startTool({ toolUseId: 'e', agentId: 'a', name: 'Edit', path: P });
  s.field({ toolUseId: 'e', field: 'old_string', chunk: 'b', done: true });
  s.field({ toolUseId: 'e', field: 'new_string', chunk: 'B', done: true });
  assert.deepEqual(out.map((f) => [f.rev, f.splice]), [[1, { at: 0, del: 0, text: 'abc' }], [2, { at: 1, del: 1, text: '' }], [3, { at: 1, del: 0, text: 'B' }]]);
  s.applyWhole({ toolUseId: 'e2', agentId: 'a', name: 'Edit', path: P, input: { old_string: '', new_string: 'X' } });
  assert.equal(out.length, 3, 'an empty old_string on a non-empty draft waits for the disk');
  const css = 'sections/hero/style.css';
  s.applyWhole({ toolUseId: 'e3', agentId: 'a', name: 'Edit', path: css, input: { old_string: '', new_string: 'a{}' } });
  assert.deepEqual(out.at(-1), { agentId: 'a', path: css, rev: 1, splice: { at: 0, del: 0, text: 'a{}' } });
});
test('a timer or 4 KiB flush never ends a frame on half a character; done sends the rest', () => {
  const HI = String.fromCharCode(0xd83d); const LO = String.fromCharCode(0xde00);
  const { s, out, fire } = setup(); write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: `a${HI}`, done: false });
  fire();
  s.field({ toolUseId: 't1', field: 'content', chunk: `${LO}b`, done: false });
  fire();
  s.field({ toolUseId: 't1', field: 'content', chunk: `c${HI}`, done: true });
  assert.deepEqual(out.map((f) => f.splice), [{ at: 0, del: 0, text: 'a' }, { at: 1, del: 0, text: `${HI}${LO}b` }, { at: 4, del: 0, text: `c${HI}` }]);
  const big = setup(); write(big.s);
  big.s.field({ toolUseId: 't1', field: 'content', chunk: `${'x'.repeat(4095)}${HI}`, done: false });
  big.s.field({ toolUseId: 't1', field: 'content', chunk: LO, done: true });
  assert.deepEqual(big.out.map((f) => f.splice), [{ at: 0, del: 0, text: 'x'.repeat(4095) }, { at: 4095, del: 0, text: `${HI}${LO}` }], 'the 4 KiB flush holds the high half back');
});
test('toWorkRel refuses an absolute .. step even inside work, and a relative path with no cwd; case folds on win32 only', () => {
  const w = { workDir: '/var/h/design/d/work', realWorkDir: '/private/var/h/design/d/work', cwd: '/var/h/design/d/work', platform: 'linux' };
  assert.equal(toWorkRel('/var/h/design/d/work/sections/../tokens.css', w), null);
  assert.equal(toWorkRel('/var/h/design/d/work', w), null);
  assert.equal(toWorkRel('tokens.css', { ...w, cwd: undefined }), null);
  assert.equal(toWorkRel('/var/h/design/d/WORK/tokens.css', w), null);
  assert.equal(toWorkRel('/var/h/design/d/work/sections/hero/Index.html', w), 'sections/hero/Index.html');
});
test('a throwing listener or disk reader never breaks the store', () => {
  let calls = 0;
  const { s } = setup({}, { readDisk: () => { throw new Error('EACCES'); }, onSplice: () => { calls += 1; throw new Error('closed socket'); } });
  write(s);
  s.field({ toolUseId: 't1', field: 'content', chunk: 'ab', done: true });
  s.startTool({ toolUseId: 'e', agentId: 'a', name: 'Edit', path: P });
  s.field({ toolUseId: 'e', field: 'old_string', chunk: 'b', done: true });
  s.field({ toolUseId: 'e', field: 'new_string', chunk: 'c', done: true });
  assert.equal(calls, 3);
  assert.deepEqual(s.snapshot(), [{ path: P, rev: 3, text: 'ac' }]);
});
test('only contiguous appends of one agent merge; flush(path) sends the batch', () => {
  const { s, out } = setup();
  write(s, 't1'); write(s, 't3'); s.startTool({ toolUseId: 't2', agentId: 'b', name: 'Write', path: P });
  s.field({ toolUseId: 't1', field: 'content', chunk: 'x', done: false });
  s.field({ toolUseId: 't3', field: 'content', chunk: 'q', done: false });
  s.field({ toolUseId: 't2', field: 'content', chunk: 'y', done: false });
  s.field({ toolUseId: 't1', field: 'content', chunk: 'z', done: false });
  assert.equal(out.length, 3);
  s.flush(P);
  assert.deepEqual(out.map((f) => [f.agentId, f.rev, f.splice]), [['a', 1, { at: 0, del: 0, text: 'x' }], ['a', 2, { at: 0, del: 0, text: 'q' }],
    ['b', 3, { at: 0, del: 0, text: 'y' }], ['a', 4, { at: 1, del: 0, text: 'z' }]]);
});
test('applyWhole applies an id once and refuses a malformed input', () => {
  const { s, out } = setup();
  s.applyWhole({ toolUseId: 'w', agentId: 'a', name: 'Write', path: P, input: { content: 'abc' } });
  s.applyWhole({ toolUseId: 'w', agentId: 'a', name: 'Write', path: P, input: { content: 'abc' } });
  s.applyWhole({ toolUseId: 'bad', agentId: 'a', name: 'Write', path: P, input: { content: 7 } });
  s.applyWhole({ toolUseId: 'bad2', agentId: 'a', name: 'Edit', path: P, input: { old_string: 'a' } });
  assert.deepEqual(out.map((f) => f.splice), [{ at: 0, del: 0, text: 'abc' }]);
  assert.deepEqual(s.snapshot(), [{ path: P, rev: 1, text: 'abc' }]);
});
