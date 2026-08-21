import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  langForPath, SUPPORTED_LANGUAGE_IDS, rowsFromHtml, canHighlightParsed,
  highlightHunk, highlightParsed, MAX_HIGHLIGHT_INPUT_BYTES,
  MAX_HIGHLIGHT_INPUT_ROWS, MAX_HIGHLIGHT_OUTPUT_CHARS,
  MAX_HIGHLIGHT_OUTPUT_ROWS, MAX_HIGHLIGHT_OUTPUT_SPANS, MAX_HIGHLIGHT_NESTING,
} from '../ui/public/syntax-highlight.mjs';

const escape = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

const hunk = (lines, over = {}) => ({
  oldStart: 1,
  oldCount: lines.filter((line) => line.kind !== 'add').length,
  newStart: 1,
  newCount: lines.filter((line) => line.kind !== 'del').length,
  lines,
  ...over,
});

const additionHunk = (texts) => hunk(texts.map((text) => ({ kind: 'add', text })), {
  oldStart: 0,
  oldCount: 0,
  newStart: 1,
  newCount: texts.length,
});

function rawMarkup(chars) {
  const prefix = '<span class="hljs-';
  const suffix = '"></span>';
  const html = `${prefix}${'x'.repeat(chars - prefix.length - suffix.length)}${suffix}`;
  assert.equal(html.length, chars);
  return html;
}

function balancedMarkup(chars) {
  const openPrefix = '<span class="';
  const openSuffix = '">';
  const close = '</span>';
  const openLength = Math.floor((chars - close.length * 3) / 3);
  const text = 'x'.repeat(chars - (openLength + close.length) * 3);
  const className = `hljs-${'x'.repeat(openLength - openPrefix.length - openSuffix.length - 5)}`;
  const open = `${openPrefix}${className}${openSuffix}`;
  assert.equal(open.length, openLength);
  return { html: `${open}${text}\n\n${close}`, texts: [text, '', ''] };
}

const spanMarkup = (count) => '<span class="hljs-x"></span>'.repeat(count);
const outputRows = (count, text = '') => Array.from({ length: count }, () => text).join('\n');

const hasHtml = (hunkValue) => hunkValue.lines.every((line) => Object.hasOwn(line, 'html'));
const lacksHtml = (hunkValue) => hunkValue.lines.every((line) => !Object.hasOwn(line, 'html'));

test('reviewed path map is exact, case-insensitive, and fail-closed', () => {
  const cases = {
    'x.js': 'javascript', 'x.mjs': 'javascript', 'x.cjs': 'javascript', 'x.jsx': 'javascript',
    'x.ts': 'typescript', 'x.mts': 'typescript', 'x.cts': 'typescript', 'x.tsx': 'typescript',
    'x.json': 'json', 'x.jsonc': 'json', 'x.json5': 'json',
    'x.css': 'css', 'x.scss': 'scss', 'x.sass': 'scss', 'x.less': 'less',
    'x.html': 'xml', 'x.htm': 'xml', 'x.xml': 'xml', 'x.svg': 'xml', 'x.vue': 'xml',
    'x.md': 'markdown', 'x.markdown': 'markdown', 'x.yml': 'yaml', 'x.yaml': 'yaml',
    'x.toml': 'ini', 'x.ini': 'ini', 'x.properties': 'properties',
    'x.sh': 'bash', 'x.bash': 'bash', 'x.zsh': 'bash', 'x.fish': 'bash',
    'x.py': 'python', 'x.rb': 'ruby', 'x.php': 'php', 'x.go': 'go', 'x.rs': 'rust',
    'x.java': 'java', 'x.kt': 'kotlin', 'x.kts': 'kotlin', 'x.swift': 'swift', 'x.scala': 'scala',
    'x.c': 'c', 'x.h': 'c', 'x.cpp': 'cpp', 'x.cc': 'cpp', 'x.cxx': 'cpp', 'x.hpp': 'cpp',
    'x.cs': 'csharp', 'x.sql': 'sql', 'x.graphql': 'graphql', 'x.gql': 'graphql',
    'x.proto': 'protobuf', 'x.lua': 'lua', 'x.pl': 'perl', 'x.r': 'r', 'x.dart': 'dart',
    'x.ex': 'elixir', 'x.exs': 'elixir', 'x.erl': 'erlang', 'x.hs': 'haskell', 'x.clj': 'clojure',
    'x.diff': 'diff', 'x.patch': 'diff', 'x.nix': 'nix', 'x.gradle': 'gradle',
    Dockerfile: 'dockerfile', Makefile: 'makefile', Gemfile: 'ruby', Rakefile: 'ruby',
    Vagrantfile: 'ruby', Brewfile: 'ruby',
  };
  for (const [path, lang] of Object.entries(cases)) {
    assert.equal(langForPath(`dir/${path}`), lang, path);
    assert.equal(langForPath(`dir/${path.toUpperCase()}`), lang, `${path} uppercase`);
  }
  for (const path of ['', '.gitignore', 'README', 'x.tf', 'x.hcl', 'x.png',
    'constructor', 'x.constructor', '__proto__', 'x.__proto__', 'toString', 'x.toString']) {
    assert.equal(langForPath(path), null, path);
  }
  assert.ok(Object.isFrozen(SUPPORTED_LANGUAGE_IDS));
  assert.deepEqual(SUPPORTED_LANGUAGE_IDS, [...new Set(SUPPORTED_LANGUAGE_IDS)].sort());
  assert.deepEqual(SUPPORTED_LANGUAGE_IDS, [...new Set(Object.values(cases))].sort());
});

