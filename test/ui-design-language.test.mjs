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

const TOKEN = /^(?:var\(--r-(?:xs|sm|md|lg|pill|card|ctrl)\)|0|inherit)$/;
// D2: the five round kinds. Extend only with a selector of one of these kinds.
// Dots: nav-rollup, tl-mark.is-open, tl-pr-start, hd-base-pill::before, rg-td, ask-rp-kicker::before, npip/nwarn.
// Knobs: .wz .tog::after. Spinners: the busy::after rings.
const ROUND = /dot|\bava\b|-ava\b|avatar|person-ini|knob|switch::after|tog::after|spin|busy::after|\bled\b|radio|status-word::before|nav-rollup|tl-mark\.is-open|tl-pr-start|hd-base-pill::before|rg-td|kicker::before|npip|nwarn/;

test('radius tokens (decided 2026-10-19): xs 4, sm 6, md 8, lg 12, pill; card = md, ctrl = sm', () => {
  const root = ALL.find((r) => r.sel === ':root').body;   // the first :root (line 14) is the token block
  for (const re of [/--r-xs:4px;/, /--r-sm:6px;/, /--r-md:8px;/, /--r-lg:12px;/, /--r-pill:999px;/,
    /--r-card:var\(--r-md\);/, /--r-ctrl:var\(--r-sm\);/]) assert.match(root, re);
});

