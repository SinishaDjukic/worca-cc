// test/ui-history-publish.test.mjs
// Publish branch (#618) in the History detail header: GET /api/runs/:id/publish paints
// "Published to origin/<branch>" and the button (Publish branch | Push changes); the
// dialog picks the push remote from GET /api/pr/remotes (the Ship-it defaults, so the
// remembered remote) and POSTs /api/runs/:id/publish once per ticked repo. No PR opens.
//
// boot()/settle()/go() are a local copy of test/ui-history-shipit.test.mjs — the suites
// do not import each other. Each test gets a fresh DOM + a fresh, cache-busted module import.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { cardAlertOf } from './helpers/feedback.mjs';
import { backdropClick, pressEscape, discardPrompt, keepEditing } from './helpers/popups.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler }) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    const r = fetchHandler(String(u), opts || {});
    if (r) return r;
    if (String(u).includes('/api/projects')) {
      return ok({ projects: [{ name: 'proj', path: '/tmp/proj', exists: true }] });
    }
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, calls };
}

async function settle(window, n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
const go = (window, hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

const KEY = 'proj-alpha-abcd1234';
const WKS_KEY = 'workspaces/team-a';
const ID = 'fcec04e8';
const FEATURE = 'worca-cc/log-ux-fcec04e8';
const row = (over = {}) => ({
  id: ID, projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj', title: 'Log UX', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: FEATURE, sourceBranch: 'feat/log-ux', survived: true,
  added: 12, removed: 3, mtime: 1, pauseReason: null, retainedWork: null, pr: null, ...over,
});
const detail = (over = {}) => ({
  state: { id: ID, title: 'Log UX', status: 'done', startedAt: '2026-08-17T20:54:42Z', stepper: null, steps: [], subAgents: [],
    branch: { source: 'feat/log-ux', feature: FEATURE }, prompt: 'Fix it.', ...over },
  results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '',
});
const member = (over = {}) => ({ memberKey: null, name: null, branch: FEATURE, remote: null, state: 'unpublished', published: null, ...over });
const remote = (name, owner) => ({ name, fetchUrl: `https://github.com/${owner}/repo.git`, pushUrl: '', host: 'github.com', owner, repo: 'repo', slug: `${owner}/repo` });
const REMOTES = { ok: true, remotes: [remote('origin', 'me'), remote('upstream', 'up')],
  defaults: { pushRemote: 'upstream', baseRemote: 'upstream' }, remembered: { pushRemote: 'upstream', baseRemote: 'upstream' },
  chain: [], defaultBase: null, branches: {} };

const STATUS_RE = new RegExp(`/api/runs/${ID}/publish\\?`);
async function bootPublish({ rows = [row()], det = detail(), status, after = null, post = null, shipped = null, hash = `history/${KEY}/${ID}` }) {
  const box = { status, posted: 0, shipped: 0 };
  const ctx = await boot({ fetchHandler: (url, opts) => {
    if (STATUS_RE.test(url)) return ok({ ok: true, members: box.shipped && shipped ? shipped : box.posted && after ? after : box.status });
    if (url.endsWith('/api/pr') && opts.method === 'POST') {             // Ship it: pushes the branch, opens the PR
      box.shipped += 1;
      return ok({ ok: true, url: 'https://github.com/up/repo/pull/7', mergeable: 'MERGEABLE', existed: false });
    }
    if (url.endsWith(`/api/runs/${ID}/publish`) && opts.method === 'POST') {
      box.posted += 1;
      return post ? post(JSON.parse(opts.body)) : ok({ ok: true, remote: 'upstream', branch: FEATURE, sha: 'a', upToDate: false });
    }
    if (/\/api\/pr\/remotes\?/.test(url)) return ok(REMOTES);
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff') || url.endsWith('/log')) return fail(404, { error: 'none' });
    if (url.endsWith('/api/history')) return ok({ pipelines: rows, ghAvailable: true });
    if (url.endsWith(`/api/history/${KEY}/${ID}`) || url.endsWith(`/api/workspaces/team-a/runs/${ID}`)) return ok(det);
    return null;
  } });
  await settle(ctx.window);
  go(ctx.window, hash);
  await settle(ctx.window, 10);
  return ctx;
}
const q = (w, sel) => w.document.querySelector(sel);
const posts = (ctx) => ctx.calls.filter((c) => c.url.endsWith(`/api/runs/${ID}/publish`) && c.opts.method === 'POST');

test('an unpublished finished run offers Publish branch; the dialog pushes to the remembered remote and opens no PR', async () => {
  const ctx = await bootPublish({ status: [member()], after: [member({ remote: 'upstream', state: 'published' })] });
  const w = ctx.window;
  const btn = q(w, '#hist-detail .hd-publish');
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, 'Publish branch');
  assert.equal(q(w, '#hist-detail .hd-published').hidden, true);
  assert.ok(ctx.calls.some((c) => c.url === `/api/runs/${ID}/publish?projectKey=${KEY}`), 'status read by store key');
  click(w, btn);
  await settle(w);
  const modal = q(w, '#publish-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  const rows = modal.querySelectorAll('.publish-repo');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /worca-cc\/log-ux-fcec04e8/);
  assert.equal(rows[0].querySelector('.publish-pick').hidden, true, 'a project run has nothing to tick');
  const sel = rows[0].querySelector('.publish-remote');
  assert.deepEqual([...sel.options].map((o) => o.value), ['origin', 'upstream']);
  assert.equal(sel.value, 'upstream', 'the Ship-it default, i.e. the remembered push remote');
  assert.equal(q(w, '#publish-modal .publish-ok').textContent, 'Publish');
  click(w, q(w, '#publish-modal .publish-ok'));
  await settle(w, 10);
  assert.equal(posts(ctx).length, 1);
  assert.deepEqual(JSON.parse(posts(ctx)[0].opts.body), { projectKey: KEY, projectDir: '/tmp/proj', pushRemote: 'upstream' });
  assert.ok(!ctx.calls.some((c) => c.url.endsWith('/api/pr') && c.opts.method === 'POST'), 'no PR was opened');
  assert.equal(modal.classList.contains('hidden'), true, 'closes on success');
  const note = q(w, '#hist-detail .hd-published');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Published to upstream/worca-cc/log-ux-fcec04e8');
  assert.equal(btn.hidden, true, 'nothing left to push');
  assert.equal(q(w, '#hist-detail .hd-pr').hidden, false, 'Ship it is still offered for the published branch');
});

test('a published branch with local commits since reads "Push changes" and pushes to the remote it was published to', async () => {
  const ctx = await bootPublish({ status: [member({ remote: 'origin', state: 'moved' })] });
  const w = ctx.window;
  const btn = q(w, '#hist-detail .hd-publish');
  assert.equal(btn.textContent, 'Push changes');
  assert.equal(q(w, '#hist-detail .hd-published').textContent, 'Published to origin/worca-cc/log-ux-fcec04e8');
  click(w, btn);
  await settle(w);
  assert.equal(q(w, '#publish-modal .publish-remote').value, 'origin');
  assert.equal(q(w, '#publish-modal .publish-ok').textContent, 'Push changes');
  click(w, q(w, '#publish-modal .publish-ok'));
  await settle(w, 10);
  assert.equal(JSON.parse(posts(ctx)[0].opts.body).pushRemote, 'origin');
});

test('no Publish control for a run still in progress, or with no branch here', async () => {
  let ctx = await bootPublish({ rows: [row({ status: 'running' })], det: detail({ status: 'running' }), status: [member()] });
  assert.equal(q(ctx.window, '#hist-detail .hd-publish').hidden, true);
  assert.ok(!ctx.calls.some((c) => STATUS_RE.test(c.url)), 'not even asked');
  ctx = await bootPublish({ status: [member({ state: 'none' })] });
  assert.equal(q(ctx.window, '#hist-detail .hd-publish').hidden, true);
});

test('a failed push stays in the dialog with the server error', async () => {
  const ctx = await bootPublish({ status: [member()], post: () => fail(500, { error: 'git push failed: rejected' }) });
  const w = ctx.window;
  click(w, q(w, '#hist-detail .hd-publish'));
  await settle(w);
  click(w, q(w, '#publish-modal .publish-ok'));
  await settle(w, 10);
  const modal = q(w, '#publish-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.match(modal.querySelector('.publish-status').textContent, /git push failed: rejected/);
  assert.match(cardAlertOf(modal.querySelector('.card')).detail, /could not be pushed/);
});

test('workspace: one row per member with a branch; each ticked member is pushed with its memberKey', async () => {
  const ctx = await bootPublish({
    rows: [row({ projectKey: WKS_KEY, target: 'workspace', projectDir: null })],
    det: detail({ target: 'workspace' }),
    hash: `history/${WKS_KEY}/${ID}`,
    status: [
      member({ memberKey: 'api-1', name: 'api', branch: 'worca-cc/a' }),
      member({ memberKey: 'web-2', name: 'web', branch: 'worca-cc/w', remote: 'origin', state: 'published' }),
      member({ memberKey: 'doc-3', name: 'docs', branch: null, state: 'none' }),
    ],
  });
  const w = ctx.window;
  assert.equal(q(w, '#hist-detail .hd-published').textContent, 'Published: web → origin/worca-cc/w');
  click(w, q(w, '#hist-detail .hd-publish'));
  await settle(w);
  const rows = [...q(w, '#publish-modal').querySelectorAll('.publish-repo')];
  assert.deepEqual(rows.map((r) => r.dataset.memberKey), ['api-1', 'web-2']);
  const picks = rows.map((r) => r.querySelector('.publish-pick'));
  assert.deepEqual(picks.map((p) => [p.hidden, p.checked]), [[false, true], [false, false]], 'already published: unticked');
  assert.ok(ctx.calls.some((c) => /\/api\/pr\/remotes\?/.test(c.url) && c.url.includes('memberKey=api-1')));
  picks[1].checked = true;
  picks[1].dispatchEvent(new w.Event('change'));
  assert.equal(q(w, '#publish-modal .publish-ok').textContent, 'Publish 2 branches');
  click(w, q(w, '#publish-modal .publish-ok'));
  await settle(w, 12);
  assert.deepEqual(posts(ctx).map((c) => JSON.parse(c.opts.body).memberKey), ['api-1', 'web-2']);
});

test('the Publish dialog is a form: a backdrop click keeps it and its picks; Escape asks once a pick changed; Cancel closes at once', async () => {
  const ctx = await bootPublish({
    rows: [row({ projectKey: WKS_KEY, target: 'workspace', projectDir: null })],
    det: detail({ target: 'workspace' }),
    hash: `history/${WKS_KEY}/${ID}`,
    status: [member({ memberKey: 'api-1', name: 'api', branch: 'worca-cc/a' }), member({ memberKey: 'web-2', name: 'web', branch: 'worca-cc/w' })],
  });
  const w = ctx.window;
  const modal = q(w, '#publish-modal');
  click(w, q(w, '#hist-detail .hd-publish'));
  await settle(w);
  pressEscape(w);
  assert.equal(discardPrompt(w.document), null, 'untouched (the remotes that loaded are no change): no question');
  assert.equal(modal.classList.contains('hidden'), true, 'Escape closes an untouched dialog');
  click(w, q(w, '#hist-detail .hd-publish'));
  await settle(w);
  const pick = modal.querySelectorAll('.publish-pick')[1];
  pick.checked = false;
  pick.dispatchEvent(new w.Event('change'));
  backdropClick(w, modal);
  assert.equal(modal.classList.contains('hidden'), false, 'never on a backdrop click');
  assert.equal(modal.querySelectorAll('.publish-pick')[1].checked, false, 'the pick is kept');
  pressEscape(w);
  assert.ok(discardPrompt(w.document), 'a changed pick: Escape asks');
  keepEditing(w.document);
  await settle(w, 2);
  assert.equal(modal.classList.contains('hidden'), false);
  click(w, q(w, '#publish-modal .publish-cancel'));
  assert.equal(modal.classList.contains('hidden'), true, 'Cancel closes at once');
  assert.equal(discardPrompt(w.document), null, 'Cancel never asks');
  assert.equal(posts(ctx).length, 0);
});

test('a branch with a pull request never offers Publish branch, even when its remote-tracking ref is gone', async () => {
  for (const state of ['OPEN', 'MERGED']) {
    const pr = { url: 'https://github.com/up/repo/pull/7', number: 7, state };
    const ctx = await bootPublish({ rows: [row({ pr })], status: [member()] });
    assert.equal(q(ctx.window, '#hist-detail .hd-publish').hidden, true, state);
    assert.equal(q(ctx.window, '#hist-detail .hd-published').hidden, true, state);
  }
});

test('a pull-request branch with local commits not on the remote still offers Push changes', async () => {
  const pr = { url: 'https://github.com/up/repo/pull/7', number: 7, state: 'OPEN' };
  const ctx = await bootPublish({ rows: [row({ pr })], status: [member({ remote: 'upstream', state: 'moved' })] });
  const btn = q(ctx.window, '#hist-detail .hd-publish');
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, 'Push changes');
});

test('Ship it repaints the publish state: Publish branch goes away once the PR pushed the branch', async () => {
  const ctx = await bootPublish({ status: [member()], shipped: [member({ remote: 'upstream', state: 'published' })] });
  const w = ctx.window;
  assert.equal(q(w, '#hist-detail .hd-publish').textContent, 'Publish branch');
  click(w, q(w, '#hist-detail .hd-pr'));
  await settle(w, 10);
  click(w, q(w, '#shipit-modal .shipit-ok'));
  await settle(w, 12);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/api/pr') && c.opts.method === 'POST').length, 1);
  assert.equal(q(w, '#hist-detail .hd-publish').hidden, true, 'no Publish branch for a branch with a PR');
  assert.equal(q(w, '#hist-detail .hd-published').textContent, 'Published to upstream/worca-cc/log-ux-fcec04e8');
});

test('workspace: a member with a pull request drops out of Publish; the others stay', async () => {
  const pr = { url: 'https://github.com/up/api/pull/3', number: 3, state: 'OPEN' };
  const members = [
    { memberKey: 'api-1', name: 'api', branch: 'worca-cc/a', survived: true, pr },
    { memberKey: 'web-2', name: 'web', branch: 'worca-cc/w', survived: true, pr: null },
  ];
  const ctx = await bootPublish({
    rows: [row({ projectKey: WKS_KEY, target: 'workspace', projectDir: null, members })],
    det: detail({ target: 'workspace' }),
    hash: `history/${WKS_KEY}/${ID}`,
    status: [
      member({ memberKey: 'api-1', name: 'api', branch: 'worca-cc/a' }),
      member({ memberKey: 'web-2', name: 'web', branch: 'worca-cc/w' }),
    ],
  });
  const w = ctx.window;
  assert.equal(q(w, '#hist-detail .hd-publish').textContent, 'Publish branch');
  click(w, q(w, '#hist-detail .hd-publish'));
  await settle(w);
  assert.deepEqual([...q(w, '#publish-modal').querySelectorAll('.publish-repo')].map((r) => r.dataset.memberKey), ['web-2']);
});

test('a diverged branch (remote and local both moved) offers no push; a workspace keeps it out of the dialog', async () => {
  let ctx = await bootPublish({ status: [member({ remote: 'origin', state: 'diverged' })] });
  assert.equal(q(ctx.window, '#hist-detail .hd-publish').hidden, true);
  assert.equal(q(ctx.window, '#hist-detail .hd-published').textContent, 'Published to origin/worca-cc/log-ux-fcec04e8');
  ctx = await bootPublish({
    rows: [row({ projectKey: WKS_KEY, target: 'workspace', projectDir: null })],
    det: detail({ target: 'workspace' }),
    hash: `history/${WKS_KEY}/${ID}`,
    status: [
      member({ memberKey: 'api-1', name: 'api', branch: 'worca-cc/a', remote: 'origin', state: 'diverged' }),
      member({ memberKey: 'web-2', name: 'web', branch: 'worca-cc/w', remote: 'origin', state: 'moved' }),
    ],
  });
  const w = ctx.window;
  assert.equal(q(w, '#hist-detail .hd-publish').textContent, 'Push changes');
  click(w, q(w, '#hist-detail .hd-publish'));
  await settle(w);
  assert.deepEqual([...q(w, '#publish-modal').querySelectorAll('.publish-repo')].map((r) => r.dataset.memberKey), ['web-2']);
});
