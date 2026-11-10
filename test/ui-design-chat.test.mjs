// test/ui-design-chat.test.mjs — the Design chat's dock (ui/public/design/chat.mjs, createDesignChat) in jsdom over a
// fake fetch: the thread with the real ask-card grammar, mid-build questions, the round receipt row and its one action,
// pins, Build fast, and P4's Plan list in the thread.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createDesignChat } from '../ui/public/design/chat.mjs';
import { cssRules } from './helpers/css-rules.mjs';

const doms = [];
const docks = [];
afterEach(() => {
  for (const d of docks.splice(0)) d.destroy();
  for (const d of doms.splice(0)) d.window.close();
});
function rig() { const dom = new JSDOM('<!doctype html><html><body></body></html>'); doms.push(dom); return { doc: dom.window.document, win: dom.window }; }
const settle = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

const DID = 'd_00000000a001';
const Q = { id: 'tone', text: 'Which tone?', options: [{ value: 'plain', label: 'Plain' }, { value: 'bold', label: 'Bold', recommended: true }] };
let rowSeq = 0;
/** A finished assistant row holding these blocks. */
const assistantWith = (...blocks) => {
  rowSeq += 1;
  return { id: `msg_a${String(rowSeq).padStart(7, '0')}`, role: 'assistant', text: '', blocks, status: 'done' };
};

/**
 * The dock on a design row of `{id: DID, threadId: 'ask_00000001', kind: 'web', fast: false, status: 'done', version: 2,
 * ...o.design}`, its thread serving `o.messages`. Records `setPicks`, `unpins`, `confirms` (answering yes) and `restored`;
 * `posts` holds `{url, body}` per POST and `{url, method, body}` per other write, `gets` each GET's url. `o.restoreStatus`/`o.restoreError`
 * refuse the restore, `o.patchError` the Build fast PATCH; `o.confirm(opts)` answers the confirm instead of yes;
 * `o.withPlanList` passes a planList of `{ el: <div class="dz-plan-wrap"> }`. `send(text, {refuse})` types and presses
 * Send; `refuse` answers that message 409 with those words, and `o.refuse` every message from the start. `o.initial` is
 * the dock's `initial` (the Library's first message); `o.destroyNow` destroys the dock before its thread loads.
 * `o.renderMarkdown` draws a reply (default: its text); `md.calls` counts the draws.
 */
async function rigDock(o = {}) {
  const { doc, win } = rig();
  const host = doc.createElement('div');
  host.className = 'dz-chat-slot';
  doc.body.appendChild(host);
  const design = { id: DID, threadId: 'ask_00000001', kind: 'web', fast: false, status: 'done', version: 2, ...o.design };
  const posts = [];
  const gets = [];
  const setPicks = [];
  const unpins = [];
  const confirms = [];
  const restored = [];
  let refuse = o.refuse ?? null;
  let sent = 0;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === 'POST') posts.push({ url, body });
    else if (method !== 'GET') posts.push({ url, method, body });
    else gets.push(url);
    if (method === 'GET' && url === '/api/ask/models') return reply(200, { default: { model: 'm', effort: 'e' }, models: [] });
    if (method === 'GET' && url === `/api/ask/threads/${design.threadId}`) {
      return reply(200, { thread: { id: design.threadId, mode: 'design', title: 'Landing page', designId: DID }, messages: o.messages || [], attachments: [], runLinks: [], inFlight: null });
    }
    if (method === 'POST' && /\/messages$/.test(url)) {
      if (refuse) return reply(409, { error: refuse });
      sent += 1;
      return reply(202, { userMessageId: `msg_u${String(sent).padStart(7, '0')}`, assistantMessageId: `msg_b${String(sent).padStart(7, '0')}` });
    }
    if (method === 'POST' && /\/cards\/[^/]+$/.test(url)) return reply(200, { ok: true });
    if (method === 'POST' && /\/builds\/[^/]+\/answer$/.test(url)) return o.answer ? reply(o.answer.status, o.answer.body) : reply(200, { ok: true });
    if (method === 'POST' && /\/versions\/\d+\/restore$/.test(url)) {
      const status = o.restoreStatus || 200;
      return reply(status, status < 300 ? { ok: true, version: 3, restoredFrom: 1 } : { error: o.restoreError });
    }
    if (method === 'PATCH' && url === `/api/design/${DID}`) return o.patchError ? reply(409, { error: o.patchError }) : reply(200, { design: { ...design, ...body } });
    return reply(404, { error: 'no route' });
  };
  const md = { calls: 0 };
  const planList = o.withPlanList ? { el: Object.assign(doc.createElement('div'), { className: 'dz-plan-wrap' }) } : null;
  const dock = createDesignChat({
    doc, host, design, fetch, sendWs: () => {},
    renderMarkdown: (text, el) => { md.calls += 1; if (o.renderMarkdown) o.renderMarkdown(text, el); else el.textContent = text; },
    confirm: async (opts) => { confirms.push(opts); return o.confirm ? o.confirm(opts) : true; },
    setPick: (on) => { setPicks.push(on); },
    onRestored: (r) => { restored.push(r); },
    planList,
    unpin: (id, path) => { unpins.push([id, path]); },
    initial: o.initial,
  });
  docks.push(dock);
  if (o.destroyNow) dock.destroy();
  await settle();
  async function send(text, { refuse: why = null } = {}) {
    refuse = why;
    const input = host.querySelector('.dsc-input');
    input.value = text;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    host.querySelector('.dsc-send').click();
    await settle();
    refuse = null;
  }
  return { dock, host, doc, win, posts, gets, setPicks, unpins, confirms, restored, md, send, tick: () => settle() };
}

