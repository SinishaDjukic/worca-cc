// test/memory-view.test.mjs — pure jsdom tests for the Memory-view renderers (agent-memory-design.md §10).
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  memoryRoute, healthBadge, formatWhen, renderHealthCard, renderFileList, renderEditor, collectEditor,
  renderMemoryHistory, MEMORY_NAME_HELP,
} from '../ui/public/memory-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const HEALTH = { files: 2, bytes: 300, oversized: 0, overHard: 0, invalidFrontmatter: 0, alwaysOnBytes: 120, alwaysOnFiles: 1, writesSinceDefrag: 3, lastWriteAt: '2026-09-09T10:00:00.000Z', lastDefragAt: null, lastDefragRunId: null, level: 'ok', reasons: [] };
const REPORT = { scope: 'global', project: null, files: [], state: {}, health: HEALTH, defragRunId: null };
const HOST = { key: 'alpha-00000001', name: 'alpha' };
const PROJECT_REPORT = { ...REPORT, scope: 'projects/alpha-00000001', project: { key: 'alpha-00000001', name: 'alpha' } };

test('memoryRoute: global under Settings, projects under the Projects page; names are encoded', () => {
  assert.equal(memoryRoute('global'), 'settings/memory');
  assert.equal(memoryRoute('global', 'testing'), 'settings/memory/testing');
  assert.equal(memoryRoute('projects/demo-00000001'), 'projects/demo-00000001/memory');
  assert.equal(memoryRoute('projects/demo-00000001', 'conv'), 'projects/demo-00000001/memory/conv');
  assert.equal(memoryRoute('global', 'my notes'), 'settings/memory/my%20notes');
});

test('healthBadge + formatWhen (LOCAL time, like every other date in the app)', () => {
  assert.deepEqual(healthBadge('fresh'), { text: 'No memory yet', cls: '' });
  assert.deepEqual(healthBadge('ok'), { text: 'Healthy', cls: 'green' });
  assert.deepEqual(healthBadge('due'), { text: 'Defragment due', cls: 'amber' });
  assert.deepEqual(healthBadge('overdue'), { text: 'Defragment overdue', cls: 'red' });
  assert.deepEqual(healthBadge('bogus'), { text: 'No memory yet', cls: '' });
  const iso = '2026-09-09T10:05:00.000Z';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  assert.equal(formatWhen(iso), expected);
  assert.equal(formatWhen(''), ''); assert.equal(formatWhen(null), ''); assert.equal(formatWhen('not a date'), '');
});

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
  assert.equal(ok.querySelector('.mem-host-hint').textContent, 'Runs on alpha — pick another project on the New pipeline page.');
  const due = renderHealthCard({ ...REPORT, health: { ...HEALTH, level: 'due', reasons: ['12 memory writes since the last defragment (due at 10)', '1 file over the 8192-byte soft cap: big.md'] } }, { doc, host: HOST });
  assert.deepEqual([...due.querySelectorAll('.mem-reasons li')].map((li) => li.textContent), ['12 memory writes since the last defragment (due at 10)', '1 file over the 8192-byte soft cap: big.md']);
  // A live defragment: ONE control (spec §10) — still enabled, it opens the run.
  const live = renderHealthCard({ ...REPORT, defragRunId: 'abc-123' }, { doc, host: HOST });
  const liveBtn = live.querySelector('.mem-defrag');
  assert.equal(liveBtn.disabled, false);
  assert.equal(liveBtn.dataset.runId, 'abc-123');
  assert.match(liveBtn.textContent, /Defragmenting/);
  assert.equal(live.querySelector('.mem-run'), null, 'no second control');
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

test('renderFileList: the row IS the control; name, hook and meta; the selected row is .on; empty ⇒ hist-empty', () => {
  const files = [
    { name: 'testing', description: 'How the suite runs', paths: ['test/**'], source: 'user', updated: '2026-09-09T10:00:00.000Z', bytes: 120, hasFrontmatter: true },
    { name: 'style', description: '<b>bold</b>', paths: [], source: 'run:abcd1234', updated: '', bytes: 40, hasFrontmatter: false },
  ];
  const el = renderFileList(files, { doc, selected: 'style' });
  const rows = [...el.querySelectorAll('.mem-row')];
  assert.deepEqual(rows.map((r) => r.dataset.name), ['testing', 'style']);
  assert.equal(rows[0].querySelector('.mem-row-name').textContent, 'testing.md');
  assert.equal(rows[0].querySelector('.mem-row-hook').textContent, 'How the suite runs');
  assert.equal(rows[0].getAttribute('role'), 'button');
  assert.equal(rows[0].tabIndex, 0, 'reachable by keyboard');
  assert.equal(rows[0].querySelector('button'), null, 'no interactive descendant inside role=button');
  assert.equal(rows[0].querySelector('.mem-row-meta').textContent, `${formatWhen(files[0].updated)} · user`);
  assert.match(rows[1].querySelector('.mem-row-meta').textContent, /run:abcd1234 · no frontmatter/);
  assert.doesNotMatch(rows[0].querySelector('.mem-row-meta').textContent, /no frontmatter/);
  assert.equal(rows[1].querySelector('b'), null, 'hooks are text');
  assert.equal(rows[1].querySelector('.mem-row-hook').textContent, '<b>bold</b>');
  assert.ok(rows[1].classList.contains('on') && !rows[0].classList.contains('on'));
  assert.ok(el.querySelector('.mem-new'));
  const empty = renderFileList([], { doc });
  assert.ok(empty.querySelector('.hist-empty'));
  assert.ok(empty.querySelector('.mem-new'));
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

test('renderMemoryHistory: newest first, file counts, Restore per row; none ⇒ hist-empty', () => {
  const el = renderMemoryHistory([{ id: '20260909-100000-user', files: ['a.md'] }, { id: '20260909-100500-run-abcd1234', files: ['a.md', 'b.md'] }], { doc });
  const rows = [...el.querySelectorAll('.mem-snap')];
  assert.deepEqual(rows.map((r) => r.dataset.id), ['20260909-100500-run-abcd1234', '20260909-100000-user']);
  assert.equal(rows[0].querySelector('.mem-snap-count').textContent, '2 files');
  assert.equal(rows[1].querySelector('.mem-snap-count').textContent, '1 file');
  assert.ok(rows.every((r) => r.querySelector('.mem-restore') && r.querySelector('.mem-restore').disabled === false));
  assert.ok(renderMemoryHistory([], { doc }).querySelector('.hist-empty'));
});
