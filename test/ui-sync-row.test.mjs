// test/ui-sync-row.test.mjs — New pipeline: the two-phase branch list and the Branches table
// (#527, plan §6.4 / §6.6 host side / §6.8; design v3: one table for a project or a workspace,
// "Use branches from Origin · latest | Local copy", and a "What the run gets" cell per row). Boot copied from
// test/ui-workspace-source-branches.test.mjs, with a fake socket (ui-history-shipit.test.mjs:33-48)
// and per-test stubs for /api/branches, /api/sync and /api/run that can hold a response.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast, cardAlertOf } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [{ name: 'web', path: '/a/web', exists: true }, { name: 'api', path: '/a/api', exists: true }];
const WORKSPACES = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# x',
    projectPaths: ['/a/web', '/a/api'], projectKeys: ['web-aaaa1111', 'api-bbbb2222'],
    exists: [true, true], createdAt: 'x', updatedAt: 'x' },
];
const CACHED = {
  '/a/web': { branches: ['dev', 'release'], current: 'dev' },
  '/a/api': { branches: ['main', 'api-only'], current: 'main' },
};
const NOW = new Date().toISOString();
const block = (base = 'dev', over = {}) => ({
  base, remote: 'origin', remoteLabel: 'github.com/acme/web', state: 'behind', ahead: 0, behind: 3,
  dirty: false, dirtyCount: 0, checkedOutHere: true, shallow: false, fetchedAt: NOW, stale: false,
  local: { sha: 'aaaaaaa1', at: NOW }, remoteTip: { sha: 'bbbbbbb2', at: NOW },
  incoming: [{ sha: 'c0ffee1234', at: NOW, author: 'Ana', subject: 'Fix the thing' }],
  settings: { beforeRun: true, onDiverged: 'ask' }, ...over,
});
// As GET /api/branches?fresh=1 (server.mjs): the list's stale/fetchError are copied into its sync block.
const freshBody = (dir, over = {}) => {
  const b = {
    ...CACHED[dir], remote: { name: 'origin', branches: [...CACHED[dir].branches, 'feat/remote'] },
    sync: block(CACHED[dir].current), fetchedAt: NOW, stale: false, ...over,
  };
  if (b.sync && 'stale' in over) b.sync = { ...b.sync, stale: b.stale, ...(b.fetchError ? { fetchError: b.fetchError } : {}) };
  return b;
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** A promise the test resolves later: `hold()` → { promise, release(value) }. */
function hold() {
  let release;
  const promise = new Promise((r) => { release = r; });
  return { promise, release };
}

async function boot({ fresh = null, syncGet = null, syncPost = null, run = null, workspaces = [] } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = [];
  const posted = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: PROJECTS }));
    if (u.includes('/api/workspaces')) return Promise.resolve(ok({ workspaces }));
    if (u.includes('/api/branches')) {
      const q = new URL(u, 'http://x').searchParams;
      const dir = q.get('projectDir') || '';
      if (q.get('fresh') === '1') {
        const r = fresh ? fresh(dir, q) : freshBody(dir);
        return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
      }
      return Promise.resolve(ok(CACHED[dir] || { branches: [], current: '' }));
    }
    if (u.includes('/api/sync') && method === 'GET') {
      const q = new URL(u, 'http://x').searchParams;
      const r = syncGet ? syncGet(q) : { sync: block(q.get('base') || 'dev') };
      return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
    }
    if (u.includes('/api/sync') && method === 'POST') {
      const body = JSON.parse(opts.body);
      const r = syncPost ? syncPost(body) : { ok: true, sync: block(body.base, { state: 'up-to-date', behind: 0 }) };
      return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
    }
    if (u.endsWith('/api/run') && method === 'POST') {
      const body = JSON.parse(opts.body);
      posted.push(body);
      const r = run ? run(body, posted.length) : { runId: `run-${posted.length}` };
      return Promise.resolve(r).then((b) => (b && b.status ? b : ok(b)));
    }
    return Promise.resolve(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runTarget', 'project');
  window.localStorage.setItem('worca-cc.lastProject', 'web');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, doc: window.document, calls, posted, recv };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await tick();
  }
}
const $ = (doc, sel) => doc.querySelector(sel);
const change = (window, node) => node.dispatchEvent(new window.Event('change', { bubbles: true }));
const click = (window, node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
// The project row's "What the run gets" cell, and whether the Origin/Local choice is offered.
const outcomeText = (doc) => $(doc, '#bt-project-outcome .bt-text')?.textContent || '';
const outcomeTone = (doc) => (/tone-(\w+)/.exec($(doc, '#bt-project-outcome').className) || [])[1];
const rowShown = (doc) => !$(doc, '#branches-mode-wrap').hidden;
const pressed = (doc, mode) => $(doc, `#branches-mode-${mode}`).getAttribute('aria-pressed') === 'true';
const memberTexts = (doc) => [...doc.querySelectorAll('#ws-source-branches .ws-src-row .bt-text')].map((n) => n.textContent);
const memberTones = (doc) => [...doc.querySelectorAll('#ws-source-branches .ws-src-row .bt-outcome')].map((n) => (/tone-(\w+)/.exec(n.className) || [])[1]);
const optionValues = (sel) => [...sel.options].map((o) => o.value);
const syncGets = (calls) => calls.filter((c) => c.url.includes('/api/sync') && c.method === 'GET');
async function submit(ctx) {
  $(ctx.doc, '#prompt').value = 'do work';
  const n = ctx.posted.length;
  $(ctx.doc, '#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => ctx.posted.length > n);
  await tick(); await tick();
}

test('1. cached list first, then the fresh swap adds Remote only and says what the run gets', async () => {
  const ctx = await boot();
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => rowShown(ctx.doc));
  const grp = [...sel.querySelectorAll('optgroup')].find((g) => g.label === 'Remote only');
  assert.ok(grp, 'a Remote only group');
  assert.deepEqual([...grp.children].map((o) => o.value), ['feat/remote']);
  assert.equal(grp.children[0].dataset.remoteOnly, '1');
  assert.equal(sel.value, 'dev', 'HEAD stays selected');
  assert.equal(outcomeText(ctx.doc), 'Gets 3 new commits from origin first');
  assert.equal(outcomeTone(ctx.doc), 'blue');
  assert.equal($(ctx.doc, '#bt-project-name').textContent, 'web', 'a project run is the table with one row');
});

test('2. the fresh phase is not awaited: the cached list is usable while it is held', async () => {
  const h = hold();
  const ctx = await boot({ fresh: () => h.promise });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  assert.deepEqual(optionValues(sel), ['', 'dev', 'release']);
  assert.equal(rowShown(ctx.doc), false, 'no choice before the fresh answer');
  assert.equal(outcomeText(ctx.doc), 'Checking…');
  h.release(freshBody('/a/web'));
  await waitFor(() => rowShown(ctx.doc));
});

test('3. a late fresh answer for the previous project never repaints the new one', async () => {
  const h = hold();
  const ctx = await boot({ fresh: (dir) => (dir === '/a/web' ? h.promise : freshBody(dir)) });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  const proj = $(ctx.doc, '#projectSelect');
  proj.value = '/a/api'; change(ctx.window, proj);
  await waitFor(() => sel.dataset.current === 'main' && rowShown(ctx.doc));
  h.release(freshBody('/a/web', { remote: { name: 'origin', branches: ['dev', 'web-only'] } }));
  await tick(); await tick();
  assert.equal(optionValues(sel).includes('web-only'), false);
  assert.equal(optionValues(sel).includes('api-only'), true);
  assert.equal(outcomeText(ctx.doc), 'Gets 3 new commits from origin first');
});

test('4. a prefilled value that is not in the fresh list survives the swap', async () => {
  const h = hold();
  const ctx = await boot({ fresh: () => h.promise });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  const opt = ctx.doc.createElement('option'); opt.value = 'feat/pre'; opt.textContent = 'feat/pre';
  sel.appendChild(opt); sel.value = 'feat/pre';
  h.release(freshBody('/a/web'));
  await waitFor(() => [...sel.querySelectorAll('optgroup')].some((g) => g.label === 'Remote only'));
  assert.equal(sel.value, 'feat/pre');
});

test('5. the choice is sent only when touched, and reset after an accepted start', async () => {
  const ctx = await boot();
  await waitFor(() => rowShown(ctx.doc));
  assert.equal(pressed(ctx.doc, 'origin'), true, 'the project default (beforeRun:true) reads Origin · latest');
  await submit(ctx);
  assert.equal('syncBeforeStart' in ctx.posted[0], false, 'untouched: nothing sent');
  click(ctx.window, $(ctx.doc, '#branches-mode-local'));
  assert.equal(pressed(ctx.doc, 'local'), true);
  assert.equal(outcomeText(ctx.doc), 'Misses 3 newer commits on origin');
  assert.equal(outcomeTone(ctx.doc), 'amber', 'Local copy turns a behind row amber');
  await submit(ctx);
  assert.equal(ctx.posted[1].syncBeforeStart, false);
  assert.equal(pressed(ctx.doc, 'origin'), true, 'after the start the choice shows the project default again');
  await submit(ctx);
  assert.equal('syncBeforeStart' in ctx.posted[2], false, 'the choice was for that run only');
});

test('6. a diverged project set to stop blocks Start under Origin; Local copy unblocks it', async () => {
  const ctx = await boot({ fresh: (dir) => freshBody(dir, { sync: block('dev', { state: 'diverged', ahead: 2, behind: 5, settings: { beforeRun: true, onDiverged: 'fail' } }) }) });
  await waitFor(() => rowShown(ctx.doc) && outcomeText(ctx.doc) === 'Can’t start from origin');
  assert.equal(outcomeTone(ctx.doc), 'red');
  assert.match($(ctx.doc, '#bt-project-outcome .bt-note').textContent, /2 unpushed commits would be left out/);
  assert.equal($(ctx.doc, '#branches-blocked').hidden, false);
  $(ctx.doc, '#prompt').value = 'do work';
  $(ctx.doc, '#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(ctx.posted.length, 0, 'Start is refused before any request');
  assert.match(cardAlertOf($(ctx.doc, '#run-form')).detail, /can’t start from origin yet/);   // #555: a card alert above Start
  click(ctx.window, $(ctx.doc, '#branches-mode-local'));
  assert.equal(outcomeText(ctx.doc), 'Includes your 2 unpushed commits');
  assert.equal($(ctx.doc, '#branches-blocked').hidden, true);
  await submit(ctx);
  assert.equal(ctx.posted[0].syncBeforeStart, false);
});

test('7. a failed fetch says origin can’t be reached, with Retry; Local copy needs no fetch', async () => {
  const ctx = await boot({ fresh: (dir) => freshBody(dir, { stale: true, fetchError: { kind: 'auth' } }) });
  await waitFor(() => rowShown(ctx.doc) && /Can’t reach origin/.test(outcomeText(ctx.doc)));
  assert.ok($(ctx.doc, '#bt-project-outcome .bt-retry'), 'Retry is the only row button');
  click(ctx.window, $(ctx.doc, '#branches-mode-local'));
  assert.equal(outcomeText(ctx.doc), 'Uses your local dev');
  assert.equal($(ctx.doc, '#bt-project-outcome .bt-retry'), null);
  click(ctx.window, $(ctx.doc, '#branches-mode-origin'));
  click(ctx.window, $(ctx.doc, '#bt-project-outcome .bt-retry'));
  await waitFor(() => outcomeText(ctx.doc) === 'Up to date');
});

test('a 409 sync-diverged asks once: Start from origin/dev resends with syncPolicy; options:[cancel] offers no Start and Cancel reports it', async () => {
  await checkRows([
    { name: '8. a 409 sync-diverged asks once; Start from origin/dev resends with syncPolicy', run: async () => {
      const refusal = { code: 'sync-diverged', error: 'dev diverged', options: ['origin', 'cancel'],
        members: [{ projectKey: 'web', base: 'dev', remote: 'origin', ahead: 1, behind: 2 }] };
      const ctx = await boot({ run: (body, n) => (n === 1 ? ok(refusal, 409) : { runId: 'r-ok' }) });
      await waitFor(() => rowShown(ctx.doc));
      await submit(ctx);
      await waitFor(() => $(ctx.doc, '.sync-modal'));
      const go = [...$(ctx.doc, '.sync-modal').querySelectorAll('button')].find((b) => b.textContent === 'Start from origin/dev');
      assert.ok(go, 'the recommended option');
      click(ctx.window, go);
      await waitFor(() => ctx.posted.length === 2);
      assert.equal(ctx.posted[1].syncPolicy, 'origin');
      assert.equal(ctx.posted[1].projectDir, '/a/web', 'the resend keeps the body');
    } },
    { name: '8b. options:[cancel] offers no Start button; Cancel reports it', run: async () => {
      const refusal = { code: 'sync-diverged', error: 'dev diverged', options: ['cancel'],
        members: [{ projectKey: 'web', base: 'dev', remote: 'origin', ahead: 1, behind: 2 }] };
      const ctx = await boot({ run: () => ok(refusal, 409) });
      await waitFor(() => rowShown(ctx.doc));
      await submit(ctx);
      await waitFor(() => $(ctx.doc, '.sync-modal'));
      const btns = [...$(ctx.doc, '.sync-modal').querySelectorAll('button')].map((b) => b.textContent);
      assert.deepEqual(btns, ['Cancel']);
      click(ctx.window, $(ctx.doc, '.sync-modal button'));
      await waitFor(() => lastToast(ctx.doc)?.title === 'Start cancelled' && !$(ctx.doc, '#start-btn').dataset.fbState);   // #555: a warn toast
      assert.equal(ctx.posted.length, 1);
      assert.equal($(ctx.doc, '#start-btn').disabled, false);
    } },
  ]);
});

test('9. a project without the remote offers no choice and says it uses the local copy', async () => {
  const ctx = await boot({ fresh: (dir) => ({ ...CACHED[dir], remote: null, sync: null, stale: false }) });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  await waitFor(() => outcomeText(ctx.doc) === 'No remote · uses your local copy');
  assert.equal(rowShown(ctx.doc), false);
});

test('10. Retry keeps the chosen base and does not reload the branch list', async () => {
  const off = { stale: true, fetchError: { kind: 'network' } };
  const ctx = await boot({ fresh: (dir) => freshBody(dir, off), syncGet: (q) => ({ sync: block(q.get('base') || 'dev', off) }) });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => rowShown(ctx.doc));
  sel.value = 'release'; change(ctx.window, sel);
  await waitFor(() => syncGets(ctx.calls).some((c) => c.url.includes('base=release')));
  await waitFor(() => $(ctx.doc, '#bt-project-outcome .bt-retry'));
  const lists = ctx.calls.filter((c) => c.url.includes('/api/branches')).length;
  click(ctx.window, $(ctx.doc, '#bt-project-outcome .bt-retry'));
  await waitFor(() => ctx.calls.some((c) => c.method === 'POST' && c.url.includes('/api/sync')));
  const post = ctx.calls.find((c) => c.method === 'POST' && c.url.includes('/api/sync'));
  assert.deepEqual(post.body, { projectDir: '/a/web', base: 'release', mode: 'ff' });
  await waitFor(() => outcomeText(ctx.doc) === 'Up to date');
  assert.equal(sel.value, 'release');
  assert.equal(ctx.calls.filter((c) => c.url.includes('/api/branches')).length, lists);
});

test('11. a base prefilled without a change event is painted from its own status read', async () => {
  const h = hold();
  const ctx = await boot({ fresh: () => h.promise, syncGet: (q) => ({ sync: block(q.get('base'), { behind: 7 }) }) });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  const opt = ctx.doc.createElement('option'); opt.value = 'feat/x'; opt.textContent = 'feat/x';
  sel.appendChild(opt); sel.value = 'feat/x';
  h.release(freshBody('/a/web'));
  await waitFor(() => rowShown(ctx.doc) && syncGets(ctx.calls).some((c) => c.url.includes('base=feat%2Fx')));
  await waitFor(() => outcomeText(ctx.doc) === 'Gets 7 new commits from origin first');
});

test('12. an explicit "current branch (auto)" survives the swap', async () => {
  const h = hold();
  const ctx = await boot({ fresh: () => h.promise });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  sel.value = '';
  h.release(freshBody('/a/web'));
  await waitFor(() => [...sel.querySelectorAll('optgroup')].some((g) => g.label === 'Remote only'));
  assert.equal(sel.value, '');
});

test('13. switching to workspace mid-fetch drops the project fresh answer', async () => {
  const h = hold();
  const ctx = await boot({ fresh: () => h.promise, workspaces: WORKSPACES });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => sel.dataset.current === 'dev');
  click(ctx.window, $(ctx.doc, '#target-seg button[data-target="workspace"]'));
  await tick();
  h.release(freshBody('/a/web'));
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(optionValues(sel), [''], 'only the stand-in placeholder');
  assert.equal(rowShown(ctx.doc), false);
});