test('--r-pill only on the switch track, --r-lg only on the chat composer shell', () => {
  const uses = (tok) => ALL.filter((r) => decls(r.body, 'border-radius').some(([, v]) => v.includes(`var(--r-${tok})`)));
  assert.deepEqual(uses('pill').filter((r) => !splitTop(r.sel).every((s) => /^\.switch$/.test(s))).map((r) => where(r, 'pill')), []);
  assert.deepEqual(uses('lg').filter((r) => !splitTop(r.sel).every((s) => /\.ask-composer-box$/.test(s))).map((r) => where(r, 'lg')), []);
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
test('kind and state chips are one 11px sans chip with 4px corners (D13)', () => {
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

// Floating surfaces may cast a shadow; anything else at rest may not (review A2, spec §1.3). A selector floats when
// FLOATING names it or some rule for its last compound positions it fixed/absolute/sticky.
// drop-label: the drag-and-drop overlay label; sheet-card: the card inside the absolute .wfv-sheet overlay;
// apv-card: the preview modal; [data-open: the expanded chat composer floats over the page.
const FLOATING = /menu|pop|modal|dialog|bubble|balloon|toast|drawer|dock|tip|picker|dropdown|overlay|fly|tsearch-(?:list|panel)|confirm|knob|switch::after|tog::after|drop-label|sheet-card|apv-card|\[data-open/;
const lastCompound = (s) => s.split(/\s*[>+~]\s*|\s+/).at(-1).replace(/:(?:hover|focus(?:-visible)?|active)\b/g, '');
const POSITIONED = new Set(ALL.filter((r) => decls(r.body, 'position').some(([, v]) => /^(?:fixed|absolute|sticky)$/.test(v)))
  .flatMap((r) => splitTop(r.sel).map(lastCompound)));
test('the floating shadow tokens only on floating surfaces (A2)', () => {
  const floats = (s) => FLOATING.test(s) || POSITIONED.has(lastCompound(s));
  const bad = ALL.filter((r) => !/:hover|:focus|:active|\.is-open|\[open\]|\.open\b/.test(r.sel))
    .flatMap((r) => decls(r.body, 'box-shadow').filter(([, v]) => /var\(--shadow-(?:pop|sheet|menu|dock)\)/.test(v)
      && !splitTop(r.sel).every(floats)).map(([, v]) => where(r, v)));
  assert.deepEqual(bad, []);
  assert.doesNotMatch(css, /gs-pill-glow/);
  for (const r of ALL.filter((x) => splitTop(x.sel).includes('.tsearch-field'))) assert.doesNotMatch(r.body, /box-shadow/, where(r, 'ring'));
});

// One tab style (review A3, B4): .tab is underline; per-view tab classes keep spacing only.
const TAB_HOOKS = ['rd-tab', 'hd-tab', 'pd-tab', 'tp-tab', 'chat-home-tab', 'wfl-tab', 'af-tab', 'md-tab', 'hd-cmt-tab', 'activity-tab'];
const TAB_SKIN = /^(?:height|min-height|border(?:-[a-z]+)*|background(?:-[a-z]+)?|color|font(?:-[a-z]+)?|box-shadow|letter-spacing|text-transform|line-height)$/;
test('tabs: one underline .tab at 32px; no boxed or per-view tab skin (A3)', () => {
  const tab = (ALL.find((r) => r.sel === '.tab') || {}).body || '';
  assert.match(tab, /height:32px;/);
  assert.match(tab, /font:500 13px\/1 var\(--sans\);/);
  assert.match(tab, /border:0;/);
  assert.match(tab, /background:none;/);
  const bad = [];
  for (const r of ALL) {
    for (const s of splitTop(r.sel)) {
      const last = s.split(/\s*[>+~]\s*|\s+/).at(-1);
      if (last.includes('::') || !TAB_HOOKS.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(last))) continue;
      for (const [p, v] of decls(r.body, '[\\w-]+')) if (TAB_SKIN.test(p)) bad.push(where(r, `${p}:${v}`));
    }
  }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(css, /\.chat-home-ink\b/);
});

// Every tab emitter wears the one skin (impl review 1): a role="tab" names .tab (or sits in a .seg), a
// role="tablist" names .tabs, within the few lines that build it. Allowed, each with its reason:
const TABLIST_OK = [
  /class="(?:rd|hd|pd|tp)-tabs"/,   // initDetailTabs hosts: `bar.classList.add('tabs')` when the screen renders
  /make\('div', 'term-tabs'\)/,       // terminal-pane.mjs: the terminal strip is a browser-style tab row, not the underline
];
const TAB_OK = [/button\(text, 'term-tab'/];   // the terminal's own tabs, same reason
const ROLE_TAB = /role(?:'\s*,\s*'|=")(tab|tablist)['"]/;
const classTok = (w) => new RegExp(`['"\`][^'"\`\\n]*(?<![\\w-])(?:${w})(?![\\w-])[^'"\`\\n]*['"\`]`);
function tabEmitterHits(files) {
  const hits = [];
  for (const f of files.filter((x) => !x.endsWith('.css'))) {
    const lines = code(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((l, i) => {
      const m = l.match(ROLE_TAB);
      if (!m || /closest\(|querySelector/.test(l)) return;
      const near = lines.slice(Math.max(0, i - 6), i + 1).join('\n').replace(new RegExp(ROLE_TAB.source, 'g'), '');
      const list = m[1] === 'tablist';
      if ((list ? TABLIST_OK : TAB_OK).some((re) => re.test(lines.slice(Math.max(0, i - 6), i + 1).join('\n')))) return;
      if (!classTok(list ? 'tabs|seg' : 'tab|seg').test(near)) hits.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  return hits;
}
test('every role="tab" / role="tablist" emitter adds .tab / .tabs (impl review 1)', () => {
  assert.deepEqual(tabEmitterHits(FILES), []);
});
test('the tab-emitter scan flags a bare per-view tab (self-test)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tab-emit-'));
  try {
    const f = join(dir, 'x.mjs');
    writeFileSync(f, "const bar = h(doc, 'div', 'tp-tabs tp-edit-tabs'); bar.setAttribute('role', 'tablist');\n"
      + "const btn = h(doc, 'button', 'tp-tab'); btn.setAttribute('role', 'tab');\n");
    assert.equal(tabEmitterHits([f]).length, 2);
    writeFileSync(f, "const bar = h(doc, 'div', 'tp-tabs tabs'); bar.setAttribute('role', 'tablist');\n"
      + "const btn = h(doc, 'button', 'tp-tab tab'); btn.setAttribute('role', 'tab');\n");
    assert.deepEqual(tabEmitterHits([f]), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Size scale (review A5, C): controls at 28/32/40, tiles 56-64, an info tip's hit target at least 24.
const CONTROL_HEIGHTS = { '.tab': 32, '.seg button': 28, '.seg.seg-sm button': 24, '.chat-home-preset': 28, '.wfl-chip': 28,
  '.wfl-folder': 32, '.info-tip': 24, '.chat-home-act': 56 };
const OFF_SCALE = [26, 31, 34, 36, 43, 44, 55, 78];
const CONTROL_WORD = /^(?:tab|tabs|seg|btn|chip|preset|act|folder|switch|button)$/;
// Rows, not controls (spec §1.2): allowed at their own height. Each entry names its reason.
const ROW_OK = ['.act-srow'];                            // activity list row, 26px dense row (spec §3.1)
const classWords = (s) => (s.match(/\.[\w-]+/g) || []).flatMap((c) => c.slice(1).split('-'));
test('control heights on the scale (A5)', () => {
  for (const [sel, h] of Object.entries(CONTROL_HEIGHTS)) {
    const body = ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
    assert.match(body, new RegExp(`(?:^|;)\\s*(?:min-)?height\\s*:\\s*${h}px`), `${sel} is ${h}px`);
  }
  const off = ALL.flatMap((r) => decls(r.body, '(?:min-)?height')
    .filter(([, v]) => /^\d+px$/.test(v) && OFF_SCALE.includes(parseInt(v, 10))
      && splitTop(r.sel).some((s) => !ROW_OK.some((ok) => s.includes(ok))
        && (/\bbutton\b/.test(s) || classWords(lastCompound(s)).some((w) => CONTROL_WORD.test(w)))))
    .map(([, v]) => where(r, v)));
  assert.deepEqual(off, []);
});

test('switch: one 32x18 pill track and a round knob (B6)', () => {
  const sw = (ALL.find((r) => r.sel === '.switch') || {}).body || '';
  assert.match(sw, /width:32px;height:18px;border-radius:var\(--r-pill\);/);
  const sized = ALL.filter((r) => r.sel !== '.switch' && splitTop(r.sel).some((s) => /\.switch(?![\w-])/.test(lastCompound(s)) && !s.includes('::')))
    .flatMap((r) => decls(r.body, '(?:width|height|transform)').map(([p, v]) => where(r, `${p}:${v}`)));
  assert.deepEqual(sized, []);
});

// One border level per card (B2). Inputs, buttons and segments keep theirs.
const CARD_HOSTS = /\.(?:ask-card|chat-rc|shape-feature)(?![\w-])/;
const OWN_BORDER = /\b(?:btn|seg|textarea|input|select|field|switch|kbd)\b|input|textarea|select|:focus/;
const IN_CARD = ['.qpanel', '.qblock', '.qopt', '.af-choice', '.af-form', '.issue-detail', '.opt-row', '.shape-plan-notes',
  '.outline-slice', '.shape-plan-outline-change', '.chat-rc-result', '.shape-card'];
test('no bordered box inside a bordered card (B2)', () => {
  const bad = ALL.filter((r) => splitTop(r.sel).some((s) => CARD_HOSTS.test(s) && s.trim().split(/\s+/).length > 1
      && !OWN_BORDER.test(s.trim().split(/\s+/).at(-1))))
    .flatMap((r) => decls(r.body, 'border').filter(([, v]) => !/^(?:0|none)\b/.test(v)).map(([, v]) => where(r, v)));
  assert.deepEqual(bad, []);
  // The one in-card override (D16) names every nested box and drops its border.
  const ov = ALL.find((r) => r.sel.startsWith(':is(.ask-card,.chat-rc,.shape-feature) :is('));
  assert.ok(ov, 'the in-card override rule exists');
  for (const c of IN_CARD) assert.ok(ov.sel.includes(`${c},`) || ov.sel.includes(`${c})`), `${c} is in the override`);
  assert.match(ov.body, /border:0;/);
});

test('run bars are neutral: no blue fill on a progress bar (A1, spec §2.3)', () => {
  const bad = ALL.filter((r) => /prog|chain-track|progress/.test(r.sel) && !/ask-ctx/.test(r.sel))
    .flatMap((r) => decls(r.body, 'background(?:-color)?').filter(([, v]) => /--blue/.test(v)).map(([, v]) => where(r, v)));
  assert.deepEqual(bad, []);
});

test('a flag chip in a tab strip sits inside its tab label (A4)', async () => {
  const { decorateFlagChips } = await import('../ui/public/flags.mjs');
  const doc = new JSDOM(readFileSync(join(ROOT, 'ui/public/index.html'), 'utf8')).window.document;
  decorateFlagChips(doc);
  for (const strip of doc.querySelectorAll('.tabs, .seg, [role="tablist"]')) {
    assert.deepEqual([...strip.children].filter((c) => c.matches('.flag-chip, a')).map((c) => c.outerHTML.slice(0, 60)), []);
  }
});

// Fix 2 (bundle consistency): one wording per state. A status word is followed by " · ", never ": ".
const STATE_COLON = /\b(?:starting|working|step|needs you|pausing|paused|interrupted|waiting|failed|stopped|ready|in review|merged)\s*:\s/i;
const blankComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
test('status lines: no state word in a colon form in run-model or run-progress (fix 2)', () => {
  const bad = [];
  for (const f of ['src/shared/run-model.mjs', 'src/shared/run-progress.mjs']) {
    const lines = blankComments(readFileSync(join(ROOT, f), 'utf8')).split('\n');
    lines.forEach((l, i) => {
      for (const lit of l.match(/'[^'\n]*'|`[^`\n]*`|"[^"\n]*"/g) || []) if (STATE_COLON.test(lit)) bad.push(`${f}:${i + 1} ${lit}`);
    });
  }
  assert.deepEqual(bad, []);
});

// Fix 1: a member-row title is never link-styled — the one table rule sets ink and no underline, and no other rule
// colours or underlines it; the chat card's member host is a container that drops the cost under 480px.
test('member rows: the title is ink with no underline at rest, on every surface (fix 1, spec §3.4)', () => {
  const own = ALL.filter((r) => splitTop(r.sel).some((s) => /\.run-member-title(?![\w-])/.test(s.split(/\s+/).at(-1))));
  const base = own.find((r) => r.sel === '.run-members.is-table .run-member-title');
  assert.ok(base, 'the table title rule exists');
  assert.match(base.body, /color:var\(--ink\)/);
  assert.match(base.body, /text-decoration:none/);
  const other = own.filter((r) => r !== base && !/:hover/.test(r.sel))
    .flatMap((r) => decls(r.body, '(?:color|text-decoration(?:-line)?)').map(([p, v]) => where(r, `${p}:${v}`)));
  assert.deepEqual(other, []);
  assert.ok(ALL.some((r) => r.sel === '.chat-rc-members' && /container:chat-rc-members \/ inline-size/.test(r.body)), 'the chat member host is a container');
  const narrow = css.slice(css.indexOf('@container chat-rc-members (max-width:480px)'));
  assert.ok(css.includes('@container chat-rc-members (max-width:480px)'), 'the card drops the cost under 480px');
  assert.match(narrow.slice(0, 400), /\.run-members\.is-table \.run-member-cost\{display:none;?\}/);
  assert.ok(css.indexOf('@container chat-rc-members') < css.indexOf('@media (max-width:600px){\n  .run-members.is-table'),
    'the phone layout comes later, so it wins on a narrow viewport');
});

// QA 1: a badge is one word that is never cut. .auto-badge is a free-text workflow-name label (out of scope, plan §Open questions).
test('badges never truncate: no text-overflow on a badge class', () => {
  const ALLOW = new Set(['.auto-badge']);
  const BADGE = /\.[\w-]*badge[\w-]*(?![\w-])/;
  const bad = ALL.filter((r) => splitTop(r.sel).some((s) => { const last = s.trim().split(/\s+/).at(-1); return BADGE.test(last) && !ALLOW.has(last); }))
    .flatMap((r) => decls(r.body, 'text-overflow').map(([p, v]) => where(r, `${p}:${v}`)));
  assert.deepEqual(bad, []);
});

// QA 8: narrow layouts follow their own container: the run page's stat boxes (.rd-facts), the group page's table
// (.gpage-runs), and the run page's Group row on a phone.
test('narrow layouts: stat boxes 2 per row, the Group row stacks, group page rows put chip and cost under the title', () => {
  assert.ok(ALL.some((r) => r.sel === '.rd-facts' && /container:rd-facts \/ inline-size/.test(r.body)), 'the facts are a container');
  const facts = css.match(/@container rd-facts \(max-width:420px\)\{([^\n]*)\}/);
  assert.ok(facts, 'the narrow stat boxes block exists');
  assert.match(facts[1], /\.rd-stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/);
  assert.match(facts[1], /\.rd-stats\[data-n="3"\] > div:last-child\{grid-column:1 \/ -1;\}/);
  const phone = css.match(/@media \(max-width:640px\)\{\.rd-group-line\{([^}]*)\}([^\n]*)\}/);
  assert.ok(phone, 'the phone Group row block exists');
  assert.match(phone[1], /flex-direction:column/);
  assert.match(phone[2], /\.rd-group-sep\{display:none;?\}/);
  assert.ok(ALL.some((r) => r.sel === '.gpage-runs' && /container:gpage-runs \/ inline-size/.test(r.body)), 'the group table host is a container');
  const at = css.indexOf('@container gpage-runs (max-width:480px)');
  assert.ok(at > 0, 'the narrow group table block exists');
  const block = css.slice(at, css.indexOf('\n}', at));
  // Web UI review: "dot num main go" left the title ~96px and pushed rows past a 290px pane. Bundle QA 2: the number
  // stays with the title on line 1 (the title spans both right columns); the chip and the cost share line 2.
  assert.match(block, /\.run-members\.is-table\{grid-template-columns:12px 20px minmax\(0,1fr\) max-content;column-gap:8px;\}/);
  assert.match(block, /\.run-members\.is-table > \.run-member\{[^}]*grid-template-areas:"dot num main main" "\. \. pr cost";/,
    'bundle QA 2: the number stays with the title on line 1; chip and cost share line 2');
  assert.match(block, /\.run-members\.is-table \.run-member-go\{display:none;?\}/);
  assert.match(block, /\.run-members\.is-table \.run-member-title\{[^}]*-webkit-line-clamp:2;/);
  assert.doesNotMatch(block, /flex-wrap:wrap/, 'the chip never wraps its icon away from its word');
  // The chip's cell is capped at its column, so the chip's max-width:100% bites and a long word ends in an ellipsis
  // (with justify-self:start alone the cell grows to the nowrap chip and the word runs over the cost).
  assert.match(block, /\.run-members\.is-table \.run-member-pr\{min-width:0;max-width:100%;justify-self:start;\}/);
  // Bundle QA 2: a chat card in a ~290px side pane stacks the same way (after its 480px block, which drops the cost).
  const chatAt = css.indexOf('@container chat-rc-members (max-width:360px)');
  assert.ok(chatAt > css.indexOf('@container chat-rc-members (max-width:480px)'), 'the 360px block follows the 480px one');
  const chat = css.slice(chatAt, css.indexOf('\n}', chatAt));
  assert.match(chat, /\.run-members\.is-table > \.run-member\{[^}]*grid-template-areas:"dot num main main" "\. \. pr cost";/);
  assert.match(chat, /\.run-members\.is-table \.run-member-cost\{display:block;?\}/, 'the cost is back, on line 2');
  assert.match(chat, /\.run-members\.is-table \.run-member-pr\{min-width:0;max-width:100%;justify-self:start;\}/);
  // The chip keeps icon and word on one line at every width; a too-narrow cell cuts the word with an ellipsis.
  const chip = ALL.find((r) => r.sel === '.run-members.is-table .runs-pr');
  assert.ok(chip, 'the member-row chip rule exists');
  assert.match(chip.body, /flex-wrap:nowrap/);
  assert.match(chip.body, /white-space:nowrap/);
  assert.ok(ALL.some((r) => r.sel === '.run-members.is-table .runs-pr-word' && /text-overflow:ellipsis/.test(r.body)));
});
