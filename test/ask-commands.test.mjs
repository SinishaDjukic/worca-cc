// test/ask-commands.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAskCommands, terminalEventPrompt, plainOutput } from '../src/core/ask/commands.mjs';

function fakeTerminals() {
  const t = new EventEmitter();
  let n = 0; const sessions = new Map(); const blocks = new Map();
  Object.assign(t, {
    opened: [], typed: [], stopped: [], closed: [],
    async open(o) { const id = `t-${String(++n).padStart(10, '0')}`; sessions.set(id, { id, status: 'running', shellKind: 'bash', ...o, seq: 0, live: null }); t.opened.push(o); return { id, ...o }; },
    get: (id) => sessions.get(id) || null,
    free: (id) => !!sessions.get(id) && sessions.get(id).status === 'running' && !sessions.get(id).live,
    cwdOf: (id) => sessions.get(id)?.cwdNow ?? sessions.get(id)?.cwd ?? null,   // test driver: set s.cwdNow to "cd"
    async runCommand(id, command, opts) {
      const s = sessions.get(id);
      if (opts.cwd && (s.cwdNow ?? s.cwd) !== opts.cwd) throw Object.assign(new Error('moved'), { code: 'MOVED' });
      s.seq += 1; s.live = { seq: s.seq, command, out: '', source: 'ask', runBy: opts.by };
      t.typed.push({ id, command, ...opts });
      const rec = { sessionId: id, seq: s.seq, command, status: 'running', source: 'ask', runBy: opts.by };
      blocks.set(`${id}:${s.seq}`, rec); t.emit('block', rec);
      return { seq: s.seq };
    },
    liveBlock: (id) => { const s = sessions.get(id); return s && s.live ? { sessionId: id, ...s.live, bytes: s.live.out.length, truncated: false } : null; },
    interrupt(id, by) { t.stopped.push({ id, by }); return { blockSeq: sessions.get(id)?.live?.seq ?? null }; },
    async close(id, by, reason) { t.closed.push({ id, by, reason }); sessions.get(id).status = 'closed'; return true; },
    person(id, command) {                                  // test driver: the user runs a command in that tab
      const s = sessions.get(id); s.seq += 1; s.live = { seq: s.seq, command, out: '', source: 'person', runBy: 'local' };
      const rec = { sessionId: id, seq: s.seq, command, status: 'running', source: 'person', runBy: 'local' };
      blocks.set(`${id}:${s.seq}`, rec); t.emit('block', rec);
    },
    input(id) { t.emit('input', { sessionId: id, by: 'local' }); },   // test driver: the user types in that tab
    finish(id, exitCode, out = '') {                       // test driver: the block ends (event without output, as the manager)
      const s = sessions.get(id); const rec = { ...blocks.get(`${id}:${s.live.seq}`), status: 'done', exitCode };
      blocks.set(`${id}:${s.live.seq}`, { ...rec, output: out }); s.live = null; t.emit('block', rec);
    },
    blocks,
  });
  return t;
}
const fakeStore = (t) => ({ getBlock: (sid, seq) => t.blocks.get(`${sid}:${seq}`) || null, listRecentBlocks: () => [...t.blocks.values()] });
const TARGET = { cwd: '/w/p', scope: 'project', label: 'p · main', projectKey: 'p', branch: 'main', runId: null, warning: null };
const tmp = mkdtempSync(join(tmpdir(), 'worca-ask-cmd-out-'));

function make(over = {}) {
  const terminals = fakeTerminals();
  const finished = []; const updates = []; const opened = [];
  const svc = createAskCommands({ terminals, store: fakeStore(terminals), resolveTarget: async () => TARGET,
    onFinish: (tid, b) => finished.push({ tid, b }), onUpdate: (tid, v) => updates.push({ tid, v }),
    onOpen: (tid, target) => opened.push({ tid, target }), threadTitle: () => 'Fix tests', hostPid: 1, serverPort: () => 4317,
    home: '/h/.worca-cc', setTimer: (fn, ms) => ({ fn, ms }), clearTimer: () => {}, outDirFor: (t) => join(tmp, t, 'out'), ...over });
  return { svc, terminals, finished, updates, opened };
}

