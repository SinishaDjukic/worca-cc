// test/parity-crawl.test.mjs — the crawler's pure parts: enumeration (jsdom), actions, normalisation, masks, comparison,
// coverage and the route catalogue. No browser, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { enumerateIn, serializeDom, actionsFor, CRAWL_TEXT } from '../tools/parity/crawl-page.mjs';
import { normalizeLine, deriveMasks, compareCrawls, coverage, mutated, loadCalls, crawlSummary, renderCrawlReport, UNEXPLAINED } from '../tools/parity/crawl-compare.mjs';
import { tabListsOf, catalogue, TAB_ROUTES } from '../tools/parity/crawl-routes.mjs';
import { VARIANTS, FLAG_PASSES } from '../tools/parity/crawl.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window;
const all = { visible: () => true };

test('enumerateIn finds every interactive kind and keys it stably; duplicate rows and chrome are marked, not dropped', () => {
  const w = dom(`<aside class="sidebar" id="side-rail"><a href="#runs">Runs</a></aside><header class="topnav" id="topnav"><button>Menu</button></header>
    <section data-view="settings"><button data-action="save">Save</button><input name="q"><select><option>a</option><option>b</option></select>
    <label><input type="checkbox" role="switch" data-flag-switch="flagsDemo"></label><details><summary>More</summary></details>
    <span class="info-tip" tabindex="0">i</span><ul><li><a class="runs-row" href="#history/p/1">r1</a></li><li><a class="runs-row" href="#history/p/2">r2</a></li></ul></section>`);
  const els = enumerateIn(w.document, w, all);
  const kinds = Object.fromEntries(els.map((e) => [e.key, e.kind]));
  assert.equal(kinds['section[data-view="settings"] button[data-action="save"]'], 'button');
  assert.equal(els.find((e) => e.tag === 'select').kind, 'select');
  assert.equal(els.find((e) => e.role === 'switch').kind, 'toggle');
  assert.equal(els.find((e) => e.tag === 'summary').kind, 'disclosure');
  assert.equal(els.find((e) => e.cls?.includes('info-tip')).kind, 'tip');
  const rows = els.filter((e) => e.cls?.includes('runs-row'));
  assert.deepEqual([rows[0].dupOf, rows[1].dupOf], [null, rows[0].key]);
  assert.equal(els.find((e) => e.href === '#runs').chrome, true);                       // aside.sidebar#side-rail (index.html:18)
  assert.equal(els.find((e) => e.key.startsWith('#topnav ')).chrome, true);             // header.topnav#topnav (index.html:215)
  assert.equal(els.find((e) => e.key.includes('button[data-action="save"]')).chrome, false);
});
test('actionsFor: type/Enter/Escape for text, next option for select, toggle twice, hover a tip, click then Escape', () => {
  assert.deepEqual(actionsFor({ kind: 'text' }), [['fill', CRAWL_TEXT], ['press', 'Enter'], ['press', 'Escape']]);
  assert.deepEqual(actionsFor({ kind: 'toggle' }), [['click'], ['click']]);
  assert.deepEqual(actionsFor({ kind: 'button' }), [['click'], ['press', 'Escape']]);
});
test('serializeDom: one line per visible element, path-prefixed; ids and timestamps normalised, real text kept', () => {
  const w = dom('<div id="x"><span data-run-id="0b6f1c2e-1111-4222-8333-944445555666">done 2026-10-31T10:00:00Z</span></div>');
  const lines = serializeDom(w.document, w, all).map(normalizeLine);
  assert.ok(lines.some((l) => l.includes('data-run-id="<uuid>"') && l.includes('done <iso>')), lines.join('\n'));
});
test('normalizeLine: client-made random ids (Ask suggestions, workflow nodes) are normalised, other ids kept', () => {
  assert.equal(normalizeLine('<span id="ask-suggest-xnrpfl1s"><div data-node-id="n_yb5ygqz0" aria-label="task n_yb5ygqz0">'),
    '<span id="ask-suggest-<id>"><div data-node-id="n_<id>" aria-label="task n_<id>">');
  assert.equal(normalizeLine('#history/sandbox-a2279d8d/5f2e697d'), '#history/sandbox-a2279d8d/5f2e697d');
});
test('masks come from the control only; a diff outside them fails; a new console error in B fails', () => {
  const rec = (dom, png, net, con = []) => ({ id: 'settings|d-light-expert|off|save|0', dom, png, net, console: con });
  const a1 = [rec(['p1\tA', 'p2\t3 min ago'], 'h1', ['GET /api/x 200 {}'])];
  const a2 = [rec(['p1\tA', 'p2\t4 min ago'], 'h1', ['GET /api/x 200 {}'])];
  const masks = deriveMasks(a1, a2);
  assert.deepEqual(masks.map((m) => [m.field, m.path]), [['dom', 'p2']]);
  assert.equal(compareCrawls(a1, [rec(['p1\tA', 'p2\t9 min ago'], 'h1', ['GET /api/x 200 {}'])], masks).diffs.length, 0);
  assert.equal(compareCrawls(a1, [rec(['p1\tB', 'p2\t3 min ago'], 'h1', ['GET /api/x 200 {}'])], masks).diffs[0].field, 'dom');
  assert.equal(compareCrawls(a1, [rec(['p1\tA', 'p2\tx'], 'h1', ['GET /api/x 200 {}'], ['TypeError: boom'])], masks).diffs[0].field, 'console');
  assert.equal(compareCrawls(a1, [], masks).diffs[0].field, 'presence');
});
test('deriveMasks gives every mask a reason from the two control values; anything else is unexplained', () => {
  const r = (dom, extra = {}) => ({ id: 'x', dom, png: 'p', net: [], console: [], ...extra });
  const why = (a, b) => deriveMasks([a], [b]).map((m) => m.why);
  assert.deepEqual(why(r(['0\t<span>Runs: 2 need you']), r(['0\t<span>Runs: 1 needs you'])), [UNEXPLAINED]);   // words differ too
  assert.deepEqual(why(r(['0\t<span>built 1 Nov, 22:39']), r(['0\t<span>built 2 Nov, 04:25'])), ['a number differs (count or time)']);
  assert.deepEqual(why(r(['0\t<li class="row is-found">a']), r(['0\t<li class="row">a'])), ['class differs (transient state)']);
  assert.deepEqual(why(r(['0\t<p>a', '1\t<p>b']), r(['0\t<p>a'])), ['element on one control side only']);
  assert.deepEqual(why(r([], { net: ['GET /api/runs 200 - x'] }), r([])), ['request in flight at record time (one control side only)']);
  assert.deepEqual(why(r([], { console: ['boom'] }), r([])), ['console error on one control side only']);
  const png = (a, b) => deriveMasks([a], [b], { pngDiff: () => [0, 0, 10, 10] });
  assert.deepEqual(png(r(['0\t<p>a'], { png: 'p1' }), r(['0\t<p>a'], { png: 'p2' })).map((m) => m.why), ['raster noise, DOM identical']);
  assert.deepEqual(png(r(['0\t<p>1'], { png: 'p1' }), r(['0\t<p>2'], { png: 'p2' })).map((m) => m.why),
    ['a number differs (count or time)', 'pixels follow the DOM difference above']);
  assert.deepEqual(deriveMasks([], [r([])]).map((m) => m.why), ['record on one control side only']);
});

