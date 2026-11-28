// test/prompt-check-write-out.test.mjs — Shaper ask screens: the browser-safe contract of "Write it out"
// (src/shared/prompt-check/write-out.mjs): the request validator, the fill cleaner, the line separator and the composer
// of the written text. The person's prompt is always the exact start of the output and every added line ends in
// "(suggested)". Pure: no model, no settings. Imported inside each test, so a missing export fails only its own case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_CHECK_IDS, GUIDE_CHECK_LABELS, GUIDE_PROMPT_MAX } from '../src/shared/prompt-check/assessment.mjs';

const load = () => import('../src/shared/prompt-check/write-out.mjs');
const PROMPT = 'Send every team lead a weekly digest of open reviews';
const MARKUP = '<img src=x onerror=alert(1)>';

const refusal = (code, status, message) => (err) => {
  assert.equal(err.code, code, err.message);
  assert.equal(err.status, status);
  if (message) assert.equal(err.message, message);
  return true;
};

test('the constants: "(suggested)" and a 200-character fill', async () => {
  const { SUGGESTED, GUIDE_FILL_MAX } = await load();
  assert.equal(SUGGESTED, '(suggested)');
  assert.equal(GUIDE_FILL_MAX, 200);
});

test('assertGuideWriteInput: the untouched prompt, the role (null for none) and the gaps in the checks\' order', async () => {
  const { assertGuideWriteInput } = await load();
  const text = '  Line one  \nLine two \n  ';
  assert.deepEqual(assertGuideWriteInput({ prompt: text, role: 'product', gaps: ['done', 'who', 'limits'] }),
    { text, role: 'product', gaps: ['who', 'limits', 'done'] });
  for (const role of [undefined, null, '']) {
    assert.deepEqual(assertGuideWriteInput({ prompt: PROMPT, role, gaps: ['what'] }), { text: PROMPT, role: null, gaps: ['what'] }, String(role));
  }
  assert.deepEqual(assertGuideWriteInput({ prompt: PROMPT, gaps: [...GUIDE_CHECK_IDS].reverse() }).gaps, [...GUIDE_CHECK_IDS]);
});

test('assertGuideWriteInput: gaps that are not a non-empty list of distinct check ids are 400 GUIDE_BAD_GAPS', async () => {
  const { assertGuideWriteInput } = await load();
  for (const gaps of [undefined, null, [], 'who', {}, ['who', 'who'], ['admin'], ['who', 'admin'], [7], [null]]) {
    assert.throws(() => assertGuideWriteInput({ prompt: PROMPT, gaps }),
      refusal('GUIDE_BAD_GAPS', 400, 'Guide needs the gaps to fill.'), JSON.stringify(gaps) ?? 'missing');
  }
});

test('assertGuideWriteInput: the check\'s own refusals come first: a bad role, then the prompt, then the gaps', async () => {
  const { assertGuideWriteInput } = await load();
  assert.throws(() => assertGuideWriteInput({ prompt: PROMPT, role: 'admin', gaps: [] }), refusal('GUIDE_BAD_ROLE', 400));
  assert.throws(() => assertGuideWriteInput({ prompt: 'a'.repeat(GUIDE_PROMPT_MAX + 1), role: 'admin' }), refusal('GUIDE_BAD_ROLE', 400));
  assert.throws(() => assertGuideWriteInput({ prompt: '   ', gaps: ['admin'] }), refusal('GUIDE_BAD_PROMPT', 400));
  assert.throws(() => assertGuideWriteInput({ prompt: 'a'.repeat(GUIDE_PROMPT_MAX + 1) }), refusal('GUIDE_PROMPT_TOO_LONG', 413));
  assert.throws(() => assertGuideWriteInput({}), refusal('GUIDE_BAD_PROMPT', 400));
  assert.throws(() => assertGuideWriteInput(undefined), refusal('GUIDE_BAD_PROMPT', 400));
});

test('cleanFill: one line, control characters dropped, whitespace collapsed and trimmed; "" for a non-string', async () => {
  const { cleanFill } = await load();
  assert.equal(cleanFill('  people  on\n\tthe team  '), 'people on the team');
  assert.equal(cleanFill('one\r\ntwo\u2028three'), 'one two three');
  assert.equal(cleanFill('te\u0000am\u0007 le\u007Fads'), 'team leads');
  for (const v of [undefined, null, 7, {}, ['x'], true]) assert.equal(cleanFill(v), '', String(v));
  assert.equal(cleanFill('   \n '), '');
  assert.equal(cleanFill(MARKUP), MARKUP, 'markup stays the same characters');
});