test('14. the server echo does not drop the Retry answer; a refusal is reported', async () => {
  const off = { stale: true, fetchError: { kind: 'network' } };
  const h = hold();
  const answer = { ok: true, sync: block('dev', { ff: { ok: false, kind: 'dirty' } }) };
  const ctx = await boot({ fresh: (dir) => freshBody(dir, off), syncPost: () => h.promise });
  await waitFor(() => $(ctx.doc, '#bt-project-outcome .bt-retry'));
  click(ctx.window, $(ctx.doc, '#bt-project-outcome .bt-retry'));
  await tick();
  assert.equal($(ctx.doc, '#bt-project-outcome .bt-retry').disabled, true, 'busy while the POST is in flight');
  const gets = syncGets(ctx.calls).length;
  ctx.recv({ type: 'project-sync-changed', action: 'web' });
  await tick(); await tick();
  assert.equal(syncGets(ctx.calls).length, gets, 'no status read while the POST is in flight');
  h.release(answer);
  await waitFor(() => /uncommitted changes/.test($(ctx.doc, '#form-msg').textContent));
  assert.equal(outcomeText(ctx.doc), 'Gets 3 new commits from origin first');
});

// The server's status read reports its own standing fetch failure (git-sync negative cache), so
// the row follows the server, never a browser-clock comparison.
test('15. Offline follows the server\'s status read', async () => {
  const off = { stale: true, fetchError: { kind: 'network' } };
  let offline = true;
  const ctx = await boot({
    fresh: (dir) => freshBody(dir, off),
    syncGet: (q) => ({ sync: block(q.get('base') || 'dev', offline ? off : { fetchedAt: '2020-01-01T00:00:00.000Z' }) }),
  });
  const sel = $(ctx.doc, '#sourceBranch');
  await waitFor(() => rowShown(ctx.doc) && /Can’t reach origin/.test(outcomeText(ctx.doc)));
  sel.value = 'release'; change(ctx.window, sel);
  await waitFor(() => syncGets(ctx.calls).some((c) => c.url.includes('base=release')));
  await tick(); await tick();
  assert.match(outcomeText(ctx.doc), /Can’t reach origin/);
  // A good fetch since (the server says stale:false) clears it, whatever fetchedAt says about
  // the browser's clock (a hosted server's clock can be behind it).
  offline = false;
  sel.value = 'dev'; change(ctx.window, sel);
  await waitFor(() => outcomeText(ctx.doc) === 'Gets 3 new commits from origin first');
});

