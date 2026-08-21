// Bounded, DOM-free syntax highlighting helpers for the History diff viewer.

export const MAX_HIGHLIGHT_INPUT_BYTES = 100_000;
export const MAX_HIGHLIGHT_INPUT_ROWS = 3_000;
export const MAX_HIGHLIGHT_OUTPUT_CHARS = 4_000_000;
export const MAX_HIGHLIGHT_OUTPUT_ROWS = 3_000;
export const MAX_HIGHLIGHT_OUTPUT_SPANS = 20_000;
export const MAX_HIGHLIGHT_NESTING = 64;

const BY_EXT = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', properties: 'properties',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  proto: 'protobuf', lua: 'lua', pl: 'perl', r: 'r', dart: 'dart',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', clj: 'clojure',
  diff: 'diff', patch: 'diff', nix: 'nix', gradle: 'gradle',
});

const BY_NAME = Object.freeze({
  dockerfile: 'dockerfile', makefile: 'makefile', gemfile: 'ruby',
  rakefile: 'ruby', vagrantfile: 'ruby', brewfile: 'ruby',
});

const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const SUPPORTED_LANGUAGE_IDS = Object.freeze(
  [...new Set([...Object.values(BY_EXT), ...Object.values(BY_NAME)])].sort(codeUnitCompare),
);
const SUPPORTED = new Set(SUPPORTED_LANGUAGE_IDS);

export function langForPath(pathname) {
  const base = String(pathname || '').split('/').pop() || '';
  const nameKey = base.toLowerCase();
  if (Object.hasOwn(BY_NAME, nameKey)) return BY_NAME[nameKey];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const extKey = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(BY_EXT, extKey) ? BY_EXT[extKey] : null;
}

const HLJS_CLASS_RE = /^(?:hljs-[A-Za-z0-9_-]+(?: [A-Za-z0-9-]+_+)*|language-[A-Za-z0-9_-]+)$/;
const OPEN_RE = /<span class="([^"]+)">/y;
const ENTITY_RE = /&(amp|lt|gt|quot|#x27);/y;
const TEXT_RE = /[^<&\n\u0000]+/y;
const ENTITIES = Object.freeze({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'",
});

function parseHighlightedRows(html) {
  if (typeof html !== 'string' || html.length > MAX_HIGHLIGHT_OUTPUT_CHARS) return null;
  const rows = [{ html: '', text: '' }];
  const stack = [];
  let i = 0;
  let renderedSpans = 0;
  let balancedChars = 0;

  const row = () => rows[rows.length - 1];
  const reopen = () => stack.map((cls) => `<span class="${cls}">`).join('');
  const appendHtml = (value) => {
    balancedChars += value.length;
    if (balancedChars > MAX_HIGHLIGHT_OUTPUT_CHARS) return false;
    row().html += value;
    return true;
  };

  while (i < html.length) {
    if (html.startsWith('</span>', i)) {
      if (!stack.length || !appendHtml('</span>')) return null;
      stack.pop();
      i += 7;
      continue;
    }
    if (html[i] === '<') {
      OPEN_RE.lastIndex = i;
      const match = OPEN_RE.exec(html);
      if (!match || !HLJS_CLASS_RE.test(match[1])) return null;
      renderedSpans += 1;
      if (renderedSpans > MAX_HIGHLIGHT_OUTPUT_SPANS
        || stack.length >= MAX_HIGHLIGHT_NESTING) return null;
      if (!appendHtml(match[0])) return null;
      stack.push(match[1]);
      i += match[0].length;
      continue;
    }
    if (html[i] === '\n') {
      if (!appendHtml('</span>'.repeat(stack.length))) return null;
      if (rows.length >= MAX_HIGHLIGHT_OUTPUT_ROWS) return null;
      const opened = reopen();
      renderedSpans += stack.length;
      if (renderedSpans > MAX_HIGHLIGHT_OUTPUT_SPANS) return null;
      balancedChars += opened.length;
      if (balancedChars > MAX_HIGHLIGHT_OUTPUT_CHARS) return null;
      rows.push({ html: opened, text: '' });
      i += 1;
      continue;
    }
    if (html[i] === '&') {
      ENTITY_RE.lastIndex = i;
      const match = ENTITY_RE.exec(html);
      if (!match || !appendHtml(match[0])) return null;
      row().text += ENTITIES[match[0]];
      i += match[0].length;
      continue;
    }
    TEXT_RE.lastIndex = i;
    const match = TEXT_RE.exec(html);
    if (!match) return null;
    const serialized = match[0].replaceAll('\r', '&#13;');
    if (!appendHtml(serialized)) return null;
    row().text += match[0];
    i += match[0].length;
  }

  if (stack.length) return null;
  return { rows, balancedChars, renderedSpans };
}

export function rowsFromHtml(html) {
  const parsed = parseHighlightedRows(html);
  return parsed ? parsed.rows.map((row) => row.html) : null;
}

const encoder = new TextEncoder();

function sideInputs(hunk) {
  const oldLines = [];
  const newLines = [];
  for (const line of hunk.lines || []) {
    if (line.kind !== 'add') oldLines.push(line);
    if (line.kind !== 'del') newLines.push(line);
  }
  return {
    old: { lines: oldLines, text: oldLines.map((line) => line.text).join('\n') },
    new: { lines: newLines, text: newLines.map((line) => line.text).join('\n') },
  };
}

function validSideRange(start, count) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 0) return false;
  if (count === 0) return start >= 0;
  return start >= 1 && start <= Number.MAX_SAFE_INTEGER - (count - 1);
}

