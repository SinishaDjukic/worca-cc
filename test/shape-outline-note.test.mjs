// test/shape-outline-note.test.mjs — the Planner's outline-change note as data: its title, the question clause, the
// body blocks (paragraphs, inline code, lists; everything else literal) and the folded view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_TITLE_MAX, NOTE_FOLD_LINES, NOTE_FOLD_ROWS, NOTE_LINE_CHARS, noteTitle, noteClause, noteBlocks, foldNote }
  from '../src/shared/shape/outline-note.mjs';

const words = (blocks) => blocks.map((b) => (b.kind === 'p' ? b.parts.map((x) => x.text).join('') : b.items.map((i) => i.parts.map((x) => x.text).join(''))));
const para = (lines) => ({ kind: 'p', parts: [{ text: 'x'.repeat(lines * NOTE_LINE_CHARS), code: false }] });
const list = (n) => ({ kind: 'list', ordered: false, items: Array.from({ length: n }, (_, i) => ({ n: null, parts: [{ text: `row ${i}`, code: false }], lone: null })) });

test('the limits', () => {
  assert.deepEqual([NOTE_TITLE_MAX, NOTE_FOLD_LINES, NOTE_FOLD_ROWS, NOTE_LINE_CHARS], [120, 6, 4, 90]);
});

test('the title drops # marks and a Slice/Run label; case is kept and no period is added', () => {
  assert.equal(noteTitle('## Slice 10: A prerequisite is not in this tree\n\nMore.'), 'A prerequisite is not in this tree');
  assert.equal(noteTitle('\n  \n# Run 3 · The API is gone\n'), 'The API is gone');
  for (const sep of [':', '·', '—', '–', '-']) assert.equal(noteTitle(`slice 2 ${sep} Missing table`), 'Missing table', sep);
  assert.equal(noteTitle('The `tags` table is missing.'), 'The tags table is missing.', 'backticks go, their text stays');
  assert.equal(noteTitle('Slice 2 needs the tags table'), 'Slice 2 needs the tags table', 'no separator: not a label');
  assert.equal(noteTitle('\uFEFF# A prerequisite is missing\r\nMore.'), 'A prerequisite is missing', 'BOM and CRLF');
});

test('noteClause lowercases an ordinary first word only, and ends the sentence', () => {
  assert.equal(noteClause('A prerequisite is not in this tree'), 'a prerequisite is not in this tree.');
  assert.equal(noteClause('Slice 2 needs the table.'), 'slice 2 needs the table.');
  assert.equal(noteClause('The split is stale!'), 'the split is stale!');
  assert.equal(noteClause('API routes are missing?'), 'API routes are missing?');
  assert.equal(noteClause('GitHub sync is gone'), 'GitHub sync is gone.');
  assert.equal(noteClause('Two things are missing:'), 'two things are missing.');
  assert.equal(noteClause('A'), 'a.');
});

test('a first line of 121 characters has no title; 120 has one', () => {
  assert.equal(noteTitle('a'.repeat(121)), null);
  assert.equal(noteTitle('a'.repeat(120)), 'a'.repeat(120));
  assert.equal(noteTitle(`## Slice 2: ${'a'.repeat(120)}`), 'a'.repeat(120), 'the length is of the cleaned line');
});

test('an empty, whitespace-only or non-string note has no title and no blocks', () => {
  for (const v of ['', '  \n\t\n', null, undefined, 7, {}]) {
    assert.equal(noteTitle(v), null);
    assert.deepEqual(noteBlocks(v), []);
    assert.deepEqual(noteBlocks(v, { dropTitle: true }), []);
  }
  assert.equal(noteTitle('##'), null, 'marks only');
});

test('a note whose first line is a list line has no title, and the whole note is the body', () => {
  for (const text of ['- the tags table\n- the route', '* the tags table\n* the route', '1. the tags table\n2. the route', '1) the tags table\n2) the route']) {
    assert.equal(noteTitle(text), null, text);
    assert.deepEqual(words(noteBlocks(text, { dropTitle: true })), [['the tags table', 'the route']], text);
  }
});

test('paragraphs split on blank lines; soft line breaks join with a space', () => {
  assert.deepEqual(words(noteBlocks('One\r\ntwo.\n\n\n  \nThree.\n')), ['One two.', 'Three.']);
});

test('inline code becomes parts; an unmatched backtick stays as text; code never spans lines', () => {
  assert.deepEqual(noteBlocks('Add `a.mjs` and `b c`.')[0].parts, [{ text: 'Add ', code: false }, { text: 'a.mjs', code: true },
    { text: ' and ', code: false }, { text: 'b c', code: true }, { text: '.', code: false }]);
  assert.deepEqual(noteBlocks('A ` stays')[0].parts, [{ text: 'A ` stays', code: false }]);
  assert.deepEqual(noteBlocks('open `here\nand` there')[0].parts, [{ text: 'open `here and` there', code: false }]);
});

