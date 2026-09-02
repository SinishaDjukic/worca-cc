// P1/T8: ask_* persistence (ask-worca-design.md §7). Every test runs on a temp
// home; ids are minted by the store and read back from the returned objects.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import {
  ASK_ID_RE, newAskId, askRoot, attachmentsDir,
  createThread, getThread, listThreads, updateThread, setThreadTitle, addThreadTotals, deleteThread, sweepEmptyThreads,
  appendMessage, getMessage, listMessages, finishMessage, setMessageBlocks, findCard, updateCardBlock, sweepStreamingMessages,
  addAttachment, listAttachments, getAttachment, readAttachmentText, readAttachmentRaw,
  attachmentPath, threadAttachmentBytes,
  linkRun, updateRunLink, listRunLinks,
} from '../src/core/ask/store.mjs';

const HOME = useTempHome(after);

test('ids: prefix + 8 hex, matching ASK_ID_RE; askRoot under the worca home', () => {
  for (const p of ['ask', 'askm', 'att', 'card']) {
    const id = newAskId(p);
    assert.match(id, new RegExp(`^${p}_[0-9a-f]{8}$`));
    assert.match(id, ASK_ID_RE);
  }
  assert.ok(!ASK_ID_RE.test('ask_xyz'));
  assert.ok(!ASK_ID_RE.test('../etc_00000000'));
  assert.equal(askRoot(), join(worcaHome(), 'ask'));
  assert.equal(attachmentsDir('ask_00000001'), join(worcaHome(), 'ask', 'ask_00000001', 'att'));
});

test('createThread / getThread / updateThread / setThreadTitle', () => {
  const t = createThread({ model: 'claude-opus-5', effort: 'high' });
  assert.match(t.id, /^ask_[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(t).sort(),
    ['context', 'createdAt', 'effort', 'id', 'model', 'sessionId', 'title', 'totals', 'updatedAt']);
  assert.equal(t.title, null);
  assert.equal(t.sessionId, null);
  assert.equal(t.context, null);
  assert.deepEqual(t.totals, { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, turns: 0, agents: 0 });
  assert.deepEqual(getThread(t.id), t);
  assert.equal(getThread('ask_ffffffff'), null);

  const u = updateThread(t.id, { sessionId: 'sess-1', context: { view: 'history', projectKey: 'p-00000001' }, title: 'First' });
  assert.equal(u.sessionId, 'sess-1');
  assert.deepEqual(u.context, { view: 'history', projectKey: 'p-00000001' });
  assert.equal(u.title, 'First');
  assert.equal(u.model, 'claude-opus-5', 'untouched keys survive');
  assert.ok(u.updatedAt >= t.updatedAt);
  assert.equal(updateThread(t.id, { context: null }).context, null);
  assert.equal(updateThread('ask_ffffffff', { title: 'x' }), null);
  assert.equal(getThread(t.id).title, 'First');
  updateThread(t.id, { bogus: 1 });
  assert.equal(getThread(t.id).title, 'First', 'unknown keys in the patch are ignored');

  // D13: the background title replaces the deterministic one UNLESS the user renamed it meanwhile
  assert.equal(setThreadTitle(t.id, 'Generated', { onlyIf: 'First' }), true);
  assert.equal(getThread(t.id).title, 'Generated');
  assert.equal(setThreadTitle(t.id, 'Generated 2', { onlyIf: 'First' }), false, 'title moved on; not replaced');
  assert.equal(getThread(t.id).title, 'Generated');
  assert.equal(setThreadTitle(t.id, 'Renamed'), true, 'unconditional rename');
  assert.equal(setThreadTitle('ask_ffffffff', 'x'), false);
  const fresh = createThread();
  assert.equal(setThreadTitle(fresh.id, 'From null', { onlyIf: null }), true, 'IS NULL matches');
});

test('listThreads: newest updated first, runLinks count, limit', () => {
  const a = createThread({ title: 'a' });
  const b = createThread({ title: 'b' });
  getDb().prepare("UPDATE ask_threads SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
  linkRun(b.id, { runId: 'run-1' });
  linkRun(b.id, { runId: 'run-2' });
  const list = listThreads();
  const ids = list.map((x) => x.id);
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id), 'b (newer) before a');
  assert.equal(list.find((x) => x.id === b.id).runLinks, 2);
  assert.equal(list.find((x) => x.id === a.id).runLinks, 0);
  assert.equal(listThreads({ limit: 1 }).length, 1);
});

