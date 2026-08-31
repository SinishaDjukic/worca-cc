// test/ui-sidebar-collapse.test.mjs — the sidebar's two states: the 298px
// labelled column and the 76px icon rail. Markup + CSS contract, plus jsdom
// behaviour driven through the REAL app.js against the REAL index.html
// (harness lifted from test/ui-pipeline-tabs.test.mjs:15-36).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const htmlPath = join(root, 'index.html');
const appPath = join(root, 'app.js');
const html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const PROJECT = '/tmp/proj';
const KEY = 'worca-cc.sidebar.collapsed';
const DAY = 86400000;

// The suite's canonical helper (test/ui-pinned-sidebar.test.mjs:16-20): pull a
// FLAT rule body, anchored on a non-word char (or start) so a selector ending in
// the same WORD cannot match. Two consequences that bite:
//   (a) the capture is ([^}]*) — it stops at the FIRST closing brace, including
//       one inside a comment. Hence the plan's hard rule: no comments inside
//       rule bodies, and no closing brace in any comment in the new block.
//   (b) the anchor class includes whitespace, so a DESCENDANT selector ending in
//       the same compound ('.sidebar.collapsed .side-foot' vs '.side-foot') CAN
//       match — which is why every base rule must stay ahead of the appended
//       block, and why the guards below check what they matched.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

const budgetFixture = () => ({
  pipelineLimitUsd: null, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 20, allTimeSpendUsd: 20,
  remainingUsd: 30, blocked: false,
});

async function boot({ seed = null, breakStorage = false,
                      poisonToggle = false, noBudget = false,
                      spyReflow = false } = {}) {
  // index.html SHIPS aria-expanded="true" / title="Collapse menu" /
  // aria-label="Collapse menu" on #side-toggle, so asserting those after an
  // EXPANDED boot passes even when applySidebarCollapsed() never ran — proven by
  // deleting its whole `if (btn)` branch and watching the suite stay green.
  // poisonToggle strips them, so only a real write can satisfy the assertion.
  // Verified safe: index.html's only other two aria-expanded are ="false"
  // (:700, :812), and neither menu label occurs anywhere in ui/, test/ or src/.
  let markup = html;
  if (poisonToggle) {
    markup = markup.replace(
      / aria-expanded="true"| title="Collapse menu"| aria-label="Collapse menu"/g, '');
  }
  const dom = new JSDOM(markup, { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/budget')) {
      // noBudget: a promise that never settles, so paintBudget runs with
      // budgetState.budget === null (app.js:448 early-returns before #side-spend).
      if (noBudget) return new Promise(() => {});
      return Promise.resolve({ ok: true, status: 200, json: async () => budgetFixture() });
    }
    // The ring's click routes to #stats, which paints the stats view. Without a
    // body the paint throws AFTER the test ends ("Cannot read properties of
    // undefined (reading 'spentUsd')") and node:test fails the whole FILE on the
    // stray async activity, while the test itself reports as passing.
    if (u.includes('/api/stats')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        range: 'month', bucket: 'day',
        windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
        totals: { spentUsd: 20, workedMs: 0, runs: 0, finished: 0, stopped: 0,
          failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
        prev: null, budget: budgetFixture(), series: [] }) });
    }
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      config: { steps: {}, customModels: [] }, models: [], efforts: [],
      pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  if (seed) for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  // jsdom's localStorage is a Proxy — a per-instance defineProperty is silently
  // ignored, so private mode has to be simulated on the prototype. Narrowed to
  // OUR key: app.js reads LAST_PROJECT_KEY (:5342), LAST_WORKSPACE_KEY (:5760)
  // and LAST_TARGET_KEY (:14028) outside any try/catch, and a blanket throw
  // would fail the boot for unrelated reasons. Patched AFTER the seeding above.
  // Each JSDOM owns its own Storage constructor, so this cannot leak.
  if (breakStorage) {
    const g = window.Storage.prototype.getItem;
    const s = window.Storage.prototype.setItem;
    window.Storage.prototype.getItem = function (k) {
      if (k === KEY) throw new Error('denied'); return g.call(this, k);
    };
    window.Storage.prototype.setItem = function (k, v) {
      if (k === KEY) throw new Error('denied'); return s.call(this, k, v);
    };
  }
  // The boot restore (app.js:411-417) is a four-statement ORDERING — suppress the
  // rail's transition, apply the class, force a layout flush by READING
  // offsetWidth, hand the transition back — and jsdom has no layout, so nothing
  // observes it: delete the whole block and every other test in this file stays
  // green while the real page slides the rail 298px -> 76px on every load. The
  // getter still FIRES though, so recording what the rail looks like at that
  // instant is the only handle this file has on the ordering. Same idiom as the
  // offsetParent spies in ui-composer-wires:18-19 and four sibling files; each
  // JSDOM owns its own HTMLElement, so this cannot leak between boots.
  const reflows = [];
  if (spyReflow) {
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if (this.classList.contains('sidebar')) {
          reflows.push({ transition: this.style.transition,
                         collapsed: this.classList.contains('collapsed') });
        }
        return 0;                            // what jsdom returns anyway
      },
    });
  }
  // startBudgetTick (app.js:495) reads this on line :497 — `typeof
  // window.__budgetTickMs === 'number' ? window.__budgetTickMs : 60000` — and
  // installs a setInterval that OUTLIVES the test (`.unref?.()` is a no-op in
  // jsdom, where setInterval returns a number). It runs once per module
  // evaluation, from the boot line at :14036, and this file boots the app 27
  // times. node --test runs FILES in parallel, so one file can outlive 60s under
  // load, and a leaked tick from an EXPANDED boot would call paintBudget()
  // against whatever globalThis.document is current and re-mount the labelled
  // indicator into a later COLLAPSED test's #side-spend. Park it a day out, and
  // do it BEFORE the import. Seam: test/ui-budget-indicator.test.mjs:89-91.
  window.__budgetTickMs = DAY;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  lastWs._l.open?.forEach((fn) => fn());
  const click = (sel) => window.document.querySelector(sel)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, recv, click, tick, reflows };
}