test('run: opens an Ask session in the target, types the line, returns the block id', async () => {
  const { svc, terminals, opened } = make();
  const r = await svc.run('ask_0000aaaa', { command: 'npm test' });
  assert.equal(r.blockId, `${r.sessionId}:1`);
  assert.equal(terminals.opened[0].by, 'ask:ask_0000aaaa');
  assert.equal(terminals.opened[0].agent, true);
  assert.match(terminals.opened[0].label, /^Ask · Fix tests · p · main$/);
  assert.equal(terminals.typed[0].source, 'ask');
  assert.equal(opened.length, 1);                           // onOpen once per session (the run audit line)
  await svc.run('ask_0000aaaa', { command: 'ls' }).catch(() => {});
  assert.equal(opened.length, 2);                           // the first session is busy: a second one opens
});

test('run: refuses a blocked command before opening anything', async () => {
  const { svc, terminals } = make();
  await assert.rejects(svc.run('ask_0000aaaa', { command: 'git push --force' }), /blocked/);
  assert.equal(terminals.opened.length, 0);
});

test('run: at most 3 at once per chat; a finished one frees a slot and its idle session is reused', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'sleep 1' });
  await svc.run('ask_0000aaaa', { command: 'sleep 2' });
  await svc.run('ask_0000aaaa', { command: 'sleep 3' });
  await assert.rejects(svc.run('ask_0000aaaa', { command: 'ls' }), /3 commands/);
  terminals.finish(a.sessionId, 0);
  const d = await svc.run('ask_0000aaaa', { command: 'ls' });
  assert.equal(d.sessionId, a.sessionId);
  assert.equal(terminals.opened.length, 3);
});

test('#948 s2: running(threadId) counts the chat\'s running commands, 0 after they end and for another chat', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'sleep 1' });
  assert.equal(svc.running('ask_0000aaaa'), 1);
  assert.equal(svc.running('ask_0000bbbb'), 0);
  terminals.finish(a.sessionId, 0);
  assert.equal(svc.running('ask_0000aaaa'), 0);
});

test('a shell cd-ed within the project is kept: the check and runCommand use its real folder', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'cd packages/x' });
  terminals.get(a.sessionId).cwdNow = '/w/p/packages/x';           // the W mark after the line (or the user's own cd)
  terminals.finish(a.sessionId, 0);
  const b = await svc.run('ask_0000aaaa', { command: 'npm test' });
  assert.equal(b.sessionId, a.sessionId);                         // the user's cd, exports, venv survive
  assert.equal(b.cwd, '/w/p/packages/x');
  assert.equal(terminals.typed.at(-1).cwd, '/w/p/packages/x');    // runCommand guards the folder the check reasoned about
  terminals.finish(b.sessionId, 0);
  // Fine from the project folder, outside the session folder from packages/x: the real folder decides.
  await assert.rejects(svc.run('ask_0000aaaa', { command: 'rm -rf /w/p/build' }), /outside the session folder/);
  assert.equal(terminals.opened.length, 1);
});

test('a shell cd-ed outside the project is left alone: a fresh one opens in the project folder', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'cd /tmp' });
  terminals.get(a.sessionId).cwdNow = '/tmp';
  terminals.finish(a.sessionId, 0);
  for (const cwd of ['/w/pother', '/w']) {                        // a sibling with the same prefix is outside too
    terminals.get(a.sessionId).cwdNow = cwd;
    const b = await svc.run('ask_0000aaaa', { command: 'ls' });
    assert.notEqual(b.sessionId, a.sessionId);
    assert.equal(b.cwd, '/w/p');
    terminals.finish(b.sessionId, 0);
    terminals.get(b.sessionId).cwdNow = '/elsewhere';
  }
  assert.ok(!terminals.closed.some((x) => x.id === a.sessionId)); // never closed under the user
});

