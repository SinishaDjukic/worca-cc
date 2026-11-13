// test/ui-design-export.test.mjs — Design P6 Task 7: the stage head's Export menu and its dialogs
// (ui/public/design/export-dialog.mjs). The menu as the mockup draws it (board 6a) with the PDF rule, a download that
// opens a dialog only when it has something to say (L6.4), every refusal inside that dialog (BRIEF C4), the problems
// header shown as text, and the Copy into a project dialog with its collision flow. The rig is a JSDOM page holding the
// stage head's `.dz-menu-anchor`, a fake `fetch` by route that records each POST and each request's AbortSignal, and a
// `save` that records `[name, blob]`.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cssRules } from './helpers/css-rules.mjs';
import {
  createDesignExport, exportMenuItems, decodeProblems, dispositionName, saveBlob, filmPercent,
} from '../ui/public/design/export-dialog.mjs';

const doms = [];
const made = [];
afterEach(() => {
  for (const exp of made.splice(0)) exp.destroy();
  for (const d of doms.splice(0)) d.window.close();
});
const tick = () => new Promise((r) => setTimeout(r, 0));

const WEB = { id: 'd_0000000000a1', kind: 'web', title: 'Ship Radar', status: 'done', projectKey: null };
const DECK = { ...WEB, id: 'd_0000000000a2', kind: 'pitch' };
const TYPES = { page: 'text/html; charset=utf-8', zip: 'application/zip', pdf: 'application/pdf' };

/** A 200 file answer as the export route sends it: the attachment name, and the problems header when given. */
function file(kind, { name, problems } = {}) {
  const headers = new Headers({ 'content-type': TYPES[kind], 'content-disposition': `attachment; filename="${name}"` });
  if (problems) headers.set('x-worca-export-problems', problems);
  return { ok: true, status: 200, headers, blob: async () => new Blob(['file'], { type: TYPES[kind] }) };
}
function json(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(text), blob: async () => new Blob([text]),
  };
}

/** `routes.export` / `routes.projects`: a function is called per request, a built answer (`file`, `json`) is given as
 *  is, any other plain object answers `json(200, obj)`. */
function rig({ design, routes = {}, showAfterMs, pollMs } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doms.push(dom);
  const win = dom.window;
  const doc = win.document;
  const posts = [];
  const saved = [];
  const signals = [];
  const polls = [];      // each GET of a video's MP4 status
  const fileGets = [];   // the key of each GET of a video's MP4 file
  const deletes = [];    // each DELETE of a video's MP4 job
  const answer = (v, init) => (typeof v === 'function' ? v(init) : v instanceof Object && v.headers instanceof Headers ? v : json(200, v));
  async function fetch(url, init = {}) {
    signals.push(init.signal);
    const method = String(init.method ?? 'GET').toUpperCase();
    if (method === 'POST') posts.push({ url, body: JSON.parse(init.body) });
    // A video's MP4 job: `routes.mp4` is the status (a list is answered one by one, its last entry from then on),
    // `routes.mp4File` the file.
    const mp4 = /^\/api\/design\/d_[0-9a-f]{12}\/export\/mp4(\/file\?key=([^&]*))?$/.exec(url);
    if (mp4 && method === 'DELETE') { deletes.push(url); return json(200, { state: 'none' }); }
    if (mp4 && mp4[1]) { fileGets.push(decodeURIComponent(mp4[2])); return answer(routes.mp4File ?? json(404, { error: 'That video is no longer there. Export it again.', code: 'no-film' }), init); }
    if (mp4) { polls.push(url); return answer(Array.isArray(routes.mp4) ? (routes.mp4.length > 1 ? routes.mp4.shift() : routes.mp4[0]) : routes.mp4, init); }
    if (url === '/api/projects') return answer(routes.projects ?? { projects: [] }, init);
    if (/^\/api\/design\/d_[0-9a-f]{12}\/export$/.test(url)) return answer(routes.export, init);
    return json(404, { error: 'not found' });
  }
  const anchor = doc.body.appendChild(doc.createElement('div'));
  anchor.className = 'dz-menu-anchor';
  const exp = createDesignExport({
    doc, win, fetch, getDesign: () => design, anchor,
    ...(showAfterMs == null ? {} : { showAfterMs }),
    ...(pollMs == null ? {} : { pollMs }),
    save: (name, blob) => { saved.push([name, blob]); },
  });
  made.push(exp);
  exp.setReady(true);
  return { exp, doc, win, posts, saved, signals, tick, polls, fileGets, deletes };
}

test('the head button shows only once the round is done; the HUD Export opens the menu and it stays open', async () => {
  const { exp, doc, win } = rig({ design: WEB }); const head = doc.querySelector('.dz-menu-anchor > button');
  exp.setReady(false); assert.equal(head.hidden, true); exp.setReady(true); assert.equal(head.hidden, false);
  const hud = doc.body.appendChild(doc.createElement('div')); hud.className = 'dz-hud'; const b = hud.appendChild(doc.createElement('button'));
  b.addEventListener('click', () => exp.toggle()); b.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(doc.querySelector('.menu.dz-export').hidden, false, 'the bubbling click must not close it again');
});

