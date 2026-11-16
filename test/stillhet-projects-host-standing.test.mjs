// Stillhet B4.5 (F-6-15): how a project stands, on its page, read-only. Readiness as one summary line on Overview with its
// checks on the Readiness tab, Metrics and Policy as facts with links on the Settings tab (Expert), its last run and its done/stopped split from the store's tasks.
// Nothing here writes, and a refused read says so on its own row. The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, KEYS, READINESS, sent, settle, go, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { SOURCES, NOW, clone } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
// Stillhet's word pass (shell.js WORDS) says task for run: the page reads "Last task" and "3 tasks"
const page = (d) => d.getElementById('route-place');
const section = (d, title) => [...page(d).querySelectorAll('.set-sec')].find((s) => s.querySelector('.set-sec-h')?.textContent.trim() === title) || null;
const row = (d, name) => [...page(d).querySelectorAll('.set-name')].find((n) => n.textContent.trim() === name)?.closest('.set-row') || null;
const sentence = (d, name) => row(d, name)?.querySelector('.set-text')?.textContent.trim() ?? null;
const tabTo = async (d, id) => { d.querySelector(`#pjtab-${id}`).click(); await settle(40); };   // a project's parts are tabs
const FACT_URL = /\/readiness|\/team-metrics|\/api\/policy/;
// dev's history for seed-ok, newest first (dev's order, which the store keeps): done, stopped, failed, done, and a paused one
const at = (h) => new Date(NOW - h * 3600e3).toISOString();
const saved = (id, title, status, h, extra = {}) => ({ id, title, status, projectName: 'seed-ok', startedAt: at(h + 1), mtime: Date.parse(at(h)), ...extra });
const HISTORY = { history: { pipelines: [saved('s1', 'Newest change', 'done', 1), saved('s2', 'Stopped one', 'stopped', 2), saved('s3', 'Broke it', 'error', 3), saved('s4', 'Older change', 'done', 4), saved('s5', 'Held', 'paused', 5, { pauseReason: 'manual' }), saved('s6', 'Put away', 'done', 6, { archived: true })] }, hello: { ...clone(SOURCES.hello), runs: [] } };

test('F-6-15: readiness summary on Overview; its checks on the Readiness tab, no controls', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  const stands = section(h.d, 'How it stands');
  assert.ok(stands, 'the How it stands section');
  assert.equal(sentence(h.d, 'Readiness'), 'Partly ready · 2 must fix, 3 should fix');
  const see = row(h.d, 'Readiness').querySelector('[data-pj-tab="readiness"]');
  assert.equal(see.textContent.trim(), 'See the checks');
  assert.equal(row(h.d, 'Tools'), null, 'the checks are not on Overview');
  see.click(); await settle(40);
  assert.match(h.w.location.hash, /\/readiness$/, 'the tab is in the address');
  assert.equal(sentence(h.d, 'Tools'), 'Claude Code: Ready, OpenAI Codex: Partly ready', 'the run engine first');
  assert.equal(sentence(h.d, 'Not judged'), 'Gemini CLI');
  assert.equal(sentence(h.d, 'Advice'), 'Has an editorconfig');
  assert.equal(sentence(h.d, 'Has a README'), 'Must fix · Add a README.md', 'a failing check: its level and its fix');
  assert.match(sentence(h.d, 'Has tests'), /^Must fix/);
  for (const name of ['Has a lockfile', 'Ignores dist', 'Has a guide']) assert.match(sentence(h.d, name), /^Should fix/, name);
  assert.doesNotMatch(h.d.getElementById('pj-panel').textContent, /Recheck|\bIgnore\b|Not used here/, 'live: nothing here writes');
});

test('F-6-15: a report\'s strings are text', async () => {
  const bad = clone(READINESS); bad.readiness.checks[0].title = '<img src=x onerror="window.__x=1">'; bad.readiness.checks[0].fix = '"><b>fix</b>';
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, read: (u) => (u.endsWith(`${KEYS.ok}/readiness`) ? [200, bad] : null) });
  await tabTo(h.d, 'readiness');
  assert.equal(h.d.getElementById('pj-panel').querySelector('img, b'), null);
  assert.match(sentence(h.d, '<img src=x onerror="window.__x=1">'), /"><b>fix<\/b>/);
  assert.equal(h.w.__x, undefined);
});

test('F-6-15: metrics and policy are facts with links', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  await tabTo(h.d, 'settings');
  assert.ok(section(h.d, 'Team'), 'Expert shows the Team section, on the Settings tab');
  assert.equal(sentence(h.d, 'Metrics'), 'on · 3 tasks · this project · last push 2 h ago');
  assert.equal(sentence(h.d, 'Policy'), 'follows acme/gateway', 'its scope is named once');
  assert.equal(row(h.d, 'Metrics').querySelector('.set-end').textContent.trim(), 'In Insights');
  assert.equal(row(h.d, 'Metrics').querySelectorAll('.set-end button').length, 1, 'a link, no switch');
  row(h.d, 'Metrics').querySelector('[data-pj-go-place]').click(); await settle(80);
  assert.equal(h.w.location.hash, '#insights/team');
  await go(h.w, `#projects/${KEYS.ok}`, 150);
  row(h.d, 'Policy').querySelector('[data-pj-go-place]').click(); await settle(80);
  assert.equal(h.w.location.hash, '#settings/team');
});

