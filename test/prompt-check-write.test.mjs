// test/prompt-check-write.test.mjs — Shaper ask screens: the model call of "Write it out"
// (src/core/prompt-check/write.mjs): the prompt it builds, the reply it reads, the locked-down call it shares with the
// check, its failure reasons and the mock runner. The model returns only fills, never the prompt. No CLI is spawned: the
// runner is the test seam or the mock. Imported inside each test, so a missing module fails only its own case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(test.after);
const { worcaHome } = await import('../src/core/projects.mjs');
const { GUIDE_CHECK_LABELS } = await import('../src/shared/prompt-check/assessment.mjs');
const { GUIDE_CALL_OPTS, quotePromptText, _setGuideCheckForTest } = await import('../src/core/prompt-check/grade.mjs');
const load = () => import('../src/core/prompt-check/write.mjs');

const IDS = ['who', 'what', 'trigger', 'limits', 'done'];
const MODEL = 'claude-sonnet-5-5';
const TEXT = 'Line one  \nSend every team lead a weekly digest of open reviews';
const GAPS = ['what', 'done'];
const FILLS = { what: 'one email per lead', done: 'it arrives on Monday' };
const REPLY = JSON.stringify({ fills: FILLS });

function withRunner(t, run) {
  _setGuideCheckForTest({ run });
  t.after(() => _setGuideCheckForTest(null));
}
/** A call that ends only when its signal aborts (with a late safety reply, so a broken abort fails and never hangs). */
const hanging = (o) => new Promise((resolve, reject) => {
  const safety = setTimeout(() => resolve({ text: '{}' }), 3000);
  const stop = () => { clearTimeout(safety); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
  if (o.signal?.aborted) stop(); else o.signal?.addEventListener('abort', stop, { once: true });
});
async function withMockEnv(value, fn) {
  const was = process.env.WORCA_MOCK;
  if (value === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = value;
  try { await fn(); } finally {
    if (was === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = was;
  }
}
const input = (register = 'technical', gaps = GAPS) => ({ text: TEXT, register, gaps });

test('the write\'s limit is 30 s', async () => {
  const { GUIDE_WRITE_TIMEOUT_MS } = await load();
  assert.equal(GUIDE_WRITE_TIMEOUT_MS, 30_000);
});

test('guideWritePrompt names only the asked gaps, in the register\'s labels, quotes the text and asks for {"fills": …}', async () => {
  const { guideWritePrompt } = await load();
  for (const [register, other] of [['plain', 'technical'], ['technical', 'plain']]) {
    const { systemPrompt, prompt } = guideWritePrompt(input(register));
    const all = `${systemPrompt}\n${prompt}`;
    for (const id of IDS) {
      assert.equal(prompt.includes(GUIDE_CHECK_LABELS[register][id]), GAPS.includes(id), `${register}: ${GUIDE_CHECK_LABELS[register][id]}`);
      assert.ok(!all.includes(GUIDE_CHECK_LABELS[other][id]), `${register} must not carry ${GUIDE_CHECK_LABELS[other][id]}`);
    }
    for (const word of ['"fills"', '200', ...GAPS]) assert.ok(prompt.includes(word), `${register}: ${word}`);
    assert.match(all, /JSON/);
    assert.ok(prompt.includes(quotePromptText(TEXT)), 'the text is quoted between the delimiters');
  }
});

test('parseWriteReply: the fills object of the first {…} block, or null', async () => {
  const { parseWriteReply } = await load();
  assert.deepEqual(parseWriteReply(`Here:\n\`\`\`json\n${REPLY}\n\`\`\``), FILLS);
  for (const raw of ['sure!', '', null, undefined, '{not json}', '[1,2]', '{"text":"x"}', '{"fills":"x"}', '{"fills":[1]}', '{"fills":null}']) {
    assert.equal(parseWriteReply(raw), null, String(raw));
  }
});

test('mockWrite: deterministic, one short phrase for each asked gap and for no other', async () => {
  const { mockWrite } = await load();
  for (const register of ['plain', 'technical']) {
    const a = mockWrite(GAPS, register);
    assert.deepEqual(mockWrite(GAPS, register), a, 'the same object for the same gaps');
    assert.deepEqual(Object.keys(a.fills).sort(), [...GAPS].sort());
    for (const v of Object.values(a.fills)) assert.ok(typeof v === 'string' && v.trim() && v.length <= 200, v);
  }
});

test('R-sec-2: writeOutPrompt runs the given model and effort with the whole lockdown set, in an empty folder that is removed', async (t) => {
  const { writeOutPrompt, guideWritePrompt } = await load();
  const seen = [];
  const costs = [];
  withRunner(t, async (o) => {
    seen.push({ ...o, cwdExists: existsSync(o.cwd), files: existsSync(o.cwd) ? readdirSync(o.cwd) : null });
    o.onEvent({ type: 'result', costUsd: 0.001, usage: { input_tokens: 10, output_tokens: 5 } });
    return { text: REPLY };
  });
  const r = await writeOutPrompt(input(), { model: MODEL, effort: 'high', onCost: (c) => costs.push(c) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(seen.length, 1);
  const o = seen[0];
  assert.equal(o.model, MODEL);
  assert.equal(o.effort, 'high');
  for (const [k, v] of Object.entries(GUIDE_CALL_OPTS)) assert.deepEqual(o[k], v, k);
  assert.deepEqual(o.allowedTools, []);
  assert.equal(o.engine, undefined, 'Claude only');
  assert.ok(o.cwd.startsWith(join(worcaHome(), 'tmp') + sep), o.cwd);
  assert.equal(o.cwdExists, true);
  assert.deepEqual(o.files, [], 'a fresh empty folder');
  assert.equal(existsSync(o.cwd), false, 'the folder is removed after the call');
  const built = guideWritePrompt(input());
  assert.equal(o.prompt, built.prompt);
  assert.equal(o.systemPrompt, built.systemPrompt);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].model, MODEL);
});

test('R-po-4: writeOutPrompt composes the text from the prompt and the fills; the model\'s own text is never used', async (t) => {
  const { writeOutPrompt } = await load();
  withRunner(t, async () => ({ text: JSON.stringify({ text: 'REWRITTEN', fills: { ...FILLS, who: 'NOT ASKED' } }) }));
  for (const register of ['plain', 'technical']) {
    const label = GUIDE_CHECK_LABELS[register];
    assert.deepEqual(await writeOutPrompt(input(register), { model: MODEL }), {
      ok: true,
      result: { text: `${TEXT}\n${label.what}: ${FILLS.what} (suggested)\n${label.done}: ${FILLS.done} (suggested)`, filled: GAPS },
    }, register);
  }
});

test('writeOutPrompt resolves "no fills" for a rewrite alone, empty fills, or fills for gaps not asked', async (t) => {
  const { writeOutPrompt } = await load();
  for (const text of ['{"text":"a rewritten prompt"}', '{"fills":{}}', '{"fills":{"what":"  ","done":""}}', '{"fills":{"who":"team leads"}}']) {
    withRunner(t, async () => ({ text }));
    assert.deepEqual(await writeOutPrompt(input(), { model: MODEL }), { ok: false, reason: 'no fills' }, text);
  }
});

test('writeOutPrompt never throws: "model call failed" and "unreadable reply", with the folder removed', async (t) => {
  const { writeOutPrompt } = await load();
  const folders = [];
  for (const [reason, run] of [
    ['model call failed', async (o) => { folders.push(o.cwd); throw new Error('boom'); }],
    ['unreadable reply', async (o) => { folders.push(o.cwd); return { text: 'sure!' }; }],
    ['unreadable reply', async (o) => { folders.push(o.cwd); return { text: '{not json}' }; }],
  ]) {
    withRunner(t, run);
    assert.deepEqual(await writeOutPrompt(input(), { model: MODEL }), { ok: false, reason });
  }
  assert.equal(folders.length, 3);
  for (const f of folders) assert.equal(existsSync(f), false, f);
});

test('writeOutPrompt resolves "timeout" for a model that never answers', async (t) => {
  const { writeOutPrompt } = await load();
  // AbortSignal.timeout's timer does not hold the event loop open: one ref'd timer while the runner hangs.
  const hold = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(hold));
  withRunner(t, () => new Promise(() => {}));
  assert.deepEqual(await writeOutPrompt(input(), { model: MODEL, timeoutMs: 50 }), { ok: false, reason: 'timeout' });
});

test('writeOutPrompt resolves "aborted" when its signal aborts, before or during the call', async (t) => {
  const { writeOutPrompt } = await load();
  withRunner(t, hanging);
  const early = new AbortController();
  early.abort();
  assert.deepEqual(await writeOutPrompt(input(), { model: MODEL, signal: early.signal }), { ok: false, reason: 'aborted' });
  const later = new AbortController();
  const p = writeOutPrompt(input(), { model: MODEL, signal: later.signal });
  setTimeout(() => later.abort(), 20);
  assert.deepEqual(await p, { ok: false, reason: 'aborted' });
});

test('under WORCA_MOCK the write answers mockWrite\'s fills for exactly the asked gaps, with no CLI', async (t) => {
  const { writeOutPrompt, mockWrite } = await load();
  const { composeWrittenOut } = await import('../src/shared/prompt-check/write-out.mjs');
  _setGuideCheckForTest(null);
  t.after(() => _setGuideCheckForTest(null));
  await withMockEnv('1', async () => {
    for (const register of ['plain', 'technical']) {
      for (const gaps of [GAPS, ['who'], IDS]) {
        const r = await writeOutPrompt(input(register, gaps), { model: MODEL });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual(r.result, composeWrittenOut({ text: TEXT, register, gaps, fills: mockWrite(gaps, register).fills }));
        assert.deepEqual(r.result.filled, gaps);
      }
    }
  });
});
