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
  assert.match(li.querySelector('.hd-base-pill').title, /checked 3 min ago/);
  assert.deepEqual([...li.querySelectorAll('.hd-base-files li')].map((x) => x.textContent), ['a.js', 'b.js']);
  assert.equal(shown(btn(li, 'hd-base-update')), false);
  assert.equal(shown(btn(li, 'hd-base-pipeline')), true);
  assert.equal(shown(btn(li, 'hd-base-terminal')), true);
  assert.equal(shown(btn(li, 'hd-base-recheck')), false, 'the check runs on open: no Re-check here');
  assert.ok(['btn', 'btn-ghost', 'btn-mini'].every((c) => btn(li, 'hd-base-pipeline').classList.contains(c)), 'the house small button');
});

test('quiet when nothing needs doing: up to date shows no line', async () => {
  const ctx = await bootBase(UP);
  assert.equal(box(ctx).hidden, true);
  assert.equal(items(ctx).length, 0);
});

test('Re-check is offered after a failed check and while a resolution waits to be settled', async () => {
  const ERR = { status: 'error', base: 'feat/log-ux', error: 'fetch failed', at: AT };
  let ctx = await bootBase(ERR);
  assert.equal(shown(btn(items(ctx)[0], 'hd-base-recheck')), true);
  const detail = { ...DETAIL, state: { ...DETAIL.state, branch: { ...DETAIL.state.branch, baseCheck: UP, baseResolve: { via: 'terminal', at: 'x' } } } };
  ctx = await bootBase(UP, { detail });
  assert.equal(items(ctx).length, 1, 'a pending resolution keeps the line');
  assert.equal(shown(btn(items(ctx)[0], 'hd-base-recheck')), true);
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

test('after Update branch the publish button repaints: a refused push offers Push changes', async () => {
  let publishState = 'published';
  const publishGets = [];
  const ctx = await bootDetail({ rows: [ROW], detail: withCheck(CLEAN), arms: (url, opts) => {
    if (/\/api\/runs\/[^/]+\/publish\?/.test(url) && (!opts || !opts.method || opts.method === 'GET')) {
      publishGets.push(url);
      return ok({ ok: true, members: [{ memberKey: null, branch: 'worca-cc/log-ux-fcec04e8', remote: 'origin', state: publishState }] });
    }
    if (/\/update-branch\?/.test(url)) {
      publishState = 'moved';                                // merged locally; the push was refused
      return ok({ ok: true, baseCheck: UP, push: { pushed: false, remote: 'origin', error: 'rejected (fetch first)' } });
    }
    if (url.endsWith('/api/terminal')) return ok({ enabled: false, sessions: [] });
    return null;
  } });
  await openDetail(ctx, null);
  await settle(ctx.window, 6);
  const pub = doc(ctx).querySelector('#hist-detail .hd-publish');
  assert.equal(pub.hidden, true, 'published and current: no button');
  const before = publishGets.length;
  click(ctx.window, btn(items(ctx)[0], 'hd-base-update'));
  await settle(ctx.window, 8);
  assert.ok(publishGets.length > before, 'the publish state was asked again');
  assert.equal(pub.hidden, false);
  assert.equal(pub.textContent, 'Push changes');
  assert.match(items(ctx)[0].querySelector('.hd-base-msg').textContent, /the push failed: rejected/);
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
  const ctx = await bootBase({ status: 'error', base: 'feat/log-ux', error: 'fetch failed', at: AT }, { answer: () => ok({ ok: true, members: [{ projectKey: KEY, baseCheck: CONFLICTS }], settled: {} }) });
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
  assert.equal(shown(btn(items(ctx)[0], 'hd-base-recheck')), true, 'Re-check is offered to finish the resolution');
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

test('auto check on open: a branch never checked is checked once, quietly, and repaints', async () => {
  const ctx = await bootBase(null, { answer: (action) => (action === 'base-check'
    ? ok({ ok: true, members: [{ projectKey: KEY, baseCheck: CONFLICTS }], settled: {} }) : null) });
  assert.equal(ctx.posts.length, 1);
  assert.equal(ctx.posts[0].action, 'base-check');
  assert.deepEqual(ctx.posts[0].body, { auto: true });
  const [li] = items(ctx);
  assert.equal(li.querySelector('.hd-base-pill').textContent, 'Conflicts in 2 files');
  assert.equal(li.querySelector('.hd-base-msg'), null, 'no result line for an automatic check');
  await deliverRows(ctx, [ROW]);                          // a repaint of the same open does not check again
  assert.equal(ctx.posts.length, 1);
});

test('auto check on open: a check older than 5 minutes is redone; a recent one is not', async () => {
  const old = { ...CLEAN, at: new Date(Date.now() - 10 * 60_000).toISOString() };
  let ctx = await bootBase(old, { answer: () => ok({ ok: true, members: [{ projectKey: KEY, baseCheck: UP }], settled: {} }) });
  assert.deepEqual(ctx.posts.map((x) => x.action), ['base-check']);
  assert.equal(box(ctx).hidden, true, 'now up to date: the line goes away');
  ctx = await bootBase(CLEAN);
  assert.equal(ctx.posts.length, 0);
});

test('auto check on open: a failed request leaves the stored line alone', async () => {
  const old = { ...CLEAN, at: new Date(Date.now() - 10 * 60_000).toISOString() };
  const ctx = await bootBase(old, { answer: () => fail(500, { error: 'boom' }) });
  assert.equal(ctx.posts.length, 1);
  const [li] = items(ctx);
  assert.equal(li.querySelector('.hd-base-pill').textContent, 'feat/log-ux is 2 commits ahead, merges cleanly');
  assert.equal(li.querySelector('.hd-base-msg'), null);
});

test('a running run shows no block', async () => {
  const ctx = await bootBase(CONFLICTS, { detail: withCheck(CONFLICTS, { status: 'running' }), rows: [{ ...ROW, status: 'running' }] });
  assert.equal(box(ctx).hidden, true);
});
