// test/ui-chat-action-cards.test.mjs — worca Chat P2 Task 8: the receipt, stop and pull-request cards render from the
// block and the card ctx alone, post the right verbs, and keep every error inside the card.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildReceiptCard, buildRunStopCard, buildPullRequestCard, registerChatActionCards, refreshChatPrWatch } from '../ui/public/chat/action-cards.mjs';
import { chatCardBuilder, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { checkRows } from './helpers/rows.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); _resetChatExtensions(); });
function ctxOf({ post = async () => ({}), openShipIt, fetch } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doms.push(dom);
  const posts = []; const said = [];
  const ctx = {
    doc: dom.window.document, win: dom.window,
    threadId: () => 'ask_aaaaaaaa',
    postCard: async (block, body) => { posts.push(body); return post(block, body); },
    announce: (t) => said.push(t),
    ...(openShipIt ? { openShipIt } : {}),
    ...(fetch ? { fetch } : {}),
  };
  return { ctx, posts, said };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
const refused = (code, error) => Object.assign(new Error(error), { status: 409, body: { error, ...(code ? { code } : {}) } });
const RECEIPT = { kind: 'card', id: 'card_00000001', state: 'applied', card: { type: 'receipt', kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' }, revertible: true } };

test('receipt: kind chip, title, where, before → after and Revert; a successful Revert says so', async () => {
  const { ctx, posts, said } = ctxOf();
  const { el } = buildReceiptCard(RECEIPT, ctx);
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Setting');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Theme');
  assert.equal(el.querySelector('.ask-mcard-title').title, 'Theme', 'a long title is cut; hover shows it whole');
  assert.equal(el.querySelector('.ask-mcard-target').textContent, 'Your settings');
  assert.equal(el.querySelector('.ask-mcard-before').textContent, 'System (default)');
  assert.equal(el.querySelector('.ask-mcard-after').textContent, 'Dark');
  assert.equal(el.getAttribute('role'), 'group');
  const revert = el.querySelector('[data-chat-revert]');
  assert.equal(revert.tagName, 'BUTTON'); assert.equal(revert.type, 'button'); assert.equal(revert.getAttribute('aria-label'), 'Revert Theme');
  click(revert);
  assert.equal(revert.textContent, 'Reverting…'); assert.equal(revert.disabled, true);
  await tick();
  assert.deepEqual(posts, [{ state: 'reverted' }]);
  assert.equal(el.querySelector('.ask-rcard-note').textContent, 'Reverted');
  assert.deepEqual(said, ['Reverted Theme']);
});

test('receipt: Changed since keeps Revert disabled with the note; another failure shows inline and allows a retry', async () => {
  await checkRows([
    { name: 'changed since (409)', run: async () => {
      const { ctx } = ctxOf({ post: async () => { throw refused('CHANGED_SINCE', 'Changed since — not reverted'); } });
      const { el } = buildReceiptCard(RECEIPT, ctx);
      const revert = el.querySelector('[data-chat-revert]');
      click(revert); await tick();
      assert.equal(el.querySelector('.ask-rcard-note').textContent, 'Not reverted: it changed since');
      assert.equal(revert.disabled, true);
      assert.equal(el.querySelector('.ask-card-err').textContent, '');
    } },
    { name: 'a persisted changed-since (after a reload)', run: async () => {
      const { ctx } = ctxOf();
      const { el } = buildReceiptCard({ ...RECEIPT, card: { ...RECEIPT.card, result: { code: 'CHANGED_SINCE', error: 'Changed since — not reverted' } } }, ctx);
      assert.equal(el.querySelector('[data-chat-revert]').disabled, true);
      assert.equal(el.querySelector('.ask-rcard-note').textContent, 'Not reverted: it changed since');
    } },
    { name: 'a failed write', run: async () => {
      const { ctx } = ctxOf({ post: async () => { throw refused('REVERT_FAILED', 'The run is still pausing — try again in a moment'); } });
      const { el } = buildReceiptCard(RECEIPT, ctx);
      const revert = el.querySelector('[data-chat-revert]');
      click(revert); await tick();
      assert.equal(el.querySelector('.ask-card-err').textContent, 'The run is still pausing — try again in a moment');
      assert.equal(revert.disabled, false); assert.equal(revert.textContent, 'Revert');
    } },
    { name: 'reverted: no button', run: async () => {
      const { ctx } = ctxOf();
      const { el } = buildReceiptCard({ ...RECEIPT, state: 'reverted' }, ctx);
      assert.equal(el.querySelector('[data-chat-revert]'), null);
      assert.equal(el.querySelector('.ask-rcard-note').textContent, 'Reverted');
    } },
    { name: 'a direction: its text, no Revert', run: async () => {
      const { ctx } = ctxOf();
      const { el } = buildReceiptCard({ kind: 'card', id: 'card_00000002', state: 'applied', card: { type: 'receipt', kind: 'direction', label: 'Direction', target: { pipelineId: 'aaaa0001', title: 'Fix login' }, before: '', after: 'skip the docs', raw: {}, revertible: false } }, ctx);
      assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Direction sent');
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Fix login');
      assert.equal(el.querySelector('.ask-rcard-text').textContent, 'skip the docs');
      assert.equal(el.querySelector('[data-chat-revert]'), null);
    } },
    { name: 'a project setting names the project', run: async () => {
      const { ctx } = ctxOf();
      const { el } = buildReceiptCard({ ...RECEIPT, card: { ...RECEIPT.card, target: { settingId: 'askMaxTurns', scope: 'project', projectKey: 'shop-1a2b3c4d', title: 'shop' } } }, ctx);
      assert.equal(el.querySelector('.ask-mcard-target').textContent, 'Project shop');
    } },
  ]);
});

const STOP = { kind: 'card', id: 'card_00000003', state: 'proposed', card: { type: 'run-stop', runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login', branch: 'worca/fix-login', status: 'running' } };
test('run-stop: the warning itself (R7) — title, run, branch, copy, Keep running / red Stop run; busy and inline errors', async () => {
  await checkRows([
    { name: 'proposed', run: async () => {
      const { ctx, posts } = ctxOf();
      const { el } = buildRunStopCard(STOP, ctx);
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Stop this run?');
      assert.equal(el.querySelector('.ask-stopcard-title').textContent, 'Fix login');
      assert.equal(el.querySelector('.ask-stopcard-title').title, 'worca/fix-login');
      assert.equal(el.querySelector('.ask-stopcard-branch'), null);
      assert.equal(el.querySelector('.ask-stopcard-copy').textContent, "A stopped run can't be resumed. Its work so far stays on its branch.");
      const keep = el.querySelector('[data-chat-stop-keep]');
      const stop = el.querySelector('[data-chat-stop-confirm]');
      assert.equal(keep.textContent, 'Keep running');
      assert.equal(stop.textContent, 'Stop run');
      assert.ok(stop.classList.contains('btn-danger'), 'the danger button: red text on the light red fill');
      click(stop);
      assert.equal(stop.textContent, 'Stopping…'); assert.equal(keep.disabled, true);
      await tick();
      assert.deepEqual(posts, [{ state: 'applied' }]);
    } },
    { name: 'a paused run is kept paused', run: async () => {
      const { ctx } = ctxOf();
      const { el } = buildRunStopCard({ ...STOP, card: { ...STOP.card, status: 'paused' } }, ctx);
      assert.equal(el.querySelector('[data-chat-stop-keep]').textContent, 'Keep paused');
    } },
    { name: 'decline', run: async () => {
      const { ctx, posts } = ctxOf();
      const { el } = buildRunStopCard(STOP, ctx);
      click(el.querySelector('[data-chat-stop-keep]')); await tick();
      assert.deepEqual(posts, [{ state: 'declined' }]);
    } },
    { name: 'an error stays in the card and the buttons come back', run: async () => {
      const { ctx } = ctxOf({ post: async () => { throw refused(null, 'card is applied'); } });
      const { el } = buildRunStopCard(STOP, ctx);
      const stop = el.querySelector('[data-chat-stop-confirm]');
      click(stop); await tick();
      assert.equal(el.querySelector('.ask-card-err').textContent, 'card is applied');
      assert.equal(stop.disabled, false); assert.equal(stop.textContent, 'Stop run');
    } },
    { name: 'applied, failed, declined', run: async () => {
      const { ctx } = ctxOf();
      const applied = buildRunStopCard({ ...STOP, state: 'applied' }, ctx).el;
      assert.equal(applied.querySelector('.ask-stopcard-done').textContent, 'Stopped');
      assert.equal(applied.querySelector('[data-chat-stop-confirm]'), null);
      assert.equal(buildRunStopCard({ ...STOP, state: 'failed', error: "An interrupted run can't be stopped — it stays resumable" }, ctx).el.querySelector('.ask-mcard-failed').textContent,
        "Could not stop: An interrupted run can't be stopped — it stays resumable");
      assert.equal(buildRunStopCard({ ...STOP, state: 'declined' }, ctx).el.textContent, 'Not stopped: Fix login');
    } },
  ]);
});

const PR = { kind: 'card', id: 'card_00000004', state: 'proposed', card: { type: 'pull-request', pipelineId: 'aaaa0005', projectKey: 'shop-1a2b3c4d', title: 'Fix login', branch: 'worca/fix-login', base: 'main', filesChanged: 14, additions: 412, deletions: 188 } };
test('pull-request: branch → base and files ±; Create opens Ship it with the card\'s link and waits for it to close; Not now declines', async () => {
  await checkRows([
    { name: 'proposed: Create stays disabled while the dialog is open; a PR opened is announced', run: async () => {
      let close;
      const opened = [];
      const { ctx, said } = ctxOf({ openShipIt: (ref, link) => { opened.push([ref, link]); return new Promise((r) => { close = r; }); } });
      const { el } = buildPullRequestCard(PR, ctx);
      assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Pull request');
      assert.equal(el.querySelector('.ask-prcard-branch').textContent, 'worca/fix-login→main');
      assert.equal(el.querySelector('.ask-prcard-stat').textContent, '14 files · +412 −188');
      const create = el.querySelector('[data-chat-pr-create]');
      click(create); await tick();
      assert.deepEqual(opened, [[{ pipelineId: 'aaaa0005', projectKey: 'shop-1a2b3c4d' }, { askThreadId: 'ask_aaaaaaaa', askCardId: 'card_00000004' }]]);
      assert.equal(create.disabled, true, 'one dialog per card');
      close({ opened: true, url: 'https://x/pull/7' }); await tick();
      assert.equal(create.disabled, true, 'the server flips the card; it rebuilds as applied');
      assert.deepEqual(said, ['Pull request opened']);
    } },
    { name: 'closed without a PR: Create comes back; Not now declines', run: async () => {
      const { ctx, posts } = ctxOf({ openShipIt: async () => ({ opened: false }) });
      const { el } = buildPullRequestCard(PR, ctx);
      const create = el.querySelector('[data-chat-pr-create]');
      click(create); await tick();
      assert.equal(create.disabled, false);
      click(el.querySelector('[data-chat-pr-decline]')); await tick();
      assert.deepEqual(posts, [{ state: 'declined' }]);
    } },
    { name: 'the opener\'s refusal shows in the card', run: async () => {
      const { ctx } = ctxOf({ openShipIt: async () => ({ opened: false, error: 'This run is not in History yet.' }) });
      const { el } = buildPullRequestCard(PR, ctx);
      click(el.querySelector('[data-chat-pr-create]')); await tick();
      assert.equal(el.querySelector('.ask-card-err').textContent, 'This run is not in History yet.');
      assert.equal(el.querySelector('[data-chat-pr-create]').disabled, false);
    } },
    { name: 'no opener assigned yet (P1\'s ctx.openShipIt answers undefined): a plain error in the card, Create comes back', run: async () => {
      const { ctx } = ctxOf({ openShipIt: () => undefined });
      const { el } = buildPullRequestCard(PR, ctx);
      click(el.querySelector('[data-chat-pr-create]')); await tick();
      assert.equal(el.querySelector('.ask-card-err').textContent, 'Could not open the Create PR dialog.');
      assert.equal(el.querySelector('[data-chat-pr-create]').disabled, false);
    } },
    { name: 'applied: View PR opens in a new tab; a workspace lists each member; declined is a stub', run: async () => {
      const { ctx } = ctxOf();
      const one = buildPullRequestCard({ ...PR, state: 'applied', card: { ...PR.card, result: { url: 'https://x/pull/7', draft: false, existed: false } } }, ctx).el;
      const a = one.querySelector('.ask-prcard-link');
      assert.equal(a.textContent, 'View PR'); assert.equal(a.href, 'https://x/pull/7');
      assert.equal(a.target, '_blank'); assert.equal(a.rel, 'noopener noreferrer');
      assert.equal(one.querySelector('[data-chat-pr-create]'), null);
      const ws = buildPullRequestCard({ ...PR, state: 'applied', card: { ...PR.card, result: { url: 'https://x/pull/1', draft: false, existed: false,
        members: [{ url: 'https://x/pull/1', memberKey: 'api-11111111' }, { url: 'https://x/pull/2', draft: true, memberKey: 'web-22222222' }] } } }, ctx).el;
      assert.deepEqual([...ws.querySelectorAll('.ask-prcard-link')].map((x) => x.textContent), ['View PR · api', 'View PR · web']);
      assert.equal(ws.querySelectorAll('.ask-prcard-links .ask-mcard-kind').length, 1, 'one Draft chip');
      assert.equal(buildPullRequestCard({ ...PR, state: 'declined' }, ctx).el.textContent, 'Not now: Fix login');
    } },
  ]);
});

test('registerChatActionCards registers the three types with P1\'s card registry (again = replaced, never a throw)', () => {
  _resetChatExtensions();
  registerChatActionCards();
  registerChatActionCards();                         // app.js runs again on every jsdom boot
  for (const t of ['receipt', 'run-stop', 'pull-request', 'ship', 'changes', 'route']) assert.equal(typeof chatCardBuilder(t), 'function', t);
});

test('receipt: a Revert another tab already made says so in the note, no error, Revert stays off (mutation killer)', async () => {
  const { ctx } = ctxOf({ post: async () => { throw refused('ALREADY_REVERTED', 'Already reverted'); } });
  const { el } = buildReceiptCard(RECEIPT, ctx);
  const revert = el.querySelector('[data-chat-revert]');
  click(revert); await tick();
  assert.equal(el.querySelector('.ask-rcard-note').textContent, 'Already reverted');
  assert.equal(el.querySelector('.ask-card-err').textContent, '');
  assert.equal(revert.disabled, true);
});

test('run-stop: a stop the server refused (the card came back failed) is announced as such, not as "Stopping"', async () => {
  const { ctx, said } = ctxOf({ post: async () => ({ block: { ...STOP, state: 'failed', error: "An interrupted run can't be stopped — it stays resumable" } }) });
  const { el } = buildRunStopCard(STOP, ctx);
  click(el.querySelector('[data-chat-stop-confirm]')); await tick();
  assert.deepEqual(said, ["Could not stop: An interrupted run can't be stopped — it stays resumable"]);
});

test('pull-request: closing the dialog without a PR gives the focus back to Create', async () => {
  const { ctx } = ctxOf({ openShipIt: async () => ({ opened: false }) });
  const { el } = buildPullRequestCard(PR, ctx);
  ctx.doc.body.appendChild(el);
  const create = el.querySelector('[data-chat-pr-create]');
  click(create); await tick();
  assert.equal(ctx.doc.activeElement, create);
});

test('receipt: a successful Revert hides its button at once — the server\'s frame then rebuilds the card as reverted (refine cycle 2 mutation killer)', async () => {
  const { ctx } = ctxOf();
  const { el } = buildReceiptCard(RECEIPT, ctx);
  click(el.querySelector('[data-chat-revert]')); await tick();
  assert.equal(el.querySelector('.ask-mcard-actions').hidden, true);
});

test('refine cycle 2: Away now names itself once; declined stubs carry the readable class; a refused Revert is announced once', async () => {
  const { ctx, said } = ctxOf({ post: async () => { throw refused('CHANGED_SINCE', 'Changed since — not reverted'); } });
  const away = buildReceiptCard({ kind: 'card', id: 'card_00000009', state: 'applied', card: { type: 'receipt', kind: 'away-now', label: 'Away mode', target: {},
    before: 'Following away hours', after: "I'm away now", raw: { before: 'auto', after: 'on', person: null }, revertible: true } }, ctx).el;
  assert.deepEqual([...away.querySelectorAll('.ask-mcard-head > *')].map((n) => n.textContent), ['Away mode']);
  assert.equal(away.getAttribute('aria-label'), 'Away mode');
  assert.equal(away.querySelector('[data-chat-revert]').getAttribute('aria-label'), 'Revert Away mode');
  assert.equal(away.querySelector('.ask-rcard-note').hasAttribute('role'), false, 'no live region beside ctx.announce');
  click(away.querySelector('[data-chat-revert]')); await tick();
  assert.deepEqual(said, ['Not reverted: it changed since']);
  assert.ok(buildRunStopCard({ ...STOP, state: 'declined' }, ctx).el.classList.contains('ask-actcard-stub'));
  assert.ok(buildPullRequestCard({ ...PR, state: 'declined' }, ctx).el.classList.contains('ask-actcard-stub'));
});

test('refine cycle 2: the action-card rules that keep every text at 4.5:1 in light (measured in Chrome)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p2 = css.slice(css.indexOf('/* ===== Chat P2: Action cards ===== */'));
  assert.ok(!/is-reverted[^{]*\{[^}]*opacity/.test(p2), 'reverted text is never faded with opacity');
  for (const rule of ['.ask-actcard-stub{color:var(--ink-2);overflow-wrap:anywhere;}', ':is(.ask-rcard,.ask-prcard) .ask-mcard-arrow{color:var(--ink-2);}']) assert.ok(p2.includes(rule), rule);
  assert.ok(!p2.includes('.ask-card-start'), 'the stop button is .btn-danger: no skin of its own');
  const stop = buildRunStopCard(STOP, ctxOf().ctx).el.querySelector('[data-chat-stop-confirm]');
  assert.deepEqual([...stop.classList], ['btn', 'btn-sm', 'btn-danger'], 'red text on the light red fill, a small card-footer button');
});

test('refine cycle 3 mutation killers: every Revert outcome is spoken once by name — Away now as "Away mode", "Already reverted" too', async () => {
  const AWAY = { kind: 'card', id: 'card_0000000a', state: 'applied', card: { type: 'receipt', kind: 'away-now', label: 'Away mode', target: {},
    before: 'Following away hours', after: "I'm away now", raw: { before: 'auto', after: 'on', person: null }, revertible: true } };
  const ok = ctxOf();
  click(buildReceiptCard(AWAY, ok.ctx).el.querySelector('[data-chat-revert]')); await tick();
  assert.deepEqual(ok.said, ['Reverted Away mode']);
  const gone = ctxOf({ post: async () => { throw refused('ALREADY_REVERTED', 'Already reverted'); } });
  click(buildReceiptCard(RECEIPT, gone.ctx).el.querySelector('[data-chat-revert]')); await tick();
  assert.deepEqual(gone.said, ['Already reverted']);
});

test('refine cycle 3 mutation killers: a disabled Revert / Keep running / Not now keeps --ink-2 on hover; a reverted receipt mutes its new value without opacity', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p2 = css.slice(css.indexOf('/* ===== Chat P2: Action cards ===== */'));
  assert.ok(p2.includes('.ask-rcard.is-reverted .ask-rcard-change .ask-mcard-after{color:var(--ink-2);font-weight:400;}'));
  // Revert / Keep running / Not now are .btn-quiet: its hover skips a disabled button, so the --ink-2 text stays.
  assert.ok(css.includes('.btn-quiet{background:transparent;border-color:transparent;color:var(--ink-2);}'));
  assert.ok(css.includes('.btn-quiet:hover:not(:disabled){'));
  const keep = buildRunStopCard(STOP, ctxOf().ctx).el.querySelector('[data-chat-stop-keep]');
  assert.ok(keep.classList.contains('btn-quiet') && keep.classList.contains('ask-card-not-now'));
});

test('pull-request: an applied card shows no watch line; each PR link\'s tooltip says whether it is watched, re-read on pr-watch-changed', async () => {
  const views = { '': { watching: true, status: 'fixing', reason: null, activePipelineId: 'f1', resolving: false, mergingBase: null },
    'api-11111111': { watching: true, status: 'watching', reason: null, activePipelineId: null, resolving: false, mergingBase: null },
    'web-22222222': { watching: true, status: 'needs-person', reason: 'cap', activePipelineId: null, resolving: false, mergingBase: null } };
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const v = views[new URL(url, 'http://x').searchParams.get('memberKey') || ''];
    return v ? { ok: true, status: 200, json: async () => v } : { ok: false, status: 400, json: async () => ({ error: 'no open PR' }) };
  };
  const { ctx } = ctxOf({ fetch });
  await checkRows([
    { name: 'project run: the link title from GET /api/pr/watch', run: async () => {
      const card = buildPullRequestCard({ ...PR, state: 'applied', card: { ...PR.card, result: { url: 'https://x/pull/781', draft: false, existed: false } } }, ctx);
      await tick(); await tick();
      const link = card.el.querySelector('.ask-prcard-link');
      assert.equal(calls[0], '/api/pr/watch?id=aaaa0005&projectKey=shop-1a2b3c4d');
      assert.equal(card.el.querySelectorAll('.ask-prcard-watch').length, 0, 'no watch line');
      assert.equal(link.title, 'PR #781 · watched');
      views[''] = { ...views[''], status: 'needs-person', reason: 'cap' };
      assert.equal(refreshChatPrWatch({ type: 'pr-watch-changed', projectKey: 'shop-1a2b3c4d', pipelineId: 'aaaa0005', memberKey: null }), 1);
      await tick(); await tick();
      assert.equal(link.title, 'PR #781 · watch stopped');
      views[''] = { ...views[''], watching: false, status: 'watching', reason: null };
      refreshChatPrWatch({ pipelineId: 'aaaa0005', memberKey: null });
      await tick(); await tick();
      assert.equal(link.title, 'PR #781', 'not watched');
      card.dispose();
      assert.equal(refreshChatPrWatch({ pipelineId: 'aaaa0005', memberKey: null }), 0, 'a disposed card is not read again');
    } },
    { name: 'workspace run: one tooltip per member PR; a frame re-reads only its member', run: async () => {
      calls.length = 0;
      const card = buildPullRequestCard({ ...PR, state: 'applied', card: { ...PR.card, projectKey: 'workspaces/wk1', workspaceId: 'wk1', result: { url: 'https://x/pull/1', draft: false, existed: false,
        members: [{ url: 'https://x/pull/1', memberKey: 'api-11111111' }, { url: 'https://x/pull/2', memberKey: 'web-22222222' }] } } }, ctx);
      await tick(); await tick();
      assert.deepEqual([...card.el.querySelectorAll('.ask-prcard-link')].map((l) => l.title), ['PR #1 · watched', 'PR #2 · watch stopped']);
      calls.length = 0;
      assert.equal(refreshChatPrWatch({ pipelineId: 'aaaa0005', memberKey: 'web-22222222' }), 1);
      assert.deepEqual(calls, ['/api/pr/watch?id=aaaa0005&projectKey=workspaces%2Fwk1&memberKey=web-22222222']);
      card.dispose();
    } },
    { name: 'a PR the server cannot answer for (merged, closed) and a ctx without fetch: a plain PR tooltip, or none', run: async () => {
      views[''] = undefined;
      const card = buildPullRequestCard({ ...PR, state: 'applied', card: { ...PR.card, result: { url: 'https://x/pull/7' } } }, ctx);
      await tick(); await tick();
      assert.equal(card.el.querySelector('.ask-prcard-link').title, 'PR #7');
      card.dispose();
      const bare = buildPullRequestCard({ ...PR, state: 'applied', card: { ...PR.card, result: { url: 'https://x/pull/7' } } }, ctxOf().ctx);
      assert.equal(bare.el.querySelector('.ask-prcard-link').title, '');
    } },
  ]);
});

test('s5: an applied pull-request card carries the Ask for changes field while the gate is on; it posts the run ref', async () => {
  const { ctx } = ctxOf();
  const sent = [];
  ctx.postChanges = async (ref, text) => { sent.push([ref, text]); };
  const applied = { ...PR, state: 'applied', card: { ...PR.card, result: { url: 'https://x/pull/7' } } };
  assert.equal(buildPullRequestCard(applied, ctx).el.querySelector('.ask-changes'), null, 'gate off: no field');
  ctx.doc.documentElement.dataset.flags = 'shapeFirst';
  assert.equal(buildPullRequestCard(PR, ctx).el.querySelector('.ask-changes'), null, 'proposed: no field');
  const ws = { ...applied, card: { ...applied.card, workspaceId: 'ws_1' } };
  assert.equal(buildPullRequestCard(ws, ctx).el.querySelector('.ask-changes'), null, 'workspace run: no field');
  const { el } = buildPullRequestCard(applied, ctx);
  const input = el.querySelector('.ask-changes-input');
  input.value = 'make it blue'; input.dispatchEvent(new ctx.win.Event('input'));
  el.querySelector('.ask-changes-send').click(); await tick();
  assert.deepEqual(sent, [[{ pipelineId: 'aaaa0005' }, 'make it blue']]);
});
