// test/stillhet-settings-live-no-demo.test.mjs — Stillhet Settings in the live kind draws none of the prototype's sample
// rows (ui/public/stillhet/settings/settings-model.js, settings.js, pulse/pulse.js): Plugins lists exactly GET /api/plugins,
// Setup assistant is hidden, Tasks › Spending has no sample spend or caps, Team policy is not in Stillhet yet, and search
// finds none of them. The demo kind keeps them all. Each window is closed when its test ends (closeHosts).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, settle, clone, SOURCES, closeHosts } from './helpers/stillhet-live-counts-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const demoClosers = [];
afterEach(() => { while (demoClosers.length) demoClosers.pop()(); });

const ROW = { name: 'github-source', version: '1.2.0', marketplace: 'worca-official', enabled: true, hasSettings: false };
const MARKETS = [{ id: 'worca-official', name: 'Worca official', builtin: false, lastSync: { sha: 'abc' }, url: 'https://github.com/worca/plugins',
  plugins: [{ name: 'github-source', version: '1.2.0', description: 'GitHub issues as tasks', inventory: { taskSources: [{ id: 'github' }] } },
    { name: 'slack-chat', version: '0.3.0', description: 'Slack as a chat channel', inventory: { chatChannels: [{ id: 'slack' }] } }] }];
const DEMO_PLUGINS = ['Jira', 'Azure Boards', 'GitHub Issues', 'Telegram', 'Discord', 'Slack', 'Teams', 'Notion', 'Sentry', 'Cloudflare', 'Review pack', 'Promo video'];

// /api/plugins and /api/marketplaces are not in SOURCES: they are answered here.
function marketRead({ plugins = [ROW] } = {}) {
  return (u) => {
    if (u === '/api/plugins') return [200, { plugins, orphans: [] }];
    if (u === '/api/marketplaces') return [200, { marketplaces: MARKETS }];
    if (/^\/api\/plugins\/[^/]+\/config$/.test(u)) return [200, { fields: [] }];
    return null;
  };
}
async function live(opts = {}) {
  const h = await liveHost({ hash: '#chat', read: marketRead(opts), ...opts.host });
  await h.hello();
  return h;
}
// Settings draws into its route's pane (shell.js); a place outside Settings is checked on the whole page
const page = (d) => d.querySelector('#route-settings');
async function go(w, hash, ms = 120) { w.location.hash = hash; await settle(ms); return (hash.startsWith('#settings') ? page(w.document) : w.document.body).textContent; }
const NOT_LIVE = 'Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it';
const secLine = (d, title) => [...page(d).querySelectorAll('.set-sec')].find((s) => s.querySelector('.set-sec-h')?.textContent.trim() === title)?.querySelector('.el-t')?.textContent;
const rowTitles = (d) => [...page(d).querySelectorAll('.lr-t')].map((x) => x.textContent.trim());

test('F-5-01/F-7b-11: live Plugins lists exactly the /api/plugins rows', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/plugins', 200);
  assert.match(text, /github-source/);
  assert.doesNotMatch(text, /slack-chat/, 'offered but not installed');
  for (const t of DEMO_PLUGINS) assert.ok(!rowTitles(d).includes(t), `no demo plugin ${t}`);
  for (const t of ['Jira', 'Azure Boards', 'Notion', 'Cloudflare', 'Review pack', 'Promo video']) assert.doesNotMatch(text, new RegExp(t));
  assert.match(text, /Marketplace/, 'the Marketplace › Open row stays');
});

test('F-5-01: live Plugins with no plugins says Nothing installed', async () => {
  const { w } = await live({ plugins: [] });
  const text = await go(w, '#settings/plugins', 200);
  assert.match(text, /Nothing installed/);
  assert.doesNotMatch(text, /github-source/);
});

test('F-5-01: live Plugins has no demo Sources', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/plugins', 200);
  assert.ok(![...page(d).querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sources'), 'no Sources button');
  assert.doesNotMatch(text, /team-internal/);
  assert.equal(page(d).querySelector('[data-svdo*="Sources"]'), null);
});

test('F-5-01: a live plugin row opens its Marketplace page and sends nothing', async () => {
  const { w, d, posts } = await live();
  await go(w, '#settings/plugins', 200);
  const open = [...page(d).querySelectorAll('.lr-main[data-svdo$="/open"]')].find((x) => /github-source/.test(x.textContent));
  assert.ok(open, 'the row opens');
  assert.equal(open.parentElement.querySelector('[aria-haspopup="menu"], [data-svsw]'), null, 'no ⋯ and no switch');
  const n = posts.length;
  open.click();
  await settle(60);
  assert.equal(w.location.hash, '#marketplace/github-source');
  assert.equal(posts.length, n);
});

test('F-5-01: the live list repaints Settings once when /api/plugins answers', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  // the held read answers only once released: the window's fetch awaits the gate before the host reads
  const h = await liveHost({ hash: '#settings/plugins', read: marketRead(),
    before: (win) => { const f = win.fetch; win.fetch = async (u, o) => { if (String(u) === '/api/plugins') await gate; return f(u, o); }; } });
  await h.hello();
  await settle(150);
  assert.doesNotMatch(page(h.d).textContent, /github-source/, 'not there while the read is held');
  release();
  await settle(200);
  assert.match(page(h.d).textContent, /github-source/, 'drawn with no navigation');
  assert.equal(h.gets.filter((u) => u === '/api/plugins').length, 1);
});

