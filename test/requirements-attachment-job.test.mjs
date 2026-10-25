// test/requirements-attachment-job.test.mjs — the read job with a fake runner; never a real claude (plans/requirements-a8-design.md
// D3–D5, D9, D10, D15, D17). This file imports attachment-job.mjs before interview.mjs on purpose: the two import each other, and
// test/requirements-interview.test.mjs loads them the other way round, so both orders are proven.
import * as job from '../src/core/requirements/attachment-job.mjs';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, getAttachment, listAttachments, listTurns, getFeature, insertAttachment, mintAttachmentId, updateAttachment,
  beginBrief, saveBriefResult, getBriefById,
} from '../src/core/requirements/store.mjs';
import { ATTACHMENT_SYSTEM_PROMPT } from '../src/core/requirements/attachments.mjs';
import { REQUIREMENTS_READ_DENY_RULES } from '../src/core/ask/deny-rules.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after, 'worca-req-attjob-');
beforeEach(() => { delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_MOCK_READ_MS; });

const POSIX = { skip: process.platform === 'win32' ? 'the fake claude runs the hook through sh' : false };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const textFile = (name, text) => { const data = Buffer.from(text); return { name, kind: 'text', mime: 'text/markdown', data, text, bytes: data.length, sha256: sha(data) }; };
const binFile = (name, data, kind, mime) => ({ name, kind, mime, data, bytes: data.length, sha256: sha(data) });
const PDF = Buffer.from('%PDF-1.7\nhello\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pdfFile = (name = 'tickets.pdf', data = PDF) => binFile(name, data, 'binary', 'application/pdf');

/** A fake runner: replies in order, or per call when `replies` is a function (an Error is thrown), records every call,
 *  $0.10 per call; a `gate` holds every call until it is resolved. Like the real runner, a guarded call (readGuard set)
 *  returns the guard's decisions: none by default, since the fake stream shows no tool call; `stream(opts)` adds frames
 *  before the result and `decisions(opts)` the log. */
function fakeRunner(replies, { gate = null, onCall = null, stream = null, decisions = () => [], numTurns = undefined } = {}) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    if (onCall) onCall(opts);
    if (gate) await gate.promise;
    const reply = typeof replies === 'function' ? replies(opts) : replies.shift();
    if (reply instanceof Error) throw reply;
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    for (const raw of stream ? stream(opts) : []) opts.onEvent?.({ type: raw.type, raw });
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text, ...(numTurns ? { num_turns: numTurns } : {}) }, costUsd: 0.1 });
    return { text, ...(opts.readGuard ? { readGuardDecisions: decisions(opts) } : {}) };
  };
  return { calls, runClaudeImpl };
}
/** Replies keyed by the file's name in the prompt ("Name: <name>"), for calls that run side by side. */
const byName = (map) => (o) => map[/Name: (\S+)/.exec(o.prompt)[1]];
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const deps = (runner, extra = {}) => ({
  runClaudeImpl: runner.runClaudeImpl, listModels: async () => [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }],
  interviewSlot: () => ({}), userSignIn: () => false, budget: () => ({ blocked: false }), onChange: () => {}, onBriefChange: () => {},
  mockEnabled: () => false, ...extra,
});
const feature = () => createFeature({ scopeType: 'project', scopeKey: 'shop-att1', title: 'Cancel order', description: 'Before it ships' });
const own = (f) => ({ type: 'feature', id: f.seq });
const readDirs = () => { try { return readdirSync(join(worcaHome(), 'tmp', 'requirements')).filter((x) => x.startsWith('att-read-')); } catch { return []; } };
const readOfCopy = (o, id = 'tu_1') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: o.readGuard } }] } });

test('bodies: the path is built from the id and the kind only; an id the store never minted is refused first', () => {
  assert.equal(job.attachmentFile({ id: 'ratt_0123456789ab', kind: 'text', mime: 'text/html' }), join(worcaHome(), 'requirements', 'att', 'ratt_0123456789ab.txt'));
  assert.equal(job.attachmentFile({ id: 'ratt_0123456789ab', kind: 'binary', mime: 'application/pdf' }).endsWith('ratt_0123456789ab.pdf'), true);
  for (const id of ['../../x', 'ratt_../a', 'ratt_0123456789AB']) assert.throws(() => job.attachmentFile({ id, kind: 'text' }), /never minted/, id);
});