// ---- CSS contract: the shell ----

test('.sidebar animates its width; the collapsed rail is 76px', () => {
  const base = ruleBody('.sidebar');
  assert.ok(base, '.sidebar rule must exist');
  // ruleBody() is NOT @media-aware: with the base rule deleted it silently
  // returns the <1080px `.sidebar{display:none;}` body (style.css:922), so the
  // assert.ok above would pass on a file that lost the rule entirely.
  assert.doesNotMatch(base, /display:\s*none/,
    'ruleBody() matched the @media(max-width:1080px) body, not the base rule');
  assert.match(base, /width:\s*298px/, 'the expanded column is unchanged');
  assert.match(base, /overflow-y:\s*auto/, 'ui-pinned-sidebar:45-49 depends on this');
  // If this one fails on CSS that LOOKS right, you put a comment inside the rule
  // body and it contains a closing brace: ruleBody's capture is ([^}]*).
  assert.match(base, /transition:\s*flex-basis/, 'the width change must be animated');
  const rail = ruleBody('.sidebar.collapsed');
  assert.ok(rail, '.sidebar.collapsed rule must exist');
  assert.match(rail, /width:\s*76px/);
  assert.match(rail, /flex:\s*0 0 76px/);
});

test('the favicon replaces the wordmark on the rail', () => {
  assert.match(ruleBody('.brand .logo-mark'), /display:\s*none/, 'hidden while expanded');
  assert.match(ruleBody('.sidebar.collapsed .logo'), /display:\s*none/);
  assert.match(ruleBody('.sidebar.collapsed .logo-mark'), /display:\s*block/);
  // Attribute ORDER must not matter: `<img src=… class="logo-mark">` is the same
  // element. Match the tag, then assert inside it.
  const mark = html.match(/<img[^>]*class="logo-mark"[^>]*>/);
  assert.ok(mark, 'the rail wordmark <img class="logo-mark"> must exist');
  assert.match(mark[0], /src="\/assets\/worca-favicon\.png"/);
});

test('the expanded wordmark keeps its own sizing rule', () => {
  // `.brand` (:87) and `.brand .logo` (:88) are ADJACENT lines. Editing the
  // wrong one silently unsizes the expanded wordmark, and nothing else in the
  // suite covers `.brand .logo` — the string `.brand` appears nowhere in test/.
  const logo = ruleBody('.brand .logo');
  assert.ok(logo, '.brand .logo must survive the .brand edit');
  assert.match(logo, /height:\s*36px/);
});

test('one panel glyph whose box never moves — only the chevron turns round', () => {
  const brand = html.match(/<div class="brand">[\s\S]*?<\/button>\s*<\/div>/);
  assert.ok(brand, '.brand must close after the toggle button');
  assert.equal((brand[0].match(/<svg/g) || []).length, 1,
    'exactly one SVG — both states are the same glyph with a rewritten chevron');
  // Panel outline + a divider fixed at x=9, drawn in hairlines (the mock is a
  // thin-stroke icon, not the 2px chevron this replaced).
  assert.match(brand[0], /<rect x="3" y="3" width="18" height="18"/);
  assert.match(brand[0], /<path d="M9 3v18">/);
  assert.match(brand[0], /stroke-width="1\.2"/);
  // The chevron is the ONLY part app.js may rewrite, so it needs its own hook.
  assert.match(brand[0], /<path class="chev" d="M16 15l-3-3 3-3">/);
  // Mirroring the whole glyph would swing the divider to the right edge and
  // claim the sidebar had moved sides; the CSS must only resize it.
  assert.doesNotMatch(ruleBody('.sidebar.collapsed .side-toggle svg'), /transform:/);
});

test('the toggle stays OUT of <nav>, which keeps exactly 9 buttons', () => {
  // ui-nav-sections.test.mjs:39 asserts this count, :40 forbids <a>, and :26-35
  // pins the token stream. A toggle inside <nav class="nav"> reds all three.
  const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
  assert.equal((nav.match(/<button type="button"/g) || []).length, 9);
  assert.equal(nav.includes('side-toggle'), false);
  assert.match(html, /<aside class="sidebar" id="side-rail">/,
    'aria-controls targets the whole aside — brand, nav AND the spend foot reshape');
});

// ---- CSS contract: the icon-rail nav ----

test('collapsed nav buttons become 40px squares and drop their labels', () => {
  const btn = ruleBody('.sidebar.collapsed .nav button:not(.rail-tile)');
  assert.ok(btn, 'the generic collapsed button rule must exclude .rail-tile');
  assert.match(btn, /width:\s*40px/);
  assert.match(btn, /height:\s*40px/);
  assert.match(btn, /justify-content:\s*center/);
  assert.match(btn, /position:\s*relative/, 'the corner badges are absolutely positioned');
  assert.match(btn, /flex:\s*0 0 auto/,
    '.nav is a column flex container; without this the 40px squares squash when '
    + 'the rail is taller than the viewport');
  assert.match(btn, /border-radius:\s*12px/, 'the base .nav button is 13px; the rail is 12px');
});

