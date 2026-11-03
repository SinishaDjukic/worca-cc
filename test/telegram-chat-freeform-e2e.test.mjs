// test/telegram-chat-freeform-e2e.test.mjs — telegram-chat 0.3 freeform chat end to end: the REAL Telegram worker
// (a channel-worker child spawned by the server's own channelHost) against a fake Bot API on 127.0.0.1, with the rest
// of the server under WORCA_MOCK=1 (mock Ask turns, mock runs). Cases share state in file order: run the whole file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setProxyEnv } from './helpers/proxy-net.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { findConversation } from '../src/core/chat/conversations.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { SAY } from '../src/core/chat/conversation-bridge.mjs';

process.env.WORCA_MOCK = '1';
useTempHome(after);
after(setProxyEnv({}));   // the worker child must reach 127.0.0.1 directly, whatever proxy the shell exports

const NAME = 'telegram-chat';
const BOT = { id: 4242, username: 'worca_bot' };
const ADA = { id: 111, first_name: 'Ada', username: 'ada' };   // a freeform member
const BEN = { id: 222, first_name: 'Ben', username: 'ben' };   // in the groups, not a member
const DM = { id: 111, type: 'private', first_name: 'Ada' };
const GROUP = { id: -200, type: 'group', title: 'devs' };
const FORUM = { id: -1003000, type: 'supergroup', title: 'ops', is_forum: true };
const CHATS = new Map([[String(DM.id), DM], [String(GROUP.id), GROUP], [String(FORUM.id), FORUM]]);
const MANIFEST = JSON.parse(readFileSync(new URL('../plugins/telegram-chat/worca-cc-plugin.json', import.meta.url), 'utf8'));
const SCHEMA = MANIFEST.chatChannels[0].configSchema;
const CFG = { botToken: '4242:test-token', allowedChatIds: `${DM.id},${GROUP.id},${FORUM.id}`, freeformChat: 'on',
  chatMembers: `${ADA.id}=ada@example.com`, worcaUrl: 'https://worca.example' };
const LOCK = { repoUrl: 'https://example.test/telegram.git', subdir: '', pinnedSha: 'b'.repeat(40), version: null, enabled: true, installedAt: '2026-11-03T00:00:00.000Z' };
const WORKER = new URL('../plugins/telegram-chat/channel/worker.mjs', import.meta.url).href;

let mod, channelHost, _testing, srv, home, projectDir;
const origCwd = process.cwd();
let cwdSandbox;
let chainSurface = null;   // case 5's reply chain, reused by case 8

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']); g(['branch', 'dev']);
}

// ── the fake Bot API ─────────────────────────────────────────────────────────

const tg = { calls: [], updates: [], waiting: [], nextUpdate: 1, nextMessage: {}, nextTopic: 70, failures: [] };
const reply = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const flushPolls = () => { for (const go of tg.waiting.splice(0)) go(); };
const nextMessageId = (chat) => { const k = String(chat); tg.nextMessage[k] = (tg.nextMessage[k] || 1000) + 1; return tg.nextMessage[k]; };
const api = http.createServer((req, res) => {
  const method = (/^\/bot[^/]+\/(\w+)/.exec(req.url || '') || [])[1] || '';
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    if (method === 'getMe') return reply(res, 200, { ok: true, result: { ...BOT, is_bot: true } });
    if (method === 'getUpdates') {
      const offset = Number(new URL(req.url, 'http://x').searchParams.get('offset')) || 0;
      tg.updates = tg.updates.filter((u) => u.update_id >= offset);
      const serve = () => reply(res, 200, { ok: true, result: tg.updates.slice() });
      if (tg.updates.length) return serve();
      const go = () => { clearTimeout(t); serve(); };
      const t = setTimeout(() => { tg.waiting = tg.waiting.filter((w) => w !== go); serve(); }, 500);
      tg.waiting.push(go);
      return undefined;
    }
    const body = raw ? JSON.parse(raw) : {};
    const f = tg.failures.find((x) => x.method === method && x.times > 0 && (!x.when || x.when(body)));
    if (f) { f.times -= 1; tg.calls.push({ method, body, failed: f.status }); return reply(res, f.status, f.reply); }
    let result = true;
    if (method === 'sendMessage') result = { message_id: nextMessageId(body.chat_id), chat: { id: Number(body.chat_id) }, text: body.text };
    if (method === 'createForumTopic') result = { message_thread_id: ++tg.nextTopic, name: body.name };
    if (method === 'editMessageText') result = { message_id: body.message_id, chat: { id: Number(body.chat_id) }, text: body.text };
    tg.calls.push({ method, body, result });
    return reply(res, 200, { ok: true, result });
  });
});

