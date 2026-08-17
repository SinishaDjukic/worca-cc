// test/ui-pipeline-density.test.mjs
//
// Behavior tests for the two pipeline densities. We boot the REAL app.js against
// the REAL index.html under jsdom (same harness idiom as test/ui-history-logs.mjs
// and test/ui-pipeline-tabs.mjs) and drive it the way a reader does: land on the
// list, open a pipeline, come back.
//
// What matters here is the CONTRACT between the two densities, not pixels (jsdom
// has no layout): which regions each density owns, that the blocking question
// outranks the graph in the detail view, that the tab bar shows one panel at a
// time, and that #pipeline/<id> resolves to whichever view owns the pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const go = async (hash) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    await new Promise((r) => setTimeout(r, 0));
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, recv, go, tick };
}

const live = (runId, extra = {}) => ({
  runId, title: `run ${runId}`, projectDir: PROJECT, status: 'running',
  startedAt: '10:00:00', kind: 'run', ...extra,
});

const STEPPER = {
  steps: [
    { nodes: [{ id: 'preflight', label: 'Preflight' }] },
    { nodes: [{ id: 'clarify', label: 'Clarify', uiPhase: 'clarify' }] },
    { nodes: [{ id: 'planner', label: 'Plan', uiPhase: 'plan' }] },
  ],
  feedbacks: [],
};

const card = (window, runId) => window.document.querySelector(`#run-list .run-card[data-run-id="${runId}"]`);

// ── density: which regions each one owns ────────────────────────────────────

test('a card in the list is .mini; the same card in the detail view is .full', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a'), live('b')] });
  await ctx.go('running');
  assert.equal(card(ctx.window, 'a').classList.contains('mini'), true, 'list density');
  assert.equal(card(ctx.window, 'a').classList.contains('full'), false);

  await ctx.go('running/a');
  const only = ctx.window.document.querySelectorAll('#run-list .run-card');
  assert.equal(only.length, 1, 'the detail view shows one pipeline');
  assert.equal(only[0].dataset.runId, 'a');
  assert.equal(only[0].classList.contains('full'), true, 'detail density');
  assert.equal(only[0].classList.contains('mini'), false, 'the two densities are exclusive');

  await ctx.go('running');
  assert.equal(card(ctx.window, 'a').classList.contains('mini'), true, 'back to list density');
});

test('the stylesheet gives each density its own regions, and the ladder its order', () => {
  // jsdom has no cascade for these, so the density contract is asserted on the
  // CSS text — the same hybrid idiom test/ui-log-filters-row.mjs uses.
  const rule = (sel) => {
    const m = css.match(new RegExp('(?:^|[\\s,}])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
  };
  // The blocking question sorts ABOVE the graph, the tab bar and the log.
  const order = (sel) => {
    const body = rule(sel);
    assert.ok(body, `${sel} must have an order`);
    const m = /order:\s*(-?\d+)/.exec(body);
    assert.ok(m, `${sel} must declare order`);
    return Number(m[1]);
  };
  assert.ok(order('.run-card > .qpanel') < order('.run-card > .run-flow-wrap'),
    'the blocking question outranks the graph');
  assert.ok(order('.run-card > .cost-banner') < order('.run-card > .run-foot'),
    'the cost pause outranks the controls');
  assert.ok(order('.run-card > .run-top') < order('.run-card > .qpanel'),
    'identity still comes first — you must know WHICH pipeline is asking');
  assert.ok(order('.run-card > .run-tabs') < order('.run-card > .run-log'),
    'the tab bar precedes the panels it controls');

  // .mini hides the detail-only regions; .full hides the list-only ones.
  assert.match(css, /\.run-card\.mini > \.run-flow-wrap,[\s\S]{0,200}?display:none/,
    '.mini must hide the graph canvas');
  assert.match(css, /\.run-card\.full > \.run-rail-wrap,[\s\S]{0,160}?display:none/,
    '.full must hide the rail');
});

// ── the rail replaces the graph in the list ─────────────────────────────────

test('the mini card renders a rail marker per stage, tinted by status', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'phase', runId: 'a', phase: 'clarify', cycle: 1 });
  await ctx.tick();

  const rail = card(ctx.window, 'a').querySelector('.run-rail');
  const cells = [...rail.querySelectorAll('.rcell')];
  assert.equal(cells.length, 3, 'one marker per stage');
  assert.deepEqual(cells.map((c) => c.querySelector('.rlabel').textContent),
    ['Preflight', 'Clarify', 'Plan']);
  assert.equal(cells[0].classList.contains('is-done'), true, 'a passed stage is done');
  assert.equal(cells[2].classList.contains('is-pending'), true, 'an unreached stage is pending');
  // Connectors sit BETWEEN markers: three cells -> two bars.
  assert.equal(rail.querySelectorAll('.rbar').length, 2);
});