test('label spans are visually hidden but KEEP their accessible name', () => {
  const rule = '.sidebar.collapsed .nav button:not(.rail-tile) > span:not(.nav-count):not(.nav-rollup)';
  const body = ruleBody(rule);
  assert.ok(body, 'the label rule must carry the :not(.rail-tile) guard — '
    + 'without it a run tile loses its status dot and its "?" badge');
  // display:none removes the node from the accessibility tree, and this span is
  // the ONLY source of an accessible name for every nav button (index.html
  // carries no aria-label on any of the 12 and the SVGs carry no <title> — the
  // file's only <title> is the document title at :6). Measured in Chrome:
  // eleven buttons announced with no name at all, and Running announced as "4"
  // (the count span survives, so name-from-contents wins and the title is
  // demoted to a description).
  assert.doesNotMatch(body, /display:\s*none/,
    'display:none strips the only accessible name these buttons have');
  assert.match(body, /position:\s*absolute/);
  assert.match(body, /clip(-path)?:/);
});

test('section headers collapse to hairlines but keep their text nodes', () => {
  const sect = ruleBody('.sidebar.collapsed .nav-sect');
  assert.ok(sect);
  assert.match(sect, /width:\s*26px/);
  assert.match(sect, /height:\s*1px/);
  assert.match(sect, /font-size:\s*0/);
  // The labels stay in the DOM because ui-nav-sections.test.mjs:26-35 asserts
  // their source order. They are NOT exposed as named a11y nodes in either
  // state — measured — so do not claim that as the reason.
  assert.match(html, /class="nav-sect">Activity</);
  assert.match(html, /class="nav-sect">Build</);
  assert.match(html, /class="nav-sect">Manage</);
});

test('counts become corner badges; inert grey ones and the paused pill drop out', () => {
  const badge = ruleBody('.sidebar.collapsed .nav-count');
  assert.ok(badge);
  assert.match(badge, /position:\s*absolute/);
  // Two SEPARATE rules, not one grouped selector. Grouped, the only thing a test
  // can reach is the selector TEXT — and a grouped-selector assertion was proven
  // vacuous: regrouping `.n-grey` with a no-op declaration and hiding the badge
  // elsewhere kept the test green while grey badges stopped hiding.
  const grey = ruleBody('.sidebar.collapsed .nav-count.n-grey');
  assert.ok(grey, 'zero/inert grey badges drop out on the rail');
  assert.match(grey, /display:\s*none/);
  const hidden = ruleBody('.sidebar.collapsed #nav-paused-badge');
  assert.ok(hidden, 'the paused pill would collide with the live count in the same corner');
  assert.match(hidden, /display:\s*none/);
});

test('the rail stops reserving a scrollbar gutter it cannot afford', () => {
  const rail = ruleBody('.sidebar.collapsed');
  // ::-webkit-scrollbar{width:10px} (style.css:898) forces CLASSIC, space-
  // consuming scrollbars. The rail's own scroll height was measured at ~967px
  // with four runs, so on a 900px window the gutter is claimed: 76 - 1 border
  // - 36 padding - 10 gutter = a 29px content box, and the 40px squares sit 5px
  // left of centre. This is NOT horizontal overflow, so a scrollWidth probe
  // cannot see it.
  assert.match(rail, /scrollbar-width:\s*none/);
  assert.ok(ruleBody('.sidebar.collapsed::-webkit-scrollbar'),
    'Chrome ignores scrollbar-width while ::-webkit-scrollbar is styled');
  // If this fails on CSS that LOOKS right, you wrote a comment inside the rule
  // body that mentions overflow — ruleBody returns comment text verbatim.
  assert.doesNotMatch(rail, /overflow/,
    'the base overflow-y:auto must survive — the rail still scrolls, it just '
    + 'stops reserving the gutter');
  const foot = ruleBody('.sidebar.collapsed .side-foot');
  assert.ok(foot, 'the collapsed foot needs its own centring rule');
  assert.match(foot, /align-items:\s*center/);
});

test('the width change is a transition, so reduced motion actually kills it', () => {
  // The blanket at style.css:914-916 is `*{transition:none !important;}` PLUS
  // `.pdot,.cur,.child-dot,.child-q{animation:none;}` — it neutralises every
  // TRANSITION but only four selectors' ANIMATIONS. So the pre-existing block is
  // sufficient only while the collapse stays a transition; a keyframed width
  // would sail straight past it for users who opted out. Both halves are
  // asserted, because pinning the blanket alone pins a block this plan never
  // touches and passes at red.
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\*\{transition:none !important;\}/
    .test(css), 'the blanket transition kill must survive');
  assert.doesNotMatch(ruleBody('.sidebar'), /animation:/,
    'animate the rail with transition, not animation — the blanket does not '
    + 'cover animations outside .pdot/.cur/.child-dot/.child-q');
  assert.doesNotMatch(ruleBody('.sidebar.collapsed'), /animation:/);
});

// ---- Behaviour: state, toggle, persistence ----

