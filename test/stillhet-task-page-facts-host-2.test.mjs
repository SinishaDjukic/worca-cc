// test/stillhet-task-page-facts-host-2.test.mjs — second half of stillhet-task-page-facts-host (split to stay under CI's 300 s per file):
// the task head's base, no-remote and unknown-base cases (F-3-02, F-3-03, B1.7) and Activity's step count. Live app host (jsdom).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS } from './helpers/stillhet-live-fixture.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
function sources() { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; }
const STATE = { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: null, branch: null, totalCostUsd: null, totalActiveMs: null, prompt: 'Page the audit log by 50',
  labels: ['infra'], tags: [{ key: 'team', value: 'web' }] };
const read = (u) => (u === '/api/history/web-1/h2' ? [200, { state: STATE }] : null);
const card = (d) => d.querySelector('#card');
const sent = (calls) => posts(calls).filter(([m, u]) => m !== 'GET' && !/^\/api\/ask\//.test(u));
const pageView = (w, id) => { const run = w.RunCardModel.liveRun({ ...w.RailTaskLive.detail(id), id }); return JSON.parse(JSON.stringify(w.RunCardModel.view(run.id, { run }))); };   // out of the page's realm

const PATCH = 'diff --git a/src/pager.mjs b/src/pager.mjs\n--- a/src/pager.mjs\n+++ b/src/pager.mjs\n@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n';
async function finished({ source = 'docs/rail-agreed', remote = 'origin' } = {}) {
  const s = sources();
  const row = s.history.pipelines.find((p) => p.id === 'h2');
  Object.assign(row, { branch: 'feat/x', sourceBranch: source, survived: true, projectName: 'web' });
  s.sync.projects['web-1'].remote = remote;
  const state = { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: null, branch: { source, feature: 'feat/x', branchKept: true } };
  const h = await liveHost({ sources: s, read: (u) => (u === '/api/history/web-1/h2' ? [200, { state }] : u === '/api/history/web-1/h2/diff' ? [200, PATCH] : null) });
  h.w.RailUI.prefs.setMode('expert');
  await go(h.w, '#run/h2', 200); await settle(400);
  return h;
}
const labelsOf = async (d) => {
  const main = card(d).querySelector('[data-key="act-main"]')?.textContent.trim() || '';
  card(d).querySelector('[data-menu="act"]')?.click(); await settle(30);
  const items = [...card(d).querySelectorAll('[data-menu-pick]')].map((x) => x.textContent.trim());
  card(d).querySelector('[data-menu="act"]')?.click(); await settle(20);
  return [main, ...items];
};

test('F-3-02: a live task based on docs/rail-agreed shows that base in its head, PR stage and Changes label; no \'into dev\'', async () => {
  const { w, d } = await finished();
  assert.equal(w.RailTaskLive.detail('h2').base, 'docs/rail-agreed');
  assert.match(card(d).querySelector('.rc-place')?.textContent || '', /feat\/x\s*into\s*docs\/rail-agreed/);
  const v = pageView(w, 'h2');
  assert.equal(v.place.base, 'docs/rail-agreed');
  const tab = card(d).querySelector('[data-key="tab:changes"]');
  if (tab.getAttribute('aria-expanded') !== 'true') { tab.click(); await settle(80); }
  assert.match(card(d).querySelector('.ch-sum')?.textContent || '', /docs\/rail-agreed/, 'the Changes label names the base');
  assert.doesNotMatch(card(d).textContent, /into dev\b|Into dev\b/);
  const none = await finished({ source: '' });
  assert.doesNotMatch(card(none.d).textContent, /into dev\b|Into dev\b/, 'no base: never the sample dev');
});

test('F-3-03: a no-remote project\'s finished task offers Link remote, no Create PR; Link remote opens #projects/KEY and writes nothing', async () => {
  const { w, d, calls } = await finished({ remote: null });
  assert.equal(w.RailTaskLive.detail('h2').case, 'no-remote');
  assert.match(card(d).textContent, /This project has no git remote/);
  const labels = await labelsOf(d);
  assert.ok(!labels.some((l) => /Create PR/.test(l)), labels.join());
  assert.match(labels[0], /Link remote/);
  card(d).querySelector('[data-key="act-main"]').click(); await settle(200);
  assert.equal(w.location.hash, '#projects/web-1');
  assert.match(d.body.textContent, /Opened web: Link a remote… is in its More menu/);
  assert.deepEqual(sent(calls), [], 'I7: Link remote writes nothing');
});

test('B1.7 unknown base: a finished task with a SHA source offers no Create PR and says why', async () => {
  const { w, d } = await finished({ source: 'a1b2c3d4e5f6' });
  assert.equal(w.RailTaskLive.detail('h2').case, 'no-base');
  assert.match(card(d).textContent, /Base unknown: Worca cannot tell where to open a PR/);
  const labels = await labelsOf(d);
  assert.ok(!labels.some((l) => /Create PR|Link remote/.test(l)), labels.join());
  assert.equal(w.RailTaskLive.detail('h2').base, '');
});

// #1266: an ended task's Activity says how many steps it took; one that can still add steps says "so far". The demo cases
// hold every tone: finished (done), failed (fail), working (run) and archived (idle, also an unknown state's tone).
const activityOf = async (id) => {
  const w = stillhetHost({ hash: `#run/${id}`, after: (f) => closers.push(f) }); await settle(300);
  return w.document.querySelector('#card [data-key="tab:activity"]').textContent.replace(/^Activity/, '');
};
const closers = [];
afterEach(() => { while (closers.length) closers.pop()(); });

test('a finished task\'s Activity reads "N steps", without "so far" (tones done and fail)', async () => {
  for (const id of ['finished-nogit', 'failed']) assert.match(await activityOf(id), /^\d+ steps?$/, id);
});

test('a working task\'s Activity keeps "N steps so far" (tones run and idle)', async () => {
  for (const id of ['working', 'archived']) assert.match(await activityOf(id), /^\d+ steps? so far$/, id);
});

// F-3-19, F-a4-13: one count, one word on the demo page: a one-file task (mock-run) and a workspace whose one project had
// no changes; a group with one PR left to open says "Create 1 PR" (test/run-page-model.test.mjs)
const ONE_MANY = /(?:^|\D)1 (files|PRs|runs|docs|steps|projects)\b/;
// each text node on its own: the card's parts sit side by side with no space between them
const texts = (w) => { const out = [], it = w.document.createTreeWalker(w.document.querySelector('#card'), 4); while (it.nextNode()) out.push(it.currentNode.nodeValue.trim()); return out.filter(Boolean); };
const demoPage = async (id) => {
  const w = stillhetHost({ hash: `#run/${id}`, after: (f) => closers.push(f) }); await settle(300);
  w.RailUI.prefs.setMode('expert'); await settle(30);   // a workspace's member picks are Changes › Actions (Advanced)
  const c = w.document.querySelector('#card');
  const ch = c.querySelector('[data-key="tab:changes"]'); if (ch && ch.dataset.tab === 'changes') { ch.click(); await settle(60); }
  return w;
};
test('F-3-19, F-a4-13: the demo page says "1 file" and "1 project had no changes", never "1 files" or "1 projects"', async () => {
  const one = await demoPage('mock-run');
  assert.ok(texts(one).some((t) => /^1 file\b/.test(t)), texts(one).join(' | '));
  assert.deepEqual(texts(one).filter((t) => ONE_MANY.test(t)), []);
  const ws = await demoPage('workspace');
  assert.ok(texts(ws).includes('1 project had no changes'));
  assert.deepEqual(texts(ws).filter((t) => ONE_MANY.test(t)), []);
});

test('F-3-12: the demo document viewer shows "1 of 3", steps with Next, and its Open full says what it would do', async () => {
  const w = await demoPage('ready');
  const c = () => w.document.querySelector('#card');
  c().querySelector('[data-doc="0"]').click(); await settle(60);
  const view = () => c().querySelector('.viewer-modal .av');
  assert.ok(view(), 'the ArtifactView');
  assert.match(view().textContent, /1 of 3/);
  assert.ok(c().querySelector('[data-key="doc-prev"]').disabled, 'Previous is off at the first');
  const name0 = view().querySelector('.av-h b').textContent;
  c().querySelector('[data-key="doc-next"]').click(); await settle(60);
  assert.match(view().textContent, /2 of 3/);
  assert.notEqual(view().querySelector('.av-h b').textContent, name0);
  assert.ok(c().querySelector('[data-key="doc-full"][data-say]'), 'Open full is a demo data-say');
});

test('F-a4-12: the demo\'s refused Create PR failed after its push, so it says the branch is on the remote', async () => {
  const w = stillhetHost({ hash: '#run/ready', after: (f) => closers.push(f), beforeScripts: (win) => { win.Element.prototype.scrollIntoView = function () {}; } }); await settle(300);
  const c = () => w.document.querySelector('#card');
  const main = c().querySelector('[data-key="act-main"]');
  assert.equal(main.dataset.label, 'Create PR');
  main.click(); await settle(900);
  // the prototype's "Next one fails" switch (its tools panel; this host has none), checked once the title is written
  const box = w.document.createElement('input'); box.type = 'checkbox'; box.id = 'fail-next'; box.checked = true; w.document.body.append(box);
  c().querySelector('[data-key="pd-ok"]').click(); await settle(1200);
  const alert = c().querySelector('.pd-alert')?.textContent || '';
  assert.match(alert, /The branch is on the remote; no PR opened/);
  assert.doesNotMatch(alert, /Nothing changed/);
});