test('a small text file is read inline, redacted, with no tools, on the interview model and its effort; the body is the upload', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Refunds within 14 days.' }]);
  const key = `sk-ant-api03-${'a'.repeat(40)}`;
  const [row] = job.addAttachments(own(f), [textFile('policy.md', `Refunds in 14 days. ${key}`)], { by: 'po' }, deps(r));
  assert.equal(row.status, 'reading');
  await job.readsSettled(own(f));
  const c = r.calls[0];
  assert.deepEqual([c.systemPrompt, c.systemPromptMode, c.tools, c.allowedTools, c.maxTurns, c.model, c.effort],
    [ATTACHMENT_SYSTEM_PROMPT, 'replace', [], [], undefined, 'claude-opus-5-5', 'medium']);
  assert.deepEqual([c.permissionRules, 'readGuard' in c], [{ deny: [...REQUIREMENTS_READ_DENY_RULES] }, false], 'deny rules; no tool, so no guard');
  assert.match(c.prompt, /<file>\nName: policy\.md\nKind: Text\nSize: \d+ B\n\nRefunds in 14 days\. sk-ant-&lt;redacted>/);
  assert.doesNotMatch(c.prompt, /sk-ant-api03/);
  const a = getAttachment(row.id);
  assert.deepEqual([a.status, a.summary, a.readCostUsd, a.readModel, a.costUsd], ['done', 'Refunds within 14 days.', 0.1, 'claude-opus-5-5', 0.1]);
  assert.equal(getFeature(f.seq).costUsd, 0.1);
  const turns = listTurns(f.seq).filter((t) => t.kind === 'file');
  assert.deepEqual(turns.map((t) => [t.payload.action, t.payload.name]), [['added', 'policy.md'], ['read', 'policy.md']]);
  assert.equal(turns[1].costUsd, 0.1);
  const led = prepare('SELECT feature_seq, amount_usd FROM req_cost_ledger WHERE attachment_id = ?').all(row.id);
  assert.deepEqual(led.map((x) => [Number(x.feature_seq), x.amount_usd]), [[f.seq, 0.1]]);
  assert.ok(readFileSync(job.attachmentFile(a), 'utf8').includes(key), 'the stored body is the uploaded one');
});

test('an image, a PDF and a 30 KB text are opened with Read from a fresh folder holding only their copy; the folder goes', async () => {
  const f = feature();
  const seen = [];
  const r = fakeRunner([{ summary: 'An image.' }, { summary: 'A PDF.' }, { summary: 'Long notes.' }],
    { onCall: (o) => {
      const names = readdirSync(o.cwd);
      seen.push({ names, copy: readFileSync(join(o.cwd, names[0]), 'utf8'), dirMode: statSync(o.cwd).mode & 0o777, copyMode: statSync(o.readGuard).mode & 0o777 });
    } });
  const long = `${'x'.repeat(30 * 1024)} sk-ant-${'b'.repeat(40)}`;
  const rows = job.addAttachments(own(f), [binFile('mock.png', PNG, 'image', 'image/png'), pdfFile(), textFile('notes.md', long)], {}, deps(r));
  await job.readsSettled(own(f));
  assert.equal(r.calls.length, 3);
  for (const c of r.calls) {
    assert.deepEqual([c.tools, c.maxTurns, c.systemPrompt], [['Read'], 5, ATTACHMENT_SYSTEM_PROMPT]);
    assert.equal(c.allowedTools.length, 1);
    assert.match(c.allowedTools[0], /^Read\(\/\/\*\*\/att-read-[0-9a-f]{8}\/ratt_[0-9a-f]{12}\.(png|pdf|txt)\)$/);
    assert.equal(c.readGuard, join(c.cwd, c.allowedTools[0].slice(c.allowedTools[0].lastIndexOf('/') + 1, -1)), 'the guard names the copy');
    assert.deepEqual(c.permissionRules, { deny: [...REQUIREMENTS_READ_DENY_RULES] });
    assert.match(c.prompt, /holds only this file: .+\. Open it with the Read tool\./);
    assert.equal(existsSync(c.cwd), false, 'the read folder is gone');
  }
  assert.ok(seen.every((s) => s.names.length === 1));
  const txt = seen.find((s) => s.names[0].endsWith('.txt'));
  assert.doesNotMatch(txt.copy, /sk-ant-b{40}/, "a text file's copy is its redacted text");
  assert.deepEqual(rows.map((x) => getAttachment(x.id).status), ['done', 'done', 'done'], 'no tool call on the stream: nothing left unchecked');
  assert.deepEqual(readDirs(), []);
  if (process.platform !== 'win32') {
    assert.ok(seen.every((s) => s.dirMode === 0o700 && s.copyMode === 0o600), 'the read folder and its copy are private');
    assert.deepEqual(rows.map((x) => statSync(job.attachmentFile(getAttachment(x.id))).mode & 0o777), [0o600, 0o600, 0o600], 'bodies are private');
    assert.equal(statSync(job.attachmentsDir()).mode & 0o777, 0o700);
    assert.equal(statSync(join(worcaHome(), 'tmp', 'requirements')).mode & 0o777, 0o700);
  }
});

test('a throwing call, an unreadable reply and an empty summary: failed with its code, the cost booked, no folder left', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const f = feature();
  const r = fakeRunner(byName({ 'a.pdf': new Error('boom at /secret/path'), 'b.md': 'not json', 'c.md': { summary: '' } }));
  const rows = job.addAttachments(own(f), [pdfFile('a.pdf'), textFile('b.md', 'b'), textFile('c.md', 'c')], {}, deps(r));
  await job.readsSettled(own(f));
  const st = rows.map((x) => getAttachment(x.id));
  assert.deepEqual(st.map((x) => [x.status, x.error.code]), [['failed', 'FAILED'], ['failed', 'BAD_REPLY'], ['failed', 'BAD_REPLY']]);
  assert.equal(st[0].error.message, 'Worca could not read it. Try again.', 'never the raw error text');
  assert.match(st[1].error.message, /^Worca's reply could not be read \(/);
  assert.equal(st[1].costUsd, 0.1);
  assert.ok(log.mock.calls.some((c) => String(c.arguments[0]).includes(rows[0].id) && String(c.arguments[1]).includes('boom')), 'the raw error is logged with the id');
  assert.deepEqual(readDirs(), []);
});

