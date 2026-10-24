// P1/T8: ask_* persistence (ask-worca-design.md §7). Every test runs on a temp
// home; ids are minted by the store and read back from the returned objects.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import {
  ASK_ID_RE, newAskId, askRoot, attachmentsDir, askOutDir,
  createThread, getThread, listThreads, updateThread, setThreadTitle, addThreadTotals, addThreadContexts, deleteThread, sweepEmptyThreads,
  countThreads, listThreadIds, countWorktrees, countAttachments,
  appendMessage, getMessage, listMessages, finishMessage, setMessageBlocks, findCard, updateCardBlock, sweepStreamingMessages,
  findPullRequestCards, findFixRunCards,
  addAttachment, listAttachments, getAttachment, readAttachmentText, readAttachmentRaw,
  attachmentPath, attachmentSourcePath, attachmentSourceOrigin,
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

test('threads: create/get/update/setThreadTitle; listThreads newest-first with runLinks and limit; counts and id lists ignore the list cap', async () => {
  await checkRows([
    { name: 'createThread / getThread / updateThread / setThreadTitle', run: () => {
      const t = createThread({ model: 'claude-opus-5-5', effort: 'high' });
      assert.match(t.id, /^ask_[0-9a-f]{8}$/);
      assert.deepEqual(Object.keys(t).sort(),
        ['agentMode', 'context', 'contexts', 'createdAt', 'createdBy', 'effort', 'engine', 'id', 'mcpOff', 'model', 'sessionId', 'title', 'totals', 'updatedAt']);
      assert.equal(t.mcpOff, null, 'no MCP picker choices yet (v45)');
      assert.equal(t.agentMode, true, 'agent mode is on by default (v51, #574)');
      assert.equal(t.engine, null, 'no engine until the first turn stores one (v53, #635)');
      assert.equal(t.createdBy, null, 'ownerless unless created with an owner');
      assert.equal(t.title, null);
      assert.equal(t.sessionId, null);
      assert.equal(t.context, null);
      assert.deepEqual(t.contexts, []);
      assert.deepEqual(t.totals, { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, turns: 0, agents: 0 });
      assert.deepEqual(getThread(t.id), t);
      assert.equal(getThread('ask_ffffffff'), null);

      const u = updateThread(t.id, { sessionId: 'sess-1', context: { view: 'history', projectKey: 'p-00000001' }, title: 'First' });
      assert.equal(u.sessionId, 'sess-1');
      assert.deepEqual(u.context, { view: 'history', projectKey: 'p-00000001' });
      assert.equal(u.title, 'First');
      assert.equal(u.model, 'claude-opus-5-5', 'untouched keys survive');
      assert.ok(u.updatedAt >= t.updatedAt);
      assert.equal(updateThread(t.id, { context: null }).context, null);
      // MCP registry §9.4: the picker's choices round-trip as JSON like `context`; null clears.
      assert.deepEqual(updateThread(t.id, { mcpOff: { sets: ['billing'], members: ['shop|manual:pg'] } }).mcpOff, { sets: ['billing'], members: ['shop|manual:pg'] });
      assert.equal(getThread(t.id).context, null, 'an mcpOff patch leaves the context alone');
      assert.equal(updateThread(t.id, { mcpOff: null }).mcpOff, null);
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
    } },
    { name: 'listThreads: newest updated first, runLinks count, limit', run: () => {
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
    } },
    // The History popover shows the TOTAL, not the capped page; the bulk delete
    // walks EVERY id. Neither may go through listThreads (LIMIT 50/200).
    { name: 'countThreads / listThreadIds ignore the list cap; countWorktrees / countAttachments are global', run: () => {
      const before = countThreads();
      const made = [];
      for (let i = 0; i < 3; i += 1) made.push(createThread().id);
      assert.equal(countThreads(), before + 3);
      const ids = listThreadIds();
      assert.equal(ids.length, before + 3);
      for (const id of made) assert.ok(ids.includes(id));
      assert.ok(ids.every((id) => ASK_ID_RE.test(id)));
      const wtBefore = countWorktrees();
      getDb().prepare(`INSERT INTO ask_worktrees (id, thread_id, project_key, project_dir, ref, resolved_commit, worktree_dir, created_at, updated_at)
                   VALUES ('wt_00000001', ?, 'p', '/p', 'main', 'abc', '/tmp/wt', 't', 't')`).run(made[0]);
      assert.equal(countWorktrees(), wtBefore + 1);
      const attBefore = countAttachments();
      const m = appendMessage(made[1], { role: 'user', text: 'x' });
      addAttachment(made[1], m.id, { name: 'a.md', text: 'a' });
      addAttachment(made[1], m.id, { name: 'b.md', text: 'b' });
      assert.equal(countAttachments(), attBefore + 2);
      for (const id of made) deleteThread(id);
      assert.equal(countThreads(), before);
      assert.equal(countWorktrees(), wtBefore, 'the worktree row cascaded with its thread');
      assert.equal(countAttachments(), attBefore);
    } },
  ]);
});

