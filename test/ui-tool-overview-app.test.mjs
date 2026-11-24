// test/ui-tool-overview-app.test.mjs — the tool panel's Overview in the real app (issue 1064): app.js + index.html under
// jsdom (chat-panel-boot). One row per app.js wiring line: the strip's Overview icon, the head meter's route, the overview
// fetch, and the deps the sections reach (runs, files, out files, Stop, Actions, the setting). Part 2: ui-tool-overview-app-more.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { NO_PREVIEW } from '../ui/public/artifacts/stage.mjs';
import { TID, until, PDF_TEXT, realOverview, boot, runsOverview } from './helpers/tool-overview-boot.mjs';

test('in the real app: the chat head strip starts with Overview; it opens the Overview and fetches the chat\'s overview once', async () => {
  const a = await boot();
  const strip = a.doc.querySelector('.chat-head [data-tool-icons]');
  assert.ok(strip.firstElementChild.classList.contains('tool-icon-overview'), strip.innerHTML.slice(0, 200));
  assert.equal(strip.firstElementChild.disabled, false);
  await a.openOverview();
  assert.equal(a.panel().hidden, false);
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'overview');
  assert.ok(await until(() => a.rowsOf('runs').length === 1));
  assert.deepEqual(a.rec.overview, [TID], 'one fetch per mount, for this chat');
  assert.ok(a.rowsOf('environment').includes('app'), 'projectOf: the project row');
  assert.ok(a.rowsOf('environment').includes('feat/first'), 'the followed run\'s branch');
  assert.deepEqual(a.rec.resolve.map((b) => b.refs), [['gh:o/r#7']], 'resolveRefs: the chip lookup');
});

test('in the real app: the head meter opens the Overview with Context expanded (no popover)', async () => {
  const a = await boot();
  const meter = a.doc.querySelector('.chat-head-meter');
  assert.equal(meter.hasAttribute('aria-haspopup'), false);
  meter.click();
  await a.settle(12);
  assert.equal(a.panel().hidden, false);
  assert.equal(a.doc.querySelector('.ask-pop-ctx'), null);
  assert.ok(await until(() => a.sec('context')?.querySelector('.tov-head')?.getAttribute('aria-expanded') === 'true'));
  assert.ok(a.sec('context').querySelector('.tov-body .ask-ctx-stat[data-stat="used"]'), 'the shared renderer');
  assert.equal(a.doc.activeElement, a.sec('context').querySelector('.tov-head'), 'the focus is on Context');
});

test('in the real app: a new chat\'s head meter keeps the popover; the side column ring keeps it too', async () => {
  const fresh = await boot({ url: 'http://localhost:4317/#chat/new' });
  fresh.doc.querySelector('.chat-head-meter').click();
  await fresh.settle(6);
  assert.ok(fresh.doc.querySelector('.ask-pop-ctx'), 'the popover');
  assert.equal(fresh.panel().hidden, true, 'the panel stays closed');
  const a = await boot({ more: (u) => (u.split('?')[0].endsWith('/api/workflows') ? { ok: true, status: 200, json: async () => ({ workflows: [] }) } : null) });
  a.go('runs');
  await a.settle(8);
  a.doc.getElementById('topnav-ask').click();
  await a.settle(8);
  const ring = a.doc.querySelector('#ask-side [data-ask-ctx-btn]');
  assert.ok(ring, 'the ring in the side column');
  ring.click();
  await a.settle(6);
  assert.ok(a.doc.querySelector('.ask-pop-ctx'), 'the popover');
  assert.equal(a.doc.querySelector('.tool-panel [data-tov-section]'), null, 'no Overview');
});