// ── people ───────────────────────────────────────────────────────────────────

let cqSeq = 0;
const push = (update) => { tg.updates.push({ update_id: tg.nextUpdate++, ...update }); flushPolls(); };
/** A person's message; `@worca_bot` in the text gets a mention entity. Returns its worca key and Telegram id. */
function say(chat, from, text, { topic = null, replyTo = null, edited = false } = {}) {
  const message_id = nextMessageId(chat.id);
  const at = text.indexOf(`@${BOT.username}`);
  const m = { message_id, date: 1, chat, from: { ...from, is_bot: from.is_bot === true }, text,
    ...(at >= 0 ? { entities: [{ type: 'mention', offset: at, length: BOT.username.length + 1 }] } : {}),
    ...(topic != null ? { message_thread_id: topic, is_topic_message: true } : {}),
    ...(replyTo != null ? { reply_to_message: { message_id: replyTo, date: 1, chat } } : {}) };
  push(edited ? { edited_message: m } : { message: m });
  return { key: `${chat.id}:${message_id}`, id: message_id };
}
/** The newest bot message (posted or edited) whose keyboard has a button `label`, in `chat` when given. */
function keyboardWith(label, chat = null) {
  for (const c of tg.calls.slice().reverse()) {
    if (!c.result || !['sendMessage', 'editMessageText', 'editMessageReplyMarkup'].includes(c.method)) continue;
    if (chat && String(c.body.chat_id) !== String(chat.id)) continue;
    const button = (c.body.reply_markup?.inline_keyboard || []).flat().find((b) => b.text === label);
    if (!button) continue;
    const messageId = c.method === 'sendMessage' ? c.result.message_id : c.body.message_id;
    const origin = tg.calls.find((x) => x.method === 'sendMessage' && x.result?.message_id === messageId && String(x.body.chat_id) === String(c.body.chat_id));
    return { button, messageId, chat: CHATS.get(String(c.body.chat_id)), topic: origin?.body.message_thread_id ?? null };
  }
  return null;
}
function press(from, kb) {
  assert.ok(kb, 'no such button');
  const id = `cq${++cqSeq}`;
  push({ callback_query: { id, from: { ...from, is_bot: false }, chat_instance: 'ci', data: kb.button.callback_data,
    message: { message_id: kb.messageId, date: 1, chat: kb.chat, ...(kb.topic != null ? { message_thread_id: kb.topic, is_topic_message: true } : {}) } } });
  return id;
}
const pressLabel = (from, label, chat) => press(from, keyboardWith(label, chat));

