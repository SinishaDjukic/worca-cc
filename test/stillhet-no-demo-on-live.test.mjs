// test/stillhet-no-demo-on-live.test.mjs — gate.no-demo (docs/rail/gate.md, B1.10): a live Stillhet shows no demo data, no
// would-answer and no local-only success. Static: every demo-answer site under ui/public/stillhet/ and every `wire to` row of
// plans/rail/stillhet-wiring.md is classified in test/fixtures/stillhet-no-demo-baseline.json (tools/stillhet-no-demo.mjs),
// and the offenders can only shrink. Live: an app host with an EMPTY live adapter walks every place in the bar, Pulse and
// every Settings section; what it finds must equal the baseline's `live` list.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sitesOfText, demoActionSites, wireToSites, update, scanSites, checkSites, BASELINE, STRINGS } from '../tools/stillhet-no-demo.mjs';
import { liveHost, go, settle, closeHosts, toastText, saidText, SOURCES as SOURCES_FIXTURE } from './helpers/stillhet-chat-live-host.mjs';
import { SOURCES } from '../ui/public/stillhet/live/live-adapter.mjs';
import { VIEWS_KEY } from '../ui/public/stillhet/live/insights-live.mjs';

afterEach(closeHosts);
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const demoStrings = JSON.parse(readFileSync(STRINGS, 'utf8'));
const stillhet = (p) => new URL('../ui/public/stillhet/' + p, import.meta.url);

test('B1.10 A1: every demo-answer site and every wire-to row is classified', () => {
  const { unclassified } = checkSites(scanSites(), baseline);
  assert.deepEqual(unclassified, [], `B1.10: classify these demo-answer sites in test/fixtures/stillhet-no-demo-baseline.json (wired, refused, not-in-stillhet, prototype-only): ${unclassified.join('; ')}`);
});

test('B1.10 A1: no baseline entry is stale (the list only shrinks)', () => {
  const { stale } = checkSites(scanSites(), baseline);
  assert.deepEqual(stale, [], 'B1.10: these sites are gone or fixed; lower the baseline: node tools/stillhet-no-demo.mjs --update');
});

test('B1.10 A1: each classification carries its evidence', () => {
  const { bad } = checkSites(scanSites(), baseline);
  assert.deepEqual(bad, [], 'B1.10: each class needs its evidence: wired a `via` path, not-in-stillhet a `rule`, an offender its `finding` and `owner`');
  // the check itself refuses a bare claim
  const bare = { sites: { a: { class: 'wired', why: 'x', via: 'test/no-such-file.test.mjs' }, b: { class: 'offender', why: 'x' }, c: { class: 'not-in-stillhet', why: 'x', rule: 'set.nothing' }, d: { class: 'refused', why: '' } } };
  assert.deepEqual(checkSites([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], bare).bad.map((x) => x.id), ['a', 'b', 'c', 'd']);
});

test('B1.10 RC7: each demo string still appears in its demo source', () => {
  assert.ok(demoStrings.length >= 10, 'the forbidden list is never near empty');
  for (const { text, source } of demoStrings) {
    assert.ok(text.length >= 6, `"${text}" is at least 6 characters`);
    assert.ok(!source.startsWith('live/'), `${source} is a demo source, not the live layer`);
    assert.ok(existsSync(stillhet(source)), `${source} exists`);
    assert.ok(readFileSync(stillhet(source), 'utf8').includes(text), `"${text}" still appears in ${source}`);
  }
});