test('in the real app: a run row routes to the run page; an artifact opens a Files tab labelled Chat copy (twice: one tab)', async () => {
  const a = await boot();
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('runs').querySelector('.tov-row').click();
  await a.settle(6);
  assert.match(a.window.location.hash, /^#(history\/app-0000aaaa\/aaaa0001|running\/r-1)/, a.window.location.hash);
  a.go(`chat/${TID}`);
  await a.settle(12);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[0].click();
  await a.settle(12);
  assert.ok(await until(() => /Chat copy/.test(a.panel().textContent)), a.panel().textContent.slice(0, 300));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[0].click();
  await a.settle(12);
  const files = a.model().tabs.filter((t) => t.kind === 'files' && t.state.att === 'att_00000001');
  assert.equal(files.length, 1, 'an open copy focuses its tab (I8)');
});

/** Overview › Runs built by the REAL builder: Parent (PR 7) with two watch fix rounds; Other with three; a fix card whose
 *  origin was not started here; a tracked run with a PR; a run a reply named. */

test('in the real app: Overview › Runs nests auto-fix runs under their run (own cost, more than 2 folded) and ends with a collapsed Mentioned group whose PRs come last in Pull requests, marked', async () => {
  const a = await boot({ overview: await runsOverview() });
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('runs').length === 5), JSON.stringify(a.rowsOf('runs')));
  const metas = (id) => [...a.sec(id).querySelectorAll('.tov-item:not([hidden]) .tov-meta')].map((n) => n.textContent);
  assert.deepEqual(a.rowsOf('runs'), ['Parent', 'Auto-fix 1', 'Auto-fix 2', 'Other', '3 auto-fixes']);
  assert.deepEqual(metas('runs'), ['Done · $2.00', 'Done · $0.50', 'Running · implement · $0.75', 'Done · $1.00', 'Latest: Done']);
  assert.equal(a.sec('runs').querySelectorAll('.tov-item.is-child .tov-child').length, 3, 'the child rows carry the arrow');
  const m = a.sec('mentioned');
  const order = [...a.doc.querySelectorAll('.tool-panel .tov-sec')].map((x) => x.dataset.tovSection);
  assert.equal(order.indexOf('mentioned'), order.indexOf('runs') + 1);
  assert.equal(m.hidden, false);
  assert.ok(m.classList.contains('is-collapsed') && m.classList.contains('is-quiet'));
  assert.equal(m.querySelector('.tov-count').textContent, '4');
  assert.deepEqual(a.rowsOf('mentioned').sort(), ['Auto-fix 1', 'Named one', 'Origin elsewhere', 'Tracked one']);
  assert.ok(metas('mentioned').every((t) => !/\$/.test(t)), JSON.stringify(metas('mentioned')));
  assert.ok(await until(() => a.rowsOf('prs').length > 1), JSON.stringify(a.rowsOf('prs')));
  assert.equal(a.rowsOf('prs')[0], 'o/r#7', 'the started run\'s PR first');
  const quiet = [...a.sec('prs').querySelectorAll('.tov-item:not([hidden])')].slice(1);
  assert.ok(quiet.every((li) => li.classList.contains('is-quiet') && /^Mentioned/.test(li.querySelector('.tov-meta').textContent)), 'a mentioned run\'s PR is drawn quieter and says Mentioned');
  m.querySelector('.tov-head').click();
  assert.equal(m.querySelector('.tov-box').hidden, false);
  [...m.querySelectorAll('.tov-row')].find((r) => r.textContent.includes('Named one')).click();
  await a.settle(6);
  assert.match(a.window.location.hash, /^#history\/app-0000aaaa\/dddd0002/, a.window.location.hash);
});

test('in the real app: the Overview\'s shown PDF opens its chat copy in a Files tab and renders it (no NO_PREVIEW); a never-shown out PDF renders from the tool route', async () => {
  const a = await boot({ overview: await realOverview() });
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3), JSON.stringify(a.rowsOf('artifacts')));
  assert.deepEqual([...a.rowsOf('artifacts')].sort(), ['live.pdf', 'report.pdf', 'shot.png'], 'the shown report.pdf is listed once');
  const rowOf = (name) => [...a.sec('artifacts').querySelectorAll('.tov-row')].find((r) => r.querySelector('.tov-text').textContent === name);
  rowOf('report.pdf').click();
  await a.settle(12);
  const tab = () => a.model().tabs.find((t) => t.kind === 'files' && t.state.att === 'att_00000001');
  assert.ok(tab(), JSON.stringify(a.model().tabs));
  assert.equal(tab().state.attKind, 'pdf');
  assert.ok(await until(() => /Chat copy/.test(a.panel().textContent)), a.panel().textContent.slice(0, 300));
  assert.ok(await until(() => a.panel().querySelector('embed[type="application/pdf"]')), a.panel().querySelector('.tool-body')?.innerHTML.slice(0, 400));
  assert.ok(a.panel().querySelector('embed[type="application/pdf"]').getAttribute('src').startsWith(`/api/ask/threads/${TID}/attachments/`));
  assert.ok(!a.panel().textContent.includes(NO_PREVIEW), 'no NO_PREVIEW');
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  rowOf('live.pdf').click();
  await a.settle(12);
  assert.ok(a.model().tabs.some((t) => t.kind === 'files' && t.state.root === 'out'), JSON.stringify(a.model().tabs));
  assert.ok(await until(() => a.panel().querySelector('embed[type="application/pdf"]')?.getAttribute('src')?.startsWith('/api/tools/raw/')),
    a.panel().querySelector('.tool-body')?.innerHTML.slice(0, 400));
});