// ── observations ─────────────────────────────────────────────────────────────

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
function waitFor(pred, timeoutMs = 15000) {
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
const sentCalls = (pred = () => true) => tg.calls.filter((c) => c.method === 'sendMessage' && c.result && pred(c.body));
const textsIn = (chat, topic) => sentCalls((b) => String(b.chat_id) === String(chat.id) && (topic === undefined || b.message_thread_id === topic)).map((c) => c.body.text);
const has = (chat, needle, topic) => textsIn(chat, topic).some((t) => t.includes(needle));
const splitKey = (key) => { const i = key.lastIndexOf(':'); return [key.slice(0, i), Number(key.slice(i + 1))]; };
/** Every successful reaction call on a message, in order ('' = cleared). */
const reactionsOf = (key) => {
  const [chat, id] = splitKey(key);
  return tg.calls.filter((c) => c.method === 'setMessageReaction' && c.result && String(c.body.chat_id) === chat && c.body.message_id === id)
    .map((c) => c.body.reaction[0]?.emoji ?? '');
};
const reactionOn = (key) => reactionsOf(key).at(-1) ?? null;
/** What the presser saw: the toast text ('' = answered without one). */
const toast = async (id) => (await waitFor(() => tg.calls.find((c) => c.method === 'answerCallbackQuery' && c.body.callback_query_id === id))).body.text ?? '';
/** Button labels of a message as last posted or edited. */
const labelsAt = (chat, messageId) => {
  const c = tg.calls.filter((x) => x.result && String(x.body.chat_id) === String(chat.id)
    && ((x.method === 'sendMessage' && x.result.message_id === messageId) || (['editMessageText', 'editMessageReplyMarkup'].includes(x.method) && x.body.message_id === messageId))).at(-1);
  return (c?.body.reply_markup?.inline_keyboard || []).flat().map((b) => b.text);
};
const binding = (chatId) => findConversation({ plugin: NAME, channelId: 'main', chatId: String(chatId) });
const headerLabels = (chatId) => { const [chat, id] = splitKey(binding(chatId).headerMessageId); return labelsAt(CHATS.get(chat), id); };
const idle = (threadId) => waitFor(() => !_testing.askJobs.get(threadId) || _testing.askJobs.get(threadId).status !== 'running');
const ask = () => import('../src/core/ask/store.mjs');

/** The one real worker: spawned while WORCA_MOCK is off (channel-host's startEntry reads it synchronously, once). */
async function startRealWorker() {
  process.env.WORCA_MOCK = '0';
  try { channelHost.start({ plugin: NAME, channelId: 'main' }); } finally { process.env.WORCA_MOCK = '1'; }
  await waitFor(() => channelHost.status().find((r) => r.plugin === NAME)?.state === 'connected', 20000);
}

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-tgff-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  home = await mkdtemp(join(tmpdir(), 'worca-cc-tgff-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${api.address().port}`;
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify(MANIFEST));
  // The real worker, pointed at the fake API; callbackAckMs 5 s makes every host reply a toast in this test.
  writeFileSync(join(cur, 'channel', 'worker.mjs'), [
    `import { createTelegramWorker } from ${JSON.stringify(WORKER)};`,
    `const fetchFn = (u, init) => globalThis.fetch(String(u).replace('https://api.telegram.org', ${JSON.stringify(base)}), init);`,
    'const _sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50)));',
    'export function createChannelWorker(ctx) { return createTelegramWorker(ctx, { fetchFn, _sleep, callbackAckMs: 5000 }); }',
    '',
  ].join('\n'));
  writePluginsLock({ [NAME]: LOCK });
  writePluginConfig(NAME, SCHEMA, CFG);
  mod = await import('../ui/server.mjs');
  ({ _testing } = mod);
  ({ channelHost } = _testing);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await startRealWorker();
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-tgff-proj-'));
  gitInit(projectDir);
  const { addProject } = await import('../src/core/projects.mjs');
  await addProject({ name: 'demo', path: projectDir });
});

