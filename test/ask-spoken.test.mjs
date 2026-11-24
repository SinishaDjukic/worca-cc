// The <spoken>…</spoken> splitter (hands-free voice replies): pure, streamed and whole-text agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpokenSplitter, splitSpoken, SPOKEN_OPEN, SPOKEN_CLOSE, SPOKEN_MAX_CHARS } from '../src/core/ask/spoken.mjs';

const drive = (chunks, opts) => {
  const s = createSpokenSplitter(opts);
  let spoken = '';
  let text = '';
  for (const c of chunks) { const o = s.push(c); spoken += o.spoken; text += o.text; }
  const e = s.end();
  return { spoken: spoken + e.spoken, text: text + e.text };
};

test('splitSpoken: the marker first gives the spoken version and the clean text', () => {
  assert.deepEqual(splitSpoken('<spoken>Hi there.</spoken>\n\nFull **reply**.'), { spoken: 'Hi there.', text: 'Full **reply**.' });
});

test('splitSpoken: no marker leaves the text byte-identical', () => {
  for (const raw of ['', 'Hello', '\n\n  Hello\n', '  ', '<', '<b>bold</b>', 'Hi <spoken>x</spoken>']) {
    assert.deepEqual(splitSpoken(raw), { spoken: '', text: raw }, JSON.stringify(raw));
  }
});

test('splitSpoken: leading whitespace before the opener is accepted', () => {
  assert.deepEqual(splitSpoken('\n  <spoken>Yes.</spoken>  \nMore.'), { spoken: 'Yes.', text: 'More.' });
});

test('a near-opener becomes text', () => {
  assert.deepEqual(drive(['<spo', 'rt>', ' x']), { spoken: '', text: '<sport> x' });
  assert.deepEqual(drive(['<span>a</span>']), { spoken: '', text: '<span>a</span>' });
  assert.deepEqual(drive(['  <spo']), { spoken: '', text: '  <spo' }, 'end() in lead: the buffer becomes text');
});

test('unclosed past the cap: everything after the opener becomes text', () => {
  const body = 'a'.repeat(30);
  assert.deepEqual(splitSpoken(`<spoken>${body}`, { maxChars: 20 }), { spoken: '', text: body });
  assert.deepEqual(splitSpoken(`<spoken>${body}</spoken>tail`, { maxChars: 20 }), { spoken: '', text: `${body}</spoken>tail` });
  // streamed: what was already spoken stays spoken, the text side is complete
  const s = createSpokenSplitter({ maxChars: 20 });
  const a = s.push('<spoken>0123456789');
  assert.equal(a.spoken, '0123456789');
  const b = s.push('0123456789abc');
  assert.equal(b.text, '01234567890123456789abc');
  assert.equal(s.push('</spoken>x').text, '</spoken>x');
  assert.equal(SPOKEN_MAX_CHARS, 600);
});

test('unclosed under the cap at end() becomes spoken', () => {
  assert.deepEqual(splitSpoken('<spoken>Short answer.</spo'), { spoken: 'Short answer.</spo', text: '' });
  assert.deepEqual(drive(['<spoken>Short', ' answer.']), { spoken: 'Short answer.', text: '' });
});

test('end() is idempotent and a push after end() is text', () => {
  const s = createSpokenSplitter();
  assert.deepEqual(s.push('<spoken>Hi</spo'), { spoken: 'Hi', text: '' });
  assert.deepEqual(s.end(), { spoken: '</spo', text: '' });
  assert.deepEqual(s.end(), { spoken: '', text: '' });
  assert.deepEqual(s.push('<spoken>more'), { spoken: '', text: '<spoken>more' });
});

test('non-string chunks are treated as empty and never throw', () => {
  const s = createSpokenSplitter();
  for (const c of [undefined, null, 42, {}, []]) assert.deepEqual(s.push(c), { spoken: '', text: '' });
  assert.deepEqual(splitSpoken(undefined), { spoken: '', text: '' });
});

test('chunking equivalence: every split point and 1-char chunking agree with splitSpoken', () => {
  const fixtures = [
    '<spoken>Hi there.</spoken>\n\nFull **reply**.',
    '  \n<spoken>Two sentences. Short ones.</spoken>   \n\nThe full one.',
    '<spoken>a</spo</spoken>b',
    '<spoken><spoken></spoken>x',
    '<spoken></spoken>',
    '<spoken>never closed',
    'Plain reply with </spoken> inside',
    '<spoke',
    '\n\n',
    '<sPoken>x</spoken>',
  ];
  for (const f of fixtures) {
    const whole = splitSpoken(f);
    for (let i = 0; i <= f.length; i++) assert.deepEqual(drive([f.slice(0, i), f.slice(i)]), whole, `${JSON.stringify(f)} @${i}`);
    assert.deepEqual(drive([...f]), whole, `${JSON.stringify(f)} 1-char`);
  }
});

test('the held tail never exceeds the marker length', () => {
  // inside: at most SPOKEN_CLOSE.length - 1 chars wait, so speech streams as it comes
  const inside = createSpokenSplitter();
  inside.push(SPOKEN_OPEN);
  let raw = '';
  let out = '';
  for (const ch of 'Hello </spoke there </spoken') {
    raw += ch;
    out += inside.push(ch).spoken;
    assert.ok(raw.length - out.length <= SPOKEN_CLOSE.length - 1, `${JSON.stringify(raw)} held ${raw.length - out.length}`);
  }
  // lead: at most the opener's length (a proper prefix of it) waits
  const lead = createSpokenSplitter();
  let held = 0;
  for (const ch of SPOKEN_OPEN.slice(0, -1)) {
    const o = lead.push(ch);
    assert.equal(o.text + o.spoken, '');
    held += 1;
    assert.ok(held < SPOKEN_OPEN.length);
  }
  assert.deepEqual(lead.push('x'), { spoken: '', text: '<spokenx' });
});