test('boots expanded when nothing is stored', async () => {
  const { window } = await boot({ poisonToggle: true });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  const btn = window.document.querySelector('#side-toggle');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Collapse menu');
  assert.equal(btn.title, 'Collapse menu');
});

test('clicking the toggle collapses, relabels and persists', async () => {
  const { window, click } = await boot();
  click('#side-toggle');
  const btn = window.document.querySelector('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'Expand menu');
  assert.equal(btn.title, 'Expand menu');
  assert.equal(window.localStorage.getItem(KEY), '1');
});

test('clicking again expands and persists the expanded state', async () => {
  const { window, click } = await boot({ poisonToggle: true });
  click('#side-toggle');
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  assert.equal(window.document.querySelector('#side-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(window.localStorage.getItem(KEY), '0');
});

test('the chevron points into the panel collapsed, out of it expanded', async () => {
  // Markup ships the expanded chevron, so a state that never re-set it would
  // still read correctly at boot — collapse first, then expand, to catch that.
  const { window, click } = await boot();
  const chev = () => window.document.querySelector('#side-toggle .chev').getAttribute('d');
  assert.equal(chev(), 'M16 15l-3-3 3-3');
  click('#side-toggle');
  assert.equal(chev(), 'M14 9l3 3-3 3', 'collapsed chevron must point right, out of the rail');
  click('#side-toggle');
  assert.equal(chev(), 'M16 15l-3-3 3-3');
});

test('a stored "1" restores the rail at boot', async () => {
  const { window } = await boot({ seed: { [KEY]: '1' } });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
  assert.equal(window.document.querySelector('#side-toggle').getAttribute('aria-expanded'), 'false');
});

test('the restored rail does not animate at boot', async () => {
  // app.js is type="module" (index.html:1379), i.e. deferred, so the class lands
  // AFTER the first style pass and `.sidebar`'s .2s width/flex-basis transition
  // (style.css:84-85) fires: measured in headless Chrome, the rail slid
  // 298px -> 76px on every single page load, 3/3. The fix is the ordering at
  // app.js:411-417, and `void rail.offsetWidth` reads exactly like dead code to
  // the next reader — deleting it, or hoisting applySidebarCollapsed() above the
  // `transition='none'` write, keeps the rest of this file green.
  const { window, reflows } = await boot({ seed: { [KEY]: '1' }, spyReflow: true });
  assert.deepEqual(reflows, [{ transition: 'none', collapsed: true }],
    'the boot restore must flush layout exactly once, with the collapsed class '
    + 'already ON and the transition suppressed');
  assert.equal(window.document.querySelector('.sidebar').style.transition, '',
    'and hand the transition back afterwards, so the CLICK still animates');
});

test('an expanded boot has nothing to suppress and flushes nothing', async () => {
  // `railAtBoot` is null unless the preference was restored: a blanket flush
  // would cost a synchronous layout on every load of the common case.
  const { window, reflows } = await boot({ spyReflow: true });
  assert.deepEqual(reflows, []);
  assert.equal(window.document.querySelector('.sidebar').style.transition, '');
});

test('a garbage stored value falls back to expanded', async () => {
  const { window } = await boot({ seed: { [KEY]: 'yes' } });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
});

test('storage that throws (private mode) boots expanded and still toggles', async () => {
  const { window, click } = await boot({ breakStorage: true });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true,
    'a write that throws must not stop the in-memory state from flipping');
});

// ---- Behaviour: tooltips, counts, routing ----

test('every collapsed nav button gains a tooltip, and loses it on expand', async () => {
  const { window, click } = await boot();
  const doc = window.document;
  const rows = () => [...doc.querySelectorAll('.nav button[data-nav]')]
    .map((b) => [b.dataset.nav, b.title]);
  assert.deepEqual(rows().filter(([n, t]) => n !== 'running' && t), [],
    'expanded rows must not grow redundant tooltips — the label is right there');
  click('#side-toggle');
  for (const [nav, title] of rows()) assert.ok(title, `collapsed ${nav} must carry a tooltip`);
  assert.equal(doc.querySelector('.nav button[data-nav="composer"]').title, 'Workflow Composer',
    'the tooltip is the label span verbatim — index.html:55');
  assert.equal(doc.querySelector('.nav button[data-nav="new"]').title, 'New pipeline');
  assert.equal(doc.querySelector('.nav button[data-nav="stats"]').title, 'Statistics',
    'the SIDEBAR label is Statistics; Stats is the topnav variant (index.html:106)');
  assert.match(doc.querySelector('.nav button[data-nav="running"]').title, /^Running/,
    'Running keeps the count tooltip updateNavCounts owns (set at boot by '
    + 'refreshAllCounts, app.js:14034)');
  click('#side-toggle');
  assert.equal(doc.querySelector('.nav button[data-nav="composer"]').hasAttribute('title'), false);
});

test('the live count still updates on the rail (n-grey hides only the inert ones)', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    { runId: 'a', title: 'a', projectDir: PROJECT, status: 'running', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null }] });
  const c = window.document.querySelector('#nav-running-count');
  assert.equal(c.textContent, '1');
  // updateNavCounts (app.js:13788-13789) toggles n-run on live>0 and n-grey on
  // live===0. Only .n-grey is hidden on the rail.
  assert.ok(c.classList.contains('n-run'), 'the live badge survives; only .n-grey drops out');
  assert.equal(c.classList.contains('n-grey'), false);
});