// The History column's search (GET /api/ask/threads?q=): the title OR any message's text, case-insensitive, with `%`,
// `_` and `\` taken literally; the owner and surface filters still apply and the count is the filtered list's. The
// file shares one home, so every row carries a word no other test writes.
test('listThreads / countThreads query: title or message text, wildcards literal, owner and mode filters kept, count = the list', async () => {
  const tag = `zq${newAskId('x').slice(2)}`;
  const ids = (list) => list.map((x) => x.id).sort();
  await checkRows([
    { name: 'a title match, case-insensitive; the query is trimmed; a title hit carries no excerpt', run: () => {
      const a = createThread({ title: `Fix the ${tag}Login bug` });
      appendMessage(a.id, { role: 'user', text: `the ${tag}login page fails` });
      const list = listThreads({ query: `  ${tag}LOGIN ` });
      assert.deepEqual(ids(list), [a.id]);
      assert.equal(list[0].match, undefined, 'the title shows the hit itself, even when a message holds it too');
      assert.equal(countThreads({ query: `${tag}login` }), 1);
    } },
    { name: 'a message-text match (user or assistant) lists the chat with one plain excerpt around the first hit', run: () => {
      const b = createThread({ title: 'Offline sync banner' });
      appendMessage(b.id, { role: 'user', text: 'nothing here' });
      appendMessage(b.id, { role: 'assistant', text: `${'a'.repeat(200)}\n\nthe ${tag}Needle   lives here ${'b'.repeat(200)}` });
      appendMessage(b.id, { role: 'user', text: `again ${tag}needle` });
      const c = createThread({ title: 'Another' });
      appendMessage(c.id, { role: 'user', text: `ask about ${tag}needle once` });
      const list = listThreads({ query: `${tag}needle` });
      assert.deepEqual(ids(list), [b.id, c.id].sort());
      const snip = list.find((x) => x.id === b.id).match.snippet;
      assert.ok(snip.includes(`the ${tag}Needle lives here`), `around the first hit, whitespace collapsed: ${snip}`);
      assert.ok(snip.startsWith('…') && snip.endsWith('…'), 'cut on both sides');
      assert.ok(snip.length <= 100, `short: ${snip.length}`);
      assert.equal(list.find((x) => x.id === c.id).match.snippet, `ask about ${tag}needle once`, 'a short message whole');
      assert.equal(countThreads({ query: `${tag}needle` }), 2, 'the count runs the same message filter');
      assert.equal(listThreads({ query: `${tag}nothing` }).length, 0);
      assert.equal(countThreads({ query: `${tag}nothing` }), 0);
      assert.equal(listThreads().find((x) => x.id === b.id).match, undefined, 'no query, no excerpt');
    } },
    { name: 'a synthetic event row (a card action: its text is the model-facing [worca event] line, never shown) is not searched', run: () => {
      const word = `${tag}event`;
      const event = (id) => appendMessage(id, { role: 'user', text: `[worca event] workflow card card_0000ab01 saved as wf_123 "Release flow"; thenRun=false; project=${word}`,
        blocks: [{ kind: 'notice', synthetic: true, text: 'Saved "Release flow".' }] });
      const only = createThread({ title: 'Release work' });
      event(only.id);
      const both = createThread({ title: 'Release talk' });
      event(both.id);
      appendMessage(both.id, { role: 'assistant', text: `Saved it under ${word} for you` });
      const attached = createThread({ title: 'Notes' });
      appendMessage(attached.id, { role: 'user', text: `read ${word} notes`,
        blocks: [{ kind: 'attachment', id: 'att_1', name: '"synthetic":true.txt', bytes: 3, attKind: 'text', mime: 'text/plain' }] });
      const list = listThreads({ query: word });
      assert.deepEqual(ids(list), [both.id, attached.id].sort(), 'the event line alone matches nothing; a typed row with blocks still does');
      assert.equal(list.find((x) => x.id === both.id).match.snippet, `Saved it under ${word} for you`, 'the excerpt comes from a message the person can read');
      assert.equal(countThreads({ query: word }), 2);
      assert.equal(listThreads({ query: '[worca event] workflow card card_0000ab01' }).length, 0);
    } },
    { name: '%, _ and \\ in the query match themselves, never as LIKE wildcards', run: () => {
      const lit = createThread({ title: `100% ${tag}_done\\path` });
      const near = createThread({ title: `100x ${tag}xdone path` });
      assert.deepEqual(ids(listThreads({ query: `0% ${tag}` })), [lit.id], '% is a percent sign');
      assert.deepEqual(ids(listThreads({ query: `${tag}_d` })), [lit.id], '_ is an underscore');
      assert.deepEqual(ids(listThreads({ query: `${tag}_done\\p` })), [lit.id], '\\ is a backslash');
      assert.equal(countThreads({ query: `0% ${tag}` }), 1);
      assert.ok(near.id);
    } },
    { name: 'the owner filter still applies: a search never shows another person\'s chat on a shared sign-in', run: () => {
      const word = `${tag}own`;
      const alice = createThread({ title: 'Alice', createdBy: 'alice@example.com' });
      const bob = createThread({ title: `Bob ${word}`, createdBy: 'bob@example.com' });
      const anyone = createThread({ title: 'Ownerless' });
      appendMessage(alice.id, { role: 'user', text: `see ${word}` });
      appendMessage(bob.id, { role: 'user', text: `see ${word}` });
      appendMessage(anyone.id, { role: 'user', text: `see ${word}` });
      assert.deepEqual(ids(listThreads({ query: word, visibleTo: 'alice@example.com' })), [alice.id, anyone.id].sort());
      assert.equal(countThreads({ query: word, visibleTo: 'alice@example.com' }), 2);
      assert.deepEqual(ids(listThreads({ query: word })), [alice.id, bob.id, anyone.id].sort(), 'no viewer (local): all');
    } },
    { name: 'the surface filter still applies: composer chats only with mode composer', run: () => {
      const word = `${tag}mode`;
      const ask = createThread({ title: `Ask ${word}` });
      const comp = createThread({ title: `Composer ${word}`, mode: 'composer' });
      assert.deepEqual(ids(listThreads({ query: word })), [ask.id]);
      assert.deepEqual(ids(listThreads({ query: word, mode: 'composer' })), [comp.id]);
      assert.equal(countThreads({ query: word, mode: 'composer' }), 1);
    } },
    { name: 'the count is the filtered list\'s; an empty or blank query is no search', run: () => {
      for (const q of [tag, `${tag}needle`, `${tag}own`, `${tag}_`, `${tag}LOGIN`, `${tag}event`]) {
        assert.equal(countThreads({ query: q }), listThreads({ query: q, limit: 200 }).length, q);
      }
      assert.equal(countThreads({ query: '   ' }), countThreads());
      assert.deepEqual(ids(listThreads({ query: '', limit: 200 })), ids(listThreads({ limit: 200 })));
    } },
  ]);
});