// db.mjs:44 designs for a second writing process (the CLI running a pipeline, a
// second UI). appendMessage reads MAX(seq) before it writes, so under a deferred
// BEGIN its transaction started as a WAL read snapshot and had to UPGRADE to a
// write lock — SQLITE_BUSY_SNAPSHOT, which the busy handler never retries. The
// whole tx() threw "database is locked" and the user's message was gone.
test('appendMessage: concurrent writer processes lose no row (the tx takes the write lock up front)', async () => {
  const t = createThread({ model: 'claude-opus-5', effort: 'high' });
  const storeUrl = new URL('../src/core/ask/store.mjs', import.meta.url).href;
  const KIDS = 3;
  const PER_KID = 40;
  const childScript = `
    const delay = Math.max(0, Number(process.env.__ASK_START_AT__) - Date.now());
    import(${JSON.stringify(storeUrl)}).then(({ appendMessage }) => {
      setTimeout(() => {
        try {
          for (let i = 0; i < ${PER_KID}; i++) {
            appendMessage(process.env.__ASK_THREAD__, { role: 'user', text: process.env.__ASK_TAG__ + ':' + i });
          }
          process.exit(0);
        } catch (err) { console.error(String((err && err.message) || err)); process.exit(1); }
      }, delay);
    }).catch((err) => { console.error(String((err && err.message) || err)); process.exit(1); });
  `;
  const startAt = Date.now() + 300;
  const kids = Array.from({ length: KIDS }, (_, k) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', childScript], {
      env: { ...process.env, WORCA_HOME: HOME, __ASK_START_AT__: String(startAt), __ASK_THREAD__: t.id, __ASK_TAG__: `k${k}` },
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, err: err.trim().split('\n').filter(Boolean).pop() || '' }));
  }));
  const results = await Promise.all(kids);
  assert.deepEqual(results.map((r) => [r.code, r.err]), Array.from({ length: KIDS }, () => [0, '']),
    'no writer is refused: with busy_timeout the loser queues, it does not fail');
  const rows = listMessages(t.id);
  assert.equal(rows.length, KIDS * PER_KID, 'every append landed');
  assert.deepEqual(rows.map((m) => m.seq), Array.from({ length: KIDS * PER_KID }, (_, i) => i + 1), 'seqs are unique and gapless');
  for (let k = 0; k < KIDS; k++) {
    assert.equal(rows.filter((m) => m.text.startsWith(`k${k}:`)).length, PER_KID, `writer k${k} kept all its rows`);
  }
});

test('appendMessage allocates seq = MAX(seq)+1 per thread, for any role, and bumps the thread', () => {
  const t = createThread();
  const before = getThread(t.id).updatedAt;
  const m1 = appendMessage(t.id, { role: 'user', text: 'hi' });
  const m2 = appendMessage(t.id, { role: 'assistant', status: 'streaming', model: 'm', effort: 'high' });
  const m3 = appendMessage(t.id, { role: 'system', text: 'Run started', blocks: [{ kind: 'notice', text: 'Run started', href: '#running/x' }] });
  const other = createThread();
  const o1 = appendMessage(other.id, { role: 'user', text: 'other thread' });
  assert.deepEqual([m1.seq, m2.seq, m3.seq, o1.seq], [1, 2, 3, 1]);
  assert.match(m1.id, /^askm_[0-9a-f]{8}$/);
  assert.equal(m1.text, 'hi');
  assert.equal(m1.blocks, null);
  assert.equal(m2.status, 'streaming');
  assert.deepEqual(m3.blocks, [{ kind: 'notice', text: 'Run started', href: '#running/x' }]);
  assert.deepEqual(listMessages(t.id).map((m) => m.id), [m1.id, m2.id, m3.id]);
  assert.ok(getThread(t.id).updatedAt >= before);
  assert.throws(() => appendMessage(t.id, { role: 'bot' }), /invalid role/);
  assert.throws(() => appendMessage('ask_ffffffff', { role: 'user' }), /unknown thread/);
  assert.equal(getMessage('askm_ffffffff'), null);
});