test('a missing stored body: FAILED with a product message, no path and no fs code stored; nothing spent', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const f = feature();
  const r = fakeRunner([]);
  const rows = job.addAttachments(own(f), [pdfFile('gone.pdf'), textFile('gone.md', `${'g'.repeat(30 * 1024)}`), textFile('small.md', 's')], {}, deps(r));
  for (const x of rows) rmSync(job.attachmentFile(x));   // before the read starts (it waits a tick)
  await job.readsSettled(own(f));
  assert.equal(r.calls.length, 0);
  for (const x of rows) {
    const a = getAttachment(x.id);
    assert.deepEqual([a.status, a.error.code, a.error.message, a.costUsd], ['failed', 'FAILED', 'Worca could not open the stored file. Remove it and attach it again.', 0], x.name);
    assert.doesNotMatch(JSON.stringify(a.error), /ENOENT|ratt_|[\\/]/, 'no path, no fs code');
  }
  assert.equal(log.mock.calls.length, 3);
  assert.deepEqual(readDirs(), []);
});

test('a throwing budget check fails the file instead of leaving it reading', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = feature();
  const r = fakeRunner([{ summary: 'never' }]);
  const [row] = job.addAttachments(own(f), [textFile('budget.md', 'b')], {}, deps(r, { budget: () => { throw new Error('db locked'); } }));
  await job.readsSettled(own(f));
  const a = getAttachment(row.id);
  assert.deepEqual([a.status, a.error.code, a.error.message, r.calls.length], ['failed', 'FAILED', 'Worca could not read it. Try again.', 0]);
});

test('a partial add: the files stored before the failure are read, none is left reading; the failed one leaves no row or body', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'First.' }]);
  const bad = { ...textFile('bad.md', 'bad'), data: null };   // its body cannot be written
  const bodies = () => readdirSync(job.attachmentsDir()).length;
  const before = bodies();
  assert.throws(() => job.addAttachments(own(f), [textFile('first.md', 'first'), bad], {}, deps(r)), TypeError);
  await job.readsSettled(own(f));
  const rows = listAttachments('feature', f.seq);
  assert.deepEqual(rows.map((x) => [x.name, x.status, x.summary]), [['first.md', 'done', 'First.']]);
  assert.equal(bodies(), before + 1, "only the stored file's body is on disk");
});

// ── D15: a Read-form read counts only when the guard decided every tool call its stream shows ──

test('a Read-form read whose stream shows a tool call the guard never decided is discarded: failed, no summary, the cost booked', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Should not be stored.' }], { stream: (o) => [readOfCopy(o)], numTurns: 2 });
  const [row] = job.addAttachments(own(f), [pdfFile('unchecked.pdf')], {}, deps(r));
  await job.readsSettled(own(f));
  const a = getAttachment(row.id);
  assert.deepEqual([a.status, a.error.code, a.summary, a.readCostUsd, a.costUsd], ['failed', 'UNCHECKED', '', null, 0.1]);
  assert.equal(a.error.message, 'Worca stopped this read: it could not confirm the read stayed inside this file. Try again.');
  assert.equal(getFeature(f.seq).costUsd, 0.1);
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE attachment_id = ?').get(row.id).n, 1);
  assert.deepEqual(readDirs(), []);
});

test('the same stream with the decision logged for its tool call is done', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Two tickets.' }], { stream: (o) => [readOfCopy(o)], numTurns: 2,
    decisions: (o) => [{ tool: 'Read', path: o.readGuard, decision: 'allow', id: 'tu_1' }] });
  const [row] = job.addAttachments(own(f), [pdfFile('checked.pdf')], {}, deps(r));
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(row.id).status, getAttachment(row.id).summary], ['done', 'Two tickets.']);
});

test('fail closed: more than one turn with no tool call, no decision log, or no result on the stream is a discarded read', async () => {
  const f = feature();
  const unchecked = (id) => [getAttachment(id).status, getAttachment(id).error.code, getAttachment(id).summary];
  const turns = fakeRunner([{ summary: 'Hidden steps.' }], { numTurns: 3 });
  const [a] = job.addAttachments(own(f), [pdfFile('turns.pdf')], {}, deps(turns));
  await job.readsSettled(own(f));
  assert.deepEqual(unchecked(a.id), ['failed', 'UNCHECKED', '']);
  const noLog = { runClaudeImpl: async (o) => { o.onEvent({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: '{"summary":"x"}' }, costUsd: 0.1 }); return { text: '{"summary":"x"}' }; } };
  const [b] = job.addAttachments(own(f), [pdfFile('nolog.pdf', Buffer.from('%PDF-1.7\nother\n'))], {}, deps(noLog));
  await job.readsSettled(own(f));
  assert.deepEqual(unchecked(b.id), ['failed', 'UNCHECKED', '']);
  const noResult = { runClaudeImpl: async () => ({ text: '{"summary":"x"}', readGuardDecisions: [] }) };
  const [c] = job.addAttachments(own(f), [pdfFile('noresult.pdf', Buffer.from('%PDF-1.7\nthird\n'))], {}, deps(noResult));
  await job.readsSettled(own(f));
  assert.deepEqual(unchecked(c.id), ['failed', 'UNCHECKED', '']);
});