test('a move the pick could not see yet (MOVED): the pick runs again with the new folder; the shell stays open', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'cd sub' });
  terminals.finish(a.sessionId, 0);
  terminals.get(a.sessionId).cwdNow = '/w/p/sub';                 // the shell moved…
  const realCwdOf = terminals.cwdOf;
  let stale = true;
  terminals.cwdOf = (id) => (id === a.sessionId && stale ? (stale = false, '/w/p') : realCwdOf(id));   // …the first pick saw the old W mark
  const b = await svc.run('ask_0000aaaa', { command: 'ls' });
  assert.equal(b.sessionId, a.sessionId);
  assert.equal(b.cwd, '/w/p/sub');
  assert.equal(terminals.typed.at(-1).cwd, '/w/p/sub');
  assert.deepEqual(terminals.closed, []);
});

test('the user mid-command in Ask\'s tab: Ask runs in another slot, never fails BUSY', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'ls' });
  terminals.finish(a.sessionId, 0);
  terminals.person(a.sessionId, 'npm run dev');                    // the user starts a server in that tab
  const b = await svc.run('ask_0000aaaa', { command: 'git status' });
  assert.notEqual(b.sessionId, a.sessionId);
  assert.equal(terminals.opened.length, 2);
  // A person command that starts between the pick and the typing (BUSY from runCommand): one more pick.
  terminals.finish(b.sessionId, 0);
  const realRun = terminals.runCommand.bind(terminals);
  let raced = false;
  terminals.runCommand = async (id, command, opts) => {
    if (!raced) { raced = true; terminals.person(id, 'vim'); throw Object.assign(new Error('busy'), { code: 'BUSY' }); }
    return realRun(id, command, opts);
  };
  const c = await svc.run('ask_0000aaaa', { command: 'git log' });
  assert.ok(![a.sessionId, b.sessionId].includes(c.sessionId));
});

test('all slots taken by the user (busy, or moved out of the project): a clear refusal, nothing closed', async () => {
  const { svc, terminals } = make();
  const ids = [];
  for (let i = 0; i < 3; i += 1) { const r = await svc.run('ask_0000aaaa', { command: 'ls' }); ids.push(r.sessionId); }
  for (const id of ids) terminals.finish(id, 0);
  terminals.person(ids[0], 'npm run dev');
  terminals.input(ids[1]); terminals.get(ids[1]).cwdNow = '/tmp';  // the user works in this tab, outside the project
  terminals.input(ids[2]); terminals.get(ids[2]).cwdNow = '/etc';
  await assert.rejects(svc.run('ask_0000aaaa', { command: 'git status' }), (e) => e.code === 'NO_SLOT' && /in use/.test(e.message));
  assert.deepEqual(terminals.closed, []);
  assert.equal(terminals.opened.length, 3);
});

test('a slot the user never touched is recycled for another folder', async () => {
  const { svc, terminals } = make();
  const ids = [];
  for (let i = 0; i < 3; i += 1) { const r = await svc.run('ask_0000aaaa', { command: 'ls' }); ids.push(r.sessionId); }
  for (const id of ids) terminals.finish(id, 0);
  for (const id of ids) terminals.get(id).cwdNow = '/w/q';         // e.g. Ask's own cd in each
  terminals.input(ids[0]); terminals.input(ids[2]);
  const r = await svc.run('ask_0000aaaa', { command: 'ls' });
  assert.deepEqual(terminals.closed.map((c) => c.id), [ids[1]]);
  assert.equal(r.cwd, '/w/p');
});