test('finishMessage / setMessageBlocks persist the turn outcome', () => {
  const t = createThread();
  const m = appendMessage(t.id, { role: 'assistant', status: 'streaming' });
  const done = finishMessage(m.id, {
    text: 'answer', blocks: [{ kind: 'tool', id: 'toolu_1', name: 'mcp__worca__list_runs', input: {}, status: 'done', durationMs: 12 }],
    status: 'done', usage: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 }, costUsd: 0.5, durationMs: 999,
  });
  assert.equal(done.text, 'answer');
  assert.equal(done.status, 'done');
  assert.equal(done.reason, null);
  assert.deepEqual(done.usage, { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 });
  assert.equal(done.costUsd, 0.5);
  assert.equal(done.durationMs, 999);
  const stopped = finishMessage(m.id, { text: 'partial', blocks: [], status: 'stopped', reason: 'max_turns', costUsd: null });
  assert.equal(stopped.reason, 'max_turns');
  assert.equal(stopped.costUsd, null, 'null cost survives (no result frame)');
  assert.deepEqual(setMessageBlocks(m.id, [{ kind: 'notice', text: 'x' }]).blocks, [{ kind: 'notice', text: 'x' }]);
  assert.equal(finishMessage('askm_ffffffff', { text: '', blocks: [], status: 'done' }), null);
});

test('cards: findCard / updateCardBlock patch only state, runId, error', () => {
  const t = createThread();
  const card = { kind: 'card', id: 'card_00000001', state: 'proposed', card: { target: 'project', projectKey: 'p-00000001', workflowId: 'wf_default', guardrailsId: 'normal', brief: 'b', title: 't' } };
  const m = appendMessage(t.id, { role: 'assistant', status: 'done', blocks: [{ kind: 'notice', text: 'n' }, card] });
  assert.deepEqual(findCard(t.id, 'card_00000001'), { message: m, block: card });
  assert.equal(findCard(t.id, 'card_ffffffff'), null);
  assert.equal(findCard(createThread().id, 'card_00000001'), null, 'scoped to the thread');
  const flipped = updateCardBlock(t.id, 'card_00000001', { state: 'started', runId: 'run-9', card: { hacked: true }, kind: 'tool' });
  assert.equal(flipped.state, 'started');
  assert.equal(flipped.runId, 'run-9');
  assert.equal(flipped.kind, 'card');
  assert.deepEqual(flipped.card, card.card, 'only state/runId/error are patchable');
  assert.deepEqual(getMessage(m.id).blocks[0], { kind: 'notice', text: 'n' }, 'sibling blocks untouched');
  assert.equal(updateCardBlock(t.id, 'card_ffffffff', { state: 'dismissed' }), null);
});

test('addThreadTotals sums every turn; null cost adds 0 but counts the turn', () => {
  const t = createThread();
  let tot = addThreadTotals(t.id, { costUsd: 0.25, usage: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 }, agents: 2 });
  assert.deepEqual(tot, { costUsd: 0.25, input: 10, output: 20, cacheRead: 30, cacheCreation: 40, turns: 1, agents: 2 });
  tot = addThreadTotals(t.id, { costUsd: null, usage: null });
  assert.deepEqual(tot, { costUsd: 0.25, input: 10, output: 20, cacheRead: 30, cacheCreation: 40, turns: 2, agents: 2 });
  tot = addThreadTotals(t.id, { costUsd: 0.1, usage: { input: 1 } });
  assert.equal(tot.costUsd, 0.35);
  assert.equal(tot.input, 11);
  assert.deepEqual(getThread(t.id).totals, tot);
  assert.equal(addThreadTotals('ask_ffffffff', {}), null);
});

test('addThreadTotals: usage.ctx OVERWRITES the thread ctx (context fill, never summed); a turn without ctx leaves it', () => {
  const t = createThread();
  let tot = addThreadTotals(t.id, { costUsd: 0.1, usage: { input: 10, output: 20, cacheRead: 0, cacheCreation: 0, ctx: 55000 } });
  assert.equal(tot.ctx, 55000);
  assert.equal(tot.input, 10, 'the cumulative buckets ignore ctx');
  tot = addThreadTotals(t.id, { costUsd: 0.1, usage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, ctx: 68400 } });
  assert.equal(tot.ctx, 68400, 'the later turn replaces');
  tot = addThreadTotals(t.id, { costUsd: null, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: null } });
  assert.equal(tot.ctx, 68400, 'a ctx-less turn (killed before any call) keeps the last figure');
  assert.equal(getThread(t.id).totals.ctx, 68400);
  const legacy = createThread();
  const legacyTot = addThreadTotals(legacy.id, { costUsd: 0.1, usage: { input: 5, output: 5 } });
  assert.ok(!('ctx' in legacyTot), 'no ctx ever supplied → the key stays absent (legacy threads render no fill)');
});

