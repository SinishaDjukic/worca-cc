// test/stillhet-task-tools-host-2.test.mjs — the live task page's tools on dev's routes (R-po-4, R-ux-6): Changes, its (part 2 of 2: split to stay under CI's 300 s per file)
// documents and the Logs are the task's own (D4); Terminal, services and built-in tools, Try it, Sync log, Open the whole
// diff, document downloads, Save as preset, Switch model, Resume at… and Move to group… each call dev's route. Live app
// host (jsdom, the real live adapter and RailTaskLive).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts, toastText } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const PATCH = ['diff --git a/src/pager.mjs b/src/pager.mjs', 'new file mode 100644', '--- /dev/null', '+++ b/src/pager.mjs', '@@ -0,0 +1,3 @@',
  '+export const PAGE = 50;', '+export function pages(n) {', '+  return Math.ceil(n / PAGE); }', ''].join('\n');
const LOG = [{ source: 'sync', level: 'info', text: 'fetched origin/dev: up to date', ts: '2026-11-12T08:00:01Z', nodeId: 'sync', executionId: 'x:sync:1' },
  { source: 'agent', level: 'info', text: 'Edited src/pager.mjs', ts: '2026-11-12T08:05:00Z', nodeId: 'n_impl' }].map((x) => JSON.stringify(x)).join('\n');
const ACTIONS = { enabled: true, members: [{ projectKey: 'web-1', state: 'checked-out', actions: [{ id: 'dev', label: 'Dev server', kind: 'service', openUrl: '' }], builtins: [{ key: 'editor', label: 'Editor' }] }], instances: [] };
const GROUPS = { groups: [{ id: 'G1', kind: 'user', title: 'Audit log', members: [{ position: 1, title: 'Shipped', pipelineId: 'h2', pr: { url: PR_URL, state: 'OPEN' } }, { position: 2, title: 'Broke', pipelineId: 'h3', pr: null }], cost: { usd: 1.5 } }] };

function sources() {
  const s = clone(SOURCES);
  for (const p of s.history.pipelines) p.projectKey = 'web-1';
  s.history.pipelines.find((p) => p.id === 'h2').pr = { url: PR_URL, state: 'OPEN' };
  return s;
}
const read = (u) => {
  if (u === '/api/history/web-1/h2') return [200, { state: { ...TASK_DETAILS.approved.state, projectKey: 'web-1' } }];
  if (u.startsWith('/api/pr/checks?id=h2')) return [200, TASK_DETAILS.approved.checks];
  if (u === '/api/history/web-1/h2/diff') return [200, PATCH];
  if (u === '/api/history/web-1/h2/log') return [200, LOG];
  if (u === '/api/runs/h2/artifacts') return [200, { artifacts: [{ kind: 'plan', stepKey: 'plan', relPath: 'docs/plan.md' }, { kind: 'live-log', relPath: 'live-log.ndjson' }] }];
  if (u === '/api/runs/h2/artifact?rel=docs%2Fplan.md') return [200, { rel: 'docs/plan.md', text: '## The real plan\n- page by 50' }];
  if (u === '/api/runs/h2/actions?projectKey=web-1') return [200, ACTIONS];
  if (u === '/api/pipelines/h2/setup') return [200, { setup: { workflowId: 'wf_default' }, target: 'project' }];
  if (u === '/api/run-groups') return [200, GROUPS];
  if (u === '/api/terminal/sessions/T1') return [200, { session: { id: 'T1', status: 'running' } }];
  return null;
};
async function page(hash = '#run/h2', write = () => [200, { ok: true }]) {
  const h = await liveHost({ sources: sources(), read, write });
  await go(h.w, hash, 200); await settle(400);
  return h;
}
const card = (d) => d.querySelector('#card');
const more = async (d, id) => { card(d).querySelector('[data-menu="more"]').click(); await settle(20); card(d).querySelector(`[data-menu-pick="${id}"]`).click(); await settle(120); };
// a part the page opened by itself (Changes on a ready task, partNow) is left open: its button would close it
const tab = async (d, id) => { const b = card(d).querySelector(`[data-key="tab:${id}"]`) || card(d).querySelector(`[data-tab="${id}"]`); if (b.dataset.tab === id) b.click(); await settle(30); };
const sent = (calls) => posts(calls).filter(([m, u]) => m !== 'GET' && !/^\/api\/ask\//.test(u));
test('Switch model… and Resume at… are dev\'s resume with a model and its timed resume', async () => {
  const { w, calls } = await page();
  await w.RailTaskLive.flow('Switch model…', { taskId: 'h1', model: 'sonnet', modelLabel: 'Sonnet 5.5' });
  await w.RailTaskLive.flow('Resume at…', { taskId: 'h1', value: '23:30' });
  const [sw, at] = sent(calls);
  assert.deepEqual(sw, ['POST', '/api/resume', { pipelineId: 'h1', model: 'sonnet' }]);
  assert.equal(at[1], '/api/schedules/resume');
  assert.equal(at[2].pipelineId, 'h1');
  assert.equal(new Date(at[2].scheduledFor).getHours(), 23);
});

test('dev\'s #group/ID draws its group page: its members in order, and Merge #N merges that member\'s PR', async () => {
  const { w, d, calls } = await page('#group/G1');
  assert.equal(w.location.hash, '#run/group:G1');
  assert.match(card(d).textContent, /Audit log/);
  // its head says its state (a member failed: it needs you), and its members go by their own titles, not "Task 1 / Task 2"
  assert.match(card(d).textContent, /Needs you/);
  assert.match(card(d).textContent, /Shipped/); assert.match(card(d).textContent, /Broke/);
  assert.doesNotMatch(card(d).textContent, /Task 1Task 2/);
  const main = card(d).querySelector('[data-key="act-main"]');
  assert.equal(main.dataset.label, 'Merge #959');
  main.click(); await settle(40);
  card(d).querySelector('[data-confirm="yes"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/pr/merge', { id: 'h2', projectKey: 'web-1' }]]);
});