test('Status unknown: a base the server cannot sync, a 200 {state:"unknown"}, and a 500/lost connection on another branch all read Status unknown — never the previous branch\'s outcome', async () => {
  await checkRows([
    { name: '15b. a base the server cannot sync reads Status unknown without asking (no 400 in the console)', run: async () => {
      const ctx = await boot({ syncGet: (q) => (q.get('base') === 'plus+branch'
        ? { sync: { base: 'plus+branch', remote: 'origin', state: 'unknown', reason: 'not-a-branch', settings: { beforeRun: true, onDiverged: 'ask' } } }
        : { sync: block(q.get('base') || 'dev') }) });
      const sel = $(ctx.doc, '#sourceBranch');
      await waitFor(() => rowShown(ctx.doc) && outcomeText(ctx.doc) === 'Gets 3 new commits from origin first');
      const gets = syncGets(ctx.calls).length;
      const opt = ctx.doc.createElement('option'); opt.value = 'plus+branch'; opt.textContent = 'plus+branch';
      sel.appendChild(opt); sel.value = 'plus+branch'; change(ctx.window, sel);
      await waitFor(() => outcomeText(ctx.doc) === 'Status unknown');
      assert.equal(syncGets(ctx.calls).length, gets, 'no GET /api/sync for a base the server refuses');
      assert.equal($(ctx.doc, '#bt-project-outcome .bt-retry'), null, 'nothing to retry');
      sel.value = 'dev'; change(ctx.window, sel);
      await waitFor(() => outcomeText(ctx.doc) === 'Gets 3 new commits from origin first');
    } },
    { name: '15e. a 200 {state:"unknown"} answer reads Status unknown', run: async () => {
      const ctx = await boot({ syncGet: (q) => (q.get('base') === 'release'
        ? { sync: { base: 'release', remote: 'origin', state: 'unknown', reason: 'not-a-branch', settings: { beforeRun: true, onDiverged: 'ask' } } }
        : { sync: block(q.get('base') || 'dev') }) });
      const sel = $(ctx.doc, '#sourceBranch');
      await waitFor(() => rowShown(ctx.doc) && outcomeText(ctx.doc) === 'Gets 3 new commits from origin first');
      sel.value = 'release'; change(ctx.window, sel);
      await waitFor(() => outcomeText(ctx.doc) === 'Status unknown');
    } },
    { name: '15d. a 500 or a lost connection on another branch reads Status unknown, never the previous branch\'s outcome', run: async () => {
      let mode = 'ok';
      const ctx = await boot({ syncGet: (q) => {
        if (q.get('base') === 'release' && mode === '500') return ok({ error: 'boom' }, 500);
        if (q.get('base') === 'release' && mode === 'net') return Promise.reject(new TypeError('Failed to fetch'));
        return { sync: block(q.get('base') || 'dev') };
      } });
      const sel = $(ctx.doc, '#sourceBranch');
      const behind = 'Gets 3 new commits from origin first';
      await waitFor(() => rowShown(ctx.doc) && outcomeText(ctx.doc) === behind);
      for (const m of ['500', 'net']) {
        mode = m;
        sel.value = 'release'; change(ctx.window, sel);
        await waitFor(() => outcomeText(ctx.doc) === 'Status unknown');
        mode = 'ok';
        sel.value = 'dev'; change(ctx.window, sel);
        await waitFor(() => outcomeText(ctx.doc) === behind);
      }
      // The SAME base keeps its last good answer when a re-read fails.
      mode = 'ok'; const n0 = syncGets(ctx.calls).length;
      sel.value = 'release'; change(ctx.window, sel);
      await waitFor(() => syncGets(ctx.calls).length > n0);
      for (let i = 0; i < 5; i++) await tick();   // let release's answer land before the next read
      assert.equal(outcomeText(ctx.doc), behind);
      mode = '500'; const n = syncGets(ctx.calls).length;
      change(ctx.window, sel);
      await waitFor(() => syncGets(ctx.calls).length > n);
      await tick(); await tick();
      assert.equal(outcomeText(ctx.doc), behind);
    } },
  ]);
});