test('a chat question renders with the real ask-card grammar and answers through the card route', async () => {
  const { dock, host, posts, tick } = await rigDock({ messages: [assistantWith({ kind: 'card', id: 'card_00000001', state: 'asking', card: { type: 'design-questions', heading: 'Your turn', summary: 'Your turn', questions: [Q] } })] });
  const el = host.querySelector('section.chat-rc-q.chat-q');
  assert.equal(el.querySelector(':scope > h3.chat-rc-q-head').textContent, 'Your turn');
  assert.equal(el.querySelector('.qpanel').dataset.kind, 'clarify');
  el.querySelector('.qopt[data-value="plain"]').click();
  el.querySelector('[data-qpanel-submit]').click();
  await tick();
  assert.deepEqual(posts.at(-1), { url: '/api/ask/threads/ask_00000001/cards/card_00000001', body: { answers: [{ id: 'tone', value: 'plain' }] } });
  assert.ok(dock);
});
test('answered keeps the picks; closed reads Not answered', async () => {
  const { host } = await rigDock({ messages: [assistantWith(
    { kind: 'card', id: 'card_1', state: 'answered', card: { type: 'design-questions', heading: 'H', questions: [Q], answers: [{ id: 'tone', value: 'plain' }] } },
    { kind: 'card', id: 'card_2', state: 'closed', card: { type: 'design-questions', heading: 'H', questions: [Q] } })] });
  assert.ok(host.querySelector('.chat-q.is-answered .qopt.sel[data-value="plain"]'));
  assert.equal(host.querySelector('.chat-q.is-closed .chat-rc-receipt').textContent, 'Not answered');
});
test('a mid-build question uses the same card; a pick survives later frames; the answer goes to the build route', async () => {
  const { dock, host, posts, tick } = await rigDock({});
  dock.pushDesignFrame({ type: 'design-question', designId: DID, buildId: 'b_1', agentId: 'a_1', askId: 'as_1', job: 'Hero', heading: 'Hero needs a decision', questions: [Q] });
  await tick();
  const el = host.querySelector('section.chat-rc-q.chat-q');
  assert.equal(el.querySelector('.chat-rc-q-head').textContent, 'Hero needs a decision');
  assert.equal(el.querySelector('[data-qpanel-submit]').textContent, 'Send answer', 'the mockup\'s word for one question');
  el.querySelector('.qopt[data-value="plain"]').click();
  dock.pushDesignFrame({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_2', status: 'writing' });
  dock.pushAskFrame({ type: 'ask-title', threadId: 'ask_00000001', title: 'x' });
  await tick();
  assert.equal(host.querySelector('section.chat-rc-q.chat-q'), el, 'same element');
  assert.ok(el.querySelector('.qopt.sel'));
  el.querySelector('[data-qpanel-submit]').click();
  await tick();
  assert.deepEqual(posts.at(-1), { url: `/api/design/${DID}/builds/b_1/answer`, body: { askId: 'as_1', answers: [{ id: 'tone', value: 'plain' }] } });
  dock.pushDesignFrame({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_1', status: 'writing' });
  dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_1', status: 'done', stats: {} });
  await tick();
  assert.equal(host.querySelector('section.chat-rc-q'), null);
});
test('M1 and M2: the receipt row is one line with one action; no version UI and no Replay anywhere', async () => {
  const { dock, host, posts, confirms, restored, tick } = await rigDock({ messages: [assistantWith(
    { kind: 'card', id: 'card_1', state: 'done', card: { type: 'design-round', round: 1, baseVersion: 0, agents: 3, elapsedMs: 40000, costUsd: 1, costKnown: true, summary: 's' } },
    { kind: 'card', id: 'card_2', state: 'done', card: { type: 'design-round', round: 2, baseVersion: 1, agents: 12, elapsedMs: 374000, costUsd: 4.2, costKnown: true, summary: 's' } })] });
  const rows = host.querySelectorAll('.dsc-round');
  assert.equal(rows[1].querySelector('.dsc-round-text').textContent, 'Built by 12 agents in 6m 14s · $4.20');
  assert.equal(rows[0].querySelector('button'), null, 'nothing before round 1');
  assert.doesNotMatch(host.textContent, /Replay|Versions|Version \d/);
  rows[1].querySelector('button').click();
  await tick();
  assert.equal(confirms[0].confirmLabel, 'Go back');
  assert.deepEqual(posts.at(-1), { url: `/api/design/${DID}/versions/1/restore`, body: { round: 2 } });
  assert.deepEqual(restored, [{ version: 3, restoredFrom: 1 }]);
  dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_9', status: 'building', stats: {} });
  await tick();
  assert.equal(host.querySelector('.dsc-round button:not([disabled])'), null, 'no going back during a build');
});
test('a design whose build is open, paused included, offers no going back from the start', async () => {
  const { host } = await rigDock({ design: { status: 'paused' }, messages: [assistantWith({ kind: 'card', id: 'card_2', state: 'done', card: { type: 'design-round', round: 2, baseVersion: 1, agents: 1, elapsedMs: 1, costUsd: 0, costKnown: true, summary: 's' } })] });
  assert.equal(host.querySelector('.dsc-round button:not([disabled])'), null);
});
test('a refused restore shows inside its row', async () => {
  const { host, tick } = await rigDock({ restoreStatus: 404, restoreError: 'That version is no longer kept', messages: [assistantWith({ kind: 'card', id: 'card_2', state: 'done', card: { type: 'design-round', round: 2, baseVersion: 1, agents: 1, elapsedMs: 1, costUsd: 0, costKnown: true, summary: 's' } })] });
  host.querySelector('.dsc-round button').click();
  await tick();
  assert.equal(host.querySelector('.dsc-round .dsc-round-err').textContent, 'That version is no longer kept');
});
test('pins: a click becomes a chip, a hostile text stays text, six at most, cleared from dock and stage only once sent', async () => {
  const { dock, host, posts, tick, setPicks, send, unpins } = await rigDock({});
  host.querySelector('.dsc-point').click();
  assert.deepEqual(setPicks, [true]);
  dock.addPin({ id: 'hero', path: 'main > h1', tag: 'h1', text: '<img src=x onerror=alert(1)>', html: '<h1>', rect: [1, 2, 3, 4] });
  await tick();
  assert.deepEqual(setPicks, [true, false], 'one click, one pin');
  assert.equal(host.querySelector('.dsc-pin').textContent.includes('hero · h1'), true);
  assert.equal(host.querySelector('.dsc-pin img'), null);
  for (let i = 0; i < 6; i += 1) dock.addPin({ id: `s${i}`, path: 'p', tag: 'div', text: 't', html: 'h' });
  await tick();
  assert.equal(host.querySelectorAll('.dsc-pin').length, 6);
  assert.equal(host.querySelector('.dsc-note').textContent, 'At most 6 pins');
  assert.deepEqual(unpins, [['s5', 'p']], 'the refused seventh leaves the stage too');
  await send('Bolder', { refuse: 'Not sent' });
  assert.equal(host.querySelectorAll('.dsc-pin').length, 6, 'a refused send keeps them');
  assert.equal(unpins.length, 1);
  await send('Bolder');
  assert.equal(host.querySelectorAll('.dsc-pin').length, 0);
  assert.equal(unpins.length, 7, 'a sent pin\'s box leaves the stage: P4 keeps pins until unpin (stage-model.mjs:852-854)');
  assert.equal(posts.at(-1).body.design.pins.length, 6);
  assert.equal(host.querySelectorAll('.dsc-thread .dsc-sent-pin').length, 6, 'the sent row keeps its chips');
  assert.equal('rect' in posts.at(-1).body.design.pins[0], false);
});
test('Build fast is remembered on the design; message cost shows, unknown stays blank', async () => {
  const { host, posts, tick } = await rigDock({ messages: [{ id: 'm1', role: 'assistant', text: 'ok', blocks: [], status: 'done', costUsd: 0.03 }, { id: 'm2', role: 'assistant', text: 'ok', blocks: [], status: 'done', costUsd: null }] });
  const fast = host.querySelector('.dsc-fast input');
  assert.equal(host.querySelector('.dsc-fast-cap').textContent, 'up to 3', 'shown off too, as board BuildCalm (M6)');
  assert.equal(fast.checked, false);
  fast.click();
  await tick();
  assert.deepEqual(posts.at(-1), { url: `/api/design/${DID}`, method: 'PATCH', body: { fast: true } });
  assert.equal(host.querySelector('.dsc-fast-cap').textContent, 'up to 12');
  const costs = [...host.querySelectorAll('.dsc-cost')].map((n) => n.textContent);
  assert.deepEqual(costs, ['$0.03']);
});
test('the Plan list sits in the thread after the first user row, and a repaint keeps the same element', async () => {
  const { dock, host, tick } = await rigDock({ withPlanList: true, messages: [{ id: 'm0', role: 'user', text: 'A page', blocks: [], status: 'done' }, { id: 'm1', role: 'assistant', text: 'ok', blocks: [], status: 'done' }] });
  const el = host.querySelector('.dsc-thread > .dz-plan-wrap');
  assert.ok(el);
  assert.ok(el.previousElementSibling.textContent.includes('A page'));
  dock.repaint(); await tick();
  assert.equal(host.querySelector('.dsc-thread > .dz-plan-wrap'), el);
});
// rigDock passes unpin: (id, path) => unpins.push([id, path]), and with withPlanList a planList of { el: <div class="dz-plan-wrap"> }.
test('removing a pin chip also takes its box off the stage', async () => {
  const { dock, host, tick, unpins } = await rigDock({});
  dock.addPin({ id: 'hero', path: 'main > h1', tag: 'h1', text: 't', html: '<h1>' }); await tick();
  host.querySelector('.dsc-pin button').click(); await tick();
  assert.deepEqual(unpins, [['hero', 'main > h1']]);
  assert.equal(host.querySelector('.dsc-pin'), null);
});
test('a new round clears unsent chips and Point, as the stage does', async () => {
  const { dock, host, tick } = await rigDock({ design: { currentBuild: 'b_1' } });
  dock.addPin({ id: 'hero', path: 'h1', tag: 'h1', text: 't', html: 'h' });
  host.querySelector('.dsc-point').click();
  dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_1', status: 'done', stats: {} }); await tick();
  assert.equal(host.querySelectorAll('.dsc-pin').length, 1, 'frames of the build the dock opened on keep them');
  dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_2', status: 'planning', stats: {} }); await tick();
  assert.deepEqual([host.querySelector('.dsc-pin'), host.querySelector('.dsc-point').getAttribute('aria-pressed')], [null, 'false']);
});
test('css: no accent left edge on the dock', () => {
  for (const r of cssRules(readFileSync(new URL('../ui/public/design/design.css', import.meta.url), 'utf8')).filter((x) => /\.dsc-/.test(x.sel))) {
    assert.doesNotMatch(r.body, /border-left/, r.sel);
  }
});

// The guards the rows above leave open: each row below goes red when its guard is removed.
const ROUND_2 = { kind: 'card', id: 'card_2', state: 'done', card: { type: 'design-round', round: 2, baseVersion: 1, agents: 1, elapsedMs: 1, costUsd: 0, costKnown: true, summary: 's' } };
test('Back to before this: Stay posts nothing, two presses ask once, and a build that starts meanwhile wins', async () => {
  let answer = false;
  const r = await rigDock({ confirm: () => answer, messages: [assistantWith(ROUND_2)] });
  const restores = () => r.posts.filter((p) => /\/restore$/.test(p.url)).length;
  r.host.querySelector('.dsc-round button').click();
  await r.tick();
  assert.deepEqual([r.confirms.length, restores()], [1, 0], 'Stay');
  assert.ok(r.host.querySelector('.dsc-round button:not([disabled])'), 'the row offers it again');
  answer = true;
  r.host.querySelector('.dsc-round button').click();
  r.host.querySelector('.dsc-round button').click();
  await r.tick();
  assert.deepEqual([r.confirms.length, restores()], [2, 1], 'one question and one restore for two presses');
  let release = null;
  const held = await rigDock({ confirm: () => new Promise((res) => { release = res; }), messages: [assistantWith(ROUND_2)] });
  held.host.querySelector('.dsc-round button').click();
  held.dock.pushDesignFrame({ type: 'design-build', designId: 'd_00000000b002', buildId: 'b_8', status: 'building', stats: {} });
  await held.tick();
  assert.equal(held.host.querySelector('.dsc-round button').disabled, true, 'another design\'s build changes nothing here; the asked row waits');
  held.dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_9', status: 'building', stats: {} });
  release(true);
  await held.tick();
  assert.equal(held.posts.length, 0, 'no going back once a build started');
});
test('a pin landing twice stays one chip, with P4\'s label; a landed pin turns Point off', async () => {
  const { dock, host, tick, unpins } = await rigDock({});
  const p = { id: 'hero', path: 'main > h1', tag: 'h1', text: 't', html: '<h1>', label: 'Hero · h1' };
  host.querySelector('.dsc-point').click();
  dock.addPin(p);
  assert.equal(host.querySelector('.dsc-point').getAttribute('aria-pressed'), 'false');
  dock.addPin({ ...p });
  await tick();
  assert.equal(host.querySelectorAll('.dsc-pin').length, 1);
  assert.equal(host.querySelector('.dsc-pin').textContent, 'Hero · h1');
  assert.deepEqual(unpins, []);
});
test('the thread skips synthetic user rows and dividers; a zero cost shows none; with no user row the Plan list is first', async () => {
  const { host } = await rigDock({ withPlanList: true, messages: [
    { id: 'm0', role: 'user', text: 'event turn', blocks: [{ kind: 'notice', synthetic: true, text: 'answered' }], status: null },
    { id: 'm1', role: 'system', text: '', blocks: [{ kind: 'divider', text: 'Switched engine' }], status: 'done' },
    { id: 'm2', role: 'assistant', text: 'free', blocks: [], status: 'done', costUsd: 0 },
  ] });
  assert.deepEqual([...host.querySelector('.dsc-thread').children].map((n) => n.className), ['dz-plan-wrap', 'ask-msg dsc-reply']);
  assert.equal(host.querySelector('.dsc-cost'), null);
  assert.equal(host.querySelector('.dsc-input').placeholder, 'Ask for a change');
});
// p7t1 live proof: the restore route's notice row (ui/server.mjs postAskSystemNotice) holds its words twice, as text
// and as a notice block; the dock drew both. A system row is its blocks, its text only when it has none (ask-panel).
test('a notice worca posts after Back to before this reads once; a system row with only text reads as a notice', async () => {
  const { host } = await rigDock({ messages: [
    { id: 'm1', role: 'system', text: 'Back to before round 2', blocks: [{ kind: 'notice', text: 'Back to before round 2' }], status: 'done' },
    { id: 'm2', role: 'system', text: 'Back to an earlier version', blocks: [], status: 'done' },
  ] });
  assert.deepEqual([...host.querySelectorAll('.dsc-thread > .dsc-reply')].map((r) => [...r.children].map((n) => [n.className, n.textContent])), [
    [['dsc-notice dz-reply dz-reply-meta', 'Back to before round 2']],
    [['dsc-notice dz-reply dz-reply-meta', 'Back to an earlier version']],
  ]);
});
test('a refused Build fast flips back and says why; a refused send says why and keeps the text', async () => {
  const { host, tick, send } = await rigDock({ patchError: 'design not found' });
  const fast = host.querySelector('.dsc-fast input');
  fast.click();
  await tick();
  assert.deepEqual([fast.checked, host.querySelector('.dsc-fast-cap').textContent], [false, 'up to 3']);
  assert.equal(host.querySelector('.dsc-note').textContent, 'design not found');
  await send('Hi', { refuse: 'a reply is already running' });
  assert.equal(host.querySelector('.dsc-note').textContent, 'a reply is already running');
  assert.equal(host.querySelector('.dsc-input').value, 'Hi');
});
test('an answered build question stays answered when its agent moves on; another agent\'s closes as a receipt', async () => {
  const { dock, host, tick } = await rigDock({});
  dock.pushDesignFrame({ type: 'design-question', designId: DID, buildId: 'b_1', agentId: 'a_1', askId: 'as_1', job: 'Hero', heading: 'H1', questions: [Q] });
  dock.pushDesignFrame({ type: 'design-question', designId: DID, buildId: 'b_1', agentId: 'a_2', askId: 'as_2', job: 'Pricing', heading: 'H2', questions: [Q] });
  await tick();
  const first = host.querySelector('section.chat-rc-q');
  first.querySelector('.qopt[data-value="bold"]').click();
  first.querySelector('[data-qpanel-submit]').click();
  await tick();
  dock.pushDesignFrame({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_1', status: 'writing' });
  dock.pushDesignFrame({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_2', status: 'writing' });
  await tick();
  const cards = host.querySelectorAll('section.chat-rc-q');
  assert.ok(cards[0].matches('.is-answered') && cards[0].querySelector('.qopt.sel[data-value="bold"]'));
  assert.equal(cards[1].querySelector('.chat-rc-receipt').textContent, 'Closed: the agent moved on');
});
test('a build question answered with no key yet stays open and says so (P8 credential-missing)', async () => {
  const { dock, host, posts, tick } = await rigDock({ answer: { status: 409, body: { error: 'You have not added your key yet.', code: 'credential-missing' } } });
  dock.pushDesignFrame({ type: 'design-question', designId: DID, buildId: 'b_1', agentId: 'a_1', askId: 'as_1', job: 'Hero', heading: 'H1', questions: [Q] });
  await tick();
  const card = host.querySelector('section.chat-rc-q');
  card.querySelector('.qopt[data-value="bold"]').click();
  card.querySelector('[data-qpanel-submit]').click();
  await tick();
  assert.ok(posts.some((p) => /\/builds\/b_1\/answer$/.test(p.url)), 'the answer was sent');
  const now = host.querySelector('section.chat-rc-q');
  assert.equal(now.querySelector('.chat-rc-receipt'), null, 'not closed');
  const err = now.querySelector('.chat-rc-q-err');
  assert.deepEqual([err.hidden, err.textContent], [false, 'You have not added your key yet.']);
});
test('a running reply shows Stop in place of Send, Stop reaches the stop route, and the reply\'s cost shows once done', async () => {
  const { dock, host, posts, tick } = await rigDock({});
  const shown = () => [host.querySelector('.dsc-stop').hidden, host.querySelector('.dsc-send').hidden, host.querySelector('.dsc-act').hidden];
  dock.pushAskFrame({ type: 'ask-start', threadId: 'ask_00000001', messageId: 'msg_b0000009', userMessageId: 'msg_u0000009', seq: 1 });
  await tick();
  assert.deepEqual(shown(), [false, true, false]);
  host.querySelector('.dsc-stop').click();
  await tick();
  assert.equal(posts.at(-1).url, '/api/ask/threads/ask_00000001/stop');
  dock.pushAskFrame({ type: 'ask-done', threadId: 'ask_00000001', messageId: 'msg_b0000009', seq: 2, text: 'stopped', blocks: [], status: 'stopped', costUsd: 0.5 });
  await tick();
  assert.deepEqual(shown(), [true, false, true]);
  assert.equal(host.querySelector('.dsc-cost').textContent, '$0.50');
});
test('a picked file rides the next message and clears once it is in; a refused send keeps it', async () => {
  const { host, win, posts, send, tick } = await rigDock({});
  const picker = host.querySelector('.dsc-file-input');
  Object.defineProperty(picker, 'files', { value: [new win.File(['# hi'], 'notes.md', { type: 'text/markdown' })], configurable: true });
  picker.dispatchEvent(new win.Event('change'));
  await tick();
  await tick();
  assert.equal(host.querySelector('.dsc-files .ask-chip-name').textContent, 'notes.md');
  await send('Use this', { refuse: 'Not sent' });
  assert.equal(host.querySelectorAll('.dsc-files .ask-chip').length, 1);
  await send('Use this');
  assert.deepEqual(posts.at(-1).body.attachments.map((a) => a.name), ['notes.md']);
  assert.equal(host.querySelector('.dsc-files').hidden, true);
});
test('in the real app: a design with no thread GETs nothing for it, odd answers never throw, and the empty chat asks what to build', async () => {
  const { doc, win } = rig();
  const errors = [];
  win.addEventListener('error', (e) => { errors.push(e.message); });
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const urls = [];
  const fetch = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ config: { projects: [] } }) }; };
  const dock = createDesignChat({ doc, host, design: { id: DID, threadId: null, kind: 'web', status: 'done' }, fetch, sendWs: () => {} });
  docks.push(dock);
  await settle();
  assert.equal(host.querySelector('.dsc-input').placeholder, 'Describe what to build…');
  dock.onHello();
  dock.pushAskFrame({ type: 'ask-history-cleared' });
  dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 7, status: null });
  dock.addPin(null);
  dock.repaint();
  host.querySelector('.dsc-input').value = 'Hi';
  host.querySelector('.dsc-send').click();
  await settle();
  assert.equal(urls.some((u) => /\/api\/ask\/threads\/null/.test(u)), false);
  assert.equal(host.querySelector('.dsc-note').hidden, false, 'the refusal shows in the dock');
  assert.deepEqual(errors, []);
});
test('thread cards survive frames that change nothing they show; a design-delta repaints nothing; hello reloads the thread', async () => {
  const { dock, host, tick, gets } = await rigDock({ messages: [{ id: 'm0', role: 'user', text: 'A page', blocks: [], status: 'done' }, assistantWith(
    { kind: 'card', id: 'card_1', state: 'asking', card: { type: 'design-questions', heading: 'H', questions: [Q] } }, ROUND_2)] });
  const q = host.querySelector('section.chat-rc-q');
  const round = host.querySelector('.dsc-round');
  q.querySelector('.qopt[data-value="plain"]').click();
  dock.pushAskFrame({ type: 'ask-title', threadId: 'ask_00000001', title: 'x' });
  await tick();
  assert.equal(host.querySelector('section.chat-rc-q'), q, 'the same card');
  assert.equal(host.querySelector('.dsc-round'), round, 'the same receipt row');
  assert.ok(q.querySelector('.qopt.sel'));
  const user = host.querySelector('.dsc-user');
  dock.pushDesignFrame({ type: 'design-delta', designId: DID, buildId: 'b_1', agentId: 'a_1', sectionId: 'hero', text: 'x' });
  await tick();
  assert.equal(host.querySelector('.dsc-user'), user, 'no repaint');
  const before = gets.filter((u) => u === '/api/ask/threads/ask_00000001').length;
  dock.onHello();
  await tick();
  assert.equal(gets.filter((u) => u === '/api/ask/threads/ask_00000001').length, before + 1);
});
test('css: the input restates its focus over the global textarea rules', () => {
  const rules = cssRules(readFileSync(new URL('../ui/public/design/design.css', import.meta.url), 'utf8'));
  const focus = rules.find((r) => r.sel === '.dz-input:focus,.dz-input:focus-visible');
  assert.ok(focus && /outline:none;/.test(focus.body) && /background:transparent;/.test(focus.body), 'views.css textarea:focus (0,1,1) beats .dz-input');
});

// p7t1 board pass (plan Task 15 Step 6): the mockup's chat column (boards BuildCalm, Done, Change, Question) shows no
// tool line for the design tools; their receipt row, question card or notice stands for them.
test('the design tools leave no tool line: their receipt row or card stands for them; a failed one and other tools keep theirs', async () => {
  const { host } = await rigDock({ messages: [{ ...assistantWith(
    { kind: 'tool', id: 't1', name: 'mcp__worca__start_design_build', input: { brief: 'b' }, status: 'done' },
    { kind: 'card', id: 'card_1', state: 'running', card: { type: 'design-round', round: 1, baseVersion: 0, agents: 0, summary: 's' } },
    { kind: 'tool', id: 't2', name: 'mcp__worca__change_design', input: {}, status: 'running' },
    { kind: 'tool', id: 't3', name: 'mcp__worca__design_questions', input: {}, status: 'done' },
    { kind: 'tool', id: 't4', name: 'mcp__worca__get_design', input: {}, status: 'done' },
    { kind: 'tool', id: 't5', name: 'mcp__worca__change_design', input: {}, status: 'error', error: 'a build is running' },
  ), text: 'Changing the hero only.' }] });
  // The calls that remain fold into ONE row that says what they did in a sentence; nothing else of them shows.
  assert.deepEqual([...host.querySelector('.dsc-reply').children].map((n) => n.className), [
    'dsc-round dz-reply dz-reply-meta', 'dsc-steps dz-reply-meta', 'dsc-text dz-reply']);
  assert.equal(host.querySelector('.dsc-steps-text').textContent, 'Looked at the design and one more thing · 1 failed');
  assert.equal(host.querySelectorAll('.dsc-tool').length, 0, 'closed: no tool line');
});
test('a Simple dock gets the steps sentence alone, with nothing to open (tool rows are Advanced, as Ask\'s)', async () => {
  const { host, doc, dock, tick } = await rigDock({ messages: [{ ...assistantWith(
    { kind: 'tool', id: 't1', name: 'mcp__worca__get_design', input: {}, status: 'done' }), text: 'x' }] });
  doc.documentElement.dataset.level = 'simple';
  dock.repaint();
  await tick();
  assert.equal(host.querySelector('.dsc-steps-head').tagName, 'DIV');
  assert.equal(host.querySelector('.dsc-steps-chev'), null);
});
test('the folded steps row opens from Advanced on, shows each call, and stays open across a repaint', async () => {
  const { host, doc, dock, tick } = await rigDock({ messages: [{ ...assistantWith(
    { kind: 'tool', id: 't1', name: 'mcp__worca__get_design', input: {}, status: 'done' },
    { kind: 'tool', id: 't2', name: 'mcp__worca__read_attachment', input: { id: 'att_1' }, status: 'done' },
    { kind: 'tool', id: 't3', name: 'mcp__worca__read_attachment', input: { id: 'att_2' }, status: 'done' },
    { kind: 'tool', id: 't4', name: 'Read', input: {}, status: 'done' },
  ), text: 'A landing page.' }] });
  doc.documentElement.dataset.level = 'advanced';
  dock.repaint();
  await tick();
  const head = host.querySelector('button.dsc-steps-head');
  assert.equal(head.querySelector('.dsc-steps-text').textContent, 'Looked at the design, 2 attachments and a file');
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  head.click();
  await tick();
  assert.equal(host.querySelector('.dsc-steps-head').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...host.querySelectorAll('.dsc-steps-body .dsc-tool')].map((n) => n.textContent), ['get design', 'read attachment', 'read attachment', 'Read']);
  dock.pushAskFrame({ type: 'ask-title', threadId: 'ask_00000001', title: 'x' });
  await tick();
  assert.equal(host.querySelectorAll('.dsc-steps-body .dsc-tool').length, 4, 'still open');
});
test('a running build is told in sentences: milestones in the thread, what happens now on the composer line', async () => {
  const { host, dock, tick } = await rigDock({ design: { status: 'planning', currentBuild: 'b_1' }, messages: [] });
  const f = { designId: DID, buildId: 'b_1' };
  dock.pushDesignFrame({ ...f, type: 'design-build', status: 'planning', kind: 'first', waiting: 0 });
  dock.pushDesignFrame({ ...f, type: 'design-agent', agentId: 'a_l', role: 'lead', job: 'Lead', status: 'thinking' });
  await tick();
  assert.equal(host.querySelector('.dsc-act').hidden, false);
  assert.equal(host.querySelector('.dsc-act-l').textContent, 'The lead is planning the page…');
  assert.equal(host.querySelector('.dsc-build'), null, 'no milestone yet');
  dock.pushDesignFrame({ ...f, type: 'design-plan', planRev: 1, sections: [
    { id: 'hero', job: 'Hero', status: 'planned', parts: ['html'] }, { id: 'pricing', job: 'Pricing', status: 'planned', parts: ['html'] }] });
  dock.pushDesignFrame({ ...f, type: 'design-build', status: 'building', kind: 'first', waiting: 0 });
  dock.pushDesignFrame({ ...f, type: 'design-agent', agentId: 'a_1', role: 'builder', job: 'Hero', sectionId: 'hero', status: 'writing' });
  dock.pushDesignFrame({ ...f, type: 'design-section', sectionId: 'pricing', status: 'done', agentId: 'a_2', summary: 'Three tiers on a quiet grid' });
  await tick();
  assert.deepEqual([...host.querySelectorAll('.dsc-build-line')].map((n) => n.textContent),
    ['The lead planned 2 sections: Hero and Pricing.', 'Pricing: Three tiers on a quiet grid.']);
  assert.equal(host.querySelector('.dsc-act-l').textContent, 'One agent is working on Hero · 1 of 2 done…');
  dock.pushDesignFrame({ ...f, type: 'design-build', status: 'done', kind: 'first', waiting: 0 });
  await tick();
  assert.equal(host.querySelector('.dsc-build'), null, 'the receipt row speaks for a finished round');
  assert.equal(host.querySelector('.dsc-act').hidden, true);
});
// p7t1 live check: every design frame repainted the thread and pulled it to its end (a reader could not scroll up
// during a build), and a growing composer (a pin chip, a longer draft) hid the thread's last rows (board Done).
function geometry(host, h = 1000, c = 400) {
  const sc = host.querySelector('.dsc-scroll');
  const g = { h, c };
  Object.defineProperty(sc, 'scrollHeight', { configurable: true, get: () => g.h });
  Object.defineProperty(sc, 'clientHeight', { configurable: true, get: () => g.c });
  const scrollTo = (top, win) => { sc.scrollTop = top; sc.dispatchEvent(new win.Event('scroll')); };
  return { sc, g, scrollTo };
}
test('a reader scrolled up stays put while build frames arrive; sending brings the thread to its end', async () => {
  const { dock, host, win, tick, send } = await rigDock({ messages: [{ id: 'm0', role: 'user', text: 'A page', blocks: [], status: 'done' }] });
  const { sc, scrollTo } = geometry(host);
  scrollTo(0, win);
  dock.pushDesignFrame({ type: 'design-agent', designId: DID, buildId: 'b_1', agentId: 'a_1', status: 'writing' });
  dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_1', status: 'building' });
  await tick();
  assert.equal(sc.scrollTop, 0, 'a frame never pulls a reader down');
  await send('Make it bolder');
  assert.equal(sc.scrollTop, 1000, 'the person\'s own message is in view');
});
test('a thread read at its end stays there when the composer grows; a reader scrolled up is not moved', async () => {
  const { dock, host, win, tick } = await rigDock({ messages: [{ id: 'm0', role: 'user', text: 'A page', blocks: [], status: 'done' }] });
  const { sc, g, scrollTo } = geometry(host);
  scrollTo(600, win);
  g.c = 360;                                                   // a chip takes 40px of the column
  dock.addPin({ id: 'hero', path: 'main > h1', tag: 'h1', text: 't', html: '<h1>', label: 'Hero · h1' });
  await tick();
  assert.equal(sc.scrollTop, 1000, 'the chip does not hide the last rows');
  scrollTo(640, win);
  g.c = 330;                                                   // a second line of draft
  const input = host.querySelector('.dsc-input');
  input.value = 'Make Fleet the first card\nand show annual prices.';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(sc.scrollTop, 1000, 'a longer draft does not hide them either');
  scrollTo(100, win);
  g.c = 300;
  input.value = 'Make Fleet the first card\nand show annual prices,\nand keep the rest.';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(sc.scrollTop, 100, 'a reader scrolled up stays where they are');
});
test('a thread read at its end follows streamed text, a finished reply, a note and a removed file', async () => {
  const { dock, host, win, tick } = await rigDock({ patchError: 'design not found', messages: [{ id: 'm0', role: 'user', text: 'A page', blocks: [], status: 'done' }] });
  const sc = host.querySelector('.dsc-scroll');
  const thread = host.querySelector('.dsc-thread');
  let c = 400;
  // The thread grows with its text, so a repaint that adds words moves the end.
  Object.defineProperty(sc, 'scrollHeight', { configurable: true, get: () => 1000 + thread.textContent.length });
  Object.defineProperty(sc, 'clientHeight', { configurable: true, get: () => c });
  const atEnd = () => { sc.scrollTop = sc.scrollHeight - c; sc.dispatchEvent(new win.Event('scroll')); };
  dock.pushAskFrame({ type: 'ask-start', threadId: 'ask_00000001', messageId: 'msg_b0000009', userMessageId: 'msg_u0000009', seq: 1 });
  await tick();
  atEnd();
  dock.pushAskFrame({ type: 'ask-delta', threadId: 'ask_00000001', messageId: 'msg_b0000009', seq: 2, text: 'Changing the hero heading only.' });
  await tick();
  assert.equal(sc.scrollTop, sc.scrollHeight, 'streamed text');
  atEnd();
  dock.pushAskFrame({ type: 'ask-done', threadId: 'ask_00000001', messageId: 'msg_b0000009', seq: 3, text: 'Changing the hero heading only, and its subline.', blocks: [], status: 'done', costUsd: 0.02 });
  await tick();
  assert.equal(sc.scrollTop, sc.scrollHeight, 'a finished reply');
  atEnd();
  c = 380;                                                     // the refusal note takes a line above the box
  host.querySelector('.dsc-fast input').click();
  await tick();
  assert.equal(host.querySelector('.dsc-note').textContent, 'design not found');
  assert.equal(sc.scrollTop, sc.scrollHeight, 'a note');
  const picker = host.querySelector('.dsc-file-input');
  Object.defineProperty(picker, 'files', { value: [new win.File(['# hi'], 'notes.md', { type: 'text/markdown' })], configurable: true });
  picker.dispatchEvent(new win.Event('change'));
  await tick();
  await tick();
  atEnd();
  c = 420;                                                     // the file row goes away
  host.querySelector('.dsc-files .ask-chip-x').click();
  assert.equal(sc.scrollTop, sc.scrollHeight, 'a removed file');
});
test('css: the mockup chat column\'s head gap, flush reply paragraphs, and the ask card\'s block padding and question size', () => {
  const rules = cssRules(readFileSync(new URL('../ui/public/design/design.css', import.meta.url), 'utf8'));
  const body = (sel) => rules.find((r) => r.sel === sel)?.body ?? '';
  assert.match(body('.dz-chat .chat-head'), /gap:6px;/, 'canvas-src-design.css:17');
  assert.match(body('.dsc-text>:first-child'), /margin-top:0;/, '.ask-md p (ask-worca-live.css) adds 6px above the reply');
  assert.match(body('.dsc-text>:last-child'), /margin-bottom:0;/, '.ask-md p adds 6px below the reply');
  assert.match(body('.dz-chat .chat-rc-q .qblock'), /padding:14px;/, 'canvas-src-design.css:132');
  assert.match(body('.dz-chat .chat-rc-q .qtext'), /font-size:var\(--fs-body\);/, 'canvas-src-design.css:133');
});

/** A markdown stand-in that draws `[label](href)` as a link. */
const linkMd = (text, el) => {
  const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(text);
  if (!m) { el.textContent = text; return; }
  const a = el.ownerDocument.createElement('a');
  a.setAttribute('href', m[2]);
  a.textContent = m[1];
  el.replaceChildren(text.slice(0, m.index), a, text.slice(m.index + m[0].length));
};
const LINKED = [{ id: 'msg_u0000001', role: 'user', text: 'A page', blocks: [], status: 'done' },
  { id: 'msg_a0000901', role: 'assistant', text: 'Read [the brief](https://example.com/b) first.', blocks: [], status: 'done', costUsd: 0.02 }];
test('M5: build frames that change nothing the dock shows leave the thread, a reply\'s markdown and the focus in it alone', async () => {
  const { dock, host, doc, win, md, tick } = await rigDock({ renderMarkdown: linkMd, design: { status: 'building', currentBuild: 'b_1' }, messages: LINKED });
  const reply = host.querySelector('.dsc-reply');
  const link = reply.querySelector('a');
  link.focus();
  const calls = md.calls;
  let touched = 0;
  const mo = new win.MutationObserver((rs) => { touched += rs.length; });   // counted here: a callback takes the records
  mo.observe(host.querySelector('.dsc-thread'), { childList: true, subtree: true });
  const f = { designId: DID, buildId: 'b_1' };
  dock.pushDesignFrame({ ...f, type: 'design-file', path: 'index.html', sectionId: 'hero', part: 'html', rev: 2, sha256: 'x', bytes: 4, text: '<h1>' });
  dock.pushDesignFrame({ ...f, type: 'design-agent', agentId: 'a_1', status: 'writing' });
  dock.pushDesignFrame({ ...f, type: 'design-section', sectionId: 'hero', status: 'building', agentId: 'a_1', summary: '' });
  dock.pushDesignFrame({ ...f, type: 'design-build', status: 'building', stats: { agentsNow: 2 } });
  await tick();
  touched += mo.takeRecords().length;
  mo.disconnect();
  assert.equal(touched, 0, 'the thread was not touched');
  assert.equal(host.querySelector('.dsc-reply'), reply);
  assert.equal(doc.activeElement, link, 'the focus stays on the link');
  assert.equal(md.calls, calls, 'no markdown redone');
});
test('M5: a repaint keeps an unchanged reply (node, markdown, selection, focus); a changed reply and loaded markdown draw it again', async () => {
  const { dock, host, doc, md, tick } = await rigDock({ renderMarkdown: linkMd, messages: LINKED });
  const reply = host.querySelector('.dsc-reply');
  const link = reply.querySelector('a');
  link.focus();
  doc.getSelection().selectAllChildren(link);
  const calls = md.calls;
  dock.pushAskFrame({ type: 'ask-title', threadId: 'ask_00000001', title: 'x' });   // a frame that repaints the thread
  await tick();
  assert.equal(host.querySelector('.dsc-reply'), reply);
  assert.equal(md.calls, calls);
  assert.equal(doc.activeElement, link);
  assert.equal(String(doc.getSelection()), 'the brief', 'a repaint keeps a reader\'s selection');
  dock.pushAskFrame({ type: 'ask-message', threadId: 'ask_00000001', message: { ...LINKED[1], costUsd: 0.05 } });
  await tick();
  assert.notEqual(host.querySelector('.dsc-reply'), reply, 'a changed reply is drawn again');
  assert.equal(host.querySelector('.dsc-cost').textContent, '$0.05');
  const now = md.calls;
  dock.repaint();                                   // app.js: marked finished loading
  await tick();
  assert.equal(md.calls, now + 1, 'loaded markdown draws every reply again');
});
test('M5: a frame that changes what the dock shows still repaints: a build that ends brings Back, and so does a snapshot (minor 1)', async () => {
  const r = await rigDock({ design: { status: 'building', currentBuild: 'b_1' }, messages: [assistantWith(ROUND_2)] });
  assert.equal(r.host.querySelector('.dsc-back'), null);
  r.dock.pushDesignFrame({ type: 'design-build', designId: DID, buildId: 'b_1', status: 'done', stats: {} });
  await r.tick();
  assert.ok(r.host.querySelector('.dsc-back'), 'Back once the build ended');
  const s = await rigDock({ design: { status: 'building', currentBuild: 'b_1' }, messages: [assistantWith(ROUND_2)] });
  s.dock.pushDesignFrame({ type: 'design-snapshot', designId: DID, buildId: 'b_1', seq: 0, build: { status: 'done' }, questions: [] });
  await s.tick();
  assert.ok(s.host.querySelector('.dsc-back'), 'the snapshot\'s build.status counts');
});
test('M5: a reused reply keeps its clarifying card cached: a pick survives a later change to the reply', async () => {
  const card = { kind: 'card', id: 'card_1', state: 'asking', card: { type: 'design-questions', heading: 'H', questions: [Q] } };
  const row = { id: 'msg_a0000902', role: 'assistant', text: 'Pick one', blocks: [card], status: 'done' };
  const { dock, host, tick } = await rigDock({ messages: [row] });
  const q = host.querySelector('section.chat-rc-q');
  q.querySelector('.qopt[data-value="plain"]').click();
  dock.pushAskFrame({ type: 'ask-title', threadId: 'ask_00000001', title: 'x' });     // the reply is reused
  await tick();
  dock.pushAskFrame({ type: 'ask-message', threadId: 'ask_00000001', message: { ...row, costUsd: 0.05 } });   // then drawn again
  await tick();
  assert.equal(host.querySelector('section.chat-rc-q'), q, 'the same card element');
  assert.ok(q.querySelector('.qopt.sel'));
});
// A finished reply changes through `ask-message` only (what flipCard broadcasts): ask-model drops a job frame such as
// `ask-card` for a done row. Each push changes ONE field of the cached reply's signature (assistantRow), so a field
// left out of it keeps the old element and that step's assertion fails.
test('M5: a finished reply is drawn again when its card is answered or closed, or its text, status, stop reason or error changes', async () => {
  const card = { kind: 'card', id: 'card_1', state: 'asking', card: { type: 'design-questions', heading: 'H', summary: 'H', questions: [Q] } };
  let row = { id: 'msg_a0000904', role: 'assistant', text: 'Pick one', blocks: [card], status: 'done', reason: null };
  const { dock, host, tick } = await rigDock({ messages: [row] });
  const push = async (patch) => {
    row = { ...row, ...patch };
    dock.pushAskFrame({ type: 'ask-message', threadId: 'ask_00000001', message: row });
    await tick();
  };
  const err = () => host.querySelector('.dsc-reply .dsc-err')?.textContent ?? null;
  assert.ok(host.querySelector('section.chat-rc-q [data-qpanel-submit]'), 'asking: live buttons');
  await push({ blocks: [{ ...card, state: 'answered', card: { ...card.card, answers: [{ id: 'tone', value: 'bold' }] } }] });
  assert.ok(host.querySelector('.chat-q.is-answered .qopt.sel[data-value="bold"]'), 'answered: its pick shows');
  assert.equal(host.querySelector('[data-qpanel-submit]'), null, 'and no live buttons are left');
  await push({ blocks: [{ ...card, state: 'closed' }] });
  assert.equal(host.querySelector('.chat-q.is-closed .chat-rc-receipt')?.textContent, 'Not answered');
  await push({ text: 'Going with the bold tone.' });
  assert.equal(host.querySelector('.dsc-reply .dsc-text').textContent, 'Going with the bold tone.');
  assert.equal(err(), null);
  await push({ status: 'error' });
  assert.equal(err(), 'The reply failed.');
  await push({ reason: 'max_budget' });                       // before errorMessage: the error line prefers it
  assert.equal(err(), 'max_budget');
  await push({ errorMessage: 'The engine stopped answering' });
  assert.equal(err(), 'The engine stopped answering');
});
test('M5: a streaming reply shows its text as it comes; a snapshot of another build changes nothing', async () => {
  const { dock, host, tick } = await rigDock({ design: { status: 'building', currentBuild: 'b_1' }, messages: [assistantWith(ROUND_2)] });
  dock.pushAskFrame({ type: 'ask-start', threadId: 'ask_00000001', messageId: 'msg_b0000009', userMessageId: 'msg_u0000009', seq: 1 });
  dock.pushAskFrame({ type: 'ask-delta', threadId: 'ask_00000001', messageId: 'msg_b0000009', seq: 2, text: 'Changing the hero' });
  await tick();
  assert.equal(host.querySelector('.dsc-text').textContent, 'Changing the hero');
  dock.pushAskFrame({ type: 'ask-delta', threadId: 'ask_00000001', messageId: 'msg_b0000009', seq: 3, text: ' only.' });
  await tick();
  assert.equal(host.querySelector('.dsc-text').textContent, 'Changing the hero only.');
  dock.pushDesignFrame({ type: 'design-snapshot', designId: DID, buildId: 'b_0', seq: 0, build: { status: 'done' }, questions: [] });
  await tick();
  assert.equal(host.querySelector('.dsc-back'), null, 'an older build\'s snapshot says nothing of this round');
});
test('initial: the first message and its files go through the dock once; a refusal leaves it in the input', async () => {
  const file = { name: 'logo.png', bytes: 3, dataBase64: 'UE5H', attKind: 'image', mime: 'image/png' };
  const { host, posts, tick } = await rigDock({ initial: { text: 'A page', files: [file] } }); await tick();
  const sent = posts.filter((p) => /\/messages$/.test(p.url));
  assert.equal(sent.length, 1); assert.equal(sent[0].body.attachments[0].name, 'logo.png');
  const refused = await rigDock({ initial: { text: 'A page', files: [] }, refuse: 'You have not added your key yet.' }); await refused.tick();
  assert.equal(refused.host.querySelector('.dsc-input').value, 'A page');
  assert.equal(refused.host.querySelector('.dsc-note').textContent, 'You have not added your key yet.');
  assert.ok(host);
});
test('initial: the sent message leaves the input and its chips; a dock destroyed before its thread loads sends nothing', async () => {
  const file = { name: 'logo.png', bytes: 3, dataBase64: 'UE5H', attKind: 'image', mime: 'image/png' };
  const { host, posts, tick } = await rigDock({ initial: { text: 'A page', files: [file] } }); await tick();
  assert.deepEqual(posts.filter((p) => /\/messages$/.test(p.url)).map((p) => [p.body.text, p.body.attachments]), [['A page', [{ name: 'logo.png', dataBase64: 'UE5H' }]]]);
  assert.deepEqual([host.querySelector('.dsc-input').value, host.querySelectorAll('.dsc-files .ask-chip').length], ['', 0]);
  const gone = await rigDock({ initial: { text: 'A page', files: [] }, destroyNow: true }); await gone.tick();
  assert.deepEqual(gone.posts, []);
});

// 2026-11-10: design_questions' `fields` shape. The card is the ask-forms renderer inside the ask-card grammar.
const FORM = {
  answerSchema: { type: 'object', required: ['name', 'tone'], properties: {
    name: { type: 'string', maxLength: 2000 }, tone: { type: 'string', enum: ['calm', 'bold'] }, dark: { type: 'boolean', default: false } } },
  layout: [
    { widget: 'text', field: 'name', label: 'Product name' },
    { widget: 'select', field: 'tone', label: 'Tone', labels: { calm: 'Calm', bold: 'Bold' } },
    { widget: 'toggle', field: 'dark', label: 'Dark theme' },
    { widget: 'callout', text: 'You can change this later.', tone: 'info' },
  ],
};
test('a fields card: components in the ask-card grammar; local marks before it posts; then the values go up', async () => {
  const { host, win, posts, tick } = await rigDock({ messages: [assistantWith(
    { kind: 'card', id: 'card_00000009', state: 'asking', card: { type: 'design-questions', heading: 'A few things', form: FORM } })] });
  const card = host.querySelector('section.chat-rc-q.dsc-form');
  assert.equal(card.querySelector('.chat-rc-q-head').textContent, 'A few things');
  assert.ok(card.querySelector('.qpanel[data-kind="form"] .af-form'), 'the ask-forms tree, in a panel');
  assert.equal(card.querySelector('.qanswered').textContent, '0 of 2 answered');
  const go = card.querySelector('[data-qpanel-submit]');
  go.click();
  await tick();
  assert.equal(posts.filter((p) => /\/cards\//.test(p.url)).length, 0, 'nothing posted while a required field is empty');
  assert.ok([...card.querySelectorAll('.af-err')].some((n) => !n.hidden), 'the empty required fields are marked');
  const name = card.querySelector('input[type="text"], input:not([type])');
  name.value = 'Worca';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  [...card.querySelectorAll('.af-choice, .seg button, button')].find((b) => /Calm/.test(b.textContent)).click();
  await tick();
  assert.equal(card.querySelector('.qanswered').textContent, '2 of 2 answered');
  go.click();
  await tick();
  assert.deepEqual(posts.at(-1), { url: '/api/ask/threads/ask_00000001/cards/card_00000009', body: { answers: { name: 'Worca', tone: 'calm', dark: false } } });
});
test('an answered fields card stays with what was given, read-only, no footer; a closed one is one line', async () => {
  const { host } = await rigDock({ messages: [assistantWith(
    { kind: 'card', id: 'card_00000010', state: 'answered', card: { type: 'design-questions', heading: 'A few things', form: FORM, answers: { name: 'Worca', tone: 'bold', dark: true } } },
    { kind: 'card', id: 'card_00000011', state: 'closed', card: { type: 'design-questions', heading: 'More', form: FORM } })] });
  const [done, closed] = host.querySelectorAll('section.chat-rc-q');
  assert.ok(done.classList.contains('is-answered'));
  assert.ok(done.querySelector('.af-form.af-readonly'));
  assert.equal(done.querySelector('[data-qpanel-submit]'), null);
  assert.equal(done.querySelector('input').value, 'Worca');
  assert.equal(closed.querySelector('.chat-rc-receipt').textContent, 'Not answered');
});
