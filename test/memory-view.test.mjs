// test/memory-view.test.mjs — pure jsdom tests for the Memory-view renderers (agent-memory-design.md §10).
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  formatWhen, renderHealthCard, renderFileList, renderEditor, collectEditor,
  renderMemoryHistory, MEMORY_NAME_HELP, parseSnapshotId, memorySource, patchRunRefs,
} from '../ui/public/memory-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const HEALTH = { files: 2, bytes: 300, oversized: 0, overHard: 0, invalidFrontmatter: 0, alwaysOnBytes: 120, alwaysOnFiles: 1, writesSinceDefrag: 3, lastWriteAt: '2026-09-09T10:00:00.000Z', lastDefragAt: null, lastDefragRunId: null, level: 'ok', reasons: [] };
const REPORT = { scope: 'global', project: null, files: [], state: {}, health: HEALTH, defragRunId: null };
const HOST = { key: 'alpha-00000001', name: 'alpha' };
const PROJECT_REPORT = { ...REPORT, scope: 'projects/alpha-00000001', project: { key: 'alpha-00000001', name: 'alpha' } };

test('renderHealthCard: badge, reasons, counters, and the Defragment control in its three states', () => {
  const ok = renderHealthCard(REPORT, { doc, host: HOST });
  assert.ok(ok.classList.contains('card') && ok.classList.contains('mem-health'));
  assert.equal(ok.querySelector('.badge').textContent, 'Healthy');
  assert.ok(ok.querySelector('.badge').classList.contains('green'));
  assert.equal(ok.querySelector('.mem-reasons'), null, 'no reasons list when there are none');
  assert.match(ok.querySelector('.mem-counters').textContent, /2 files · 300 bytes · 120 bytes always loaded · 3 writes since the last defragment/);
  const btn = ok.querySelector('.mem-defrag');
  assert.equal(btn.disabled, false); assert.equal(btn.textContent, 'Defragment');
  assert.equal(btn.dataset.runId, undefined, 'no run to open');
  assert.equal(ok.querySelector('.mem-host-hint').textContent, 'Runs on alpha. Pick another project on the New run page.');
  const due = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'due', reasons: ['12 memory writes since the last defragment (due at 10)', '1 file over the 8192-byte soft cap: big.md'] } }, { doc, host: HOST });
  assert.deepEqual([...due.querySelectorAll('.mem-reasons li')].map((li) => li.textContent), ['12 memory writes since the last defragment (due at 10)', '1 file over the 8192-byte soft cap: big.md']);
  // A live defragment: ONE control (spec §10) — still enabled, it opens the run.
  const live = renderHealthCard({ ...REPORT, defragRunId: 'abc-123' }, { doc, host: HOST });
  const liveBtn = live.querySelector('.mem-defrag');
  assert.equal(liveBtn.disabled, false);
  assert.equal(liveBtn.dataset.runId, 'abc-123');
  assert.equal(liveBtn.textContent, 'Open run');
  assert.match(live.querySelector('.mem-counters').textContent, / · defragmenting now$/, 'the state stays in the line');
  assert.equal(live.querySelector('.mem-run'), null, 'no second control');
  const failing = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'failing', failedWrites: 2, reasons: ['2 memory writes by runs failed since the last defragment — last in run abc12345; that run\'s History detail carries the reason'] } }, { doc, host: HOST });
  assert.equal(failing.querySelector('.badge').textContent, 'Writes failing');
  assert.ok(failing.querySelector('.badge').classList.contains('red'));
  assert.match(failing.querySelector('.mem-counters').textContent, / · 2 failed writes$/);
  assert.ok(!/failed write/.test(ok.querySelector('.mem-counters').textContent), 'no failed-write counter when there are none');
  const hostile = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'due', reasons: ['<img src=x onerror=1>'] } }, { doc, host: HOST });
  assert.equal(hostile.querySelector('img'), null, 'reasons are text, never markup');
});

test('renderHealthCard: the global scope needs a host project; a project scope never does', () => {
  const noHost = renderHealthCard(REPORT, { doc, host: null });
  const btn = noHost.querySelector('.mem-defrag');
  assert.equal(btn.disabled, true);
  assert.equal(noHost.querySelector('.mem-host-hint').textContent, 'Register a project on the Projects page to host the global defragment run.');
  assert.equal(btn.title, 'Register a project on the Projects page to host the global defragment run.');
  const proj = renderHealthCard(PROJECT_REPORT, { doc, host: null });
  assert.equal(proj.querySelector('.mem-defrag').disabled, false, 'a project defragment runs on that project');
  assert.equal(proj.querySelector('.mem-host-hint'), null, 'no host line for a project scope');
});