test('scheduled runs post syncBeforeStart / syncOnDiverged only for controls actually set; an untouched workspace member with onDiverged:fail posts neither', async () => {
  await checkRows([
    { name: '16. a scheduled run posts syncBeforeStart / syncOnDiverged only for the controls set (host side, §6.6)', run: async () => {
      const ctx = await boot({ run: () => ({ runId: 't-1', status: 'scheduled' }) });
      await waitFor(() => rowShown(ctx.doc));
      const openSheet = async () => {
        click(ctx.window, $(ctx.doc, '#start-more'));
        click(ctx.window, $(ctx.doc, '#start-menu-schedule'));
        await waitFor(() => $(ctx.doc, '.sched-ok'));
      };
      // Untouched sheet and choice: nothing.
      await openSheet();
      assert.ok($(ctx.doc, '#sched-sync-auto'), 'the New-pipeline Schedule path opts in to the Sync block');
      click(ctx.window, $(ctx.doc, '.sched-ok'));
      await waitFor(() => !$(ctx.doc, '#new-sched').hidden);
      await submit(ctx);
      assert.equal('syncBeforeStart' in ctx.posted[0], false);
      assert.equal('syncOnDiverged' in ctx.posted[0], false);
      assert.equal('sync' in ctx.posted[0], false, 'the sheet key never reaches the wire');
      // Both touched in the sheet.
      await openSheet();
      const auto = $(ctx.doc, '#sched-sync-auto');
      auto.checked = false; change(ctx.window, auto);
      const pol = $(ctx.doc, '#sched-sync-diverged');
      pol.value = 'fail'; change(ctx.window, pol);
      click(ctx.window, $(ctx.doc, '.sched-ok'));
      await waitFor(() => !$(ctx.doc, '#new-sched').hidden);
      await submit(ctx);
      assert.equal(ctx.posted[1].syncBeforeStart, false);
      assert.equal(ctx.posted[1].syncOnDiverged, 'fail');
    } },
    { name: '17. workspace, a member with onDiverged:fail, sheet and choice untouched: neither field is posted', run: async () => {
      const ctx = await boot({
        workspaces: WORKSPACES,
        run: () => ({ runId: 't-1', status: 'scheduled' }),
        fresh: (dir) => freshBody(dir, { sync: block(CACHED[dir].current, { settings: { beforeRun: true, onDiverged: dir === '/a/api' ? 'fail' : 'ask' } }) }),
      });
      await pickWorkspace(ctx);
      assert.equal(rowShown(ctx.doc), true);
      click(ctx.window, $(ctx.doc, '#start-more'));
      click(ctx.window, $(ctx.doc, '#start-menu-schedule'));
      await waitFor(() => $(ctx.doc, '.sched-ok'));
      assert.equal($(ctx.doc, '#sched-sync-diverged').value, '', 'the select opens on Project setting');
      click(ctx.window, $(ctx.doc, '.sched-ok'));
      await waitFor(() => !$(ctx.doc, '#new-sched').hidden);
      await submit(ctx);
      assert.equal('syncOnDiverged' in ctx.posted[0], false);
      assert.equal('syncBeforeStart' in ctx.posted[0], false);
    } },
  ]);
});