function eligibleSides(hunk) {
  if (!validSideRange(hunk?.oldStart, hunk?.oldCount)
    || !validSideRange(hunk?.newStart, hunk?.newCount)) return null;
  const sides = sideInputs(hunk);
  if (sides.old.lines.length !== hunk.oldCount
    || sides.new.lines.length !== hunk.newCount) return null;
  return sides;
}

function withinInputBudget(eligible) {
  let rows = 0;
  let bytes = 0;
  for (const sides of eligible) {
    for (const side of [sides.old, sides.new]) {
      rows += side.lines.length;
      bytes += encoder.encode(side.text).byteLength;
      if (rows > MAX_HIGHLIGHT_INPUT_ROWS || bytes > MAX_HIGHLIGHT_INPUT_BYTES) return false;
    }
  }
  return rows > 0;
}

function eligibleInputs(parsed) {
  return (parsed?.hunks || []).map(eligibleSides).filter(Boolean);
}

export function canHighlightParsed(parsed) {
  return withinInputBudget(eligibleInputs(parsed));
}

const newOutputBudget = () => ({
  rawChars: 0, balancedChars: 0, rows: 0, spans: 0, exhausted: false,
});

function countOutputRows(html) {
  let rows = 1;
  for (let i = html.indexOf('\n'); i !== -1; i = html.indexOf('\n', i + 1)) rows += 1;
  return rows;
}

function highlightEligibleHunk(hunk, { old, new: next }, lang, highlight, budget) {
  const run = (side) => {
    if (!side.lines.length) return [];
    if (budget.exhausted) return null;
    if (budget.rawChars >= MAX_HIGHLIGHT_OUTPUT_CHARS
      || budget.balancedChars >= MAX_HIGHLIGHT_OUTPUT_CHARS
      || budget.rows >= MAX_HIGHLIGHT_OUTPUT_ROWS
      || budget.spans >= MAX_HIGHLIGHT_OUTPUT_SPANS) {
      budget.exhausted = true;
      return null;
    }
    const html = highlight(side.text, lang);
    if (typeof html !== 'string') return null;
    budget.rawChars += html.length;
    if (budget.rawChars > MAX_HIGHLIGHT_OUTPUT_CHARS) {
      budget.exhausted = true;
      return null;
    }
    const outputRows = countOutputRows(html);
    budget.rows += outputRows;
    if (budget.rows > MAX_HIGHLIGHT_OUTPUT_ROWS) {
      budget.exhausted = true;
      return null;
    }
    const parsed = parseHighlightedRows(html);
    if (!parsed || parsed.rows.length !== outputRows) return null;
    budget.balancedChars += parsed.balancedChars;
    budget.spans += parsed.renderedSpans;
    if (budget.balancedChars > MAX_HIGHLIGHT_OUTPUT_CHARS
      || budget.spans > MAX_HIGHLIGHT_OUTPUT_SPANS) {
      budget.exhausted = true;
      return null;
    }
    if (parsed.rows.length !== side.lines.length) return null;
    if (parsed.rows.some((row, index) => row.text !== side.lines[index].text)) return null;
    return parsed.rows;
  };

  try {
    const oldRows = run(old);
    if (oldRows === null) return false;
    const newRows = run(next);
    if (newRows === null) return false;
    const staged = [];
    old.lines.forEach((line, index) => {
      if (line.kind === 'del') staged.push([line, oldRows[index].html]);
    });
    next.lines.forEach((line, index) => staged.push([line, newRows[index].html]));
    for (const [line, html] of staged) line.html = html;
    return staged.length > 0;
  } catch {
    return false;
  }
}

export function highlightHunk(hunk, lang, highlight) {
  for (const line of hunk?.lines || []) delete line.html;
  const sides = eligibleSides(hunk);
  if (!sides || !SUPPORTED.has(lang) || typeof highlight !== 'function'
    || !withinInputBudget([sides])) return false;
  return highlightEligibleHunk(hunk, sides, lang, highlight, newOutputBudget());
}

export function highlightParsed(parsed, lang, highlight) {
  for (const hunk of parsed?.hunks || []) {
    for (const line of hunk.lines || []) delete line.html;
  }
  if (!SUPPORTED.has(lang) || typeof highlight !== 'function') return false;
  const eligible = (parsed?.hunks || [])
    .map((hunk) => ({ hunk, sides: eligibleSides(hunk) }))
    .filter((item) => item.sides);
  if (!withinInputBudget(eligible.map((item) => item.sides))) return false;
  const budget = newOutputBudget();
  let any = false;
  for (const { hunk, sides } of eligible) {
    any = highlightEligibleHunk(hunk, sides, lang, highlight, budget) || any;
  }
  return any;
}
