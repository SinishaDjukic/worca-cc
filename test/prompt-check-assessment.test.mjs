// test/prompt-check-assessment.test.mjs — Shaper ask screens, slice 4: the browser-safe contract of Guide's check
// (src/shared/prompt-check/assessment.mjs): the five checks and their two label sets, the sizes, the prompt limit, the
// request validator and the reply normalizer. Pure: no model, no settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import {
  GUIDE_CHECK_IDS, GUIDE_CHECK_LABELS, GUIDE_DEFAULT_QUESTIONS, GUIDE_SIZES, GUIDE_PROMPT_MAX, GUIDE_QUESTION_MAX,
  guideRegister, sizeByWords, assertGuideCheckInput, normalizeGuideCheck,
} from '../src/shared/prompt-check/assessment.mjs';

const IDS = ['who', 'what', 'trigger', 'limits', 'done'];
const PLAIN = ['Who is it for', 'What they get', 'What starts it', 'Limits', 'How you know it worked'];
const TECHNICAL = ['Who calls it', 'The behaviour', 'Trigger and scope', 'Constraints', 'Acceptance checks'];
const REGISTERS = ['plain', 'technical'];
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

/** The invariant of every normalized result: five checks in order, each covered or with a question. */
function assertResult(r, register, note = '') {
  assert.deepEqual(Object.keys(r).sort(), ['checks', 'register', 'size'], note);
  assert.equal(r.register, register, note);
  assert.ok(['small', 'medium', 'large'].includes(r.size), `${note} size ${r.size}`);
  assert.deepEqual(r.checks.map((c) => c.id), IDS, note);
  assert.deepEqual(r.checks.map((c) => c.label), register === 'plain' ? PLAIN : TECHNICAL, note);
  for (const c of r.checks) {
    assert.deepEqual(Object.keys(c).sort(), ['covered', 'id', 'label', 'question'], note);
    assert.equal(typeof c.covered, 'boolean', note);
    assert.equal(typeof c.question, 'string', note);
    if (c.covered) assert.equal(c.question, '', `${note} ${c.id}: covered has no question`);
    else assert.ok(c.question.trim().length > 0 && c.question.length <= 160, `${note} ${c.id}: open has a short question`);
  }
}

test('the contract: five ids, the two label sets, the sizes and the limits, all frozen', () => {
  assert.deepEqual([...GUIDE_CHECK_IDS], IDS);
  assert.deepEqual(IDS.map((id) => GUIDE_CHECK_LABELS.plain[id]), PLAIN);
  assert.deepEqual(IDS.map((id) => GUIDE_CHECK_LABELS.technical[id]), TECHNICAL);
  assert.deepEqual([...GUIDE_SIZES], ['small', 'medium', 'large']);
  assert.equal(GUIDE_PROMPT_MAX, 8000);
  assert.equal(GUIDE_QUESTION_MAX, 160);
  for (const v of [GUIDE_CHECK_IDS, GUIDE_CHECK_LABELS, GUIDE_DEFAULT_QUESTIONS, GUIDE_SIZES]) assert.ok(Object.isFrozen(v));
});

test('every default question ends in "?", adds to its label and never equals it', () => {
  for (const register of REGISTERS) {
    assert.deepEqual(Object.keys(GUIDE_DEFAULT_QUESTIONS[register]), IDS, register);
    for (const id of IDS) {
      const q = GUIDE_DEFAULT_QUESTIONS[register][id];
      const label = GUIDE_CHECK_LABELS[register][id];
      assert.ok(q.endsWith('?') && q.length <= GUIDE_QUESTION_MAX, `${register}.${id}: ${q}`);
      assert.notEqual(q.replace(/\?$/, '').toLowerCase(), label.toLowerCase(), `${register}.${id}`);
    }
  }
  assert.equal(GUIDE_DEFAULT_QUESTIONS.plain.who, 'Who will use it, and in what role?');
  assert.equal(GUIDE_DEFAULT_QUESTIONS.plain.done, 'What will you see when it works?');
  assert.equal(GUIDE_DEFAULT_QUESTIONS.technical.done, 'Which checks prove it works?');
});

test('guideRegister: plain for product, ux and compliance; technical for the other leads and for no role', () => {
  for (const role of ['product', 'ux', 'compliance']) assert.equal(guideRegister(role), 'plain', role);
  for (const role of ['architect', 'qa', 'security', 'devops', null, undefined, '']) {
    assert.equal(guideRegister(role), 'technical', String(role));
  }
});