test('every mapped pinned grammar registers and emits strict round-trippable rows', async () => {
  const coreModule = await import('@highlightjs/cdn-assets/es/core.min.js');
  for (const lang of SUPPORTED_LANGUAGE_IDS) {
    const instance = coreModule.default.newInstance();
    const grammar = await import(`@highlightjs/cdn-assets/es/languages/${lang}.min.js`);
    assert.equal(typeof grammar.default, 'function', lang);
    instance.registerLanguage(lang, grammar.default);
    assert.ok(instance.getLanguage(lang), lang);
    const value = instance.highlight('value', { language: lang, ignoreIllegals: true }).value;
    const rows = rowsFromHtml(value);
    assert.ok(rows, lang);
    const dom = new JSDOM('<!doctype html><body></body>');
    const holder = dom.window.document.createElement('span');
    holder.innerHTML = rows[0];
    assert.equal(holder.textContent, 'value', lang);
  }
});

test('strict parser balances multiline spans and accepts only reviewed markup', () => {
  assert.deepEqual(rowsFromHtml('<span class="hljs-comment">a\nb</span>'), [
    '<span class="hljs-comment">a</span>',
    '<span class="hljs-comment">b</span>',
  ]);
  assert.deepEqual(rowsFromHtml('<span class="language-javascript">x</span>'), [
    '<span class="language-javascript">x</span>',
  ]);
  assert.deepEqual(rowsFromHtml('<span class="hljs-title function_">x</span>'), [
    '<span class="hljs-title function_">x</span>',
  ]);
  for (const bad of [
    '<img src=x>', '<span onclick="x">x</span>', '<span class="hidden">x</span>',
    '<span class="hljs-keyword hidden">x</span>', '</span>', '<span class="hljs-keyword">x',
    '&nbsp;', '&wat;', '<', '\u0000', '<script>x</script>',
  ]) assert.equal(rowsFromHtml(bad), null, bad);
  assert.equal(rowsFromHtml(`${'<span class="hljs-keyword">'.repeat(MAX_HIGHLIGHT_NESTING + 1)}x${'</span>'.repeat(MAX_HIGHLIGHT_NESTING + 1)}`), null);
});

test('strict parser enforces exact raw, row, span, and nesting output limits', () => {
  assert.equal(rowsFromHtml('x'.repeat(MAX_HIGHLIGHT_OUTPUT_CHARS)).length, 1);
  assert.equal(rowsFromHtml('x'.repeat(MAX_HIGHLIGHT_OUTPUT_CHARS + 1)), null);
  const exactRows = Array.from({ length: MAX_HIGHLIGHT_OUTPUT_ROWS }, () => 'x').join('\n');
  assert.equal(rowsFromHtml(exactRows).length, MAX_HIGHLIGHT_OUTPUT_ROWS);
  assert.equal(rowsFromHtml(`${exactRows}\nx`), null);
  const span = '<span class="hljs-x"></span>';
  assert.ok(rowsFromHtml(span.repeat(MAX_HIGHLIGHT_OUTPUT_SPANS)));
  assert.equal(rowsFromHtml(span.repeat(MAX_HIGHLIGHT_OUTPUT_SPANS + 1)), null);
  const exactNesting = `${'<span class="hljs-x">'.repeat(MAX_HIGHLIGHT_NESTING)}x${'</span>'.repeat(MAX_HIGHLIGHT_NESTING)}`;
  assert.ok(rowsFromHtml(exactNesting));
});

