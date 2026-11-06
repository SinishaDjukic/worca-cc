// test/chat-freeform-e2e.test.mjs — freeform chat end to end through the REAL server wiring under WORCA_MOCK=1.
// The cases share state in file order (TH1 from case 2, TH2 from case 7, …): always run the whole file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { setMockChannelBehavior, mockInteractionReplies, clearMockInteractionReplies } from '../src/core/chat/channel-host.mjs';
import { findConversation, conversationForThread } from '../src/core/chat/conversations.mjs';
import { getDb, _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { MARK } from '../src/core/chat/receipts.mjs';
import { SAY } from '../src/core/chat/conversation-bridge.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';

process.env.WORCA_MOCK = '1';
useTempHome(after);

const NAME = 'fixture-chat';
const NAME2 = 'fixture-plain';
const NAME3 = 'fixture-live';   // case 35: an interactive channel that declares capabilities.liveStatus
const SCHEMA = ['botToken', 'allowedChatIds', 'allowedUserIds', 'freeformChat', 'chatMembers', 'worcaUrl', 'historyOnStart']
  .map((key) => ({ key, type: 'text', label: key, secret: key === 'botToken', required: key === 'botToken' }));
const CFG = { botToken: 'sekret', allowedChatIds: 'C1', freeformChat: 'on', chatMembers: 'U1=ada@example.com', worcaUrl: 'https://worca.example' };

export let mod, channelHost, _testing, srv, base, home, projectDir, projectKey;
const origCwd = process.cwd();
let cwdSandbox;

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']); g(['branch', 'dev']);
}

let nextId = 0;
let threadIdFor = () => 'TH1';
let sendHook = null;
const posts = [];
let reactHook = null;
const rxLog = [];   // every own-reaction call the mock worker accepted, with the post count at that moment
const typingLog = [];   // case 35: every typing start/stop the mock worker accepted
const behavior = {
  send: async (chatId, message, options) => {
    if (sendHook) { const r = await sendHook(chatId, message, options); if (r !== undefined) return r; }
    posts.push({ chatId, message, options: options || null });
    if (options?.thread) return { ok: true, detail: { threadId: threadIdFor(), messageIds: [`M${++nextId}`] } };
    if (options?.edit) return { ok: true, detail: { messageIds: [options.edit.messageId] } };
    return { ok: true, detail: { messageIds: [`M${++nextId}`] } };
  },
  react: async (r) => {
    if (reactHook) await reactHook(r);
    rxLog.push({ ...r, at: posts.length });
  },
  typing: async (t) => { typingLog.push({ ...t, at: posts.length }); },
};

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-ff-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  home = await mkdtemp(join(tmpdir(), 'worca-cc-ff-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME, engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{ id: 'main', platform: 'discord', module: './channel/worker.mjs', configSchema: SCHEMA,
      capabilities: { inbound: true, outbound: true, interactive: true }, attachmentHosts: ['cdn.discordapp.com', 'media.discordapp.net'] }],
  }));
  writeFileSync(join(cur, 'channel', 'worker.mjs'), 'export function createChannelWorker() { return { start() {}, stop() {}, send() {} }; }');
  // Case 18: a second, NON-interactive chat plugin (freeform configured on, so the server's interactive gate is what
  // keeps the bridge away from it).
  const cur2 = pluginCurrentDir(NAME2);
  mkdirSync(join(cur2, 'channel'), { recursive: true });
  writeFileSync(join(cur2, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME2, engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{ id: 'main', platform: 'discord', module: './channel/worker.mjs', configSchema: SCHEMA,
      capabilities: { inbound: true, outbound: true } }],
  }));
  writeFileSync(join(cur2, 'channel', 'worker.mjs'), 'export function createChannelWorker() { return { start() {}, stop() {}, send() {} }; }');
  const cur3 = pluginCurrentDir(NAME3);
  mkdirSync(join(cur3, 'channel'), { recursive: true });
  writeFileSync(join(cur3, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME3, engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{ id: 'main', platform: 'discord', module: './channel/worker.mjs', configSchema: SCHEMA,
      capabilities: { inbound: true, outbound: true, interactive: true, liveStatus: true } }],
  }));
  writeFileSync(join(cur3, 'channel', 'worker.mjs'), 'export function createChannelWorker() { return { start() {}, stop() {}, send() {} }; }');
  const lockRow = { repoUrl: 'https://example.test/f.git', subdir: '', pinnedSha: 'a'.repeat(40), version: null, enabled: true, installedAt: '2026-08-12T00:00:00.000Z' };
  // Case 31: the in-tree task-source fixture (mock mode serves its getTask without spawning it; ask-schedules does the same).
  const curSrc = pluginCurrentDir('mock-source');
  mkdirSync(curSrc, { recursive: true });
  writeFileSync(join(curSrc, 'worca-cc-plugin.json'), readFileSync(new URL('./fixtures/plugins/mock-source/worca-cc-plugin.json', import.meta.url)));
  writePluginsLock({ [NAME]: lockRow, [NAME2]: { ...lockRow, repoUrl: 'https://example.test/g.git' }, [NAME3]: { ...lockRow, repoUrl: 'https://example.test/l.git' },
    'mock-source': { ...lockRow, repoUrl: 'https://example.test/s.git' } });
  writePluginConfig(NAME, SCHEMA, CFG);
  writePluginConfig(NAME3, SCHEMA, { ...CFG, allowedChatIds: 'L1' });
  writePluginConfig(NAME2, SCHEMA, { ...CFG, allowedChatIds: 'P1' });
  setMockChannelBehavior({ '*': behavior });
  mod = await import('../ui/server.mjs');
  ({ _testing } = mod);
  ({ channelHost } = _testing);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  channelHost.start();
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-ff-proj-'));
  gitInit(projectDir);
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'demo', path: projectDir });
  projectKey = (await listProjects()).find((p) => p.path === projectDir).key;
});