test('person input and commands in an Ask session reset its idle close', async () => {
  const timers = [];
  const { svc, terminals } = make({ setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; } });
  const idle = () => timers.filter((t) => t.ms === 10 * 60_000 && t.live);
  const a = await svc.run('ask_0000aaaa', { command: 'ls' });
  terminals.finish(a.sessionId, 0);
  const first = idle()[0];
  terminals.input(a.sessionId);
  assert.equal(first.live, false);
  assert.equal(idle().length, 1);
  terminals.person(a.sessionId, 'make');
  terminals.finish(a.sessionId, 0);
  assert.equal(idle().length, 1);
  assert.notEqual(idle()[0], first);
  terminals.input('t-someone-else');                               // a person's own terminal: not Ask's business
  assert.equal(idle().length, 1);
});

test('takePersonCommands: the user\'s commands in this chat\'s sessions since the last take, redacted, then cleared', async () => {
  const { svc, terminals, finished } = make();
  const secret = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
  const a = await svc.run('ask_0000aaaa', { command: 'ls' });
  terminals.finish(a.sessionId, 0);
  terminals.person(a.sessionId, `export GH_TOKEN=${secret}`);
  terminals.finish(a.sessionId, 0);
  terminals.person(a.sessionId, 'npm test');
  terminals.finish(a.sessionId, 1);
  terminals.person(a.sessionId, 'npm run dev');                    // still running
  terminals.emit('block', { sessionId: 't-0000000099', seq: 1, status: 'running', source: 'person', command: 'whoami' });   // not Ask's
  assert.equal(finished.length, 1);                                // person commands never wake the chat
  const got = svc.takePersonCommands('ask_0000aaaa');
  assert.deepEqual(got.map((b) => [b.blockId, b.status, b.exitCode]),
    [[`${a.sessionId}:2`, 'done', 0], [`${a.sessionId}:3`, 'done', 1], [`${a.sessionId}:4`, 'running', null]]);
  assert.ok(!JSON.stringify(got).includes(secret));
  assert.equal(got[1].command, 'npm test');
  assert.deepEqual(svc.takePersonCommands('ask_0000aaaa'), []);
  assert.deepEqual(svc.takePersonCommands('ask_0000bbbb'), []);
});

test('finish: onFinish fires once per Ask block; seen() records an end a tool returned', async () => {
  const { svc, terminals, finished, updates } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'make' });
  terminals.finish(a.sessionId, 2, 'boom');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].tid, 'ask_0000aaaa');
  assert.equal(svc.seen(a.blockId), false);                 // nobody showed the model this end: the event turn runs
  assert.equal(updates.at(-1).v.tail, 'boom');              // the final card frame reads the output from the store
  const b = await svc.run('ask_0000aaaa', { command: 'make' });
  const w = svc.wait('ask_0000aaaa', { blockId: b.blockId, timeoutSec: 5, pollMs: 5 });
  terminals.finish(b.sessionId, 0);
  assert.equal((await w).status, 'done');
  assert.equal(finished.length, 2);                         // the service always reports; the server skips at start time
  assert.equal(svc.seen(b.blockId), true);                  // …because wait_for showed this end
});

test('a person-run block never fires onFinish', async () => {
  const { terminals, finished } = make();
  terminals.emit('block', { sessionId: 't-x', seq: 1, status: 'done', exitCode: 1, source: 'person', runBy: 'local' });
  assert.equal(finished.length, 0);
});

