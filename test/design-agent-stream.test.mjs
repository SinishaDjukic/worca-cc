// test/design-agent-stream.test.mjs — one agent process's normalized events turned into draft, meter and status
// calls (Design P2 Task 9). A real draft store (every append flushes at once), a real meter, a temp work/ folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDraftStore } from '../src/core/design/draft.mjs';
import { createAgentMeter } from '../src/core/design/cost.mjs';
import { createAgentStream } from '../src/core/design/agent-stream.mjs';

const P = 'sections/hero/index.html';
const abs = (w, r) => join(w, ...r.split('/'));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** `realWork` names a second root for work/ under the temp folder, as macOS's `/private/var` is for `/var`; `model:null`
 *  leaves the meter to price by the session's init model. */
function setup({ role = 'builder', sectionId = 'hero', cwdRel = null, on: override = {}, readDisk: diskOverride = null, flushBytes = 1,
  model = 'claude-sonnet-5-5', realWork = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worca-design-stream-'));
  dirs.push(root);
  const w = join(root, 'work');
  mkdirSync(join(w, 'sections', 'hero'), { recursive: true });
  const readDisk = diskOverride || ((rel) => { try { return readFileSync(abs(w, rel), 'utf8'); } catch { return null; } });
  const splices = [];
  const drafts = createDraftStore({ onSplice: (f) => splices.push(f), readDisk, flushBytes, setTimer: () => 0, clearTimer: () => {} });
  const meter = createAgentMeter({ model, costCfg: null });
  const calls = { status: [], tool: [], file: [], usage: 0, book: [], session: [] };
  const on = {
    status: (s) => calls.status.push(s),
    tool: (t) => calls.tool.push(t),
    file: (path, text, rev) => calls.file.push({ path, text, rev }),
    usage: () => { calls.usage += 1; },
    book: (usd) => calls.book.push(usd),
    session: (id) => calls.session.push(id),
    ...override,
  };
  const stream = createAgentStream({ agentId: 'a_1f2e3d4c', role, sectionId, cwd: cwdRel ? abs(w, cwdRel) : w,
    workDir: w, realWorkDir: realWork ? join(root, realWork) : realpathSync(w), drafts, meter, readDisk, on });
  const put = (rel, text) => { mkdirSync(dirname(abs(w, rel)), { recursive: true }); writeFileSync(abs(w, rel), text); };
  return { root, w, drafts, splices, meter, calls, stream, put, send: (e) => stream.onEvent(e) };
}
const ti = (phase, toolUseId, name, partialJson) => ({ type: 'toolInput', phase, parentId: null, messageId: 'm1', index: 0,
  toolUseId, name, ...(partialJson === undefined ? {} : { partialJson }) });
const tool = (...calls) => ({ type: 'tool', parentId: null, messageId: 'm1', calls });
const toolResult = (toolUseId, isError = false) => ({ type: 'toolResult', parentId: null, meta: null,
  results: [{ toolUseId, isError, text: isError ? 'refused' : 'ok', content: isError ? 'refused' : 'ok' }] });
const usage = (phase = 'start', parentId = null) => ({ type: 'usage', messageId: 'm2', parentId, usage: { input_tokens: 10 }, phase });
const text = (t, extra = {}) => ({ type: 'text', text: t, parentId: null, from: 'assistant', messageId: 'm1', ...extra });
const draftText = (drafts, path = P) => drafts.snapshot().find((d) => d.path === path)?.text;
const files = (calls) => calls.file.map((f) => [f.path, f.text]);
/** A streamed Write cut after `content`'s first part: the head of the tool input JSON, no closing quote. */
const head = (w, rel, content) => `{"file_path":${JSON.stringify(abs(w, rel))},"content":${JSON.stringify(content).slice(0, -1)}`;

test('a streamed Write: status, tool path once known, splices, no double from the whole tool', () => {
  const { w, drafts, splices, calls, send } = setup();
  send(ti('start', 't1', 'Write'));
  assert.ok(calls.status.includes('writing'));
  assert.equal(calls.tool.length, 0, 'no tool before its path is known');
  const input = { file_path: abs(w, P), content: '<h1>x</h1>' };
  const json = JSON.stringify(input);
  const cut = json.indexOf('x</h1>');
  send(ti('delta', 't1', 'Write', json.slice(0, cut)));
  assert.deepEqual(calls.tool, [{ name: 'Write', path: P }]);
  assert.equal(draftText(drafts), '<h1>', 'the draft grows while the tool streams');
  send(ti('delta', 't1', 'Write', json.slice(cut)));
  send(ti('stop', 't1', 'Write'));
  send(tool({ name: 'Write', toolUseId: 't1', input }));
  assert.deepEqual(calls.tool, [{ name: 'Write', path: P }], 'the whole tool event reports nothing new');
  assert.deepEqual(calls.status, ['writing'], 'a status is sent on a change only');
  assert.equal(drafts.snapshot().length, 1);
  assert.equal(drafts.snapshot()[0].text, '<h1>x</h1>');
  assert.equal(splices.map((f) => f.splice.text).join(''), '<h1>x</h1>', 'no text twice');
  assert.ok(splices.every((f) => f.agentId === 'a_1f2e3d4c' && f.path === P));
});

test('a stop on a cut tool input sends the held batch at once', () => {
  const { w, splices, send } = setup({ flushBytes: 4096 });
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', head(w, P, '<h1>cut')));
  assert.deepEqual(splices, [], 'appends batch while the tool streams');
  send(ti('stop', 't1', 'Write'));
  assert.equal(splices.map((f) => f.splice.text).join(''), '<h1>cut', 'the reader closes the cut value at stop');
});

test('a repeated start for a known tool changes nothing', () => {
  const { w, drafts, calls, send } = setup();
  const json = JSON.stringify({ file_path: abs(w, P), content: '<h1>x</h1>' });
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', json.slice(0, 5)));
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', json.slice(5)));
  send(ti('stop', 't1', 'Write'));
  assert.equal(draftText(drafts), '<h1>x</h1>', 'the first reader keeps reading');
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', JSON.stringify({ file_path: abs(w, P), content: '<h1>again</h1>' })));
  assert.deepEqual(calls.tool, [{ name: 'Write', path: P }], 'a tool is reported once');
  assert.equal(draftText(drafts), '<h1>x</h1>');
});

test('toolResult re-reads the disk and lands it', () => {
  const { w, drafts, calls, send, put } = setup();
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', JSON.stringify({ file_path: abs(w, P), content: '<h1>x</h1>' })));
  send(ti('stop', 't1', 'Write'));
  put(P, '<h1>disk</h1>');
  send(toolResult('t1'));
  assert.deepEqual(files(calls), [[P, '<h1>disk</h1>']]);
  assert.equal(calls.file[0].rev, drafts.snapshot()[0].rev, 'the landed rev rides along for design-file');
  assert.equal(draftText(drafts), '<h1>disk</h1>');
  assert.equal(calls.status.at(-1), 'thinking');
  assert.equal(calls.tool.at(-1), null, 'the tool clears once its result is in');
});

test('a failed Write rolls the draft back to the disk', () => {
  const { w, drafts, calls, send } = setup();
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', head(w, P, '<h1>half')));
  assert.equal(draftText(drafts), '<h1>half');
  send(toolResult('t1', true));
  assert.deepEqual(files(calls), [[P, '']]);
  assert.equal(draftText(drafts), '');
  send(ti('delta', 't1', 'Write', ' more</h1>"}'));
  assert.equal(draftText(drafts), '', 'a late delta changes nothing');
  assert.equal(calls.file.length, 1);
});

test('a failed Edit rolls back to the old file', () => {
  const { w, drafts, calls, send, put } = setup();
  put(P, '<p>a</p>');
  send(ti('start', 't2', 'Edit'));
  assert.equal(calls.status.at(-1), 'writing');
  send(ti('delta', 't2', 'Edit', JSON.stringify({ file_path: abs(w, P), old_string: 'a', new_string: 'b' })));
  send(ti('stop', 't2', 'Edit'));
  assert.equal(draftText(drafts), '<p>b</p>');
  assert.deepEqual(calls.tool, [{ name: 'Edit', path: P }]);
  send(toolResult('t2', true));
  assert.deepEqual(files(calls), [[P, '<p>a</p>']]);
  assert.equal(draftText(drafts), '<p>a</p>');
});

test('level 2: a whole tool event with no stream still draws', () => {
  const { w, drafts, calls, send, put } = setup();
  const input = { file_path: abs(w, P), content: '<h1>whole</h1>' };
  send(tool({ name: 'Write', toolUseId: 't3', input }));
  assert.equal(calls.status.at(-1), 'writing');
  assert.deepEqual(calls.tool, [{ name: 'Write', path: P }]);
  assert.equal(draftText(drafts), input.content);
  put(P, '<h1>whole</h1>\n');
  send(toolResult('t3'));
  assert.deepEqual(files(calls), [[P, '<h1>whole</h1>\n']]);
  assert.equal(draftText(drafts), '<h1>whole</h1>\n');
});

test('an untracked path shows as a tool but makes no draft', () => {
  const { root, w, drafts, calls, stream, send, put } = setup({ role: 'lead', sectionId: null });
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', JSON.stringify({ file_path: abs(w, 'plan.json'), content: '{"v":1}' })));
  send(ti('stop', 't1', 'Write'));
  send(tool({ name: 'Write', toolUseId: 't2', input: { file_path: abs(w, '.asks/a.json'), content: '{}' } }));
  send(tool({ name: 'Write', toolUseId: 't3', input: { file_path: abs(w, 'shell.html'), content: '<html>' } }));
  send(tool({ name: 'Write', toolUseId: 't4', input: { file_path: join(root, 'outside.html'), content: 'x' } }));
  assert.deepEqual(calls.tool, [
    { name: 'Write', path: 'plan.json' },
    { name: 'Write', path: '.asks/a.json' },
    { name: 'Write', path: 'shell.html' },
    { name: 'Write', path: null },
  ], 'a path outside work/ is null');
  assert.deepEqual(drafts.snapshot(), []);
  put('plan.json', '{"v":1}');
  send(toolResult('t1'));
  send(toolResult('t3'));
  assert.deepEqual(calls.file, [], 'an untracked tool result lands nothing');
  stream.finish();
  assert.deepEqual(calls.file, [], 'an untracked Write is no touch: finish lands nothing');
});

test("a builder drafts only its own section: another section's Write is a tool, no draft and no file", () => {
  const { w, drafts, calls, stream, send, put } = setup();
  const other = 'sections/other/index.html';
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', JSON.stringify({ file_path: abs(w, other), content: '<h1>o</h1>' })));
  send(ti('stop', 't1', 'Write'));
  assert.equal(calls.status.at(-1), 'writing');
  assert.deepEqual(calls.tool, [{ name: 'Write', path: other }], 'on.tool still reports it with its path');
  assert.equal(draftText(drafts, other), undefined, 'the write guard refuses it, so nothing is drawn');
  send(tool({ name: 'Edit', toolUseId: 't2', input: { file_path: abs(w, 'sections/other/style.css'), old_string: 'a', new_string: 'b' } }));
  assert.deepEqual(calls.tool.at(-1), { name: 'Edit', path: 'sections/other/style.css' });
  assert.deepEqual(drafts.snapshot(), [], 'a whole tool outside the section draws nothing either');
  put(other, '<h1>its own builder</h1>');
  send(toolResult('t1', true));
  send(toolResult('t2', true));
  assert.deepEqual(calls.file, [], 'its result lands nothing');
  stream.finish();
  assert.deepEqual(calls.file, [], 'finish lands nothing outside the section');
  assert.deepEqual(drafts.snapshot(), []);

  // The lead's guard is all of work/, so its Write into a section is real and drawn.
  const lead = setup({ role: 'lead', sectionId: null });
  lead.send(tool({ name: 'Write', toolUseId: 't1', input: { file_path: abs(lead.w, other), content: '<h1>lead</h1>' } }));
  assert.equal(draftText(lead.drafts, other), '<h1>lead</h1>');
  lead.put(other, '<h1>lead</h1>');
  lead.send(toolResult('t1'));
  assert.deepEqual(files(lead.calls), [[other, '<h1>lead</h1>']]);
});

test('a relative file_path is tracked', () => {
  const { root, drafts, calls, send } = setup({ cwdRel: 'sections/hero', realWork: 'real-work' });
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', JSON.stringify({ file_path: 'index.html', content: '<h1>r</h1>' })));
  send(ti('stop', 't1', 'Write'));
  assert.deepEqual(calls.tool, [{ name: 'Write', path: P }]);
  assert.equal(draftText(drafts), '<h1>r</h1>');
  send(tool({ name: 'Write', toolUseId: 't2', input: { file_path: 'style.css', content: 'h1{}' } }));
  assert.deepEqual(calls.tool.at(-1), { name: 'Write', path: 'sections/hero/style.css' });
  assert.equal(draftText(drafts, 'sections/hero/style.css'), 'h1{}');
  // The CLI can name the real path of work/ (macOS: /private/var for /var).
  send(tool({ name: 'Write', toolUseId: 't3', input: { file_path: abs(join(root, 'real-work'), 'sections/hero/script.js'), content: 'go()' } }));
  assert.deepEqual(calls.tool.at(-1), { name: 'Write', path: 'sections/hero/script.js' });
  assert.equal(draftText(drafts, 'sections/hero/script.js'), 'go()');
});

test('Read and Grep report reading with the path in work', () => {
  const { w, drafts, calls, send, put } = setup();
  put('sections/hero/style.css', 'h1{}');
  send(ti('start', 'r0', 'Read'));
  send(ti('delta', 'r0', 'Read', JSON.stringify({ file_path: abs(w, 'sections/hero/style.css') })));
  send(ti('stop', 'r0', 'Read'));
  assert.equal(calls.status.at(-1), 'reading');
  assert.deepEqual(calls.tool, [], 'only a Write or Edit is read while it streams');
  send(tool({ name: 'Read', toolUseId: 'r1', input: { file_path: abs(w, 'sections/hero/style.css') } }));
  assert.equal(calls.status.at(-1), 'reading');
  assert.deepEqual(calls.tool.at(-1), { name: 'Read', path: 'sections/hero/style.css' });
  send(toolResult('r1'));
  assert.equal(calls.status.at(-1), 'thinking');
  assert.deepEqual(calls.file, [], 'a Read changes no draft');
  send(tool({ name: 'Grep', toolUseId: 'g1', input: { pattern: 'h1', path: abs(w, 'sections') } }));
  assert.equal(calls.status.at(-1), 'reading');
  assert.deepEqual(calls.tool.at(-1), { name: 'Grep', path: 'sections' });
  send(tool({ name: 'Grep', toolUseId: 'g2', input: { pattern: 'h1' } }));
  assert.deepEqual(calls.tool.at(-1), { name: 'Grep', path: null });
  send(toolResult('g2'));
  send(tool({ name: 'Glob', toolUseId: 'gl1', input: { pattern: '*.css', path: abs(w, 'sections/hero') } }));
  assert.equal(calls.status.at(-1), 'reading', 'Glob reads too');
  assert.deepEqual(calls.tool.at(-1), { name: 'Glob', path: 'sections/hero' });
  assert.deepEqual(drafts.snapshot(), []);
});

test('retry shows retrying, the next usage clears it', () => {
  const { calls, send } = setup();
  send(usage('start'));
  assert.deepEqual(calls.status, ['thinking'], 'the first model turn starts thinking');
  send(ti('start', 't1', 'Write'));
  send(usage('delta'));
  assert.equal(calls.status.at(-1), 'writing', 'usage does not clear a tool status');
  send({ type: 'retry', parentId: null, attempt: 1, reason: 'rate_limit' });
  assert.equal(calls.status.at(-1), 'retrying');
  send(usage('start', 'toolu_child'));
  assert.equal(calls.status.at(-1), 'retrying', "a sub-agent's usage is ignored");
  send(usage('start'));
  assert.deepEqual(calls.status, ['thinking', 'writing', 'retrying', 'thinking']);
  assert.equal(calls.usage, 3);
});

test("a limit event (the usage rings' reading) changes nothing on the stage", () => {
  const { calls, stream, splices, drafts, send } = setup();
  send(usage('start'));
  send(text('Working on the hero.'));
  const state = () => JSON.stringify({ calls, summary: stream.summary(), sawResult: stream.sawResult(), splices, drafts: drafts.snapshot() });
  const before = state();
  send({ type: 'limit', status: 'allowed', windows: [] });
  send({ type: 'limit', status: 'rejected', windows: [{ window: 'five_hour', utilization: 1, resetsAt: 1763100000000 }] });
  assert.equal(state(), before, 'no status, no tool, no file, no usage tick, no booking, no summary');
});

test('result books through the meter and records the subtype', () => {
  const { stream, calls, send } = setup();
  assert.deepEqual([stream.sawResult(), stream.resultSubtype()], [false, null]);
  send({ type: 'result', text: 'done', costUsd: 0.5, cumulativeCost: true, subtype: 'success', isError: false, sessionId: 's1' });
  assert.deepEqual(calls.book, [0.5]);
  assert.equal(stream.sawResult(), true);
  assert.equal(stream.resultSubtype(), 'success');
  const blank = setup();
  blank.send({ type: 'result', text: '', costUsd: undefined, isError: true });
  assert.deepEqual(blank.calls.book, [null], 'an unknown cost books blank, never $0');
  assert.deepEqual([blank.stream.sawResult(), blank.stream.resultSubtype()], [true, null]);
});

test('usage and the init session reach the meter, so a kill books priced usage', () => {
  const { meter, send } = setup({ model: null });
  send({ type: 'session', sessionId: 's-1', model: 'claude-sonnet-5-5', init: true });
  send(usage('start'));
  assert.equal(meter.snapshot().tokens.in, 10);
  assert.ok(meter.snapshot().estimatedUsd > 0, 'the session model prices the open message');
  assert.ok(meter.settleCut() > 0);
});

test('summary is the last non-empty line of the last assistant text, capped at 200', () => {
  const { stream, send } = setup();
  assert.equal(stream.summary(), '');
  send(text('Planning the hero.'));
  send(text('Hero done.\n  A bold hero with one CTA.  \n\n'));
  send(text('streamed words', { delta: true }));
  send(text('a sub-agent line', { parentId: 'toolu_child' }));
  send({ type: 'text', text: 'the person', parentId: null, from: 'user' });
  send({ type: 'text', text: 'API Error', parentId: null, from: 'cli' });
  assert.equal(stream.summary(), 'A bold hero with one CTA.');
  send(text(`first\n${'x'.repeat(300)}`));
  assert.equal(stream.summary(), 'x'.repeat(200));
  send(text(' \n\t\n'));
  assert.equal(stream.summary(), 'x'.repeat(200), 'a blank final text keeps the last line');
  send(text(`${'y'.repeat(199)}${String.fromCodePoint(0x1f600)}tail`));
  assert.equal(stream.summary(), 'y'.repeat(199), 'the cap never splits a surrogate pair');
});

test('session events pass the id; a null id is ignored', () => {
  const { calls, send } = setup();
  send({ type: 'session', sessionId: 's-1', model: 'claude-sonnet-5-5', init: true });
  send({ type: 'session', sessionId: null, model: null, init: true });
  send({ type: 'session', sessionId: 's-2', model: null, init: true, parentId: 'toolu_child' });
  assert.deepEqual(calls.session, ['s-1']);
});

test('finish lands touched paths and expected files, and skips an untouched missing file', () => {
  const { w, drafts, calls, stream, send, put } = setup();
  put('sections/hero/style.css', 'h1{}');
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', head(w, P, '<h1>half')));
  assert.equal(draftText(drafts), '<h1>half');
  send(tool({ name: 'Read', toolUseId: 'r1', input: { file_path: abs(w, 'sections/hero/script.js') } }));
  send(toolResult('r1', true));
  // Outside its section the write guard refuses it, so the stage never draws it (L2.36).
  send(ti('start', 't2', 'Write'));
  send(ti('delta', 't2', 'Write', head(w, 'global.css', 'body{')));
  assert.equal(draftText(drafts, 'global.css'), undefined);
  stream.finish();
  assert.deepEqual(files(calls), [[P, ''], ['sections/hero/style.css', 'h1{}']],
    'a Read is no touch; a touched path outside the section never lands');
  assert.equal(draftText(drafts), '', 'a killed Write leaves no half draft');
  assert.equal(draftText(drafts, 'global.css'), undefined);
  assert.equal(draftText(drafts, 'sections/hero/script.js'), undefined);
  send(ti('delta', 't1', 'Write', ' more</h1>"}'));
  assert.equal(draftText(drafts), '', 'nothing streams after finish');

  const lead = setup({ role: 'lead', sectionId: null });
  lead.put('global.css', 'body{}');
  lead.put(P, '<h1>a builder file</h1>');
  lead.stream.finish();
  assert.deepEqual(files(lead.calls), [['global.css', 'body{}']], 'a lead lands tokens.css and global.css only');
});

test('a throwing listener or disk reader never breaks the stream', () => {
  const boom = () => { throw new Error('listener'); };
  const { w, drafts, stream, send, put } = setup({ on: { status: boom, tool: boom, file: boom, usage: boom, book: boom, session: boom } });
  send({ type: 'session', sessionId: 's-1', model: null, init: true });
  send(usage('start'));
  send(ti('start', 't1', 'Write'));
  send(ti('delta', 't1', 'Write', JSON.stringify({ file_path: abs(w, P), content: '<h1>x</h1>' })));
  send(ti('stop', 't1', 'Write'));
  assert.equal(draftText(drafts), '<h1>x</h1>');
  put(P, '<h1>disk</h1>');
  send(toolResult('t1'));
  assert.equal(draftText(drafts), '<h1>disk</h1>');
  send({ type: 'result', costUsd: 0.1, cumulativeCost: true, subtype: 'success', isError: false });
  assert.equal(stream.sawResult(), true);
  stream.finish();

  const blind = setup({ readDisk: () => { throw new Error('EACCES'); } });
  blind.send(tool({ name: 'Write', toolUseId: 't1', input: { file_path: abs(blind.w, P), content: '<h1>x</h1>' } }));
  blind.send(toolResult('t1'));
  assert.deepEqual(files(blind.calls), [[P, '']], 'an unreadable file lands as missing');
  blind.stream.finish();
  assert.deepEqual(files(blind.calls), [[P, ''], [P, '']]);
});