after(async () => {
  for (const [, job] of _testing?.askJobs || []) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  for (const r of mod?.runs?.values() || []) { try { r.orch?.stop?.(); } catch { /* reap */ } }
  mod?.runs?.clear();
  await channelHost?.stop();
  flushPolls();
  await Promise.race([new Promise((r) => { srv?.close(r); srv?.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  await Promise.race([new Promise((r) => { api.close(r); api.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  process.chdir(origCwd);
  closeDbForTests();
  const reap = (dir) => (dir ? rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {}) : null);
  await reap(cwdSandbox); await reap(home); await reap(projectDir);
  delete process.env.WORCA_MOCK;
});

// 1: a member's first DM opens the conversation in the DM itself: header (reply to the message), keyboard, reply, 👀 → 👌.
test('1. DM: the first message opens the conversation in the DM', async () => {
  _testing.chatBridge.resetRateLimits();
  const m = say(DM, ADA, 'what is running?');
  const b = await waitFor(() => binding(DM.id));
  assert.equal(b.parentChatId, String(DM.id));
  assert.equal(b.ownerUserId, String(ADA.id));
  assert.equal(b.worcaIdentity, 'ada@example.com');
  const header = sentCalls((x) => String(x.chat_id) === String(DM.id) && /worca chat/.test(x.text))[0];
  assert.equal(header.body.reply_parameters.message_id, m.id);
  assert.equal(b.headerMessageId, `${DM.id}:${header.result.message_id}`);
  await waitFor(() => has(DM, '[mock] what is running?'));
  await waitFor(() => headerLabels(DM.id).includes('Stop'));
  const labels = headerLabels(DM.id);
  for (const l of ['No project', 'demo', 'New conversation', 'Stop', 'Open in worca']) assert.ok(labels.includes(l), labels.join());
  for (const c of tg.calls) for (const k of (c.body.reply_markup?.inline_keyboard || []).flat()) if (k.callback_data) assert.ok(Buffer.byteLength(k.callback_data) <= 64, k.callback_data);
  await waitFor(() => reactionOn(m.key) === '👌');
  assert.deepEqual(reactionsOf(m.key), ['👀', '', '👌']);
});

// 2: later DM messages continue the same conversation; a command still answers in the DM.
test('2. DM: next messages continue; a command answers', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding(DM.id);
  await idle(b.askThreadId);
  const headers = () => sentCalls((x) => /worca chat/.test(x.text)).length;
  const h0 = headers();
  const m = say(DM, ADA, 'and what about yesterday?');
  await waitFor(() => has(DM, '[mock] and what about yesterday?'));
  assert.equal(binding(DM.id).id, b.id);
  assert.equal(headers(), h0, 'no second header');
  await waitFor(() => reactionOn(m.key) === '👌');
  await idle(b.askThreadId);
  const c = say(DM, ADA, '/help');
  await waitFor(() => has(DM, 'Worca chat commands'));
  await waitFor(() => reactionOn(c.key) === '👌');
});

// 3: New conversation and the Scope buttons work by press; New conversation is gone after a pick; an older header's
//    New conversation answers stale and changes nothing.
test('3. New conversation, scope pick, stale header control', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding(DM.id);
  await idle(b.askThreadId);
  const first = keyboardWith('New conversation', DM);
  assert.equal(await toast(press(ADA, first)), 'Started a new conversation.');
  const b2 = await waitFor(() => { const x = binding(DM.id); return x.askThreadId !== b.askThreadId && x; });
  await waitFor(() => has(DM, 'earlier messages stay in worca'));
  const fresh = await waitFor(() => { const k = keyboardWith('New conversation', DM); return k && k.button.callback_data !== first.button.callback_data && k; });
  assert.equal(await toast(pressLabel(ADA, 'demo', DM)), 'Scope: demo');
  await waitFor(() => !headerLabels(DM.id).includes('New conversation'));
  assert.equal(await toast(press(ADA, fresh)), SAY.stale);
  assert.equal(binding(DM.id).askThreadId, b2.askThreadId);
});

// 4: a run proposal gets a native Start run; Request changes asks for a typed reply (ForceReply) and that reply is the
//    change request; Start run starts once and then answers stale; a choice question is a button grid.
test('4. proposal: Start run, Request changes by reply, stale Start, choice buttons', async () => {
  _testing.chatBridge.resetRateLimits();
  const b = binding(DM.id);
  await idle(b.askThreadId);
  const { listMessages } = await ask();
  say(DM, ADA, 'propose a run to fix the login bug');
  const card = await waitFor(() => keyboardWith('Start run', DM));
  await idle(b.askThreadId);
  assert.deepEqual(labelsAt(DM, card.messageId), ['Start run', 'Not now', 'Request changes', 'Open in worca']);
  assert.match(card.button.callback_data, /^b:[A-Za-z0-9_-]{24}$/);
  const changes = keyboardWith('Request changes', DM);
  assert.match(changes.button.callback_data, /^m:[A-Za-z0-9_-]{24}$/);
  const users0 = listMessages(b.askThreadId).filter((m) => m.role === 'user').length;
  assert.equal(await toast(press(ADA, changes)), '', 'answered at once, without text');
  const prompt = await waitFor(() => sentCalls((x) => String(x.chat_id) === String(DM.id) && x.reply_markup?.force_reply === true).at(-1));
  assert.equal(prompt.body.reply_markup.selective, true);
  assert.match(prompt.body.text, /tg:\/\/user\?id=111/);
  say(DM, ADA, 'use the dev branch', { replyTo: prompt.result.message_id });
  const u = await waitFor(() => listMessages(b.askThreadId).filter((m) => m.role === 'user').at(users0));
  assert.match(u.text, /^Change request for the proposed run \(.+\): use the dev branch$/);
  await waitFor(() => has(DM, SAY.changesSent));
  await idle(b.askThreadId);
  _testing.chatBridge.resetRateLimits();
  assert.match(await toast(press(ADA, card)), /^Done/);
  await waitFor(() => tg.calls.some((c) => c.method === 'editMessageText' && c.result && c.body.message_id === card.messageId && /Run started/.test(c.body.text)));
  assert.equal(await toast(press(ADA, card)), SAY.stale);
  await idle(b.askThreadId);
  say(DM, ADA, 'MOCK_CHOICE pick a branch');
  const dev = await waitFor(() => keyboardWith('dev', DM));
  assert.match(dev.button.callback_data, /^s:[A-Za-z0-9_-]{24}:1$/);
  await idle(b.askThreadId);
  assert.match(await toast(press(ADA, dev)), /^Done/);
});

// 5: a group without topics: a mention opens a reply chain under the bot's header; replies to it continue; another
//    person's reply, another bot and an edit start nothing; another person's press toasts the plain owner sentence.
test('5. group reply chain', async () => {
  _testing.chatBridge.resetRateLimits();
  const m = say(GROUP, ADA, `@${BOT.username} status of the build?`);
  const header = await waitFor(() => sentCalls((x) => String(x.chat_id) === String(GROUP.id) && /worca chat/.test(x.text))[0]);
  assert.equal(header.body.reply_parameters.message_id, m.id);
  chainSurface = `${GROUP.id}:r${header.result.message_id}`;
  const b = await waitFor(() => binding(chainSurface));
  assert.equal(b.parentChatId, String(GROUP.id));
  const answer = await waitFor(() => sentCalls((x) => String(x.chat_id) === String(GROUP.id) && x.text.includes('[mock] status of the build?'))[0]);
  assert.ok(answer.body.reply_parameters, 'a chain post replies into the chain');
  await waitFor(() => reactionOn(m.key) === '👌');
  await idle(b.askThreadId);
  const ben = say(GROUP, BEN, 'me too', { replyTo: answer.result.message_id });
  say(GROUP, { id: 999, first_name: 'Other', is_bot: true }, 'bot chatter', { replyTo: answer.result.message_id });
  say(GROUP, ADA, `@${BOT.username} edited words`, { edited: true });
  const next = say(GROUP, ADA, 'and the tests?', { replyTo: answer.result.message_id });
  await waitFor(() => has(GROUP, '[mock] and the tests?'));
  await waitFor(() => reactionOn(next.key) === '👌');
  await settle(200);
  assert.deepEqual(reactionsOf(ben.key), []);
  for (const t of ['me too', 'bot chatter', 'edited words']) assert.ok(!has(GROUP, `[mock] ${t}`), t);
  await idle(b.askThreadId);
  assert.equal(await toast(pressLabel(BEN, 'Stop', GROUP)), 'Only the person who started this conversation can act on it.');
});

// 6: a forum: a mention inside a topic binds THAT topic (later messages there continue without a mention); a mention in
//    General opens a new topic named after the message and points to it under the mention.
test('6. forum topics', async () => {
  _testing.chatBridge.resetRateLimits();
  const m = say(FORUM, ADA, `@${BOT.username} deploy status?`, { topic: 7 });
  const b = await waitFor(() => binding(`${FORUM.id}:t7`));
  assert.equal(b.parentChatId, String(FORUM.id));
  const header = sentCalls((x) => String(x.chat_id) === String(FORUM.id) && /worca chat/.test(x.text))[0];
  assert.equal(header.body.message_thread_id, 7);
  await waitFor(() => has(FORUM, '[mock] deploy status?', 7));
  await waitFor(() => reactionOn(m.key) === '👌');
  await idle(b.askThreadId);
  const next = say(FORUM, ADA, 'and staging?', { topic: 7 });
  await waitFor(() => has(FORUM, '[mock] and staging?', 7));
  await waitFor(() => reactionOn(next.key) === '👌');
  const g = say(FORUM, ADA, `@${BOT.username} new incident`);
  const created = await waitFor(() => tg.calls.find((c) => c.method === 'createForumTopic' && c.result));
  assert.equal(created.body.name, 'worca: new incident');
  const topic = created.result.message_thread_id;
  const b2 = await waitFor(() => binding(`${FORUM.id}:t${topic}`));
  assert.equal(b2.parentChatId, String(FORUM.id));
  await waitFor(() => has(FORUM, '[mock] new incident', topic));
  const pointer = await waitFor(() => sentCalls((x) => String(x.chat_id) === String(FORUM.id) && x.reply_parameters?.message_id === g.id && /Continuing in the topic/.test(x.text))[0]);
  assert.match(pointer.body.text, new RegExp(`https://t\\.me/c/3000/${topic}`));
  await waitFor(() => reactionOn(g.key) === '👌');
});

// 7: failures never block handling or fake a success: a topic Telegram refuses → "That did not work" + 👎; a reaction
//    Telegram refuses (400) is dropped and the reply still lands with no mark; a 429 on a reaction is waited out.
test('7. refused topic, refused and rate-limited reactions', async () => {
  _testing.chatBridge.resetRateLimits();
  tg.failures.push({ method: 'createForumTopic', times: 1, status: 400, reply: { ok: false, error_code: 400, description: 'Bad Request: not enough rights to create a topic' } });
  const g = say(FORUM, ADA, `@${BOT.username} another incident`);
  await waitFor(() => textsIn(FORUM).some((t) => /That did not work/.test(t) && /Manage topics/.test(t)));
  await waitFor(() => reactionOn(g.key) === '👎');
  const b = binding(DM.id);
  await idle(b.askThreadId);
  const refusedId = (tg.nextMessage[String(DM.id)] || 1000) + 1;
  tg.failures.push({ method: 'setMessageReaction', times: 99, status: 400, when: (x) => x.message_id === refusedId && String(x.chat_id) === String(DM.id),
    reply: { ok: false, error_code: 400, description: 'Bad Request: REACTION_INVALID' } });
  const r = say(DM, ADA, 'quick question');
  assert.equal(r.id, refusedId);
  await waitFor(() => has(DM, '[mock] quick question'));
  await idle(b.askThreadId);
  await settle(300);
  assert.deepEqual(reactionsOf(r.key), [], 'no mark at all, never a false 👌');
  assert.ok(tg.calls.filter((c) => c.method === 'setMessageReaction' && c.failed === 400 && c.body.message_id === refusedId).length >= 2);
  tg.failures.length = 0;
  const limitedId = (tg.nextMessage[String(DM.id)] || 1000) + 1;
  tg.failures.push({ method: 'setMessageReaction', times: 1, status: 429, when: (x) => x.message_id === limitedId && String(x.chat_id) === String(DM.id),
    reply: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } } });
  const l = say(DM, ADA, 'one more');
  assert.equal(l.id, limitedId);
  await waitFor(() => reactionOn(l.key) === '👌');
  assert.ok(tg.calls.some((c) => c.method === 'setMessageReaction' && c.failed === 429 && c.body.message_id === limitedId));
  tg.failures.length = 0;
});

// 8: a restarted worker keeps its surfaces and keyboards (ctx.state): a reply in case 5's chain continues it, and a press
//    on the DM header's scope buttons from before the restart still works.
test('8. worker restart keeps chains and keyboards', async () => {
  _testing.chatBridge.resetRateLimits();
  const c = binding(chainSurface);
  await idle(c.askThreadId);
  await idle(binding(DM.id).askThreadId);
  writePluginsLock({ [NAME]: { ...LOCK, enabled: false } });
  await channelHost.reloadPlugin(NAME);
  writePluginsLock({ [NAME]: LOCK });
  await startRealWorker();
  const last = sentCalls((x) => String(x.chat_id) === String(GROUP.id) && x.text.includes('[mock] and the tests?')).at(-1);
  const m = say(GROUP, ADA, 'one more thing', { replyTo: last.result.message_id });
  await waitFor(() => has(GROUP, '[mock] one more thing'));
  await waitFor(() => reactionOn(m.key) === '👌');
  await idle(c.askThreadId);
  assert.equal(await toast(pressLabel(ADA, 'demo', DM)), 'Scope: demo');
});
