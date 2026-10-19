// test/ui-design-language.test.mjs — runs-redesign spec §1 and §5.1: radius tokens, the one button component, no
// removed button skins, hooks without skins, no uppercase tracked labels, no glyph icons, no resting shadows,
// gradients or accent borders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Comments blanked but newlines kept, so a rule's line number is its real line.
const css = readFileSync(join(ROOT, 'ui/public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Every style rule as { sel, body, line }; @media/@container wrappers are walked through, @keyframes skipped. */
function rules(text) {
  const out = []; const stack = []; let start = 0; let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') line += 1;
    else if (ch === '{') { stack.push({ head: text.slice(start, i).trim(), at: i + 1, line }); start = i + 1; }
    else if (ch === '}') {
      const open = stack.pop();
      const inKeyframes = stack.some((s) => /^@(-webkit-)?keyframes/.test(s.head));
      if (open && !open.head.startsWith('@') && !inKeyframes) out.push({ sel: open.head.replace(/\s+/g, ' '), body: text.slice(open.at, i), line: open.line });
      start = i + 1;
    } else if (ch === ';' && (!stack.length || stack.at(-1).head.startsWith('@'))) start = i + 1;
  }
  return out;
}
/** Split on top-level commas only: commas inside color-mix(…), var(…) or :is(…) stay. */
function splitTop(v) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of v) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const ALL = rules(css);
const decls = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*(${prop})\\s*:\\s*([^;]+)`, 'g'))].map((m) => [m[1], m[2].replace(/!important/, '').trim()]);
const where = (r, v) => `style.css:${r.line} ${r.sel.slice(0, 80)} → ${v}`;

const TOKEN = /^(?:var\(--r-(?:xs|sm|card|ctrl)\)|0|inherit)$/;
// D2: the five round kinds. Extend only with a selector of one of these kinds.
// Dots: nav-rollup, tl-mark.is-open, tl-pr-start, hd-base-pill::before, rg-td, ask-rp-kicker::before, npip/nwarn.
// Knobs: .wz .tog::after. Spinners: the busy::after rings.
const ROUND = /dot|\bava\b|-ava\b|avatar|person-ini|knob|switch::after|tog::after|spin|busy::after|\bled\b|radio|status-word::before|nav-rollup|tl-mark\.is-open|tl-pr-start|hd-base-pill::before|rg-td|kicker::before|npip|nwarn/;

test('radius tokens: --r-xs 2px, --r-sm 4px, --r-card and --r-ctrl map to --r-sm', () => {
  const root = ALL.find((r) => r.sel === ':root').body;   // the first :root (line 14) is the token block
  assert.match(root, /--r-xs:2px;/);
  assert.match(root, /--r-sm:4px;/);
  assert.match(root, /--r-card:var\(--r-sm\);/);
  assert.match(root, /--r-ctrl:var\(--r-sm\);/);
});

test('every border-radius in style.css is a token, 0, inherit, or 50% on a dot/avatar/knob/spinner/radio', () => {
  const bad = [];
  for (const r of ALL) {
    for (const [, v] of decls(r.body, 'border(?:-(?:top|bottom)-(?:left|right))?-radius')) {
      const parts = v.split(/\s+/);
      const round = parts.length === 1 && parts[0] === '50%' && splitTop(r.sel).every((s) => ROUND.test(s));
      if (!round && !parts.every((p) => TOKEN.test(p))) bad.push(where(r, v));
    }
  }
  assert.deepEqual(bad, []);
});

test('the one button: 32px default, 28px small, 40px large, 40px minimum under a coarse pointer', () => {
  const body = (sel) => (ALL.find((r) => r.sel === sel) || {}).body || '';
  assert.match(body('.btn'), /height:32px;/);
  assert.match(body('.btn'), /border-radius:var\(--r-sm\);/);
  assert.match(body('.btn-sm'), /height:28px;/);
  assert.match(body('.btn-lg'), /height:40px;/);
  assert.match(css, /@media \(pointer:coarse\)\{\.btn\{min-height:40px;\}\.btn-icon\{min-width:40px;\}\}/);
  assert.match(body('.confirm-modal .btn-danger:hover:not(:disabled)'), /var\(--red-ink-strong\)/, 'solid red stays solid on hover');
  for (const sel of ['.btn:hover:not(:disabled)', '.btn-primary:hover:not(:disabled)']) {
    assert.doesNotMatch(body(sel), /transform|box-shadow/, `${sel} lifts or washes`);
  }
});

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'fonts', 'assets']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mjs|js|css|html)$/.test(name)) out.push(full);
  }
  return out;
}
/** Block comments (newlines kept, so hit line numbers are real), then whole-line and trailing `// ` comments. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');
const FILES = [...walk(join(ROOT, 'ui/public')), join(ROOT, 'test/fixtures/theme-kitchen-sink.html')];
const rel = (f) => relative(ROOT, f).split(sep).join('/');
function scan(re, files = FILES) {
  const hits = [];
  for (const f of files) code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => { if (re.test(l)) hits.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  return hits;
}

// D4: shared skin vocabularies, folded into .btn.
const REMOVED = ['btn-go', 'btn-ghost', 'btn-mini', 'btn-clear', 'btn-expand', 'icon-btn', 'rd-cta', 'ask-card-start',
  'wfv-btn', 'wfv-btn-primary', 'wfv-icon-btn', 'apv-btn', 'apv-btn-primary', 'pp-btn', 'chat-rc-btn', 'ask-icon-btn'];
// D5: single-element hooks that stay for JS and tests, with layout only.
const HOOKS = ['stop-confirm', 'stop-cancel', 'shipit-ok', 'guide-next', 'mc-btn', 'pp-send', 'gv-nav-btn', 'ask-cmd-stop',
  'sync-check-now', 'hd-stop', 'rd-stop', 'rd-pause', 'topnav-new', 'hd-more', 'ask-card-not-now', 'btn-split-more'];
// A whole class token: not part of a longer class or of a data- attribute (data-ask-card-start stays).
const classRe = (c) => new RegExp(`(?<![\\w-])${c}(?![\\w-])`);

test('no removed button skin class anywhere in ui/ (known bug 4, spec §5.2)', () => {
  assert.deepEqual(REMOVED.flatMap((c) => scan(classRe(c)).map((h) => `${c} — ${h}`)), []);
});

const SKIN = /^(?:height|min-height|padding(?:-[a-z]+)?|border(?:-[a-z]+)*|background(?:-[a-z]+)?|color|font(?:-[a-z]+)?|box-shadow|letter-spacing|text-transform|line-height)$/;
test('button hook classes keep layout only; the skin is .btn in markup (D5)', () => {
  const bad = [];
  for (const r of ALL) {
    for (const s of splitTop(r.sel)) {
      const last = s.split(/\s*[>+~]\s*|\s+/).at(-1);
      if (last.includes('::') || !HOOKS.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(last))) continue;
      for (const [p, v] of decls(r.body, '[\\w-]+')) if (SKIN.test(p)) bad.push(where(r, `${p}:${v}`));
    }
  }
  assert.deepEqual(bad, []);
});