test('real XML embedded-language wrappers are accepted and round-trip source', async () => {
  const core = await import('@highlightjs/cdn-assets/es/core.min.js');
  const xml = await import('@highlightjs/cdn-assets/es/languages/xml.min.js');
  const javascript = await import('@highlightjs/cdn-assets/es/languages/javascript.min.js');
  const instance = core.default.newInstance();
  instance.registerLanguage('javascript', javascript.default);
  instance.registerLanguage('xml', xml.default);
  const source = '<script>const x = 1;</script>';
  const html = instance.highlight(source, { language: 'xml', ignoreIllegals: true }).value;
  assert.match(html, /class="language-javascript"/);
  const rows = rowsFromHtml(html);
  assert.ok(rows);
  const dom = new JSDOM('<!doctype html><body></body>');
  const holder = dom.window.document.createElement('span');
  holder.innerHTML = rows[0];
  assert.equal(holder.textContent, source);
  assert.ok([...holder.querySelectorAll('*')].every((element) => (
    element.tagName === 'SPAN'
      && [...element.attributes].every((attribute) => attribute.name === 'class')
  )));
});

test('input preflight uses UTF-8 bytes and exact per-side row work', () => {
  const exactBytes = { hunks: [hunk([{ kind: 'add', text: 'x'.repeat(MAX_HIGHLIGHT_INPUT_BYTES) }], {
    oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
  })] };
  assert.equal(canHighlightParsed(exactBytes), true);
  exactBytes.hunks[0].lines[0].text += 'é';
  assert.equal(canHighlightParsed(exactBytes), false);

  const exactRows = { hunks: [hunk(Array.from({ length: MAX_HIGHLIGHT_INPUT_ROWS }, () => ({
    kind: 'add', text: '',
  })), { oldStart: 0, oldCount: 0, newStart: 1, newCount: MAX_HIGHLIGHT_INPUT_ROWS })] };
  assert.equal(canHighlightParsed(exactRows), true);
  exactRows.hunks[0].lines.push({ kind: 'add', text: '' });
  exactRows.hunks[0].newCount += 1;
  assert.equal(canHighlightParsed(exactRows), false);

  const context = { hunks: [hunk(Array.from({ length: 1_501 }, () => ({ kind: 'ctx', text: '' })))] };
  assert.equal(canHighlightParsed(context), false, 'context rows count once on each side');
});

test('highlightParsed aggregates raw-character work across hunks at exact and one-over limits', () => {
  const half = MAX_HIGHLIGHT_OUTPUT_CHARS / 2;
  const changed = () => hunk([{ kind: 'del', text: '' }, { kind: 'add', text: '' }]);

  const exact = { hunks: [changed()] };
  let calls = 0;
  assert.equal(highlightParsed(exact, 'javascript', () => {
    calls += 1;
    return rawMarkup(half);
  }), true);
  assert.equal(calls, 2);
  assert.ok(exact.hunks.every(hasHtml), 'an exact cap is accepted when the second side is final');

  const followed = { hunks: [changed(), additionHunk([''])] };
  calls = 0;
  assert.equal(highlightParsed(followed, 'javascript', () => {
    calls += 1;
    return rawMarkup(half);
  }), true);
  assert.equal(calls, 2, 'no later hunk call is made after both sides reach the exact cap');
  assert.ok(hasHtml(followed.hunks[0]));
  assert.ok(lacksHtml(followed.hunks[1]));

  const over = { hunks: [additionHunk(['']), additionHunk(['']), additionHunk([''])] };
  calls = 0;
  assert.equal(highlightParsed(over, 'javascript', () => {
    const size = calls++ === 0 ? half : half + 1;
    return rawMarkup(size);
  }), true, 'the already accepted first hunk remains highlighted');
  assert.equal(calls, 2, 'one-over exhausts the budget and suppresses later work');
  assert.ok(hasHtml(over.hunks[0]));
  assert.ok(lacksHtml(over.hunks[1]));
  assert.ok(lacksHtml(over.hunks[2]));
});

