// Pinpoint (#669): the pure helpers in ui/public/pinpoint-model.mjs — quotes, the tray, the diff bodies, placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PINPOINT_ACTIONS, formatQuotedMessage, parseQuotedMessage, clipQuote, QUOTE_MAX, contextAround, disagreeText, useAltText,
  trayKey, readTray, addTrayItem, removeTrayItem, trayDirection, DIRECTION_MAX, diffCommentBody, quoteOfCommentBody,
  openFixComments, fixRunRequest, lineRect, placeBar, placePop, findQuote, normalizeAlternatives, shortText,
} from '../ui/public/pinpoint-model.mjs';

test('each surface has its action set, shortcuts unique per set', () => {
  assert.deepEqual(PINPOINT_ACTIONS.chat.map((a) => a[0]), ['copy', 'explain', 'alts', 'disagree', 'quote']);
  assert.deepEqual(PINPOINT_ACTIONS.artifact.filter((a) => a[0] !== '|').map((a) => a[0]), ['copy', 'explain', 'alts', 'disagree', 'note', 'send']);
  assert.deepEqual(PINPOINT_ACTIONS.diff.filter((a) => a[0] !== '|').map((a) => a[0]), ['copy', 'explain', 'alts', 'comment', 'send']);
  for (const set of Object.values(PINPOINT_ACTIONS)) {
    const keys = set.filter((a) => a[0] !== '|').map((a) => a[2]);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('a quoted message round-trips through formatQuotedMessage / parseQuotedMessage', () => {
  const msg = formatQuotedMessage({ text: 'line one\n\nline three', src: 'plan.md' }, 'Why this?');
  assert.equal(msg, '> From plan.md:\n> line one\n>\n> line three\n\nWhy this?');
  assert.deepEqual(parseQuotedMessage(msg), { quote: { text: 'line one\n\nline three', src: 'plan.md' }, rest: 'Why this?' });
  assert.deepEqual(parseQuotedMessage(formatQuotedMessage({ text: 'x y' }, 'ok')), { quote: { text: 'x y', src: '' }, rest: 'ok' });
  assert.equal(formatQuotedMessage(null, ' hi '), 'hi');
  assert.equal(formatQuotedMessage({ text: '  ' }, 'hi'), 'hi');
});

test('parseQuotedMessage leaves a message that does not open with a blockquote alone', () => {
  for (const t of ['plain', 'a\n> b', '>not a quote', '> q\nno blank line', '']) {
    assert.deepEqual(parseQuotedMessage(t), { quote: null, rest: t });
  }
  assert.deepEqual(parseQuotedMessage('> only a quote'), { quote: { text: 'only a quote', src: '' }, rest: '' });
});

test('clipQuote trims blank edges and caps the length', () => {
  assert.equal(clipQuote('\n\n  a  \nb\t\n\n'), '  a\nb');
  const long = clipQuote('x'.repeat(QUOTE_MAX + 50));
  assert.equal(long.length, QUOTE_MAX);
  assert.ok(long.endsWith('…'));
});

test('contextAround keeps short text whole and centres a window on the quote', () => {
  assert.equal(contextAround('short text', 0, 5, 100), 'short text');
  const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
  const at = words.indexOf('w200');
  const out = contextAround(words, at, at + 4, 200);
  assert.ok(out.includes('w200'));
  assert.ok(out.startsWith('…') && out.endsWith('…'));
  assert.ok(out.length <= 204);
});

test('disagree and use-this texts', () => {
  assert.equal(disagreeText('Too risky', 'keep it'), 'I disagree (too risky): keep it');
  assert.equal(disagreeText('Out of scope', ''), 'I disagree: out of scope.');
  assert.equal(disagreeText(null, 'x'), 'I disagree: x');
  assert.equal(disagreeText(null, ' '), '');
  assert.equal(useAltText({ title: 'Fail closed', detail: 'Answer 503.' }), 'Use this instead: Fail closed — Answer 503.');
  assert.equal(useAltText({ title: 'Drop it' }), 'Use this instead: Drop it');
});

test('the tray: stored shape, numbering never reused, removal', () => {
  assert.equal(trayKey('p1', 'plan.md'), 'worca.pinpoint.p1::plan.md');
  assert.deepEqual(readTray('not json'), { items: [], seq: 0 });
  assert.deepEqual(readTray(JSON.stringify({ items: [{ n: 1, kind: 'bogus', quote: 'q' }, { n: 2, kind: 'note', quote: '' }] })), { items: [], seq: 0 });
  let t = readTray(null);
  t = addTrayItem(t, { kind: 'disagree', quote: 'a', at: 3, text: ' x ' });
  t = addTrayItem(t, { kind: 'note', quote: 'b' });
  assert.deepEqual(t.items.map((p) => p.n), [1, 2]);
  assert.deepEqual(t.items[0], { n: 1, kind: 'disagree', quote: 'a', at: 3, text: 'x' });
  t = removeTrayItem(t, 2);
  t = addTrayItem(t, { kind: 'alt', quote: 'c', text: 'Use this instead: y' });
  assert.deepEqual(t.items.map((p) => p.n), [1, 3]);
  assert.deepEqual(readTray(JSON.stringify(t)), t);
});

test('trayDirection lists every change and stays under the direction cap', () => {
  assert.equal(trayDirection([], 'plan.md'), '');
  const d = trayDirection([{ n: 1, kind: 'disagree', quote: 'up to 5 times', text: 'Too risky — retry until it lands' }, { n: 2, kind: 'note', quote: 'a red badge', text: '' }], 'plan.md');
  assert.equal(d, 'Feedback on plan.md — please revise and address each point:\n1. Disagree on “up to 5 times”: Too risky — retry until it lands\n2. Note on “a red badge”');
  const many = Array.from({ length: 80 }, (_, i) => ({ n: i + 1, kind: 'note', quote: 'q'.repeat(500), text: 't'.repeat(300) }));
  const big = trayDirection(many, 'plan.md');
  assert.ok(big.length <= DIRECTION_MAX, String(big.length));
  assert.match(big, /more not included\)$/);
});

test('a diff comment body quotes the code and gives it back', () => {
  const body = diffCommentBody("const x = '60';\n  y", 'Pass null.');
  assert.equal(body, "> `const x = '60';`\n> `  y`\n\nPass null.");
  assert.equal(quoteOfCommentBody(body), "const x = '60';\n  y");
  assert.equal(quoteOfCommentBody(diffCommentBody('a `b` c', '')), 'a `b` c');
  assert.equal(quoteOfCommentBody('plain comment'), '');
});

test('fix runs take open, unsent root comments, by id', () => {
  const list = [
    { id: 'dc_1', path: 'src/a.js', line: 3, side: 'new', body: 'one' },
    { id: 'dc_2', path: 'src/a.js', line: 4, side: 'new', body: 'two', resolved: true },
    { id: 'dc_3', path: 'src/a.js', line: 5, side: 'new', body: 'three', sentRunId: 'r9' },
    { id: 'dc_4', parentId: 'dc_1', path: 'src/a.js', line: 3, side: 'new', body: 'reply' },
  ];
  const open = openFixComments(list);
  assert.deepEqual(open.map((c) => c.id), ['dc_1']);
  assert.equal(fixRunRequest(open, 'p1'), 'Propose a fix run for run p1 that addresses these diff comments (pass their ids as commentIds):\n- [diff comment dc_1 — src/a.js:3 (new)] one');
});

test('lineRect picks the line the selection ended on (or began on, backward)', () => {
  const rects = [{ left: 10, right: 100, width: 90, top: 0, bottom: 20, height: 20 }, { left: 10, right: 60, width: 50, top: 24, bottom: 44, height: 20 }, { left: 60, right: 80, width: 20, top: 25, bottom: 43, height: 18 }];
  assert.deepEqual(lineRect(rects), { left: 10, right: 80, width: 70, top: 24, bottom: 44 });
  assert.equal(lineRect(rects, true).top, 0);
  assert.equal(lineRect([{ left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0 }]), null);
});

test('placement: the toolbar flips below without room above; the popover flips above without room below', () => {
  const view = { left: 0, right: 800, top: 0, bottom: 600 };
  const high = placeBar({ left: 100, right: 200, width: 100, top: 20, bottom: 40 }, { w: 300, h: 38 }, view);
  assert.equal(high.below, true);
  assert.equal(high.top, 50);
  const low = placeBar({ left: 700, right: 790, width: 90, top: 300, bottom: 320 }, { w: 300, h: 38 }, view);
  assert.equal(low.below, false);
  assert.equal(low.left, 492, 'kept 8px inside');
  assert.equal(low.arrow, 253);
  assert.equal(placePop({ left: 100, right: 200, width: 100, top: 100, bottom: 120 }, { w: 360, h: 200 }, view).above, false);
  assert.equal(placePop({ left: 100, right: 200, width: 100, top: 500, bottom: 520 }, { w: 360, h: 200 }, view).above, true);
});

test('findQuote finds the nearest occurrence, and tolerates reflowed whitespace', () => {
  const t = 'a b a b a';
  assert.deepEqual(findQuote(t, 'a', 7), { index: 8, length: 1 });
  assert.deepEqual(findQuote('one  two\nthree', 'two three'), { index: 5, length: 9 });
  assert.deepEqual(findQuote('abc', 'zzz'), { index: -1, length: 0 });
});

test('normalizeAlternatives cleans, caps and drops untitled cards', () => {
  const out = normalizeAlternatives([{ title: ' A ', detail: 'd', tradeoffs: [{ tone: 'ok', text: 'x' }, { tone: 'nope', text: 'y' }, { text: '' }] }, { detail: 'no title' }, { title: 'B' }, { title: 'C' }, { title: 'D' }]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { title: 'A', detail: 'd', tradeoffs: [{ tone: 'ok', text: 'x' }, { tone: 'warn', text: 'y' }] });
  assert.deepEqual(normalizeAlternatives(null), []);
  assert.equal(shortText('a   b', 10), 'a b');
});