// the mode is the library's one store (levels.mjs prefs), shared by every host in this process: a test that changes it puts it back
const atMode = (t, w, mode) => { const was = w.StillhetUI.prefs.mode(); t.after(() => w.StillhetUI.prefs.setMode(was)); w.StillhetUI.prefs.setMode(mode); };

test('F-6-15: metrics and policy are hidden below Expert; readiness stays', async (t) => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  atMode(t, h.w, 'advanced'); h.w.StillhetPlaces.projects.redraw(); await settle(30);
  assert.equal(row(h.d, 'Metrics'), null);
  assert.equal(row(h.d, 'Policy'), null);
  assert.equal(sentence(h.d, 'Readiness'), 'Partly ready · 2 must fix, 3 should fix');
});

test('F-6-15: last run is the newest store row; the split counts done, stopped, failed', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, sources: HISTORY });
  const last = row(h.d, 'Last task');
  assert.equal(last.querySelector('[data-c-open]')?.textContent.trim(), 'Newest change', 'its title, a link');
  assert.match(sentence(h.d, 'Last task'), /^Newest change · .+ · .+$/, 'then its time and its state');
  assert.equal(sentence(h.d, 'So far'), '2 done · 1 stopped · 1 failed', 'a paused task has not ended; an archived one is not counted');
});

test('F-6-15: no tasks yet; the split is left out', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.behind}`, sources: { hello: { ...clone(SOURCES.hello), runs: [] }, history: { pipelines: [] } } });
  assert.equal(sentence(h.d, 'Last task'), 'No tasks yet');
  assert.equal(row(h.d, 'So far'), null);
});

test('F-6-15: a refused read says so on its row only', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, read: (u) => (u.endsWith('/readiness') ? [500, { error: 'boom', code: 'X' }] : u === '/api/policy/scopes' ? [0] : null) });
  assert.equal(sentence(h.d, 'Readiness'), 'Could not read its readiness; open the page again to retry');
  await tabTo(h.d, 'settings');
  assert.equal(sentence(h.d, 'Policy'), 'Could not read its team policy; open the page again to retry');
  assert.equal(sentence(h.d, 'Metrics'), 'on · 3 tasks · this project · last push 2 h ago', 'the others still show');
  assert.doesNotMatch(page(h.d).textContent, /HTTP|500|boom/);
});

test('no control acts on readiness, metrics or policy; each page open reads them again', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  const controls = [...section(h.d, 'How it stands').querySelectorAll('button, input, a[href]')].filter((b) => !b.matches('[data-pj-tab], [data-c-open]'));
  assert.deepEqual(controls.map((b) => b.outerHTML), [], 'only the way to its checks and links to tasks');
  await tabTo(h.d, 'readiness');
  assert.deepEqual([...h.d.getElementById('pj-panel').querySelectorAll('button, input, a[href]')].map((b) => b.outerHTML), [], 'live: the Readiness tab has no control');
  await tabTo(h.d, 'overview');
  assert.deepEqual(sent(h.calls).filter(([, u]) => FACT_URL.test(u)), [], 'never a write');
  const readsOf = () => h.calls.filter((c) => c.url.endsWith(`${KEYS.ok}/readiness`)).length;
  const once = readsOf();
  assert.equal(once, 1);
  await go(h.w, `#projects/${KEYS.behind}`, 150);
  await go(h.w, `#projects/${KEYS.ok}`, 150);
  assert.equal(readsOf(), 2, 'read on each open');
});

test('D11: coming back to the same project from another place reads its facts again', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  const reads = () => [`${KEYS.ok}/readiness`, `${KEYS.ok}/team-metrics`].map((end) => h.calls.filter((c) => c.url.endsWith(end)).length);
  const policy = () => h.calls.filter((c) => c.url === '/api/policy/scopes').length;
  assert.deepEqual(reads(), [1, 1]);
  assert.equal(policy(), 1, 'F-W3a2-07: one open reads each fact once, policy included');
  await go(h.w, '#insights/team', 150);
  const policyAway = policy();
  await go(h.w, `#projects/${KEYS.ok}`, 150);
  assert.deepEqual(reads(), [2, 2], 'read again on the way back');
  assert.ok(policy() > policyAway, 'its policy is read again too');
  h.w.StillhetPlaces.projects.redraw(); await settle(60);
  assert.deepEqual(reads(), [2, 2], 'a redraw on the same address does not read');
});

test('F-6-15 demo: readiness and last run first', async (t) => {
  const w = stillhetHost({ hash: '#projects/billing-api', after: (fn) => t.after(fn) });
  await settle(150);
  atMode(t, w, 'expert'); w.StillhetPlaces.projects.redraw(); await settle(30);
  const d = w.document;
  const stands = section(d, 'How it stands');
  assert.ok(stands);
  const names = [...stands.querySelectorAll(':scope > .set-rows > .set-row .set-name')].map((n) => n.textContent.trim());
  assert.deepEqual(names.slice(0, 2), ['Readiness', 'Last task']);
  assert.equal(sentence(d, 'Readiness'), 'Partly ready · 2 must fix, 3 should fix');
  await tabTo(d, 'settings');
  assert.equal(sentence(d, 'Metrics'), 'on · 12 tasks · this project · last push 2 h ago');
  assert.equal(sentence(d, 'Policy'), 'follows acme/gateway');
  w.location.hash = '#projects/docs-site'; await settle(100);
  assert.equal(sentence(d, 'Readiness'), 'Not judged yet');
  await tabTo(d, 'settings');
  assert.equal(row(d, 'Metrics'), null, 'no metrics fact: no row');
});
