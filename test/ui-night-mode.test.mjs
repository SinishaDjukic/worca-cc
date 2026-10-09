// test/ui-night-mode.test.mjs — night mode in the UI (Step 14): the run-view switch, the
// night decisions list, the start-form opt-in and the Settings card.
// Boot preamble copied from test/ui-newpipeline-auto.test.mjs:19-91 (house convention:
// duplicated per suite), with arms for the night routes and a POST recorder.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderNightForm, readNightForm, updateAwaySummary } from '../ui/public/night-mode-form.mjs';
import { NIGHT_DEFAULTS, resolveNightConfig } from '../src/core/night/config.mjs';
import { checkRows } from './helpers/rows.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const wins = [];
const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;                        // app.js runs in Node's realm: its Date.now is this one
  for (const w of wins.splice(0)) { try { w.close(); } catch { /* already closed */ } }
});

async function boot({ settings = {}, decisions = [], away, models = [], runData = null } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  wins.push(window);
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const posts = [];
  const awayCalls = [];
  // GET /api/away-mode: by default the stored user layer; `away` = a body, null (a 500) or (url) => body|null.
  const defaultAway = () => ({ config: resolveNightConfig({ user: settings.nightMode }).config, sources: {}, inherited: resolveNightConfig({}),
    toggle: settings.nightModeToggle || 'auto', user: settings.nightMode || {}, project: null });
  window.fetch = (u, opts) => {
    const url2 = String(u);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url2.split('?')[0];
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (method === 'POST' || method === 'PATCH') {
      posts.push({ path, body: JSON.parse(opts.body) });
      if (path.endsWith('/api/run')) return ok({ runId: 'run-new' });
      if (path.endsWith('/api/settings')) return ok({});
      return ok({ ok: true });
    }
    if (path.endsWith('/api/away-mode')) {
      awayCalls.push(url2);
      const b = typeof away === 'function' ? away(url2) : away === undefined ? defaultAway() : away;
      return b == null ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) : ok(b);
    }
    if (path.endsWith('/api/night-decisions')) return ok({ decisions });
    // GET /api/runs/:id (rdLoadData): the saved run a finished run's glance reads through to.
    if (runData && path.includes('/api/runs/')) return ok(runData);
    if (path.endsWith('/api/settings')) return ok({ nightMode: {}, nightModeToggle: 'auto', nightModeEffective: { strategy: 'mixed', criteria: {} }, ...settings });
    if (path.endsWith('/api/config')) return ok({ config: { steps: {}, customModels: [], activeWorkflowId: 'wf_default' }, models, efforts: [] });
    if (path.endsWith('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }] });
    if (path.endsWith('/api/guardrails')) return ok({ guardrails: [{ id: 'permissive', name: 'Permissive' }] });
    if (path.endsWith('/api/branches')) return ok({ branches: ['main'], current: 'main' });
    if (url2.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: '/repos/proj', exists: true, key: 'proj-1' }] });
    return ok({ pipelines: 0, projects: 0, workspaces: 0 });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.lastProject', 'proj');

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  lastWs._l.open?.forEach((fn) => fn());
  await settle();
  const dispatch = (msg) => lastWs._l.message?.forEach((fn) => fn({ data: JSON.stringify(msg) }));
  return { window, posts, dispatch, awayCalls };
}
async function settle(n = 4) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }

const RUN = { runId: 'run-n1', title: 'Night run', projectDir: '/repos/proj', status: 'running', startedAt: '2026-01-01T00:00:00Z', kind: 'run', pipelineId: 'p-1', night: { optIn: true, override: 'auto', decisions: 0, flagged: 0 } };