test('cleanFill: a trailing "(suggested)" the model wrote is removed, in any case and repeated', async () => {
  const { cleanFill } = await load();
  assert.equal(cleanFill('team leads (suggested)'), 'team leads');
  assert.equal(cleanFill('team leads (Suggested) (SUGGESTED)  '), 'team leads');
  assert.equal(cleanFill('team leads(suggested)'), 'team leads');
  assert.equal(cleanFill('(suggested)'), '');
  assert.equal(cleanFill('the (suggested) retries stay'), 'the (suggested) retries stay', 'only at the end');
});

test('cleanFill: at most 200 characters', async () => {
  const { cleanFill } = await load();
  assert.equal(cleanFill('a'.repeat(500)), 'a'.repeat(200));
  assert.equal(cleanFill('a'.repeat(200)), 'a'.repeat(200));
});

test('appendAnswer lives in the shared module, and the composer exports that same function', async () => {
  const { appendAnswer } = await load();
  assert.equal(appendAnswer('', 'x'), 'x');
  assert.equal(appendAnswer('a\n', 'x'), 'a\nx');
  assert.equal(appendAnswer('a  ', 'x'), 'a  \nx');
  const composer = await import('../ui/public/chat/guide-line.mjs');
  assert.equal(composer.appendAnswer, appendAnswer);
});

test('R-po-4: composeWrittenOut keeps the prompt byte for byte at the start and adds one "(suggested)" line per filled gap', async () => {
  const { composeWrittenOut } = await load();
  const text = 'Line one  \nLine two \n  ';
  for (const register of ['plain', 'technical']) {
    const label = GUIDE_CHECK_LABELS[register];
    const got = composeWrittenOut({ text, register, gaps: ['who', 'done'], fills: { who: 'team leads', done: ' an email\narrives ' } });
    assert.deepEqual(got, {
      text: `${text}\n${label.who}: team leads (suggested)\n${label.done}: an email arrives (suggested)`,
      filled: ['who', 'done'],
    }, register);
    assert.ok(got.text.startsWith(text), register);
  }
});

test('composeWrittenOut: a prompt that ends in a line break gets no second one', async () => {
  const { composeWrittenOut } = await load();
  const got = composeWrittenOut({ text: `${PROMPT}\n`, register: 'technical', gaps: ['limits'], fills: { limits: 'one a week' } });
  assert.equal(got.text, `${PROMPT}\nConstraints: one a week (suggested)`);
});

test('composeWrittenOut: the lines follow the checks\' order, whatever order the gaps and fills come in', async () => {
  const { composeWrittenOut } = await load();
  const got = composeWrittenOut({
    text: PROMPT, register: 'technical', gaps: ['done', 'trigger', 'who'], fills: { done: 'd', who: 'w', trigger: 't' },
  });
  assert.deepEqual(got.filled, ['who', 'trigger', 'done']);
  assert.equal(got.text, `${PROMPT}\nWho calls it: w (suggested)\nTrigger and scope: t (suggested)\nAcceptance checks: d (suggested)`);
});

test('composeWrittenOut: a fill for a gap not asked is ignored, and so is an empty or unusable one', async () => {
  const { composeWrittenOut } = await load();
  const got = composeWrittenOut({
    text: PROMPT, register: 'plain', gaps: ['what', 'limits', 'done'],
    fills: { who: 'NOT ASKED', what: 'a digest', limits: '  (suggested) ', done: 7, extra: 'x', text: 'REWRITTEN' },
  });
  assert.deepEqual(got, { text: `${PROMPT}\nWhat they get: a digest (suggested)`, filled: ['what'] });
});

test('composeWrittenOut never throws: unusable fills leave the prompt as it was, and only own properties count', async () => {
  const { composeWrittenOut } = await load();
  for (const fills of [undefined, null, 'x', 7, [], {}, Object.create({ who: 'inherited' })]) {
    assert.deepEqual(composeWrittenOut({ text: PROMPT, register: 'plain', gaps: ['who'], fills }), { text: PROMPT, filled: [] }, String(fills && 'object'));
  }
});

test('R-sec-1: markup in a fill is kept as the same characters', async () => {
  const { composeWrittenOut } = await load();
  const got = composeWrittenOut({ text: PROMPT, register: 'plain', gaps: ['who'], fills: { who: MARKUP } });
  assert.equal(got.text, `${PROMPT}\nWho is it for: ${MARKUP} (suggested)`);
});