test('sweepStreamingMessages marks streaming rows error with a notice; others untouched', () => {
  sweepStreamingMessages();               // the sweep is GLOBAL: drain rows earlier tests in this file left streaming
  const t = createThread();
  const s1 = appendMessage(t.id, { role: 'assistant', status: 'streaming', blocks: [{ kind: 'tool', id: 'x', name: 'n', input: {}, status: 'running' }] });
  const s2 = appendMessage(t.id, { role: 'assistant', status: 'streaming' });
  const d = appendMessage(t.id, { role: 'assistant', status: 'done' });
  assert.equal(sweepStreamingMessages(), 2);
  assert.equal(getMessage(s1.id).status, 'error');
  assert.deepEqual(getMessage(s1.id).blocks.at(-1), { kind: 'notice', text: 'interrupted by restart' });
  assert.equal(getMessage(s1.id).blocks.length, 2);
  assert.deepEqual(getMessage(s2.id).blocks, [{ kind: 'notice', text: 'interrupted by restart' }]);
  assert.equal(getMessage(d.id).status, 'done');
  assert.equal(sweepStreamingMessages(), 0, 'idempotent');
});

test('a non-array blocks column cannot brick the sweep or the card lookup', () => {
  sweepStreamingMessages();
  const t = createThread();
  const poisoned = appendMessage(t.id, { role: 'assistant', status: 'streaming' });
  const healthy = appendMessage(t.id, { role: 'assistant', status: 'streaming', blocks: [{ kind: 'notice', text: 'keep' }] });
  // a JSON object parses truthy, so `parse(...) || []` handed a non-array to blocks.push():
  // the TypeError rolled the whole tx() back and left EVERY streaming row unswept, forever.
  getDb().prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(JSON.stringify({ kind: 'notice' }), poisoned.id);
  assert.equal(sweepStreamingMessages(), 2, 'both rows are swept');
  assert.deepEqual(getMessage(poisoned.id).blocks, [{ kind: 'notice', text: 'interrupted by restart' }], 'the poisoned value is replaced');
  assert.equal(getMessage(poisoned.id).status, 'error');
  assert.deepEqual(getMessage(healthy.id).blocks, [{ kind: 'notice', text: 'keep' }, { kind: 'notice', text: 'interrupted by restart' }]);
  const t2 = createThread();
  const m = appendMessage(t2.id, { role: 'assistant', status: 'done' });
  getDb().prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(JSON.stringify({ kind: 'card', id: 'card_00000001' }), m.id);
  assert.equal(findCard(t2.id, 'card_00000001'), null, 'findCard skips it instead of throwing');
  assert.equal(updateCardBlock(t2.id, 'card_00000001', { state: 'started' }), null);
});

test('attachments: file under askRoot/<thread>/att/<id>.txt, thread-scoped reads, byte totals', () => {
  const t = createThread();
  const m = appendMessage(t.id, { role: 'user', text: 'see file' });
  const a = addAttachment(t.id, m.id, { name: '../../evil/notes.md', text: 'héllo' });
  assert.match(a.id, /^att_[0-9a-f]{8}$/);
  assert.equal(a.name, 'notes.md', 'display name reduced to a basename');
  assert.equal(a.bytes, 6, 'UTF-8 byte length');
  assert.equal(a.messageId, m.id);
  const file = join(attachmentsDir(t.id), `${a.id}.txt`);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8'), 'héllo');
  assert.deepEqual(readAttachmentText(t.id, a.id), { ...a, text: 'héllo' });
  assert.equal(readAttachmentText(createThread().id, a.id), null, 'another thread cannot read it');
  assert.equal(getAttachment(t.id, 'att_ffffffff'), null);
  addAttachment(t.id, m.id, { name: 'b.txt', text: 'xx' });
  assert.equal(threadAttachmentBytes(t.id), 8);
  assert.equal(listAttachments(t.id).length, 2);
  assert.throws(() => addAttachment('ask_ffffffff', null, { name: 'x', text: 'y' }), /unknown thread/);
});