test('sizeByWords: under 60 words small, under 200 medium, else large', () => {
  assert.equal(sizeByWords('one two three'), 'small');
  assert.equal(sizeByWords(words(59)), 'small');
  assert.equal(sizeByWords(words(60)), 'medium');
  assert.equal(sizeByWords(words(199)), 'medium');
  assert.equal(sizeByWords(words(200)), 'large');
});

const refusal = (code, status, message) => (err) => {
  assert.ok(err instanceof Error);
  assert.deepEqual({ code: err.code, status: err.status, message: err.message }, { code, status, message });
  return true;
};
const BAD_ROLE = refusal('GUIDE_BAD_ROLE', 400, 'Guide does not know that role.');
const BAD_PROMPT = refusal('GUIDE_BAD_PROMPT', 400, 'Guide needs a prompt to check.');
const TOO_LONG = refusal('GUIDE_PROMPT_TOO_LONG', 413, 'The prompt is longer than Guide checks (8000 characters).');

test('R-sec-1: no role (absent, null, undefined, "") is accepted as null, and every known lead is kept', () => {
  for (const body of [{ prompt: 'Send a weekly digest' }, { prompt: 'Send a weekly digest', role: null },
    { prompt: 'Send a weekly digest', role: undefined }, { prompt: 'Send a weekly digest', role: '' }]) {
    assert.deepEqual(assertGuideCheckInput(body), { text: 'Send a weekly digest', role: null }, JSON.stringify(body));
  }
  for (const role of ['product', 'architect', 'ux', 'qa', 'security', 'devops', 'compliance']) {
    assert.deepEqual(assertGuideCheckInput({ prompt: 'Send a weekly digest', role }), { text: 'Send a weekly digest', role }, role);
  }
});

test('R-sec-1: an unknown role is refused with GUIDE_BAD_ROLE (400)', () => {
  for (const role of ['admin', 7, 0, false, {}, ['qa'], 'constructor']) {
    assert.throws(() => assertGuideCheckInput({ prompt: 'Send a weekly digest', role }), BAD_ROLE, JSON.stringify(role));
  }
});

test('R-sec-1: 8000 characters are accepted and 8001 are refused with GUIDE_PROMPT_TOO_LONG (413), untrimmed', () => {
  assert.equal(assertGuideCheckInput({ prompt: 'a'.repeat(8000) }).text.length, 8000);
  assert.throws(() => assertGuideCheckInput({ prompt: 'a'.repeat(8001) }), TOO_LONG);
  assert.throws(() => assertGuideCheckInput({ prompt: `${'a'.repeat(8000)} ` }), TOO_LONG, 'the raw length counts');
});

test('R-sec-1: a missing, blank or non-string prompt and a non-object body are GUIDE_BAD_PROMPT (400)', () => {
  for (const body of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: '\n\t' }, { prompt: 12 }, { prompt: ['x'] },
    null, undefined, 'a prompt', [], ['a prompt']]) {
    assert.throws(() => assertGuideCheckInput(body), BAD_PROMPT, JSON.stringify(body));
  }
});

test('R-sec-1: the role is checked first: "admin" with an over-long or missing prompt reads GUIDE_BAD_ROLE', () => {
  assert.throws(() => assertGuideCheckInput({ prompt: 'a'.repeat(9000), role: 'admin' }), BAD_ROLE);
  assert.throws(() => assertGuideCheckInput({ role: 'admin' }), BAD_ROLE);
});

test('normalizeGuideCheck: a reply with nothing usable gives five open checks with the register\'s default questions', () => {
  for (const register of REGISTERS) {
    const arrayChecks = { checks: IDS.map(() => ({ covered: true, question: '' })) };
    for (const raw of [{}, null, undefined, 'covered', 7, [], { checks: null }, { checks: 'all' }, arrayChecks]) {
      const note = `${register} ${JSON.stringify(raw)}`;
      const r = normalizeGuideCheck(raw, { register, text: 'short prompt' });
      assertResult(r, register, note);
      assert.deepEqual(r.checks.map((c) => c.covered), [false, false, false, false, false], note);
      assert.deepEqual(r.checks.map((c) => c.question), IDS.map((id) => GUIDE_DEFAULT_QUESTIONS[register][id]), note);
    }
  }
});

