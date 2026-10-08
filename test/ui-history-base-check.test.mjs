// Base conflicts (#620) in the History detail header: one line per branch with the stored check against its
// base ("Conflicts in N files" + the files), and Re-check / Update branch / Resolve in a pipeline / Resolve in
// a terminal. The status line shows at every UI level; the buttons are advanced-level, like Publish branch.
// Results and refusals land in the member's own `.hd-base-msg` line (D19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDetail, openDetail, settle, click, ok, fail, deliverRows, ROW, DETAIL, KEY } from './helpers/history-detail-boot.mjs';
import { minLevelFor } from '../ui/public/ui-level.mjs';

const AT = new Date(Date.now() - 3 * 60_000).toISOString();
const CONFLICTS = { status: 'conflicts', base: 'feat/log-ux', fileCount: 2, files: ['a.js', 'b.js'], at: AT };
const CLEAN = { status: 'clean', base: 'feat/log-ux', behind: 2, fileCount: 0, files: [], at: AT };
const UP = { status: 'up-to-date', base: 'feat/log-ux', behind: 0, at: AT };
const withCheck = (rec, over = {}) => ({ ...DETAIL, state: { ...DETAIL.state, ...over, branch: { ...DETAIL.state.branch, baseCheck: rec } } });

/** Boot the detail with `rec` stored; `answer(action, body)` fakes the POST routes. Records each POST. */
async function bootBase(rec, { answer = () => ok({ ok: true }), detail = withCheck(rec), rows = [ROW] } = {}) {
  const posts = [];
  const ctx = await bootDetail({ rows, detail, arms: (url, opts) => {
    const m = /\/api\/runs\/[^/]+\/(base-check|update-branch|resolve-pipeline|resolve-terminal)\?/.exec(url);
    if (m && opts.method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      posts.push({ action: m[1], url, body });
      return answer(m[1], body);
    }
    if (url.endsWith('/api/terminal')) return ok({ enabled: false, sessions: [] });
    return null;
  } });
  await openDetail(ctx, null);
  await settle(ctx.window, 6);
  ctx.posts = posts;
  return ctx;
}
const doc = (ctx) => ctx.window.document;
const box = (ctx) => doc(ctx).querySelector('.hd-base-check');
const items = (ctx) => [...doc(ctx).querySelectorAll('li.hd-base-member')];
const btn = (li, cls) => li.querySelector(`.${cls}`);
const shown = (el) => !!el && !el.hidden;

test('conflicts: the pill, the files and both Resolve buttons; no Update branch', async () => {
  const ctx = await bootBase(CONFLICTS);
  assert.equal(box(ctx).hidden, false);
  const [li] = items(ctx);
  assert.equal(items(ctx).length, 1);
  assert.equal(li.querySelector('.hd-base-pill').textContent, 'Conflicts in 2 files');
  assert.match(li.querySelector('.hd-base-when').textContent, /checked 3 min ago/);
  assert.deepEqual([...li.querySelectorAll('.hd-base-files li')].map((x) => x.textContent), ['a.js', 'b.js']);
  assert.equal(shown(btn(li, 'hd-base-update')), false);
  assert.equal(shown(btn(li, 'hd-base-pipeline')), true);
  assert.equal(shown(btn(li, 'hd-base-terminal')), true);
  assert.equal(shown(btn(li, 'hd-base-recheck')), true);
});

test('the status line is ungated; only the buttons are advanced-level', async () => {
  const ctx = await bootBase(CONFLICTS);
  const [li] = items(ctx);
  assert.equal(minLevelFor(li.querySelector('.hd-base-pill')), 'simple');
  assert.equal(minLevelFor(li.querySelector('.hd-base-files')), 'simple');
  for (const c of ['hd-base-recheck', 'hd-base-update', 'hd-base-pipeline', 'hd-base-terminal']) {
    assert.equal(btn(li, c).dataset.minLevel, 'advanced', c);
  }
});

test('clean: only Update branch + Re-check; Update branch posts once and repaints with its result', async () => {
  const ctx = await bootBase(CLEAN, { answer: (action) => (action === 'update-branch'
    ? ok({ ok: true, baseCheck: UP, push: { pushed: true, remote: 'origin' } }) : null) });
  let [li] = items(ctx);
  assert.equal(li.querySelector('.hd-base-pill').textContent, 'feat/log-ux is 2 commits ahead, merges cleanly');
  assert.equal(shown(btn(li, 'hd-base-update')), true);
  assert.equal(shown(btn(li, 'hd-base-pipeline')), false);
  assert.equal(shown(btn(li, 'hd-base-terminal')), false);
  click(ctx.window, btn(li, 'hd-base-update'));
  await settle(ctx.window, 6);
  assert.equal(ctx.posts.length, 1);
  assert.match(ctx.posts[0].url, new RegExp(`/api/runs/${ROW.id}/update-branch\\?projectKey=${KEY}$`));
  assert.deepEqual(ctx.posts[0].body, {});
  [li] = items(ctx);
  assert.equal(li.querySelector('.hd-base-pill').textContent, 'Up to date with feat/log-ux');
  assert.equal(li.querySelector('.hd-base-msg').textContent, 'Merged and pushed to origin.');
});