test('binary attachments (#398): raw bytes under <id>.<ext>, kind/mime on the row, text readers refuse them', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xfe, 0xff]);
  const t = createThread();
  const m = appendMessage(t.id, { role: 'user', text: 'see shot' });
  const a = addAttachment(t.id, m.id, { name: 'shot.png', kind: 'image', mime: 'image/png', data: png });
  assert.equal(a.kind, 'image');
  assert.equal(a.mime, 'image/png');
  assert.equal(a.bytes, png.length);
  const file = join(attachmentsDir(t.id), `${a.id}.png`);
  assert.ok(existsSync(file), 'body stored with the mime extension, not .txt');
  assert.deepEqual(readFileSync(file), png, 'bytes round-trip with no utf8 coercion');
  assert.equal(attachmentPath(t.id, a.id), file);
  assert.equal(attachmentPath(createThread().id, a.id), null, 'path is thread-scoped');
  assert.equal(readAttachmentText(t.id, a.id), null, 'a binary body is never served as text');
  const raw = readAttachmentRaw(t.id, a.id);
  assert.deepEqual(raw.buffer, png);
  assert.equal(raw.kind, 'image');
  // text rows still read raw too (the download route uses one reader for both)
  const txt = addAttachment(t.id, m.id, { name: 'n.txt', text: 'hey' });
  assert.equal(txt.kind, 'text');
  assert.equal(readAttachmentRaw(t.id, txt.id).buffer.toString('utf8'), 'hey');
  assert.equal(threadAttachmentBytes(t.id), png.length + 3, 'the thread byte total spans kinds');
  assert.throws(() => addAttachment(t.id, m.id, { name: 'x.png', kind: 'image', mime: 'image/png' }),
    /Buffer/, 'a non-text attachment without a Buffer body is refused');
  // a row that outlived its body must not hand out a dangling pointer
  unlinkSync(file);
  assert.equal(attachmentPath(t.id, a.id), null, 'no path for a body that is gone');
  assert.equal(readAttachmentRaw(t.id, a.id), null);
  assert.ok(getAttachment(t.id, a.id), 'the row itself is still there');
});

test('run links: insert, update, list', () => {
  const t = createThread();
  const l = linkRun(t.id, { runId: 'run-a', cardId: 'card_00000001' });
  assert.deepEqual(Object.keys(l).sort(),
    ['cardId', 'commentIds', 'createdAt', 'phase', 'pipelineId', 'runId', 'status', 'threadId']);
  assert.equal(l.pipelineId, null);
  const u = updateRunLink(t.id, 'run-a', { pipelineId: '4e1f2a9b', status: 'running', phase: 'implement' });
  assert.equal(u.pipelineId, '4e1f2a9b');
  assert.equal(u.status, 'running');
  assert.equal(updateRunLink(t.id, 'run-zzz', { status: 'x' }), null);
  linkRun(t.id, { runId: 'run-b' });
  assert.deepEqual(listRunLinks(t.id).map((x) => x.runId).sort(), ['run-a', 'run-b'], 'both links present (order not pinned: created_at can share a millisecond)');
  assert.throws(() => linkRun(t.id, { runId: 'run-a' }), /UNIQUE|PRIMARY/);
});

test('deleteThread cascades rows and removes the attachment directory', () => {
  const t = createThread();
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  addAttachment(t.id, m.id, { name: 'a.md', text: 'a' });
  linkRun(t.id, { runId: 'run-1' });
  const dir = join(askRoot(), t.id);
  assert.ok(existsSync(dir));
  assert.equal(deleteThread(t.id), true);
  assert.equal(getThread(t.id), null);
  assert.deepEqual(listMessages(t.id), []);
  assert.deepEqual(listAttachments(t.id), []);
  assert.deepEqual(listRunLinks(t.id), []);
  assert.ok(!existsSync(dir), 'ask/<thread> removed');
  assert.equal(deleteThread(t.id), false);
});