test('a diff line\'s comment posts dev\'s comment anchored to its side and line; the file\'s threads are dev\'s', async () => {
  const comments = (u) => (u === '/api/history/web-1/h2/comments' ? [200, { comments: [{ path: 'src/pager.mjs', lineText: 'export const PAGE = 50;', body: 'Why 50?', author: 'user', authorName: 'Maya' }] }] : read(u));
  const h = await liveHost({ sources: sources(), read: comments, write: () => [201, { comment: {} }] });
  await go(h.w, '#run/h2', 200); await settle(400);
  const { d, calls } = h;
  await tab(d, 'changes');
  card(d).querySelector('[data-file]').click(); await settle(30);
  assert.match(card(d).querySelector('.ch-thread').textContent, /Maya on export const PAGE = 50;Why 50\?/);
  card(d).querySelector('[data-cmt="open"]').click(); await settle(30);
  const t = card(d).querySelector('#cmt-text'); t.value = 'Name it'; t.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  card(d).querySelector('[data-cmt="add"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/history/web-1/h2/comments', { path: 'src/pager.mjs', side: 'new', line: 3, body: 'Name it' }]]);
});

test('Publish branch and a running task\'s away mode are dev\'s publish and night routes', async () => {
  const { w, calls } = await page('#run/h2', () => [200, { ok: true, remote: 'origin', branch: 'feat/audit-log-pager', upToDate: false }]);
  const pub = await w.RailTaskLive.flow('Publish branch', { taskId: 'h2' });
  assert.equal(pub.say, 'Published feat/audit-log-pager to origin');
  await w.RailTaskLive.act('night', { taskId: 'run-b', mode: 'on' });
  assert.deepEqual(sent(calls), [['POST', '/api/runs/h2/publish', { projectKey: 'web-1' }], ['POST', '/api/run/night', { runId: 'run-b', mode: 'on' }]]);
});

test('a group whose tasks are all ready offers Create PR: dev\'s combine check first, then its ship (separate PRs, or one when they combine)', async () => {
  const groups = { groups: [{ id: 'G2', kind: 'user', title: 'Pager pair', members: [{ position: 1, title: 'Shipped', pipelineId: 'h2', pr: null }, { position: 2, title: 'Old pause', pipelineId: 'h1', pr: null }], cost: { usd: 1 } }] };
  const src = sources();
  for (const p of src.history.pipelines.filter((x) => x.id === 'h1' || x.id === 'h2')) Object.assign(p, { status: 'done', branch: 'feat/' + p.id, survived: true, pr: null });
  const r = (u) => (u === '/api/run-groups' ? [200, groups] : u === '/api/run-groups/G2/combine' ? [200, { n: 2, oneOff: '' }] : read(u));
  const h = await liveHost({ sources: src, read: r, write: (u) => (/\/ship$/.test(u) ? [200, { ok: true, mode: 'separate', prs: ['u1', 'u2'] }] : [200, {}]) });
  await go(h.w, '#run/group:G2', 200); await settle(400);
  const { d, calls } = h;
  const main = card(d).querySelector('[data-key="act-main"]');
  assert.equal(main.dataset.label, 'Create 2 PRs');
  assert.ok(calls.some((c) => c.url === '/api/run-groups/G2/combine'), 'dev\'s combine check');
  main.click(); await settle(40);
  card(d).querySelector('[data-confirm="yes"]').click(); await settle(150);
  assert.deepEqual(sent(calls), [['POST', '/api/run-groups/G2/ship', { mode: 'separate' }]]);
  assert.match(toastText(d) + d.body.textContent, /Created 2 PRs/);
});