// db.mjs:44 designs for a second writing process (the CLI running a pipeline, a
// second UI). appendMessage reads MAX(seq) before it writes, so under a deferred
// BEGIN its transaction started as a WAL read snapshot and had to UPGRADE to a
// write lock — SQLITE_BUSY_SNAPSHOT, which the busy handler never retries. The
// whole tx() threw "database is locked" and the user's message was gone.
test('appendMessage: concurrent writer processes lose no row (the tx takes the write lock up front)', async () => {
  const t = createThread({ model: 'claude-opus-5-5', effort: 'high' });
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
  // Run chains: `after` is a patchable key — the scheduled flip carries the predecessor to the card.
  const chained = updateCardBlock(t.id, 'card_00000001', { state: 'scheduled', runId: 'run-9', after: { kind: 'pipeline', id: 'p1', title: 'Refactor' } });
  assert.deepEqual(chained.after, { kind: 'pipeline', id: 'p1', title: 'Refactor' });
});

test('updateCardBlock: a command card takes a card sub-patch (#911 summary), keeping its other keys', () => {
  const t = createThread();
  const card = { kind: 'card', id: 'card_0000c001', state: 'command',
    card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'p', cwd: '/w', warning: null, summary: null } };
  const m = appendMessage(t.id, { role: 'assistant', status: 'done', blocks: [card] });
  const b = updateCardBlock(t.id, 'card_0000c001', { card: { summary: 'Running the tests' } });
  assert.equal(b.card.summary, 'Running the tests');
  assert.equal(b.card.command, 'npm test');
  assert.equal(getMessage(m.id).blocks[0].card.summary, 'Running the tests');
});