test('the rail and the graph are painted from ONE status computation', async () => {
  // Not a style test: the point is that a node cannot read as done on the rail and
  // pending on the graph. Both renderers take the same view adapter, so comparing
  // their output for the same node is the check that they still share it.
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'phase', runId: 'a', phase: 'plan', cycle: 1 });
  await ctx.tick();
  const c = card(ctx.window, 'a');
  for (const id of ['preflight', 'clarify', 'planner']) {
    const railCell = [...c.querySelectorAll('.rcell')]
      .find((x) => x.querySelector('.rlabel').textContent
        === c.querySelector(`.run-node[data-id="${id}"] .nmeta b`).textContent);
    const graphNode = c.querySelector(`.run-node[data-id="${id}"]`);
    const railState = [...railCell.classList].find((x) => x.startsWith('is-'));
    const graphState = [...graphNode.classList].find((x) => x.startsWith('is-'));
    assert.equal(railState, graphState, `${id}: rail and graph agree`);
  }
});

// ── the call to action ──────────────────────────────────────────────────────

test('a pending question puts one Answer CTA on the mini card, not the question form', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'phase', runId: 'a', phase: 'clarify', cycle: 1 });
  ctx.recv({ type: 'question', runId: 'a', kind: 'clarify',
    questions: [{ id: 'q1', question: 'Fail fast or coerce?', options: ['fast', 'coerce'] }] });
  await ctx.tick();

  const c = card(ctx.window, 'a');
  assert.match(c.querySelector('.run-cta-text').textContent, /needs your input · 1 question$/);
  assert.equal(c.querySelector('.btn-answer').hidden, false, 'Answer is offered');
  assert.equal(c.classList.contains('attention'), true, 'the card still rings');

  // Opening it hands over to the detail view, where the form itself lives.
  await ctx.go(`pipeline/a`);
  const full = ctx.window.document.querySelector('#run-list .run-card');
  assert.equal(full.classList.contains('full'), true);
  assert.equal(full.querySelector('.btn-answer').hidden, true,
    'no Answer button next to the form it would scroll to');
  assert.equal(full.querySelector('.run-cta-text').textContent, '',
    'the CTA line does not restate a question that is on screen');
  assert.ok(full.querySelector('.qpanel').textContent.includes('Fail fast or coerce?'),
    'the question form is here');
});

test('with nothing to decide, the CTA stays empty — the rail already names the stage', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'phase', runId: 'a', phase: 'plan', cycle: 1 });
  await ctx.tick();
  const c = card(ctx.window, 'a');
  assert.equal(c.querySelector('.run-cta-text').textContent, '',
    'no restated stage label — the rail cell above carries it');
  const activeCell = [...c.querySelectorAll('.rcell')].find((x) => x.classList.contains('is-active'));
  assert.equal(activeCell.querySelector('.rlabel').textContent, 'Plan',
    'the stage name lives on the rail, once');
  assert.equal(c.querySelector('.btn-answer').hidden, true, 'nothing is being asked');
});

// ── the peek ────────────────────────────────────────────────────────────────