async function pickWorkspace(ctx) {
  click(ctx.window, $(ctx.doc, '#target-seg button[data-target="workspace"]'));
  await tick();
  const wsel = $(ctx.doc, '#workspaceSelect');
  await waitFor(() => optionValues(wsel).includes('wks-alpha-00000001'));
  wsel.value = 'wks-alpha-00000001'; change(ctx.window, wsel);
  await waitFor(() => memberTexts(ctx.doc).length === 2 && !memberTexts(ctx.doc).includes('Checking…'));
}

test('workspace members get a row each in the shared table; with the choice untouched each follows its own beforeRun, and a pick applies to all', async () => {
  await checkRows([
    { name: '18. workspace members get a row each, in the same table as a project run', run: async () => {
      const ctx = await boot({
        workspaces: WORKSPACES,
        fresh: (dir) => freshBody(dir, { sync: block(CACHED[dir].current, dir === '/a/api' ? { state: 'diverged', ahead: 1, behind: 2 } : { state: 'up-to-date', behind: 0 }) }),
      });
      await pickWorkspace(ctx);
      assert.equal($(ctx.doc, '#bt-project-row').hidden, true, 'the single project row gives way to the member rows');
      assert.deepEqual(memberTexts(ctx.doc), ['Up to date', 'Your 1 unpushed commit is left out']);
      assert.deepEqual(memberTones(ctx.doc), ['ok', 'amber']);
      assert.equal($(ctx.doc, '#branches-ctx').textContent, 'Alpha WS · 2 projects');
      const f = $(ctx.doc, '#featureBranch');
      f.value = 'feat/x'; f.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
      assert.equal($(ctx.doc, '#featureBranchHint').textContent, 'Creates feat/x-web and feat/x-api.');
    } },
    { name: '18b. untouched choice: each member row follows its OWN beforeRun; picking one applies to all', run: async () => {
      const ctx = await boot({
        workspaces: WORKSPACES,
        // web: behind with beforeRun:true (will sync → blue); api: behind with beforeRun:false (will not → amber).
        fresh: (dir) => freshBody(dir, { sync: block(CACHED[dir].current, { state: 'behind', behind: 2,
          settings: { beforeRun: dir !== '/a/api', onDiverged: 'ask' } }) }),
      });
      await pickWorkspace(ctx);
      assert.equal(pressed(ctx.doc, 'local'), true, 'not every member syncs: the choice reads Local copy');
      assert.deepEqual(memberTones(ctx.doc), ['blue', 'amber'], 'web syncs by its own setting');
      assert.deepEqual(memberTexts(ctx.doc), ['Gets 2 new commits from origin first', 'Misses 2 newer commits on origin']);
      click(ctx.window, $(ctx.doc, '#branches-mode-origin'));
      assert.deepEqual(memberTones(ctx.doc), ['blue', 'blue'], 'a picked choice applies to every member');
    } },
  ]);
});

test('18c. a member pick: Offline survives (server-reported stale); a failed read never keeps the old branch\'s outcome', async () => {
  let fail = false;
  const ctx = await boot({
    workspaces: WORKSPACES,
    fresh: (dir) => freshBody(dir, { sync: block(CACHED[dir].current, { state: 'up-to-date', behind: 0 }) }),
    syncGet: (q) => {
      if (fail) return ok({ error: 'boom' }, 500);
      return { sync: block(q.get('base'), { state: 'up-to-date', behind: 0, stale: true, fetchError: { kind: 'network' } }) };
    },
  });
  await pickWorkspace(ctx);
  const webSel = [...ctx.doc.querySelectorAll('#ws-source-branches select.ws-src-select')][0];
  const webText = () => webSel.closest('.ws-src-row').querySelector('.bt-text').textContent;
  assert.equal(webText(), 'Up to date');
  webSel.value = 'release'; change(ctx.window, webSel);
  await waitFor(() => /Can’t reach origin/.test(webText()));
  assert.ok(webSel.closest('.ws-src-row').querySelector('.bt-retry'), 'an offline member offers Retry');
  fail = true;
  webSel.value = 'dev'; change(ctx.window, webSel);
  await waitFor(() => webText() === 'Status unknown');
});