test('the head button: Export and the chevron, a menu trigger; a round going again closes an open menu', () => {
  const { exp, doc } = rig({ design: WEB });
  const head = doc.querySelector('.dz-menu-anchor > button');
  assert.equal(head.textContent, 'Export');
  assert.ok(head.classList.contains('btn'));
  assert.equal(head.getAttribute('aria-haspopup'), 'menu');
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.ok(head.querySelector('svg'), 'the chevron');
  const menu = doc.querySelector('.dz-menu-anchor > .menu.dz-export');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(menu.getAttribute('aria-label'), 'Export');
  assert.equal(menu.hidden, true);
  exp.toggle();
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  exp.setReady(false);
  assert.equal(menu.hidden, true);
  exp.toggle();
  assert.equal(menu.hidden, true, 'nothing to export until the round is done');
});

test('exportMenuItems: the PDF rule', () => {
  const ids = (k) => exportMenuItems(k).map((i) => i.sep ? '-' : i.id);
  assert.deepEqual(ids('web'), ['html', 'zip', 'pdf', '-', 'project']);
  assert.deepEqual(exportMenuItems('web')[2], { id: 'pdf', label: 'PDF', disabled: true, note: 'Decks and documents only' });
  for (const k of ['presentation', 'pitch', 'document']) assert.deepEqual(exportMenuItems(k)[2], { id: 'pdf', label: 'PDF' }, k);
  assert.deepEqual(ids('document'), ['html', 'zip', 'pdf', '-', 'project']);
  assert.deepEqual(ids('video'), ['html', 'zip', 'mp4', '-', 'project']);
  assert.deepEqual(exportMenuItems('video')[2], { id: 'mp4', label: 'Video (MP4)' });
  for (const k of ['web', 'presentation', 'pitch', 'document']) assert.equal(ids(k).includes('mp4'), false, k);
});
test('menu matches the mockup; a disabled PDF does nothing', async () => {
  const { exp, doc, posts, tick } = rig({ design: WEB });
  exp.toggle();
  const items = [...doc.querySelectorAll('.menu.dz-export .menu-item')];
  assert.deepEqual(items.map((b) => b.querySelector('span').textContent), ['Standalone HTML', 'Zip of the folder', 'PDF', 'Copy into a project']);
  assert.equal(items[2].getAttribute('aria-disabled'), 'true');
  assert.equal(items[2].getAttribute('title'), 'Decks and documents only');
  assert.equal(items[2].querySelector('small').textContent, 'Decks and documents only');
  items[2].click(); await tick();
  assert.equal(posts.length, 0);
});
test('menu items: each is a menuitem with its inline icon; a separator before Copy; an item click closes the menu and runs it', async () => {
  const { exp, doc, posts, saved, tick } = rig({ design: DECK, routes: { export: file('pdf', { name: 'ship-radar.pdf' }) } });
  exp.toggle();
  const menu = doc.querySelector('.menu.dz-export');
  assert.deepEqual([...menu.children].map((n) => n.className), ['menu-item', 'menu-item', 'menu-item', 'menu-sep', 'menu-item']);
  for (const b of menu.querySelectorAll('.menu-item')) {
    assert.equal(b.getAttribute('role'), 'menuitem');
    assert.equal(b.firstElementChild.tagName.toLowerCase(), 'svg');
  }
  const pdf = menu.querySelectorAll('.menu-item')[2];
  assert.equal(pdf.hasAttribute('aria-disabled'), false, 'a deck prints');
  pdf.click(); await tick();
  assert.equal(menu.hidden, true);
  assert.deepEqual(posts.map((p) => p.body), [{ format: 'pdf' }]);
  assert.equal(saved[0][0], 'ship-radar.pdf');
  exp.toggle();
  menu.querySelectorAll('.menu-item')[3].click(); await tick();
  assert.equal(menu.hidden, true);
  assert.ok(doc.querySelector('.viewer-modal select'), 'Copy into a project opens its dialog');
});
test('a fast clean download shows no dialog', async () => {
  const { exp, doc, saved, tick, posts } = rig({ design: WEB, routes: { export: file('page', { name: 'ship-radar.html' }) } });
  await exp.run('html'); await tick();
  assert.deepEqual(posts[0].body, { format: 'html' });
  assert.equal(posts[0].url, `/api/design/${WEB.id}/export`);
  assert.equal(saved[0][0], 'ship-radar.html');
  assert.equal(doc.querySelector('.viewer-modal'), null);
});
test('a slow one shows its dialog; Cancel aborts', async () => {
  const hang = new Promise(() => {}); const { exp, doc, signals, tick } = rig({ design: DECK, showAfterMs: 0, routes: { export: () => hang } });
  void exp.run('pdf'); await tick(); await tick();
  assert.equal(doc.querySelector('.viewer-modal .dlg-status').textContent, 'Making the file…');
  [...doc.querySelectorAll('.viewer-modal button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(signals[0].aborted, true);
  assert.equal(doc.querySelector('.viewer-modal'), null);
});
test('a cancelled download paints nothing when its answer still arrives', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const { exp, doc, saved, tick } = rig({ design: DECK, showAfterMs: 0, routes: { export: () => held } });
  const done = exp.run('pdf'); await tick(); await tick();
  [...doc.querySelectorAll('.viewer-modal button')].find((b) => b.textContent === 'Cancel').click();
  release(file('pdf', { name: 'a.pdf' })); await done; await tick();
  assert.deepEqual([saved.length, doc.querySelector('.viewer-modal')], [0, null]);
});
test('a cancelled request\'s AbortError paints nothing', async () => {
  const { exp, doc, win, tick } = rig({ design: DECK, showAfterMs: 0, routes: { export: (init) => new Promise((resolve, reject) => {
    init.signal.onabort = () => reject(new win.DOMException('The operation was aborted.', 'AbortError'));
  }) } });
  void exp.run('pdf'); await tick(); await tick();
  [...doc.querySelectorAll('.viewer-modal button')].find((b) => b.textContent === 'Cancel').click();
  await tick(); await tick();   // the rejection has landed (never await the run: without the abort it never settles)
  assert.equal(doc.querySelector('.viewer-modal'), null);
});
test('a fast download never opens the dialog, not even when the timer would have fired', async () => {
  const { exp, doc, saved } = rig({ design: WEB, showAfterMs: 5, routes: { export: file('page', { name: 'a.html' }) } });
  const done = exp.run('html');
  assert.equal(doc.querySelector('.viewer-modal'), null, 'nothing before showAfterMs');
  await done; await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual([saved.length, doc.querySelector('.viewer-modal')], [1, null]);
});
test('Try again shows the busy line at once, in the same dialog', async () => {
  let n = 0; let release = null;
  const { exp, doc, saved, tick } = rig({ design: DECK, routes: { export: () => (++n === 1 ? json(422, { error: 'No.', code: 'page-count' }) : new Promise((r) => { release = () => r(file('pdf', { name: 'a.pdf' })); })) } });
  await exp.run('pdf'); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click();
  assert.deepEqual([doc.querySelector('.viewer-modal'), dlg.querySelector('.dlg-status').textContent], [dlg, 'Making the file…']);
  assert.deepEqual([...dlg.querySelectorAll('button')].map((b) => b.textContent), ['Cancel']);
  release(); await tick(); await tick();
  assert.deepEqual([saved.length, doc.querySelector('.viewer-modal')], [1, null]);
});
test('a dropped connection says so in the dialog', async () => {
  const { exp, doc, saved, tick } = rig({ design: WEB, routes: { export: () => Promise.reject(new TypeError('Failed to fetch')) } });
  await exp.run('zip'); await tick();
  assert.equal(doc.querySelector('.viewer-modal .dlg-status').textContent, 'Could not finish the file');
  assert.equal(saved.length, 0);
});
test('a hostile ref stays text', async () => {
  const problems = encodeURIComponent(JSON.stringify({ total: 21, shown: [{ ref: '<img src=x onerror=alert(1)>', why: 'missing' }, { ref: 'https://x/a.png', why: 'remote' }] }));
  const { exp, doc, saved, tick } = rig({ design: WEB, routes: { export: file('page', { name: 'a.html', problems }) } });
  await exp.run('html'); await tick();
  assert.equal(saved.length, 1, 'the file still downloads');
  const dlg = doc.querySelector('.viewer-modal');
  assert.equal(dlg.querySelector('h2').textContent, 'Left out of the file');
  assert.equal(dlg.querySelector('img'), null);
  assert.ok(dlg.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.ok(dlg.textContent.includes('Not found')); assert.ok(dlg.textContent.includes('On the web, left as a link'));
  assert.ok(dlg.textContent.includes('and 19 more'));
});
test('a refusal stays in the dialog, and Try again retries', async () => {
  let n = 0; const { exp, doc, saved, tick } = rig({ design: DECK, routes: { export: () => (++n === 1 ? json(422, { error: 'PDF needs Chrome or Edge on this machine.', code: 'no-chrome' }) : file('pdf', { name: 'a.pdf' })) } });
  await exp.run('pdf'); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'PDF needs Chrome or Edge on this machine.');
  [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click(); await tick(); await tick();
  assert.equal(saved[0][0], 'a.pdf');
  assert.equal(doc.querySelector('.viewer-modal'), null);
});
test('copy into a project: defaults, the collision flow, success', async () => {
  let n = 0;
  const { exp, doc, posts, tick } = rig({ design: { ...WEB, projectKey: 'p2' }, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }, { key: 'p2', name: 'Two', exists: true }, { key: 'gone', name: 'Gone', exists: false }] },
    export: () => (++n === 1 ? json(409, { error: '2 files already exist.', code: 'exists', collisions: ['index.html', 'assets/a.png'], total: 2, collisionsKey: 'k1' }) : json(200, { ok: true, target: 'design/ship-radar', files: 12, projectKey: 'p2' })) } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  const sel = dlg.querySelector('select');
  assert.deepEqual([...sel.options].map((o) => o.value), ['p1', 'p2']); assert.equal(sel.value, 'p2');
  assert.equal(dlg.querySelector('input[type=text]').value, 'design/ship-radar');
  const go = () => [...dlg.querySelectorAll('button')].find((b) => /^(Copy|Done)$/.test(b.textContent));
  go().click(); await tick();
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p2', subdir: 'design/ship-radar' });
  assert.equal(dlg.querySelector('.dlg-status').textContent, '2 files already exist.');
  assert.ok(dlg.textContent.includes('assets/a.png'));
  assert.equal(go().disabled, true, 'Copy waits for the choice');
  dlg.querySelector('input[type=checkbox]').click();
  go().click(); await tick();
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p2', subdir: 'design/ship-radar', overwrite: true, collisionsKey: 'k1' }, 'Replace carries the key of the list it showed');
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'Copied 12 files to design/ship-radar');
  assert.equal(go().textContent, 'Done');
});
// Review cycle 2, C1: a list that grew between the 409 and Replace is a new 409, shown, and needs a new tick.
test('copy into a project: Replace sends the 409\'s key; a list that grew comes back as a new list to confirm', async () => {
  const answers = [
    json(409, { error: '1 file already exists.', code: 'exists', collisions: ['index.html'], total: 1, collisionsKey: 'k1' }),
    json(409, { error: '2 files already exist.', code: 'exists', collisions: ['assets/logo.png', 'index.html'], total: 2, collisionsKey: 'k2' }),
    json(200, { ok: true, target: 'design/ship-radar', files: 3, projectKey: 'p1' }),
  ];
  const { exp, doc, posts, tick } = rig({ design: WEB, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }] }, export: () => answers.shift() } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  const go = () => [...dlg.querySelectorAll('button')].find((b) => /^(Copy|Done)$/.test(b.textContent));
  const box = dlg.querySelector('input.dsx-replace');
  go().click(); await tick();
  box.click(); go().click(); await tick();
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p1', subdir: 'design/ship-radar', overwrite: true, collisionsKey: 'k1' });
  assert.deepEqual([...dlg.querySelector('.dsx-list').children].map((li) => li.textContent), ['assets/logo.png', 'index.html']);
  assert.deepEqual([box.checked, go().disabled, dlg.querySelector('.dlg-status').textContent], [false, true, '2 files already exist.']);
  box.click(); go().click(); await tick();
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p1', subdir: 'design/ship-radar', overwrite: true, collisionsKey: 'k2' });
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'Copied 3 files to design/ship-radar');
});
test('copy into a project: editing the folder or the project drops the collision choice; the primary waits on the POST; Done closes', async () => {
  let held = false; let release = null;
  const { exp, doc, win, posts, tick } = rig({ design: WEB, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }, { key: 'p2', name: 'Two', exists: true }] },
    export: () => (held
      ? new Promise((r) => { release = () => r(json(200, { ok: true, target: 'design/other', files: 1, projectKey: 'p2' })); })
      : json(409, { error: '3 files already exist.', code: 'exists', collisions: ['index.html'], total: 3 })) } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  const sel = dlg.querySelector('select');
  const folder = dlg.querySelector('input[type=text]');
  const go = () => [...dlg.querySelectorAll('button')].find((b) => /^(Copy|Done)$/.test(b.textContent));
  const list = () => dlg.querySelector('.dsx-list');
  assert.equal(sel.value, 'p1', 'no project on the design: the first');
  go().click(); await tick();
  assert.equal(list().hidden, false);
  assert.deepEqual([...list().children].map((li) => li.textContent), ['index.html', 'and 2 more'], 'the route lists only some of them');
  const box = dlg.querySelector('input.dsx-replace');
  box.click();
  assert.equal(go().disabled, false, 'ticked: Copy may run');
  folder.value = 'design/other'; folder.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.deepEqual([list().hidden, box.checked, go().disabled, dlg.querySelector('.dlg-status').textContent], [true, false, false, '']);
  go().click(); await tick();
  assert.equal(list().hidden, false);
  sel.value = 'p2'; sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual([list().hidden, box.checked, go().disabled], [true, false, false]);
  held = true;
  go().click();
  assert.equal(go().disabled, true, 'disabled while the POST runs');
  folder.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(go().disabled, true, 'an edit during the POST does not let a second one start');
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p2', subdir: 'design/other' });
  release(); await tick();
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'Copied 1 file to design/other');
  go().click();
  assert.equal(doc.querySelector('.viewer-modal'), null);
});
test('copy into a project: a refusal shows its words and Copy can run again', async () => {
  const { exp, doc, tick } = rig({ design: WEB, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }] },
    export: json(422, { error: 'Pick a folder inside the project.', code: 'outside-project' }) } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  const go = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Copy');
  go.click(); await tick();
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'Pick a folder inside the project.');
  assert.equal(go.disabled, false);
  assert.equal(dlg.querySelector('.dsx-list').hidden, true);
});
// Review cycle 1: C1 (a collision answer applied to another folder), M9 (Cancel hiding a copy that runs), M13 (text).
test('copy into a project: a collision answer for one folder never replaces files in another', async () => {
  let release = null;
  const { exp, doc, win, posts, tick } = rig({ design: WEB, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }, { key: 'p2', name: 'Two', exists: true }] },
    export: () => (posts.length === 1
      ? new Promise((r) => { release = () => r(json(409, { error: '1 file already exists.', code: 'exists', collisions: ['index.html'], total: 1 })); })
      : posts.length === 2 ? json(409, { error: '1 file already exists.', code: 'exists', collisions: ['index.html'], total: 1 })
        : json(200, { ok: true, target: 'design/c', files: 3, projectKey: 'p1' })) } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  const sel = dlg.querySelector('select');
  const folder = dlg.querySelector('input[type=text]');
  const go = () => [...dlg.querySelectorAll('button')].find((b) => /^(Copy|Done)$/.test(b.textContent));
  go().click();
  assert.deepEqual([sel.disabled, folder.disabled], [true, true], 'the target cannot change while its copy is asked');
  folder.value = 'design/b'; folder.dispatchEvent(new win.Event('input', { bubbles: true }));
  release(); await tick();
  assert.deepEqual([sel.disabled, folder.disabled], [false, false]);
  assert.equal(dlg.querySelector('.dsx-replace-row').hidden, true, 'the answer was about design/ship-radar: nothing is offered for design/b');
  dlg.querySelector('input.dsx-replace').click();
  go().click(); await tick();
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p1', subdir: 'design/b' }, 'no overwrite for a folder never checked');
  assert.equal(dlg.querySelector('.dsx-replace-row').hidden, false, 'design/b has its own collision now');
  folder.value = 'design/c';   // a value changed with no input event (autofill, an extension)
  dlg.querySelector('input.dsx-replace').click();
  go().click(); await tick();
  assert.deepEqual(posts.at(-1).body, { format: 'project', projectKey: 'p1', subdir: 'design/c' }, 'the answer for design/b replaces nothing in design/c');
});
test('copy into a project: while the copy runs nothing closes the dialog, so its answer is always shown', async () => {
  let release = null;
  const { exp, doc, win, tick } = rig({ design: WEB, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }] },
    export: () => new Promise((r) => { release = () => r(json(500, { error: 'Copied 3 of 12 files, then: EACCES.', code: 'partial', copied: 3, total: 12 })); }) } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  const cancel = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
  [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Copy').click();
  assert.equal(cancel.disabled, true);
  cancel.dispatchEvent(new win.Event('click', { bubbles: true }));   // fires on a disabled button too
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.querySelector('.viewer-modal'), dlg, 'Cancel and Escape wait for the answer');
  release(); await tick();
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'Copied 3 of 12 files, then: EACCES.');
  assert.equal(cancel.disabled, false);
  cancel.click();
  assert.equal(doc.querySelector('.viewer-modal'), null, 'and closes once it is in');
});
test('a hostile refusal and a hostile collision name stay text, in the download and the copy dialogs', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { exp, doc, tick } = rig({ design: WEB, routes: { projects: { projects: [{ key: 'p1', name: 'One', exists: true }] },
    export: (init) => (JSON.parse(init.body).format === 'project'
      ? (JSON.parse(init.body).overwrite ? json(422, { error: `${evil} is a link, so nothing was copied.`, code: 'link' }) : json(409, { error: evil, code: 'exists', collisions: [evil], total: 1, collisionsKey: 'k' }))
      : json(422, { error: evil, code: 'no-pdf' })) } });
  await exp.run('zip'); await tick();
  let dlg = doc.querySelector('.viewer-modal');
  assert.deepEqual([dlg.querySelector('img'), dlg.querySelector('.dlg-status').textContent], [null, evil]);
  [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Close').click();
  await exp.openProject(); await tick();
  dlg = doc.querySelector('.viewer-modal');
  const go = () => [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Copy');
  go().click(); await tick();
  assert.equal(dlg.querySelector('img'), null);
  assert.equal(dlg.querySelector('.dlg-status').textContent, evil);
  assert.deepEqual([...dlg.querySelector('.dsx-list').children].map((li) => li.textContent), [evil]);
  dlg.querySelector('input.dsx-replace').click();
  go().click(); await tick();
  assert.deepEqual([dlg.querySelector('img'), dlg.querySelector('.dlg-status').textContent], [null, `${evil} is a link, so nothing was copied.`]);
});
test('no projects: says so and cannot copy', async () => {
  const { exp, doc, tick } = rig({ design: WEB, routes: { projects: { projects: [] } } });
  await exp.openProject(); await tick();
  const dlg = doc.querySelector('.viewer-modal');
  assert.equal(dlg.querySelector('.dlg-status').textContent, 'No projects yet');
  assert.equal([...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Copy').disabled, true);
  assert.equal(dlg.querySelector('select').disabled, true, 'nothing to pick');
});
test('destroy takes the button, the menu and an open dialog, and stops a download in flight', async () => {
  const hang = new Promise(() => {}); const { exp, doc, signals, tick } = rig({ design: DECK, showAfterMs: 0, routes: { export: () => hang } });
  void exp.run('pdf'); await tick(); await tick();
  assert.ok(doc.querySelector('.viewer-modal'));
  exp.destroy();
  assert.deepEqual([doc.querySelector('.dz-menu-anchor').children.length, doc.querySelector('.viewer-modal'), signals[0].aborted], [0, null, true]);
});
test('destroy before the dialog shows: no dialog later, the request stopped', async () => {
  const hang = new Promise(() => {}); const { exp, doc, signals } = rig({ design: DECK, showAfterMs: 5, routes: { export: () => hang } });
  void exp.run('pdf');
  exp.destroy();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual([doc.querySelector('.viewer-modal'), signals[0].aborted], [null, true]);
});
test('decodeProblems and dispositionName read the route\'s headers, and nothing else', () => {
  const enc = (v) => encodeURIComponent(JSON.stringify(v));
  assert.deepEqual(decodeProblems(enc({ total: 3, shown: [{ ref: 'a.png', why: 'missing' }] })), { total: 3, shown: [{ ref: 'a.png', why: 'missing' }] });
  for (const bad of [null, '', '%E0%A4%A', '{', enc([]), enc({ total: 'x', shown: [] }), enc({ total: -1, shown: [{ ref: 'a', why: 'missing' }] })]) assert.deepEqual(decodeProblems(bad), { total: 0, shown: [] }, String(bad));
  assert.deepEqual(decodeProblems(enc({ total: 2, shown: [{ ref: 'a', why: 'missing' }, null, { ref: 3 }] })), { total: 2, shown: [{ ref: 'a', why: 'missing' }] });
  assert.equal(dispositionName('attachment; filename="ship-radar.zip"', 'x.zip'), 'ship-radar.zip');
  assert.equal(dispositionName(`attachment; filename="_ber.html"; filename*=UTF-8''%C3%BCber.html`, 'x.html'), 'über.html');
  assert.equal(dispositionName(`attachment; filename*=UTF-8''%E0%A4%A`, 'x.html'), 'x.html');
  assert.equal(dispositionName(null, 'ship-radar.pdf'), 'ship-radar.pdf');
});
test('saveBlob: a hidden download link, clicked, the URL let go of later', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doms.push(dom);
  const { window: win } = dom;
  const seen = [];
  win.URL.createObjectURL = () => 'blob:x/1';
  win.URL.revokeObjectURL = (u) => seen.push(`revoke ${u}`);
  win.HTMLAnchorElement.prototype.click = function click() { seen.push(`click ${this.download} ${this.getAttribute('href')} ${this.isConnected} ${this.hidden}`); };
  const later = [];
  win.setTimeout = (fn, ms) => { later.push([fn, ms]); return later.length; };
  saveBlob('ship-radar.zip', new Blob(['z']), win.document);
  assert.deepEqual([seen, win.document.querySelector('a'), later.length], [['click ship-radar.zip blob:x/1 true true'], null, 1]);
  assert.ok(later[0][1] >= 1000, 'not at once: Firefox drops a download whose URL is revoked under it');
  later[0][0]();
  assert.deepEqual(seen.at(-1), 'revoke blob:x/1');
});
// A video exports as an MP4: the server renders it as a job, so the dialog opens at once, shows how far the render is
// on a bar from 0 to 100 %, and saves the file when it is ready. Stop (or closing the dialog) stops the render.
const VIDEO = { ...WEB, id: 'd_0000000000a3', kind: 'video', title: 'Clay Day' };
const mp4File = (name = 'clay-day.mp4') => ({
  ok: true, status: 200, headers: new Headers({ 'content-type': 'video/mp4', 'content-disposition': `attachment; filename="${name}"` }),
  blob: async () => new Blob(['mp4'], { type: 'video/mp4' }),
});
const rendering = (done, total = 5244) => json(200, { state: 'rendering', done, total, key: 'k1' });
const READY = { state: 'ready', key: 'k1', bytes: 3, frames: 5244, seconds: 87.4, problems: { total: 0, shown: [] } };
const until = async (pred) => { for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 2)); assert.ok(pred(), 'never happened'); };
const statusOf = (doc) => doc.querySelector('.viewer-modal .dlg-status')?.textContent;
const buttonsOf = (doc) => [...doc.querySelectorAll('.viewer-modal .confirm-actions button')].map((b) => b.textContent);
const press = (doc, text) => [...doc.querySelectorAll('.viewer-modal button')].find((b) => b.textContent === text).click();
const barOf = (doc) => doc.querySelector('.viewer-modal [role="progressbar"]');
/** What the bar says, three ways: to a screen reader, as its fill's width, and as the number beside it. */
const barSays = (doc) => { const b = barOf(doc); return b ? [b.getAttribute('aria-valuenow'), b.firstElementChild.style.width, doc.querySelector('.viewer-modal .dsx-pct').textContent] : null; };