test('a mini card streams no log DOM; expanding it shows the tail of the log', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  for (let i = 1; i <= 8; i++) {
    ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: `line ${i}` });
  }
  await ctx.tick();

  const c = card(ctx.window, 'a');
  const r = ctx.window.__np.getRun('a');
  assert.equal(r.logLines.length, 8, 'the model keeps every line regardless of density');
  assert.equal(c.querySelectorAll('.run-log .log .log-line').length, 0,
    'a hidden log pane is not streamed into — one node per line per live run is pure waste');

  const peek = c.querySelector('.run-peek');
  assert.equal(peek.hidden, true, 'collapsed by default');
  c.querySelector('.run-expand').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(peek.hidden, false);
  const lines = peek.querySelectorAll('.peek-lines .log-line');
  assert.equal(lines.length, 5, 'the peek is a tail, not a pane');
  assert.match(lines[4].textContent, /line 8/, 'the newest line is last');
  assert.match(peek.querySelector('.peek-foot').textContent, /last 5 of 8 lines/);
});

// History's edge stripe on running cards: the pill family colours the left
// border via an rc-<family> class stamped on every repaint.
test('the run card carries its status family as an rc-* stripe class', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  const c = card(ctx.window, 'a');
  assert.ok(c.classList.contains('rc-peach'), 'a plain running card is the peach family');
  ctx.recv({ type: 'done', runId: 'a', status: 'error' });
  assert.ok(c.classList.contains('rc-red'), 'error repaints the stripe red');
  assert.equal(c.classList.contains('rc-peach'), false, 'the old family class is dropped');
  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.run-card\{border-left:4px solid var\(--line-2\);\}/);
  assert.match(css, /\.run-card\.rc-red\{border-left-color:var\(--red\);\}/);
});

// The mini card mirrors History (user decision): the head EXPANDS the peek,
// only the title (or Open) navigates into the pipeline.
test('mini-card head click toggles the peek; the title click navigates', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER, title: 'A run' })] });
  await ctx.go('running');
  const c = card(ctx.window, 'a');
  const peek = c.querySelector('.run-peek');
  const before = ctx.window.location.hash;
  c.querySelector('.run-meta').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(peek.hidden, false, 'head click expands the peek');
  assert.equal(ctx.window.location.hash, before, 'head click does NOT navigate');
  c.querySelector('.run-meta').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(peek.hidden, true, 'second head click collapses');
  c.querySelector('.run-title').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.match(ctx.window.location.hash, /^#pipeline\//, 'the title is the way in');
});

test('opening the detail view hydrates the full log pane from the model', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  for (let i = 1; i <= 8; i++) {
    ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: `line ${i}` });
  }
  await ctx.go('running/a');
  const full = ctx.window.document.querySelector('#run-list .run-card');
  assert.equal(full.querySelectorAll('.run-log .log .log-line').length, 8,
    'every line the mini card skipped is rendered on arrival');
});

// ── tabs ────────────────────────────────────────────────────────────────────

test('the detail view shows one panel at a time, and prefers the log while live', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'phase', runId: 'a', phase: 'plan', cycle: 1 });
  ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: 'planning' });
  ctx.recv({ type: 'subagent', runId: 'a', id: 's1', nodeId: 'planner', label: 'research', status: 'running' });
  await ctx.go('running/a');

  const full = ctx.window.document.querySelector('#run-list .run-card');
  const tabs = [...full.querySelectorAll('.run-tab')];
  assert.deepEqual(tabs.map((t) => t.dataset.tabKey), ['agents', 'log']);
  const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
  assert.equal(selected.length, 1, 'exactly one tab is selected');
  assert.equal(selected[0].dataset.tabKey, 'log',
    'the log is what a reader watches on a live run — DOM order would have picked agents');
  assert.equal(full.querySelector('.subs-bar').classList.contains('tab-off'), true,
    'the unselected panel is off');
  assert.equal(full.querySelector('.run-log').classList.contains('tab-off'), false);

  // Switching tabs swaps exactly one panel for exactly one other.
  const agents = tabs.find((t) => t.dataset.tabKey === 'agents');
  agents.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(agents.getAttribute('aria-selected'), 'true');
  assert.equal(full.querySelector('.run-log').classList.contains('tab-off'), true);
  assert.equal(full.querySelector('.subs-bar').classList.contains('tab-off'), false);
  // Selecting a dropdown-backed panel OPENS it, so its lazily-built body renders.
  assert.equal(full.querySelector('.subs-bar .btn-subs').getAttribute('aria-expanded'), 'true');
  assert.ok(full.querySelector('.subs-bar .subs-panel .subs-step'), 'the agents tree is built');
});