test('deleteThread refuses an id the store never minted — the rm -rf can never leave askRoot()', () => {
  // The attachment root is join(askRoot(), id). A row no store call created (raw
  // SQL, a foreign writer, a future import) with id `..` aimed that rmSync at the
  // whole worca home; the boot sweep would then run it unattended.
  const home = worcaHome();
  const keeper = createThread();
  const km = appendMessage(keeper.id, { role: 'user', text: 'keep me' });
  addAttachment(keeper.id, km.id, { name: 'k.md', text: 'keep' });
  const db = getDb();
  const old = '2000-01-01T00:00:00.000Z';
  for (const bad of ['..', '', '../..']) {
    db.prepare('INSERT INTO ask_threads (id, created_at, updated_at) VALUES (?, ?, ?)').run(bad, old, old);
  }
  assert.equal(deleteThread('..'), false, 'a traversal id is refused outright');
  assert.equal(deleteThread(''), false);
  assert.equal(sweepEmptyThreads({ olderThanMs: 24 * 60 * 60 * 1000 }), 0, 'the sweep counts only rows it really deleted');
  assert.ok(existsSync(home), 'the worca home survives');
  assert.ok(existsSync(join(home, 'worca-cc.db')), 'and so does the database');
  assert.ok(existsSync(join(askRoot(), keeper.id)), "another thread's attachment root survives");
  assert.ok(getThread(keeper.id), 'and its rows');
  db.prepare('DELETE FROM ask_threads WHERE id IN (?, ?, ?)').run('..', '', '../..');
});

test('the attachment WRITE and READ paths refuse an id the store never minted', () => {
  // Same precondition as deleteThread above — a row no store call created — on the
  // other two sides of the same path build. `addAttachment('..')` wrote its body to
  // <home>/.worca-cc/att/, `addAttachment('../../etc')` outside the worca home
  // entirely, and a foreign ask_attachments row let readAttachmentText return a file
  // from anywhere on disk.
  const home = worcaHome();
  const db = getDb();
  const old = '2000-01-01T00:00:00.000Z';
  const badThreads = ['..', '../../etc'];
  for (const bad of badThreads) {
    db.prepare('INSERT INTO ask_threads (id, created_at, updated_at) VALUES (?, ?, ?)').run(bad, old, old);
    assert.throws(() => attachmentsDir(bad), /thread id/, `attachmentsDir refuses ${bad}`);
    assert.throws(() => addAttachment(bad, null, { name: 'x.txt', text: 'SECRET' }), /thread id/, `addAttachment refuses ${bad}`);
  }
  assert.ok(!existsSync(join(askRoot(), '..', 'att')), 'nothing was written next to the ask root');
  assert.ok(!existsSync(join(home, '..', 'etc', 'att')), 'and nothing outside the worca home');

  // a legitimate thread carrying a foreign attachment row: the id is what builds the
  // file path, so it is shape-checked before the read, not just looked up
  const t = createThread();
  const m = appendMessage(t.id, { role: 'user', text: 'hi' });
  const good = addAttachment(t.id, m.id, { name: 'k.md', text: 'keep' });
  db.prepare('INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('../../../../etc/hosts', t.id, m.id, 'hosts', 0, old);
  assert.equal(readAttachmentText(t.id, '../../../../etc/hosts'), null, 'a traversal attachment id reads nothing');
  assert.deepEqual(readAttachmentText(t.id, good.id), { ...good, text: 'keep' }, 'a real attachment still reads');

  db.prepare('DELETE FROM ask_attachments WHERE id = ?').run('../../../../etc/hosts');
  db.prepare('DELETE FROM ask_threads WHERE id IN (?, ?)').run(...badThreads);
});

test('sweepEmptyThreads removes only message-less threads older than the cutoff', () => {
  const oldEmpty = createThread();
  const oldUsed = createThread();
  appendMessage(oldUsed.id, { role: 'user', text: 'keep' });
  const newEmpty = createThread();
  const old = '2000-01-01T00:00:00.000Z';
  getDb().prepare('UPDATE ask_threads SET created_at = ? WHERE id IN (?, ?)').run(old, oldEmpty.id, oldUsed.id);
  assert.equal(sweepEmptyThreads({ olderThanMs: 24 * 60 * 60 * 1000 }), 1);
  assert.equal(getThread(oldEmpty.id), null);
  assert.ok(getThread(oldUsed.id));
  assert.ok(getThread(newEmpty.id));
  // D1: ledger rows neither save an empty thread from the sweep nor die with it.
  const stray = createThread();
  getDb().prepare('UPDATE ask_threads SET created_at = ? WHERE id = ?').run(old, stray.id);
  getDb().prepare('INSERT INTO ask_cost_ledger (thread_id, amount_usd, ts) VALUES (?, ?, ?)')
    .run(stray.id, 0.5, Date.now());
  assert.equal(sweepEmptyThreads({ olderThanMs: 24 * 60 * 60 * 1000 }), 1,
    'a ledger row does not save an empty thread');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger WHERE thread_id = ?').get(stray.id).n, 1,
    'nor does the sweep touch the ledger (D1)');
});