after(async () => {
  for (const [, job] of _testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  for (const r of mod.runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
  mod.runs.clear();
  await channelHost?.stop();
  await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  process.chdir(origCwd);
  closeDbForTests();
  const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  await reap(cwdSandbox); await reap(home); await reap(projectDir);
  delete process.env.WORCA_MOCK;
});

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
function waitFor(pred, timeoutMs = 10000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      let v; try { v = pred(); } catch { v = null; }
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
const say = (text, { chatId = 'TH1', userId = 'U1', id = `msg${++nextId}`, mention = false } = {}) => {
  channelHost.injectInboundMessage(NAME, 'main', { chatId, userId, text, meta: { platform: 'discord', messageId: id, guildId: 'G1', isGroup: true, mentionsBot: mention, botId: 'BOT1' } });
  return id;
};
const click = (ref, { chatId = 'TH1', userId = 'U1', kind = 'button', values, fields, id = `int${++nextId}` } = {}) => {
  channelHost.injectInteraction(NAME, 'main', { id, chatId, userId, ref, kind, ...(values ? { values } : {}), ...(fields ? { fields } : {}), meta: { platform: 'discord' } });
  return id;
};
const textOf = (p) => (p.message.body || []).map((b) => b.value ?? b.text ?? '').join('\n');
const fromWorcaPosts = (chatId = 'TH1') => posts.filter((p) => p.chatId === chatId && JSON.stringify(p.message.body).includes('(from worca)'));
const refOf = (label) => { for (const p of posts.slice().reverse()) for (const c of p.message.controls || []) if (c.label === label || c.placeholder?.startsWith(label)) return c.ref; return null; };
const replies = () => mockInteractionReplies();
const binding = (chatId = 'TH1') => findConversation({ plugin: NAME, channelId: 'main', chatId });
const ask = async () => import('../src/core/ask/store.mjs');
const idle = (threadId) => waitFor(() => !_testing.askJobs.get(threadId) || _testing.askJobs.get(threadId).status !== 'running');
const writeCfg = (patch) => writePluginConfig(NAME, SCHEMA, { ...CFG, ...patch });
/** The bot's reactions now on a message (replays its PUT/DELETE calls in order). */
const marksOn = (messageId) => { const s = new Set(); for (const r of rxLog) if (r.messageId === messageId) { if (r.on) s.add(r.emoji); else s.delete(r.emoji); } return [...s].sort(); };
const opsOn = (messageId) => rxLog.filter((r) => r.messageId === messageId).map((r) => `${r.on ? '+' : '-'}${r.emoji}`);
const opAt = (messageId, emoji) => rxLog.find((r) => r.messageId === messageId && r.on && r.emoji === emoji)?.at ?? -1;

export const H = { NAME, SCHEMA, CFG, posts, say, click, textOf, fromWorcaPosts, refOf, replies, binding, ask, idle, waitFor, settle, writeCfg,
  get mod() { return mod; }, get t() { return _testing; }, get projectKey() { return projectKey; }, get projectDir() { return projectDir; }, get base() { return base; },
  rxLog, setReactHook: (fn) => { reactHook = fn; },
  setThreadId: (fn) => { threadIdFor = fn; }, setSendHook: (fn) => { sendHook = fn; }, clearMockInteractionReplies, conversationForThread, getDb };

// 1: plain chatter in an allowed channel starts nothing; a slash command still answers.
test('1. chatter ignored, command unchanged', async () => {
  _testing.chatBridge.resetRateLimits();
  const before = posts.length;
  say('hello all', { chatId: 'C1' });
  await settle(80);
  assert.equal(posts.length, before);
  say('/help', { chatId: 'C1' });
  await waitFor(() => posts.length > before);
  assert.match(textOf(posts.at(-1)), /Worca chat commands/);
});

// 2: a bot mention opens a platform thread, binds it to a new Ask thread for the mapped identity, and replies there.
test('2. mention starts a bound thread + reply', async () => {
  _testing.chatBridge.resetRateLimits();
  const mid = say('<@BOT1> what is running?', { chatId: 'C1', mention: true });
  const b = await waitFor(() => binding());
  const first = posts.find((p) => p.options?.thread);
  assert.equal(first.options.thread.fromMessageId, mid);
  assert.equal(b.ownerUserId, 'U1');
  assert.equal(b.worcaIdentity, 'ada@example.com');
  const { getThread, listMessages } = await ask();
  assert.equal(getThread(b.askThreadId).createdBy, 'ada@example.com');
  await waitFor(() => posts.some((p) => p.chatId === 'TH1' && textOf(p).includes('[mock] what is running?')));
  assert.ok(!posts.some((p) => p.chatId === 'TH1' && textOf(p).includes('<@BOT1>')));
  const header = posts.filter((p) => p.options?.edit?.messageId === b.headerMessageId).at(-1);
  const kinds = header.message.controls.map((c) => c.label || c.placeholder);
  assert.ok(kinds.some((k) => /^Scope/.test(k)) && kinds.includes('New conversation') && kinds.includes('Stop') && kinds.includes('Open in worca'), kinds.join());
  assert.equal(header.message.controls.find((c) => c.label === 'Open in worca').url, `https://worca.example/#chat/${b.askThreadId}`);
  assert.deepEqual(fromWorcaPosts(), []);
  const user = listMessages(b.askThreadId).find((m) => m.role === 'user');
  assert.ok(getDb().prepare("SELECT 1 FROM chat_deliveries WHERE ask_message_id = ? AND part = 'chat'").get(user.id));
});

// 1b (runs after 2: it needs the bound thread): a slash command typed in the thread acts for the parent chat, no turn.
test('1b. command inside a bound thread acts for the parent chat', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const n = (await ask()).listMessages(b.askThreadId).length;
  const before = posts.length;
  say('/status');
  await waitFor(() => posts.slice(before).some((p) => p.chatId === 'TH1'));
  await settle(50);
  const mine = posts.slice(before);
  assert.equal(mine.length, 1, JSON.stringify(mine));
  assert.equal(mine[0].chatId, 'TH1');
  assert.equal(mine[0].options, null);
  assert.doesNotMatch(textOf(mine[0]), /Unknown command|not allowed/);
  assert.equal((await ask()).listMessages(b.askThreadId).length, n);
  assert.ok(!_testing.askJobs.get(b.askThreadId) || _testing.askJobs.get(b.askThreadId).status !== 'running');
});

// 2c: a failed thread creation is always reported (never throttled) and leaves no Ask thread or binding.
test('2c. thread-creation failures are never throttled', async () => {
  _testing.chatBridge.resetRateLimits();
  const threads0 = countOf('ask_threads');
  const convs0 = countOf('chat_conversations');
  H.setSendHook(async (_chatId, _message, options) => { if (options?.thread) throw { kind: 'forbidden' }; return undefined; });
  try {
    const before = posts.length;
    const tries = [say('<@BOT1> first try', { chatId: 'C1', mention: true }), say('<@BOT1> second try', { chatId: 'C1', mention: true })];
    await waitFor(() => posts.slice(before).filter((p) => p.chatId === 'C1').length >= 2);
    await settle(50);
    const warns = posts.slice(before).filter((p) => p.chatId === 'C1');
    assert.equal(warns.length, 2);
    for (const w of warns) assert.match(w.message.body[0].value, /^That did not work:/);
    for (const id of tries) { await waitFor(() => marksOn(id).includes(MARK.fail)); assert.deepEqual(opsOn(id), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.fail}`]); }
    assert.equal(countOf('ask_threads'), threads0);
    assert.equal(countOf('chat_conversations'), convs0);
  } finally { H.setSendHook(null); }
});

// 2d: a binding write that fails (the platform returns a thread id that is already bound) leaves no orphan Ask thread and warns the parent chat once.
test('2d. binding write fails: one warning, no orphan thread', async () => {
  _testing.chatBridge.resetRateLimits();
  const b0 = binding();
  const threads0 = countOf('ask_threads');
  const convs0 = countOf('chat_conversations');
  H.setThreadId(() => 'TH1');   // TH1 is bound since case 2: UNIQUE(plugin, channel_id, chat_id) refuses the insert
  try {
    const before = posts.length;
    const warnsInC1 = () => posts.slice(before).filter((p) => p.chatId === 'C1' && !p.options);
    await seen(say('<@BOT1> one more thread', { chatId: 'C1', mention: true }));
    await waitFor(() => posts.slice(before).some((p) => p.chatId === 'C1' && p.options?.thread));
    await waitFor(() => warnsInC1().length, 3000).catch(() => null);
    await settle(50);
    assert.equal(warnsInC1().length, 1, JSON.stringify(warnsInC1().map(textOf)));
    assert.match(warnsInC1()[0].message.body[0].value, /^That did not work:/);
    assert.equal(countOf('ask_threads'), threads0, 'the new Ask thread was deleted');
    assert.equal(countOf('chat_conversations'), convs0);
    assert.deepEqual(binding(), b0, 'the existing TH1 binding is unchanged');
  } finally { H.setThreadId(() => 'TH1'); }
});

// 3: multi-turn history keeps one session; a browser message is echoed once "(from worca)"; page context is stripped.
test('3. multi-turn history, from-worca echo, page context stripped', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  const { listMessages, getThread, updateThread } = await ask();
  await idle(b.askThreadId);
  say('second message');
  await waitFor(() => listMessages(b.askThreadId).filter((m) => m.role === 'assistant' && m.status === 'done').length >= 2);
  const ms = listMessages(b.askThreadId);
  assert.equal(ms.filter((m) => m.role === 'user').length, 2);
  assert.equal(getThread(b.askThreadId).sessionId, 'mock-session-ask-1');
  assert.deepEqual(fromWorcaPosts(), []);
  await idle(b.askThreadId);
  const r = await fetch(`${base}/api/ask/threads/${b.askThreadId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'from the browser', model: 'claude-opus-5-5', effort: 'high' }) });
  assert.equal(r.status, 202, await r.text());
  await waitFor(() => fromWorcaPosts().length === 1);
  assert.match(textOf(fromWorcaPosts()[0]), /\*\(from worca\)\* from the browser/);
  await idle(b.askThreadId);
  await settle(100);
  assert.equal(fromWorcaPosts().length, 1);
  updateThread(b.askThreadId, { context: { pinned: false, view: 'running', runPage: 'diff', runId: 'r-x', timeZone: 'Europe/Berlin' } });
  const n = listMessages(b.askThreadId).length;
  say('third');
  await waitFor(() => listMessages(b.askThreadId).length >= n + 2);
  await idle(b.askThreadId);
  assert.deepEqual(Object.keys(getThread(b.askThreadId).context).sort(), ['pinned', 'timeZone']);
});

// ── helpers ─────────────────────────────────────────────────────────────────
// Posts and refs: postsMatching(chat, re) = every post (edits too) in a chat whose text matches; newPostsIn(chat) =
// the chat's posts that are not edits; refOnPost(post, label) = a control ref on that one post; latestRefIn(label, chat)
// = the newest ref with that label in that chat (refOf in the harness searches every chat).
// Rows: cardBlocks(thread) = every card block in a thread; userRowCount(thread) = its user rows.
const askStore = await import('../src/core/ask/store.mjs');
const cardBlocks = (threadId) => askStore.listMessages(threadId).flatMap((m) => (m.blocks || []).filter((b) => b && b.kind === 'card'));
const lastCard = (threadId, pred = () => true) => cardBlocks(threadId).filter(pred).at(-1) || null;
const userRowCount = (threadId) => askStore.listMessages(threadId).filter((m) => m.role === 'user').length;
const asstRows = (threadId) => askStore.listMessages(threadId).filter((m) => m.role === 'assistant').length;
const newPostsIn = (chatId = 'TH1') => posts.filter((p) => p.chatId === chatId && !p.options?.edit);
const latestRefIn = (label, chatId = 'TH1') => { for (const p of posts.slice().reverse()) { if (p.chatId !== chatId) continue; for (const c of p.message.controls || []) if (c.label === label || c.placeholder?.startsWith(label)) return c.ref; } return null; };
const newTurn = (threadId, prev) => waitFor(() => { const t = _testing.askJobs.get(threadId)?.turn; return t && t !== prev && t; });
const replyAfter = (n) => waitFor(() => replies().length > n && replies().at(-1).text);
async function blockBudget() {
  const { setTotalCostLimitUsd } = await import('../src/core/settings.mjs');
  const { recordAskCostDelta, budgetStatus } = await import('../src/core/cost-budget.mjs');
  await setTotalCostLimitUsd(1);
  if (!budgetStatus().blocked) recordAskCostDelta({ threadId: binding().askThreadId, messageId: 'msg_budget01', amountUsd: 1.5 });
  assert.equal(budgetStatus().blocked, true, 'fixture: budget blocked');
}
async function unblockBudget() { const { setTotalCostLimitUsd } = await import('../src/core/settings.mjs'); await setTotalCostLimitUsd(null); }
const seen = (id) => waitFor(() => getDb().prepare('SELECT 1 FROM chat_inbound_seen WHERE event_id = ?').get('m:' + id));
const countOf = (table) => getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const replyTo = (iid) => waitFor(() => replies().find((r) => r.interactionId === iid));
const controlsOf = (p) => (p?.message?.controls || []).map((c) => c.label || c.placeholder);
const deliveredId = (cardId) => getDb().prepare('SELECT platform_message_id AS id FROM chat_deliveries WHERE part = ?').get(`card:${cardId}`)?.id || null;
const cardRefs = (cardId) => new Set(getDb().prepare('SELECT ref FROM chat_controls WHERE card_id = ?').all(cardId).map((r) => r.ref));
/** The newest post showing this card: a post carrying one of its refs, or an edit of its delivered message. */
function cardPost(cardId) {
  const refs = cardRefs(cardId); const mid = deliveredId(cardId);
  for (const p of posts.slice().reverse()) {
    if (mid && p.options?.edit?.messageId === mid) return p;
    if ((p.message.controls || []).some((c) => refs.has(c.ref))) return p;
  }
  return null;
}
const refOnPost = (p, label) => (p?.message?.controls || []).find((c) => c.label === label)?.ref || null;
const cardOf = async (tid, cardId) => (await ask()).findCard(tid, cardId)?.block || null;
const postsMatching = (chatId, re) => posts.filter((p) => p.chatId === chatId && re.test(textOf(p)));
function autoAnswerRun(runId) {
  let stopped = false; let last = null;
  const tick = async () => {
    if (stopped) return;
    const pq = mod.runs.get(runId)?.pendingQuestion;
    if (pq && pq !== last) {
      last = pq;
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      try { await fetch(`${base}/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, id: pq.id, payload }) }); } catch { /* run gone */ }
    }
    if (!stopped) { const t = setTimeout(tick, 25); t.unref?.(); }
  };
  const t0 = setTimeout(tick, 25); t0.unref?.();
  return () => { stopped = true; };
}
let seedSeq = 0;
/** A run card built by the REAL validator, appended to the thread, delivered by reconcile. */
async function seedCard(conv, input) {
  const { validateProposal } = await import('../src/core/ask/proposal.mjs');
  const cardId = `card_${String(++seedSeq).padStart(4, '0')}ab0${seedSeq}`.slice(0, 13);
  const v = await validateProposal(input, { cardId });
  assert.ok(v.ok, JSON.stringify(v));
  (await ask()).appendMessage(conv.askThreadId, { role: 'assistant', status: 'done', text: '', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card: v.card }] });
  await _testing.chatBridge.reconcile(conv);
  return { cardId, v };
}
async function openConversation(threadId) {
  H.setThreadId(() => threadId);
  try { say('<@BOT1>', { chatId: 'C1', mention: true }); return await waitFor(() => binding(threadId)); }
  finally { await settle(30); H.setThreadId(() => 'TH1'); }
}
let case6StartRef = null;

// 3b: a chat message un-archives an archived bound thread.
test('3b. a chat message un-archives the thread', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  askStore.setArchived(b.askThreadId, true);
  assert.ok(askStore.getThread(b.askThreadId).archivedAt);
  const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
  say('back again');
  await newTurn(b.askThreadId, prevT);
  await idle(b.askThreadId);
  assert.equal(askStore.getThread(b.askThreadId).archivedAt ?? null, null);
});

// 4: the same platform message delivered twice runs one turn and gets no "still replying".
test('4. duplicate delivery → one turn', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const u0 = userRowCount(b.askThreadId);
  const before = posts.length;
  say('dup message', { id: 'dup-1' });
  say('dup message', { id: 'dup-1' });
  await waitFor(() => posts.slice(before).some((p) => textOf(p).includes('[mock] dup message')));
  await idle(b.askThreadId);
  await settle(50);
  assert.equal(userRowCount(b.askThreadId), u0 + 1);
  assert.ok(!posts.slice(before).some((p) => /still replying/.test(textOf(p))), 'the duplicate was answered "still replying"');
  assert.equal(posts.slice(before).filter((p) => textOf(p).includes('[mock] dup message')).length, 1);
});

// 5: a non-member is told once per chat, starts nothing, is ignored in a bound thread, and cannot press its buttons.
test('5. unauthorized', async () => {
  _testing.chatBridge.resetRateLimits();
  const threads0 = countOf('ask_threads');
  const before = posts.length;
  say('<@BOT1> hi', { chatId: 'C1', userId: 'U9', mention: true });
  await waitFor(() => posts.slice(before).some((p) => p.chatId === 'C1'));
  await settle(50);
  let mine = posts.slice(before).filter((p) => p.chatId === 'C1');
  assert.equal(mine.length, 1);
  assert.match(textOf(mine[0]), /not set up for worca chat/);
  assert.equal(countOf('ask_threads'), threads0);
  await seen(say('<@BOT1> hi', { chatId: 'C1', userId: 'U9', mention: true }));
  await settle(50);
  mine = posts.slice(before).filter((p) => p.chatId === 'C1');
  assert.equal(mine.length, 1, 'the second not-member warning was not throttled');
  assert.equal(countOf('ask_threads'), threads0);
  const b = binding();
  await idle(b.askThreadId);
  const u0 = userRowCount(b.askThreadId);
  const before2 = posts.length;
  await seen(say('hi', { userId: 'U9' }));
  await settle(50);
  assert.equal(posts.length, before2);
  assert.equal(userRowCount(b.askThreadId), u0);
  clearMockInteractionReplies();
  click(refOf('Stop'), { userId: 'U9' });
  await waitFor(() => replies().length);
  assert.match(replies()[0].text, /^Only <@U1> can act/);
});

// 5b: a sender outside allowedUserIds is ignored silently, both at the mention and in the thread.
test('5b. allowedUserIds applies, silently', async () => {
  _testing.chatBridge.resetRateLimits();
  writeCfg({ allowedUserIds: 'U7' });
  try {
    const threads0 = countOf('ask_threads');
    const b = binding();
    await idle(b.askThreadId);
    const u0 = userRowCount(b.askThreadId);
    const before = posts.length;
    await seen(say('<@BOT1> hi', { chatId: 'C1', mention: true }));
    await settle(50);
    assert.equal(posts.length, before);
    assert.equal(countOf('ask_threads'), threads0);
    await seen(say('hi'));
    await settle(50);
    assert.equal(posts.length, before);
    assert.equal(userRowCount(b.askThreadId), u0);
    clearMockInteractionReplies();
    click(refOf('Stop'));
    await waitFor(() => replies().length);
    assert.match(replies()[0].text, /not set up for worca chat/);
  } finally { writeCfg({ allowedUserIds: null }); }   // writePluginConfig MERGES: only null clears a key
});

// 5c: freeform off: only the owner is told; strangers and non-allowed senders get nothing; no turn.
test('5c. freeform off: only the owner is told', async () => {
  _testing.chatBridge.resetRateLimits();
  writeCfg({ freeformChat: 'off' });
  try {
    const b = binding();
    await idle(b.askThreadId);
    const u0 = userRowCount(b.askThreadId);
    const before = posts.length;
    await seen(say('hi', { userId: 'U9' }));
    await settle(50);
    assert.equal(posts.length, before);
    // A sender outside Allowed user IDs first (the off notice is throttled per chat/user/reason, so asking the
    // owner second would hide a refusal() that answers 'off' before 'not-sender').
    writeCfg({ freeformChat: 'off', allowedUserIds: 'U7' });
    await seen(say('hi again'));
    await settle(50);
    assert.equal(posts.length, before);
    assert.equal(userRowCount(b.askThreadId), u0);
    writeCfg({ freeformChat: 'off', allowedUserIds: null });
    await seen(say('hi'));
    await waitFor(() => posts.length > before);
    await settle(50);
    assert.equal(posts.length, before + 1);
    assert.match(textOf(posts.at(-1)), /turned off/);
    assert.equal(userRowCount(b.askThreadId), u0);
  } finally { writeCfg({ allowedUserIds: null }); }   // writePluginConfig MERGES: only null clears a key
});

// 6: the header Scope select pins a project; a proposal card's Start run starts the run as the bound identity; status notices follow.
test('6. header scope pin, proposal, Start run, status notices', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const i0 = click(refOf('Scope'), { kind: 'select', values: [`p:${projectKey}`] });
  assert.equal((await replyTo(i0)).text, 'Scope: demo');
  const { getThread, listMessages } = await ask();
  assert.equal(getThread(b.askThreadId).context.projectKey, projectKey);
  say('propose a run to fix the login bug');
  const blk = await waitFor(() => listMessages(b.askThreadId).flatMap((m) => m.blocks || []).find((x) => x && x.kind === 'card' && x.state === 'proposed' && /login bug/.test(x.card?.brief || '')));
  await idle(b.askThreadId);
  assert.equal(blk.card.projectKey, projectKey);
  await waitFor(() => deliveredId(blk.id));
  const cp = cardPost(blk.id);
  assert.deepEqual(controlsOf(cp), ['Start run', 'Not now', 'Request changes', 'Open in worca']);
  case6StartRef = refOf('Start run');
  assert.equal(case6StartRef, refOnPost(cp, 'Start run'));
  const runsBefore = mod.runs.size;
  const i1 = click(case6StartRef);
  assert.match((await replyTo(i1)).text, /^Done/);
  const started = await cardOf(b.askThreadId, blk.id);
  assert.equal(started.state, 'started');
  assert.ok(started.runId);
  const pid = await waitFor(() => mod.runs.get(started.runId)?.pipelineId);
  const pipelineRow = await waitFor(() => getDb().prepare('SELECT started_by FROM pipelines WHERE id = ?').get(pid));
  assert.equal(pipelineRow.started_by, 'ada@example.com');   // the bound identity starts the run
  assert.equal(mod.runs.size, runsBefore + 1);
  assert.ok(listMessages(b.askThreadId).some((m) => m.role === 'system' && /^Run started: /.test(m.text)));
  const mid = deliveredId(blk.id);
  const edit = await waitFor(() => posts.filter((p) => p.options?.edit?.messageId === mid && /Run started/.test(textOf(p))).at(-1));
  assert.ok(!controlsOf(edit).includes('Start run'), controlsOf(edit).join());
  await waitFor(() => postsMatching('TH1', /Run started: /).length);
  const stop = autoAnswerRun(started.runId);
  try { await waitFor(() => postsMatching('TH1', /Run finished/).length, 30000); } finally { stop(); }
});

// 6b: a No-project card from the real validator starts a no-project run in its own thread (TH3).
test('6b. No-project Start via the real validator', async () => {
  _testing.chatBridge.resetRateLimits();
  const b3 = await openConversation('TH3');
  const { validateProposal } = await import('../src/core/ask/proposal.mjs');
  const v = await validateProposal({ noProject: true, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'Scratch idea' }, { cardId: 'card_0000ab01' });
  assert.ok(v.ok, JSON.stringify(v));
  assert.equal(v.card.target, 'none');
  assert.equal('noProject' in v.card, false);
  (await ask()).appendMessage(b3.askThreadId, { role: 'assistant', status: 'done', text: '', blocks: [{ kind: 'card', id: 'card_0000ab01', state: 'proposed', card: v.card }] });
  await _testing.chatBridge.reconcile(b3);
  const cp = cardPost('card_0000ab01');
  assert.equal(cp.chatId, 'TH3');
  const i = click(refOnPost(cp, 'Start run'), { chatId: 'TH3' });
  assert.match((await replyTo(i)).text, /^Done/);
  const c = await cardOf(b3.askThreadId, 'card_0000ab01');
  assert.equal(c.state, 'started');
  const { NO_PROJECT_KEY, noProjectWorkDir } = await import('../src/core/store.mjs');
  const entry = mod.runs.get(c.runId);
  assert.equal(entry.projectKey, NO_PROJECT_KEY);
  assert.equal(entry.workMode, 'none');
  assert.equal(entry.projectDir, noProjectWorkDir(entry.pipelineId));
  try { entry.orch?.stop?.(); } catch { /* reap */ }
});

// 6c: a sameAsSource card records the source-branch run, not the card's feature branch.
test('6c. sameAsSource Start records the source-branch run', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  const { cardId, v } = await seedCard(b, { projectKey, sourceBranch: 'dev', sameAsSource: true, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'On dev' });
  assert.equal(v.card.sameAsSource, true);
  assert.equal(typeof v.card.featureBranch, 'string');
  assert.ok(v.card.featureBranch);
  const i = click(refOnPost(cardPost(cardId), 'Start run'));
  assert.match((await replyTo(i)).text, /^Done/);
  const c = await cardOf(b.askThreadId, cardId);
  assert.equal(c.state, 'started');
  const pid = await waitFor(() => mod.runs.get(c.runId)?.pipelineId);
  const row = await waitFor(() => { const r = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid); return r && r.branch ? r : null; });
  const branch = JSON.parse(row.branch);
  assert.equal(branch.sameAsSource, true, row.branch);
  assert.notEqual(branch.feature, v.card.featureBranch);
  try { mod.runs.get(c.runId)?.orch?.stop?.(); } catch { /* reap */ }
});

// 7: replayed, forged and cross-thread (TH2) refs answer stale and change nothing; a duplicate interaction id acts once.
test('7. replay / stale / forged / cross-thread / duplicate interaction id', async () => {
  _testing.chatBridge.resetRateLimits();
  const stale = 'This control is no longer valid. Use the newest message.';
  const n = mod.runs.size;
  const i1 = click(case6StartRef);
  assert.equal((await replyTo(i1)).text, stale);
  await settle();
  assert.equal(mod.runs.size, n);
  const i2 = click('Q'.repeat(24));
  assert.equal((await replyTo(i2)).text, stale);
  const b2 = await openConversation('TH2');
  assert.notEqual(b2.askThreadId, binding().askThreadId);
  const { cardId } = await seedCard(binding(), { projectKey, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'Fresh card' });
  const cp = cardPost(cardId);
  const i3 = click(refOnPost(cp, 'Not now'), { chatId: 'TH2' });
  assert.equal((await replyTo(i3)).text, stale);
  await settle();
  assert.equal((await cardOf(binding().askThreadId, cardId)).state, 'proposed');
  const dup = `dup${++nextId}`;
  click(refOnPost(cp, 'Not now'), { id: dup });
  click(refOnPost(cp, 'Not now'), { id: dup });
  await replyTo(dup);
  await settle(150);
  assert.equal(replies().filter((r) => r.interactionId === dup).length, 1);
  assert.match(replies().find((r) => r.interactionId === dup).text, /^Done/);
  assert.equal((await cardOf(binding().askThreadId, cardId)).state, 'dismissed');
});

// 7b: a card flipped in the store with no broadcast: its unused Start ref still answers stale and starts no run.
test('7b. card flipped in the store (no broadcast), unused Start ref → stale, no run', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  const { cardId } = await seedCard(b, { projectKey, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'Flipped quietly' });
  const ref = refOnPost(cardPost(cardId), 'Start run');
  (await ask()).updateCardBlock(b.askThreadId, cardId, { state: 'dismissed' });
  const n = mod.runs.size;
  const i = click(ref);
  const rep = await replyTo(i);
  await settle(150);
  assert.equal(mod.runs.size, n, `a run started; reply: ${rep.text}`);
  assert.equal(rep.text, 'This control is no longer valid. Use the newest message.');
  assert.equal((await cardOf(b.askThreadId, cardId)).state, 'dismissed');
});

// 8: a Start refused (project folder gone) releases its claim; the same ref starts once the folder is back.
test('8. a refused Start releases its claim: folder gone, then back', async () => {
  _testing.chatBridge.resetRateLimits();
  const { renameSync } = await import('node:fs');
  const b = binding();
  const { cardId } = await seedCard(b, { projectKey, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'Needs the folder' });
  const ref = refOnPost(cardPost(cardId), 'Start run');
  const away = `${projectDir}-away`;
  renameSync(projectDir, away);
  try {
    const i1 = click(ref);
    assert.equal((await replyTo(i1)).text, 'That did not work: the project is no longer registered');
    assert.equal((await cardOf(b.askThreadId, cardId)).state, 'proposed');
  } finally { renameSync(away, projectDir); }
  const i2 = click(ref);
  assert.match((await replyTo(i2)).text, /^Done/);
  const c = await cardOf(b.askThreadId, cardId);
  assert.equal(c.state, 'started');
  try { mod.runs.get(c.runId)?.orch?.stop?.(); } catch { /* reap */ }
});

// 9: Not now dismisses the card and starts no event turn.
test('9. Not now dismisses with no event turn', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const { cardId } = await seedCard(b, { projectKey, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'Maybe later' });
  const { listMessages } = await ask();
  const assistants = () => listMessages(b.askThreadId).filter((m) => m.role === 'assistant').length;
  const a0 = assistants();
  const i = click(refOnPost(cardPost(cardId), 'Not now'));
  assert.match((await replyTo(i)).text, /^Done/);
  assert.equal((await cardOf(b.askThreadId, cardId)).state, 'dismissed');
  await settle(200);
  assert.equal(assistants(), a0);
  assert.equal(_testing.askJobs.get(b.askThreadId)?.status === 'running', false);
});

// 10: Request changes sends a turn, can be used again, and leaves the original card startable.
test('10. Request changes: a turn, reusable, original card still startable', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const { listMessages } = await ask();
  const before = cardBlocks(b.askThreadId).length;
  const echoed = fromWorcaPosts().length;   // case 3's browser message is the one from-worca post in TH1
  say('propose a run to tidy the docs');
  const orig = await waitFor(() => listMessages(b.askThreadId).flatMap((m) => m.blocks || []).find((x) => x && x.kind === 'card' && /tidy the docs/.test(x.card?.brief || '')));
  await idle(b.askThreadId);
  await waitFor(() => deliveredId(orig.id));
  const firstStart = refOf('Start run'), firstChanges = refOf('Request changes');
  assert.equal(firstStart, refOnPost(cardPost(orig.id), 'Start run'));
  const users0 = listMessages(b.askThreadId).filter((m) => m.role === 'user').length;
  const i1 = click(firstChanges, { kind: 'modal', fields: { text: 'use the dev branch' } });
  assert.equal((await replyTo(i1)).text, 'Sent your change request. The proposal stays open.');
  const u = await waitFor(() => listMessages(b.askThreadId).filter((m) => m.role === 'user').at(users0));
  assert.match(u.text, /^Change request for the proposed run/);
  await waitFor(() => listMessages(b.askThreadId).flatMap((m) => m.blocks || []).filter((x) => x && x.kind === 'card').length > before + 1);
  await idle(b.askThreadId);
  assert.equal((await cardOf(b.askThreadId, orig.id)).state, 'proposed');
  assert.equal(fromWorcaPosts().length, echoed);
  _testing.chatBridge.resetRateLimits();
  const i2 = click(firstChanges, { kind: 'modal', fields: { text: 'and keep it short' } });
  assert.equal((await replyTo(i2)).text, 'Sent your change request. The proposal stays open.');
  await waitFor(() => listMessages(b.askThreadId).filter((m) => m.role === 'user').length >= users0 + 2);
  await idle(b.askThreadId);
  const i3 = click(firstStart);
  assert.match((await replyTo(i3)).text, /^Done/);
  const c = await cardOf(b.askThreadId, orig.id);
  assert.equal(c.state, 'started');
  try { mod.runs.get(c.runId)?.orch?.stop?.(); } catch { /* reap */ }
  assert.equal(fromWorcaPosts().length, echoed);
});

// 11: a bounded-choice question renders a select; picking answers the card and the reply follows.
test('11. bounded choice', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  say('MOCK_CHOICE pick a branch');
  const sel = await waitFor(() => newPostsIn().slice().reverse().find((p) => (p.message.controls || []).some((c) => c.kind === 'select' && c.placeholder === 'Pick one')));
  const ctl = sel.message.controls.find((c) => c.kind === 'select');
  assert.deepEqual(ctl.options.map((o) => o.value), ['main', 'dev']);
  const card = lastCard(b.askThreadId, (x) => x.card?.type === 'question');
  assert.equal(card.state, 'proposed');
  await idle(b.askThreadId);
  const n = replies().length;
  click(ctl.ref, { kind: 'select', values: ['dev'] });
  assert.match(await replyAfter(n), /^Done/);
  const after = askStore.findCard(b.askThreadId, card.id).block;
  assert.equal(after.state, 'answered');
  assert.equal(after.card.choice, 'dev');
  await waitFor(() => newPostsIn().some((p) => textOf(p).includes('Got it: option "dev"')));
  await idle(b.askThreadId);
});

// 12: a text question is answered through the Answer modal, and by a plain reply (no ordinary turn).
test('12. text answer, both paths', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  say('MOCK_TEXT_Q');
  const post = await waitFor(() => newPostsIn().slice().reverse().find((p) => (p.message.controls || []).some((c) => c.label === 'Answer' && c.modal)));
  const ans = post.message.controls.find((c) => c.label === 'Answer');
  assert.equal(ans.modal.fields[0].id, 'text');
  const card = lastCard(b.askThreadId, (x) => x.card?.type === 'question' && x.card.answer === 'text');
  await idle(b.askThreadId);
  let n = replies().length;
  click(ans.ref, { kind: 'modal', fields: { text: 'tests first' } });
  assert.match(await replyAfter(n), /^Done/);
  const a1 = askStore.findCard(b.askThreadId, card.id).block;
  assert.equal(a1.state, 'answered');
  assert.equal(a1.card.answerText, 'tests first');
  await waitFor(() => newPostsIn().some((p) => textOf(p).includes('Got it: text "tests first"')));
  await idle(b.askThreadId);
  // plain reply path
  say('MOCK_TEXT_Q');
  await waitFor(() => { const c = lastCard(b.askThreadId, (x) => x.card?.type === 'question' && x.card.answer === 'text'); return c && c.id !== card.id && c; });
  await idle(b.askThreadId);
  const card2 = lastCard(b.askThreadId, (x) => x.card?.type === 'question' && x.card.answer === 'text');
  const users = userRowCount(b.askThreadId);
  const typed = askStore.listMessages(b.askThreadId).filter((m) => m.role === 'user' && m.text === 'docs please').length;
  say('docs please');
  await waitFor(() => askStore.findCard(b.askThreadId, card2.id).block.state === 'answered');
  assert.equal(askStore.findCard(b.askThreadId, card2.id).block.card.answerText, 'docs please');
  await waitFor(() => newPostsIn().some((p) => textOf(p).includes('Got it: text "docs please"')));
  await idle(b.askThreadId);
  // no ordinary turn: no user row whose text is the typed message; only the synthetic event row was added
  assert.equal(askStore.listMessages(b.askThreadId).filter((m) => m.role === 'user' && m.text === 'docs please').length, typed);
  assert.equal(userRowCount(b.askThreadId), users + 1);
});

// 12b: an answer saved while the budget is blocked: the card is answered, the follow-up refusal is posted.
test('12b. answered, follow-up refused', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  say('MOCK_TEXT_Q');
  const before = cardBlocks(b.askThreadId).length;
  await waitFor(() => cardBlocks(b.askThreadId).length > before && newPostsIn().slice().reverse().find((p) => (p.message.controls || []).some((c) => c.label === 'Answer')));
  await idle(b.askThreadId);
  const card = lastCard(b.askThreadId, (x) => x.card?.type === 'question');
  const ref = refOf('Answer');
  await blockBudget();
  try {
    const n = replies().length;
    click(ref, { kind: 'modal', fields: { text: 'later' } });
    const t = await replyAfter(n);
    assert.match(t, /^Answer saved, but the reply could not start:/);
    assert.equal(askStore.findCard(b.askThreadId, card.id).block.state, 'answered');
    await waitFor(() => newPostsIn().some((p) => textOf(p).includes('Chat could not reply to an event:')));
  } finally { await unblockBudget(); }
});

// 12c: the same, answered by a plain reply.
test('12c. plain-reply answer, follow-up refused', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  say('MOCK_TEXT_Q');
  const before = cardBlocks(b.askThreadId).length;
  await waitFor(() => cardBlocks(b.askThreadId).length > before);
  await idle(b.askThreadId);
  const card = lastCard(b.askThreadId, (x) => x.card?.type === 'question');
  await blockBudget();
  try {
    const n = newPostsIn().length;
    say('my plain answer');
    await waitFor(() => newPostsIn().slice(n).some((p) => textOf(p).startsWith('Answer saved, but the reply could not start:')));
    assert.equal(askStore.findCard(b.askThreadId, card.id).block.state, 'answered');
  } finally { await unblockBudget(); }
});

// 13: Scope pins and unpins per thread; a new thread (TH5) starts unscoped and its proposals do not take TH1's project.
test('13. scope isolation', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  let n = replies().length;
  click(latestRefIn('Scope'), { kind: 'select', values: [`p:${projectKey}`] });
  assert.equal(await replyAfter(n), 'Scope: demo');
  const ctx = askStore.getThread(b.askThreadId).context;
  assert.equal(ctx.pinned, true); assert.equal(ctx.projectKey, projectKey);
  const hdr = posts.filter((p) => p.options?.edit?.messageId === b.headerMessageId).at(-1);
  assert.match(textOf(hdr), /scope: \*\*demo\*\*/);
  n = replies().length;
  click(latestRefIn('Scope'), { kind: 'select', values: ['none'] });
  assert.equal(await replyAfter(n), 'Scope: No project');
  const ctx2 = askStore.getThread(b.askThreadId).context;
  assert.equal(ctx2.pinned, false);
  n = replies().length;
  click(latestRefIn('Scope'), { kind: 'select', values: ['p:gone'] });
  assert.equal(await replyAfter(n), 'That did not work: unknown scope');
  // pin TH1 again; open TH5 (no /use) → No project
  n = replies().length;
  click(latestRefIn('Scope'), { kind: 'select', values: [`p:${projectKey}`] });
  await replyAfter(n);
  H.setThreadId(() => 'TH5');
  try {
    say('<@BOT1> hello two', { chatId: 'C1', mention: true });
    const b2 = await waitFor(() => binding('TH5'));
    await idle(b2.askThreadId);
    assert.equal(askStore.getThread(b2.askThreadId).context?.pinned ?? false, false);
    const hdr2 = posts.filter((p) => p.options?.edit?.messageId === b2.headerMessageId).at(-1);
    assert.match(textOf(hdr2), /scope: \*\*No project\*\*/);
    const isProposal = (x) => x.card && x.card.type === undefined;
    const proposals0 = cardBlocks(b.askThreadId).filter(isProposal).length;   // cases 6-10 left proposals in TH1
    say('propose a run to fix the login bug');
    await waitFor(() => cardBlocks(b.askThreadId).filter(isProposal).length > proposals0);
    await idle(b.askThreadId);
    assert.equal(lastCard(b.askThreadId, (x) => x.card && x.card.type === undefined).card.projectKey, projectKey);
    const a2 = asstRows(b2.askThreadId);
    say('propose a run to fix the login bug', { chatId: 'TH5' });
    await waitFor(() => asstRows(b2.askThreadId) > a2);
    await idle(b2.askThreadId);
    const c2 = lastCard(b2.askThreadId, (x) => x.card && x.card.type === undefined);
    assert.ok(!c2 || c2.card.projectKey !== projectKey, JSON.stringify(c2));
  } finally { H.setThreadId(() => 'TH1'); }
});

// 14: Stop ends a running reply; New conversation rebinds TH1 to a fresh Ask thread (same scope) and old refs go stale.
test('14. stop and new conversation', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  // an open card whose ref must go stale after New conversation
  // (a choice card, not a text one: an open TEXT question would take the next message as its answer, D5)
  say('MOCK_CHOICE before stop');
  const before = cardBlocks(b.askThreadId).length;
  await waitFor(() => cardBlocks(b.askThreadId).length > before);
  await idle(b.askThreadId);
  const oldCard = lastCard(b.askThreadId, (x) => x.card?.type === 'question');
  const oldRef = await waitFor(() => latestRefIn('Pick one'));
  process.env.WORCA_MOCK_SLOW_MS = '300';
  try {
    const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
    say('MOCK_SLOW long answer');
    await newTurn(b.askThreadId, prevT);
    await settle(1000);
    let n = replies().length;
    click(latestRefIn('Stop'));
    assert.equal(await replyAfter(n), 'Stopping the reply.');
    await idle(b.askThreadId);
    const last = askStore.listMessages(b.askThreadId).filter((m) => m.role === 'assistant').at(-1);
    assert.equal(last.status, 'stopped');
    assert.ok(!/Got it/.test(last.text), 'a real turn was stopped, not a question event');
    const p = await waitFor(() => newPostsIn().slice().reverse().find((x) => /_Stopped\._$|^_Stopped before any reply\._$/.test(textOf(x))));
    assert.ok(textOf(p).endsWith('_Stopped._') || textOf(p) === '_Stopped before any reply._', textOf(p));
  } finally { delete process.env.WORCA_MOCK_SLOW_MS; }
  // the open text card of the old thread would otherwise swallow later messages: it is in the OLD thread after rebind
  // TH1 switched scope in cases 6 and 13: New conversation is gone (case 22 pins the rules). Turn it back on in the
  // store only so this case can still pin the rebind on TH1, which every later case relies on.
  const hdr0 = posts.filter((p) => p.options?.edit?.messageId === b.headerMessageId).at(-1);
  assert.ok(!controlsOf(hdr0).includes('New conversation'), controlsOf(hdr0).join());
  getDb().prepare('UPDATE chat_conversations SET header_new_off = 0 WHERE id = ?').run(b.id);
  await _testing.chatBridge.refreshHeader(binding());
  const oldThread = b.askThreadId;
  let n = replies().length;
  click(latestRefIn('New conversation'));
  assert.equal(await replyAfter(n), 'Started a new conversation.');
  const nb = binding();
  assert.notEqual(nb.askThreadId, oldThread);
  assert.ok(askStore.getThread(oldThread));
  assert.ok(newPostsIn().some((x) => textOf(x).includes('**New conversation**')));
  // the new thread keeps the scope and its replies are delivered (watch)
  assert.equal(askStore.getThread(nb.askThreadId).context?.projectKey, askStore.getThread(oldThread).context?.projectKey);
  assert.equal(askStore.getThread(nb.askThreadId).context?.projectKey, projectKey);
  say('after new');
  await waitFor(() => newPostsIn().some((x) => textOf(x).includes('[mock] after new')));
  await idle(nb.askThreadId);
  n = replies().length;
  click(oldRef, { kind: 'select', values: ['dev'] });
  assert.match(await replyAfter(n), /no longer valid/);
  assert.equal(askStore.findCard(oldThread, oldCard.id).block.state, 'proposed');
});

// 15: a blocked budget answers with the limit notice and records nothing.
test('15. budget blocked', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  await blockBudget();
  try {
    const a = asstRows(b.askThreadId); const u = userRowCount(b.askThreadId);
    const n = newPostsIn().length;
    say('hi');
    await waitFor(() => newPostsIn().length > n);
    assert.equal(textOf(newPostsIn().at(-1)), 'Total cost limit reached — nothing was sent to the model. Raise the limit in worca Settings.');
    await settle();
    assert.equal(asstRows(b.askThreadId), a);
    assert.equal(userRowCount(b.askThreadId), u);
  } finally { await unblockBudget(); }
});

// 16: bound threads run without agent mode; a script-approval card offers only Open in worca and is refused from chat.
test('16. terminal policy', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  assert.equal(_testing.chatAgentModeFor(b.askThreadId), false);
  const free = askStore.createThread({ createdBy: 'local' });
  assert.equal(_testing.chatAgentModeFor(free.id), true, 'fixture: commands are on here, so false above is the binding');
  const cardId = 'card_0000cc16';
  askStore.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: '', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card: { type: 'script-approval', note: 'run ./x.sh' } }] });
  await _testing.chatBridge.reconcile(binding());
  const p = newPostsIn().slice().reverse().find((x) => textOf(x).includes('script-approval card'));
  assert.ok(p, 'script card posted');
  assert.deepEqual((p.message.controls || []).map((c) => c.label), ['Open in worca']);
  const r = await _testing.invokeAskCard({ threadId: b.askThreadId, cardId, body: { state: 'applied' }, actor: 'ada@example.com' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'CHAT_REMOTE_REFUSED');
});

// 16b: a bound turn starts with agentMode false.
test('16b. bound turn runs without agent mode', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  process.env.WORCA_MOCK_SLOW_MS = '100';
  try {
    const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
    say('MOCK_SLOW agent check');
    const t = await newTurn(b.askThreadId, prevT);
    assert.equal(t.agentMode, false);
    await idle(b.askThreadId);
  } finally { delete process.env.WORCA_MOCK_SLOW_MS; }
});

// 16c: a bound turn never takes queued person commands.
test('16c. a bound turn never takes person commands', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const orig = _testing.askCommands.takePersonCommands;
  const calls = [];
  _testing.askCommands.takePersonCommands = (id) => { calls.push(id); return orig.call(_testing.askCommands, id); };
  try {
    const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
    say('person commands check');
    await newTurn(b.askThreadId, prevT);
    await idle(b.askThreadId);
    assert.deepEqual(calls.filter((x) => x === b.askThreadId), []);
  } finally { _testing.askCommands.takePersonCommands = orig; }
});

// 17: reconcile is single-flight, re-posts a lost delivery, edits an answered card, and runs again on reconnect.
test('17. restart recovery / partial failure', async () => {
  _testing.chatBridge.resetRateLimits();
  const { validateQuestion } = await import('../src/core/ask/question-card.mjs');
  const store = await ask();
  const b = binding();
  await idle(b.askThreadId);
  await settle(50);
  const q = validateQuestion({ answer: 'choice', question: 'Which branch seventeen?', options: [{ id: 'main', label: 'main' }, { id: 'dev', label: 'dev' }] });
  assert.ok(q.ok);
  const cardId = 'card_00001701';
  const block = { kind: 'card', id: cardId, state: 'proposed', card: q.card };
  const m = store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'Seeded reply seventeen', blocks: [block] });
  let thrown = 0;
  H.setSendHook(async (chatId, message) => {
    if (chatId === 'TH1' && thrown === 0 && JSON.stringify(message.body).includes('Which branch seventeen?')) { thrown += 1; throw { kind: 'network' }; }
    return undefined;
  });
  const before = posts.length;
  let settled;
  try {
    settled = await Promise.allSettled([_testing.chatBridge.reconcile(b), _testing.chatBridge.reconcile(b)]);
  } finally { H.setSendHook(null); }
  assert.equal(thrown, 1);
  assert.deepEqual(settled.map((s) => s.status), ['rejected', 'fulfilled']);
  const mine = posts.slice(before);
  assert.equal(mine.filter((p) => textOf(p).includes('Seeded reply seventeen')).length, 1, 'text part');
  assert.equal(mine.filter((p) => textOf(p).includes('Which branch seventeen?')).length, 1, 'card part');
  // A deleted delivery row is re-posted.
  getDb().prepare('DELETE FROM chat_deliveries WHERE ask_message_id = ? AND part = ?').run(m.id, `card:${cardId}`);
  const b2 = posts.length;
  await _testing.chatBridge.reconcile(b);
  assert.equal(posts.length, b2 + 1);
  assert.equal(posts.at(-1).options, null);
  assert.match(textOf(posts.at(-1)), /Which branch seventeen\?/);
  const row = getDb().prepare('SELECT platform_message_id FROM chat_deliveries WHERE ask_message_id = ? AND part = ?').get(m.id, `card:${cardId}`);
  // Answered in worca → the card post is edited, not re-posted.
  store.setMessageBlocks(m.id, [{ ...block, state: 'answered', card: { ...q.card, choice: 'dev' } }]);
  const b3 = posts.length;
  await _testing.chatBridge.reconcile(b);
  assert.equal(posts.length, b3 + 1);
  assert.equal(posts.at(-1).options?.edit?.messageId, row.platform_message_id);
  assert.match(textOf(posts.at(-1)), /Answered: dev/);
  // Restart: a worker that (re)connects reconciles its conversations (onStatus 'connected').
  getDb().prepare('DELETE FROM chat_deliveries WHERE ask_message_id = ? AND part = ?').run(m.id, 'text:0');
  const b4 = posts.length;
  await channelHost.reloadPlugin(NAME);
  await waitFor(() => posts.slice(b4).some((p) => textOf(p).includes('Seeded reply seventeen')));
  await settle(50);
  assert.equal(posts.slice(b4).length, 1);
});

// 17b: a part that can never be delivered must not block the parts after it (review M1).
test('17b. permanent send failure: deleted card message is re-posted, later replies still arrive', async () => {
  _testing.chatBridge.resetRateLimits();
  const { validateQuestion } = await import('../src/core/ask/question-card.mjs');
  const store = await ask();
  const b = binding();
  await idle(b.askThreadId);
  const q = validateQuestion({ answer: 'choice', question: 'Which branch seventeen-b?', options: [{ id: 'main', label: 'main' }, { id: 'dev', label: 'dev' }] });
  assert.ok(q.ok);
  const block = { kind: 'card', id: 'card_00001702', state: 'proposed', card: q.card };
  const m = store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'Seeded reply seventeen-b', blocks: [block] });
  await _testing.chatBridge.reconcile(b);
  const row = getDb().prepare('SELECT platform_message_id FROM chat_deliveries WHERE ask_message_id = ? AND part = ?').get(m.id, 'card:card_00001702');
  assert.ok(row?.platform_message_id);
  // Someone deletes the card message in Discord: every edit of it is now a 404 from the worker (kind 'plugin').
  const gone = (id) => Object.assign(new Error(`channel or message not found (${id})`), { kind: 'plugin', permanent: true });
  H.setSendHook(async (chatId, message, options) => {
    if (options?.edit?.messageId === row.platform_message_id) throw gone(chatId);
    return undefined;
  });
  try {
    store.setMessageBlocks(m.id, [{ ...block, state: 'answered', card: { ...q.card, choice: 'dev' } }]);
    store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'Reply after the deleted card', blocks: [] });
    const before = posts.length;
    await _testing.chatBridge.reconcile(b);
    const mine = posts.slice(before);
    const card = mine.find((p) => textOf(p).includes('Answered: dev'));
    assert.ok(card, 'the card is posted again as a new message');
    assert.equal(card.options, null);
    assert.ok(mine.some((p) => textOf(p).includes('Reply after the deleted card')), 'a later reply still arrives');
    // Nothing is retried on the next pass.
    const after = posts.length;
    await _testing.chatBridge.reconcile(b);
    assert.equal(posts.length, after);
  } finally { H.setSendHook(null); }
  // A permanent failure that is not a 404 (403) is recorded and skipped, not retried forever and not blocking.
  store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'Forbidden seventeen-b', blocks: [] });
  store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'After forbidden seventeen-b', blocks: [] });
  let forbidden = 0;
  H.setSendHook(async (chatId, message) => {
    if (JSON.stringify(message.body).includes('Forbidden seventeen-b')) { forbidden += 1; throw Object.assign(new Error('missing access'), { kind: 'plugin', permanent: true }); }
    return undefined;
  });
  try {
    const before = posts.length;
    await _testing.chatBridge.reconcile(b);
    assert.ok(posts.slice(before).some((p) => textOf(p).includes('After forbidden seventeen-b')));
    await _testing.chatBridge.reconcile(b);
    assert.equal(forbidden, 1, 'the refused part is not retried');
  } finally { H.setSendHook(null); }
  // A failure that is not marked permanent (a Discord 5xx outage) is never recorded as delivered: the next pass retries it.
  store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'Outage seventeen-b', blocks: [] });
  let outage = true;
  H.setSendHook(async (chatId, message) => {
    if (outage && JSON.stringify(message.body).includes('Outage seventeen-b')) throw Object.assign(new Error('Discord is unavailable (HTTP 503)'), { kind: 'network' });
    return undefined;
  });
  try {
    await assert.rejects(_testing.chatBridge.reconcile(b), (e) => e.kind === 'network');
    outage = false;
    const before = posts.length;
    await _testing.chatBridge.reconcile(b);
    assert.ok(posts.slice(before).some((p) => textOf(p).includes('Outage seventeen-b')), 'delivered once the outage ends');
  } finally { H.setSendHook(null); }
  // A card post the platform refuses for good leaves no live ref behind: its controls were never shown.
  const q2 = validateQuestion({ answer: 'choice', question: 'Which branch seventeen-b2?', options: [{ id: 'main', label: 'main' }, { id: 'dev', label: 'dev' }] });
  assert.ok(q2.ok);
  store.appendMessage(b.askThreadId, { role: 'assistant', status: 'done', text: 'Seeded reply seventeen-b2', blocks: [{ kind: 'card', id: 'card_00001703', state: 'proposed', card: q2.card }] });
  H.setSendHook(async (chatId, message) => {
    if (JSON.stringify(message.body).includes('seventeen-b2')) throw Object.assign(new Error('missing access'), { kind: 'plugin', permanent: true });
    return undefined;
  });
  try {
    await _testing.chatBridge.reconcile(b);
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM chat_controls WHERE card_id = ?').get('card_00001703').n > 0, true, 'fixture: refs were minted for the refused post');
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM chat_controls WHERE card_id = ? AND used_at IS NULL').get('card_00001703').n, 0, 'no live ref is left for a card that was never shown');
  } finally { H.setSendHook(null); }
});

// 18: a non-interactive chat plugin keeps commands, gets no freeform thread, refuses edits, and gets controls as text.
test('18. non-interactive channel compatibility', async () => {
  _testing.chatBridge.resetRateLimits();
  const entry = channelHost.list().find((e) => e.plugin === NAME2);
  assert.ok(entry && entry.capabilities.interactive !== true);
  const inject = (text, id, mention = false) => channelHost.injectInboundMessage(NAME2, 'main', { chatId: 'P1', userId: 'U1', text,
    meta: { platform: 'discord', messageId: id, guildId: 'G1', isGroup: true, mentionsBot: mention, botId: 'BOT1' } });
  const before = posts.length;
  inject('/status', 'p-1');
  await waitFor(() => posts.slice(before).some((p) => p.chatId === 'P1'));
  assert.equal(posts.at(-1).options, null);
  const threads0 = countOf('ask_threads');
  const convs0 = countOf('chat_conversations');
  const b2 = posts.length;
  inject('<@BOT1> hello there', 'p-2', true);
  inject('/help', 'p-3');                        // same chat queue: its reply proves the mention was handled
  await waitFor(() => posts.slice(b2).some((p) => /Worca chat commands/.test(textOf(p))));
  await settle(50);
  assert.equal(posts.slice(b2).length, 1, JSON.stringify(posts.slice(b2).map(textOf)));
  assert.equal(countOf('ask_threads'), threads0);
  assert.equal(countOf('chat_conversations'), convs0);
  await assert.rejects(channelHost.sendMessage({ plugin: NAME2, channelId: 'main', chatId: 'P1',
    message: { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'x' }] }, options: { edit: { messageId: 'x' } } }), /not interactive/);
  // A notification with controls reaches it as text: links stay as link segments, buttons vanish.
  const b3 = posts.length;
  await channelHost.sendMessage({ plugin: NAME2, channelId: 'main', chatId: 'P1', message: { title: 'Run finished', severity: 'info',
    body: [{ kind: 'markdown', value: 'done' }], controls: [{ kind: 'button', ref: 'r'.repeat(24), label: 'Go', style: 'primary' }, { kind: 'link', label: 'Open in worca', url: 'https://worca.example/#running/x' }] } });
  const n = posts.slice(b3)[0];
  assert.equal(n.message.controls, undefined);
  assert.ok(n.message.body.some((s) => s.kind === 'link' && s.href === 'https://worca.example/#running/x'));
});

// 19: a burst past the per-user bucket is told to slow down and starts no turn.
test('19. rate limit', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  for (let i = 0; i < 6; i++) say(`burst ${i}`);
  await waitFor(() => userRowCount(b.askThreadId) >= 0 && posts.length > 0);
  // let the queue drain the six
  await settle(300);
  await idle(b.askThreadId);
  await settle(100);
  const u = userRowCount(b.askThreadId);
  const n = newPostsIn().length;
  say('burst 7');
  const rp = await waitFor(() => newPostsIn().slice(n).find((p) => textOf(p).startsWith('Slow down a little')));
  assert.ok(rp);
  await settle(100);
  assert.equal(userRowCount(b.askThreadId), u);
});

// 20: a thread on an engine the credential broker cannot serve refuses the turn with an Open in worca hint (TH4).
test('20. credential broker engine gate', async () => {
  _testing.chatBridge.resetRateLimits();
  H.setThreadId(() => 'TH4');
  try {
    say('<@BOT1>', { chatId: 'C1', mention: true });
    const b4 = await waitFor(() => binding('TH4'));
    askStore.appendMessage(b4.askThreadId, { role: 'assistant', status: 'done', text: 'earlier' });
    askStore.updateThread(b4.askThreadId, { engine: 'codex' });
    process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
    const u = userRowCount(b4.askThreadId);
    const n = newPostsIn('TH4').length;
    say('hi', { chatId: 'TH4' });
    await waitFor(() => newPostsIn('TH4').length > n);
    const t = textOf(newPostsIn('TH4').at(-1));
    assert.ok(t.startsWith('This chat runs on Codex:'), t);
    assert.ok(t.includes('Open in worca'), t);
    await settle();
    assert.equal(userRowCount(b4.askThreadId), u);
    assert.equal(_testing.askJobs.get(b4.askThreadId)?.status === 'running', false);
  } finally { delete process.env.WORCA_BROKER_URL; H.setThreadId(() => 'TH1'); }
});

// 21: a chat turn carries the same signed-in / reader identity as a browser turn would.
test('21. turn identity parity', async () => {
  _testing.chatBridge.resetRateLimits();
  delete process.env.WORCA_IDENTITY_HEADER;
  delete process.env.WORCA_IDENTITY_NAME;
  process.env.WORCA_MOCK_SLOW_MS = '200';
  try {
    const store = await ask();
    const b = binding();
    await idle(b.askThreadId);
    say('MOCK_SLOW who am I');
    const job = await waitFor(() => { const j = _testing.askJobs.get(b.askThreadId); return j && j.turn ? j : null; });
    assert.equal(job.turn.reader, null);
    assert.equal(job.turn.prompt.includes('signed in:'), false);
    assert.deepEqual(_testing.chatTurnIdentity(store.getThread(b.askThreadId), 'ada@example.com'), { signedIn: null, reader: null });
    await idle(b.askThreadId);
    process.env.WORCA_IDENTITY_NAME = 'op';
    assert.deepEqual(_testing.chatTurnIdentity(store.getThread(b.askThreadId), 'ada@example.com'), { signedIn: 'op', reader: null });
    delete process.env.WORCA_IDENTITY_NAME;
    process.env.WORCA_IDENTITY_HEADER = 'x-worca-user';
    _testing.chatBridge.resetRateLimits();
    say('MOCK_SLOW who am I again');
    const job2 = await waitFor(() => { const j = _testing.askJobs.get(b.askThreadId); return j && j !== job && j.turn ? j : null; });
    assert.equal(job2.turn.reader, 'ada@example.com');
    assert.ok(job2.turn.prompt.includes('signed in: ada@example.com'));
    assert.deepEqual(_testing.chatTurnIdentity(store.getThread(b.askThreadId), 'ada@example.com'), { signedIn: 'ada@example.com', reader: 'ada@example.com' });
    await idle(b.askThreadId);
  } finally {
    delete process.env.WORCA_IDENTITY_HEADER;
    delete process.env.WORCA_IDENTITY_NAME;
    delete process.env.WORCA_MOCK_SLOW_MS;
  }
});

// Source pin: the bridge's startTurn keeps the send route's credential gate (equivalent in
// mock mode, so pinned by source) and takes its turn identity from chatTurnIdentity.
test('bridge startTurn calls askCredentialGate and chatTurnIdentity', () => {
  const src = readServerSource();
  const start = src.indexOf('startTurn: async ({ threadId, text, actor, onUserRow, inbound = null })');
  const end = src.indexOf('applyCard: (a) => invokeAskCard(a)', start);
  assert.ok(start > 0 && end > start, 'chat bridge startTurn block not found');
  const block = src.slice(start, end);
  assert.match(block, /await askCredentialGate\(chatActorReq\(actor\), mv\.model\)/);
  assert.match(block, /\.\.\.chatTurnIdentity\(fresh, actor\)/);
  assert.doesNotMatch(block, /askViewer\(|askSignedIn\(/);
});

// 22: header rules on a fresh thread (TH7): a failed scope switch leaves the header as it was; ANY successful pick (here
// a re-pick of the current scope) removes New conversation for good, its old ref answers stale and starts nothing, and
// later refreshes never bring it back.
test('22. header: a failed switch keeps New conversation; a successful pick removes it for good', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = await openConversation('TH7');
  const header = () => posts.filter((p) => p.options?.edit?.messageId === b.headerMessageId).at(-1);
  assert.ok(controlsOf(header()).includes('New conversation'));
  const oldNew = latestRefIn('New conversation', 'TH7');
  const usedAt = (ref) => { const r = getDb().prepare('SELECT used_at FROM chat_controls WHERE ref = ?').get(ref); return r ? r.used_at : 'gone'; };
  let n = replies().length;
  click(latestRefIn('Scope', 'TH7'), { chatId: 'TH7', kind: 'select', values: ['p:gone'] });
  assert.equal(await replyAfter(n), 'That did not work: unknown scope');
  assert.equal(latestRefIn('New conversation', 'TH7'), oldNew, 'a failed switch re-issues nothing');
  assert.equal(usedAt(oldNew), null, 'and the old New conversation ref still works');
  const cur = askStore.getThread(b.askThreadId).context;
  const same = cur?.projectKey ? `p:${cur.projectKey}` : cur?.workspaceId ? `w:${cur.workspaceId}` : 'none';
  n = replies().length;
  click(latestRefIn('Scope', 'TH7'), { chatId: 'TH7', kind: 'select', values: [same] });
  assert.match(await replyAfter(n), /^Scope: /);
  assert.ok(!controlsOf(header()).includes('New conversation'), controlsOf(header()).join());
  assert.match(textOf(header()), /change scope or stop a reply/);
  assert.notEqual(usedAt(oldNew), null);
  n = replies().length;
  click(oldNew, { chatId: 'TH7' });
  assert.match(await replyAfter(n), /no longer valid/);
  assert.equal(binding('TH7').askThreadId, b.askThreadId, 'no new conversation was started');
  n = replies().length;
  click(latestRefIn('Scope', 'TH7'), { chatId: 'TH7', kind: 'select', values: [`p:${projectKey}`] });
  assert.equal(await replyAfter(n), 'Scope: demo');
  await _testing.chatBridge.refreshHeader(binding('TH7'));   // a later refresh (reconnect, restart) keeps it off
  const kinds = controlsOf(header()).map((k) => (k.startsWith('Scope') ? 'Scope' : k));
  assert.deepEqual(kinds, ['Scope', 'Stop', 'Open in worca']);
});

// 23: a thread reply gets ⏳ when accepted and ✅ only after its reply was posted.
test('23. reactions: ⏳ on an accepted reply, ✅ only after its answer is posted', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const id = say('react to me');
  await waitFor(() => marksOn(id).includes(MARK.ok));
  const reply = posts.findIndex((p) => p.chatId === 'TH1' && textOf(p).includes('[mock] react to me'));
  assert.ok(reply >= 0);
  assert.ok(opAt(id, MARK.ok) > reply, 'the ✅ lands after the reply post');
  assert.deepEqual(opsOn(id), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
  assert.ok(rxLog.filter((r) => r.messageId === id).every((r) => r.chatId === 'TH1'));
});

// 24: the mention that opens a thread is marked in the PARENT channel; a bare mention ends ✅ once the header is up.
test('24. reactions: a bare mention ends ✅ once its thread header is up', async () => {
  _testing.chatBridge.resetRateLimits();
  H.setThreadId(() => 'TH8');
  let id;
  try { id = say('<@BOT1>', { chatId: 'C1', mention: true }); await waitFor(() => binding('TH8')); }
  finally { await settle(30); H.setThreadId(() => 'TH1'); }
  await waitFor(() => marksOn(id).includes(MARK.ok));
  assert.deepEqual(opsOn(id), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
  assert.ok(rxLog.filter((r) => r.messageId === id).every((r) => r.chatId === 'C1'));
  const opened = posts.findIndex((p) => p.options?.thread?.fromMessageId === id);
  assert.ok(opened >= 0 && opAt(id, MARK.ok) > opened);
});

// 25: refusals clear ⏳ and add nothing; a stopped reply ends ⏹️; a failed turn ends ❌.
test('25. reactions: busy and budget refusals clear ⏳; Stop ends ⏹️; a failed turn ends ❌', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  process.env.WORCA_MOCK_SLOW_MS = '300';
  try {
    const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
    const slowId = say('MOCK_SLOW reacting slowly');
    await newTurn(b.askThreadId, prevT);
    await waitFor(() => marksOn(slowId).includes(MARK.work));
    const n = newPostsIn().length;
    const busyId = say('are you there?');
    await waitFor(() => newPostsIn().slice(n).some((p) => textOf(p) === SAY.busy));
    await waitFor(() => opsOn(busyId).length === 2);
    assert.deepEqual(opsOn(busyId), [`+${MARK.work}`, `-${MARK.work}`]);
    assert.deepEqual(marksOn(slowId), [MARK.work], 'the running message keeps its ⏳');
    const r = replies().length;
    click(latestRefIn('Stop'));
    await replyAfter(r);
    await idle(b.askThreadId);
    await waitFor(() => marksOn(slowId).includes(MARK.stop));
    assert.deepEqual(marksOn(slowId), [MARK.stop]);
  } finally { delete process.env.WORCA_MOCK_SLOW_MS; }
  const failId = say('please MOCK_FAIL now');
  await waitFor(() => marksOn(failId).includes(MARK.fail));
  assert.deepEqual(marksOn(failId), [MARK.fail]);
  await idle(b.askThreadId);
  await blockBudget();
  try {
    const budgetId = say('hi again');
    await waitFor(() => opsOn(budgetId).length === 2);
    await settle(100);
    assert.deepEqual(opsOn(budgetId), [`+${MARK.work}`, `-${MARK.work}`]);
  } finally { await unblockBudget(); }
});

// 26: a reply refused for good ends ❌, never ✅; a transient delivery failure keeps ⏳ until a later pass delivers it.
test('26. reactions: a refused reply ends ❌; a transient failure keeps ⏳ until the retry delivers it', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  H.setSendHook(async (chatId, message) => {
    if (chatId === 'TH1' && JSON.stringify(message.body).includes('[mock] refuse me')) throw Object.assign(new Error('Missing Access'), { kind: 'plugin', permanent: true });
    return undefined;
  });
  try {
    const id = say('refuse me');
    await waitFor(() => marksOn(id).includes(MARK.fail));
    assert.deepEqual(marksOn(id), [MARK.fail]);
  } finally { H.setSendHook(null); }
  await idle(b.askThreadId);
  let thrown = 0;
  H.setSendHook(async (chatId, message) => {
    if (chatId === 'TH1' && thrown === 0 && JSON.stringify(message.body).includes('[mock] flaky once')) { thrown += 1; throw { kind: 'network' }; }
    return undefined;
  });
  try {
    const id = say('flaky once');
    await waitFor(() => thrown === 1);
    await idle(b.askThreadId);
    await settle(150);
    assert.deepEqual(marksOn(id), [MARK.work], 'still processing: the reply is not delivered yet');
    await _testing.chatBridge.reconcile(binding());   // the next trigger (a frame, a reconnect) retries the part
    await waitFor(() => marksOn(id).includes(MARK.ok));
    assert.deepEqual(marksOn(id), [MARK.ok]);
    assert.equal(posts.filter((p) => textOf(p).includes('[mock] flaky once')).length, 1);
  } finally { H.setSendHook(null); }
});

// 27: a reply carrying an approval card or a question completes its message; a typed answer ends ✅ with the
// follow-up reply, or ❌ when the follow-up could not start (clarify answer).
test('27. reactions: cards complete their message; a typed answer waits for its follow-up', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const pId = say('propose a run to fix the reaction bug');
  await waitFor(() => marksOn(pId).includes(MARK.ok));
  assert.equal(lastCard(b.askThreadId, (x) => x.card && x.card.type === undefined).state, 'proposed', 'the run still waits for Start');
  await idle(b.askThreadId);
  const qId = say('MOCK_TEXT_Q');
  await waitFor(() => marksOn(qId).includes(MARK.ok));
  await idle(b.askThreadId);
  const aId = say('tabs please');
  await waitFor(() => marksOn(aId).includes(MARK.ok));
  const follow = posts.findIndex((p) => p.chatId === 'TH1' && textOf(p).includes('Got it: text "tabs please"'));
  assert.ok(follow >= 0 && opAt(aId, MARK.ok) > follow, 'the ✅ waits for the follow-up reply');
  await idle(b.askThreadId);
  const before = cardBlocks(b.askThreadId).length;
  say('MOCK_TEXT_Q');
  await waitFor(() => cardBlocks(b.askThreadId).length > before);
  await idle(b.askThreadId);
  await blockBudget();
  try {
    const lId = say('later then');
    await waitFor(() => marksOn(lId).includes(MARK.fail));
    assert.deepEqual(opsOn(lId), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.fail}`]);
  } finally { await unblockBudget(); }
});

// 28: commands are marked once the router accepted them; unknown commands, filtered chats, chatter, non-owners and
// replayed events get no mark and no second action.
test('28. reactions: commands marked after acceptance; ignored and replayed messages get none', async () => {
  _testing.chatBridge.resetRateLimits();
  const before = posts.length;
  const ok = say('/help', { chatId: 'C1' });          // info reply: always ✅ (/status here answers a warning, cases 6-13 left runs)
  await waitFor(() => marksOn(ok).includes(MARK.ok));
  assert.deepEqual(opsOn(ok), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
  assert.ok(opAt(ok, MARK.ok) > before, 'after the reply');
  // A command typed in the bound thread is routed for the PARENT chat, but its mark belongs on the thread message:
  // marksOn filters by message id only, so the chat id is asserted on every call.
  const inThread = say('/help');
  await waitFor(() => marksOn(inThread).includes(MARK.ok));
  assert.deepEqual(opsOn(inThread), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
  assert.ok(rxLog.filter((r) => r.messageId === inThread).every((r) => r.chatId === 'TH1'), 'marked in the thread, never on C1');
  const warned = say('/status zzzzzz', { chatId: 'C1' });   // the router's own refusal (a warning): ⏳ removed, no final mark
  await waitFor(() => opsOn(warned).length === 2);
  await settle(50);
  assert.deepEqual(opsOn(warned), [`+${MARK.work}`, `-${MARK.work}`]);
  H.setSendHook(async (chatId, message) => { if (chatId === 'C1' && JSON.stringify(message.body).includes('Worca chat commands')) throw Object.assign(new Error('Missing Access'), { kind: 'plugin', permanent: true }); return undefined; });
  try {
    const lost = say('/help', { chatId: 'C1' });   // the answer could not be posted: ❌
    await waitFor(() => marksOn(lost).includes(MARK.fail));
    assert.deepEqual(opsOn(lost), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.fail}`]);
  } finally { H.setSendHook(null); }
  const unknown = say('/frobnicate', { chatId: 'C1' });
  await waitFor(() => posts.slice(before).some((p) => /Unknown command/.test(textOf(p))));
  const n = posts.length;
  say('/help', { chatId: 'C1', id: ok });            // a gateway replay of the same message
  const chatter = say('hello again all', { chatId: 'C1' });
  const offList = say('/status', { chatId: 'C9' });
  const notOwner = say('me too', { userId: 'U2' });
  await settle(300);
  assert.equal(posts.length, n, 'the replay and the ignored messages post nothing');
  for (const id of [unknown, chatter, offList, notOwner]) assert.deepEqual(opsOn(id), [], id);
  assert.equal(opsOn(ok).length, 3, 'the replay adds no marks');
  const b = binding();
  await idle(b.askThreadId);
  const u0 = userRowCount(b.askThreadId);
  const d = say('dup react', { id: 'dup-react-1' });
  say('dup react', { id: 'dup-react-1' });
  await waitFor(() => marksOn(d).includes(MARK.ok));
  await settle(100);
  assert.deepEqual(opsOn(d), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
  assert.equal(userRowCount(b.askThreadId), u0 + 1, 'one paid turn');
});

// 29: a reaction call the platform refuses never blocks the reply, never repeats the turn, and is not retried.
test('29. reactions: a refused reaction call changes nothing else', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  let calls = 0;
  H.setReactHook(async () => { calls += 1; throw Object.assign(new Error('Missing Permissions'), { kind: 'plugin', permanent: true }); });
  try {
    const u0 = userRowCount(b.askThreadId);
    const id = say('no reactions allowed');
    await waitFor(() => posts.some((p) => p.chatId === 'TH1' && textOf(p).includes('[mock] no reactions allowed')));
    await idle(b.askThreadId);
    await waitFor(() => calls >= 3);   // ⏳ add, ⏳ remove, ✅ add: one try each
    await settle(150);
    assert.equal(calls, 3);
    assert.equal(userRowCount(b.askThreadId), u0 + 1);
    assert.deepEqual(opsOn(id), []);
  } finally { H.setReactHook(null); }
});

// 30: New conversation while a reply is pending: that reply never reaches the rebound thread, so its ⏳ is removed and
// no final mark is added (dropWaits).
test('30. reactions: New conversation drops a pending reply\'s ⏳ without a mark', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  process.env.WORCA_MOCK_SLOW_MS = '300';
  try {
    const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
    const id = say('MOCK_SLOW still thinking');
    await newTurn(b.askThreadId, prevT);
    await waitFor(() => marksOn(id).includes(MARK.work));
    const n = replies().length;
    click(latestRefIn('New conversation'));
    assert.equal(await replyAfter(n), 'Started a new conversation.');
    await waitFor(() => opsOn(id).length === 2);
    await idle(b.askThreadId);
    await settle(150);
    assert.deepEqual(opsOn(id), [`+${MARK.work}`, `-${MARK.work}`]);
  } finally { delete process.env.WORCA_MOCK_SLOW_MS; }
});

// 31: an issue-backed proposal (a task source, no brief) gets the native buttons and starts from chat with the browser's
// source body, through the same run-start service; a typed "ok" is not approval; the bound thread's prompt says what
// Discord shows; a non-owner, a replayed interaction and a second click on the spent ref start nothing.
test('31. task-source proposal: Start run from chat starts the issue run; "ok" starts nothing', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const { cardId, v } = await seedCard(b, { projectKey, workflowId: 'wf_default', guardrailsId: 'normal', source: { plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-31' } });
  assert.equal(v.card.brief, '', 'the issue is the task: no copy of it in a brief');
  assert.deepEqual({ plugin: v.card.source.plugin, sourceId: v.card.source.sourceId, taskId: v.card.source.taskId }, { plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-31' });
  const cp = cardPost(cardId);
  assert.deepEqual(controlsOf(cp), ['Start run', 'Not now', 'Request changes', 'Open in worca']);
  assert.match(textOf(cp), /\nTask: Mock Tasks MOCK-31/);
  const ref = refOnPost(cp, 'Start run');
  const n = mod.runs.size;
  say('ok');
  await waitFor(() => posts.some((p) => p.chatId === 'TH1' && textOf(p).includes('[mock] ok')));
  await idle(b.askThreadId);
  assert.equal((await cardOf(b.askThreadId, cardId)).state, 'proposed', 'a typed ok starts nothing');
  assert.equal(mod.runs.size, n);
  assert.match(_testing.askJobs.get(b.askThreadId).turn.systemPrompt, /\n## Chat channel\nThis chat is also shown in a Discord thread/);
  const iX = click(ref, { userId: 'U2' });
  assert.equal((await replyTo(iX)).text, SAY.notOwner('U1'));
  assert.equal((await cardOf(b.askThreadId, cardId)).state, 'proposed');
  const i1 = click(ref);
  assert.match((await replyTo(i1)).text, /^Done/);
  const c = await cardOf(b.askThreadId, cardId);
  assert.equal(c.state, 'started');
  assert.equal(mod.runs.size, n + 1);
  const pid = await waitFor(() => mod.runs.get(c.runId)?.pipelineId);
  const row = await waitFor(() => { const r = getDb().prepare('SELECT source_type, source_ref, started_by FROM pipelines WHERE id = ?').get(pid); return r && r.source_type === 'plugin' ? r : null; });
  const ref0 = JSON.parse(row.source_ref);
  assert.deepEqual({ plugin: ref0.plugin, sourceId: ref0.sourceId, taskId: ref0.taskId }, { plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-31' });
  assert.equal(row.started_by, 'ada@example.com', 'the bound identity starts it');
  click(ref, { id: i1 });                                  // a replayed interaction
  const i2 = click(ref);                                   // a second click on the spent ref
  assert.equal((await replyTo(i2)).text, SAY.stale);
  await settle(150);
  assert.equal(replies().filter((r) => r.interactionId === i1).length, 1);
  assert.equal(mod.runs.size, n + 1, 'one run');
  try { mod.runs.get(c.runId)?.orch?.stop?.(); } catch { /* reap */ }
});

// 32: a typed answer that arrives while another reply runs: its follow-up is queued (turn {deferred:true}). The ✅
// waits for THAT follow-up, which the server names when the queue starts it; a queued follow-up that cannot start ends
// ❌ (clarify answer). Nothing is matched by row order.
test('32. reactions: a queued answer settles on its own follow-up, or ❌ when it cannot start', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding();
  await idle(b.askThreadId);
  const busyElsewhere = async (text) => {
    const prevT = _testing.askJobs.get(b.askThreadId)?.turn;
    const r = await fetch(`${base}/api/ask/threads/${b.askThreadId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, model: 'claude-opus-5-5', effort: 'high' }) });
    assert.equal(r.status, 202, await r.text());
    await newTurn(b.askThreadId, prevT);
  };
  const openQuestion = async () => {
    const before = cardBlocks(b.askThreadId).length;
    say('MOCK_TEXT_Q');
    await waitFor(() => cardBlocks(b.askThreadId).length > before);
    await idle(b.askThreadId);
    return lastCard(b.askThreadId, (x) => x.card?.type === 'question' && x.card.answer === 'text');
  };
  process.env.WORCA_MOCK_SLOW_MS = '300';
  try {
    const q1 = await openQuestion();
    await busyElsewhere('MOCK_SLOW a browser turn is running');
    const aId = say('queued answer');
    await waitFor(() => askStore.findCard(b.askThreadId, q1.id).block.state === 'answered');
    assert.deepEqual(marksOn(aId), [MARK.work], 'queued: still processing');
    await waitFor(() => marksOn(aId).includes(MARK.ok));
    const follow = posts.findIndex((p) => p.chatId === 'TH1' && textOf(p).includes('Got it: text "queued answer"'));
    assert.ok(follow >= 0 && opAt(aId, MARK.ok) > follow, 'the ✅ waits for the queued follow-up reply');
    assert.deepEqual(opsOn(aId), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
    await idle(b.askThreadId);
    const q2 = await openQuestion();
    await busyElsewhere('MOCK_SLOW another browser turn');
    const lId = say('answer that cannot continue');
    await waitFor(() => askStore.findCard(b.askThreadId, q2.id).block.state === 'answered');
    const notices = () => newPostsIn().filter((p) => textOf(p).includes('Chat could not reply to an event:')).length;
    const n0 = notices();
    await blockBudget();   // the queued follow-up starts after the running turn and is refused
    try {
      await waitFor(() => marksOn(lId).includes(MARK.fail));
      assert.deepEqual(opsOn(lId), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.fail}`]);
      await waitFor(() => notices() > n0);
    } finally { await unblockBudget(); }
  } finally { delete process.env.WORCA_MOCK_SLOW_MS; }
  await idle(b.askThreadId);
});

// 33: New conversation clicked while a mention's first turn is starting (the mention runs on the parent channel's
// queue, the click on the thread's): the turn's reply goes to the old Ask thread and never reaches this thread, so the
// mention ends with ⏳ removed and no mark, as in case 30, never a ⏳ left for good.
test('33. reactions: New conversation during a mention\'s turn start drops its ⏳ without a mark', async () => {
  _testing.chatBridge.resetRateLimits();
  H.setThreadId(() => 'TH9');
  let clicked = null;
  let first = null;
  H.setSendHook(async (chatId, message, options) => {
    if (clicked || chatId !== 'TH9' || !options?.edit) return undefined;
    const ref = (message.controls || []).find((k) => k.label === 'New conversation')?.ref;
    if (!ref) return undefined;
    first = binding('TH9').askThreadId;   // the Ask thread the mention's turn is about to start on
    const n = replies().length;
    clicked = click(ref, { chatId: 'TH9' });
    assert.equal(await replyAfter(n), 'Started a new conversation.');   // rebound before the mention's turn starts
    return undefined;
  });
  let id;
  try {
    id = say('<@BOT1> race the header', { chatId: 'C1', mention: true });
    await waitFor(() => clicked && binding('TH9').askThreadId !== first);
  } finally { await settle(30); H.setSendHook(null); H.setThreadId(() => 'TH1'); }
  await waitFor(() => opsOn(id).length >= 2);
  await idle(first);
  await idle(binding('TH9').askThreadId);
  await settle(150);
  assert.deepEqual(opsOn(id), [`+${MARK.work}`, `-${MARK.work}`]);
});

// 34: discord-chat 0.4.0 chat context. A reply that mentions the bot starts a conversation with the replied-to message
// quoted apart from the person's words, its file saved as an Ask attachment downloaded from the plugin's CDN host only
// (an off-host file is listed by name and never fetched), and — with the opt-in on — the channel history read once.
test('34. chat context: reply-to-start with a file, history on start, off-host file listed', async () => {
  _testing.chatBridge.resetRateLimits();
  H.setThreadId(() => 'TH34');
  const fetched = [];
  _testing.setChatFileFetch(async (url, init) => { fetched.push({ url, redirect: init?.redirect }); return new Response('# Notes\nship it friday\n', { status: 200 }); });
  const historyCalls = [];
  setMockChannelBehavior({ '*': { ...behavior, history: async (frame) => { historyCalls.push(frame);
    return [{ author: 'Bob', text: 'earlier word', at: '2026-11-03T09:50:00.000Z', link: 'https://discord.com/channels/G1/C1/h1' }]; } } });
  writeCfg({ historyOnStart: '5' });
  try {
    const id = `ctx${++nextId}`;
    const fileUrl = 'https://cdn.discordapp.com/attachments/C1/a1/notes.md?ex=1';
    channelHost.injectInboundMessage(NAME, 'main', { chatId: 'C1', userId: 'U1', text: '<@BOT1> summarise this please',
      meta: { platform: 'discord', messageId: id, guildId: 'G1', isGroup: true, mentionsBot: true, botId: 'BOT1' },
      replyTo: { author: 'Alice', text: 'the plan is in the file', at: '2026-11-03T09:58:00.000Z', link: 'https://discord.com/channels/G1/C1/r1',
        attachments: [{ name: 'notes.md', contentType: 'text/markdown', size: 23, url: fileUrl },
          { name: 'evil.md', contentType: 'text/markdown', size: 5, url: 'https://evil.example.com/evil.md' }] } });
    await waitFor(() => binding('TH34'));
    const b = binding('TH34');
    await waitFor(() => posts.some((p) => p.chatId === 'TH34' && textOf(p).includes('[mock] summarise this please')));
    await idle(b.askThreadId);
    const reply = posts.find((p) => p.chatId === 'TH34' && textOf(p).includes('[mock] summarise this please'));
    assert.ok(!textOf(reply).includes('the plan is in the file'), 'the mock answers the person\'s words, not the quoted context');

    const user = askStore.listMessages(b.askThreadId).find((m) => m.role === 'user');
    assert.equal(user.text, 'summarise this please', 'the row keeps only the person\'s words');
    const cb = user.blocks.find((x) => x.kind === 'chat-context');
    assert.equal(cb.platform, 'discord');
    assert.equal(cb.replyTo.author, 'Alice');
    assert.deepEqual(cb.history.map((q) => q.text), ['earlier word']);
    assert.deepEqual(cb.replyTo.files.map((f) => [f.name, typeof f.id === 'string', f.note ?? null]),
      [['notes.md', true, null], ['evil.md', false, "not saved: not from the chat platform's file host"]]);
    const atts = askStore.listAttachments(b.askThreadId);
    assert.deepEqual(atts.map((a) => a.name), ['notes.md']);
    assert.equal(askStore.readAttachmentText(b.askThreadId, atts[0].id).text, '# Notes\nship it friday\n');
    assert.deepEqual(user.blocks.find((x) => x.kind === 'attachment').origin, { platform: 'discord', from: 'reply', link: 'https://discord.com/channels/G1/C1/r1' });
    assert.deepEqual(fetched, [{ url: fileUrl, redirect: 'error' }], 'only the declared host, no redirects');
    assert.deepEqual(historyCalls, [{ chatId: 'C1', before: id, limit: 5 }]);

    const prompt = _testing.askJobs.get(b.askThreadId).turn.prompt;
    assert.match(prompt, /\[chat context\] Quoted from Discord/);
    assert.ok(prompt.indexOf('summarise this please') < prompt.indexOf('[chat context]'), 'after the person\'s words');
    assert.match(prompt, /\| the plan is in the file/);
    assert.ok(prompt.includes(`${atts[0].id} notes.md (read_attachment)`));
    assert.ok(!prompt.includes('ship it friday'), 'a quoted message\'s file is listed, never inlined');

    const n = historyCalls.length;
    say('and one more', { chatId: 'TH34' });
    await waitFor(() => posts.some((p) => p.chatId === 'TH34' && textOf(p).includes('[mock] and one more')));
    assert.equal(historyCalls.length, n, 'a message in the bound thread reads no history');
  } finally {
    writeCfg({ historyOnStart: null });
    setMockChannelBehavior({ '*': behavior });
    _testing.setChatFileFetch(null);
    H.setThreadId(() => 'TH1');
  }
  await idle(binding('TH34').askThreadId);
});

// 35 (live status, discord-chat 0.5.0): on a channel that declares liveStatus, a slow turn posts "⏳ Working on it…" in
// its new thread at once with the typing indicator on, the reply is edited INTO that message, typing stops, the
// mention goes ✅, and the status row is gone. The other fixture channels (no liveStatus) never post one (cases 1-34).
test('35. live status: a slow turn shows a working message that becomes the answer', async () => {
  _testing.chatBridge.resetRateLimits();
  const { listStatuses } = await import('../src/core/chat/conversations.mjs');
  const askStore = await ask();
  H.setThreadId(() => 'LTH1');
  // Hold the turn after its first text delta past one status tick (5 s): the server forwards the turn's ask-delta to
  // the bridge, so that tick's edit names the activity.
  const mock = await import('../src/core/engines/mock.mjs');
  let held = false;
  mock._testing.holdFrame = (f) => {
    if (held || f?.event?.delta?.type !== 'text_delta') return null;
    held = true;
    return new Promise((r) => setTimeout(r, 6500));
  };
  const before = posts.length;
  try {
    const mid = `lmsg${++nextId}`;
    channelHost.injectInboundMessage(NAME3, 'main', { chatId: 'L1', userId: 'U1', text: '<@BOT1> MOCK_SLOW explain the plan',
      meta: { platform: 'discord', messageId: mid, guildId: 'G1', isGroup: true, mentionsBot: true, botId: 'BOT1' } });
    const b = await waitFor(() => findConversation({ plugin: NAME3, channelId: 'main', chatId: 'LTH1' }));
    const st = await waitFor(() => listStatuses(b.id)[0]);
    const statusPost = posts.slice(before).find((p) => p.chatId === 'LTH1' && !p.options && textOf(p) === '⏳ Working on it… this message will update.');
    assert.ok(statusPost, 'the status message is posted in the thread');
    await waitFor(() => typingLog.some((t) => t.chatId === 'LTH1' && t.on === true));
    const job = await waitFor(() => _testing.askJobs.get(b.askThreadId)?.turn && _testing.askJobs.get(b.askThreadId));
    assert.equal(job.status, 'running', 'the status is up while the turn still runs');
    const progress = await waitFor(() => posts.slice(before).find((p) => p.options?.edit?.messageId === st.platformMessageId), 9000);
    assert.match(textOf(progress), /^⏳ Working on it… · 5 s\nWriting the answer…$/, 'elapsed time and the activity, nothing of the text');
    await idle(b.askThreadId);
    const reply = askStore.listMessages(b.askThreadId).filter((m) => m.role === 'assistant').at(-1);
    assert.equal(reply.status, 'done');
    const edit = await waitFor(() => posts.slice(before).find((p) => p.options?.edit?.messageId === st.platformMessageId && textOf(p) === reply.text.trim()));
    assert.equal(edit.chatId, 'LTH1');
    assert.ok(!posts.slice(before).some((p) => !p.options && textOf(p) === reply.text.trim()), 'the answer is not posted a second time');
    await waitFor(() => typingLog.some((t) => t.chatId === 'LTH1' && t.on === false));
    await waitFor(() => marksOn(mid).includes(MARK.ok));
    assert.deepEqual(listStatuses(b.id), []);
    assert.equal(getDb().prepare("SELECT platform_message_id FROM chat_deliveries WHERE conversation_id = ? AND ask_message_id = ? AND part = 'text:0'").get(b.id, reply.id).platform_message_id, st.platformMessageId);
  } finally {
    mock._testing.holdFrame = null;
    H.setThreadId(() => 'TH1');
  }
});