test('normalizeGuideCheck: covered drops the question, an open check keeps its own or gets the default', () => {
  const r = normalizeGuideCheck({
    size: 'medium',
    checks: {
      who: { covered: true, question: 'Who receives the emails?' },
      what: { covered: false, question: '  What does\nthe   email hold?  ' },
      trigger: { covered: false, question: '' },
      limits: { covered: 'yes' },
      done: { covered: false, question: 42 },
    },
  }, { register: 'plain', text: 'short prompt' });
  assertResult(r, 'plain');
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.deepEqual([by.who.covered, by.who.question], [true, '']);
  assert.deepEqual([by.what.covered, by.what.question], [false, 'What does the email hold?']);
  for (const id of ['trigger', 'limits', 'done']) {
    assert.deepEqual([by[id].covered, by[id].question], [false, GUIDE_DEFAULT_QUESTIONS.plain[id]], id);
  }
  assert.equal(r.size, 'medium');
});

test('normalizeGuideCheck: a long multi-line question becomes one line of 160 characters', () => {
  const long = `${'a'.repeat(100)}\r\n\n${'b'.repeat(300)}`;
  const r = normalizeGuideCheck({ checks: { who: { covered: false, question: long } } }, { register: 'technical', text: 'x' });
  const q = r.checks[0].question;
  assert.equal(q.length, 160);
  assert.doesNotMatch(q, /[\r\n]/);
  assert.ok(q.startsWith(`${'a'.repeat(100)} b`));
});

test('normalizeGuideCheck: "very-large" reads large, and a missing or unknown size falls back to the word count', () => {
  const size = (raw, text) => normalizeGuideCheck(raw, { register: 'plain', text }).size;
  assert.equal(size({ size: 'very-large' }, 'x'), 'large');
  assert.equal(size({ size: 'small' }, words(300)), 'small', 'a known size wins over the word count');
  assert.equal(size({ size: 'large' }, 'x'), 'large');
  assert.equal(size({}, words(3)), 'small');
  assert.equal(size({ size: 'huge' }, words(60)), 'medium');
  assert.equal(size({ size: 5 }, words(200)), 'large');
});

test('a reply cannot set a label, and its extra keys are dropped', () => {
  const r = normalizeGuideCheck({
    label: 'EVIL', register: 'plain', note: 'extra',
    checks: {
      who: { covered: true, label: 'EVIL', id: 'EVIL', extra: 1 },
      what: { covered: false, question: 'Which fields?', label: '<img src=x>' },
      sixth: { covered: false, question: 'More?' },
    },
  }, { register: 'technical', text: 'x' });
  assertResult(r, 'technical');
  assert.doesNotMatch(JSON.stringify(r), /EVIL|img src|sixth|extra/);
});

test('every normalized check is covered or has a question', () => {
  const entries = [undefined, null, 'no', 7, [], {}, { covered: true }, { covered: true, question: 'Q?' }, { covered: false },
    { covered: false, question: '' }, { covered: false, question: '   \n ' }, { covered: false, question: 'q'.repeat(900) },
    { question: 'Q?' }, { covered: 1, question: {} }];
  for (const register of REGISTERS) {
    for (const entry of entries) {
      const raw = { checks: Object.fromEntries(IDS.map((id) => [id, entry])) };
      assertResult(normalizeGuideCheck(raw, { register, text: 'x' }), register, `${register} ${JSON.stringify(entry)?.slice(0, 40)}`);
    }
  }
});

test('R-arch-9: assessment.mjs imports only from src/shared, so the composer can import it', () => {
  const url = new URL('../src/shared/prompt-check/assessment.mjs', import.meta.url);
  const source = readFileSync(url, 'utf8');
  // Import and re-export statements only, so a quoted path in a comment is not read as an import.
  const specifiers = [/^\s*(?:import|export)\b[^'";=]*?\bfrom\s*['"]([^'"]+)['"]/gm, /^\s*import\s*['"]([^'"]+)['"]/gm]
    .flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/, 'static imports only');
  assert.ok(specifiers.includes('../answerer.mjs'), 'reuses the answerer leads');
  const shared = fileURLToPath(new URL('../src/shared/', import.meta.url));
  for (const s of specifiers) {
    assert.ok(s.startsWith('.'), `a relative import: ${s}`);
    const target = fileURLToPath(new URL(s, url));
    assert.ok(target.startsWith(shared.endsWith(sep) ? shared : shared + sep), `inside src/shared: ${s}`);
  }
});
