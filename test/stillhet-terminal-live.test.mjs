// test/stillhet-terminal-live.test.mjs — Stillhet's client for dev's terminal sessions (ui/public/stillhet/live/terminal-live.mjs,
// D14): a gone or not-running session opens nothing; output lines append from term-data; typed input goes through dev's
// shared line editor; Stop posts dev's stop; Close only detaches; a term-status end closes it.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SHELL_CLOSED } from '../ui/public/design-system/components/terminal-pane.mjs';
import assert from 'node:assert/strict';
import { createTerminalLive } from '../ui/public/stillhet/live/terminal-live.mjs';

function rig(answer) {
  const calls = [], sent = [];
  const fetch = async (url, o = {}) => { calls.push(`${o.method || 'GET'} ${url}`); const [status, body] = answer(url); return { ok: status < 300, status, json: async () => body }; };
  return { calls, sent, live: createTerminalLive({ fetch, send: (m) => sent.push(m), now: () => 0 }) };
}

test('a 404 and a session that is not running resolve closed, without term-attach', async () => {
  for (const [status, body] of [[404, { error: 'terminal not found' }], [200, { session: { id: 's1', status: 'exited' } }]]) {
    const r = rig(() => [status, body]);
    const s = await r.live.openSession('s1');
    assert.deepEqual(s, { closed: true, tip: SHELL_CLOSED });
    assert.deepEqual(r.sent, []);
  }
});

test('running: attach, replay and data lines, input through the line editor, Stop posts, Close detaches only, an end closes it', async () => {
  const r = rig((url) => (url.endsWith('/stop') ? [200, { ok: true }] : [200, { session: { id: 's1', status: 'running' } }]));
  const s = await r.live.openSession('s1');
  assert.equal(s.closed, false);
  assert.deepEqual(r.sent, [{ type: 'term-attach', sessionId: 's1' }]);
  let changes = 0; s.onChange(() => { changes++; });
  r.live.frame({ type: 'term-replay', sessionId: 's1', data: '$ ls\r\na.txt\r\n' });
  r.live.frame({ type: 'term-data', sessionId: 's1', data: 'b.txt\r\n' });
  r.live.frame({ type: 'term-data', sessionId: 'other', data: 'x\r\n' });
  assert.deepEqual(s.lines.map((l) => l.text), ['$ ls', 'a.txt', 'b.txt']);
  assert.ok(changes >= 2);
  s.send('pwd');
  assert.deepEqual(r.sent.at(-1), { type: 'term-input', sessionId: 's1', data: 'pwd\n' });
  await s.stop();
  assert.ok(r.calls.includes('POST /api/terminal/sessions/s1/stop'));
  r.live.frame({ type: 'term-status', snapshot: { id: 's1', status: 'exited' } });
  assert.equal(s.closed, true);
  s.close();
  assert.deepEqual(r.sent.at(-1), { type: 'term-detach', sessionId: 's1' });
  assert.ok(!r.calls.some((c) => c.includes('DELETE')), 'Close never ends the shell');
});

test('the closed tip is dev\'s SHELL_CLOSED word for word (ui/public/ask-command-card.mjs): one copy, the library\'s', () => {
  const dev = readFileSync('ui/public/ask-command-card.mjs', 'utf8').match(/const SHELL_CLOSED = '((?:[^'\\]|\\.)*)'/)[1].replace(/\\'/g, "'");
  assert.equal(SHELL_CLOSED, dev);
  assert.doesNotMatch(readFileSync('ui/public/stillhet/chat/conversation.js', 'utf8'), /shell has closed/, 'conversation.js keeps no copy');
});
