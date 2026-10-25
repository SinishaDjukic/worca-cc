// test/requirements-attachment-job.test.mjs — the read job with a fake runner; never a real claude (plans/requirements-a8-design.md
// D3–D5, D9, D10, D15, D17). This file imports attachment-job.mjs before interview.mjs on purpose: the two import each other, and
// test/requirements-interview.test.mjs loads them the other way round, so both orders are proven.
import * as job from '../src/core/requirements/attachment-job.mjs';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
import { prepare } from '../src/core/db.mjs';
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
    { onCall: (o) => { const names = readdirSync(o.cwd); seen.push({ names, copy: readFileSync(join(o.cwd, names[0]), 'utf8') }); } });
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
});

test('a throwing call, an unreadable reply and an empty summary: failed with its code, the cost booked, no folder left', async () => {
  const f = feature();
  const r = fakeRunner(byName({ 'a.pdf': new Error('boom'), 'b.md': 'not json', 'c.md': { summary: '' } }));
  const rows = job.addAttachments(own(f), [pdfFile('a.pdf'), textFile('b.md', 'b'), textFile('c.md', 'c')], {}, deps(r));
  await job.readsSettled(own(f));
  const st = rows.map((x) => getAttachment(x.id));
  assert.deepEqual(st.map((x) => [x.status, x.error.code]), [['failed', 'FAILED'], ['failed', 'BAD_REPLY'], ['failed', 'BAD_REPLY']]);
  assert.match(st[1].error.message, /^Worca's reply could not be read \(/);
  assert.equal(st[1].costUsd, 0.1);
  assert.deepEqual(readDirs(), []);
});

// ── D15: a Read-form read counts only when the guard decided every tool call its stream shows ──

test('a Read-form read whose stream shows a tool call the guard never decided is discarded: failed, no summary, the cost booked', async () => {
  const f = feature();
  const r = fakeRunner([{ summary: 'Should not be stored.' }], { stream: (o) => [readOfCopy(o)], numTurns: 2 });
  const [row] = job.addAttachments(own(f), [pdfFile('unchecked.pdf')], {}, deps(r));
  await job.readsSettled(own(f));
  const a = getAttachment(row.id);
  assert.deepEqual([a.status, a.error.code, a.summary, a.readCostUsd, a.costUsd], ['failed', 'BAD_REPLY', '', null, 0.1]);
  assert.match(a.error.message, /^Worca's reply could not be read \(/);
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

test('fail closed: more than one turn with no tool call on the stream, or no decision log at all, is a discarded read', async () => {
  const f = feature();
  const turns = fakeRunner([{ summary: 'Hidden steps.' }], { numTurns: 3 });
  const [a] = job.addAttachments(own(f), [pdfFile('turns.pdf')], {}, deps(turns));
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(a.id).status, getAttachment(a.id).summary], ['failed', '']);
  const noLog = { runClaudeImpl: async (o) => { o.onEvent({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: '{"summary":"x"}' }, costUsd: 0.1 }); return { text: '{"summary":"x"}' }; } };
  const [b] = job.addAttachments(own(f), [pdfFile('nolog.pdf', Buffer.from('%PDF-1.7\nother\n'))], {}, deps(noLog));
  await job.readsSettled(own(f));
  assert.deepEqual([getAttachment(b.id).status, getAttachment(b.id).error.code, getAttachment(b.id).summary], ['failed', 'BAD_REPLY', '']);
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
      const real = { runClaudeImpl: (o) => runClaude({ ...o, bin }) };
      const [row] = job.addAttachments(own(f), [pdfFile(`real-${runHook}.pdf`, Buffer.from(`%PDF-1.7\n${runHook}\n`))], {}, deps(real));
      await job.readsSettled(own(f));
      const a = getAttachment(row.id);
      assert.deepEqual([a.status, a.summary], want, `runHook ${runHook}`);
      assert.equal(a.costUsd, 0.1, 'the cost is booked either way');
      rmSync(dir, { recursive: true, force: true });
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