test('the crawl report lists every mask with its reason and counts them by reason', () => {
  const rep = { pass: true, control: true, a: { spec: 'tree:.' }, bs: [], minutes: 1, comparisons: [], externalApps: { stubbed: 0, canary: [] },
    coverage: { screens: 1, routes: { visited: 1, registered: 1, unvisited: [], unfillable: [] }, elements: { found: 0, exercised: 0, skipped: 0, byReason: {} } },
    masks: [{ id: '#chat|d|off|-|screen', field: 'png', rect: [0, 118, 1280, 355], why: 'raster noise, DOM identical' }] };
  const md = renderCrawlReport(rep);
  assert.match(md, /\| Record \| Field \| Where \| Why \|/); assert.match(md, /raster noise, DOM identical: 1/);
});

test('a screen-level comparison compares only A1 screen records: a B without steps is not "missing"', () => {
  const rec = (id, kind) => ({ id, kind, dom: ['0\t<p>x'], png: 'p', net: [], console: [] });
  const a = [rec('#runs|d-light-expert|off|-|screen', 'screen'), rec('#runs|d-light-expert|off|button|0', 'step')];
  const b = [rec('#runs|d-light-expert|off|-|screen', 'screen')];
  assert.equal(compareCrawls(a, b, [], { level: 'screen' }).pass, true);
  assert.equal(compareCrawls(a, b, [], { level: 'full' }).pass, false);
});