test('a refusal shows its error in the member line', async () => {
  const ctx = await bootBase(CLEAN, { answer: () => fail(409, { code: 'RESOLVING', error: 'A run is resolving the conflicts.' }) });
  click(ctx.window, btn(items(ctx)[0], 'hd-base-update'));
  await settle(ctx.window, 6);
  const msg = items(ctx)[0].querySelector('.hd-base-msg');
  assert.match(msg.textContent, /A run is resolving the conflicts\./);
  assert.ok(msg.classList.contains('hd-base-msg-err'));
});

test('Re-check posts base-check and repaints from members[0].baseCheck', async () => {
  const ctx = await bootBase(CLEAN, { answer: () => ok({ ok: true, members: [{ projectKey: KEY, baseCheck: CONFLICTS }], settled: {} }) });
  click(ctx.window, btn(items(ctx)[0], 'hd-base-recheck'));
  await settle(ctx.window, 6);
  assert.equal(ctx.posts[0].action, 'base-check');
  assert.equal(items(ctx)[0].querySelector('.hd-base-pill').textContent, 'Conflicts in 2 files');
});

test('a newer row summary refresh keeps the loaded conflicting-file list', async () => {
  const newer = { ...CONFLICTS, files: undefined, at: new Date(Date.parse(AT) + 60_000).toISOString() };
  const ctx = await bootBase(CONFLICTS);
  ctx.box.detail = withCheck({ ...newer, files: ['c.js', 'd.js'] });

  await deliverRows(ctx, [{ ...ROW, baseCheck: newer }]);

  assert.equal(items(ctx)[0].querySelector('.hd-base-pill').textContent, 'Conflicts in 2 files');
  assert.deepEqual([...items(ctx)[0].querySelectorAll('.hd-base-files li')].map((x) => x.textContent), ['c.js', 'd.js']);
});

test('Resolve in a pipeline goes to the new run', async () => {
  const ctx = await bootBase(CONFLICTS, { answer: () => ok({ ok: true, runId: 'run-uuid-1' }) });
  click(ctx.window, btn(items(ctx)[0], 'hd-base-pipeline'));
  await settle(ctx.window, 6);
  assert.equal(ctx.posts[0].action, 'resolve-pipeline');
  assert.equal(ctx.window.location.hash, '#running/run-uuid-1');
});

test('Resolve in a terminal posts the size, says what to do next and shows the session in the pane', async () => {
  const ctx = await bootBase(CONFLICTS, { answer: () => ok({ session: { id: 'S1' }, conflicts: ['a.js', 'b.js'], worktreeDir: '/tmp/wt', started: true }) });
  click(ctx.window, btn(items(ctx)[0], 'hd-base-terminal'));
  await settle(ctx.window, 8);
  assert.equal(ctx.posts[0].action, 'resolve-terminal');
  assert.deepEqual(ctx.posts[0].body, { cols: 100, rows: 30 });
  assert.match(items(ctx)[0].querySelector('.hd-base-msg').textContent, /Merge started: 2 conflicting file\(s\)/);
  const i = ctx.calls.findIndex((c) => /resolve-terminal/.test(c.url));
  assert.ok(ctx.calls.slice(i + 1).some((c) => c.url.endsWith('/api/terminal')), 'the pane looked the session up (showSession)');
});

test('workspace: one line per member with its name; buttons post { member }', async () => {
  const branches = {
    'api-00000001': { source: 'dev', feature: 'worca/x', baseCheck: { ...CONFLICTS, base: 'dev' } },
    'web-00000002': { source: 'dev', feature: 'worca/x', baseCheck: { ...CLEAN, base: 'dev' } },
  };
  const detail = { ...DETAIL, state: { ...DETAIL.state, target: 'workspace', branches,
    projects: [{ projectKey: 'api-00000001', projectName: 'api' }, { projectKey: 'web-00000002', projectName: 'web' }] } };
  const ctx = await bootBase(null, { detail, answer: () => ok({ ok: true, baseCheck: { ...UP, base: 'dev' }, push: {} }) });
  const lis = items(ctx);
  assert.deepEqual(lis.map((li) => li.querySelector('.hd-base-name').textContent), ['api', 'web']);
  assert.equal(lis[0].querySelector('.hd-base-pill').textContent, 'Conflicts in 2 files');
  click(ctx.window, btn(lis[1], 'hd-base-update'));
  await settle(ctx.window, 6);
  assert.deepEqual(ctx.posts[0].body, { member: 'web-00000002' });
  assert.equal(items(ctx)[1].querySelector('.hd-base-pill').textContent, 'Up to date with dev');
  assert.match(items(ctx)[1].querySelector('.hd-base-msg').textContent, /Merged locally/);
});

test('a running run shows no block', async () => {
  const ctx = await bootBase(CONFLICTS, { detail: withCheck(CONFLICTS, { status: 'running' }), rows: [{ ...ROW, status: 'running' }] });
  assert.equal(box(ctx).hidden, true);
});