test('the Running tooltip carries the live and paused counts', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [
    { runId: 'a', title: 'a', projectDir: PROJECT, status: 'running', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null },
    { runId: 'b', title: 'b', projectDir: PROJECT, status: 'paused', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null },
  ] });
  const btn = window.document.querySelector('.nav button[data-nav="running"]');
  assert.equal(btn.title, 'Running — 1 live, 1 paused',
    'the paused badge is hidden on the rail, so its count has to survive here');
  assert.equal(btn.getAttribute('aria-label'), 'Running — 1 live, 1 paused',
    'a title is a DESCRIPTION; name-from-contents would otherwise announce "1"');
});

test('with nothing paused the tooltip names only the live count', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [
    { runId: 'a', title: 'a', projectDir: PROJECT, status: 'running', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null },
  ] });
  assert.equal(window.document.querySelector('.nav button[data-nav="running"]').title,
    'Running — 1 live');
});

test('with nothing running at all the tooltip degrades to the bare label', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [] });
  // "Running — 0 live" on a resting sidebar is noise, and zero is the state most
  // users are in most of the time.
  assert.equal(window.document.querySelector('.nav button[data-nav="running"]').title,
    'Running');
});

test('paused-only names the paused count without a phantom live one', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [
    { runId: 'p', title: 'p', projectDir: PROJECT, status: 'paused', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null }] });
  // liveRuns() (app.js:12329-12336) excludes status 'paused', so live really is 0.
  assert.equal(window.document.querySelector('.nav button[data-nav="running"]').title,
    'Running — 0 live, 1 paused');
});

test('a collapsed nav button still routes', async () => {
  const { window, click, tick } = await boot({ seed: { [KEY]: '1' } });
  click('.nav button[data-nav="history"]');
  await tick();
  assert.equal(window.location.hash, '#history');
  assert.ok(window.document.querySelector('.nav button[data-nav="history"]')
    .classList.contains('active'));
});

test('the toggle still works after a view switch and a repaint', async () => {
  const { window, click, tick } = await boot();
  click('.nav button[data-nav="history"]');
  await tick();
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true,
    'the boot-time listener must survive a view switch');
});

test('toggling before the first hello or budget response does not throw', async () => {
  const { window, click } = await boot({ noBudget: true });
  // jsdom does NOT propagate a listener exception out of dispatchEvent, and
  // applySidebarCollapsed() runs before the three risky calls — so a bare click
  // plus a `.collapsed` assertion passes even with a throw appended to the end
  // of setSidebarCollapsed (verified). It DOES report the exception as a window
  // `error` event, which is the only seam that can see one.
  const errs = [];
  window.addEventListener('error', (e) => errs.push(e.error?.message || e.message));
  click('#side-toggle');   // updateNavCounts + renderPipelineTabs + paintBudget
  assert.deepEqual(errs, [],
    'all three repaints have to survive a null budget and an empty run list');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
  // paintBudget early-returns at app.js:369 before touching the mount, and
  // index.html:94 ships <div id="side-spend"></div> empty.
  assert.equal(window.document.querySelector('#side-spend').children.length, 0);
});

// ---- Task 2: per-run initials tiles ----