test('B1.10: the scanner reads would, act, demo-action and demo-row sites with stable ids', () => {
  const src = [
    "  btn.onclick = () => window.RailWould('open a terminal in the worktree');",
    "  // window.RailWould('a comment')",
    "  other.onclick = () => window.RailWould('open a terminal in the worktree');",
    '  x = window.RailWould(`stop ${name}`);',
    '  y = window.RailWould(phrase);',
    "  RailAdapter.act('retry-run'); RailAdapter.refuse(id);",
    "  { name: 'Setup assistant', only: 'demo', say: 'x' },",
    "  { title: 'Storage', sample: true, rows: [",
    "  { sample: true, rows: [",
    "  // { name: 'A comment row', sample: true }",
    "  { name: 'Setup assistant', only: 'demo' },",
  ].join('\n');
  const ids = sitesOfText('runs/run-page.js', src).map((s) => s.id);
  assert.deepEqual(ids, [
    'runs/run-page.js › would › open a terminal in the worktree',
    'runs/run-page.js › would › a comment',
    'runs/run-page.js › would › open a terminal in the worktree #2',
    'runs/run-page.js › would › stop …',
    'runs/run-page.js › would › (a phrase built from data)',
    'runs/run-page.js › act › retry-run',
    'runs/run-page.js › act › (an id built from data)',
    'runs/run-page.js › demo-row › Setup assistant',
    'runs/run-page.js › demo-row › Storage',
    'runs/run-page.js › demo-row › (unnamed)',
    'runs/run-page.js › demo-row › Setup assistant #2',
  ]);
  // the seam itself answers the calls: it holds no site
  assert.deepEqual(sitesOfText('adapter.js', src).filter((s) => s.kind === 'would' || s.kind === 'act'), []);
  assert.deepEqual(sitesOfText('demo/demo-actions.js', "window.RailWould('x')").length, 0);
  // a demo action other than `would` is a site
  assert.deepEqual(demoActionSites("window.RailDemoActions = { would: (p) => 'Would ' + p, retry: () => 'ok' };").map((s) => s.id), ['demo/demo-actions.js › demo-action › retry']);
});

test('B1.10: wire-to rows from every section, Dev surfaces included; update refuses a new offender', () => {
  const doc = [
    '# Wiring', '', '## Action rows', '', '| Id | Status | Source |', '|---|---|---|',
    '| `a/b.js › copy it` | wire to | the routes |', '| `a/b.js › done` | wired | `x.mjs` |', '',
    '## Dev surfaces', '', '| `setting › keepAwake` | wire to | Settings › General |', '| `setting › x` | wired | y |', '',
  ].join('\n');
  assert.deepEqual(wireToSites(doc).map((s) => s.id), [
    'stillhet-wiring.md › wire-to › Action rows › a/b.js › copy it',
    'stillhet-wiring.md › wire-to › Dev surfaces › setting › keepAwake',
  ]);
  const sites = [{ id: 'a' }, { id: 'b' }];
  const base = { sites: { a: { class: 'refused', why: 'Not connected to Worca yet.' }, b: { class: 'offender', why: 'leaks', finding: 'B1.10', owner: 'B8' }, gone: { class: 'wired', why: 'x', via: 'tools/stillhet-no-demo.mjs' } }, live: ['live › #chat › demo-text › X'] };
  const ok = update(sites, base);
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.baseline.sites), ['a', 'b'], 'the stale entry is dropped');
  assert.deepEqual(ok.baseline.live, base.live, 'live is kept as is');
  // a new site needs a hand classification
  assert.deepEqual(update([...sites, { id: 'c' }], base), { ok: false, refused: ['c'] });
  // a new offender is refused: the list only shrinks
  const grown = { ...base, sites: { ...base.sites, a: { class: 'offender', why: 'x', finding: 'B1.10', owner: 'B8' } } };
  assert.deepEqual(update(sites, grown, base), { ok: false, refused: ['a'] });
});

// ---- the live walk: an empty install, every place in the bar, Pulse and every Settings section ----

