// test/design-limits.test.mjs
// P8 Task 6: one rule for every concurrency limit (`src/core/design/limits.mjs`). Build fast's crew is up to 12 locally
// and in a person's own container, up to 6 on a hosted worca, up to 3 with fast off, and at most 24 agents run on the
// server; `WORCA_DESIGN_MAX_BUILDERS` and `WORCA_DESIGN_MAX_AGENTS` change them. On a shared server one person runs one
// build at a time (409 `person-busy`), and a new build or a Continue is refused at the global cap (409 `agents-full`)
// while a running build's next agent waits its turn. `GET /api/design/limits` serves the numbers the labels read.
//
// The rig holds every spawn on a per-design gate until `finishOne(designId)` opens the oldest one, so a lead really
// finishes, writes its plan, and its builders follow. A held spawn rejects when its signal aborts, and every test ends
// `r.pauseAll(); await r.settled()`.

import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { JSDOM } from 'jsdom';
import { newDesign, useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { checkRows } from './helpers/rows.mjs';
import { currentBillTo, currentOwner, withBillTo } from '../src/core/billing.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { CALM_CAP, FAST_CAP, GLOBAL_AGENT_CAP, HOSTED_FAST_CAP, designCaps } from '../src/core/design/limits.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { getBuild } from '../src/core/design/store.mjs';
import { createDesignChat } from '../ui/public/design/chat.mjs';
import { createLibrary } from '../ui/public/design/library.mjs';

const registries = [];
const servers = [];
after(async () => {
  for (const r of registries) { r.pauseAll(); await r.settled(); }
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((res) => srv.close(res)), new Promise((res) => setTimeout(res, 500).unref())]);
  }
});
useDesignEnv(after);

const PERSON_BUSY = 'You already have a build running: stop it or wait for it.';
const ROLE_RE = /^MOCK_ROLE: design-(\S+)/;
const DESIGN_RE = /(d_[0-9a-f]{12})/;
const pause = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * A registry over the mock whose every spawn is recorded as `{designId, role, bill, owner}` (`spawns()`) and held until
 * `finishOne(designId)` opens that design's oldest held spawn. `claims` lists the folders `claim` was asked to give.
 */
function rig({ caps, globalCap, personOf } = {}) {
  const spawns = [];
  const held = new Map();
  const claims = [];
  let peak = 0;
  let r = null;
  const opts = {
    broadcast: () => {},
    claimDir: (dir) => { claims.push(dir); },
    onLiveChange: () => { if (r) peak = Math.max(peak, r.liveAgentCount()); },
    deps: {
      staggerMs: 0,
      retryDelayMs: 0,
      runClaude: async (o) => {
        const designId = DESIGN_RE.exec(o.cwd)[1];
        spawns.push({ designId, role: ROLE_RE.exec(o.systemPrompt)?.[1] ?? null, bill: currentBillTo(), owner: currentOwner() });
        await new Promise((resolve, reject) => {
          const queue = held.get(designId) ?? [];
          held.set(designId, queue);
          // A ref'd bound: a promise settling only on an abort can drain the event loop on Node 22.
          const t = setTimeout(() => reject(new Error('hung')), 30000);
          const gate = { open: () => { clearTimeout(t); resolve(); } };
          o.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const i = queue.indexOf(gate);
            if (i !== -1) queue.splice(i, 1);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
          queue.push(gate);
        });
        return runClaude({ ...o, mock: true });
      },
    },
  };
  if (caps !== undefined) opts.caps = caps;
  if (globalCap !== undefined) opts.globalCap = globalCap;
  if (personOf !== undefined) opts.personOf = personOf;
  r = createDesignBuilds(opts);
  registries.push(r);
  const finishOne = (designId) => {
    const gate = held.get(designId)?.shift();
    assert.ok(gate, `no held spawn of ${designId}`);
    gate.open();
  };
  const heldOf = (designId) => held.get(designId)?.length ?? 0;
  return { r, spawns: () => spawns, finishOne, heldOf, claims, peak: () => peak };
}
const end = async (r) => { r.pauseAll(); await r.settled(); };
const refused = (status, code, message) => (e) => {
  assert.equal(e.status, status);
  assert.equal(e.code, code);
  if (message !== undefined) assert.equal(e.message, message);
  return true;
};