test('in the real app: the Overview row and the card open the same tab for the same file', async () => {
  const item = { attId: 'att_00000001', name: 'report.pdf', kind: 'pdf', mime: 'application/pdf', bytes: PDF_TEXT.length, source: true };
  const a = await boot({ overview: await realOverview(), blocks: [{ kind: 'card', id: 'card_00000001', state: 'shown', card: { type: 'files', title: 'report.pdf', items: [item] } }] });
  assert.ok(await until(() => a.doc.querySelector('.ask-filescard-name')));
  a.doc.querySelector('.ask-filescard-name').click();
  await a.settle(12);
  assert.equal(a.model().tabs.filter((t) => t.kind === 'files').length, 1, JSON.stringify(a.model().tabs));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  [...a.sec('artifacts').querySelectorAll('.tov-row')].find((r) => r.querySelector('.tov-text').textContent === 'report.pdf').click();
  await a.settle(12);
  const files = a.model().tabs.filter((t) => t.kind === 'files' && t.state.att === 'att_00000001');
  assert.equal(files.length, 1, 'one tab per file (I7)');
  assert.equal(files[0].state.attKind, 'pdf', 'the card\'s tab keeps its kind');
  assert.ok(await until(() => a.panel().querySelector('embed[type="application/pdf"]')), a.panel().querySelector('.tool-body')?.innerHTML.slice(0, 400));
  assert.ok(!a.panel().textContent.includes(NO_PREVIEW));
});

test('in the real app: an out file opens with root=out; an image opens the pop-up; the setting off still opens a Files tab for a shown non-image (clarify answer 2), and an image still opens the pop-up', async () => {
  const a = await boot();
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[2].click();
  await a.settle(12);
  assert.ok(await until(() => a.rec.file.some((u) => /root=out/.test(u) && /path=report\.md/.test(u))), a.rec.file.join(' | '));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[1].click();
  await a.settle(8);
  assert.ok(a.doc.querySelector('.viewer-modal.apv:not(.hidden)'), 'the image pop-up');
  const off = await boot({ settings: () => ({ chatLinksInPanel: false }) });
  await off.openOverview();
  assert.ok(await until(() => off.rowsOf('artifacts').length === 3));
  off.sec('artifacts').querySelectorAll('.tov-row')[0].click();
  await off.settle(12);
  assert.equal(off.doc.querySelector('.viewer-modal.apv:not(.hidden)'), null, 'setting off: no pop-up for a non-image');
  assert.deepEqual(off.model().tabs.filter((t) => t.kind === 'files').map((t) => t.state.att), ['att_00000001'], 'setting off: a Files tab');
  await off.openOverview();
  assert.ok(await until(() => off.rowsOf('artifacts').length === 3));
  off.sec('artifacts').querySelectorAll('.tov-row')[1].click();
  await off.settle(8);
  assert.ok(off.doc.querySelector('.viewer-modal.apv:not(.hidden)'), 'setting off: an image still opens the pop-up');
});

test('in the real app: Background lists the chat\'s running command (Stop posts the stop route) and its run\'s Actions (Stop posts the instance stop)', async () => {
  const CMD = { kind: 'card', id: 'card_000000c1', state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'app', cwd: '/tmp/app', warning: null } };
  const a = await boot({ blocks: [CMD], running: () => [{ instanceId: 'inst_1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: new Date().toISOString() },
    { instanceId: 'inst_2', runId: 'ffff0000', kind: 'task', label: 'Other', startedAt: new Date().toISOString() }] });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').length === 2), JSON.stringify(a.rowsOf('background')));
  assert.deepEqual(a.rowsOf('background'), ['npm test', 'Web']);
  const stops = a.sec('background').querySelectorAll('.tov-stop');
  stops[0].click();
  stops[1].click();
  await a.settle(8);
  assert.ok(a.rec.stops.some((p) => p.endsWith('/api/terminal/sessions/t-0000000001/stop')), a.rec.stops.join());
  assert.ok(a.rec.actionStops.some((p) => p.endsWith('/api/actions/instances/inst_1/stop')), a.rec.actionStops.join());
});