test('highlightParsed aggregates rebalanced characters including close/reopen amplification', () => {
  const half = MAX_HIGHLIGHT_OUTPUT_CHARS / 2;
  const first = balancedMarkup(half);
  const second = balancedMarkup(half);
  assert.ok(first.html.length + second.html.length < MAX_HIGHLIGHT_OUTPUT_CHARS,
    'raw output remains below the cap so rebalancing is the limiting dimension');

  const exact = { hunks: [additionHunk(first.texts), additionHunk(second.texts)] };
  let calls = 0;
  assert.equal(highlightParsed(exact, 'javascript', () => [first.html, second.html][calls++]), true);
  assert.equal(calls, 2);
  assert.ok(exact.hunks.every(hasHtml), 'exact rebalanced output is accepted on the final side');

  const followed = {
    hunks: [additionHunk(first.texts), additionHunk(second.texts), additionHunk([''])],
  };
  calls = 0;
  assert.equal(highlightParsed(followed, 'javascript', () => [first.html, second.html][calls++]), true);
  assert.equal(calls, 2, 'the exact rebalanced cap suppresses the next hunk');
  assert.ok(followed.hunks.slice(0, 2).every(hasHtml));
  assert.ok(lacksHtml(followed.hunks[2]));

  const overSecond = balancedMarkup(half + 1);
  const over = {
    hunks: [additionHunk(first.texts), additionHunk(overSecond.texts), additionHunk([''])],
  };
  calls = 0;
  assert.equal(highlightParsed(over, 'javascript', () => [first.html, overSecond.html][calls++]), true);
  assert.equal(calls, 2, 'aggregate rebalanced one-over suppresses the third call');
  assert.ok(hasHtml(over.hunks[0]));
  assert.ok(lacksHtml(over.hunks[1]));
  assert.ok(lacksHtml(over.hunks[2]));
});

test('highlightParsed aggregates output rows and suppresses work after malformed one-over output', () => {
  const half = MAX_HIGHLIGHT_OUTPUT_ROWS / 2;
  const exact = {
    hunks: [
      additionHunk(Array.from({ length: half }, () => '')),
      additionHunk(Array.from({ length: half }, () => '')),
    ],
  };
  let calls = 0;
  assert.equal(highlightParsed(exact, 'javascript', (text) => {
    calls += 1;
    return text;
  }), true);
  assert.equal(calls, 2);
  assert.ok(exact.hunks.every(hasHtml), 'the exact aggregate row cap is accepted when final');

  const malformed = { hunks: [additionHunk(['a']), additionHunk(['b']), additionHunk(['c'])] };
  calls = 0;
  assert.equal(highlightParsed(malformed, 'javascript', () => {
    calls += 1;
    return calls === 1
      ? outputRows(half, 'wrong')
      : `${outputRows(half, 'wrong')}<img>`;
  }), false);
  assert.equal(calls, 2, 'mismatched and malformed rows consume the exact cap before rejection');
  assert.ok(malformed.hunks.every(lacksHtml));

  const over = { hunks: [additionHunk(['a']), additionHunk(['b']), additionHunk(['c'])] };
  calls = 0;
  assert.equal(highlightParsed(over, 'javascript', () => {
    calls += 1;
    return outputRows(calls === 1 ? half : half + 1, 'wrong');
  }), false);
  assert.equal(calls, 2, 'aggregate output-row one-over suppresses the third call');
  assert.ok(over.hunks.every(lacksHtml));
});

test('highlightParsed aggregates rendered spans across hunks at exact and one-over limits', () => {
  const half = MAX_HIGHLIGHT_OUTPUT_SPANS / 2;

  const exact = { hunks: [additionHunk(['']), additionHunk([''])] };
  let calls = 0;
  assert.equal(highlightParsed(exact, 'javascript', () => {
    calls += 1;
    return spanMarkup(half);
  }), true);
  assert.equal(calls, 2);
  assert.ok(exact.hunks.every(hasHtml), 'the exact aggregate span cap is accepted when final');

  const followed = { hunks: [additionHunk(['']), additionHunk(['']), additionHunk([''])] };
  calls = 0;
  assert.equal(highlightParsed(followed, 'javascript', () => {
    calls += 1;
    return spanMarkup(half);
  }), true);
  assert.equal(calls, 2, 'the exact aggregate span cap suppresses later work');
  assert.ok(followed.hunks.slice(0, 2).every(hasHtml));
  assert.ok(lacksHtml(followed.hunks[2]));

  const over = { hunks: [additionHunk(['']), additionHunk(['']), additionHunk([''])] };
  calls = 0;
  assert.equal(highlightParsed(over, 'javascript', () => {
    calls += 1;
    return spanMarkup(calls === 1 ? half : half + 1);
  }), true);
  assert.equal(calls, 2, 'aggregate span one-over suppresses the third call');
  assert.ok(hasHtml(over.hunks[0]));
  assert.ok(lacksHtml(over.hunks[1]));
  assert.ok(lacksHtml(over.hunks[2]));
});