test('an app launch is part of the record: a launch on one side only is a net difference', () => {
  const r = (net) => [{ id: 'x', kind: 'step', dom: [], png: 'p', net, console: [] }];
  const line = "app POST /api/actions/launchers/try /bin/sh -c open -a Terminal '~'";
  assert.equal(compareCrawls(r([line]), r([line]), []).pass, true);
  assert.match(compareCrawls(r([line]), r([]), []).diffs[0].detail, /A only: app POST/);
});

test('crawlSummary names the stubbed launches and any real one', () => {
  const rep = { coverage: { screens: 1, routes: { visited: 1, registered: 1 }, elements: { found: 2, exercised: 1, skipped: 1 } }, masks: [],
    comparisons: [{ label: 'tree:s', level: 'full', diffs: [] }, { label: 'package:.', level: 'screen', diffs: [] }], externalApps: { stubbed: 3, canary: [] } };
  assert.match(crawlSummary(rep), /apps 3 stubbed, 0 real; .*tree:s 0 diffs, package:\. \(screens\) 0 diffs/);
});

test('coverage: a registered route never rendered fails the run; a gated one rendered in some pass is visited', () => {
  const c = coverage({ registered: ['#settings', '#requirements', '#workspaces/w1'], visits: [
    { route: '#settings', rendered: true }, { route: '#requirements', rendered: false, flags: 'off' }, { route: '#requirements', rendered: true, flags: 'on' }] });
  assert.deepEqual(c.unvisited, ['#workspaces/w1']);
});
test('mutated: a non-GET /api call dirties the state; GETs and static files do not', () => {
  assert.equal(mutated(['GET /api/runs 200 {}', 'GET /style.css 200 -']), false);
  assert.equal(mutated(['DELETE /api/projects/p 200 {}']), true);
  // a call the screen's own load already makes (History's POST /api/history/pr lookup) does not dirty the state
  const load = loadCalls(['POST /api/history/pr 200 {} {}', 'GET /api/runs 200 {} {}']);
  assert.equal(mutated(['POST /api/history/pr 200 {} {}'], load), false);
  assert.equal(mutated(['POST /api/history/pr 200 {} {}', 'POST /api/projects 200 {} {}'], load), true);
});
test('tab lists are read by name from app.js; object lists by key: only (never labels, levels or flag names)', () => {
  const src = "const SETTINGS_TABS = ['general', 'tags'];\n"
    + "const HD_TABS = [\n  { key: 'overview', label: 'Overview', level: 'simple' },\n  // a comment: 'nope'\n"
    + "  { key: 'diff', label: 'Diff', show: () => flagOn('gitAutomations') },\n];\n";
  assert.deepEqual(tabListsOf(src), { SETTINGS_TABS: ['general', 'tags'], HD_TABS: ['overview', 'diff'] });
});
test('an unmapped *_TABS list throws instead of being skipped; every list in the real app.js is mapped', () => {
  assert.throws(() => catalogue({ appJs: 'const NEW_TABS = [\'a\'];', views: [], cards: [], ids: {} }), /unmapped tab list NEW_TABS/);
  const appJs = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  for (const name of Object.keys(tabListsOf(appJs))) assert.equal(typeof TAB_ROUTES[name], 'function', `${name} has no route mapping`);
  assert.ok(tabListsOf(appJs).SETTINGS_TABS.includes('guardrails'));
});
test('GROUP_TABS pairs give their ids, never their labels', () => {
  const c = catalogue({ appJs: '', views: [], cards: [], groupTabs: [['runs', 'Runs'], ['logs', 'Logs']], ids: { groupId: 'g1', featureId: 'f1' } });
  assert.ok(c.registered.includes('#group/g1/logs') && c.registered.includes('#feature/f1/runs'));
  assert.ok(!c.registered.some((r) => r.includes('Runs')));
});
test('variants: exactly two exercise variants (desktop and 375px, light, expert); both flag passes', () => {
  assert.deepEqual(VARIANTS.filter((v) => v.exercise).map((v) => [v.width, v.theme, v.level]), [[1280, 'light', 'expert'], [375, 'light', 'expert']]);
  assert.deepEqual(new Set(VARIANTS.map((v) => v.level)), new Set(['expert', 'simple', 'advanced']));
  assert.deepEqual(FLAG_PASSES, ['off', 'on']);
});
test('every STATIC_ROUTES head (the text before the first "{") is a string the UI modules carry', async () => {
  const { readdirSync } = await import('node:fs');
  const { STATIC_ROUTES } = await import('../tools/parity/crawl-routes.mjs');
  const dir = new URL('../ui/public/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.m?js$/.test(f) && !f.includes('node_modules'))
    .map((f) => readFileSync(new URL(f, dir), 'utf8'));
  for (const r of STATIC_ROUTES) {
    const head = r.split('{')[0].replace(/\/$/, '');
    const [view, ...rest] = head.slice(1).split('/');
    // the whole head as a literal, or (a route built by a page's own route(param) helper) its last segment quoted in a
    // module that also names the view's hash
    const ok = files.some((src) => src.includes(head) || src.includes(`'${head.slice(1)}`) || src.includes(`\`${head.slice(1)}`)
      || (rest.length && src.includes(`#${view}`) && new RegExp(`['\`]${rest.at(-1)}['\`/]`).test(src)));
    assert.ok(ok, `${r}: "${head}" is not in ui/public`);
  }
});
test('shard: route i to worker i % n, every route exactly once', async () => {
  const { shard } = await import('../tools/parity/crawl.mjs');
  const r = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual([0, 1].map((k) => shard(r, 2, k)), [['a', 'c', 'e'], ['b', 'd']]);
});
test('renderCrawlReport: coverage with the unvisited list, every mask, differences with their image link', async () => {
  const { renderCrawlReport } = await import('../tools/parity/crawl-compare.mjs');
  const r = { pass: false, control: true, minutes: 3, a: { spec: 'tree:.', tree: 't1' }, bs: [{ spec: 'tree:/s', tree: 't2' }],
    masks: [{ id: '#settings|d-light-expert|off|-|0', field: 'dom', path: '0.1.2' }],
    comparisons: [{ label: 'split', pass: false, diffs: [{ id: '#settings|d-light-expert|off|body button:text("Save")|0', field: 'png', detail: '12 px', diff: 'diffs/1.png' }] }],
    coverage: { screens: 9, routes: { registered: 3, visited: 2, unvisited: ['#workspaces/w1'], unfillable: [] }, elements: { found: 10, exercised: 7, skipped: 3, byReason: { 'duplicate of x': 3 } } } };
  const md = renderCrawlReport(r);
  assert.match(md, /^# Differential crawl — FAIL$/m);
  assert.match(md, /^ {2}- unvisited: `#workspaces\/w1`$/m);
  assert.ok(md.includes('| dom | 0.1.2 |'), md);
  assert.match(md, /\| png \| 12 px \| \[png\]\(diffs\/1\.png\) \|$/m);
});
test('enumerateIn keep: the elements are stashed index-aligned in window.__crawlEls; a root element scopes the walk', () => {
  const w = dom('<section data-view="x"><button>A</button><div role="menu" id="m"><button role="menuitem">B</button></div></section>');
  const els = enumerateIn(w.document, w, { ...all, keep: true });
  assert.equal(w.__crawlEls.length, els.length);
  assert.equal(w.__crawlEls[els.findIndex((e) => e.role === 'menuitem')].textContent, 'B');
  assert.deepEqual(enumerateIn(w.document.getElementById('m'), w, all).map((e) => e.role), ['menuitem']);
});
test('chordKeys: a modifier chord is one combo, a bare chord lists alternatives; keyProbes takes the page sections, Anywhere once', async () => {
  const { chordKeys, keyProbes, canonicalHash } = await import('../tools/parity/crawl.mjs');
  assert.deepEqual(chordKeys(['mod', 'K'], true), ['Meta+k']);
  assert.deepEqual(chordKeys(['alt', 'ArrowUp'], false), ['Alt+ArrowUp']);
  assert.deepEqual(chordKeys(['ArrowUp', 'ArrowDown']), ['ArrowUp', 'ArrowDown']);
  assert.deepEqual(chordKeys(['Space']), [' ']);
  const sections = [{ list: null, rows: [{ keys: [['?']] }] }, { list: 'runs', rows: [{ keys: [['J', 'K']] }] }];
  assert.deepEqual(keyProbes(sections), ['j', 'k', 'Escape']);
  assert.deepEqual(keyProbes(sections, { anywhere: true }), ['?', 'j', 'k', 'Escape']);
  // discovered hashes: seed ids become their keys; a crawl-made id (not in the seed) drops the hash
  const ids = { projectKey: 'sandbox-a2279d8d', pipelineId: '5f2e697d' };
  assert.equal(canonicalHash('#history/sandbox-a2279d8d/5f2e697d/details/logs', ids), '#history/{projectKey}/{pipelineId}/details/logs');
  assert.equal(canonicalHash('#chat/ask_0123abcd', ids), null);
});
test('ownerOf: a discovered route has exactly one owner worker, the same on every side and run', async () => {
  const { ownerOf } = await import('../tools/parity/crawl.mjs');
  const r = '#history/{projectKey}/{pipelineId}/details/logs';
  assert.equal(ownerOf(r, 8), ownerOf(r, 8));
  assert.ok(ownerOf(r, 8) >= 0 && ownerOf(r, 8) < 8);
  const spread = new Set(['#a', '#b', '#c', '#d', '#e', '#f', '#g', '#h', '#i', '#j'].map((x) => ownerOf(x, 4)));
  assert.ok(spread.size > 1, 'routes spread over the workers');
});
test('a view that is only ever a detail page (feature) is catalogued with its id, never bare', () => {
  const c = catalogue({ appJs: '', views: ['chat', 'feature'], cards: [], ids: { featureId: 'f1' } });
  assert.ok(c.registered.includes('#feature/f1'));
  assert.ok(!c.registered.includes('#feature'), 'bare #feature falls back to Chat: it is not a page');
  assert.ok(c.registered.includes('#chat'));
});
test('normalizeLine: a local server port is normalised (each server has its own)', () => {
  assert.equal(normalizeLine('Failed to fetch http://127.0.0.1:52928/vendor/x and localhost:4317'), 'Failed to fetch http://127.0.0.1:<port>/vendor/x and localhost:<port>');
});
test('SEEDED_RANDOM: every page gets the same Math.random sequence (a rotating placeholder picks the same one)', async () => {
  const { SEEDED_RANDOM } = await import('../tools/parity/crawl.mjs');
  const { runInNewContext } = await import('node:vm');
  const seq = () => JSON.parse(runInNewContext(`${SEEDED_RANDOM}; JSON.stringify([Math.random(), Math.random(), Math.random()])`, { Math: Object.create(Math) }));
  const a = seq(); const b = seq();
  assert.deepEqual(a, b);
  assert.ok(a.every((x) => x >= 0 && x < 1) && new Set(a).size === 3);
});
test('FROZEN_INTERVALS: a repeating timer of 1 s or more never fires; a short one and setTimeout still do', async () => {
  const { FROZEN_INTERVALS } = await import('../tools/parity/crawl.mjs');
  const { runInNewContext } = await import('node:vm');
  const fired = [];
  const ctx = { setInterval, clearInterval, setTimeout, fired };
  runInNewContext(`${FROZEN_INTERVALS}; const a = setInterval(() => fired.push('long'), 1000); const b = setInterval(() => fired.push('short'), 20);
    setTimeout(() => fired.push('timeout'), 30); setTimeout(() => { clearInterval(a); clearInterval(b); }, 1300);`, ctx);
  await new Promise((r) => setTimeout(r, 1400));
  assert.ok(!fired.includes('long'), 'the 1 s interval is frozen');
  assert.ok(fired.includes('short') && fired.includes('timeout'));
});
test('serializeDom drops entrance-animation markers (data-ask-enter): motion state, not content', () => {
  const w = dom('<div class="ask-msg" data-ask-enter="" data-id="m1">hi</div>');
  const line = serializeDom(w.document, w, all).find((l) => l.includes('ask-msg'));
  assert.ok(line.includes('data-id="m1"') && !line.includes('data-ask-enter'), line);
});
test('freePortRun: N consecutive free ports, never the host app port, skipping a taken one', async (t) => {
  const { freePortRun } = await import('../tools/parity/crawl.mjs');
  const { createServer } = await import('node:net');
  const blocker = createServer(); t.after(() => blocker.close());
  const taken = await new Promise((ok) => { const tryAt = (p) => { blocker.once('error', () => tryAt(p + 7)); blocker.listen(p, '127.0.0.1', () => ok(p)); }; tryAt(47213); });
  const run = await freePortRun(3, { from: taken - 1 });
  assert.equal(run.length, 3);
  assert.ok(!run.includes(taken) && !run.includes(4317), JSON.stringify(run));
  assert.deepEqual(run, [run[0], run[0] + 1, run[0] + 2]);
});