test('-, * and numbered lists, with continuation lines', () => {
  const blocks = noteBlocks('Missing:\n- the table\n  and its index\n* `src/a.mjs`\n\nThen:\n1. first\n2) second');
  assert.deepEqual(blocks.map((b) => [b.kind, b.ordered]), [['p', undefined], ['list', false], ['p', undefined], ['list', true]]);
  assert.deepEqual(words(blocks), ['Missing:', ['the table and its index', 'src/a.mjs'], 'Then:', ['first', 'second']]);
  assert.deepEqual(blocks[1].items.map((i) => i.n), [null, null]);
  assert.deepEqual(blocks[3].items.map((i) => i.n), ['1.', '2)']);
  assert.deepEqual(noteBlocks('- a\n\n- b').map((b) => b.items.length), [2], 'a blank line between items keeps one list');
  assert.deepEqual(noteBlocks('- a\n1. b').map((b) => b.ordered), [false, true]);
  assert.deepEqual(words(noteBlocks('- a\nnot indented')), [['a'], 'not indented']);
});

test('a heading inside the body is its own paragraph without its marks', () => {
  assert.deepEqual(words(noteBlocks('One.\n### What to do\nTwo.')), ['One.', 'What to do', 'Two.']);
  assert.deepEqual(words(noteBlocks('#123 is open')), ['#123 is open'], 'no space: not a heading');
});

test('links, images, emphasis, fences and HTML stay literal', () => {
  const text = 'See [a](b) ![i](c) **bold** _it_ <b>x</b>\n```js\nconst a = 1;\n```';
  const blocks = noteBlocks(text);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].parts, [{ text: 'See [a](b) ![i](c) **bold** _it_ <b>x</b> ```js const a = 1; ```', code: false }]);
});

test('dropTitle drops the title line only when there is a title', () => {
  const text = '# Slice 2: Missing table\nIt was never added.';
  assert.deepEqual(words(noteBlocks(text, { dropTitle: true })), ['It was never added.']);
  assert.deepEqual(words(noteBlocks(text)), ['Slice 2: Missing table', 'It was never added.']);
  const long = `${'a'.repeat(121)}\n\nMore.`;
  assert.deepEqual(words(noteBlocks(long, { dropTitle: true })), ['a'.repeat(121), 'More.']);
  assert.deepEqual(noteBlocks('Only a title', { dropTitle: true }), []);
});

test('a lone name is one word without whitespace; a name with an explanation is not', () => {
  const [l] = noteBlocks('- `src/core/a.mjs`\n- 4c4683a6b65b58ec3e84dca200f5d6569b1fecc4\n- `a.mjs` — why\n- two\n  words');
  assert.deepEqual(l.items.map((i) => i.lone), ['src/core/a.mjs', '4c4683a6b65b58ec3e84dca200f5d6569b1fecc4', null, null]);
});

test('foldNote: six lines, the list reached shows 4 rows and "+N more", everything later is hidden', () => {
  assert.deepEqual(foldNote([para(3), para(3), list(6), para(1)]),
    { shown: [{ index: 0 }, { index: 1 }, { index: 2, rows: 4, more: 2 }], cut: true });
});

test('foldNote: a long paragraph is clamped to the lines left', () => {
  assert.deepEqual(foldNote([para(8)]), { shown: [{ index: 0, clamp: 6 }], cut: true });
  assert.deepEqual(foldNote([para(4), para(5), para(1)]), { shown: [{ index: 0 }, { index: 1, clamp: 2 }], cut: true });
});

test('foldNote: a note that fits has no cut', () => {
  assert.deepEqual(foldNote([para(2), list(4)]), { shown: [{ index: 0 }, { index: 1, rows: 4, more: 0 }], cut: false });
  assert.deepEqual(foldNote([para(6)]), { shown: [{ index: 0 }], cut: false });
  assert.deepEqual(foldNote([]), { shown: [], cut: false });
  assert.deepEqual(foldNote([{ kind: 'p', parts: [] }]), { shown: [{ index: 0 }], cut: false });
});

test('foldNote: a list after six lines still shows at most 4 rows; a paragraph past the budget is hidden', () => {
  assert.deepEqual(foldNote([para(6), list(9)]), { shown: [{ index: 0 }, { index: 1, rows: 4, more: 5 }], cut: true });
  assert.deepEqual(foldNote([para(6), para(1)]), { shown: [{ index: 0 }], cut: true });
  assert.deepEqual(foldNote([list(2), para(1)]), { shown: [{ index: 0, rows: 2, more: 0 }], cut: true });
});