const liveRun = (runId, title, extra = {}) => ({
  runId, title, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

test('rail tiles are 36px and out-specify the generic collapsed button rule', () => {
  const tile = ruleBody('.nav .rail-tile');
  assert.ok(tile, 'scoped `.nav .rail-tile` so it outranks `.nav button` (same idiom as .nav .nav-child, :149-155)');
  assert.match(tile, /width:\s*36px/);
  assert.match(tile, /height:\s*36px/);
  // `.nav button` sets padding:11px 13px (:93) and gap:13px (:92). The collapsed
  // `padding:0` lives on `…button:not(.rail-tile)`, which excludes tiles BY
  // DESIGN — so the tile must zero them itself. Without this a 36px border-box
  // tile has an 8px content box holding 13.9px of text.
  assert.match(tile, /padding:\s*0/,
    'without this the tile inherits padding:11px 13px and its content box is 8px');
  assert.match(tile, /flex:\s*0 0 auto/, 'fixed-size box in a column flex container');
  assert.match(tile, /font-weight:\s*400/, 'the base .nav button is 500; the mock is 400');
  const dot = ruleBody('.nav .rail-tile .child-dot');
  assert.match(dot, /position:\s*absolute/);
  assert.doesNotMatch(dot, /box-sizing/,
    'box-sizing:content-box would make the 9px dot a 13px box (15.3px mid-pulse) '
    + 'on a 36px tile; the global border-box (:52) gives the mock its 9px total');
  const q = ruleBody('.nav .rail-tile .child-q');
  assert.match(q, /position:\s*absolute/);
  assert.match(q, /margin:\s*0/,
    'the base .child-q carries margin-left:6px (:207-211), which would shove the badge off the corner');
});

test('a hovered tile keeps its own fill — .nav button:hover out-specifies the base tile rule', () => {
  // `.nav .rail-tile` is (0,2,0); `.nav button:hover` (style.css:100,
  // background:var(--field);color:var(--ink)) is (0,2,1) and WINS on
  // specificity, so the tile's resting fill dies on every hover unless the
  // (0,3,0) :hover rule restates it. The mock's hover changes border-color only.
  const hov = ruleBody('.nav .rail-tile:hover');
  assert.ok(hov, '.nav .rail-tile:hover must exist');
  assert.match(hov, /border-color:\s*var\(--ink\)/);
  assert.match(hov, /background:\s*var\(--panel\)/,
    'without this, hovering a rail tile turns it var(--field) grey');
  assert.match(hov, /color:\s*var\(--ink-2\)/,
    'without this, hovering darkens the initials to var(--ink)');
  // All three of :hover, .lingering and .active are (0,3,0), so ORDER decides.
  // .lingering after :hover keeps a hovered lingering tile grey; .active last so
  // a selected tile never renders --ink-3 text on an --ink fill. The expanded
  // row gets the same precedence on specificity (:177 beats :178).
  const iH = css.indexOf('.nav .rail-tile:hover');
  const iL = css.indexOf('.nav .rail-tile.lingering');
  const iA = css.indexOf('.nav .rail-tile.active');
  assert.ok(iH < iL && iL < iA,
    'declare :hover, then .lingering, then .active — all three tie at (0,3,0)');
  // Ordering without declarations is ordering of nothing: both bodies below can
  // be emptied with the indexOf check still green. .active is the selected-run
  // highlight and .lingering the finished-unseen grey-out, i.e. the two states
  // the tile actually has.
  const ling = ruleBody('.nav .rail-tile.lingering');
  assert.ok(ling, '.nav .rail-tile.lingering must exist');
  assert.match(ling, /(?:^|[;{\s])color:\s*var\(--ink-3\)/,
    'a lingering tile greys its initials, like .nav-child.lingering (:178)');
  const act = ruleBody('.nav .rail-tile.active');
  assert.ok(act, '.nav .rail-tile.active must exist');
  assert.match(act, /background:\s*var\(--ink\)/,
    'the selected tile is a filled square, not just a bordered one');
  assert.match(act, /border-color:\s*var\(--ink\)/,
    'without this the --line-2 resting border rings the dark fill');
  assert.match(act, /(?:^|[;{\s])color:\s*#fff/,
    'and its initials have to invert, or they are --ink-2 on --ink');
});

test('collapsed, child rows render as initials tiles instead', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'Fix auth bug'), liveRun('r2', 'seo')] });
  const doc = window.document;
  const tiles = doc.querySelectorAll('#nav-running-children .rail-tile');
  assert.equal(tiles.length, 2);
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 0);
  // Address by run id, NEVER by index: cmpTabRuns (app.js:12464-12474) sorts by
  // tabGroupRank first, then newest-orderKey first, so this payload renders
  // [r2, r1]. Every existing ui-pipeline-tabs test uses the same idiom.
  const t1 = doc.querySelector('.rail-tile[data-child-run-id="r1"]');
  const t2 = doc.querySelector('.rail-tile[data-child-run-id="r2"]');
  assert.equal(t1.textContent.trim(), 'FA', 'first letters of the first two words');
  assert.equal(t2.textContent.trim(), 'S', 'a one-word title yields one letter');
  assert.match(t1.title, /^Fix auth bug · Running$/);
});

test('each tile carries the same status dot family the expanded row uses', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    liveRun('r1', 'One'),
    liveRun('r2', 'Two', { status: 'paused' }),
  ] });
  const doc = window.document;
  assert.ok(doc.querySelector('.rail-tile[data-child-run-id="r1"] .child-dot.peach'),
    'a running run with no phaseKey is peach, exactly as runDotClass says (:12489)');
  assert.ok(doc.querySelector('.rail-tile[data-child-run-id="r2"] .child-dot.paused'),
    'pipelineTabRuns (:12364) keeps paused runs in the list');
  assert.match(doc.querySelector('.rail-tile[data-child-run-id="r2"]').title, /· Paused$/);
});

test('a run awaiting input gets a "?" badge and still raises the roll-up dot', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'Needs me', { pendingQuestion: { id: 'q1', text: 'go?' } })] });
  const doc = window.document;
  const q = doc.querySelector('.rail-tile[data-child-run-id="r1"] .child-q');
  assert.ok(q, 'the tile carries its own "?" marker');
  assert.equal(q.textContent, '?');
  assert.equal(doc.querySelector('#nav-running-rollup').hidden, false);
  assert.match(doc.querySelector('.rail-tile[data-child-run-id="r1"]').title,
    /· Waiting for your input$/);
});

test('clicking a tile opens that run and marks it active', async () => {
  const { window, recv, tick } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'One'), liveRun('r2', 'Two')] });
  window.document.querySelector('.rail-tile[data-child-run-id="r2"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  await tick();
  assert.equal(window.location.hash, '#running/r2');
  assert.equal(window.document.querySelector('.rail-tile.active')?.dataset.childRunId, 'r2');
});

test('toggling with runs on screen repaints rows into tiles (signature regression)', async () => {
  const { window, recv, click } = await boot();
  recv({ type: 'hello', runs: [liveRun('r1', 'One'), liveRun('r2', 'Two')] });
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 2);
  click('#side-toggle');
  assert.equal(doc.querySelectorAll('#nav-running-children .rail-tile').length, 2,
    'sidebarCollapsed must be part of the tabsSig (:13692), or the rebuild gate '
    + 'at :13711 suppresses this');
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 0);
  click('#side-toggle');
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 2);
});