test('rejected malformed and text-mismatching output still consumes aggregate work', () => {
  const mismatch = { hunks: [additionHunk(['expected']), additionHunk(['later'])] };
  let calls = 0;
  assert.equal(highlightParsed(mismatch, 'javascript', () => {
    calls += 1;
    return rawMarkup(MAX_HIGHLIGHT_OUTPUT_CHARS);
  }), false);
  assert.equal(calls, 1, 'text mismatch at the exact raw cap suppresses the later call');
  assert.ok(mismatch.hunks.every(lacksHtml));

  const malformed = { hunks: [additionHunk(['expected']), additionHunk(['later'])] };
  calls = 0;
  assert.equal(highlightParsed(malformed, 'javascript', () => {
    calls += 1;
    return `${outputRows(MAX_HIGHLIGHT_OUTPUT_ROWS, '')}<img>`;
  }), false);
  assert.equal(calls, 1, 'malformed markup at the exact row cap suppresses the later call');
  assert.ok(malformed.hunks.every(lacksHtml));
});

test('highlighting is source-faithful, side-aware, and hunk-atomic', () => {
  const lines = [
    { kind: 'ctx', text: 'same' },
    { kind: 'del', text: '<old>&"\'' },
    { kind: 'add', text: 'new' },
  ];
  const item = hunk(lines);
  let call = 0;
  assert.equal(highlightHunk(item, 'javascript', (text) => {
    call += 1;
    return `<span class="${call === 1 ? 'hljs-keyword' : 'hljs-string'}">${escape(text)}</span>`;
  }), true);
  assert.match(lines[0].html, /hljs-string/, 'context takes new-side markup');
  assert.match(lines[1].html, /hljs-keyword/, 'deletion takes old-side markup');
  assert.match(lines[2].html, /hljs-string/, 'addition takes new-side markup');

  for (const line of lines) line.html = 'stale';
  assert.equal(highlightHunk(item, 'javascript', () => '<span class="hljs-keyword">wrong</span>'), false);
  assert.ok(lines.every((line) => !Object.hasOwn(line, 'html')));
});

test('empty rows retain own html properties and CR is serialized safely', () => {
  const empty = hunk([{ kind: 'add', text: '' }], {
    oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
  });
  assert.equal(highlightHunk(empty, 'javascript', () => ''), true);
  assert.equal(Object.hasOwn(empty.lines[0], 'html'), true);
  assert.equal(empty.lines[0].html, '');

  const cr = hunk([{ kind: 'add', text: 'x\r' }], {
    oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
  });
  assert.equal(highlightHunk(cr, 'javascript', () => 'x\r'), true);
  assert.equal(cr.lines[0].html, 'x&#13;');
  const dom = new JSDOM('<!doctype html><body></body>');
  const holder = dom.window.document.createElement('span');
  holder.innerHTML = cr.lines[0].html;
  assert.equal(holder.textContent, 'x\r');
});

test('malformed hunks stay plain while independent eligible hunks can succeed', () => {
  const good = hunk([{ kind: 'add', text: 'ok' }], {
    oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
  });
  const bad = hunk([{ kind: 'add', text: 'bad', html: 'stale' }], { newCount: 2 });
  const parsed = { hunks: [good, bad] };
  assert.equal(highlightParsed(parsed, 'javascript', (text) => escape(text)), true);
  assert.equal(good.lines[0].html, 'ok');
  assert.equal(Object.hasOwn(bad.lines[0], 'html'), false);
  assert.equal(canHighlightParsed({ hunks: [bad] }), false);
});

test('unsupported languages, thrown highlighters, and over-limit direct calls fail closed', () => {
  const item = hunk([{ kind: 'add', text: 'x' }], {
    oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
  });
  assert.equal(highlightHunk(item, 'brainfuck', escape), false);
  assert.equal(highlightHunk(item, 'javascript', () => { throw new Error('boom'); }), false);
  item.lines[0].text = 'é'.repeat(MAX_HIGHLIGHT_INPUT_BYTES);
  assert.equal(highlightHunk(item, 'javascript', escape), false);
});