test('designCaps: 12 locally and in a container, 6 hosted, 3 off, 24 agents; the two variables change them', async () => {
  assert.deepEqual([CALM_CAP, FAST_CAP, HOSTED_FAST_CAP, GLOBAL_AGENT_CAP], [3, 12, 6, 24]);
  const row = (deployment, env, want) => ({
    name: `${deployment} ${JSON.stringify(env)}`,
    run: () => assert.deepEqual(designCaps({ deployment, env }), want),
  });
  await checkRows([
    row('local', {}, { fast: 12, calm: 3, global: 24 }),
    row('container', {}, { fast: 12, calm: 3, global: 24 }),
    row('hosted', {}, { fast: 6, calm: 3, global: 24 }),
    row('hosted', { WORCA_DESIGN_MAX_BUILDERS: '8' }, { fast: 8, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '2' }, { fast: 2, calm: 2, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '1' }, { fast: 1, calm: 1, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '40' }, { fast: 40, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '999' }, { fast: 40, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: 'x' }, { fast: 12, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '0' }, { fast: 12, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '2.5' }, { fast: 12, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '-3' }, { fast: 12, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_BUILDERS: '' }, { fast: 12, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_AGENTS: '5' }, { fast: 12, calm: 3, global: 5 }),
    row('local', { WORCA_DESIGN_MAX_AGENTS: '0' }, { fast: 12, calm: 3, global: 24 }),
    row('local', { WORCA_DESIGN_MAX_AGENTS: 'many' }, { fast: 12, calm: 3, global: 24 }),
    row('hosted', { WORCA_DESIGN_MAX_BUILDERS: '9', WORCA_DESIGN_MAX_AGENTS: '30' }, { fast: 9, calm: 3, global: 30 }),
  ]);
  assert.deepEqual(designCaps({ env: {} }), { fast: 12, calm: 3, global: 24 }, 'local by default');
  const saved = process.env.WORCA_DESIGN_MAX_AGENTS;
  process.env.WORCA_DESIGN_MAX_AGENTS = '7';
  try {
    assert.equal(designCaps().global, 7, 'the environment by default');
  } finally {
    if (saved === undefined) delete process.env.WORCA_DESIGN_MAX_AGENTS; else process.env.WORCA_DESIGN_MAX_AGENTS = saved;
  }
});