test('a run paused while still STARTING updates its tile word, not just its dot', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  const doc = window.document;
  const word = () => doc.querySelector('.rail-tile[data-child-run-id="r1"]').title;
  recv({ type: 'hello', runs: [liveRun('r1', 'Boot me', { status: 'starting' })] });
  assert.match(word(), /· Starting$/);
  assert.equal(doc.querySelector('.rail-tile[data-child-run-id="r1"] .child-dot.grey-pulse')
    != null, true, 'starting is grey-pulse (app.js:12476)');
  // The trap this test exists for: runDotClass returns 'grey-pulse' for BOTH
  // starting and pausing (:12476), and the sig's end-marker char is '' for BOTH
  // ('pausing' is not 'paused', :13698-13701). Every other field in the tuple is
  // unchanged too — so without tabStatusWord(r) in it the signature is
  // BYTE-IDENTICAL, :13711 early-returns, and the tile keeps a stale
  // "· Starting" tooltip AND aria-label on a run that is pausing. The expanded
  // row renders no status word at all, which is why nothing caught this before.
  // Reachable: onHello upserts `status` on every hello (upsertRun, :1217) and
  // isLive (:12345-12348) counts `pausing`, so the run stays in the tab list.
  recv({ type: 'hello', runs: [liveRun('r1', 'Boot me', { status: 'pausing' })] });
  assert.match(word(), /· Pausing$/);
  assert.equal(doc.querySelector('.rail-tile[data-child-run-id="r1"]')
    .getAttribute('aria-label'), 'Boot me · Pausing');
});

test('a blank title still yields a readable tile, never an empty square', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', '   ')] });
  const tile = window.document.querySelector('.rail-tile[data-child-run-id="r1"]');
  // Proven vacuous in v1: deleting the `|| '?'` fallback kept every test green.
  assert.equal(tile.textContent.trim(), '?',
    'a titleless run must not render a blank tile');
  // '   ' is a TRUTHY string, so a bare `r.title || 'Untitled run'` renders
  // "    · Running" — three spaces and a separator. The fallback has to trim
  // first. This assertion is the only thing that catches it.
  assert.match(tile.title, /^Untitled run · /,
    'and its tooltip must not open with a bare separator');
  assert.equal(tile.getAttribute('aria-label'), 'Untitled run · Running');
});

test('initials survive emoji, CJK and sharp-s', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    liveRun('e', '🎉 launch'), liveRun('c', '修复 登录'), liveRun('s', 'ß sharp'),
  ] });
  const t = (id) => window.document
    .querySelector(`.rail-tile[data-child-run-id="${id}"]`).textContent.trim();
  // The mock's `w[0]` is a UTF-16 CODE UNIT: '🎉 launch' would yield a lone high
  // surrogate ("\ud83cL") and render as "?L". Run titles are free text.
  assert.equal([...t('e')].length, 2, 'one emoji + one letter, not a lone surrogate');
  assert.equal(t('e'), '🎉L');
  assert.equal(t('c'), '修登');
  // 'ß'.toUpperCase() is 'SS' — two glyphs from one letter would make three on
  // a two-glyph tile.
  assert.equal(t('s'), 'SS', 'S from ß, S from sharp — never SSS');
});

test('a run that ends badly says so, rather than borrowing "Completed"', async () => {
  // The other arm of tabStatusWord's terminal branch (:13625). Only the `done`
  // arm was reached, so returning 'Completed' unconditionally stayed green.
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'Fix auth bug')] });
  recv({ type: 'done', runId: 'r1', status: 'error' });
  const tile = window.document.querySelector('.rail-tile[data-child-run-id="r1"]');
  assert.equal(tile.getAttribute('aria-label'), 'Fix auth bug · Did not complete');
});

test('a tile is labelled for screen readers, and greys out once it lingers', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  const doc = window.document;
  recv({ type: 'hello', runs: [liveRun('r1', 'Fix auth bug')] });
  let tile = doc.querySelector('.rail-tile[data-child-run-id="r1"]');
  assert.equal(tile.getAttribute('aria-label'), 'Fix auth bug · Running',
    'the initials alone are meaningless to a screen reader');
  assert.equal(tile.classList.contains('lingering'), false);
  recv({ type: 'done', runId: 'r1', status: 'done' });   // finishes live -> lingers
  tile = doc.querySelector('.rail-tile[data-child-run-id="r1"]');
  assert.ok(tile.classList.contains('lingering'),
    'a finished-unseen run is greyed on the rail exactly as its expanded row is');
  assert.equal(tile.getAttribute('aria-label'), 'Fix auth bug · Completed');
});

test('an empty run list renders an empty rail without throwing', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [] });
  // renderPipelineTabs early-returns at :13677-13680 before the sig gate.
  const host = window.document.querySelector('#nav-running-children');
  assert.equal(host.querySelectorAll('.rail-tile').length, 0);
  assert.equal(window.document.querySelector('#nav-running-rollup').hidden, true);
});

// ---- Task 3: circular budget indicator ----

test('the ring is 38px, composes its arc from --ring-pct, and recolours by band', () => {
  const ring = ruleBody('.spend-ring');
  assert.ok(ring, '.spend-ring rule must exist');
  assert.match(ring, /width:\s*38px/);
  assert.match(ring, /border-radius:\s*50%/);
  assert.match(ring, /conic-gradient/, 'the arc is drawn in CSS, not as an inline background');
  assert.match(ring, /var\(--ring-pct\)/, 'one definition of the gradient, swappable by class');
  assert.match(ruleBody('.spend-ring.warn'), /--ring-fill:\s*var\(--amber-ink\)/);
  assert.match(ruleBody('.spend-ring.over'), /--ring-fill:\s*var\(--red-ink\)/);
  const flat = ruleBody('.spend-ring.no-limit');
  assert.ok(flat, 'the no-limit ring gets a flat neutral track');
  assert.match(flat, /--ring-fill:\s*var\(--ink-3\)/,
    'var(--line) on var(--panel) is ~1.1:1 — a ring nobody can see is not "neutral"');
});