test('the 30-minute cap stops the command as ask:cap', async () => {
  const timers = [];
  const { svc, terminals } = make({ setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  const a = await svc.run('ask_0000aaaa', { command: 'npm run dev' });
  const cap = timers.find((t) => t.ms === 30 * 60_000);
  cap.fn();
  assert.deepEqual(terminals.stopped, [{ id: a.sessionId, by: 'ask:cap' }]);
});

test('a command whose start and end arrive in one chunk frees its slot and its cap timer', async () => {
  const timers = []; const cleared = [];
  const { svc, terminals, finished } = make({ setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => cleared.push(t) });
  const realRun = terminals.runCommand.bind(terminals);
  terminals.runCommand = async (id, command, opts) => {      // the manager emits running AND done before resolving
    const r = await realRun(id, command, opts);
    terminals.finish(id, 0);
    return r;
  };
  for (let i = 0; i < 4; i += 1) await svc.run('ask_0000aaaa', { command: 'true' });   // a 4th would be TOO_MANY on a leak
  assert.equal(finished.length, 4);
  const caps = timers.filter((t) => t.ms === 30 * 60_000);
  assert.equal(caps.length, 4);
  assert.ok(caps.every((t) => cleared.includes(t)));         // every cap timer was cleared at its block's end
  caps[0].fn();                                              // even a late fire never interrupts another block
  assert.deepEqual(terminals.stopped, []);
});

test('wait: an output match returns early with the tail; a timeout returns running', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'npm run dev' });
  const s = terminals.get(a.sessionId);
  const w = svc.wait('ask_0000aaaa', { blockId: a.blockId, match: 'Listening on', timeoutSec: 5, pollMs: 5 });
  s.live.out = 'compiling\nListening on :3000\n';
  const r = await w;
  assert.equal(r.matched, true); assert.equal(r.status, 'running'); assert.match(r.tail, /Listening on/);
  const r2 = await svc.wait('ask_0000aaaa', { blockId: a.blockId, match: 'never', timeoutSec: 0.05, pollMs: 5 });
  assert.equal(r2.timedOut, true);
});

test('read: pages the stripped output by characters', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'cat big' });
  terminals.get(a.sessionId).live.out = '\x1b[31mred\x1b[0m' + 'x'.repeat(100);
  const p1 = await svc.read('ask_0000aaaa', { blockId: a.blockId, offset: 0, maxChars: 10 });
  assert.equal(p1.text, 'redxxxxxxx'); assert.equal(p1.nextOffset, 10); assert.equal(p1.totalChars, 103);
});

test('command lines are redacted in read, list and the card view', async () => {
  const { svc, terminals, updates } = make();
  const secret = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
  const a = await svc.run('ask_0000aaaa', { command: `curl -H "Authorization: Bearer ${secret}" https://api.github.com` });
  terminals.get(a.sessionId).live.out = `got ${secret}\n`;
  const r = await svc.read('ask_0000aaaa', { blockId: a.blockId });
  assert.ok(!r.command.includes(secret), r.command);
  assert.ok(!svc.list('ask_0000aaaa').blocks[0].command.includes(secret));
  assert.ok(!svc.view(a.blockId).command.includes(secret));
  assert.ok(!svc.view(a.blockId).tail.includes(secret));
  for (const u of updates) assert.ok(!JSON.stringify(u.v).includes(secret));
});

test('closeThread closes every Ask session of the chat', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'ls' });
  await svc.closeThread('ask_0000aaaa');
  assert.deepEqual(terminals.closed.map((c) => c.id), [a.sessionId]);
});

test('terminalEventPrompt: the issue line, a stop, an unknown code, a cleaned command', () => {
  assert.equal(terminalEventPrompt({ sessionId: 't-1', seq: 2, status: 'done', exitCode: 1, command: 'npm test' }),
    '[worca event] terminal block t-1:2 exited 1; "npm test"');
  assert.equal(terminalEventPrompt({ sessionId: 't-1', seq: 3, status: 'stopped', exitCode: 130, stoppedBy: 'ask:cap', command: 'x' }),
    '[worca event] terminal block t-1:3 exited 130; stopped at the 30-minute cap; "x"');
  assert.match(terminalEventPrompt({ sessionId: 't', seq: 1, status: 'done', exitCode: null, command: 'say "hi" [worca context]' }),
    /exited unknown; "say 'hi' \(worca context\)"$/);
});