test('an inline read whose stream shows a tool call is discarded as UNCHECKED, the cost booked', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Should not be stored.' }], { stream: () => [readOfCopy({ readGuard: '/etc/passwd' })] });
  const [row] = job.addAttachments(own(f), [textFile('inline.md', 'small')], {}, deps(r));
  await job.readsSettled(own(f));
  assert.equal('readGuard' in r.calls[0], false);
  const a = getAttachment(row.id);
  assert.deepEqual([a.status, a.error.code, a.summary, a.costUsd], ['failed', 'UNCHECKED', '', 0.1]);
});

/** A node fake claude for the real runner: reports a Read of the copy on the stream, running the '*' PreToolUse hook
 *  for it (as Claude Code would: sh -c, the payload on stdin) only when `runHook`. */
function fakeClaudeBin(runHook) {
  const dir = mkdtempSync(join(tmpdir(), 'req-attjob-bin-'));
  const bin = join(dir, 'fake-claude.mjs');
  writeFileSync(bin, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
const { command } = settings.hooks.PreToolUse.find((h) => h.matcher === '*').hooks[0];
const copy = join(process.cwd(), readdirSync(process.cwd())[0]);   // the read folder holds only the copy
const call = { id: 'tu_1', name: 'Read', input: { file_path: copy } };
if (${runHook}) spawnSync('sh', ['-c', command], { input: JSON.stringify({ tool_name: call.name, tool_input: call.input, tool_use_id: call.id }) });
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', ...call }] } }));
console.log(JSON.stringify({ type: 'result', result: '{"summary":"Read for real."}', total_cost_usd: 0.1, num_turns: 2 }));
`);
  chmodSync(bin, 0o755);
  return { bin, dir };
}

test('the real runner: a stream with a tool call and an empty decision log ends failed and stores nothing; with the hook run, done', POSIX, async () => {
  const prev = process.env.WORCA_BROKER_URL;
  delete process.env.WORCA_BROKER_URL;
  try {
    for (const [runHook, want] of [[false, ['failed', '']], [true, ['done', 'Read for real.']]]) {
      const f = feature();
      const { bin, dir } = fakeClaudeBin(runHook);
      try {
        const real = { runClaudeImpl: (o) => runClaude({ ...o, bin }) };
        const [row] = job.addAttachments(own(f), [pdfFile(`real-${runHook}.pdf`, Buffer.from(`%PDF-1.7\n${runHook}\n`))], {}, deps(real));
        await job.readsSettled(own(f));
        const a = getAttachment(row.id);
        assert.deepEqual([a.status, a.summary], want, `runHook ${runHook}`);
        assert.equal(a.costUsd, 0.1, 'the cost is booked either way');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  } finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
  assert.deepEqual(readDirs(), []);
});

test('a timeout is TIMEOUT; READ_TIMEOUT_MS is 3 minutes', async () => {
  assert.equal(job.READ_TIMEOUT_MS, 180_000);
  const f = feature();
  const hang = { runClaudeImpl: (o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) };
  const [row] = job.addAttachments(own(f), [pdfFile('slow.pdf')], {}, deps(hang, { readTimeoutMs: 50 }));
  await job.readsSettled(own(f));
  assert.equal(getAttachment(row.id).error.code, 'TIMEOUT');
  assert.deepEqual(readDirs(), []);
});

test('queueUnread reads the budget only when a file is waiting on it', () => {
  let n = 0;
  const f = feature();
  assert.equal(job.queueUnread(f.seq, deps(fakeRunner([]), { budget: () => { n += 1; return { blocked: false }; } })), 0);
  assert.equal(n, 0, 'no file waits: no budget call');
});

test('the budget before every read: unread-budget, nothing spent; queueUnread reads it once the budget allows', async () => {
  const f = feature();
  let blocked = true;
  const r = fakeRunner([{ summary: 'Now read.' }]);
  const d = deps(r, { budget: () => ({ blocked }) });
  const [row] = job.addAttachments(own(f), [textFile('faq.md', 'faq')], {}, d);
  await job.readsSettled(own(f));
  assert.equal(getAttachment(row.id).status, 'unread-budget');
  assert.equal(r.calls.length, 0);
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE attachment_id = ?').get(row.id).n, 0);
  assert.equal(job.queueUnread(f.seq, d), 0, 'still blocked: nothing queued');
  blocked = false;
  assert.equal(job.queueUnread(f.seq, d), 1);
  await job.readsSettled(own(f));
  assert.equal(getAttachment(row.id).summary, 'Now read.');
});

test('at most MAX_READ_JOBS (2) at once across owners; the others wait in order and count as reading', async () => {
  assert.equal(job.MAX_READ_JOBS, 2);
  const gate = deferred();
  const r = fakeRunner([{ summary: '1' }, { summary: '2' }, { summary: '3' }], { gate });
  const f1 = feature(); const f2 = feature();
  job.addAttachments(own(f1), [textFile('a.md', 'a'), textFile('b.md', 'b')], {}, deps(r));
  const [c] = job.addAttachments(own(f2), [textFile('c.md', 'c')], {}, deps(r));
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(r.calls.length, 2);
  assert.equal(job.isReading(c.id), true);
  gate.resolve();
  await Promise.all([job.readsSettled(own(f1)), job.readsSettled(own(f2))]);
  assert.deepEqual(r.calls.map((x) => /Name: (\S+)/.exec(x.prompt)[1]), ['a.md', 'b.md', 'c.md']);
});

test("a brief document books under the brief (feature_seq 0); its frame names the scope; the brief's own cost is the looks'", async () => {
  const b = beginBrief('project', 'shop-docs');
  saveBriefResult(b.id, { sections: { product: 'P', users: [], terms: [], areas: [] } });
  const frames = [];
  const r = fakeRunner([{ summary: 'A glossary.' }]);
  const o = { type: 'brief', id: b.id, scopeType: 'project', scopeKey: 'shop-docs' };
  const [row] = job.addAttachments(o, [textFile('glossary.md', 'g')], {},
    deps(r, { onBriefChange: (t, k) => frames.push(`${t}:${k}`), listProjects: async () => [{ key: 'shop-docs', name: 'Shop' }] }));
  await job.readsSettled(o);
  assert.match(r.calls[0].prompt, /^<scope>Shop<\/scope>\n\n<file>/);
  const led = prepare('SELECT feature_seq, brief_id FROM req_cost_ledger WHERE attachment_id = ?').get(row.id);
  assert.deepEqual([Number(led.feature_seq), Number(led.brief_id)], [0, b.id]);
  assert.equal(getBriefById(b.id).costUsd, 0);
  assert.ok(frames.includes('project:shop-docs'));
});

test('remove: the row, then the body; a running read is stopped and its result dropped; a queued one never runs', async () => {
  const f = feature();
  const gate = deferred();
  const r = fakeRunner(byName({ 'a.pdf': { summary: 'late' }, 'b.md': { summary: 'b' }, 'c.md': { summary: 'c' } }), { gate });
  const [a, b, c] = job.addAttachments(own(f), [pdfFile('a.pdf'), textFile('b.md', 'b'), textFile('c.md', 'c')], {}, deps(r));
  await new Promise((res) => setTimeout(res, 30));
  job.removeAttachment(own(f), a.id, {}, deps(r));
  job.removeAttachment(own(f), c.id, {}, deps(r));
  assert.equal(getAttachment(a.id), null);
  assert.equal(existsSync(job.attachmentFile(a)), false);
  assert.equal(r.calls.find((x) => x.prompt.includes('Name: a.pdf')).signal.aborted, true, "the running read's call is aborted");
  gate.resolve();
  await job.readsSettled(own(f));
  assert.equal(r.calls.length, 2, 'c (queued) never ran');
  assert.equal(getAttachment(b.id).status, 'done');
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'file' && t.payload.action === 'removed').map((t) => t.payload.name), ['a.pdf', 'c.md']);
  assert.throws(() => job.removeAttachment({ type: 'feature', id: f.seq + 1000 }, b.id), /file not found/);
  assert.deepEqual(readDirs(), []);
});

test('edit: the product owner text, marked edited, a file turn; refused while the file is read; the switch', async () => {
  const f = feature();
  const gate = deferred();
  const r = fakeRunner([{ summary: 'Worca' }], { gate });
  const [a] = job.addAttachments(own(f), [textFile('a.md', 'a')], {}, deps(r));
  assert.throws(() => job.editSummary(own(f), a.id, 'Mine'), /^RequirementsError: Worca is reading this file\.$/);
  gate.resolve();
  await job.readsSettled(own(f));
  const e = job.editSummary(own(f), a.id, `  ${'m'.repeat(1600)}  `, { by: 'po' });
  assert.deepEqual([e.summaryEdited, e.summary.length], [true, 1500]);
  assert.throws(() => job.editSummary(own(f), a.id, '   '), /What Worca took from it cannot be empty\./);
  assert.equal(listTurns(f.seq).at(-1).payload.action, 'edited');
  assert.equal(job.setSend(own(f), a.id, true).sendWithRun, true);
});

test('mock mode: no spawn and no copy; the [mock] summary; nothing spent', async () => {
  const f = feature();
  const r = fakeRunner([]);
  const [a] = job.addAttachments(own(f), [pdfFile('m.pdf')], {}, deps(r, { mockEnabled: () => true }));
  await job.readsSettled(own(f));
  assert.equal(r.calls.length, 0);
  assert.deepEqual([getAttachment(a.id).summary, getAttachment(a.id).costUsd, getAttachment(a.id).readCostUsd],
    ['[mock] What Worca took from m.pdf: two rules, one number and an open point.', 0, null]);
  assert.deepEqual(readDirs(), []);
});

test('recoverAttachmentReads: a row left reading becomes failed INTERRUPTED; one still in the queue is left', async () => {
  const f = feature();
  const left = insertAttachment({ id: mintAttachmentId(), ownerType: 'feature', ownerId: f.seq, name: 'x.md', kind: 'text', mime: 'text/plain', bytes: 1, sha256: 'r1' });
  const gate = deferred();
  const [live] = job.addAttachments(own(f), [textFile('y.md', 'y')], {}, deps(fakeRunner([{ summary: 'y' }], { gate })));
  assert.equal(job.recoverAttachmentReads(), 1);
  assert.deepEqual([getAttachment(left.id).status, getAttachment(left.id).error.code, getAttachment(left.id).error.message],
    ['failed', 'INTERRUPTED', 'Worca restarted before it finished reading this file.']);
  assert.equal(getAttachment(live.id).status, 'reading');
  gate.resolve();
  await job.readsSettled(own(f));
});

test('sweepReadFolders removes att-read-* folders older than an hour, nothing else', () => {
  const base = join(worcaHome(), 'tmp', 'requirements');
  const old = join(base, 'att-read-0a1b2c3d'); const fresh = join(base, 'att-read-0a1b2c3e'); const other = join(base, 'auto-look-0a1b2c3d');
  for (const d of [old, fresh, other]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'f'), 'x'); }
  const t = (Date.now() - 2 * 3600_000) / 1000;
  utimesSync(old, t, t); utimesSync(other, t, t);
  const out = job.sweepReadFolders(base);
  assert.deepEqual(out.removed, [old]);
  assert.deepEqual([existsSync(old), existsSync(fresh), existsSync(other)], [false, true, true]);
  for (const d of [fresh, other]) rmSync(d, { recursive: true, force: true });   // later tests count att-read-* folders
});

test('readEstimate: the median of the last 10 finished reads of a kind, in cents; null without any', () => {
  prepare('UPDATE req_attachments SET read_cost_usd = NULL').run();   // the reads of the tests above
  assert.equal(job.readEstimate('image'), null);
  for (const [i, c] of [0.04, 0.1, 0.07].entries()) {
    const a = insertAttachment({ id: mintAttachmentId(), ownerType: 'feature', ownerId: 777, name: `e${i}.png`, kind: 'image', mime: 'image/png', bytes: 1, sha256: `est${i}` });
    updateAttachment(a.id, { status: 'done', readCostUsd: c, readAt: `2026-10-1${i}T00:00:00Z` });
  }
  assert.equal(job.readEstimate('image'), 0.07);
  assert.equal(listAttachments('feature', 777).length, 3);
});

// ── D11, D12: ask about a file, read it again, replace it ──

test('ask: a focused read with the question and the summary; the answer under it, apart from the summary; costs booked', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Tickets.' }, { answer: '4 ask for store credit.' }]);
  const [a] = job.addAttachments(own(f), [textFile('t.md', 'tickets')], {}, deps(r));
  await job.readsSettled(own(f));
  job.askAttachment(own(f), a.id, '  What about   store credit? ', { by: 'po' }, deps(r));
  assert.equal(job.isAsking(a.id), true);
  assert.throws(() => job.askAttachment(own(f), a.id, 'Again?', {}, deps(r)), /^RequirementsError: Worca is already answering a question about this file\.$/);
  await job.readsSettled(own(f));
  assert.match(r.calls[1].prompt, /<what_worca_took_from_it>\nTickets\.\n<\/what_worca_took_from_it>\n\n<question>What about store credit\?<\/question>/);
  const after = getAttachment(a.id);
  assert.deepEqual([after.summary, after.asks.length, after.asks[0].question, after.asks[0].answer, after.asks[0].by, after.costUsd],
    ['Tickets.', 1, 'What about store credit?', '4 ask for store credit.', 'po', 0.2]);
  assert.equal(listTurns(f.seq).at(-1).payload.action, 'asked');
  for (const q of ['', ' ', 'x'.repeat(201)]) assert.throws(() => job.askAttachment(own(f), a.id, q, {}, deps(r)), /the question must be 1 to 200 characters/);
});

test('ask: 409 BUDGET at the press; a limit reached before the call records the failed ask; at most 20 answers', async () => {
  const f = feature();
  let blocked = false;
  const r = fakeRunner([{ summary: 'S' }]);
  const d = deps(r, { budget: () => ({ blocked, totalLimitUsd: 20 }) });
  const [a] = job.addAttachments(own(f), [textFile('b.md', 'b')], {}, d);
  await job.readsSettled(own(f));
  blocked = true;
  assert.throws(() => job.askAttachment(own(f), a.id, 'Q?', {}, d),
    (e) => e.code === 'BUDGET' && e.message === 'The spending limit of $20 is reached for this period. Worca can read the file when the limit resets or is raised.');
  blocked = false;
  const gate = deferred();
  const late = deps(fakeRunner([{ answer: 'never' }], { gate }), { budget: () => ({ blocked }) });
  const busy = job.addAttachments(own(f), [textFile('c.md', 'c'), textFile('d.md', 'd')], {}, late);   // fill both slots
  job.askAttachment(own(f), a.id, 'Q?', {}, late);
  blocked = true;
  gate.resolve();
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(a.id).asks.length, getAttachment(a.id).error.code, getAttachment(a.id).error.job, getAttachment(a.id).status],
    [0, 'BUDGET', 'ask', 'done']);
  assert.equal(busy.length, 2);
  updateAttachment(a.id, { asks: Array.from({ length: 20 }, (_, i) => ({ question: `${i}`, answer: 'a' })) });
  blocked = false;
  assert.throws(() => job.askAttachment(own(f), a.id, 'More?', {}, d), /This file has 20 answers already\./);
});

test('read again: an edited summary goes to the history and the mark is cleared; the answers stay; refused while read', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'First.' }, { summary: 'Second.' }]);
  const [a] = job.addAttachments(own(f), [textFile('e.md', 'e')], {}, deps(r));
  await job.readsSettled(own(f));
  job.editSummary(own(f), a.id, 'Mine.');
  updateAttachment(a.id, { asks: [{ question: 'Q', answer: 'A' }] });
  const again = job.readAgain(own(f), a.id, { by: 'po' }, deps(r));
  assert.deepEqual([again.status, again.summaryEdited, again.history[0].summary, again.history[0].reason, again.history[0].edited], ['reading', false, 'Mine.', 'read-again', true]);
  assert.throws(() => job.readAgain(own(f), a.id, {}, deps(r)), /Worca is reading this file\./);
  await job.readsSettled(own(f));
  const done = getAttachment(a.id);
  assert.deepEqual([done.summary, done.asks.length, done.status], ['Second.', 1, 'done']);
});

test('a read nobody asked for of an edited file: its summary goes to the history, the product owner keeps theirs (D4)', async () => {
  const f = feature();
  let blocked = true;
  const r = fakeRunner([{ summary: 'Worca now.' }]);
  const d = deps(r, { budget: () => ({ blocked }) });
  const [a] = job.addAttachments(own(f), [textFile('g.md', 'g')], {}, d);
  await job.readsSettled(own(f));
  job.editSummary(own(f), a.id, 'Mine.');
  blocked = false;
  job.queueUnread(f.seq, d);
  await job.readsSettled(own(f));
  const row = getAttachment(a.id);
  assert.deepEqual([row.summary, row.summaryEdited, row.history[0].summary, row.history[0].reason], ['Mine.', true, 'Worca now.', 'read']);
});

test('replace keeps the place and the switch; rewrite or keep the text; the answers move to the old version; a duplicate is refused', async () => {
  const f = feature();
  const r = fakeRunner(byName({ 'a.pdf': { summary: 'Old.' }, 'o.md': { summary: 'Other.' }, 'a-v2.png': { summary: 'New.' }, 'a-v3.pdf': { summary: 'Newer.' } }));
  const [a, other] = job.addAttachments(own(f), [pdfFile('a.pdf'), textFile('o.md', 'other')], {}, deps(r));
  await job.readsSettled(own(f));
  job.setSend(own(f), a.id, true);
  updateAttachment(a.id, { asks: [{ question: 'Q', answer: 'A' }] });
  const oldBody = job.attachmentFile(getAttachment(a.id));
  const v2 = job.replaceAttachment(own(f), a.id, binFile('a-v2.png', PNG, 'image', 'image/png'), { by: 'po' }, deps(r));
  assert.deepEqual([v2.id, v2.name, v2.kind, v2.status, v2.sendWithRun, v2.summary, v2.asks, v2.history[0].asks.length, v2.history[0].name, v2.history[0].summary],
    [a.id, 'a-v2.png', 'image', 'reading', true, '', [], 1, 'a.pdf', 'Old.']);
  assert.equal(existsSync(oldBody), false, 'the old body is gone once the new one is stored');
  assert.equal(existsSync(job.attachmentFile(v2)), true);
  assert.deepEqual(listTurns(f.seq).filter((t) => t.payload.action === 'replaced').map((t) => [t.payload.name, t.payload.before]), [['a-v2.png', 'a.pdf']]);
  await job.readsSettled(own(f));
  assert.equal(getAttachment(a.id).summary, 'New.');
  job.editSummary(own(f), a.id, 'Mine.');
  const v3 = job.replaceAttachment(own(f), a.id, pdfFile('a-v3.pdf', Buffer.from('%PDF-1.7\nv3\n')), { keepSummary: true }, deps(r));
  assert.deepEqual([v3.summary, v3.summaryEdited], ['Mine.', true]);
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(a.id).summary, getAttachment(a.id).history[0].summary], ['Mine.', 'Newer.']);
  assert.throws(() => job.replaceAttachment(own(f), a.id, textFile('copy.md', 'other'), {}, deps(r)), /copy\.md is already attached as o\.md\./);
  assert.equal(other.name, 'o.md');
});

test('a replace whose row update fails leaves the old body and row as they were; no temp file is left', async () => {
  const f = feature();
  const [a] = job.addAttachments(own(f), [pdfFile('keep.pdf', Buffer.from('%PDF-1.7\nkeep\n'))], {}, deps(fakeRunner([{ summary: 'Kept.' }])));
  await job.readsSettled(own(f));
  const body = job.attachmentFile(getAttachment(a.id));
  const before = readFileSync(body);
  getDb().exec("CREATE TEMP TRIGGER req_att_down BEFORE UPDATE ON req_attachments BEGIN SELECT RAISE(ABORT, 'attachments down'); END;");
  try {
    assert.throws(() => job.replaceAttachment(own(f), a.id, pdfFile('keep-v2.pdf', Buffer.from('%PDF-1.7\nnew\n')), {}, deps(fakeRunner([]))), /attachments down/);
  } finally { getDb().exec('DROP TRIGGER IF EXISTS req_att_down'); }
  assert.ok(readFileSync(body).equals(before), 'the old body is untouched');
  assert.deepEqual([getAttachment(a.id).name, getAttachment(a.id).status], ['keep.pdf', 'done']);
  assert.deepEqual(readdirSync(job.attachmentsDir()).filter((n) => n.includes('.tmp-')), []);
});

test('a new body that cannot be put in place: the file fails with "Replace it again", nothing is read, no temp file is left', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const f = feature();
  const r = fakeRunner([{ summary: 'Stored.' }]);
  const [a] = job.addAttachments(own(f), [pdfFile('stuck.pdf', Buffer.from('%PDF-1.7\nstuck\n'))], {}, deps(r));
  await job.readsSettled(own(f));
  const target = job.attachmentFile({ id: a.id, kind: 'image', mime: 'image/png' });
  mkdirSync(target);   // a folder where the new body goes: neither the rename nor the copy can put it there
  try {
    const out = job.replaceAttachment(own(f), a.id, binFile('stuck.png', Buffer.from([...PNG, 9]), 'image', 'image/png'), {}, deps(r));
    assert.deepEqual([out.name, out.status, out.error.code, out.error.message],
      ['stuck.png', 'failed', 'FAILED', 'Worca could not store the new version. Replace it again.']);
    assert.equal(job.isReading(a.id), false, 'no read is queued for a body that is not there');
    await job.readsSettled(own(f));
    assert.equal(r.calls.length, 1);
    assert.deepEqual(readdirSync(job.attachmentsDir()).filter((n) => n.includes('.tmp-')), []);
    assert.equal(log.mock.calls.length, 1, 'the raw error goes to the log');
    assert.doesNotMatch(JSON.stringify(getAttachment(a.id).error), /ratt_|[\\/]/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("one job per file: replace and read again wait for an ask; a removed file's ask books its cost and stores nothing", async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Read.' }]);
  const [a] = job.addAttachments(own(f), [textFile('race.md', 'race')], {}, deps(r));
  await job.readsSettled(own(f));
  const gate = deferred();
  const slow = fakeRunner([{ answer: 'late' }], { gate });
  job.askAttachment(own(f), a.id, 'Why?', {}, deps(slow));
  assert.throws(() => job.replaceAttachment(own(f), a.id, textFile('race-v2.md', 'v2'), {}, deps(r)), /^RequirementsError: Worca is already answering a question about this file\.$/);
  assert.throws(() => job.readAgain(own(f), a.id, {}, deps(r)), /^RequirementsError: Worca is already answering a question about this file\.$/);
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(slow.calls.length, 1);
  job.removeAttachment(own(f), a.id, {}, deps(r));
  assert.equal(slow.calls[0].signal.aborted, true, "the running ask's call is aborted");
  gate.resolve();
  await job.readsSettled(own(f));
  assert.equal(getAttachment(a.id), null);
  assert.equal(getFeature(f.seq).costUsd, 0.2, 'the read and the stopped ask');
  assert.equal(listTurns(f.seq).filter((t) => t.payload.action === 'asked').length, 1);
});

test('mock mode: an ask answers with the [mock] line and spends nothing', async () => {
  const f = feature();
  const r = fakeRunner([]);
  const d = deps(r, { mockEnabled: () => true });
  const [a] = job.addAttachments(own(f), [textFile('mock-ask.md', 'm')], {}, d);
  await job.readsSettled(own(f));
  job.askAttachment(own(f), a.id, 'Refunds?', {}, d);
  await job.readsSettled(own(f));
  assert.deepEqual([r.calls.length, getAttachment(a.id).asks[0].answer, getAttachment(a.id).costUsd], [0, '[mock] Refunds?: the file does not say more.', 0]);
});

test("an ask's failure never overwrites a failed read's error; its answer clears only an ask's error", async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const f = feature();
  const r = fakeRunner(['not json', new Error('down'), { answer: 'Yes.' }, { answer: 'Again.' }]);
  const [a] = job.addAttachments(own(f), [textFile('err.md', 'e')], {}, deps(r));
  await job.readsSettled(own(f));
  const readError = getAttachment(a.id).error;
  assert.equal(readError.code, 'BAD_REPLY');
  job.askAttachment(own(f), a.id, 'Q?', {}, deps(r));
  await job.readsSettled(own(f));
  assert.deepEqual(getAttachment(a.id).error, readError, 'the failed ask leaves the read error');
  assert.equal(log.mock.calls.length, 1, 'the raw error goes to the log');
  job.askAttachment(own(f), a.id, 'Q2?', {}, deps(r));
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(a.id).error, getAttachment(a.id).asks.length], [readError, 1], 'an answer keeps the read error');
  const [b] = job.addAttachments(own(f), [textFile('ok.md', 'ok')], {}, deps(fakeRunner([{ summary: 'Fine.' }])));
  await job.readsSettled(own(f));
  const d2 = deps(fakeRunner([new Error('down'), { answer: 'Now.' }]));
  job.askAttachment(own(f), b.id, 'Q?', {}, d2);
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(b.id).error.code, getAttachment(b.id).error.job, getAttachment(b.id).error.question, getAttachment(b.id).error.message],
    ['FAILED', 'ask', 'Q?', 'Worca could not read it. Try again.']);
  job.askAttachment(own(f), b.id, 'Q again?', {}, d2);
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(b.id).error, getAttachment(b.id).asks.map((x) => x.answer)], [null, ['Now.']]);
});