test('a single panel needs no tab bar', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: 'only logs here' });
  await ctx.go('running/a');
  const full = ctx.window.document.querySelector('#run-list .run-card');
  // No sub-agents ever spawned -> .subs-bar stays hidden -> the log stands alone.
  assert.equal(full.querySelector('.subs-bar').hidden, true);
  assert.equal(full.querySelector('.run-tabs').hidden, true, 'one panel, no tab bar');
  assert.equal(full.querySelector('.run-log').classList.contains('tab-off'), false,
    'and it is shown, not left switched off');
});

// ── routing ─────────────────────────────────────────────────────────────────

// #pipeline/<id> is a DESTINATION, not a redirect: it resolves to the section that
// renders it and the url stays put. Rewriting it minted a second history entry,
// which turned the browser Back button into a treadmill.
test('#pipeline/<id> renders the live card without rewriting the url', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a')] });
  await ctx.go('pipeline/a');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/a',
    'the canonical url is preserved, not swapped for the host view');
  assert.ok(card(ctx.window, 'a'), 'and the live card is what renders');
});

test('#pipeline/<id> resolves by pipelineId too, so a resumed run keeps one url', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('run-uuid', { pipelineId: 'abc12345' })] });
  await ctx.go('pipeline/abc12345');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/abc12345',
    'the persisted id is the identity; it is never downgraded to the session runId');
  assert.ok(card(ctx.window, 'run-uuid'), 'the live run that owns it renders');
});

test('#pipeline/<id> falls to the History host when nothing live owns the id', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [] });          // live set known, and empty
  await ctx.go('pipeline/deadbeef');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/deadbeef');
  const np = ctx.window.__np;
  assert.deepEqual(np.resolvePipelineHost('deadbeef'), ['history', 'deadbeef', 'history']);
});

// A TERMINAL run still sitting in the session's run map keeps rendering from the
// live card (its log and graph are already in memory), but it BELONGS to History —
// so the sidebar and the back link say History. The old route said "running", which
// is how a finished pipeline ended up under a "0 pipelines executing" header.
test('a finished run in the live map is owned by History, not Running', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a')] });
  ctx.recv({ type: 'done', runId: 'a', status: 'done' });
  await ctx.tick();
  const [view, key, owner] = ctx.window.__np.resolvePipelineHost('a');
  assert.equal(view, 'running', 'the live card still supplies the content');
  assert.equal(key, 'a');
  assert.equal(owner, 'history', 'but the pipeline is filed under History');
  await ctx.go('pipeline/a');
  const active = ctx.window.document.querySelector('.nav button[data-nav].active');
  assert.equal(active && active.dataset.nav, 'history', 'sidebar follows the owner');
});

// The legacy detail urls stay linkable, but they are replaced IN PLACE (no new
// history entry) so Back still reaches wherever the reader came from.
test('legacy #running/<id> and #history/<id> normalize to the canonical url', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('run-uuid', { pipelineId: 'abc12345' })] });
  await ctx.go('running/run-uuid');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/abc12345',
    'a legacy runId url is upgraded to the durable pipelineId');
  await ctx.go('history/deadbeef');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/deadbeef');
});

// A url captured before the DB row existed carries the runId; the moment the
// pipelineId lands it is swapped in, so what the reader may bookmark is durable.
test('a runId url is upgraded in place when the pipelineId arrives', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('fresh')] });
  await ctx.go('pipeline/fresh');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/fresh');
  ctx.recv({ type: 'state', runId: 'fresh', id: 'cafe1234' });
  await ctx.tick();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/cafe1234',
    'the durable id replaces the session id');
});

test('a deep link that arrives BEFORE the live set is held, not bounced', async () => {
  // The runs map is seeded by the WS hello. A cold-boot deep link that resolved
  // eagerly would decide "not live" against an empty map and strand the reader in
  // History — or, on #running/<id>, throw the selection away entirely.
  const ctx = await boot();
  await ctx.go('pipeline/late');
  await ctx.tick();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/late',
    'the route is held while the live set is unknown');
  // The wait happens on the Running host: it owns the placeholder, and holding in
  // History would fetch the whole list for a pipeline that may well be live.
  assert.match(ctx.window.document.querySelector('#run-list').textContent, /Loading pipeline/);

  ctx.recv({ type: 'hello', runs: [live('late')] });
  await ctx.tick();
  assert.ok(card(ctx.window, 'late'), 'the pipeline renders once hello lands');
  assert.equal(card(ctx.window, 'late').classList.contains('full'), true, 'at detail density');
});

