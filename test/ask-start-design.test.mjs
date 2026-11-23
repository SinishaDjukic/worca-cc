// test/ask-start-design.test.mjs — start_design, a plain chat's hand-off to Design (docs/design.md "From any chat"): the
// tool is listed only when the server's tab bridge says so (a plain chat with no design yet), the child forwards it, the
// prompt names it only then, and the server makes the design through the Design button's own create path, attaches it
// to the asking chat and starts its first build there: no second chat, no link. One in-process server on the mock
// engine with the design flag on (test/helpers/design-chat-boot.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { defaultTabDeps } from '../src/core/ask/tab-deps.mjs';
import { buildMcpConfig } from '../src/core/ask/spawn.mjs';
import { buildSystemPrompt, DESIGN_NO_PICTURES } from '../src/core/ask/prompt.mjs';
import { designPromptBlock } from '../src/core/ask/design-deps.mjs';
import { DESIGN_KINDS } from '../src/core/design/ids.mjs';

const { call, openWs, waitFor, mod } = await bootDesignChat(after);
const make = (tabs) => createAskTools({ limits: ASK_LIMITS, redact: (s) => String(s), ...(tabs ? { tabs } : {}) });
const BRIEF = 'A monkey illustration. Playful, for a kids\' page';

test('start_design is listed only when the bridge carries it, with the design kinds; the child forwards it', async () => {
  assert.equal(make(null).list().some((d) => d.name === 'start_design'), false);
  assert.equal(make({ open: async () => ({}) }).list().some((d) => d.name === 'start_design'), false, 'tabs alone: no hand-off');
  const seen = [];
  const answer = { ok: true, designId: 'd_1', title: 'A monkey illustration', kind: 'web', started: true };
  const tools = make({ startDesign: async (i) => { seen.push(i); return answer; } });
  const def = tools.list().find((d) => d.name === 'start_design');
  assert.deepEqual(def.inputSchema.properties.kind.enum, [...DESIGN_KINDS], 'the child\'s kinds are the store\'s');
  assert.match(def.description, /never draw SVG or HTML in this chat/);
  assert.match(def.description, /^Start a worca Design in THIS chat/);
  assert.match(def.description, /attaches it to this chat and starts its first build/);
  assert.match(def.description, /there is no link to give/);
  assert.doesNotMatch(def.description, /#design\//);
  assert.deepEqual(await tools.call('start_design', { brief: BRIEF, kind: 'web', projectKey: 'p' }), answer);
  assert.deepEqual(seen, [{ brief: BRIEF, kind: 'web', projectKey: 'p' }]);
  await assert.rejects(tools.call('start_design', { kind: 'web' }), /start_design: brief is required/);
  await assert.rejects(tools.call('start_design', { brief: 'x', kind: 'poster' }), /start_design: kind is one of web/);
  assert.equal(seen.length, 1, 'a refused call never reaches the server');
});

test('the bridge config: design rides the mcp env only when set; the child gets startDesign only then', () => {
  const env = (tabs) => buildMcpConfig({ homeBase: '/h', threadId: 'ask_0000aaaa', serverPath: '/s.mjs', env: {}, tabs }).mcpServers.worca.env.WORCA_ASK_TABS;
  const url = 'http://127.0.0.1:1/api/ask/tabs';
  assert.deepEqual(JSON.parse(env({ url, token: 't' })), { url });
  assert.deepEqual(JSON.parse(env({ url, token: 't', design: true })), { url, design: true });
  const deps = (cfg) => defaultTabDeps({ env: { WORCA_ASK_TABS: JSON.stringify(cfg), ASK_TABS_TOKEN: 't' }, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(deps({ url }), {}, 'neither tab tools nor design: no bridge deps');
  assert.equal(typeof deps({ url, tabs: true }).tabs.startDesign, 'undefined');
  assert.equal(typeof deps({ url, design: true }).tabs.open, 'undefined', 'the Tool panel flag off: start_design only');
  assert.equal(typeof deps({ url, design: true }).tabs.startDesign, 'function');
});

test('the prompt names start_design only with `design`; every other prompt stays byte-identical', () => {
  const plain = buildSystemPrompt([], { tabs: true });
  const withDesign = buildSystemPrompt([], { tabs: true, design: true });
  assert.doesNotMatch(plain, /start_design/);
  assert.equal(withDesign.startsWith(plain), true);
  const section = withDesign.slice(plain.length);
  assert.match(section, /^\n\n## Designs\n.*call start_design/s);
  assert.match(section, /in this chat, with a live preview in the Design tab beside it/);
  assert.match(section, /say in one short sentence what the crew is making and end your turn/);
  assert.doesNotMatch(section, /link/, 'no link to hand the user any more');
});

const bridgeFor = (threadId) => mod._testing.askTabBridge({ threadId });
const tabs = (b, op, input) => call('POST', '/api/ask/tabs', { op, input }, { 'x-worca-ask-tabs': b.token });

test('the server: a chat with no design has the hand-off on its bridge; a chat with a design (one per chat) does not, and is refused', async (t) => {
  const was = process.env.WORCA_FLAGS;
  t.after(() => { if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was; });
  const { createThread, getThread } = await import('../src/core/ask/store.mjs');
  delete process.env.WORCA_FLAGS;   // the Tool panel flag off: the hand-off alone; a design chat gets no bridge at all
  const off = bridgeFor(createThread({}).id);
  try { assert.equal(off.design, true); assert.equal(off.tabs, undefined); } finally { off.dispose(); }
  const offRead = bridgeFor(createThread({}).id);
  try { assert.equal((await tabs(offRead, 'read', { tabId: 'tab_a' })).status, 403, 'the tab ops refuse with the flag off'); } finally { offRead.dispose(); }
  process.env.WORCA_FLAGS = 'toolPanel';
  const plain = bridgeFor(createThread({}).id);
  const designTid = (await call('POST', '/api/design', { kind: 'web', title: 'Mine' })).body.threadId;
  const designChat = bridgeFor(designTid);
  try {
    assert.equal(getThread(designTid).mode ?? null, null, 'the Design button\'s chat is a plain chat');
    assert.equal(plain.design, true);
    assert.equal(designChat.design, undefined);
    const r = await tabs(designChat, 'startDesign', { brief: BRIEF, kind: 'web' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /^start_design: this chat has a design already: change it with change_design/);
  } finally { plain.dispose(); designChat.dispose(); }
});

test('the server: startDesign attaches a design named from the brief to the asking chat and starts its build there', async () => {
  const { createThread, getThread, listMessages, listThreads } = await import('../src/core/ask/store.mjs');
  const asking = createThread({ title: 'Asking' }).id;
  const threadsBefore = listThreads({ limit: 500, mode: 'any' }).length;
  const b = bridgeFor(asking);
  const frames = [];
  const ws = await openWs((f) => frames.push(f));
  try {
    const bad = await tabs(b, 'startDesign', { brief: BRIEF, kind: 'poster' });
    assert.deepEqual([bad.status, bad.body.code], [409, 'BAD_INPUT']);
    const r = await tabs(b, 'startDesign', { brief: BRIEF, kind: 'web' });
    assert.equal(r.status, 200);
    const out = r.body.result;
    assert.deepEqual(out, { ok: true, designId: out.designId, title: 'A monkey illustration', kind: 'web', started: true }, 'no link, no threadId');
    const detail = (await call('GET', `/api/design/${out.designId}`)).body;
    assert.deepEqual([detail.design.title, detail.design.threadId, detail.design.originThreadId], ['A monkey illustration', asking, asking]);
    assert.equal(listThreads({ limit: 500, mode: 'any' }).length, threadsBefore, 'no second chat');
    assert.deepEqual([getThread(asking).mode ?? null, getThread(asking).title], [null, 'Asking'], 'still a plain chat, its title kept');
    // The build's receipt is a row of the asking chat; no turn was started on the brief.
    const cards = listMessages(asking).flatMap((m) => m.blocks || []).filter((x) => x.kind === 'card' && x.card?.type === 'design-round');
    assert.equal(cards.length, 1, 'one design-round receipt in the asking chat');
    assert.equal(cards[0].card.designId, out.designId);
    assert.equal(listMessages(asking).some((m) => m.role === 'user'), false, 'the brief is no chat message');
    const ov = (await call('GET', `/api/ask/threads/${asking}/overview`)).body;
    assert.ok(ov.artifacts.some((x) => x.source === 'design' && x.designId === out.designId));
    assert.equal((await call('GET', `/api/ask/threads/${asking}`)).body.thread.designId, out.designId);
    // One design per chat: the same chat's second start is refused.
    const again = await tabs(b, 'startDesign', { brief: BRIEF, kind: 'web' });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /this chat has a design already/);
    // The chat's frame opens its Design tab on this broadcast.
    await waitFor(() => frames.find((f) => f.type === 'design-attached' && f.threadId === asking && f.designId === out.designId));
    await mod.designBuilds.settled();
  } finally { b.dispose(); ws.close(); }
});

test('the hand-off asks first while no image service is set up: the Designs section says so only then', () => {
  const cat = { agents: [], workflows: [] };
  const off = buildSystemPrompt(cat, { tabs: true, design: true, designPictures: false });
  const on = buildSystemPrompt(cat, { tabs: true, design: true, designPictures: true });
  assert.ok(off.includes(DESIGN_NO_PICTURES));
  assert.equal(on.includes(DESIGN_NO_PICTURES), false);
  assert.equal(buildSystemPrompt(cat, { tabs: true, design: true }), on, 'ready is the default: the section stays as it was');
  assert.match(DESIGN_NO_PICTURES, /ask first, before start_design/);
  assert.match(DESIGN_NO_PICTURES, /\(#providers\/images\)/);
  assert.match(DESIGN_NO_PICTURES, /when they say it is done, call start_design with what they first asked for/);
});
test('designPromptBlock reads the image service for the pictures line', async () => {
  const io = { designIdForThread: () => 'd_0123456789ab', getDesign: () => ({ id: 'd_0123456789ab', title: 'T', kind: 'web', status: 'empty', version: 0, pictures: true }),
    readPlan: () => null, latestBuild: () => null };
  assert.match(await designPromptBlock({ id: 't' }, { ...io, picturesReady: () => false }), /^pictures: not set up/m);
  assert.match(await designPromptBlock({ id: 't' }, { ...io, picturesReady: () => true }), /^pictures: on$/m);
  assert.doesNotMatch(await designPromptBlock({ id: 't' }, { ...io, picturesReady: () => { throw new Error('x'); } }), /^pictures:/m);
});