test('F-5-01 (:70): live Chat channels show no demo channel', async () => {
  const { w, d } = await live();
  await go(w, '#settings/ask', 200);
  const titles = rowTitles(d);
  for (const t of ['Telegram', 'Discord', 'Slack', 'Teams']) assert.ok(!titles.includes(t), `no ${t} channel row`);
});

test('F-5-02/F-7b-12: live General has no Setup assistant', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/general');
  assert.equal(secLine(d, 'Setup'), NOT_LIVE);
  assert.doesNotMatch(text, /Setup assistant/);
  assert.doesNotMatch(text, /Run setup/);
});

test('F-7b-04: live Tasks › Spending shows no sample spend or caps', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/runs');
  assert.equal(secLine(d, 'Spending'), NOT_LIVE);
  for (const re of [/Spent/, /\$1,000/, /Budget/, /Team caps/]) assert.doesNotMatch(text, re);
});

test('F-7b-04 (pulse.js:21): no sample budget anywhere on live', async () => {
  const budget = { ...clone(SOURCES.budget), windowSpendUsd: 6318.6, totalLimitUsd: null };
  const { w } = await live({ host: { sources: { ...clone(SOURCES), budget } } });
  for (const hash of ['#settings/runs', '#settings/general', '#chat']) {
    const text = await go(w, hash);
    assert.doesNotMatch(text, /\$0 of/, hash);
    assert.doesNotMatch(text, /\$1,000/, hash);
  }
});

test('F-7b-05: live Team policy is not in Stillhet yet', async () => {
  const { w, d, posts } = await live();
  const text = await go(w, '#settings/team');
  assert.match(text, /Team policy is not in Stillhet yet/);
  assert.match(text, /With Stillhet off, it is Settings › Team policy\./);
  for (const re of [/Gateway team policy/, /acme\/worca-policy/, /\$2,000/, /Publish/]) assert.doesNotMatch(text, re);
  const back = [...page(d).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back to Chat');
  assert.ok(back, 'Back to Chat');
  const n = posts.length;
  back.click();
  await settle(80);
  assert.equal(w.location.hash, '#chat');
  assert.equal(posts.length, n);
});

test('F-5-01/F-5-02/F-7b-05: live search offers no demo Settings row', async () => {
  const { w, d } = await live();
  await go(w, '#settings/plugins', 200);
  const find = async (q) => {
    const i = d.querySelector('[data-search]');
    i.value = q; i.dispatchEvent(new w.Event('input', { bubbles: true }));
    await settle(20);
    return d.querySelector('[data-search-res]').textContent.replace(/Ask Chat:[\s\S]*$/, '');   // the tail always echoes the words
  };
  assert.doesNotMatch(await find('Setup assistant'), /Setup assistant/);
  assert.doesNotMatch(await find('Jira'), /Jira/);
  assert.doesNotMatch(await find('Gateway'), /Gateway team policy/);
  assert.match(await find('github-source'), /github-source/);
});

test('demo keeps the sample Setup, Plugins, Spending and Team policy', async () => {
  const w = stillhetHost({ hash: '#chat', after: (fn) => demoClosers.push(fn) });
  await settle(200);
  assert.equal(w.RailWorld.live, false);
  w.RailUI.prefs.setMode('expert');   // Plugins and Team policy need Advanced
  assert.match(await go(w, '#settings/general'), /Setup assistant/);
  assert.match(await go(w, '#settings/plugins'), /Jira/);
  const tasks = await go(w, '#settings/runs');
  assert.match(tasks, /Spent this month/);
  assert.match(tasks, /Budget/);
  assert.match(await go(w, '#settings/team'), /Gateway team policy/);
});

// F-G-G5-04: today's app reads GET /api/app/version (About and the sidebar marker); Stillhet shows it where the rule puts it,
// Settings › General › About (docs/rail/settings.md): `Version 1.19 · New version: 1.20`, and Check now re-checks npm.
test('F-G-G5-04: General › About reads GET /api/app/version and says an update is available', async () => {
  const VS = { current: '1.19.0', latest: '1.20.0', status: 'outdated', enabled: true, links: {} };
  const reads = marketRead();
  const h = await live({ host: { read: (u) => (u === '/api/app/version' ? [200, VS] : reads(u)), post: (u) => (u === '/api/app/version/check' ? [200, { ...VS, latest: '1.21.0' }] : [200, {}]) } });
  const t = await go(h.w, '#settings/general', 200);
  assert.ok(h.gets.includes('/api/app/version'), 'Stillhet reads the version');
  assert.match(t, /1\.19 · New version: 1\.20/);
  assert.doesNotMatch(secLine(h.d, 'About') || '', /Not in Stillhet yet/);
  const check = [...page(h.d).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check now');
  assert.ok(check, 'Check now is offered');
  check.click(); await settle(150);
  assert.ok(h.posts.some((p) => p.url === '/api/app/version/check'), 'Check now posts the check');
  assert.match(page(h.d).textContent, /New version: 1\.21/);
});