// A dead link keeps its url and explains itself. Bouncing to the list threw the
// address away and never said why, so a stale bookmark read as an ignored click.
test('an unknown id says so instead of bouncing to the list', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a')] });
  await ctx.go('pipeline/nope');
  await ctx.tick();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/nope',
    'the url the reader followed is still in the bar');
  const host = ctx.window.document.querySelector('#history');
  assert.match(host.textContent, /not running and is not in this machine/);
  assert.ok(host.querySelector('button'), 'and there is a way out');
});

test('the detail view offers a way back to the list it was opened from', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a')] });
  await ctx.go('running');
  await ctx.go('running/a');
  const back = ctx.window.document.querySelector('.detail-bar .detail-back');
  assert.ok(back, 'a back affordance exists');
  assert.match(back.textContent, /Running/);
  back.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.tick();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(ctx.window.document.querySelectorAll('#run-list .run-card').length, 1);
  assert.equal(card(ctx.window, 'a').classList.contains('mini'), true, 'and back at list density');
});

// A regression guard for a trap this stylesheet already fell into once: the three
// run-card action buttons declare `display`, which beats the UA's
// [hidden]{display:none}. Hiding them from JS therefore does nothing unless a
// [hidden] rule names them. .btn-pause/.btn-resume were patched when the pause
// feature landed; .btn-stop was not, because nothing hid it until a finished
// pipeline stopped offering controls it cannot honour.
test('every hideable run-card button is actually hideable', () => {
  const m = css.match(/\.btn-pause\[hidden\][^{]*\{([^}]*)\}/);
  assert.ok(m, 'the [hidden] patch rule must exist');
  const rule = css.match(/([^;{}]*)\{[^}]*\}/g)
    .find((r) => r.includes('.btn-pause[hidden]'));
  for (const cls of ['.btn-pause', '.btn-resume', '.btn-stop']) {
    assert.ok(rule.includes(`${cls}[hidden]`),
      `${cls} sets display, so it needs ${cls}[hidden] in the patch rule`);
  }
  assert.match(m[1], /display:\s*none/);
});