test('hovering the ring keeps its arc', () => {
  // `.spend-ind:hover` (style.css:1609) is (0,2,0) and a bare `.spend-ring` is
  // (0,1,0), so its flat `background:var(--line)` WINS on specificity — source
  // order never gets consulted. Measured in Chrome without this rule:
  // background-image goes to `none` and the disc turns a flat neutral fill.
  const hov = ruleBody('.spend-ring:hover');
  assert.ok(hov, '.spend-ring:hover must exist or the arc dies on every hover');
  assert.match(hov, /conic-gradient/);
  assert.match(hov, /var\(--ring-pct\)/);
  assert.ok(css.indexOf('.spend-ind:hover') < css.indexOf('.spend-ring:hover'),
    'equal specificity — it can only win on source order');
});

test('the foot swaps the spend block for the ring and back', async () => {
  const { window, click } = await boot({ seed: { [KEY]: '1' } });
  const doc = window.document;
  assert.ok(doc.querySelector('#side-spend .spend-ring'), 'collapsed boot mounts the ring');
  assert.equal(doc.querySelector('#side-spend .spend-ind-row'), null,
    'the labelled block must not also be mounted');
  assert.equal(doc.querySelector('#side-spend .spend-ring-val').textContent, '40%');

  click('#side-toggle');
  assert.equal(doc.querySelector('#side-spend .spend-ring'), null);
  assert.ok(doc.querySelector('#side-spend .spend-ind-row'), 'expanding restores the block');
});

test('clicking the ring really routes to #stats, not just carrying the class', async () => {
  const { window } = await boot({ seed: { [KEY]: '1' } });
  window.location.hash = 'running';
  // Click the INNER span: app.js:517 resolves it via closest('.spend-ind'),
  // so a ring that merely looks right but drops the class fails here. Asserting
  // the classList alone asserts the PREMISE of the routing, never the routing.
  window.document.querySelector('#side-spend .spend-ring-val')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(window.location.hash, '#stats');
});

test('#topnav-spend is mode-independent', async () => {
  const { window, click } = await boot({ seed: { [KEY]: '1' } });
  const top = window.document.querySelector('#topnav-spend');
  assert.equal(top.hidden, false);
  const before = top.textContent;
  click('#side-toggle');
  assert.equal(top.textContent, before, 'the topnav twin must not follow the rail');
  assert.equal(top.hidden, false);
});

// ---- The rest of the block: no rule here is reachable by NAME alone ----

test('every remaining new rule carries the declarations it exists for', () => {
  // Each rule below was emptied one at a time and the rest of this file stayed
  // green, which is the same vacuity the grouped-selector note at style.css:2604
  // warns about: a test that only proves a selector EXISTS proves nothing.
  const mark = (sel, ...pats) => {
    const body = ruleBody(sel);
    assert.ok(body, `${sel} must exist`);
    for (const p of pats) assert.match(body, p, `${sel} lost ${p}`);
  };
  // The favicon the rail shows instead of the wordmark; display is pinned above.
  mark('.brand .logo-mark', /width:\s*32px/, /height:\s*32px/, /border-radius:\s*50%/);
  // The toggle is a bare glyph next to the wordmark, and a 40px square on the
  // rail — the same box the twelve nav buttons get.
  mark('.side-toggle', /width:\s*30px/, /height:\s*30px/, /border:\s*0/,
    /background:\s*transparent/);
  mark('.sidebar.collapsed .side-toggle', /width:\s*40px/, /height:\s*40px/,
    /border-radius:\s*12px/);
  // Both glyph sizes; the rail one stays the larger of the two.
  mark('.side-toggle svg', /width:\s*23px/, /height:\s*23px/);
  mark('.sidebar.collapsed .side-toggle svg', /width:\s*26px/, /height:\s*26px/);
  // Both flex columns centre their fixed-width children; without this the 40px
  // squares and 36px tiles sit left-aligned in a 39px content box.
  mark('.sidebar.collapsed .nav', /align-items:\s*center/);
  mark('.sidebar.collapsed .nav-children', /align-items:\s*center/);
  // New pipeline is the rail's one filled control (mock); outlined-at-rest only
  // reads as a button next to a label.
  mark('.sidebar.collapsed .nav button.nav-cta', /background:\s*var\(--ink\)/,
    /(?:^|[;{\s])color:\s*#fff/);
  // Pinned to the Running square's corner, and ringed in --panel like both
  // sibling markers — .nav button.active .nav-rollup fills it #fff (:140), which
  // is invisible on the white sidebar for the half of the dot that overhangs.
  mark('.sidebar.collapsed .nav-rollup', /position:\s*absolute/,
    /border:\s*2px solid var\(--panel\)/);
  mark('.nav .rail-tile:focus-visible', /outline:\s*2px solid var\(--ink\)/);
  // The ring's inner disc: without the --panel fill the conic-gradient covers
  // the whole 38px circle and there is no annulus.
  mark('.spend-ring-val', /width:\s*29px/, /border-radius:\s*50%/,
    /background:\s*var\(--panel\)/);
});