test('one per design; one per person on shared; a local person may run several', async () => {
  const { r } = rig();
  const a = newDesign({ createdBy: 'ada@x.com' });
  const b = newDesign({ createdBy: 'ada@x.com' });
  await r.start({ designId: a.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' });
  await assert.rejects(r.start({ designId: a.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' }), (e) => e.status === 409 && e.code === undefined && /this design/i.test(e.message));
  await assert.rejects(r.start({ designId: b.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' }), refused(409, 'person-busy', PERSON_BUSY));
  assert.ok((await r.start({ designId: b.id, brief: 'MOCK_SECTIONS=3', by: 'bob@x.com' })).buildId, 'another person');
  const c = newDesign();
  const d = newDesign();
  assert.ok((await r.start({ designId: c.id, brief: 'MOCK_SECTIONS=3', by: 'local' })).buildId);
  assert.ok((await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=3', by: 'local' })).buildId, 'local is no one person');
  await end(r);

  // The registry asks personOf: the server's answers null off a shared sign-in, so one name may run several there.
  const { r: open } = rig({ personOf: () => null });
  const e = newDesign({ createdBy: 'ada@x.com' });
  const f = newDesign({ createdBy: 'ada@x.com' });
  await open.start({ designId: e.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' });
  assert.ok((await open.start({ designId: f.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' })).buildId, 'personOf null: not a person');
  await end(open);
  // Both the check and the build it holds go by personOf: two spellings of one person are one person.
  const { r: folded } = rig({ personOf: (by) => (by ? by.toLowerCase() : null) });
  await folded.start({ designId: newDesign({ createdBy: 'ada@x.com' }).id, brief: 'MOCK_SECTIONS=3', by: 'Ada@x.com' });
  await assert.rejects(folded.start({ designId: newDesign({ createdBy: 'ada@x.com' }).id, brief: 'MOCK_SECTIONS=3', by: 'aDA@x.com' }), refused(409, 'person-busy', PERSON_BUSY));
  await end(folded);
});

test('continue meets the same refusals, in the same order', async () => {
  const { r, claims } = rig({ caps: { fast: 12, calm: 3, global: 1 } });
  const a = newDesign({ createdBy: 'ada@x.com' });
  const b = newDesign({ createdBy: 'ada@x.com' });
  const { buildId } = await r.start({ designId: b.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  r.get(buildId).pauseForDrain();
  await waitUntil(() => !r.get(buildId));
  assert.equal(getBuild(buildId).status, 'paused');
  await r.start({ designId: a.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  const claimed = claims.length;
  assert.throws(() => r.continueBuild({ designId: b.id, buildId, by: 'ada@x.com' }), refused(409, 'person-busy', PERSON_BUSY), 'the person first');
  assert.throws(() => r.continueBuild({ designId: b.id, buildId, by: 'bob@x.com' }),
    refused(409, 'agents-full', 'worca is running 1 agents, its limit: try again when one ends.'), 'then the global cap');
  assert.equal(claims.length, claimed, 'a refused Continue claims no folder');
  assert.equal(r.get(buildId), null, 'and leaves nothing in memory');
  await end(r);
});

test('M7: a resumed build counts against its person: once Ada continues B, her start of A is refused', async () => {
  const { r } = rig();
  const a = newDesign({ createdBy: 'ada@x.com' });
  const b = newDesign({ createdBy: 'ada@x.com' });
  const { buildId } = await r.start({ designId: b.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  r.get(buildId).pauseForDrain();
  await waitUntil(() => !r.get(buildId));
  assert.equal(getBuild(buildId).status, 'paused');
  assert.deepEqual(r.continueBuild({ designId: b.id, buildId, by: 'ada@x.com' }), { buildId });
  await assert.rejects(r.start({ designId: a.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' }), refused(409, 'person-busy', PERSON_BUSY));
  await end(r);
});

test('at the global cap: a new build is refused; waiting agents go in the order they asked', async () => {
  // No globalCap: the machine slots follow caps.global.
  const { r, spawns, finishOne, claims, peak } = rig({ caps: { fast: 12, calm: 3, global: 2 } });
  const a = newDesign();
  const b = newDesign();
  const c = newDesign();
  await r.start({ designId: a.id, brief: 'MOCK_SECTIONS=3', by: 'local' });
  await r.start({ designId: b.id, brief: 'MOCK_SECTIONS=3', by: 'local' });
  await waitUntil(() => r.liveAgentCount() === 2);
  await assert.rejects(r.start({ designId: c.id, brief: 'MOCK_SECTIONS=3', by: 'local' }),
    refused(409, 'agents-full', 'worca is running 2 agents, its limit: try again when one ends.'));
  assert.ok(!claims.some((dir) => dir.includes(c.id)), 'a refused start changes no folder modes');
  assert.deepEqual(r.live().filter((x) => x.designId === c.id), [], 'and opens no build');

  finishOne(a.id);
  await waitUntil(() => spawns().length === 3);
  assert.deepEqual([spawns()[2].designId, spawns()[2].role], [a.id, 'builder']);
  await waitUntil(() => r.liveAgentCount() === 2);
  finishOne(b.id);
  await waitUntil(() => spawns().length === 4);
  assert.deepEqual([spawns()[3].designId, spawns()[3].role], [a.id, 'builder'], "A's builders asked before B's");
  await pause(20);
  assert.equal(spawns().length, 4, 'nothing past the cap');
  assert.ok(peak() <= 2, `liveAgentCount() stayed <= 2 (peak ${peak()})`);
  await end(r);
});

test('a woken agent keeps its own person (regression pin, Review Focus 1)', async () => {
  const { r, spawns, finishOne } = rig({ caps: { fast: 12, calm: 3, global: Infinity }, globalCap: 1 });
  const a = newDesign({ createdBy: 'ada@x.com' });
  const b = newDesign({ createdBy: 'bob@x.com' });
  await r.start({ designId: a.id, brief: 'MOCK_SECTIONS=3', by: 'ada@x.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  await withBillTo('ada@x.com', () => r.start({ designId: b.id, brief: 'MOCK_SECTIONS=3', by: 'bob@x.com' }));
  await pause(20);
  assert.equal(spawns().filter((s) => s.designId === b.id).length, 0, "B's lead waits for the one slot");
  withBillTo('ada@x.com', () => finishOne(a.id));
  await waitUntil(() => spawns().some((s) => s.designId === b.id));
  const first = spawns().find((s) => s.designId === b.id);
  assert.equal(first.role, 'lead');
  assert.deepEqual([first.bill, first.owner], ['bob@x.com', 'bob@x.com']);
  await end(r);
});

test('M6 and M7: the cap follows fast at the next spawn and never kills', async () => {
  const { r, spawns, finishOne } = rig({ caps: { fast: 6, calm: 3, global: 24 } });
  const d = newDesign({ fast: false });
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_SECTIONS=10', by: 'local' });
  await waitUntil(() => spawns().length === 1);
  finishOne(d.id);
  const builders = () => spawns().filter((s) => s.role === 'builder').length;
  await waitUntil(() => builders() === 3);
  await pause(20);
  assert.equal(builders(), 3, 'fast off: 3');
  r.get(buildId).setFast(true);
  await waitUntil(() => builders() === 6);
  await pause(20);
  assert.equal(builders(), 6, 'fast on: 6');
  r.get(buildId).setFast(false);
  await pause(20);
  assert.equal(builders(), 6, 'still 6 spawned');
  assert.equal(r.liveAgentCount(), 6, 'and none killed');
  await end(r);
});

test('limits(): the fast and calm caps of this server', () => {
  assert.deepEqual(createDesignBuilds({ broadcast: () => {} }).limits(), { fast: 12, calm: 3 });
  assert.deepEqual(createDesignBuilds({ broadcast: () => {}, caps: designCaps({ deployment: 'hosted', env: {} }) }).limits(), { fast: 6, calm: 3 });
});

test('GET /api/design/limits answers {fast: 12, calm: 3} locally, {fast: 6, calm: 3} on a hosted worca', async () => {
  for (const [caps, want] of [[undefined, { fast: 12, calm: 3 }], [designCaps({ deployment: 'hosted', env: {} }), { fast: 6, calm: 3 }]]) {
    const app = express();
    app.use(express.json());
    const designBuilds = createDesignBuilds({ broadcast: () => {}, ...(caps ? { caps } : {}) });
    registries.push(designBuilds);
    registerDesignRoutes(app, { deps: { designBuilds } });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((res) => srv.once('listening', res));
    servers.push(srv);
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/design/limits`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), want);
  }
});

// ── The labels: the Library's composer and the chat dock read the limits once per instance ────────────────────────
const doms = [];
const made = [];
afterEach(() => {
  for (const m of made.splice(0)) m.destroy();
  for (const dom of doms.splice(0)) dom.window.close();
});
const flush = () => new Promise((res) => setImmediate(res));
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LIMITS_URL = '/api/design/limits';

/** The Library with `/api/design/limits` answering `answer` (null: 404), held until `release()` when `hold`. */
function mountLibrary(answer, { hold = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="h"></div></body></html>', { url: 'http://localhost/' });
  doms.push(dom);
  const win = dom.window;
  const doc = win.document;
  const urls = [];
  let release = () => {};
  const held = hold ? new Promise((res) => { release = res; }) : null;
  const fetch = async (url) => {
    urls.push(url);
    if (url === LIMITS_URL) {
      if (held) await held;
      return answer === null ? reply(404, { error: 'not found' }) : reply(200, answer);
    }
    if (url === '/api/design') return reply(200, []);
    return reply(404, { error: 'not found' });
  };
  made.push(createLibrary({ doc, win, host: doc.getElementById('h'), fetch, navigate() {} }));
  const cap = () => doc.querySelector('.dz-fast-cap');
  // Build fast starts on: a click is needed only when a test turned it off.
  const on = () => { const sw = doc.querySelector('.dz-fast [role=switch]'); if (!sw.checked) sw.click(); };
  return { urls, cap, on, release: () => release() };
}

test("the Library's Build fast label reads the server's cap", async () => {
  const six = mountLibrary({ fast: 6, calm: 3 });
  await flush();
  six.on();
  assert.equal(six.cap().hidden, false);
  assert.equal(six.cap().textContent, 'up to 6');
  assert.equal(six.urls.filter((u) => u === LIMITS_URL).length, 1, 'asked once');
  const missing = mountLibrary(null);
  await flush();
  missing.on();
  assert.equal(missing.cap().textContent, 'up to 12', 'a 404: the next Library does not inherit 6');
  for (const half of [{ fast: '6', calm: 3 }, { fast: 6 }, { fast: 6.5, calm: 3 }, [6, 3]]) {
    const lib = mountLibrary(half);
    await flush();
    lib.on();
    assert.equal(lib.cap().textContent, 'up to 12', JSON.stringify(half));
  }
  const late = mountLibrary({ fast: 6, calm: 3 }, { hold: true });
  late.on();
  assert.equal(late.cap().textContent, 'up to 12', 'until the answer comes');
  late.release();
  await flush();
  await flush();
  assert.equal(late.cap().textContent, 'up to 6', 'then the answer');
});

/** The chat dock on a design with fast off, `/api/design/limits` answering `answer` (null: 404). */
async function mountChat(answer) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doms.push(dom);
  const doc = dom.window.document;
  const host = doc.createElement('div');
  host.className = 'dz-chat-slot';
  doc.body.appendChild(host);
  const design = { id: 'd_00000000a001', threadId: 'ask_00000001', kind: 'web', fast: false, status: 'done', version: 2 };
  const urls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (method === 'GET') urls.push(url);
    if (method === 'GET' && url === LIMITS_URL) return answer === null ? reply(404, { error: 'not found' }) : reply(200, answer);
    if (method === 'GET' && url === '/api/ask/models') return reply(200, { default: { model: 'm', effort: 'e' }, models: [] });
    if (method === 'GET' && url === `/api/ask/threads/${design.threadId}`) {
      return reply(200, { thread: { id: design.threadId, mode: 'design', title: 'T', designId: design.id }, messages: [], attachments: [], runLinks: [], inFlight: null });
    }
    if (method === 'PATCH') return reply(200, { ...design, ...JSON.parse(init.body) });
    return reply(404, { error: 'no route' });
  };
  made.push(createDesignChat({ doc, host, design, fetch, renderMarkdown: (text, el) => { el.textContent = text; } }));
  for (let i = 0; i < 4; i += 1) await new Promise((res) => setTimeout(res, 0));
  const cap = () => host.querySelector('.dsc-fast-cap').textContent;
  const toggle = async () => {
    host.querySelector('.dsc-fast input').click();
    for (let i = 0; i < 4; i += 1) await new Promise((res) => setTimeout(res, 0));
  };
  return { urls, cap, toggle };
}

test("the chat's Build fast label reads the server's caps, off and on", async () => {
  const plain = await mountChat({ fast: 12, calm: 3 });
  assert.equal(plain.cap(), 'up to 3');
  assert.equal(plain.urls.filter((u) => u === LIMITS_URL).length, 1, 'asked once');
  const two = await mountChat({ fast: 2, calm: 2 });
  assert.equal(two.cap(), 'up to 2');
  const split = await mountChat({ fast: 5, calm: 2 });
  assert.equal(split.cap(), 'up to 2', 'off reads calm');
  await split.toggle();
  assert.equal(split.cap(), 'up to 5', 'on reads fast');
  for (const half of [null, { fast: 6 }, { fast: 6, calm: '3' }, { fast: 6, calm: 2.5 }]) {
    const chat = await mountChat(half);
    assert.equal(chat.cap(), 'up to 3', JSON.stringify(half));
    await chat.toggle();
    assert.equal(chat.cap(), 'up to 12', JSON.stringify(half));
  }
});