test('addThreadTotals: sums every turn (null cost adds 0 but counts), usage.ctx and ctxWindow REPLACE the stored values, garbage leaves them', async () => {
  await checkRows([
    { name: 'addThreadTotals sums every turn; null cost adds 0 but counts the turn', run: () => {
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
    } },
    { name: 'addThreadTotals: usage.ctx OVERWRITES the thread ctx (context fill, never summed); a turn without ctx leaves it', run: () => {
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
    } },
    { name: 'addThreadTotals: usage.ctxWindow REPLACES the stored window; a turn without one, or a garbage one, leaves it', run: () => {
      const t = createThread({});
      let tot = addThreadTotals(t.id, { costUsd: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 1000 } });
      assert.equal('ctxWindow' in tot, false, 'never reported: absent');
      tot = addThreadTotals(t.id, { costUsd: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 2000, ctxWindow: 1000000 } });
      assert.equal(tot.ctxWindow, 1000000);
      tot = addThreadTotals(t.id, { costUsd: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 3000 } });
      assert.equal(tot.ctxWindow, 1000000, 'a turn with no result keeps the last known window');
      tot = addThreadTotals(t.id, { costUsd: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 3000, ctxWindow: 0 } });
      assert.equal(tot.ctxWindow, 1000000, 'garbage is ignored');
      tot = addThreadTotals(t.id, { costUsd: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 3000, ctxWindow: 200000 } });
      assert.equal(tot.ctxWindow, 200000, 'a model switch replaces it');
      assert.equal(getThread(t.id).totals.ctxWindow, 200000, 'rowToThread surfaces it');
    } },
  ]);
});