test('no inline padding on a .btn: the three sizes own it (spec §5.1)', () => {
  const btn = /class="(?:[^"]*\s)?btn(?:\s[^"]*)?"/;
  const padded = /style="[^"]*padding/;
  assert.deepEqual(scan({ test: (l) => btn.test(l) && padded.test(l) }), []);
});

test('no uppercase tracked micro-labels (spec §1.3)', () => {
  const bad = [];
  for (const r of ALL) {
    for (const [, v] of decls(r.body, 'text-transform')) if (v === 'uppercase') bad.push(where(r, v));
    for (const [, v] of decls(r.body, 'letter-spacing')) { const n = parseFloat(v); if (/em$/.test(v) && n >= 0.03) bad.push(where(r, v)); }
  }
  assert.deepEqual(bad, []);
});

// The spec's list (⌄ ⌃ ⋯ ▾ ✓ × ▷) plus the other glyph icons in today's tree: ▴ ▸ ✕ ✗, the port-order ▲ ▼ and
// the env-copy ⧉ buttons. CSS content also carries ↻ (loop mark) and ❚❚ (paused node badge).
const GLYPHS = '⌄⌃⋯▾▴▸▷▲▼✓✕✗×⧉';
const GLYPH_ESC = '\\\\u(?:2304|2303|22ef|25be|25b4|25b8|25b7|25b2|25bc|2713|2715|2717|00d7|29c9)';
const GLYPH_ONLY = new RegExp(`(['"\`>])\\s*(?:[${GLYPHS}]|${GLYPH_ESC})\\s*(['"\`<])`, 'i');
// CSS escapes in content: '\25BE', '\00d7', '\d7'.
const CSS_GLYPH = new RegExp(`[${GLYPHS}↻❚]|\\\\0{0,2}(?:2304|2303|22ef|25be|25b4|25b8|25b7|25b2|25bc|2713|2715|2717|29c9|21bb|275a)(?![0-9a-f])|\\\\0{0,4}d7(?![0-9a-f])`, 'i');