async function openDetail(ctx) {
  ctx.dispatch({ type: 'hello', runs: [RUN] });
  ctx.window.location.hash = `running/${RUN.runId}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle();
  return ctx.window.document.querySelector('#run-detail');
}

test('run view: the switch paints r.night.override and posts /api/run/night on change', async () => {
  const ctx = await boot();
  const screen = await openDetail(ctx);
  const sel = screen.querySelector('.rd-night');
  assert.equal(sel.closest('.rd-night-wrap').hidden, false, 'shown on a live run');
  assert.equal(sel.value, 'auto');
  sel.value = 'on';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(ctx.posts.find((p) => p.path.endsWith('/api/run/night')).body, { runId: RUN.runId, mode: 'on' });
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 5, status: 'paused', night: { optIn: true, override: 'off', decisions: 1, flagged: 1 } });
  await settle();
  assert.equal(screen.querySelector('.rd-night-wrap').hidden, false, 'a paused run keeps the switch (it lands in the resume point)');
  assert.equal(sel.value, 'off');
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 6, status: 'done', night: { optIn: true, override: 'off', decisions: 1, flagged: 1 } });
  await settle();
  assert.equal(screen.querySelector('.rd-night-wrap').hidden, true, 'hidden on a finished run');
});

test('run view: stored answers load on open; a night-decision frame appends a group; flagged rows carry Check and lead their ask', async () => {
  const ctx = await boot({ decisions: [{ questionId: 'clarify-a-1', kind: 'clarify', at: '2026-01-01T13:12:00', choice: 'Redis | Live', strategy: 'weights', confidence: 80, flagged: true,
    rationale: 'store: r1\ndelivery: r2', questions: [
      { id: 'store', question: 'Which store?', choice: 'Redis', flagged: false, rationale: 'r1' },
      { id: 'delivery', choice: 'Live', flagged: true, rationale: 'the agent was not sure enough; took the option easiest to undo' }] }] });
  const screen = await openDetail(ctx);
  await settle();
  const sec = screen.querySelector('.rd-night-sec');
  assert.equal(sec.hidden, false);
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 2 answers, 1 to check');
  const note = screen.querySelector('.rd-sheet .rd-away-note');
  assert.equal(note.hidden, false, 'the note shows on a live run, at the top of its card');
  assert.equal(note.querySelector('.rd-away-note-text').textContent, 'Away mode: 2 answers while you were away — 1 to check.');
  ctx.dispatch({ type: 'night-decision', runId: RUN.runId, seq: 9, id: 'gate-w-2', kind: 'gate',
    record: { questionId: 'gate-w-2', kind: 'gate', at: '2026-01-01T13:40:00', choice: 'continue', strategy: 'rule', confidence: null, flagged: true, rationale: 'critical remain' } });
  await settle();
  const groups = [...sec.querySelectorAll('.rd-na')];
  assert.deepEqual(groups.map((g) => g.querySelector('.rd-slabel').textContent),
    ["Clarifying questions · 13:12 · agent's pick · $0.00", 'Review loop · 13:40 · rule · $0.00'], 'no review ran: how, and that it cost nothing');
  const rows = [...sec.querySelectorAll('.rd-na-row')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.rd-na-q')?.textContent ?? null, r.querySelector('.rd-na-a').textContent, !!r.querySelector('.rd-na-check')]),
    [['Delivery', 'Live', true], ['Which store?', 'Redis', false], [null, 'Continued', true]]);
  assert.equal(rows[0].querySelector('.rd-na-check').textContent, 'Check');
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 3 answers, 2 to check');
  assert.equal(note.querySelector('.rd-away-note-text').textContent, 'Away mode: 3 answers while you were away — 2 to check.');
  // The reason is one click away: closed by default, a click opens it, another closes it.
  const btn = rows[0].querySelector('button.rd-na-btn');
  const why = rows[0].querySelector('.rd-na-why');
  assert.equal(why.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click();
  assert.equal(why.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(why.textContent, 'The agent was not sure enough; took the option easiest to undo.');
  // A repaint with the same answers leaves the open row (and its focus) alone.
  btn.focus();
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 10, status: 'running', night: { optIn: true, override: 'auto', decisions: 2, flagged: 2 } });
  await settle();
  assert.equal(sec.querySelectorAll('.rd-na-row')[0].querySelector('.rd-na-why').hidden, false, 'still open');
  assert.equal(ctx.window.document.activeElement, btn, 'still focused');
  // A limit row: no Check, its own words; an open row stays open when the list grows.
  ctx.dispatch({ type: 'night-decision', runId: RUN.runId, seq: 11, id: 'clarify-g-3', kind: 'clarify',
    record: { questionId: 'clarify-g-3', kind: 'clarify', choice: null, strategy: 'guardrail', guardrail: 'maxDecisions', confidence: null, flagged: true, rationale: 'Paused: worca answered 1 times on this run, the limit you set.' } });
  await settle();
  const after = [...sec.querySelectorAll('.rd-na-row')];
  assert.equal(after.length, 4);
  assert.equal(after[3].querySelector('.rd-na-a').textContent, 'Paused: answer limit reached');
  assert.equal(after[3].querySelector('.rd-na-check'), null);
  assert.equal(after[0].querySelector('.rd-na-why').hidden, false, 'the open row survived the rebuild');
  assert.equal(ctx.window.document.activeElement, after[0].querySelector('button.rd-na-btn'), 'focus follows the rebuilt row');
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 3 answers, 2 to check', 'a pause is not an answer');
});

test('start form: nightMode is sent only when the checkbox is ticked', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  doc.getElementById('prompt').value = 'demo task';
  doc.getElementById('run-form').dispatchEvent(new ctx.window.Event('submit', { cancelable: true }));
  await settle();
  const first = ctx.posts.filter((p) => p.path.endsWith('/api/run')).at(-1);
  assert.ok(first, 'the run was posted');
  assert.equal('nightMode' in first.body, false);
  doc.getElementById('nightMode').checked = true;
  doc.getElementById('run-form').dispatchEvent(new ctx.window.Event('submit', { cancelable: true }));
  await settle();
  assert.equal(ctx.posts.filter((p) => p.path.endsWith('/api/run')).at(-1).body.nightMode, true);
});

async function openSettings(ctx) {
  ctx.window.location.hash = 'settings';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(8);
  return ctx.window.document;
}
const click = (ctx, node) => node.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
const statusButton = (doc, label) => [...doc.querySelectorAll('#awayStatus button')].find((b) => b.textContent === label);

test('settings card: Save posts {nightMode} and never the status; each status button posts its toggle alone', async () => {
  await checkRows([
    { name: 'settings card: paints the stored layer, Save posts {nightMode}, the status buttons post the toggle', run: async () => {
      const ctx = await boot({ settings: { nightMode: { enabled: true, window: '22:00-07:00', strategy: 'weights' }, nightModeToggle: 'on' } });
      const doc = await openSettings(ctx);
      const host = doc.getElementById('night-mode-host');
      const all = [...host.querySelectorAll('.away-which input')].find((i) => i.closest('label').textContent.trim() === 'All runs');
      assert.equal(all.checked, true);
      assert.equal(host.querySelector('.night-window-start').value, '22:00');
      assert.deepEqual([...doc.querySelectorAll('#awayStatus button')].map((b) => b.textContent), ["I'm back"]);
      assert.equal(host.querySelector('.away-summary').nextElementSibling, doc.getElementById('awayStatus'), 'the status buttons sit right below the summary');
      host.querySelector('.night-strategy').value = 'analysis';
      click(ctx, doc.getElementById('nightModeSave'));
      await settle();
      const post = ctx.posts.filter((p) => p.path.endsWith('/api/settings')).at(-1);
      assert.equal('nightModeToggle' in post.body, false, 'Save never changes the status');
      assert.equal(post.body.nightMode.strategy, 'analysis');
      assert.equal(post.body.nightMode.enabled, true);
      assert.equal(post.body.nightMode.window, '22:00-07:00');
      click(ctx, statusButton(doc, "I'm back"));
      await settle();
      assert.deepEqual(ctx.posts.filter((p) => p.path.endsWith('/api/settings')).at(-1).body, { nightModeToggle: 'here' }, '"I\'m back" = here, even inside the away hours');
    } },
    { name: 'settings card: "I\'m away now" and "Pause away mode" post the toggle alone', run: async () => {
      // A second boot: the stub answers POST /api/settings with {}, so the strip is not repainted after a click.
      const ctx = await boot({ settings: { nightMode: { window: '22:00-07:00' }, nightModeToggle: 'auto' } });
      const doc = await openSettings(ctx);
      assert.deepEqual([...doc.querySelectorAll('#awayStatus button')].map((b) => b.textContent), ["I'm away now", 'Pause away mode']);
      click(ctx, statusButton(doc, "I'm away now"));
      await settle();
      assert.deepEqual(ctx.posts.filter((p) => p.path.endsWith('/api/settings')).at(-1).body, { nightModeToggle: 'on' });
      click(ctx, statusButton(doc, 'Pause away mode'));
      await settle();
      assert.deepEqual(ctx.posts.filter((p) => p.path.endsWith('/api/settings')).at(-1).body, { nightModeToggle: 'off' });
    } },
  ]);
});

// The sidebar's "I'm here | I'm away" control (wording §3.8): the lit side is what applies right now.
const sideBtn = (doc, side) => doc.querySelector(`.side-foot #side-away button[data-side="${side}"]`);
const lit = (doc) => ['here', 'away'].filter((x) => sideBtn(doc, x)?.getAttribute('aria-pressed') === 'true');
const settingsPosts = (ctx) => ctx.posts.filter((p) => p.path.endsWith('/api/settings'));
const SIDE_USER = { window: '22:00-07:00', timeZone: 'UTC' };
const sideBody = (o = {}) => ({ config: resolveNightConfig({ user: SIDE_USER }).config, sources: {}, inherited: resolveNightConfig({ user: SIDE_USER }), toggle: 'auto', hereSince: null, user: {}, project: {}, ...o });

test('sidebar: the lit side follows the clock and hereSince, and clicking the unlit side posts its toggle (lit side is a no-op)', async () => {
  await checkRows([
    { name: 'sidebar: by day "I\'m here" is lit; "I\'m away" posts "I\'m away now"; the lit side does nothing',
      now: '2026-09-28T15:00:00Z', body: sideBody(), lit: ['here'],
      first: async (ctx, doc) => {
        assert.deepEqual([sideBtn(doc, 'here').textContent.trim(), sideBtn(doc, 'away').textContent.trim()], ["I'm here", "I'm away"]);
        assert.match(doc.querySelector('#side-away .side-away').title, /You count as here\. Next away hours start at 22:00\. Click "I'm away"/);
        click(ctx, sideBtn(doc, 'here'));
        await settle();
        assert.equal(settingsPosts(ctx).length, 0, 'the lit side is a no-op');
      },
      click: 'away', post: 'on' },
    { name: 'sidebar: inside the away hours "I\'m away" is lit; "I\'m here" posts "here"',
      now: '2026-09-28T23:00:00Z', body: sideBody(), lit: ['away'], litMsg: 'the hours light it by themselves',
      click: 'here', post: 'here' },
    { name: 'sidebar: "I\'m here" said tonight keeps "I\'m here" lit, and the project tab says why',
      now: '2026-09-28T23:30:00Z', body: sideBody({ hereSince: Date.parse('2026-09-28T23:00:00Z') }), lit: ['here'],
      then: async (ctx, doc) => {
        ctx.window.location.hash = 'projects/proj-1/away';
        await settle(12);
        assert.match(doc.querySelector('.pd-night-card .away-summary').textContent, /^For proj: Right now it is 23:30( UTC)?\. You count as here because you said "I'm here"\./);
      } },
  ].map(({ name, now, body, lit: want, litMsg, first, click: side, post, then }) => ({ name, run: async () => {
    Date.now = () => Date.parse(now);
    const ctx = await boot({ away: () => body });
    const doc = ctx.window.document;
    assert.deepEqual(lit(doc), want, litMsg);
    await first?.(ctx, doc);
    if (side) {
      click(ctx, sideBtn(doc, side));
      await settle();
      assert.deepEqual(settingsPosts(ctx).at(-1).body, { nightModeToggle: post });
    }
    await then?.(ctx, doc);
  } })));
});

test('sidebar: "I\'m away now" lights "I\'m away"; paused lights "I\'m here" and "I\'m away" still works', async () => {
  let ctx = await boot({ away: () => sideBody({ toggle: 'on' }) });
  assert.deepEqual(lit(ctx.window.document), ['away']);
  click(ctx, sideBtn(ctx.window.document, 'here'));
  await settle();
  assert.deepEqual(settingsPosts(ctx).at(-1).body, { nightModeToggle: 'here' });
  ctx = await boot({ away: () => sideBody({ toggle: 'off' }) });
  assert.deepEqual(lit(ctx.window.document), ['here']);
  assert.match(ctx.window.document.querySelector('#side-away .side-away').title, /^Away mode is paused\./);
  click(ctx, sideBtn(ctx.window.document, 'away'));
  await settle();
  assert.deepEqual(settingsPosts(ctx).at(-1).body, { nightModeToggle: 'on' });
});

test('sidebar: unread settings: nothing lit, disabled, a click opens Settings › Runs', async () => {
  const ctx = await boot({ away: null });
  const doc = ctx.window.document;
  assert.deepEqual(lit(doc), []);
  assert.equal(sideBtn(doc, 'away').getAttribute('aria-disabled'), 'true');
  click(ctx, sideBtn(doc, 'away'));
  await settle();
  assert.equal(settingsPosts(ctx).length, 0);
  assert.equal(ctx.window.location.hash, '#settings/runs');
});

test('sidebar: settings-changed (Settings, another tab, Ask Worca) repaints it and an open project tab', async () => {
  let body = sideBody();
  Date.now = () => Date.parse('2026-09-28T15:00:00Z');
  const ctx = await boot({ away: () => body });
  ctx.window.location.hash = 'projects/proj-1/away';
  await settle(12);
  const doc = ctx.window.document;
  assert.deepEqual(lit(doc), ['here']);
  body = sideBody({ toggle: 'on' });
  ctx.dispatch({ type: 'settings-changed' });
  await settle(8);
  assert.deepEqual(lit(doc), ['away']);
  assert.match(doc.querySelector('.pd-night-card .away-summary').textContent, /^For proj: Right now you count as away because you said "I'm away now"/);
});

test('settings card: when GET /api/away-mode fails, the stored fields still render (spec §7)', async () => {
  // No `enabled` key: the default state of a real user.
  const ctx = await boot({ away: null, settings: { nightMode: { window: '22:00-07:00' } } });
  const doc = await openSettings(ctx);
  const host = doc.getElementById('night-mode-host');
  assert.ok(host.querySelector('.away-which input'), 'the fields render');
  const marked = [...host.querySelectorAll('.away-which input')].find((i) => i.closest('label').textContent.trim() === 'Only runs I marked');
  assert.equal(marked.checked, true);
  assert.equal(host.querySelector('.night-window-start').value, '22:00');
  assert.equal(host.querySelector('.away-summary').textContent.trim(), 'Away mode settings could not be read.');
});

test('night form patch: empty = __unset (inherit; team cap/window stay in force), explicit off = null, project level has no spend cap', async () => {
  await checkRows([
    { name: 'night form: project level unsets empty fields; grace off is an explicit null; no spend cap per project', run: async () => {
      const dom = new JSDOM('<!doctype html><body><div id="f"></div></body>');
      const root = dom.window.document.getElementById('f');
      renderNightForm(root, { level: 'project', values: { strategy: 'weights', criteria: { cost: 4 } }, effective: { graceMinutes: 30, criteria: { cost: 4 } }, sources: { graceMinutes: 'default' } });
      assert.equal(root.querySelector('.night-spend-cap'), null);
      let patch = readNightForm(root, { level: 'project' });
      assert.equal(patch.strategy, 'weights');
      assert.deepEqual(patch.criteria, { cost: 4 });
      for (const f of ['enabled', 'window', 'timeZone', 'graceMinutes', 'neverDecide']) assert.ok(patch.__unset.includes(f), f);
      root.querySelector('.night-grace-off').checked = true;
      root.querySelector('.night-never[value="gate"]').checked = true;
      patch = readNightForm(root, { level: 'project' });
      assert.equal(patch.graceMinutes, null);
      assert.deepEqual(patch.neverDecide, ['gate']);
    } },
    { name: 'night form: a user-level save of empty cap/window inherits the team cap and window; "No cap"/"No window" is an explicit null', run: async () => {
      const { resolveNightConfig } = await import('../src/core/night/config.mjs');
      const dom = new JSDOM('<!doctype html><body><div id="f"></div></body>');
      const root = dom.window.document.getElementById('f');
      renderNightForm(root, { level: 'user', values: { enabled: true, strategy: 'analysis' } });
      let patch = readNightForm(root, { level: 'user' });
      assert.ok(patch.__unset.includes('spendCapUsd') && patch.__unset.includes('window'), 'empty = inherit');
      assert.equal('spendCapUsd' in patch, false);
      assert.equal('window' in patch, false);
      const { __unset, ...user } = patch;
      const team = { spendCapUsd: 5, window: '22:00-06:00' };
      const { config } = resolveNightConfig({ user, team });
      assert.equal(config.spendCapUsd, 5, 'the team spend cap stays in force');
      assert.equal(config.window, '22:00-06:00');
      root.querySelector('.night-spend-cap-off').checked = true;
      root.querySelector('.night-window-off').checked = true;
      patch = readNightForm(root, { level: 'user' });
      assert.equal(patch.spendCapUsd, null);
      assert.equal(patch.window, null);
      renderNightForm(root, { level: 'user', values: { spendCapUsd: null, window: null } });
      assert.equal(root.querySelector('.night-spend-cap-off').checked, true, 'a stored null paints as the checkbox');
      assert.equal(root.querySelector('.night-window-off').checked, true);
      assert.equal(root.querySelector('.night-spend-cap').disabled, true);
    } },
  ]);
});

const formRoot = () => new JSDOM('<div id="r"></div>').window.document.getElementById('r');
const fire = (node, type) => node.dispatchEvent(new node.ownerDocument.defaultView.Event(type, { bubbles: true }));

test('the summary follows input (All runs changes line 2) and updateAwaySummary repaints it without touching unsaved edits', async () => {
  const root = formRoot();
  await checkRows([
    { name: 'the summary updates on input; switching to All runs changes line 2', run: async () => {
      renderNightForm(root, { level: 'user', values: { window: '22:00-07:00', timeZone: 'UTC' }, effective: { ...NIGHT_DEFAULTS, window: '22:00-07:00', timeZone: 'UTC' }, sources: {}, toggle: 'auto', now: Date.parse('2026-09-28T15:00:00Z') });
      const all = [...root.querySelectorAll('.away-which input')][1];
      all.checked = true; fire(all, 'change');
      assert.match(root.querySelector('.away-summary').textContent, /on all runs/);
      assert.equal(readNightForm(root, { level: 'user' }).enabled, true);
    } },
    { name: 'updateAwaySummary repaints the summary only (unsaved edits survive)', run: async () => {
      renderNightForm(root, { level: 'user', values: {}, effective: { ...NIGHT_DEFAULTS }, sources: {}, toggle: 'auto', now: 0 });
      root.querySelector('.night-num[data-field="maxDecisions"]').value = '7';
      updateAwaySummary(root, { toggle: 'on', now: 0 });
      assert.match(root.querySelector('.away-summary').textContent, /I'm away now/);
      assert.equal(root.querySelector('.night-num[data-field="maxDecisions"]').value, '7');
    } },
  ]);
});

test('night form user level: an unset Which-runs, half-typed hours and the empty/set/off round-trip give the same inherit/null patch', async () => {
  await checkRows([
    { name: 'user level: an unset "Which runs" shows the inherited choice and saves as unset', run: async () => {
      const root = formRoot();
      renderNightForm(root, { level: 'user', values: {}, effective: { ...NIGHT_DEFAULTS }, sources: {}, toggle: 'auto', now: 0 });
      const [marked] = root.querySelectorAll('.away-which input');
      assert.equal(marked.checked, true, 'the inherited value is shown');
      assert.match(root.querySelector('.away-which').textContent, /\(default\)/);
      assert.ok(readNightForm(root, { level: 'user' }).__unset.includes('enabled'), 'untouched = inherit, as before');
    } },
    { name: 'half-typed hours: summary says inherited, save unsets the window', run: async () => {
      const root = formRoot();
      renderNightForm(root, { level: 'user', values: {}, effective: { ...NIGHT_DEFAULTS }, sources: {}, toggle: 'auto', now: Date.parse('2026-09-28T15:00:00Z') });
      root.querySelector('.night-window-start').value = '22:00';
      fire(root.querySelector('.night-window-start'), 'input');
      assert.match(root.querySelector('.away-summary').textContent, /No away hours are set/);
      assert.ok(readNightForm(root, { level: 'user' }).__unset.includes('window'));
    } },
    { name: 'round-trip: empty vs set vs explicit off gives the same patch as before', run: async () => {
      const root = formRoot();
      renderNightForm(root, { level: 'user', values: { enabled: true, window: null, graceMinutes: null, spendCapUsd: 5, neverDecide: ['gate'] }, effective: { ...NIGHT_DEFAULTS }, sources: {}, toggle: 'auto', now: 0 });
      const p = readNightForm(root, { level: 'user' });
      assert.deepEqual([p.enabled, p.window, p.graceMinutes, p.spendCapUsd, p.neverDecide], [true, null, null, 5, ['gate']]);
      assert.ok(p.__unset.includes('strategy'));
    } },
  ]);
});

test('no inherited config (the fetch failed): every field renders, nothing throws, the summary says so', () => {
  const root = formRoot();
  for (const level of ['user', 'project']) {
    assert.doesNotThrow(() => renderNightForm(root, { level, values: {}, effective: {}, sources: {}, inherited: { config: null, sources: {} }, toggle: 'auto', now: 0 }));
    assert.ok(root.querySelector('.away-which input:checked'), level);
    assert.equal(root.querySelector('.away-summary').textContent.trim(), 'Away mode settings could not be read.');
    assert.doesNotMatch(root.textContent, /undefined|\[object Object\]/, level);
    if (level === 'user') assert.equal(root.querySelector('.away-inherited'), null, 'no source is claimed when nothing is inherited');
  }
  assert.equal(root.querySelector('.night-strategy option').textContent, 'Same as my settings', 'project level, nothing inherited: the plain label');
  assert.equal(root.querySelector('.away-which input').closest('label').textContent.trim(), 'Same as my settings', 'the radio too: never a guessed "(Only runs I marked)"');
});

// A bare "click "I'm away now"" points at a button the project tab does not have.
const bareButton = (text) => /click "I'm (away now|back)"(?! in Settings › Away mode)|turn it back on(?! in Settings › Away mode)/.test(text);

test('project card: Away mode for this project, its summary, and Save re-reads GET /api/away-mode?projectDir=', async () => {
  const body = { config: { ...NIGHT_DEFAULTS, window: '22:00-07:00', timeZone: 'UTC' }, sources: {}, inherited: resolveNightConfig({ user: { window: '22:00-07:00', timeZone: 'UTC' } }), toggle: 'auto', user: {}, project: {} };
  const ctx = await boot({ away: (u) => (u.includes('projectDir=') ? body : { ...body, inherited: resolveNightConfig({}) }) });
  ctx.window.location.hash = 'projects/proj-1/away';
  await settle(12);
  const card = ctx.window.document.querySelector('.pd-sec[data-sec="settings"] .pd-night-card');
  assert.ok(card, 'the card is on the project\'s Settings tab (the old away route lands there)');
  assert.equal(card.querySelector('.card-head b').textContent, 'Away mode for this project');
  assert.match(card.querySelector('.card-head').textContent, /Anything left as "Same as my settings" uses your Settings page/);
  assert.match(card.querySelector('.away-summary').textContent, /^For proj: /);
  assert.ok([...card.querySelectorAll('small.hint')].some((h) => h.textContent === '"I\'m away now" and "Pause" are global. Change them in Settings › Away mode.'));
  assert.equal(card.querySelector('.pd-night-reset').textContent, 'Use my settings');
  assert.ok(!bareButton(card.textContent), 'nothing on the tab points at a status button it does not have');
  const before = ctx.awayCalls.length;
  card.querySelector('.pd-night-save').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await settle(8);
  const patch = ctx.posts.filter((p) => p.path.endsWith('/api/config')).at(-1);
  assert.equal(patch.body.projectDir, '/repos/proj');
  assert.ok(patch.body.nightMode && Array.isArray(patch.body.nightMode.__unset));
  assert.ok(ctx.awayCalls.slice(before).some((u) => u.includes(`projectDir=${encodeURIComponent('/repos/proj')}`)), 'a fresh GET after the save');
});

// Task 7: the run page pill ticks on the 1 s timer even while the run waits on a question.
const T = Date.parse('2026-09-28T15:00:00Z');
const AWAY_C = { ...NIGHT_DEFAULTS, window: '22:00-07:00', timeZone: 'UTC', graceMinutes: 30, enabled: false };
const awayBody = (o = {}) => ({ config: AWAY_C, sources: {}, inherited: resolveNightConfig({}), toggle: 'auto', user: {}, project: {}, ...o });
const PENDING = { type: 'question', id: 'clarify-p-1', kind: 'clarify', questions: [{ id: 'a', question: 'A?', options: ['x', 'y'] }] };
// The 1 s timer, driven: app.js's tick body (window.__np.timerTick) against the Date.now each
// test sets, then the fetches it may start land.
const driveTick = async (ctx) => { ctx.window.__np.timerTick(); await settle(); };
async function openRun(ctx, run) {
  ctx.dispatch({ type: 'hello', runs: [run] });
  ctx.window.location.hash = `running/${run.runId}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(8);
  return ctx.window.document.querySelector('#run-detail');
}

test('run page: the pill never loops a fetch — no projectDir uses the user body, a failed project GET is fetched once', async () => {
  await checkRows([
    { name: 'run page: a run with no projectDir uses the user-level body and never loops a fetch', run: async () => {
      Date.now = () => T;
      const ctx = await boot({ away: () => awayBody() });
      const screen = await openRun(ctx, { ...RUN, projectDir: '', pendingQuestion: PENDING, night: { optIn: true, override: 'auto', decisions: 0, flagged: 0, openedAt: new Date(T).toISOString() } });
      const n = ctx.awayCalls.length;
      assert.equal(screen.querySelector('.rd-night-pill').textContent, 'answers after 30 min');
      await driveTick(ctx); await driveTick(ctx);
      assert.equal(ctx.awayCalls.length, n, 'no new fetch on the ticks');
    } },
    { name: 'run page: a project whose GET fails leaves the pill empty and is fetched once, not every second', run: async () => {
      Date.now = () => T;
      const ctx = await boot({ away: (u) => (u.includes('projectDir=') ? null : awayBody()) });
      const screen = await openRun(ctx, { ...RUN, pendingQuestion: PENDING, night: { optIn: true, override: 'auto', decisions: 0, flagged: 0, openedAt: new Date(T).toISOString() } });
      await driveTick(ctx); await driveTick(ctx);
      assert.equal(screen.querySelector('.rd-night-pill').textContent, '');
      assert.equal(ctx.awayCalls.filter((u) => u.includes('projectDir=')).length, 1);
    } },
  ]);
});

// "Decided by" + "Effort" (How worca picks an answer).
const DM_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false, hidden: true },
  { id: 'corp-model', label: 'Corp', efforts: ['medium'], custom: 'global' },
  { id: 'plug-model', label: 'Plug', efforts: ['medium'], custom: 'plugin', plugin: 'vendor' },
  { id: 'team-model', label: 'Team pick', efforts: ['medium'], custom: 'policy' },
  { id: 'legacy-model', label: 'Legacy', efforts: ['medium'], custom: 'project' },
  { id: 'bridged-x', label: 'Bridged', efforts: ['medium'], custom: 'global', bridged: 'openai', needsSignIn: true },
];
const optionsOf = (sel) => [...sel.options].map((o) => [o.value, o.textContent, o.disabled]);

// One review answers every question of its ask: the group caption names its model and cost; the heading
// sums every booked review from the steps (a review booked after the user answered first included).
const AWAY_STEPS = () => ([
  { key: 'n_plan:1', executionId: 'n_plan:1', nodeId: 'n_plan', status: 'done', costUsd: 0.67, auxCosts: { away: { usd: 0.05, calls: 1 } } },
  { key: 'n_impl:1', executionId: 'n_impl:1', nodeId: 'n_impl', status: 'start', costUsd: 1.94,
    auxCosts: { away: { usd: 0.1, calls: 2, floorUsd: 0.0234, stopped: 1 } } },   // 0.07 answered + 0.03 booked after the user answered
]);
const AWAY_DECISIONS = () => ([
  { questionId: 'c-old', kind: 'clarify', at: '2026-01-01T13:00:00', choice: 'S', strategy: 'analysis', model: 'claude-opus-5-5', flagged: false, rationale: 'r',
    questions: [{ id: 'size', question: 'Which size?', choice: 'S', strategy: 'analysis', confidence: 75, flagged: false, rationale: 'small' }] },
  { questionId: 'c-1', kind: 'clarify', at: '2026-01-01T14:02:00', choice: 'Redis', strategy: 'analysis', model: 'claude-opus-5-5', effort: 'high',
    reviewId: 'night-decider-ab12cd34', reviewStatus: 'finished', costUsd: 0.05, tokens: 900, executionId: 'n_plan:1', flagged: false, rationale: 'r',
    questions: [{ id: 'store', question: 'Which store?', choice: 'Redis', strategy: 'analysis', confidence: 80, flagged: false, rationale: 'fits' }] },
  { questionId: 'q-2', kind: 'questions', at: '2026-01-01T14:30:00', choice: 'a | b', strategy: 'analysis', model: null,
    reviewId: 'night-decider-0a0b0c0d', reviewStatus: 'finished', costUsd: 0.07, tokens: 1200, executionId: 'n_impl:1', flagged: true, rationale: 'r',
    questions: [{ id: 'q1', question: 'One?', choice: 'a', strategy: 'analysis', confidence: 90, flagged: false, rationale: 'x' },
      { id: 'q2', question: 'Two?', choice: 'b', strategy: 'analysis', confidence: 40, flagged: true, rationale: 'y' }] },
  { questionId: 'q-3', kind: 'questions', at: '2026-01-01T14:40:00', choice: 'x', strategy: 'analysis', model: 'claude-opus-5-5',
    reviewId: 'night-decider-11112222', reviewStatus: 'stopped', costUsd: null, tokens: 1800, floorUsd: 0.0234, executionId: 'n_impl:1', flagged: true, rationale: 'r',
    questions: [{ id: 'q', question: 'Three?', choice: 'x', strategy: 'analysis', confidence: null, flagged: true, rationale: 'could not weigh the options (timeout)' }] },
  { questionId: 'gate-w-2', kind: 'gate', at: '2026-01-01T14:52:00', choice: 'continue', strategy: 'rule', confidence: null, flagged: false, rationale: 'no issues' },
]);

test('answers card: each ask names the model that answered it and what that review cost; the heading adds every review\'s cost', async () => {
  const ctx = await boot({ models: DM_MODELS, decisions: AWAY_DECISIONS() });
  const screen = await openDetail(ctx);
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 3, status: 'running', steps: AWAY_STEPS(), totalCostUsd: 2.61, night: RUN.night });
  await settle();
  const sec = screen.querySelector('.rd-night-sec');
  assert.deepEqual([...sec.querySelectorAll('.rd-na .rd-slabel')].map((c) => c.textContent), [
    'Clarifying questions · 13:00',                                   // stored before the cost was kept: nothing invented
    'Clarifying questions · 14:02 · Opus 5.5 · $0.05',
    'Questions mid-step · 14:30 · the default model · $0.07',
    'Questions mid-step · 14:40 · Opus 5.5 · review stopped · ≥$0.02 · not in total',   // a lower bound, never shown as spent
    'Review loop · 14:52 · rule · $0.00',
  ]);
  // From the steps, not the records: $0.05 + $0.07 answered, + $0.03 booked for an ask the user answered first.
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 6 answers, 2 to check · $0.15');
  assert.ok(![...sec.querySelectorAll('.rd-na-row')].some((li) => /\$/.test(li.textContent)), 'a review\'s cost is the ask\'s, never a row\'s');
  // A new review booked: the heading repaints (the answers did not change).
  const more = AWAY_STEPS(); more[1].auxCosts.away = { usd: 0.14, calls: 3, floorUsd: 0.0234, stopped: 1 };
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 4, status: 'running', steps: more, night: RUN.night });
  await settle();
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 6 answers, 2 to check · $0.19');
});

test('answers card: an old run (no shares on its steps) keeps the plain heading; only a stopped review shows its lower bound, apart', async () => {
  const ctx = await boot({ decisions: [{ questionId: 'gate-w-2', kind: 'gate', at: '2026-01-01T13:40:00', choice: 'continue', strategy: 'rule', flagged: false, rationale: 'r' }] });
  const screen = await openDetail(ctx);
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 3, status: 'running', steps: [{ key: 'n_plan:1', executionId: 'n_plan:1', costUsd: 1 }], night: RUN.night });
  await settle();
  const h = screen.querySelector('.rd-night-sec h3');
  assert.equal(h.textContent, 'Answered for you · 1 answer');
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 4, status: 'running', night: RUN.night,
    steps: [{ key: 'n_plan:1', executionId: 'n_plan:1', costUsd: 1, auxCosts: { away: { usd: 0, calls: 0, floorUsd: 0.0234, stopped: 1 } } }] });
  await settle();
  assert.equal(h.textContent, 'Answered for you · 1 answer · ≥$0.02 · not in total');
  ctx.dispatch({ type: 'state', runId: RUN.runId, seq: 5, status: 'running', night: RUN.night,
    steps: [{ key: 'n_plan:1', executionId: 'n_plan:1', costUsd: 1, auxCosts: { away: { usd: 0, calls: 0, stopped: 1 } } }] });
  await settle();
  assert.equal(h.textContent, 'Answered for you · 1 answer', 'not priced: no figure, never "$0.00"');
  assert.doesNotMatch(screen.querySelector('.rd-night-sec').textContent, /NaN|undefined/);
});

test('answers card: a run seen only through hello after it ended reads its reviews\' cost from the saved steps once they land', async () => {
  const steps = [{ key: 'n_plan:1', executionId: 'n_plan:1', costUsd: 0.67, auxCosts: { away: { usd: 0.05, calls: 1 } } }];
  const ctx = await boot({ models: DM_MODELS, decisions: [AWAY_DECISIONS()[1]], runData: { state: { status: 'done', steps, totalCostUsd: 0.67 }, results: null } });
  ctx.dispatch({ type: 'hello', runs: [{ ...RUN, status: 'done' }] });   // hello carries no steps (ui/server.mjs summarizeRuns)
  ctx.window.location.hash = `running/${RUN.runId}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(12);
  const sec = ctx.window.document.querySelector('#run-detail .rd-night-sec');
  assert.deepEqual([...sec.querySelectorAll('.rd-na .rd-slabel')].map((c) => c.textContent), ['Clarifying questions · 14:02 · Opus 5.5 · $0.05']);
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 1 answer · $0.05', 'repainted when the saved steps landed');
});

test('"Decided by"/"Effort" offer the catalog grouped by connection and read back; at project level empty is "… (your setting)" and sent as __unset', async () => {
  await checkRows([
    { name: 'form: "Decided by" offers what the title-model picker offers; "Effort" the effort levels; both read back', run: async () => {
      const root = formRoot();
      renderNightForm(root, { level: 'user', values: {}, effective: { ...NIGHT_DEFAULTS }, sources: {}, inherited: resolveNightConfig({}), toggle: 'auto', now: 0, models: DM_MODELS });
      const model = root.querySelector('.night-decider-model');
      const effort = root.querySelector('.night-decider-effort');
      assert.equal(model.closest('.night-field').querySelector('.label-row label').textContent, 'Decided by');
      assert.equal(effort.closest('.night-field').querySelector('.label-row label').textContent, 'Effort');
      assert.ok(model.closest('details.away-adv'), 'inside "How worca picks an answer"');
      assert.deepEqual(optionsOf(model), [['', 'Same as the run', false], ['claude-opus-5-5', 'Opus 5.5', false], ['corp-model', 'Corp', false], ['plug-model', 'Plug · vendor', false], ['team-model', 'Team pick · team policy', false]]);
      assert.deepEqual([...model.querySelectorAll('optgroup')].map((g) => g.label), ['Claude sign-in'], 'grouped by connection, like every model picker');
      assert.deepEqual(optionsOf(effort), [['', 'Not set', false], ['medium', 'medium', false], ['high', 'high', false], ['xhigh', 'xhigh', false], ['max', 'max', false]]);
      assert.equal(model.closest('.night-field').querySelector('.away-inherited').textContent, '(default)');
      let p = readNightForm(root, { level: 'user' });
      assert.ok(p.__unset.includes('deciderModel') && p.__unset.includes('deciderEffort'));
      assert.equal('deciderModel' in p || 'deciderEffort' in p, false);
      model.value = 'claude-opus-5-5'; effort.value = 'high'; fire(effort, 'change');
      p = readNightForm(root, { level: 'user' });
      assert.deepEqual([p.deciderModel, p.deciderEffort], ['claude-opus-5-5', 'high']);
      assert.ok(!p.__unset.includes('deciderModel') && !p.__unset.includes('deciderEffort'));
      assert.match(root.querySelector('.away-summary').textContent, /worca weighs the options with Opus 5\.5 at high effort\./, 'the live summary follows the pickers');
    } },
    { name: 'form, project level: empty reads "… (your setting)" with where it comes from, and is sent as __unset', run: async () => {
      const root = formRoot();
      renderNightForm(root, { level: 'project', values: {}, inherited: resolveNightConfig({ user: { deciderModel: 'claude-opus-5-5' }, team: { deciderEffort: 'high' } }), now: 0, models: DM_MODELS });
      const model = root.querySelector('.night-decider-model'); const effort = root.querySelector('.night-decider-effort');
      assert.equal(model.options[0].textContent, 'Opus 5.5 (your setting)');
      assert.equal(effort.options[0].textContent, 'high (your setting)');
      assert.equal(model.closest('.night-field').querySelector('.away-inherited').textContent, '(your setting)');
      assert.equal(effort.closest('.night-field').querySelector('.away-inherited').textContent, '(team default)');
      const p = readNightForm(root, { level: 'project' });
      assert.ok(p.__unset.includes('deciderModel') && p.__unset.includes('deciderEffort'));
      assert.equal('deciderModel' in p || 'deciderEffort' in p, false, 'never null: an empty choice removes the key');
      renderNightForm(root, { level: 'project', values: {}, inherited: resolveNightConfig({}), now: 0, models: DM_MODELS });
      assert.equal(root.querySelector('.night-decider-model').options[0].textContent, "the run's model (your setting)");
      assert.equal(root.querySelector('.night-decider-effort').options[0].textContent, 'medium (your setting)');
      renderNightForm(root, { level: 'project', values: {}, inherited: { config: null, sources: {} }, now: 0 });
      assert.equal(root.querySelector('.night-decider-model').options[0].textContent, 'Same as my settings', 'nothing inherited yet: no guess');
      assert.equal(root.querySelector('.night-decider-effort').options[0].textContent, 'Same as my settings');
    } },
  ]);
});

test('form: a stored hidden, signed-out or stale model stays visible and saving keeps it; an empty catalog condemns nothing', () => {
  const root = formRoot();
  // Grouped by connection, catalog order inside a group: the bridged model in its provider's group after the sign-in.
  for (const [id, order] of [['claude-haiku-4-5', ['', 'claude-opus-5-5', 'claude-haiku-4-5', 'corp-model', 'plug-model', 'team-model']],
    ['bridged-x', ['', 'claude-opus-5-5', 'corp-model', 'plug-model', 'team-model', 'bridged-x']]]) {
    renderNightForm(root, { level: 'user', values: { deciderModel: id }, inherited: resolveNightConfig({}), now: 0, models: DM_MODELS });
    const sel = root.querySelector('.night-decider-model');
    assert.equal(sel.value, id);
    assert.equal(optionsOf(sel).find((o) => o[0] === id)[2], false, `${id}: offered because it IS the stored pick`);
    assert.deepEqual(optionsOf(sel).map((o) => o[0]), order);
  }
  renderNightForm(root, { level: 'user', values: { deciderModel: 'gone-model', deciderEffort: 'max' }, inherited: resolveNightConfig({}), now: 0, models: DM_MODELS });
  const sel = root.querySelector('.night-decider-model');
  assert.deepEqual(optionsOf(sel).at(-1), ['gone-model', 'gone-model — not installed', true]);
  assert.equal(sel.value, 'gone-model');
  const p = readNightForm(root, { level: 'user' });
  assert.deepEqual([p.deciderModel, p.deciderEffort], ['gone-model', 'max']);
  // User level: the first entry is always "Same as the run", whatever is inherited.
  renderNightForm(root, { level: 'user', values: {}, inherited: resolveNightConfig({ team: { deciderModel: 'claude-opus-5-5' } }), now: 0, models: DM_MODELS });
  assert.equal(root.querySelector('.night-decider-model').options[0].textContent, 'Same as the run');
  // An empty catalog (not loaded yet, or a failed GET) condemns nothing: the stored pick stays selectable.
  renderNightForm(root, { level: 'user', values: { deciderModel: 'claude-opus-5-5' }, inherited: resolveNightConfig({}), now: 0, models: [] });
  assert.deepEqual(optionsOf(root.querySelector('.night-decider-model')), [['', 'Same as the run', false], ['claude-opus-5-5', 'claude-opus-5-5', false]]);
  assert.equal(root.querySelector('.night-decider-model optgroup'), null, 'no empty groups');
  // Ids match case-insensitively, like the resolver: other casing is not "not installed".
  renderNightForm(root, { level: 'user', values: { deciderModel: 'CLAUDE-OPUS-5-5' }, inherited: resolveNightConfig({}), now: 0, models: DM_MODELS });
  assert.deepEqual(optionsOf(root.querySelector('.night-decider-model')).at(-1), ['CLAUDE-OPUS-5-5', 'CLAUDE-OPUS-5-5', false]);
});

test('settings card: "Decided by" lists the catalog and Save posts the pick with the effort', async () => {
  const ctx = await boot({ models: DM_MODELS, settings: { nightMode: { deciderEffort: 'xhigh' } } });
  const doc = await openSettings(ctx);
  const host = doc.getElementById('night-mode-host');
  const sel = host.querySelector('.night-decider-model');
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'claude-opus-5-5', 'corp-model', 'plug-model', 'team-model']);
  assert.equal(host.querySelector('.night-decider-effort').value, 'xhigh');
  sel.value = 'claude-opus-5-5';
  click(ctx, doc.getElementById('nightModeSave'));
  await settle();
  const post = ctx.posts.filter((p) => p.path.endsWith('/api/settings')).at(-1);
  assert.deepEqual([post.body.nightMode.deciderModel, post.body.nightMode.deciderEffort], ['claude-opus-5-5', 'xhigh']);
});