test('sweepStreamingMessages marks streaming rows error with a notice (others untouched) and fails a building workflow card with the sweep text', async () => {
  await checkRows([
    { name: 'sweepStreamingMessages marks streaming rows error with a notice; others untouched', run: () => {
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
    } },
    { name: 'boot sweep: a streaming row\'s building workflow card turns failed with the sweep text', run: () => {
      const t = createThread();
      const m = appendMessage(t.id, { role: 'assistant', text: '', status: 'streaming' });
      setMessageBlocks(m.id, [{ kind: 'card', id: 'card_0000aa02', state: 'building', card: { type: 'workflow', mode: 'task' } }, { kind: 'card', id: 'card_0000aa03', state: 'proposed', card: { type: 'workflow' } }]);
      assert.equal(sweepStreamingMessages(), 1);
      const blocks = getMessage(m.id).blocks;
      assert.deepEqual(blocks.map((b) => [b.kind, b.state ?? null, b.error ?? null]), [['card', 'failed', 'interrupted by restart'], ['card', 'proposed', null], ['notice', null, null]]);
    } },
  ]);
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

test('attachments: text under askRoot/<thread>/att/<id>.txt, binary raw under <id>.<ext> with kind/mime; thread-scoped reads, byte totals, text readers refuse binaries', async () => {
  await checkRows([
    { name: 'attachments: file under askRoot/<thread>/att/<id>.txt, thread-scoped reads, byte totals', run: () => {
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
      assert.equal(listAttachments(t.id).length, 2);
      assert.throws(() => addAttachment('ask_ffffffff', null, { name: 'x', text: 'y' }), /unknown thread/);
    } },
    { name: 'binary attachments (#398): raw bytes under <id>.<ext>, kind/mime on the row, text readers refuse them', run: () => {
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
      assert.throws(() => addAttachment(t.id, m.id, { name: 'x.png', kind: 'image', mime: 'image/png' }),
        /Buffer/, 'a non-text attachment without a Buffer body is refused');
      // a row that outlived its body must not hand out a dangling pointer
      unlinkSync(file);
      assert.equal(attachmentPath(t.id, a.id), null, 'no path for a body that is gone');
      assert.equal(readAttachmentRaw(t.id, a.id), null);
      assert.ok(getAttachment(t.id, a.id), 'the row itself is still there');
    } },
  ]);
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

test('an id the store never minted is refused by deleteThread (rm -rf never leaves askRoot) and by the attachment write/read paths', async () => {
  await checkRows([
    { name: 'deleteThread refuses an id the store never minted — the rm -rf can never leave askRoot()', run: () => {
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
    } },
    { name: 'the attachment WRITE and READ paths refuse an id the store never minted', run: () => {
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
    } },
  ]);
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

test('updateCardBlock: workflow/metrics/policy cards shallow-merge a `card` sub-patch (workflowId kept); run cards stay immutable; unknown keys dropped', async () => {
  await checkRows([
    { name: 'workflow card: updateCardBlock keeps workflowId and shallow-merges a `card` sub-patch; run cards stay immutable; unknown keys dropped', run: () => {
      const t = createThread();
      const m = appendMessage(t.id, { role: 'assistant', text: '', status: 'done' });
      setMessageBlocks(m.id, [
        { kind: 'card', id: 'card_0000aa01', state: 'proposed', card: { type: 'workflow', name: 'Old', match: null, nodes: { n1: { model: 'a' } }, thenRun: false } },
        { kind: 'card', id: 'card_0000aa09', state: 'proposed', card: { target: 'project', projectKey: 'p-00000001', workflowId: 'wf_default', guardrailsId: 'normal', brief: 'b', title: 't' } },
      ]);
      const b = updateCardBlock(t.id, 'card_0000aa01', { state: 'saved', workflowId: 'wf_new', bogus: 1, card: { name: 'New', match: { id: 'wf_new', name: 'New' }, adopted: false } });
      assert.equal(b.state, 'saved');
      assert.equal(b.workflowId, 'wf_new');
      assert.equal(b.bogus, undefined, 'unknown block keys are dropped');
      assert.deepEqual(b.card, { type: 'workflow', name: 'New', match: { id: 'wf_new', name: 'New' }, nodes: { n1: { model: 'a' } }, thenRun: false, adopted: false }, 'the card sub-patch is SHALLOW-merged');
      assert.deepEqual(findCard(t.id, 'card_0000aa01').block, b, 'persisted');
      assert.equal(updateCardBlock(t.id, 'card_0000aa01', { card: 'nope' }).card.name, 'New', 'a non-object card patch is ignored');
      const run = updateCardBlock(t.id, 'card_0000aa09', { state: 'started', runId: 'run-1', workflowId: 'wf_x', card: { brief: 'hacked' } });
      assert.equal(run.card.brief, 'b', 'a RUN card never takes a card sub-patch');
      assert.equal(run.workflowId, 'wf_x', 'workflowId is a block key for both kinds (harmless on a run card)');
    } },
    { name: 'metrics card: updateCardBlock shallow-merges a `card` sub-patch (the apply result lands there)', run: () => {
      const t = createThread();
      const m = appendMessage(t.id, { role: 'assistant', text: '', status: 'done' });
      setMessageBlocks(m.id, [{ kind: 'card', id: 'card_0000bb01', state: 'proposed', card: { type: 'metrics', kind: 'record', projectKey: 'p-00000001', record: false, summary: 'Turn "Include my runs" off for p', effects: ['x'] } }]);
      const b = updateCardBlock(t.id, 'card_0000bb01', { state: 'applied', card: { result: { ok: true, detail: '"Include my runs" is now off' } } });
      assert.equal(b.state, 'applied');
      assert.deepEqual(b.card, { type: 'metrics', kind: 'record', projectKey: 'p-00000001', record: false, summary: 'Turn "Include my runs" off for p', effects: ['x'], result: { ok: true, detail: '"Include my runs" is now off' } });
      assert.deepEqual(findCard(t.id, 'card_0000bb01').block, b, 'persisted');
    } },
    { name: 'policy card: the same shallow `card` sub-patch as a metrics card', run: () => {
      const t = createThread();
      const m = appendMessage(t.id, { role: 'assistant', text: '', status: 'done' });
      setMessageBlocks(m.id, [{ kind: 'card', id: 'card_0000bb02', state: 'proposed', card: { type: 'policy', kind: 'edit', home: 'acme/gateway', summary: 'Edit', changes: [] } }]);
      const b = updateCardBlock(t.id, 'card_0000bb02', { state: 'applied', card: { result: { ok: true, detail: 'published abc1234 to acme/gateway' } } });
      assert.deepEqual(b.card, { type: 'policy', kind: 'edit', home: 'acme/gateway', summary: 'Edit', changes: [], result: { ok: true, detail: 'published abc1234 to acme/gateway' } });
    } },
    { name: 'a scope-switch card takes a card sub-patch (choice)', run: () => {
      const t = createThread();
      const m = appendMessage(t.id, { role: 'assistant', text: '', status: 'done' });
      setMessageBlocks(m.id, [{ kind: 'card', id: 'card_0000bb09', state: 'proposed', card: { type: 'scope-switch', reason: 'r', summary: 'S', candidates: [] } }]);
      const b = updateCardBlock(t.id, 'card_0000bb09', { state: 'answered', card: { choice: 'none' } });
      assert.equal(b.state, 'answered');
      assert.deepEqual(b.card, { type: 'scope-switch', reason: 'r', summary: 'S', candidates: [], choice: 'none' });
    } },
    { name: 'project card: the shallow `card` sub-patch (the apply result lands there)', run: () => {
      const t = createThread();
      const m = appendMessage(t.id, { role: 'assistant', text: '', status: 'done' });
      setMessageBlocks(m.id, [{ kind: 'card', id: 'card_0000bb03', state: 'proposed', card: { type: 'project', kind: 'create', summary: 'Create site', name: 'site', path: '/p/site', vcs: 'none', change: { kind: 'create', name: 'site', useGit: false } } }]);
      const result = { ok: true, project: { key: 'site-0000abcd', name: 'site', path: '/p/site', vcs: 'none' }, scope: null };
      const b = updateCardBlock(t.id, 'card_0000bb03', { state: 'applied', card: { result } });
      assert.deepEqual(b.card.result, result);
      assert.equal(b.card.name, 'site', 'the card keeps its fields');
    } },
  ]);
});

test('addThreadContexts accumulates; updateThread/scope writes never touch contexts', () => {
  const t = createThread();
  assert.deepEqual(t.contexts, [], 'no contexts yet');
  const p = { kind: 'project', id: 'p-00000001', label: 'Proj' };
  const s = { kind: 'page', id: 'settings', label: 'Settings' };
  assert.deepEqual(addThreadContexts(t.id, [p]), [p]);
  const before = getThread(t.id).updatedAt;
  assert.deepEqual(addThreadContexts(t.id, [s, p]), [p, s], 'origin first, deduped');
  assert.equal(getThread(t.id).updatedAt, before, 'recording contexts does not reorder the history list');
  updateThread(t.id, { context: { pinned: true, workspaceId: 'wks-team-0000abcd' }, contexts: [] });
  assert.deepEqual(getThread(t.id).contexts, [p, s], 'updateThread ignores contexts (not a patch column)');
  assert.deepEqual(listThreads().find((x) => x.id === t.id).contexts, [p, s], 'the list carries them too');
  assert.equal(addThreadContexts('ask_ffffffff', [p]), null);
  assert.deepEqual(addThreadContexts(t.id, []), [p, s], 'an empty turn is a no-op');
});

test('agentMode (#574): on by default; a patch stores false and true (0/1, never a raw boolean)', () => {
  const t = createThread();
  assert.equal(t.agentMode, true);
  assert.equal(updateThread(t.id, { agentMode: false }).agentMode, false);
  assert.equal(getDb().prepare('SELECT agent_mode FROM ask_threads WHERE id = ?').get(t.id).agent_mode, 0);
  assert.equal(updateThread(t.id, { agentMode: true }).agentMode, true);
  assert.equal(updateThread(t.id, { title: 'x' }).agentMode, true, 'other patches leave it alone');
});

test('attachment source (v64): a show_files copy keeps its original path server-side; rows carry only hasSource', () => {
  const t = createThread({ title: 't' });
  const copy = addAttachment(t.id, null, { name: 'a.png', kind: 'image', mime: 'image/png', data: Buffer.from('x'), sourcePath: '/w/out/a.png' });
  const up = addAttachment(t.id, null, { name: 'b.md', text: 'b' });
  assert.deepEqual([copy.hasSource, up.hasSource], [true, false]);
  assert.equal(JSON.stringify(listAttachments(t.id)).includes('/w/out'), false, 'the path is never on a row');
  assert.equal(attachmentSourcePath(t.id, copy.id), '/w/out/a.png');
  assert.equal(attachmentSourcePath(t.id, up.id), null);
  assert.equal(attachmentSourcePath(createThread().id, copy.id), null, 'another thread never reads it');
});

test('attachment source origin (v70): a copy found under a run or project keeps runId, projectKey and the root-relative path server-side', () => {
  const t = createThread({ title: 't' });
  const run = addAttachment(t.id, null, { name: 'a.png', kind: 'image', mime: 'image/png', data: Buffer.from('x'),
    sourcePath: '/runs/r1/repos/app/out/a.png', sourceOrigin: { runId: 'r1', projectKey: 'app', rel: 'out/a.png' } });
  const proj = addAttachment(t.id, null, { name: 'b.md', text: 'b', sourcePath: '/p/app/b.md', sourceOrigin: { projectKey: 'app', rel: 'b.md' } });
  const plain = addAttachment(t.id, null, { name: 'c.png', kind: 'image', mime: 'image/png', data: Buffer.from('x'), sourcePath: '/w/out/c.png' });
  const up = addAttachment(t.id, null, { name: 'd.md', text: 'd' });
  assert.deepEqual(attachmentSourceOrigin(t.id, run.id), { runId: 'r1', projectKey: 'app', rel: 'out/a.png' });
  assert.deepEqual(attachmentSourceOrigin(t.id, proj.id), { runId: null, projectKey: 'app', rel: 'b.md' });
  assert.equal(attachmentSourceOrigin(t.id, plain.id), null, 'a copy from the out folder has no origin');
  assert.equal(attachmentSourceOrigin(t.id, up.id), null);
  assert.equal(attachmentSourceOrigin(createThread().id, run.id), null, 'another thread never reads it');
  assert.equal(JSON.stringify(listAttachments(t.id)).includes('out/a.png'), false, 'the relative path is never on a row');
  assert.equal(JSON.stringify(getAttachment(t.id, run.id)).includes('r1'), false, 'nor the run id');
  const half = addAttachment(t.id, null, { name: 'e.png', kind: 'image', mime: 'image/png', data: Buffer.from('x'),
    sourcePath: '/x/e.png', sourceOrigin: { runId: 'r1', rel: 'e.png' } });
  assert.equal(attachmentSourceOrigin(t.id, half.id), null, 'no project key: nothing to fall back to, nothing stored');
});

test('askOutDir: under the thread folder, strict thread id; an svg snapshot round-trips through attachmentPath', () => {
  const t = createThread({ title: 't' });
  assert.ok(askOutDir(t.id).endsWith(join('ask', t.id, 'out')));
  assert.throws(() => askOutDir('../x'), /never minted/);
  const a = addAttachment(t.id, null, { name: 'chart.svg', kind: 'image', mime: 'image/svg+xml', data: Buffer.from('<svg/>') });
  assert.equal(a.messageId, null);
  assert.ok(attachmentPath(t.id, a.id).endsWith('.svg'));
});

test('findPullRequestCards: an applied card by its url or a workspace member url — never another state, never another PR', () => {
  const PR1 = 'https://github.com/o/r/pull/1';
  const card = (state, result, over = {}) => ({ kind: 'card', id: newAskId('card'), state,
    card: { type: 'pull-request', pipelineId: 'aaaa1111', projectKey: 'shop-00000001', title: 'T', branch: 'feat/x', ...over, ...(result ? { result } : {}) } });
  const a = createThread(); const b = createThread(); const c = createThread(); const d = createThread();
  const one = card('applied', { url: PR1, draft: false, existed: false });
  appendMessage(a.id, { role: 'assistant', text: '', blocks: [one], status: 'done' });
  const ws = card('applied', { url: 'https://github.com/o/api/pull/5', draft: false, existed: false, members: [
    { url: 'https://github.com/o/api/pull/5', draft: false, existed: false, memberKey: 'api-11111111' },
    { url: 'https://github.com/o/web/pull/6', draft: false, existed: false, memberKey: 'web-22222222' }] },
    { projectKey: 'workspaces/wk1', workspaceId: 'wk1', pipelineId: 'bbbb2222' });
  appendMessage(b.id, { role: 'assistant', text: '', blocks: [ws], status: 'done' });
  appendMessage(c.id, { role: 'assistant', text: '', blocks: [card('failed', { url: PR1, error: 'x' })], status: 'done' });   // not applied
  appendMessage(d.id, { role: 'assistant', text: '', blocks: [card('applied', { url: `${PR1}0`, draft: false, existed: false })], status: 'done' }); // …/pull/10

  assert.deepEqual(findPullRequestCards(PR1),
    [{ threadId: a.id, cardId: one.id, pipelineId: 'aaaa1111', projectKey: 'shop-00000001', workspaceId: null, memberKey: null }]);
  assert.deepEqual(findPullRequestCards('https://github.com/o/web/pull/6'),
    [{ threadId: b.id, cardId: ws.id, pipelineId: 'bbbb2222', projectKey: 'workspaces/wk1', workspaceId: 'wk1', memberKey: 'web-22222222' }]);
  assert.deepEqual(findPullRequestCards('https://github.com/o/r/pull/99'), []);
  assert.deepEqual(findPullRequestCards(''), []);
});

test('findFixRunCards / updateCardBlock: a PR fix-run card is found by its run id and takes a `card` sub-patch; a plain track_run card does not', () => {
  const t = createThread();
  const fix = { kind: 'card', id: 'card_0000f001', state: 'tracked', card: { type: 'progress', pipelineId: null, runId: 'run-uuid-9', projectKey: 'p', workspaceId: null,
    title: 'Fix PR #1 feedback', label: 'p', status: 'starting', fix: { prUrl: 'https://github.com/o/r/pull/1', memberKey: null, trigger: ['checks'], triggerLabel: 'Failing checks', once: false } } };
  const plain = { kind: 'card', id: 'card_0000f002', state: 'tracked', card: { type: 'progress', pipelineId: 'abcd1234', runId: 'run-uuid-9', projectKey: 'p', workspaceId: null, title: 'x', label: 'p', status: 'done' } };
  appendMessage(t.id, { role: 'system', text: 'PR watch started a fix run', blocks: [fix] });
  appendMessage(t.id, { role: 'assistant', text: '', blocks: [plain], status: 'done' });
  assert.deepEqual(findFixRunCards('run-uuid-9').map((x) => [x.threadId, x.block.id]), [[t.id, 'card_0000f001']]);
  assert.deepEqual(findFixRunCards('run-uuid-0'), []);
  const outcome = { kind: 'pushed', sha: 'abc1234', stopped: null, fixRuns: 1 };
  const b = updateCardBlock(t.id, 'card_0000f001', { card: { pipelineId: 'fix00001', fix: { ...fix.card.fix, outcome } } });
  assert.deepEqual([b.card.pipelineId, b.card.fix.outcome, b.card.runId, b.state], ['fix00001', outcome, 'run-uuid-9', 'tracked']);
  assert.equal(updateCardBlock(t.id, 'card_0000f002', { card: { pipelineId: 'zzzz0000' } }).card.pipelineId, 'abcd1234', 'track_run cards stay immutable');
});