// The `hidden` footgun, as a table — it has now bitten four times in this
// stylesheet (.nav-count, the pause/resume/stop trio, .detail-bar, .hist-filter).
// An author rule that sets `display` outranks the UA's [hidden]{display:none},
// because author origin beats user-agent origin. So any element the app hides by
// setting `.hidden = true` in JS AND styles with its own `display` silently stays
// on screen until a [hidden] patch names it. Each entry below is an element hidden
// from JS; the test asserts the patch exists whenever the base rule sets display.
const JS_HIDDEN = [
  ['.detail-bar', 'hideDetailBar(), leaving "← History" above the History list'],
  ['.hist-filter', 'renderHistory(), leaving list filters on a single-pipeline page'],
  ['.run-peek', 'the mini card collapsing its log peek'],
  ['.run-tabs', 'a card with fewer than two panels'],
];
for (const [sel, why] of JS_HIDDEN) {
  test(`${sel} honours [hidden] despite its own display rule`, () => {
    const base = new RegExp(`\\${sel}\\{([^}]*)\\}`).exec(css);
    assert.ok(base, `${sel} base rule missing`);
    if (!/display:\s*(?!none)/.test(base[1])) return;   // no author display -> UA rule already wins
    const patch = new RegExp(`\\${sel}\\[hidden\\]\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(patch, `${sel} sets display, so [hidden] is inert on it — ${why}`);
    assert.match(patch[1], /display:\s*none/);
  });
}

// The detail view must not wear the list's header. "Running · 0 pipelines
// executing" over one finished pipeline was the reported symptom.
test('a detail route hides the host list header and titles itself', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a')] });
  await ctx.go('running');
  assert.equal(ctx.window.document.body.classList.contains('view-pipeline'), false);

  await ctx.go('pipeline/a');
  const body = ctx.window.document.body;
  assert.ok(body.classList.contains('view-pipeline'), 'the list header is suppressed');
  assert.match(css, /body\.view-pipeline[^{]*\.topbar\{[^}]*display:\s*none/,
    'and the rule that suppresses it exists');
  const bar = ctx.window.document.querySelector('[data-view="running"] .detail-bar');
  assert.equal(bar.querySelector('.detail-title').textContent, 'run a',
    'the header names the pipeline');
  const pill = bar.querySelector('.detail-status');
  assert.equal(pill.hidden, false);
  assert.match(pill.className, /pill-run/, 'status shown in the shared pill vocabulary');

  await ctx.go('running');
  assert.equal(body.classList.contains('view-pipeline'), false, 'and it is restored on the list');
});

// Back must reach the list in ONE step. The rewrite this replaced pushed a second
// entry (#history -> #pipeline/x -> #running/x), so Back popped to the middle
// entry, which re-resolved and re-pushed — the reader never got out.
test('opening a pipeline adds exactly one history entry', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a')] });
  await ctx.go('history');
  const before = ctx.window.history.length;
  ctx.window.location.hash = 'pipeline/a';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.tick();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'pipeline/a');
  assert.equal(ctx.window.history.length, before + 1,
    'one navigation, one entry — a canonicalizing rewrite would add a second');
});

// ── the stats row says only what nothing else says ──────────────────────────

test('the stats row drops step/duration/cost (rail + meta carry them); cycle appears from 2', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('running');
  ctx.recv({ type: 'phase', runId: 'a', phase: 'clarify', cycle: 1 });
  await ctx.tick();
  const c = card(ctx.window, 'a');
  const stats = () => c.querySelector('.run-stats').textContent;
  assert.equal(stats().includes('step'), false, 'the rail states the position graphically');
  assert.equal(stats().includes('$'), false, 'cost lives on the meta line');
  assert.equal(stats().includes('cycle'), false, 'a first cycle is the normal case, not news');
  // The meta line now carries the numbers at BOTH densities.
  assert.notEqual(c.querySelector('.run-time').textContent, '', 'duration on the meta line');
  assert.match(c.querySelector('.run-cost').textContent, /\$/, 'cost on the meta line');
  assert.doesNotMatch(css, /\.run-card\.mini > \.run-top \.run-meta \.run-time/,
    'no mini rule hides the meta duration any more');

  ctx.recv({ type: 'phase', runId: 'a', phase: 'clarify', cycle: 2 });
  await ctx.tick();
  assert.match(stats(), /cycle\s*2/, 'a second cycle IS news');
});

// ── rail labels are display names, not truncations ──────────────────────────

test('a long stage label is shortened for the rail; the tooltip keeps the full name', async () => {
  const wide = {
    steps: [
      { nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { nodes: [{ id: 'implementer', label: 'Implementation', uiPhase: 'implement' }] },
      { nodes: [{ id: 'reviewer', label: 'Review Implementation', uiPhase: 'review' }] },
    ],
    feedbacks: [],
  };
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: wide })] });
  await ctx.go('running');
  await ctx.tick();
  const cells = [...card(ctx.window, 'a').querySelectorAll('.rcell')];
  assert.deepEqual(cells.map((x) => x.querySelector('.rlabel').textContent),
    ['Preflight', 'Implement', 'Review']);
  assert.equal(cells[1].title, 'Implementation', 'full name survives in the tooltip');
  assert.equal(cells[2].title, 'Review Implementation');
});

// ── chrome the detail page must not repeat ──────────────────────────────────

test('the foot chip is retired at both densities, and the status pill anchors right', () => {
  assert.match(css, /\.run-card > \.run-foot > \.chip\{display:none;\}/,
    'the phase chip is never displayed — the rail / header / glowing node name the phase');
  assert.match(css, /\.run-top > div:first-child\{flex:1 1 auto;min-width:0;\}/,
    'the title block absorbs the slack so the pill sits at the right edge');
  assert.match(css, /\.run-flow\{[^}]*align-items:flex-start/,
    'graph columns are top-aligned — STEP tags share one baseline');
});

test('a zero count paints no tab badge — "Agents", not "Agents 0"', async () => {
  // A stepper whose Clarify cell is an 'agents' cell (subsGroupsForRender only
  // groups those), and a state snapshot that says the agent RAN but spawned
  // nothing: exactly the state that used to render "Agents 0".
  const kinds = {
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { kind: 'agents', nodes: [{ id: 'clarify', label: 'Clarify', uiPhase: 'clarify' }] },
    ],
    feedbacks: [],
  };
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: kinds })] });
  await ctx.go('running');
  ctx.recv({ type: 'state', runId: 'a', status: 'running',
    steps: [{ nodeId: 'clarify', cycle: 1, status: 'start' }] });
  await ctx.go('pipeline/a');
  await ctx.tick();
  const tabs = [...ctx.window.document.querySelectorAll('.run-card .run-tab')];
  const agents = tabs.find((b) => b.textContent.startsWith('Agents'));
  assert.ok(agents, 'the Agents tab exists');
  assert.equal(agents.querySelector('.n'), null, 'no badge for an empty set');
});

// ── the detail header follows a late title ──────────────────────────────────

test('a title landing while the detail page is open renames the header in place', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER, title: 'provisional words' })] });
  await ctx.go('pipeline/a');
  await ctx.tick();
  const bar = ctx.window.document.querySelector('.view[data-view="running"] .detail-bar');
  assert.equal(bar.querySelector('.detail-title').textContent, 'provisional words');
  ctx.recv({ type: 'title', runId: 'a', title: 'Real Pipeline Name', provisional: false });
  await ctx.tick();
  assert.equal(bar.querySelector('.detail-title').textContent, 'Real Pipeline Name',
    'the header is patched, not left waiting for the next route change');
});

// ── click-to-focus: a graph node narrows the log to its stage ───────────────

test('clicking an agents node focuses the log on that step and its latest cycle', async () => {
  const kinds = {
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { kind: 'agents', nodes: [{ id: 'clarify', key: 'clarify', label: 'Clarify', uiPhase: 'clarify' }] },
      { kind: 'agents', nodes: [{ id: 'planner', key: 'planner', label: 'Plan', uiPhase: 'plan' }] },
    ],
    feedbacks: [],
  };
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: kinds })] });
  await ctx.go('running');
  ctx.recv({ type: 'log', runId: 'a', source: 'clarify', level: 'info', text: 'q&a', stepIndex: 0, cycle: 1 });
  ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: 'first pass', stepIndex: 1, cycle: 1 });
  ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: 'second pass', stepIndex: 1, cycle: 2 });
  // Two panels (Agents + Log) so the .full card grows its tab bar.
  ctx.recv({ type: 'state', runId: 'a', status: 'running',
    steps: [{ nodeId: 'clarify', cycle: 1, status: 'done' }, { nodeId: 'planner', cycle: 2, status: 'start' }] });
  await ctx.go('pipeline/a');
  await ctx.tick();
  const c = ctx.window.document.querySelector('#run-list .run-card.full');
  c.querySelector('.run-flow .run-node[data-id="planner"]')
    .dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.tick();
  assert.equal(c.querySelector('.run-tab[aria-selected="true"]').dataset.tabKey, 'log',
    'the Log tab takes over');
  assert.equal(c.querySelector('.log-f-step').value, '1', 'step filter = the node\'s step');
  assert.equal(c.querySelector('.log-f-cycle').value, '2', 'cycle filter = its LATEST cycle');
  assert.equal(c.querySelector('.log-f-source').value, 'planner', 'source filter = the stage\'s agent');
  // Bookend nodes are not stages — clicking preflight must not change anything.
  c.querySelector('.run-flow .run-node[data-id="preflight"]')
    .dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.tick();
  assert.equal(c.querySelector('.log-f-step').value, '1', 'preflight click is a no-op');
});

test('the ✕ pill clears every log filter at once', async () => {
  const kinds = {
    steps: [
      { kind: 'agents', nodes: [{ id: 'clarify', key: 'clarify', label: 'Clarify', uiPhase: 'clarify' }] },
      { kind: 'agents', nodes: [{ id: 'planner', key: 'planner', label: 'Plan', uiPhase: 'plan' }] },
    ],
    feedbacks: [],
  };
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: kinds })] });
  await ctx.go('running');
  ctx.recv({ type: 'log', runId: 'a', source: 'clarify', level: 'info', text: 'q&a', stepIndex: 0, cycle: 1 });
  ctx.recv({ type: 'log', runId: 'a', source: 'planner', level: 'info', text: 'first pass', stepIndex: 1, cycle: 1 });
  ctx.recv({ type: 'state', runId: 'a', status: 'running',
    steps: [{ nodeId: 'clarify', cycle: 1, status: 'done' }, { nodeId: 'planner', cycle: 1, status: 'start' }] });
  await ctx.go('pipeline/a');
  await ctx.tick();
  const c = ctx.window.document.querySelector('#run-list .run-card.full');
  // Narrow via node click (source+step+cycle), then add a search term by hand.
  c.querySelector('.run-flow .run-node[data-id="planner"]')
    .dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.tick();
  const search = c.querySelector('.log-search');
  search.value = 'first';
  assert.equal(c.querySelectorAll('.run-log .log .log-line').length, 1, 'narrowed to one line');
  c.querySelector('.log-clear').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.tick();
  assert.equal(c.querySelector('.log-f-source').value, '', 'source back to all');
  assert.equal(c.querySelector('.log-f-step').value, '', 'step back to all');
  assert.equal(c.querySelector('.log-f-cycle').value, '', 'cycle back to all');
  assert.equal(search.value, '', 'search box emptied');
  assert.equal(c.querySelectorAll('.run-log .log .log-line').length, 2, 'every line visible again');
});

// ── the back button follows ownership, not the page you came from ───────────

test('a LIVE pipeline opened from History still says ← Running', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live('a', { stepper: STEPPER })] });
  await ctx.go('history');           // records detailOrigin = 'history'
  await ctx.go('pipeline/a');        // …but the pipeline is live
  const bar = ctx.window.document.querySelector('.view[data-view="running"] .detail-bar');
  assert.equal(bar.querySelector('.detail-back').textContent, '← Running',
    'a live pipeline has no History row to return to');
});

// ── Running project pills + grouping (History's toolbar, same classes) ──────

test('Running groups by project with History-style pills; the mini meta drops the project name', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [
    live('a', { stepper: STEPPER }),
    live('b', { stepper: STEPPER, projectDir: '/tmp/otherproj' }),
  ] });
  await ctx.go('running');
  await ctx.tick();
  const doc = ctx.window.document;
  const pills = [...doc.querySelectorAll('#runningFilter .hist-pill')].map((b) => b.textContent.trim());
  assert.deepEqual(pills.sort(), ['All Projects 2', 'otherproj 1', 'proj 1'],
    'one pill per project plus All (order follows the list order)');
  assert.equal(doc.querySelectorAll('#run-list .hist-group-head').length, 2,
    'one group header per project in the All view');
  // The meta line's project span exists but is CSS-hidden at list density.
  // Its '·' separator is a ::after so it hides with the span.
  assert.equal(card(ctx.window, 'a').querySelector('.rm-proj').textContent, 'proj');
  assert.match(css, /\.run-meta \.rm-proj::after\{content:'·';margin:0 8px;\}/);
  assert.match(css, /\.run-card\.mini \.run-meta \.rm-proj\{display:none;\}/);

  // A pill filters flat (no headers), like History's.
  [...doc.querySelectorAll('#runningFilter .hist-pill')]
    .find((b) => b.textContent.includes('otherproj'))
    .dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.tick();
  assert.equal(doc.querySelectorAll('#run-list .run-card').length, 1);
  assert.equal(doc.querySelectorAll('#run-list .hist-group-head').length, 0);

  // The detail page is about one pipeline: pills and headers go away.
  ctx.window.localStorage.removeItem('worca-cc.running.project');
  await ctx.go('pipeline/a');
  assert.equal(doc.querySelector('#runningFilter').hidden, true);
  assert.equal(doc.querySelectorAll('#run-list .hist-group-head').length, 0);
});