// One answer per boot source of the live adapter (SOURCES), each the empty shape dev's route gives on a fresh install, plus
// the socket's hello. L1 fails when a source is added without its empty answer here.
const EMPTY_SOURCES = {
  history: { pipelines: [] }, threads: { threads: [], counts: {} }, groups: { groups: [] }, schedules: { schedules: [], tickets: [], counts: {} },
  projects: { projects: [] }, sync: { projects: {} }, budget: {}, actions: { actions: [] }, notifications: { notifications: [] }, away: {},
  settings: {}, runLinks: { links: [] }, runGroups: { groups: [] }, usageLimits: {}, workspaces: { workspaces: [] }, archived: { pipelines: [] }, hello: { runs: [] },
};
// the per-place GET lists, empty
const EMPTY_LISTS = {
  '/api/plugins': { plugins: [], orphans: [] }, '/api/marketplaces': { marketplaces: [] }, '/api/workflows': { workflows: [] },
  '/api/scripts': { scripts: [] }, '/api/agents': { agents: [] }, '/api/ask/models': { models: [] }, '/api/guardrails': { guardrails: [] },
  '/api/chat-home/pins': { pins: [] }, '/api/tag-dimensions': { dimensions: [] }, '/api/flags': { flags: {} },
};
const BOOT_URLS = new Set(Object.values(SOURCES));
// any other GET (an Insights read, a workflow's usage) answers an empty object; it is recorded in `calls` like every request
const read = (u) => (BOOT_URLS.has(u) || EMPTY_LISTS[u] ? null : [200, {}]);
const emptyHost = (hash = '#chat') => liveHost({ sources: EMPTY_SOURCES, lists: EMPTY_LISTS, read, hash });

/**
 * Every Settings section the menu offers: the menu is built from GROUPS, and Notifications is a menu item with no
 * SECTIONS entry (it is drawn from NOTIFICATIONS), so both lists are read.
 */
