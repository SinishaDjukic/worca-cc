import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, srv, base, mod, store, prevHome;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askq-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const idle = async () => { for (let i = 0; i < 500 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10)); };
function qThread(card, cardId) {
  const t = store.createThread();
  store.appendMessage(t.id, { role: 'user', text: 'help me' });
  store.appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card }] });
  return t;
}
const CHOICE = { type: 'question', answer: 'choice', question: 'Which branch should the run use?', options: [{ id: 'main', label: 'main' }, { id: 'dev', label: 'dev' }] };

test('question card route: a junk choice is 400; a pick answers once (choice kept on the card), the mock event turn replies, a second answer is 409', async () => {
  await idle();
  const t = qThread(CHOICE, 'card_0000cc01');
  const url = `/api/ask/threads/${t.id}/cards/card_0000cc01`;
  assert.equal((await post(url, { choice: 'constructor' })).status, 400);
  const r = await post(url, { choice: 'dev' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([j.block.state, j.block.card.choice, typeof j.turn.assistantMessageId], ['answered', 'dev', 'string']);
  await idle();
  const reply = store.listMessages(t.id).at(-1);
  assert.match(reply.text, /^Got it: option "dev"/, 'the qEvent arm answered');
  assert.deepEqual((reply.blocks || []).map((b) => b.kind), [], 'the event text names "the run", but the run arm stays off (no propose_run)');
  const again = await post(url, { choice: 'main' });
  assert.deepEqual([again.status, (await again.json()).error], [409, 'card is answered']);
});
