// test/stillhet-task-tools-host.test.mjs — the live task page's tools on dev's routes (R-po-4, R-ux-6): Changes, its
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

test('Changes are the task\'s own diff: its file, its lines, and Open the whole diff shows that file\'s whole patch', async () => {
  const { d } = await page();
  await tab(d, 'changes');
  assert.match(card(d).textContent, /pager\.mjs/);
  assert.doesNotMatch(card(d).textContent, /run-head\.mjs/, 'never the design\'s sample files');
  card(d).querySelector('[data-file]').click(); await settle(30);
  assert.match(card(d).querySelector('.ch-diff').textContent, /export const PAGE = 50;/);
  card(d).querySelector('[data-fulldiff]').click(); await settle(30);
  assert.match(card(d).querySelector('.viewer-modal').textContent, /new file mode 100644/);
});

test('a document opens with its own text, and its Download opens dev\'s raw artifact with ?download=1', async () => {
  const opened = [], was = globalThis.open;
  globalThis.open = (u) => { opened.push(u); return {}; };   // task-live.mjs opens dev's GET through openTab (the module's window.open)
  try {
  const { d } = await page();
  await tab(d, 'changes');
  assert.match(card(d).textContent, /plan\.md/);
  assert.doesNotMatch(card(d).textContent, /review-3\.md|checklist\.md/);
  card(d).querySelector('[data-dl="0"]').click(); await settle(30);
  assert.deepEqual(opened, ['/api/runs/h2/artifact-raw/docs/plan.md?download=1']);
  card(d).querySelector('[data-doc="0"]').click(); await settle(60);
  assert.match(card(d).querySelector('.doc-view').textContent, /The real plan/);
  } finally { globalThis.open = was; }
});

test('services and built-in tools: Start posts dev\'s action start, Editor posts the builtin', async () => {
  const { d, calls } = await page();
  await tab(d, 'changes');
  const start = card(d).querySelector('[data-service="web-1/dev"]');   // keyed by its project and id: a workspace's projects may share an id
  assert.equal(start.textContent.trim(), 'Start');
  start.click(); await settle(80);
  card(d).querySelector('[data-builtin="web-1/editor"]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['POST', '/api/runs/h2/actions/dev/start?projectKey=web-1', {}], ['POST', '/api/runs/h2/builtins/editor?projectKey=web-1', {}]]);
});

test('Terminal opens a shell in the worktree (POST …/terminal) and draws its TerminalPane', async () => {
  const { d, calls } = await page('#run/h2', (u) => (/\/terminal\?/.test(u) ? [201, { session: { id: 'T1' } }] : [200, { ok: true }]));
  await more(d, 'more:terminal');
  assert.deepEqual(sent(calls)[0], ['POST', '/api/runs/h2/terminal?projectKey=web-1', {}]);
  assert.ok(card(d).querySelector('.tp-term'), 'the TerminalPane is open');
});

test('Try it checks the branch out, then starts its first service', async () => {
  const { d, calls } = await page();
  await more(d, 'more:try'); await settle(100);
  assert.deepEqual(sent(calls), [['POST', '/api/runs/h2/checkout?projectKey=web-1', {}], ['POST', '/api/runs/h2/actions/dev/start?projectKey=web-1', {}]]);
  assert.match(toastText(d) + d.body.textContent, /started Dev server/i);
});

test('Sync log opens Activity › Logs on the base sync\'s own lines', async () => {
  const { d } = await page();
  await more(d, 'more:sync');
  const logs = d.querySelector('#act-logs');
  assert.ok(logs, 'the Logs part');
  assert.match(logs.textContent, /fetched origin\/dev: up to date/);
  assert.doesNotMatch(logs.textContent, /Edited src\/pager\.mjs/);
});

test('Save as preset names the run\'s setup and posts dev\'s run preset', async () => {
  const { d, calls } = await page();
  await more(d, 'more:preset');
  const f = card(d).querySelector('#fd-value'); f.value = 'Pager setup'; f.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  card(d).querySelector('[data-fd="ok"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/pipelines/h2/preset', { name: 'Pager setup', scope: { kind: 'project' } }]]);
});

test('Move to group… lists dev\'s groups and adds the task to the picked one', async () => {
  const { d, calls } = await page();
  await more(d, 'more:group');
  const row = [...card(d).querySelectorAll('[data-listtoggle^="group|"]')].find((x) => x.dataset.listtoggle === 'group|Audit log');
  assert.ok(row, 'dev\'s own group');
  row.click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/run-groups/G1/members', { pipelineIds: ['h2'] }]]);
});

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