test('renderFileList: the main block of a row is the control; name, hook and meta; the selected row is .on; empty ⇒ hist-empty', () => {
  const files = [
    { name: 'testing', description: 'How the suite runs', paths: ['test/**'], source: 'user', updated: '2026-09-09T10:00:00.000Z', bytes: 120, hasFrontmatter: true },
    { name: 'style', description: '<b>bold</b>', paths: [], source: 'run:abcd1234', updated: '', bytes: 40, hasFrontmatter: false },
  ];
  const el = renderFileList(files, { doc, selected: 'style' });
  const rows = [...el.querySelectorAll('.mem-row')];
  assert.deepEqual(rows.map((r) => r.dataset.name), ['testing', 'style']);
  assert.equal(rows[0].querySelector('.mem-row-name').textContent, 'testing.md');
  assert.equal(rows[0].querySelector('.mem-row-hook').textContent, 'How the suite runs');
  const main0 = rows[0].querySelector('.mem-row-main');
  assert.equal(main0.getAttribute('role'), 'button');
  assert.equal(main0.tabIndex, 0, 'reachable by keyboard');
  assert.equal(main0.querySelector('button, a'), null, 'no interactive descendant inside role=button');
  assert.equal(rows[0].querySelector('.mem-row-meta').textContent, `${formatWhen(files[0].updated)} · you`);
  assert.equal(rows[1].querySelector('.mem-row-meta').textContent, 'a run · no frontmatter', 'no date: only the source');
  assert.doesNotMatch(rows[0].querySelector('.mem-row-meta').textContent, /no frontmatter/);
  assert.equal(rows[1].querySelector('b'), null, 'hooks are text');
  assert.equal(rows[1].querySelector('.mem-row-hook').textContent, '<b>bold</b>');
  assert.ok(rows[1].classList.contains('on') && !rows[0].classList.contains('on'));
  assert.ok(el.querySelector('.mem-new'));
  const empty = renderFileList([], { doc });
  assert.ok(empty.querySelector('.hist-empty'));
  assert.ok(empty.querySelector('.mem-new'));
});

const RAW = [/run[:-][0-9a-f]{8}/, /\d{8}-\d{6}-run-/];
const runInfo = (pid) => (pid === 'cc3b6fce' ? { title: 'Fix login redirect', href: '#history/alpha-00000001/cc3b6fce' }
  : pid === 'dd000001' ? { title: '', href: '#history/alpha-00000001/dd000001' } : null);

test('parseSnapshotId: UTC stamp, source slug and same-second suffix', () => {
  const s = parseSnapshotId('20261020-054609-run-773718c3');
  assert.equal(s.iso, '2026-10-20T05:46:09.000Z');
  assert.deepEqual(s.source, { kind: 'run', ref: '773718c3' });
  assert.deepEqual(parseSnapshotId('20261020-054609-defrag-ab000001-02').source, { kind: 'run', ref: 'ab000001' });
  assert.deepEqual(parseSnapshotId('20260909-100000-user').source, { kind: 'user', ref: '' });
  assert.deepEqual(parseSnapshotId('20260909-100000-ask-ask_1234abcd').source, { kind: 'chat', ref: 'ask_1234abcd' });
  assert.equal(parseSnapshotId('garbage').iso, '');
});

test('memorySource: run and defrag are runs; user is you; ask is a chat; anything else is Worca', () => {
  assert.deepEqual(memorySource('run:cc3b6fce'), { kind: 'run', ref: 'cc3b6fce' });
  assert.deepEqual(memorySource('defrag:cc3b6fce'), { kind: 'run', ref: 'cc3b6fce' });
  assert.deepEqual(memorySource('user'), { kind: 'user', ref: '' });
  assert.deepEqual(memorySource('ask:ask_1234abcd'), { kind: 'chat', ref: 'ask_1234abcd' });
  assert.deepEqual(memorySource('restore:x'), { kind: 'other', ref: '' });
});

test('renderFileList: meta is the date then the run title as a link; ids only in the tooltip', () => {
  const files = [
    { name: 'testing', description: 'x', source: 'run:cc3b6fce', updated: '2026-09-09T10:00:00.000Z', hasFrontmatter: true },
    { name: 'style', description: 'y', source: 'run:ee000001', updated: '2026-09-09T10:00:00.000Z', hasFrontmatter: false },
    { name: 'traps', description: 'z', source: 'user', updated: '2026-09-09T10:00:00.000Z', hasFrontmatter: true },
  ];
  const el = renderFileList(files, { doc, runInfo });
  const [a, b, c] = [...el.querySelectorAll('.mem-row-meta')];
  assert.equal(a.textContent, `${formatWhen(files[0].updated)} · Fix login redirect`);
  assert.equal(a.querySelector('a').getAttribute('href'), '#history/alpha-00000001/cc3b6fce');
  assert.equal(a.title, 'run:cc3b6fce');
  assert.equal(b.textContent, `${formatWhen(files[1].updated)} · a run · no frontmatter`);
  assert.equal(b.querySelector('a'), null, 'no row known: plain words, no link');
  assert.equal(c.textContent, `${formatWhen(files[2].updated)} · you`);
  for (const m of [a, b, c]) for (const re of RAW) assert.doesNotMatch(m.textContent, re);
  const row = el.querySelector('.mem-row');
  assert.equal(row.getAttribute('role'), null, 'the row is not the control any more');
  const main = row.querySelector('.mem-row-main');
  assert.equal(main.getAttribute('role'), 'button');
  assert.equal(main.tabIndex, 0);
  assert.equal(main.querySelector('a, button'), null, 'no interactive descendant inside role=button');
});