const settingsPlaces = (w) => [...new Set([...w.SettingsModel.GROUPS.flatMap((g) => g.items), ...Object.keys(w.SettingsModel.SECTIONS)])].map((k) => `settings/${k}`);
/** The places the walk visits: the bar's places and Pulse (routes without a `/`), then every Settings section. */
const places = (w) => [...w.RailShell.routes().filter((r) => !r.includes('/')), ...settingsPlaces(w)];
// the bar's places as shell.js declares them (PLACES), read from the source so a new place is walked
const PLACE_IDS = [...readFileSync(stillhet('shell/shell.js'), 'utf8').match(/const PLACES = (.+);/)[1].matchAll(/\['(\w+)', '[^']+', '(?:simple|advanced|expert)'/g)].map((m) => m[1]);

const shown = (e) => !e.closest('[hidden]');
const FORBIDDEN = demoStrings.map((x) => x.text);
/** One id per demo string or would-answer the page SHOWS (hidden panes are not seen): text plus title, aria-label, placeholder, data-say. */
function scan(d, hash) {
  const body = d.body.cloneNode(true);
  for (const e of body.querySelectorAll('[hidden]')) e.remove();
  const attrs = [...body.querySelectorAll('[title], [aria-label], [placeholder], [data-say]')].flatMap((e) => ['title', 'aria-label', 'placeholder', 'data-say'].map((a) => e.getAttribute(a) || ''));
  const text = [body.textContent, ...attrs].join('\n');
  const hits = FORBIDDEN.filter((s) => text.includes(s));
  if (/\bWould\b/.test(text)) hits.push('Would');
  return hits.map((s) => `live › ${hash} › demo-text › ${s}`);
}

const SUCCESS = /\b(Saved|Applied|Sent|Done|Turned (on|off)|Updated|Installed)\b/;
/**
 * A click is a local-only success when it sent nothing and kept nothing, yet a switch flipped or the page said it was done.
 * Kept: the live layer's own store (Insights' saved views live in the browser by design, VIEWS_KEY). A refusal with no
 * state change is never a success (I3).
 */
const localSuccess = ({ sent, kept, flipped, said }) => !sent && !kept && (flipped || SUCCESS.test(said));
const label = (e) => (e.getAttribute('aria-label') || e.textContent).replace(/\s+/g, ' ').trim();
const CONTROL = (e) => e.matches('[role="switch"]') || /^(Save|Apply|Send|Test)\b/.test(label(e));

/** Clicks every switch and Save, Apply, Send or Test button the route shows (D10); a dialog is answered No and noted. */
async function press(w, d, hash, calls) {
  const out = [], controls = () => [...d.querySelectorAll('main [role="switch"], main button')].filter((e) => shown(e) && CONTROL(e));
  const n = controls().length;
  for (let k = 0; k < n; k++) {
    const el = controls()[k];
    if (!el || el.disabled) continue;
    const posts = calls.filter((c) => c.method !== 'GET').length, checked = el.getAttribute('aria-checked'), views = w.localStorage.getItem(VIEWS_KEY);
    const before = `${toastText(d)}|${saidText(d)}`, name = label(el);
    el.click();
    await settle(40);
    const dialog = d.querySelector('dialog[open]');
    if (dialog) { dialog.querySelector('[data-dialog-no], .btn-quiet')?.click(); await settle(10); }   // asked: its Yes is never walked (I2)
    const said = `${toastText(d)}|${saidText(d)}`;
    if (localSuccess({ sent: calls.filter((c) => c.method !== 'GET').length > posts, kept: w.localStorage.getItem(VIEWS_KEY) !== views,
      flipped: el.isConnected && checked !== null && el.getAttribute('aria-checked') !== checked, said: said === before ? '' : said })) out.push(`live › ${hash} › local-success › ${name}`);
  }
  return out;
}

/** Walks the given places of one empty host: what each shows, or (with `click`) what its controls do. */
async function walkPlaces(ids, { click = false } = {}) {
  const { w, d, calls } = await emptyHost();
  const hits = [];
  for (const id of typeof ids === 'function' ? ids(w) : ids) {
    await go(w, '#' + id, 120);
    hits.push(...(click ? await press(w, d, '#' + id, calls) : scan(d, '#' + id)));
  }
  return { w, d, calls, hits };
}

// A live id is `live › HASH › KIND › WHAT`. Each walk test owns one slice of the baseline's `live` list (its hashes and
// kind) and checks it exactly: a new hit fails (added), a listed one no longer found fails (stale) with the list to paste.
const partsOf = (id) => { const [, hash, kind] = id.split(' › '); return { hash, kind }; };
const SLICES = {
  work: (x) => x.kind === 'demo-text' && ['#chat', '#runs', '#schedules'].includes(x.hash),
  build: (x) => x.kind === 'demo-text' && ['#workflows', '#requirements', '#marketplace'].includes(x.hash),
  manage: (x) => x.kind === 'demo-text' && ['#projects', '#insights', '#pulse', '#chat (the bell)'].includes(x.hash),
  settings: (x) => x.kind === 'demo-text' && /^#settings(\/|$)/.test(x.hash),
  controls: (x) => x.kind === 'local-success',
};
function exactly(slice, hits) {
  const inSlice = (id) => SLICES[slice](partsOf(id));
  const found = [...new Set(hits)].sort(), listed = baseline.live.filter(inSlice);
  const added = found.filter((h) => !listed.includes(h)), stale = listed.filter((h) => !found.includes(h));
  assert.deepEqual(added, [], `B1.10 gate.no-demo: demo shown or a local-only success on live: ${added.join('; ')}`);
  assert.deepEqual(stale, [], `B1.10: fixed on live; set \`live\` in the baseline to: ${JSON.stringify([...baseline.live.filter((h) => !inSlice(h)), ...found].sort())}`);
}

test('B1.10: the empty live adapter boots and the walk covers every place in the bar', async () => {
  assert.deepEqual(Object.keys(SOURCES).filter((k) => !(k in EMPTY_SOURCES)), [], 'every boot source has its empty answer');
  const { w, calls } = await emptyHost();
  assert.notEqual(w.RailDemoState.list, 'failed', 'the empty install loads: a failed list would hide demo behind "failed"');
  for (const u of BOOT_URLS) assert.ok(calls.some((c) => c.url === u), `boot read ${u}`);
  const walked = places(w);
  assert.ok(PLACE_IDS.length >= 9, 'the bar\'s places are read from shell.js');
  for (const id of [...PLACE_IDS, 'pulse']) assert.ok(walked.includes(id), `the walk visits #${id}`);
  for (const id of settingsPlaces(w)) assert.ok(walked.includes(id), `the walk visits #${id}`);
  // the menu's GROUPS hold a section SECTIONS lacks (Notifications): the walk must not read SECTIONS alone
  assert.ok(walked.includes('settings/notifications'), 'the walk visits #settings/notifications');
  assert.deepEqual(scan(w.document, '#x'), [], 'the scan sees no demo at rest');
  // the scan reads what is shown, its attributes too, and never a hidden pane
  const t = w.document.createElement('div');
  t.innerHTML = `<p title="${FORBIDDEN[0]}">x</p><p hidden>${FORBIDDEN[1]}</p><p>It Would open</p>`;
  w.document.body.append(t);
  assert.deepEqual(scan(w.document, '#x'), [`live › #x › demo-text › ${FORBIDDEN[0]}`, 'live › #x › demo-text › Would']);
  t.remove();
});

test('B1.10 F-a4-01: Work places (Chat, Tasks, Schedules) show no demo', async () => {
  exactly('work', (await walkPlaces(['chat', 'runs', 'schedules'])).hits);
});

test('B1.10 F-5-01: Build places (Workflows, Requirements, Marketplace) show no demo', async () => {
  exactly('build', (await walkPlaces(['workflows', 'requirements', 'marketplace'])).hits);
});

test('B1.10: Manage and Insight places and Pulse (Projects, Insights, the bell) show no demo', async () => {
  const { w, d, hits } = await walkPlaces(['projects', 'insights', 'pulse']);
  // the bell opens Pulse over the page: its rows and the budget ($1,000 sample) come from the store, empty here
  await go(w, '#chat', 60);
  const bell = d.querySelector('#rail-pulse-slot button, #rail-pulse-slot [role="button"]');
  assert.ok(bell, 'the bell is drawn');
  bell.click();
  await settle(60);
  hits.push(...scan(d, '#chat (the bell)'));
  exactly('manage', hits);
});

test('B1.10 F-7b-11: every Settings section shows no demo', async () => {
  exactly('settings', (await walkPlaces((w) => ['settings', ...settingsPlaces(w)])).hits);
});

test('B1.10 F-7b-01/F-7b-02: save, apply, send and switch controls send a request or say why', async () => {
  const { hits, calls } = await walkPlaces(places, { click: true });
  exactly('controls', hits);
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE'), [], 'the walk never confirms a delete (I2)');
  // a refusal is not a success; a save kept in the live layer's own store is not local-only (I3)
  assert.equal(localSuccess({ sent: false, kept: false, flipped: false, said: 'Not connected to Worca yet.' }), false);
  assert.equal(localSuccess({ sent: false, kept: false, flipped: true, said: '' }), true);
  assert.equal(localSuccess({ sent: false, kept: false, flipped: false, said: 'Saved your folders' }), true);
  assert.equal(localSuccess({ sent: true, kept: false, flipped: true, said: 'Saved' }), false);
  assert.equal(localSuccess({ sent: false, kept: true, flipped: false, said: 'Saved Spend by project to Your views' }), false);
});

// The walk tests above check their slices exactly; this one keeps the `live` list whole: every entry is a live id that one
// slice owns, once, so no entry sits outside every check and the list can only shrink.
test('B1.10 A1: live offenders equal the baseline\'s live list', () => {
  for (const id of baseline.live) {
    assert.match(id, /^live › #[^›]+ › (demo-text|local-success) › .+$/, `${id} is a live id`);
    assert.equal(Object.values(SLICES).filter((f) => f(partsOf(id))).length, 1, `${id} belongs to exactly one walk`);
  }
  assert.equal(new Set(baseline.live).size, baseline.live.length, 'no entry twice');
  assert.throws(() => exactly('work', ['live › #chat › demo-text › Closes #942']), /B1\.10 gate\.no-demo/, 'a new hit fails');
});

// F-G-G2-02 (= F-cov23-10): the walk above boots an empty adapter, so it never opened a task waiting on its question. A live
// task page with the run's own question, and one whose ask the page cannot draw, show none of the design's sample asks,
// under its step or in Plan › Decisions (DETAIL.asks is the prototype's only)
test('F-G-G2-02: a live task waiting on its question shows no sample question, under its step or in Decisions', async () => {
  for (const q of [{ id: 'q-1', kind: 'clarify', questions: [{ id: 'a', question: 'Should the export include archived invoices?', options: ['Yes', 'No'] }] }, { id: 'f-1', kind: 'form', form: 'release' }]) {
    const src = JSON.parse(JSON.stringify(SOURCES_FIXTURE));
    src.hello.runs = src.hello.runs.map((r) => (r.runId === 'run-a' ? { ...r, pendingQuestion: q } : r));
    const { d } = await liveHost({ sources: src });
    await go(d.defaultView, '#run/run-a', 200); await settle(300);
    const dec = d.querySelector('#route-run:not([hidden]) #card [data-key="tab:decisions"]');
    if (dec) { dec.click(); await settle(60); }
    assert.deepEqual(scan(d, '#run/run-a'), [], `${q.kind}: no sample question`);
    if (q.kind === 'clarify') assert.match(d.querySelector('#route-run:not([hidden]) #card').textContent, /Should the export include archived invoices\?/);
  }
});

// F-G-G5-01: the prototype's Invitation (`?invite=stillhet`) is demo input. Live Stillhet means `rail` is on, and the opt-in
// rule (ui/public/stillhet.mjs shouldAskStillhet) never asks while it is on; today's app owns the real question. So live
// draws no strip, no demo bug link, and its answers never land in browser storage alone.
test('F-G-G5-01: live Stillhet never draws the demo Invitation for ?invite=stillhet', async () => {
  const { w, d, calls } = await liveHost({ sources: EMPTY_SOURCES, lists: EMPTY_LISTS, read, hash: '#runs', search: '?invite=stillhet' });
  await settle(120);
  assert.equal(w.location.search, '?invite=stillhet');
  assert.equal(w.RailShell.inviteStrip(), '', 'no Invitation on live');
  assert.equal(d.querySelector('[data-stillhet="invitation"]'), null, 'none drawn');
  assert.equal(d.querySelector('a[href="https://github.com/"]'), null, 'no demo bug link');
  w.RailShell.answerInvite('yes');
  assert.equal(w.localStorage.getItem('worca-rail.stillhetAsked'), null, 'an answer is never kept in the browser alone');
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [], 'and sends nothing');
});

// gate G F-G-fid-07/08: a live workflow's story says what dev knows, never the prototype's telling. Its steps read their
// agents' own descriptions (not the demo's fixed sentences); no "Told by" a model that never wrote it; how a task goes
// through it has no split dev never counted (half the tasks each way) and no "never yet".
test('F-G-fid-07/F-G-fid-08: a live workflow shows its agents\' descriptions, no model byline, no made-up split', async () => {
  const { workflowsHost, WF_LISTS, go: goWf } = await import('./helpers/stillhet-workflows-host.mjs');
  const usage = { '/api/workflow-usage': { usage: { wf_default: { tasks: 2, merged: 0, running: 0, nodes: {} } } } };
  const { w, d } = await workflowsHost({ hash: '#workflows/workflow:wf_default', lists: { ...WF_LISTS, ...usage } });
  const page = () => (d.querySelector('#route-place') || d.body).textContent.replace(/\s+/g, ' ');
  const planner = WF_LISTS['/api/agents'].agents.find((a) => a.key === 'planner');
  for (const mode of ['simple', 'advanced', 'expert']) {
    w.RailUI.prefs.setMode(mode); await goWf(w, '#workflows', 40); await goWf(w, '#workflows/workflow:wf_default', 120);
    d.querySelector('[data-wf-ways][aria-expanded="false"]')?.click(); await settle(40);   // Advanced and Expert fold the ways: open them
    const t = page();
    assert.ok(t.includes(planner.description), `${mode}: Plan reads its agent's description`);
    for (const fixed of ['Thinks before touching anything', 'Makes the change and runs your tests', 'Reads it the way a colleague would']) assert.ok(!t.includes(fixed), `${mode}: no demo sentence "${fixed}"`);
    assert.doesNotMatch(t, /Told by/, `${mode}: no model byline on live`);
    assert.match(t, /Straight through/, `${mode}: the ways are drawn`);
    assert.doesNotMatch(t, /\d+ of \d+ tasks/, `${mode}: no split dev never counted`);
    assert.doesNotMatch(t, /never yet/, `${mode}: no "never yet"`);
  }
});