test('a failed live Create 2 PRs invents no PR: no #9…, no "Opened", dev\'s plain refusal', async () => {
  const groups = { groups: [{ id: 'G2', kind: 'user', title: 'Pager pair', members: [{ position: 1, title: 'Shipped', pipelineId: 'h2', pr: null }, { position: 2, title: 'Old pause', pipelineId: 'h1', pr: null }], cost: { usd: 1 } }] };
  const src = sources();
  for (const p of src.history.pipelines.filter((x) => x.id === 'h1' || x.id === 'h2')) Object.assign(p, { status: 'done', branch: 'feat/' + p.id, survived: true, pr: null });
  const r = (u) => (u === '/api/run-groups' ? [200, groups] : u === '/api/run-groups/G2/combine' ? [200, { n: 2, oneOff: '' }] : read(u));
  const h = await liveHost({ sources: src, read: r, write: (u) => (/\/ship$/.test(u) ? [409, { error: 'git push was rejected' }] : [200, {}]) });
  await go(h.w, '#run/group:G2', 200); await settle(400);
  const { d } = h;
  card(d).querySelector('[data-key="act-main"]').click(); await settle(40);
  card(d).querySelector('[data-confirm="yes"]').click(); await settle(150);
  const text = card(d).textContent + toastText(d);
  assert.match(text, /Could not create the PRs.*git push was rejected/i, 'the server\'s refusal');
  assert.doesNotMatch(text, /#9\d\d|Opened/, 'no invented PR');
});

test('a workspace\'s stack is a row under Actions: Start posts dev\'s stack start', async () => {
  const actions = { ...ACTIONS, stacks: [{ id: 'all', label: 'Everything', steps: [{}, {}] }], stackStates: [] };
  const h = await liveHost({ sources: sources(), read: (u) => (u === '/api/runs/h2/actions?projectKey=web-1' ? [200, actions] : read(u)), write: () => [200, { status: 'starting' }] });
  await go(h.w, '#run/h2', 200); await settle(400);
  const { d, calls } = h;
  await tab(d, 'changes');
  assert.match(card(d).querySelector('.ch-actions').textContent, /Stack: Everything.*Not running · 2 steps/);
  card(d).querySelector('[data-stack="all"]').click(); await settle(100);
  assert.deepEqual(sent(calls), [['POST', '/api/runs/h2/stacks/all/start?projectKey=web-1', {}]]);
});

test('a diff comment sits on the row picked, even when two changed rows read the same', async () => {
  const twin = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1,1 +1,3 @@', ' x', '+}', '+}', ''].join('\n');
  const h = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h2/diff' ? [200, twin] : read(u)), write: () => [201, { comment: {} }] });
  await go(h.w, '#run/h2', 200); await settle(400);
  const { d, calls } = h;
  await tab(d, 'changes');
  card(d).querySelector('[data-file]').click(); await settle(30);
  card(d).querySelector('[data-cmt="open"]').click(); await settle(30);
  const t = card(d).querySelector('#cmt-text'); t.value = 'Extra brace'; t.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  card(d).querySelector('[data-cmt="add"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/history/web-1/h2/comments', { path: 'a.js', side: 'new', line: 3, body: 'Extra brace' }]], 'the last row, not the first `}`');
});

test('a workspace\'s two projects changing the same path are two files: each opens its own patch, and a comment posts dev\'s own path', async () => {
  const two = ['# api', 'diff --git a/src/x.mjs b/src/x.mjs', '--- a/src/x.mjs', '+++ b/src/x.mjs', '@@ -1 +1 @@', '-a', '+from api', '',
    '# web', 'diff --git a/src/x.mjs b/src/x.mjs', '--- a/src/x.mjs', '+++ b/src/x.mjs', '@@ -1 +1,2 @@', ' a', '+from web', ''].join('\n');
  const h = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h2/diff' ? [200, two] : read(u)), write: () => [201, { comment: {} }] });
  await go(h.w, '#run/h2', 200); await settle(400);
  const { d, calls } = h;
  await tab(d, 'changes');
  const rows = [...card(d).querySelectorAll('[data-file]')];
  assert.equal(rows.length, 2, 'two files, not one');
  const web = rows.find((r) => /web\//.test(r.closest('li').textContent));
  web.click(); await settle(30);
  assert.match(card(d).querySelector('.ch-diff').textContent, /from web/);
  assert.doesNotMatch(card(d).querySelector('.ch-diff').textContent, /from api/);
  card(d).querySelector('.ch-diff [data-fulldiff]').click(); await settle(30);
  const whole = card(d).querySelector('.viewer-modal').textContent;
  assert.match(whole, /from web/);
  assert.doesNotMatch(whole, /# web|# api|from api/, 'only this project\'s file, no `# KEY` line');
  card(d).querySelector('.viewer-modal [data-key="vd-close"]')?.click(); await settle(30);
  card(d).querySelector('[data-cmt="open"]').click(); await settle(30);
  const t = card(d).querySelector('#cmt-text'); t.value = 'Why?'; t.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  card(d).querySelector('[data-cmt="add"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/history/web-1/h2/comments', { path: 'src/x.mjs', side: 'new', line: 2, body: 'Why?' }]]);
});