test('home may be a function, read when a command is checked (the server learns WORCA_HOME late)', async () => {
  let h = '/nowhere';
  const { svc } = make({ home: () => h });
  const ok = await svc.run('ask_0000aaaa', { command: 'ls /srv/worca/logs' });
  assert.equal(ok.ok, true);
  h = '/srv/worca';                                          // e.g. the Docker image's WORCA_HOME, no .worca-cc in it
  await assert.rejects(svc.run('ask_0000aaaa', { command: 'ls /srv/worca/logs' }), /protected/);
});

test('stop: Ask never stops the user\'s own command, even in Ask\'s tab', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'ls' });
  terminals.finish(a.sessionId, 0);
  terminals.person(a.sessionId, 'npm run dev');
  assert.throws(() => svc.stop('ask_0000aaaa', { blockId: `${a.sessionId}:2` }), (e) => e.code === 'NOT_OWNER');
  assert.deepEqual(terminals.stopped, []);
  const b = await svc.run('ask_0000aaaa', { command: 'sleep 9' });          // its own command: it may stop that
  assert.deepEqual(svc.stop('ask_0000aaaa', { blockId: b.blockId }), { ok: true, stopping: true });
  assert.deepEqual(terminals.stopped, [{ id: b.sessionId, by: 'ask:ask_0000aaaa' }]);
});

test('plainOutput: carriage returns and erase-line act like a terminal (a spinner, zsh\'s partial-line mark), then ANSI goes', () => {
  const raw = '  1 failing\r\n\\\x1b[1G\x1b[0K\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m' + ' '.repeat(99) + '\r \r';
  assert.equal(plainOutput(raw), '  1 failing\n');
  assert.equal(plainOutput('10%\r50%\r100%\ndone\n'), '100%\ndone\n');
  assert.equal(plainOutput('abcdef\rXY\n'), 'XYcdef\n', 'a CR overwrites, it does not erase');
  assert.equal(plainOutput('abc\x1b[Kdef\x1b[2Kx\n'), '      x\n', 'erase in line: to the end, then the whole line (the cursor stays)');
  assert.equal(plainOutput('\x1b[31mred\x1b[0m plain'), 'red plain');
  assert.equal(plainOutput('a\r\nb'), 'a\nb');
});

test('the card tail and read_output use plainOutput', async () => {
  const { svc, terminals } = make();
  const a = await svc.run('ask_0000aaaa', { command: 'npm test' });
  terminals.finish(a.sessionId, 1, '  1 failing\r\n\\\x1b[1G\x1b[0K%' + ' '.repeat(20) + '\r \r');
  assert.equal(svc.view(a.blockId).tail, '  1 failing\n');
  assert.equal((await svc.read('ask_0000aaaa', { blockId: a.blockId })).text, '  1 failing\n');
});

test('a session shell gets $WORCA_ASK_OUT (this chat\'s out folder); credentials stay out of its env', async () => {
  const { svc, terminals } = make({ baseEnv: { PATH: '/usr/bin', HOME: '/Users/me', GH_TOKEN: 'ghp_secret' } });
  await svc.run('ask_0000aaaa', { command: 'npm test' });
  assert.equal(terminals.opened[0].baseEnv.WORCA_ASK_OUT, join(tmp, 'ask_0000aaaa', 'out'));
  assert.equal('GH_TOKEN' in terminals.opened[0].baseEnv, false);
});

test('run() echoes a cleaned summary: trimmed, one line, at most 120 characters (#911)', async () => {
  // One fresh fixture per run, so no per-thread or busy-session limit can refuse a later call.
  const r1 = await make().svc.run('ask_0000aaaa', { command: 'npm test', summary: '  Running\nthe tests  ' });
  assert.equal(r1.summary, 'Running the tests');
  const r2 = await make().svc.run('ask_0000aaaa', { command: 'npm test', summary: 'x'.repeat(300) });
  assert.equal(r2.summary.length, 120);
  const r3 = await make().svc.run('ask_0000aaaa', { command: 'npm test' });
  assert.equal(r3.summary, null);
});