test('a video\'s menu has Video (MP4), with its icon, between the zip and the copy', () => {
  const { exp, doc } = rig({ design: VIDEO });
  exp.toggle();
  const items = [...doc.querySelectorAll('.menu.dz-export .menu-item')];
  assert.deepEqual(items.map((b) => b.querySelector('span').textContent), ['Standalone HTML', 'Zip of the folder', 'Video (MP4)', 'Copy into a project']);
  assert.ok(items[2].querySelector('svg[aria-hidden="true"]'));
});
test('filmPercent: whole per cent of the frames, rounded down, never under 0 or over 100', () => {
  const cases = [[0, 5244, 0], [2310, 5244, 44], [5243, 5244, 99], [5244, 5244, 100], [6000, 5244, 100], [-3, 10, 0], [5, 0, 0], [NaN, 10, 0], [undefined, undefined, 0], ['5', 10, 0]];
  for (const [done, total, pct] of cases) assert.equal(filmPercent(done, total), pct, `${done} of ${total}`);
});
test('video: the dialog opens at once, follows the render on a bar from 0 to 100 %, then saves the file and goes', async () => {
  let release; const first = new Promise((r) => { release = r; });
  const { exp, doc, posts, saved, polls, fileGets, deletes } = rig({ design: VIDEO, pollMs: 1,
    routes: { export: () => first, mp4: [rendering(2310), json(200, { state: 'queued', done: 0, total: 5244, key: 'k1' }), rendering(5244), READY], mp4File: mp4File() } });
  exp.toggle(); doc.querySelectorAll('.menu.dz-export .menu-item')[2].click();
  await until(() => statusOf(doc) !== undefined);
  assert.deepEqual([doc.querySelector('.viewer-modal h2').textContent, statusOf(doc), buttonsOf(doc)], ['Video (MP4)', 'Getting the video ready…', ['Stop']]);
  assert.deepEqual(barSays(doc), ['0', '0%', '0%'], 'the bar is there from the start, empty');
  assert.deepEqual([barOf(doc).getAttribute('aria-valuemin'), barOf(doc).getAttribute('aria-valuemax'), barOf(doc).getAttribute('aria-label')], ['0', '100', 'Video (MP4)']);
  assert.deepEqual(posts, [{ url: `/api/design/${VIDEO.id}/export`, body: { format: 'mp4' } }]);
  // Everything the dialog shows, however briefly: its line with the bar's three readings, and all of its words.
  const seen = new Set(); const words = new Set(); const bar = barOf(doc);
  new doc.defaultView.MutationObserver(() => {
    if (!doc.querySelector('.viewer-modal')) return;
    seen.add(`${statusOf(doc)} ${barSays(doc)}`); words.add(doc.querySelector('.viewer-modal').textContent);
    assert.equal(barOf(doc), bar, 'one bar from start to end, so its fill can glide');
  }).observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true });
  release(json(202, { state: 'rendering', done: 0, total: 5244, key: 'k1' }));
  await until(() => saved.length === 1);
  for (const line of ['Rendering the video… 0,0%,0%', 'Rendering the video… 44,44%,44%', 'Waiting for another video to finish… 0,0%,0%', 'Rendering the video… 100,100%,100%', 'Saving the video… 100,100%,100%']) assert.ok(seen.has(line), `${line} in ${[...seen]}`);
  for (const text of words) assert.doesNotMatch(text, /frame|5,?244|2,?310/, 'the bar says it: no frame counts');
  assert.deepEqual([saved[0][0], saved[0][1].type, fileGets, deletes], ['clay-day.mp4', 'video/mp4', ['k1'], []]);
  assert.equal(doc.querySelector('.viewer-modal'), null, 'nothing left to say');
  const asked = polls.length; await new Promise((r) => setTimeout(r, 15));
  assert.equal(polls.length, asked, 'it stops asking once the file is saved');
});
test('video: a round whose file is already there saves at once', async () => {
  const { exp, doc, saved, polls, fileGets } = rig({ design: VIDEO, routes: { export: READY, mp4File: mp4File() } });
  await exp.run('mp4');
  assert.deepEqual([saved.length, saved[0][0], fileGets, polls], [1, 'clay-day.mp4', ['k1'], []]);
  assert.equal(doc.querySelector('.viewer-modal'), null);
});
test('video: Stop stops the render on the server, closes the dialog, and a late answer paints nothing', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const { exp, doc, saved, polls, deletes } = rig({ design: VIDEO, pollMs: 1, routes: { export: rendering(10), mp4: () => held, mp4File: mp4File() } });
  void exp.run('mp4');
  await until(() => polls.length === 1);
  press(doc, 'Stop');
  assert.deepEqual([deletes, doc.querySelector('.viewer-modal')], [[`/api/design/${VIDEO.id}/export/mp4`], null]);
  release(json(200, READY)); await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual([saved, polls.length, doc.querySelector('.viewer-modal')], [[], 1, null]);
});
test('video: a render that failed, a server that forgot the job and a dropped connection each say so; Try again starts over', async () => {
  const cases = [
    [json(200, { state: 'failed', error: 'Could not make the video.' }), 'Could not make the video.'],
    [json(200, { state: 'none' }), 'Could not finish the file'],
    [() => { throw new Error('offline'); }, 'Could not finish the file'],
    [json(500, { error: 'Could not make the file.' }), 'Could not make the file.'],
  ];
  for (const [answer, words] of cases) {
    const { exp, doc, posts, deletes } = rig({ design: VIDEO, pollMs: 1, routes: { export: rendering(0), mp4: answer } });
    void exp.run('mp4');
    await until(() => statusOf(doc) === words);
    assert.deepEqual(buttonsOf(doc), ['Close', 'Try again'], words);
    assert.ok(doc.querySelector('.viewer-modal .dlg-status').classList.contains('is-err'));
    assert.equal(barOf(doc), null, 'no bar beside words that say it failed');
    press(doc, 'Try again');
    await until(() => posts.length === 2);
    assert.deepEqual([posts[1].body, deletes], [{ format: 'mp4' }, []], words);
  }
});
test('video: a refusal of the start (no ffmpeg) stays in the dialog as words, never as markup', async () => {
  const words = 'Video needs ffmpeg on this machine. <img src=x onerror=alert(1)>';
  const { exp, doc, polls } = rig({ design: VIDEO, routes: { export: json(422, { error: words, code: 'no-ffmpeg' }) } });
  await exp.run('mp4');
  assert.deepEqual([statusOf(doc), buttonsOf(doc), polls], [words, ['Close', 'Try again'], []]);
  assert.equal(doc.querySelector('.viewer-modal img'), null);
});
test('video: a file that is gone when it is fetched says so; what was left out of the video is listed after it is saved', async () => {
  const gone = rig({ design: VIDEO, routes: { export: READY } });
  await gone.exp.run('mp4');
  assert.deepEqual([statusOf(gone.doc), gone.saved], ['That video is no longer there. Export it again.', []]);
  const left = { ...READY, problems: { total: 3, shown: [{ ref: 'https://x.dev/a.png', why: 'remote' }, { ref: '<b>bad</b>', why: 'missing' }] } };
  const { exp, doc, saved } = rig({ design: VIDEO, routes: { export: left, mp4File: mp4File() } });
  await exp.run('mp4');
  assert.equal(saved.length, 1);
  assert.equal(doc.querySelector('.viewer-modal h2').textContent, 'Left out of the file');
  assert.equal(barOf(doc), null);
  assert.deepEqual([...doc.querySelectorAll('.viewer-modal .dsx-list li')].map((li) => li.textContent), ['https://x.dev/a.pngOn the web, left as a link', '<b>bad</b>Not found']);
  assert.equal(doc.querySelector('.viewer-modal .dsx-more').textContent, 'and 1 more');
});
test('video: one render at a time in the dialog; destroy stops asking and leaves the render to finish', async () => {
  const { exp, doc, posts, polls, deletes } = rig({ design: VIDEO, pollMs: 1, routes: { export: rendering(0), mp4: rendering(5) } });
  void exp.run('mp4');
  await until(() => polls.length >= 1);
  await exp.run('mp4'); await exp.run('html');
  assert.equal(posts.length, 1, 'a second export waits for the first');
  exp.destroy();
  const asked = polls.length; await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual([polls.length, deletes, doc.querySelector('.viewer-modal')], [asked, [], null]);
});

test('css: no accent edge on the export menu or dialog', () => {   // radii: ui-design-language
  for (const r of cssRules(readFileSync(new URL('../ui/public/design/design.css', import.meta.url), 'utf8')).filter((x) => /\.dz-export|\.dsx-/.test(x.sel))) assert.doesNotMatch(r.body, /border-left/, r.sel);
});
test('css: the video\'s bar is a quiet track with an ink fill, and holds still for reduced motion', () => {
  const css = readFileSync(new URL('../ui/public/design/design.css', import.meta.url), 'utf8');
  const rule = (sel) => cssRules(css).find((x) => x.sel === sel)?.body ?? '';
  assert.match(rule('.dsx-bar'), /background:var\(--line-2\)/);
  assert.match(rule('.dsx-bar'), /overflow:hidden/);
  assert.match(rule('.dsx-bar i'), /background:var\(--ink\)/);
  assert.match(rule('.dsx-bar i'), /transition:width/);
  const still = cssRules(css).filter((x) => /prefers-reduced-motion/.test(x.media) && x.sel.split(',').map((t) => t.trim()).includes('.dsx-bar i'));
  assert.ok(still.length === 1 && /transition:none/.test(still[0].body), 'no glide under reduced motion');
});
