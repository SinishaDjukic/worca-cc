// test/stillhet-live-adapter-pr-frame-host.test.mjs — F-a1-02, F-a1-10 in the live Chat host (jsdom): a `history-pr` frame
// draws only when a row's PR really changed. A frame that repeats the PRs on screen makes no world change, no shell render
// (#rail-pulse-slot) and no conversation paint (RailUI.patchKeyed on #route-chat .convo-col); a real change draws once.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, clone, SOURCES, settle, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const OPEN = { url: 'https://x/pull/7', number: 7, state: 'OPEN', mergeable: 'MERGEABLE', checks: { state: 'pending', total: 2, pending: 2 } };

async function open() {
  const src = clone(SOURCES);
  src.history.pipelines = src.history.pipelines.map((p) => (p.id === 'h2' ? { ...p, projectKey: 'api-2' } : p));
  const h = await liveHost({ sources: src, hash: '#chat/ask_1' });
  const { w, d, sockets } = h;
  await settle(60);
  const send = (pr) => { sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'history-pr', token: w.RailTaskLive.prLookup().token, done: false, items: [{ projectKey: 'api-2', id: 'h2', pr }] }) }); };
  send(OPEN);
  await settle(60);
  const n = { world: 0, shell: 0, convo: 0 };
  const orig = w.RailUI.patchKeyed;
  w.RailUI.patchKeyed = (c, items, opt) => { if (c && c.matches && c.matches('#route-chat .convo-col')) n.convo++; return orig(c, items, opt); };
  const mo = new w.MutationObserver((l) => { n.shell += l.filter((r) => r.type === 'childList').length; });
  mo.observe(d.getElementById('rail-pulse-slot'), { childList: true, subtree: true });
  w.RailWorld.onChange(() => { n.world++; });
  const measure = async (pr) => {
    send(pr);
    await settle(60);
    n.shell += mo.takeRecords().filter((r) => r.type === 'childList').length;
    return { ...n };
  };
  return { ...h, measure };
}

test('F-a1-02 F-a1-10: a history-pr frame that changes no PR makes 0 world changes, 0 shell renders, 0 conversation paints', async () => {
  const h = await open();
  const n = await h.measure({ ...OPEN, stale: true, checks: { ...OPEN.checks } });
  assert.deepEqual(n, { world: 0, shell: 0, convo: 0 });
});

test('F-a1-02 F-a1-10: a PR that turns MERGED draws once', async () => {
  const h = await open();
  const n = await h.measure({ ...OPEN, state: 'MERGED' });
  assert.equal(n.world, 1);
  assert.ok(n.shell >= 1, `the shell renders the change (${n.shell})`);
  assert.ok(n.convo >= 1, `the conversation repaints the change, so its counter counts (${n.convo})`);
});

test('F-a1-02 F-a1-10: a PR whose checks turn failing draws once', async () => {
  const h = await open();
  const n = await h.measure({ ...OPEN, checks: { state: 'failing', total: 2, failed: 1 } });
  assert.equal(n.world, 1);
});