test('no text character used as an icon: a string or element text that is only a glyph (spec §1.3)', () => {
  assert.deepEqual(scan(GLYPH_ONLY), []);
  const bad = ALL.flatMap((r) => decls(r.body, 'content').filter(([, v]) => CSS_GLYPH.test(v)).map(([, v]) => where(r, v)));
  assert.deepEqual(bad, []);
});

const RING = /^(?:none|inset .+|0 0 0 [\d.]+px .+|var\(--(?:shadow-pop|shadow-menu|shadow-sheet|shadow-dock|knob-shadow)\))$/;
test('no resting drop shadows: rings, insets and the floating tokens only (spec §1.3, D14)', () => {
  // Definitions and uses, @keyframes included.
  assert.deepEqual(css.match(/--shadow(?:-soft|-hover|-card|-glass)?(?![\w-])/g) || [], []);
  const bad = ALL.flatMap((r) => decls(r.body, 'box-shadow').filter(([, v]) => !splitTop(v).every((p) => RING.test(p))).map(([, v]) => where(r, v)));
  assert.deepEqual(bad, []);
  const lift = ALL.filter((r) => /:hover/.test(r.sel) && /transform:\s*translateY\(-/.test(r.body)).map((r) => where(r, 'translateY'));
  assert.deepEqual(lift, []);
});

// D15: functional textures, by exact selector. Dot grids, loading shimmers and sweeps, hatching, scroll fades.
const GRADIENT_OK = new Set(['.wf-pop-canvas', '.run-flow-wrap', '.ask-wfcard-graph', '.ask-rc-graph', '.gv-canvas',
  '.chat-home-wf-tb', '.skel', '.ws-sum-pending', '.shipit-desc-field.is-generating .shipit-desc-busy::before',
  '.shipit-desc-busy-label', '.ask-thinking-label', '.ask-wfcard-step.is-live .st-label', '.wfc-act-l', '.pp-shimmer',
  '.ask-ctx-bar-buffer', '.ask-ctx-stat[data-stat="buffer"] .ask-ctx-swatch', '.chat-dock::before',
  '.plan-md.collapsed::after']);
test('gradients only as functional textures (D15)', () => {
  const bad = ALL.flatMap((r) => decls(r.body, 'background(?:-image)?')
    .filter(([, v]) => /gradient\(/.test(v) && !GRADIENT_OK.has(r.sel)).map(([, v]) => where(r, v.slice(0, 40))));
  assert.deepEqual(bad, []);
});

test('no coloured left-border accent cards (D16)', () => {
  const zeroWidth = (body) => /(?:^|;)\s*width:0(?:px)?\s*(?:;|$)/.test(body);   // CSS triangles and hairline markers
  const bad = ALL.filter((r) => !/blockquote/.test(r.sel) && !zeroWidth(r.body))
    .flatMap((r) => decls(r.body, 'border-left').filter(([, v]) => parseFloat(v) >= 2).map(([, v]) => where(r, v)));
  assert.deepEqual(bad, []);
});

const KIND_CHIPS = ['.badge', '.flag-chip', '.issue-sev', '.artifact-kind', '.tp-kind', '.sk-kind', '.team-chip .kind',
  '.hd-ov-file-kind', '.ask-mcard-kind', '.wf-log-live', '.kind-chip'];
test('kind and state chips are one 11px sans chip with 2px corners (D13)', () => {
  const group = ALL.find((r) => r.sel.startsWith(':is(.badge,'));
  assert.ok(group, 'the grouped chip rule');
  for (const k of KIND_CHIPS) assert.ok(group.sel.includes(k), `${k} is in the grouped chip rule`);
  assert.match(group.body, /border-radius:var\(--r-xs\);/);
  assert.match(group.body, /font:500 11px\/1 var\(--sans\);/);
  const own = ALL.filter((r) => r !== group && splitTop(r.sel).some((s) => KIND_CHIPS.includes(s)));
  const bad = own.flatMap((r) => decls(r.body, 'font(?:-family|-size|-weight)?|border-radius|text-transform|letter-spacing').map(([p, v]) => where(r, `${p}:${v}`)));
  assert.deepEqual(bad, []);
});

test('radii in JS-built CSS and inline styles (c4 shadow DOM, the guide spotlight) use the tokens too (D17)', () => {
  const re = /border-?radius\s*[:=]\s*(?!['"`]?\s*(?:var\(--r-(?:xs|sm)\)|0[;'"`\s}]|50%))/i;
  assert.deepEqual(scan(re, FILES.filter((f) => !f.endsWith('.css'))), []);
});

test('the scan helpers: comments are stripped, data- attributes and longer classes do not count', () => {
  assert.equal(classRe('btn-go').test('class="btn btn-go"'), true);
  assert.equal(classRe('ask-card-start').test('data-ask-card-start'), false);
  assert.equal(classRe('icon-btn').test('wfv-icon-btn'), false);
  assert.equal(classRe('wfv-btn').test('wfv-btn-primary'), false);
  assert.equal(GLYPH_ONLY.test("b.textContent = '×';"), true);
  assert.equal(GLYPH_ONLY.test('`${n}× faster`'), false);
  assert.equal(CSS_GLYPH.test("'\\25BE'"), true);
  assert.equal(CSS_GLYPH.test('"❚❚"'), true);
  assert.equal(GLYPH_ONLY.test("fmMini('pf-up', '▲', 'Move this port up')"), true);
  assert.equal(rules('@media (x){.a{b:1}}.c{d:2}').map((r) => r.sel).join(), '.a,.c');
  assert.deepEqual(splitTop('0 0 0 1px color-mix(in srgb, var(--c) 5%, red),var(--shadow-pop)'),
    ['0 0 0 1px color-mix(in srgb, var(--c) 5%, red)', 'var(--shadow-pop)']);
});

// Known bug 10 (spec): rules slices 3 and 4 removed must not come back with a merge. Classes deleted from style.css
// by d9a6ba81 (the Runs list) and 67f3eca8 (the run page), and ids deleted from index.html.
const REMOVED_RUNS = [
  'hist-filter', 'pal-filter', 'pill-count', 'runs-chain', 'runs-chain-glyph', 'runs-chain-member', 'runs-chain-members',
  'runs-chain-pr', 'runs-chain-toggle', 'runs-chev', 'runs-filter', 'runs-glyph', 'runs-group', 'runs-group-btn',
  'runs-group-head', 'runs-group-rows', 'runs-group-wrap', 'runs-head-tools', 'runs-ic', 'runs-ic-ask', 'runs-ic-done',
  'runs-ic-fail', 'runs-ic-paused', 'runs-ic-run', 'runs-ic-scheduled', 'runs-ic-start', 'runs-ic-stop', 'runs-needs',
  'runs-needs-head', 'runs-people', 'runs-row-body', 'runs-row-tags', 'runs-search', 'runs-search-btn', 'runs-search-row',
  'runs-tag-wrap',
  'rd-now-elapsed', 'rd-now-state', 'rd-now-sub', 'rd-now-text', 'rd-now-title', 'rd-orb', 'rd-prog', 'rd-prog-chain',
  'rd-slice-line', 'rd-slice-link',
  // ids removed from index.html that are not also class names above
  'historyFilter', 'runs-archived-btn', 'runs-tag',
];
test('no Runs list or run page rule removed by the redesign comes back (Known bug 10)', () => {
  assert.deepEqual([...new Set(REMOVED_RUNS)].flatMap((c) => scan(classRe(c)).map((h) => `${c} — ${h}`)), []);
});
test('the removed-selector scan flags a reappearance (self-test)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdl-'));
  const f = join(dir, 'x.css');
  writeFileSync(f, '/* .runs-search in a comment is fine */\n.runs-search { display: flex; }\n.run-prog { }\n');
  try {
    assert.deepEqual(scan(classRe('runs-search'), [f]).map((h) => h.replace(/^.*x\.css:/, '')), ['2: .runs-search { display: flex; }']);
    assert.deepEqual(scan(classRe('rd-prog'), [f]), [], 'run-prog is a live class, not rd-prog');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('the Runs header holds no search field or filter row (spec §3.1, Known bug 10 layout)', () => {
  const doc = new JSDOM(readFileSync(join(ROOT, 'ui/public/index.html'), 'utf8')).window.document;
  const head = doc.querySelector('.runs-head');
  assert.ok(head, 'the Runs header exists');
  // Slice 3's select-all checkbox (input.runs-check.runs-all, ui/public/index.html:671) belongs there; any other
  // input (text, search, a bare <input>) is the old search field coming back.
  assert.deepEqual([...head.querySelectorAll('input:not([type="checkbox"]), .runs-filter, .runs-search-row')].map((e) => e.outerHTML.slice(0, 80)), []);
  assert.equal(doc.querySelector('#runs-search, #runs-filter, #historyFilter'), null);
});