test('renderMemoryHistory: date and time, run title link, file count; raw id only in title and data-id', () => {
  const el = renderMemoryHistory([{ id: '20261020-054609-run-cc3b6fce', files: ['a.md', 'b.md'] },
    { id: '20261020-060000-run-dd000001', files: ['a.md'] }], { doc, runInfo });
  const rows = [...el.querySelectorAll('.mem-snap')];
  assert.equal(rows[0].dataset.id, '20261020-060000-run-dd000001', 'newest first');
  assert.equal(rows[0].title, '20261020-060000-run-dd000001');
  assert.equal(rows[0].querySelector('.mem-snap-when').textContent, formatWhen('2026-10-20T06:00:00.000Z'));
  assert.equal(rows[0].querySelector('.mem-snap-src a').textContent, 'a run', 'known row, empty title');
  assert.equal(rows[0].querySelector('.mem-snap-src a').getAttribute('aria-label'), 'Open this run');
  assert.equal(rows[1].querySelector('.mem-snap-src a').textContent, 'Fix login redirect');
  assert.equal(rows[1].querySelector('.mem-snap-src a').getAttribute('aria-label'), null);
  for (const r of rows) for (const re of RAW) assert.doesNotMatch(r.textContent, re);
  const garbage = renderMemoryHistory([{ id: 'garbage', files: ['a.md'] }], { doc, runInfo });
  assert.equal(garbage.querySelector('.mem-snap-when').textContent, '', 'an unparsable id has no date');
  assert.equal(garbage.querySelector('.mem-snap-src'), null, 'and no source: only the count shows');
});

test('patchRunRefs: a name that lands later replaces "a run" in place', () => {
  const el = renderMemoryHistory([{ id: '20261020-054609-run-cc3b6fce', files: [] }], { doc, runInfo: () => null });
  assert.equal(el.querySelector('.mem-snap-src').textContent, 'a run');
  patchRunRefs(el, runInfo, { doc });
  assert.equal(el.querySelector('.mem-snap-src a').textContent, 'Fix login redirect');
});

test('renderEditor / collectEditor: an existing file is name-locked with Delete; a new one is name-editable without it; the text is a value, never parsed', () => {
  const file = { name: 'testing', text: '---\nname: testing\n---\n<img src=x>\n', meta: { name: 'testing' }, body: '<img src=x>\n' };
  const ed = renderEditor(file, { doc });
  assert.equal(ed.querySelector('.mem-name').value, 'testing');
  assert.equal(ed.querySelector('.mem-name').readOnly, true);
  assert.equal(ed.querySelector('.mem-text').value, file.text);
  assert.equal(ed.querySelector('.mem-text').childNodes.length, 0, 'the text is a value, not a child node');
  assert.equal(ed.querySelector('img'), null);
  assert.ok(ed.querySelector('.mem-save') && ed.querySelector('.mem-cancel') && ed.querySelector('.mem-delete'));
  assert.equal(ed.querySelector('.mem-msg').getAttribute('role'), 'status');
  assert.equal(ed.querySelector('.mem-msg').getAttribute('aria-live'), null, 'role=status is already polite');
  assert.equal(ed.querySelector('.mem-save').disabled, false);
  ed.querySelector('.mem-text').value = 'edited\n';
  assert.deepEqual(collectEditor(ed), { name: 'testing', text: 'edited\n' });
  const fresh = renderEditor({ name: '', text: '' }, { doc, isNew: true, msg: 'pick a name', msgErr: true });
  assert.equal(fresh.querySelector('.mem-name').readOnly, false);
  assert.equal(fresh.querySelector('.mem-delete'), null);
  assert.equal(fresh.querySelector('.mem-text').value, '---\nname: \ndescription: \n---\n', 'a new file starts from the frontmatter stub');
  assert.equal(fresh.querySelector('.mem-msg').textContent, 'pick a name');
  assert.ok(fresh.querySelector('.mem-msg').classList.contains('err'));
  assert.equal(fresh.querySelector('.mem-name-help').textContent, MEMORY_NAME_HELP);
  assert.match(MEMORY_NAME_HELP, /letters, digits/);
  fresh.querySelector('.mem-name').value = '  new-topic ';
  assert.equal(collectEditor(fresh).name, 'new-topic');
});

test('locked (a defragment run is live on this scope): Save, Delete and Restore are disabled', () => {
  const ed = renderEditor({ name: 'testing', text: 'x\n' }, { doc, locked: true });
  assert.equal(ed.querySelector('.mem-save').disabled, true);
  assert.equal(ed.querySelector('.mem-delete').disabled, true);
  assert.equal(ed.querySelector('.mem-cancel').disabled, false, 'closing the editor is always allowed');
  assert.match(ed.querySelector('.mem-msg').textContent, /defragment run is live/);
  const hist = renderMemoryHistory([{ id: '20260909-100000-user', files: ['a.md'] }], { doc, locked: true });
  assert.equal(hist.querySelector('.mem-restore').disabled, true);
});
