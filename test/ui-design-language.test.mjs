// test/ui-design-language.test.mjs — runs-redesign spec §1 and §5.1: radius tokens, the one button component, no
// removed button skins, hooks without skins, no uppercase tracked labels, no glyph icons, no resting shadows,
// gradients or accent borders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { cssRules as rules } from './helpers/css-rules.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Comments blanked but newlines kept, so a rule's line number is its real line.
const css = readFileSync(join(ROOT, 'ui/public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

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
  assert.match(body('.confirm-modal .btn-danger:hover:not(:disabled)'), /var\(--danger-solid-hover\)/, 'solid red stays solid on hover');
  assert.match(css, /--danger-solid-hover:color-mix\(in srgb,var\(--ink\) 12%,var\(--red-ink-strong\)\)/, 'the shared hover recipe is on the solid red');
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
  'sync-check-now', 'hd-stop', 'rd-stop', 'rd-pause', 'topnav-new', 'ask-card-not-now', 'btn-split-more',
  'chat-home-act', 'chat-run-tile-open'];
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
  '.plan-md.collapsed::after', '.sn-adorn.sn-loading .input']);
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
  '.hd-ov-file-kind', '.ask-mcard-kind', '.wf-log-live', '.kind-chip', '.tag-chip', '.ps-pill', '.ask-cmd-pill', '.tp-tab-badge'];
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
// Slice 3: the four one-off filter chips are gone; .filter-chip is the only one (docs/design-system.md › Filter chip).
const REMOVED_CHIPS = ['mv-filter', 'wfl-chip', 'proj-fchip', 'mcp-chip'];
test('ui/public no longer defines or uses mv-filter, wfl-chip, proj-fchip or mcp-chip', () => {
  assert.deepEqual(REMOVED_CHIPS.flatMap((c) => scan(classRe(c)).map((h) => `${c} — ${h}`)), []);
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
const CONTROL_HEIGHTS = { '.tab': 32, '.seg button': 28, '.chat-home-preset': 28, '.filter-chip': 28,
  '.wfl-folder': 32, '.info-tip': 28 };
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
const IN_CARD = ['.qpanel', '.qblock', '.af-choice', '.af-form', '.issue-detail', '.opt-row', '.shape-plan-notes',
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

test('run 4 D6: a question\'s options are divided rows, not boxes', () => {
  const body = (sel) => (ALL.find((r) => r.sel === sel) || {}).body || '';
  assert.match(body('.qopt'), /border:0;border-top:1px solid var\(--line\);border-radius:0;/);
  assert.doesNotMatch(body('.qopt.sel'), /box-shadow/);
  assert.match(body('.qopt.sel'), /background:var\(--field\);/);
  assert.equal(ALL.some((r) => /\.qconf-fill/.test(r.sel)), false);
  assert.doesNotMatch(body('.qopt::before'), /attr\(data-key\)/);
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
// (.gpage-runs), and the facts block (.rd-kv, run 3 D8) in a narrow card.
test('narrow layouts: stat boxes 2 per row, the facts block stacks label over value, group page rows put chip and cost under the title', () => {
  assert.ok(ALL.some((r) => r.sel === '.rd-facts' && /container:rd-facts \/ inline-size/.test(r.body)), 'the facts are a container');
  const facts = css.match(/@container rd-facts \(max-width:420px\)\{([^\n]*)\}/);
  assert.ok(facts, 'the narrow stat boxes block exists');
  assert.match(facts[1], /\.rd-stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/);
  assert.match(facts[1], /\.rd-stats\[data-n="3"\] > div:last-child\{grid-column:1 \/ -1;\}/);
  assert.ok(ALL.some((r) => r.sel === '.rd-kv' && /container:rd-kv \/ inline-size/.test(r.body)), 'the facts block is a container');
  const kv = css.match(/@container rd-kv \(max-width:420px\)\{([^\n]*)\}/);
  assert.ok(kv, 'the narrow facts block exists');
  assert.match(kv[1], /\.rd-kv-row\{grid-template-columns:minmax\(0,1fr\);/);
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

// Design system (docs/design-system.md): the guide's tables match style.css, and drift only shrinks.
const DEBT = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/design-debt.json'), 'utf8'));
const GUIDE = join(ROOT, 'docs/design-system.md');
// `| \`--r-xs\` | 4px | …` and `| small | 28px | …` rows of the guide's tables.
const guideRows = (text, re) => [...text.matchAll(re)].map((m) => [m[1], m[2]]);
const ratchet = (found, listed, what) => {
  const extra = found.filter((s) => !listed.includes(s));
  const stale = listed.filter((s) => !found.includes(s));
  assert.deepEqual(extra, [], `new ${what}: fix it, do not add it to test/fixtures/design-debt.json`);
  assert.deepEqual(stale, [], `${what} no longer in the code: remove it from test/fixtures/design-debt.json`);
};

test('the ratchet rejects a new offender and a stale entry, and passes an exact list', () => {
  assert.doesNotThrow(() => ratchet(['.a select', '.b select'], ['.a select', '.b select'], 'x'));
  assert.throws(() => ratchet(['.a select', '.b select'], ['.a select'], 'x'), /new x/);
  assert.throws(() => ratchet(['.a select'], ['.a select', '.gone select'], 'x'), /x no longer in the code/);
});

test('the guide exists with Foundations, Components, Patterns and Do and don\'t', () => {
  assert.ok(existsSync(GUIDE), 'docs/design-system.md');
  const g = readFileSync(GUIDE, 'utf8');
  for (const h of ['## Foundations', '## Components', '## Patterns', '## Do and don\'t']) assert.ok(g.includes(`\n${h}\n`), h);
});

test('the guide\'s corner table is the :root radius set, 4/6/8/12 and nothing else', () => {
  const g = readFileSync(GUIDE, 'utf8');
  const root = ALL.find((r) => r.sel === ':root').body;
  const rows = guideRows(g, /^\| `(--r-(?:xs|sm|md|lg))` \| (\d+px) \|/gm);
  assert.deepEqual(rows.map(([, v]) => v), ['4px', '6px', '8px', '12px']);
  for (const [tok, v] of rows) assert.match(root, new RegExp(`${tok}:${v};`), `${tok} is ${v} in style.css`);
  // No other radius token anywhere in style.css (--r-pill is the switch track; --r-card / --r-ctrl are aliases).
  const own = ALL.flatMap((r) => decls(r.body, '--r-[\\w-]+').map(([p, v]) => [p, v, r]))
    .filter(([p]) => !['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-pill', '--r-card', '--r-ctrl'].includes(p));
  assert.deepEqual(own.map(([p, v, r]) => where(r, `${p}:${v}`)), []);
});

test('the guide\'s size table matches the button and field rules: 28 / 32 / 40', () => {
  const g = readFileSync(GUIDE, 'utf8');
  assert.deepEqual(guideRows(g, /^\| (small|medium|large) \| (\d+)px \|/gm),
    [['small', '28'], ['medium', '32'], ['large', '40']]);
  const body = (sel) => ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
  assert.match(body('select'), /(?:^|;)\s*height:32px/, 'select is 32px');
  assert.match(body('input[type="text"]'), /(?:^|;)\s*height:32px/, 'a text input is 32px');
  assert.match(body('.select-sm'), /(?:^|;)\s*height:28px/, '.select-sm is 28px');
  assert.match(body('.input-sm'), /(?:^|;)\s*height:28px/, '.input-sm is 28px');
  assert.match(body('select'), /border-radius:var\(--r-sm\)/, 'a field has the 6px corner');
});

// A field's size is set once: rules whose last compound is a text input, number input or select may not set height
// or vertical padding, except the base rules and the listed debt (slices 2 and 3 empty it). A class counts only as a
// whole word (`.select`, not `.ins-select` or `.select-wrap`).
const isFieldCompound = (s) => {
  const lc = lastCompound(s);
  return /^(?:select|input\[type="(?:text|number)"\])(?![\w-])/.test(lc) || /\.(?:input|select)(?![\w-])/.test(lc);
};
const FIELD_BASE = ['.input', '.select', 'input[type="text"]', 'input[type="number"]', 'select', '.input-sm', '.select-sm', 'textarea.input'];
function fieldOverrides() {
  const out = new Set();
  for (const r of ALL) {
    const sels = splitTop(r.sel).filter((s) => isFieldCompound(s) && !FIELD_BASE.includes(s));
    if (!sels.length) continue;
    const sizes = decls(r.body, '(?:min-)?height|padding(?:-top|-bottom)?')
      .filter(([p, v]) => p.includes('height') ? !/^(?:auto|1px)$/.test(v) : !/^0(?:px)?(?:\s|$)/.test(v));
    if (sizes.length) for (const s of sels) out.add(s);
  }
  return [...out].sort();
}
test('fields: one 32px / 28px size; per-view size overrides only shrink (design-debt.json)', () => {
  assert.equal(isFieldCompound('.wm-filters .select'), true);
  assert.equal(isFieldCompound('.step-config select:focus'), true);
  assert.equal(isFieldCompound('.ins-select'), false);
  assert.equal(isFieldCompound('.select-wrap::after'), false);
  const found = fieldOverrides();
  // The divided-row control sets a width only, so it never enters the ratchet.
  assert.deepEqual(found.filter((s) => s.includes('.drow-control')), []);
  ratchet(found, DEBT.fieldSizeOverrides, 'field size override');
});

// A field that keeps the base 32px height has 30px inside its border: more than 7px of vertical padding leaves less
// than a 13px line of content, and the text is cut off. Only a rule that sets its own height may pad more.
const vPad = (v) => { const p = v.split(/\s+/).map((x) => parseFloat(x) || 0); return Math.max(p[0], p[2] ?? p[0]); };
function clippedFields() {
  const out = new Set();
  for (const r of ALL) {
    const sels = splitTop(r.sel).filter((s) => isFieldCompound(s) && !FIELD_BASE.includes(s));
    if (!sels.length || decls(r.body, '(?:min-)?height').length) continue;
    const pads = decls(r.body, 'padding(?:-top|-bottom)?').map(([p, v]) => (p === 'padding' ? vPad(v) : parseFloat(v) || 0));
    if (pads.some((n) => n > 7)) for (const s of sels) out.add(s);
  }
  return [...out].sort();
}
test('fields: no per-view rule pads a 32px field so far vertically that its text is cut off', () => {
  assert.equal(vPad('10px 36px 10px 13px'), 10);
  assert.equal(vPad('0 36px 0 13px'), 0);
  assert.equal(vPad('9px 12px'), 9);
  assert.equal(vPad('4px 8px 9px'), 9);
  assert.deepEqual(clippedFields(), []);
});

test('one filter chip: 28px, 6px corner, a quiet tinted selected state', () => {
  const chip = ALL.filter((r) => splitTop(r.sel).includes('.filter-chip')).map((r) => r.body).join(';');
  assert.match(chip, /height:28px/);
  assert.match(chip, /border-radius:var\(--r-sm\)/);
  // Every rule for a pressed chip, however its selector is written.
  // `.on` as a whole class only: `\b` would also match `.on-x` (a word boundary sits before the hyphen).
  const on = ALL.filter((r) => splitTop(r.sel).some((s) => /\.filter-chip(?![\w-])/.test(s) && /aria-pressed="true"|\.on(?![\w-])/.test(s)));
  assert.ok(on.length, 'a selected filter chip rule');
  const body = on.map((r) => r.body).join(';');
  assert.match(body, /background:var\(--field\)/);
  assert.match(body, /border-color:var\(--ink\)/);
  assert.doesNotMatch(body, /background(?:-color)?:var\(--ink\)/);
});

// Whole classes only: `.on\b` would also catch `.on-x`, `.active\b` `.active-tab`, `.btn\b` `.btn-row`.
const PRESSED = /\[aria-pressed="true"\]|\.(?:on|active)(?![\w-])/;
// The toggle's own fill only: the pressed state sits on the last compound, and a pseudo-element (a tab's underline,
// a switch knob) or a descendant (a radio's mark inside a pressed choice) is not the toggle.
const pressedFill = (s) => !/::?(?:before|after)(?![\w-])/.test(s) && PRESSED.test(lastCompound(s)) && !/\.(?:btn|nav)(?![\w-])/.test(s);
test('no pressed toggle goes solid ink outside the button (design-debt.json)', () => {
  assert.equal(PRESSED.test('.x-chip.on'), true);
  assert.equal(PRESSED.test('.x-chip.on-dark'), false);
  assert.equal(PRESSED.test('.tab.active-tab'), false);
  assert.equal(pressedFill('.x-chip.on'), true);
  assert.equal(pressedFill('.tab.on::after'), false);
  assert.equal(pressedFill('.af-choice.on .af-mark'), false);
  const found = ALL.flatMap((r) => splitTop(r.sel)
    .filter(pressedFill)
    .filter(() => /(?:^|;)\s*background(?:-color)?:var\(--ink\)/.test(r.body)));
  ratchet([...new Set(found)].sort(), DEBT.solidPressed, 'solid pressed toggle');
});

test('segmented: every .seg button is 28px; .seg-sm has no size of its own', () => {
  const sized = ALL.filter((r) => splitTop(r.sel).some((s) => /\.seg\b[^,]*\bbutton\b/.test(s)))
    .flatMap((r) => decls(r.body, 'height').map(([, v]) => where(r, v))).filter((w) => !w.endsWith('28px'));
  assert.deepEqual(sized, []);
  assert.deepEqual(ALL.filter((r) => /\.seg-sm\b/.test(r.sel)).map((r) => where(r, r.body.trim())), []);
});

test('one chip size: the grouped chip rule sets 18px and zero vertical padding', () => {
  const group = ALL.find((r) => r.sel.startsWith(':is(.badge,'));
  assert.match(group.body, /height:18px/);
  assert.match(group.body, /padding-top:0/);
  assert.match(group.body, /padding-bottom:0/);
});

test('headings: page title 22, sub-page 18, section 15, subsection 13; card h2 is the section size', () => {
  const body = (sel) => ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
  assert.match(body('.page-title'), /font:700 var\(--fs-page\)\/var\(--lh-title\)/);
  assert.match(body('.subpage-title'), /font:600 var\(--fs-subpage\)\/var\(--lh-title\)/);
  assert.match(body('.section-title'), /font:600 var\(--fs-section\)\/var\(--lh-title\)/);
  assert.match(body('.subsection-title'), /font:600 var\(--fs-body\)\/var\(--lh-body\)/);
  for (const s of ['.card h2', '.card-head h2']) {
    assert.match(body(s), /font-size:var\(--fs-section\)/, s);
    assert.match(body(s), /font-weight:600/, s);
  }
});

test('a table stacks per row in a narrow container (never scrolls sideways); the empty line is quiet', () => {
  assert.match(css, /@container dtable \(max-width:560px\)\{[\s\S]*?\.table,\.table tbody,\.table tr,\.table td\{display:block/);
  assert.match(css, /\.table-wrap\{container:dtable \/ inline-size;\}/);
  assert.match(css, /@container drows \(max-width:560px\)\{[\s\S]*?\.drow-control\{grid-column:1;/);
  const empty = ALL.filter((r) => splitTop(r.sel).includes('.empty-line')).map((r) => r.body).join(';');
  assert.match(empty, /color:var\(--ink-2\)/, 'the empty line is quiet');
});

test('Runs list: selected and Needs-you rows take the sidebar nav item\'s corner (--r-sm) and hide their own divider', () => {
  const nav = ALL.find((r) => r.sel === '.nav button');
  assert.match(nav.body, /border-radius:var\(--r-sm\)/);
  for (const sel of ['.runs-item.is-needs', '.runs-item:has(> a.runs-row.selected)']) {
    const body = ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
    assert.match(body, /border-radius:var\(--r-sm\)/, sel);
    assert.match(body, /border-bottom-color:transparent/, sel);
  }
});

test('Runs list: the selected row takes --row-selected, a translucent ink step that shows on the panel and on the Needs-you tint', () => {
  const root = ALL.find((r) => r.sel === ':root').body;
  assert.match(root, /--row-selected:color-mix\(in srgb,var\(--ink\) \d+%,transparent\);/, 'no new hue: a translucent --ink mix');
  assert.match(root, /--row-open:color-mix\(in srgb,var\(--row-selected\) 50%,transparent\);/, 'the open-group fill stays a step lighter');
  const selected = ALL.filter((r) => splitTop(r.sel).includes('.runs-item:has(> a.runs-row.selected)')).map((r) => r.body).join(';');
  assert.match(selected, /background:var\(--row-selected\)/);
  assert.doesNotMatch(selected, /var\(--field\)/);
});

test('Runs list: PR chips on the selected row take the -ink-strong shades, so they stay at 4.5:1 on --row-selected', () => {
  const bodyOf = (sel) => ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
  const on = '.runs-item:has(> a.runs-row.selected) ';
  assert.match(bodyOf(`${on}.runs-pr.is-ready`), /color:var\(--green-ink-strong\)/);
  assert.match(bodyOf(`${on}.runs-pr.is-changes`), /color:var\(--amber-ink-strong\)/);
  for (const tone of ['is-closed', 'is-conflicts', 'is-failing']) {
    assert.match(bodyOf(`${on}.runs-pr.${tone}`), /color:var\(--red-ink-strong\)/, tone);
  }
});

test('Runs list: one highlight at a time — a group whose run is open is filled only while collapsed; members have no dividers', () => {
  const bodyOf = (sel) => ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
  const collapsed = bodyOf('.runs-item:has(> a.runs-row.member-open):not(:has(> .runs-members))');
  assert.match(collapsed, /background:var\(--row-open\)/, 'one fill on the whole item');
  assert.match(collapsed, /border-radius:var\(--r-sm\)/);
  assert.match(collapsed, /border-bottom-color:transparent/);
  // No per-cell fill (the 36px cells notched it) and no ungated member-open rule (expanded keeps its divider, no fill).
  const memberOpen = ALL.filter((r) => r.sel.includes('.runs-item') && r.sel.includes('member-open'));
  assert.deepEqual(memberOpen.map((r) => r.sel), ['.runs-item:has(> a.runs-row.member-open):not(:has(> .runs-members))']);
  // Rows inside a group draw no dividers; top-level rows keep theirs.
  assert.doesNotMatch(bodyOf('.runs-members'), /border-top/);
  assert.match(bodyOf('.runs-members > .runs-item'), /border-bottom:0/);
  assert.equal(ALL.some((r) => splitTop(r.sel).includes('.runs-members > .runs-item:last-child')), false);
  assert.match(ALL.find((r) => r.sel === '.runs-item').body, /border-bottom:1px solid var\(--line\)/);
});

test('a script-focused control shows no ring for a pointer user; fields keep their focus border', () => {
  const r = ALL.find((x) => x.sel.startsWith(':root[data-input="pointer"] :is(button,'));
  assert.ok(r, 'the pointer suppressor covers every button, link, summary, tab, switch and [tabindex]');
  assert.match(r.body, /outline:none/);
  for (const k of ['button', 'a', 'summary', '[role="tab"]', '[role="switch"]', '[tabindex]']) assert.ok(r.sel.includes(k), k);
  assert.doesNotMatch(r.sel.replace('[data-input="pointer"]', ''), /input|textarea|select/);   // the attribute is named data-input
});

test('focus rings: no :focus rule (without -visible) draws an outline ring', () => {
  const bad = ALL.filter((x) => /:focus(?![-\w])/.test(x.sel))
    .flatMap((x) => decls(x.body, 'outline').filter(([, v]) => !/^(?:none|0)$/.test(v)).map(([, v]) => where(x, v)));
  assert.deepEqual(bad, []);
});

// The same pattern as the button audit's typed-plus rule: "+" then a capitalised word ("+ Add", "+ Case", "+ Override").
// "+N more" counters do not match (an uppercase letter followed by a space, not a lowercase letter).
const TYPED_PLUS = /['"`>]\+ ?[A-Z][a-z]/;
test('no typed "+" as an icon in a label (design-debt.json)', () => {
  assert.equal(TYPED_PLUS.test("button(doc, 'btn btn-sm', '+ Add server')"), true);
  assert.equal(TYPED_PLUS.test("chip.textContent = '+3 more'"), false);
  assert.equal(TYPED_PLUS.test('`+N more`'), false);
  const hits = scan(TYPED_PLUS, FILES.filter((f) => !f.endsWith('.html'))).map((h) => h.split(':')[0]);
  ratchet([...new Set(hits)].sort(), DEBT.typedPlus, 'typed "+" label');
});

// D19-D23: the type scale. A px size in font-size or the font shorthand must be a step. var(--fs-…), em and the
// graph's calc(… * var(--gv-scale)) are not px literals and pass. 32px belongs to the Chat home hero alone.
const TYPE_SCALE = [11, 12, 13, 15, 18, 22];
const HERO = '.chat-home-title';
const pxOf = (p, v) => (p === 'font-size' ? v.match(/^([\d.]+)px$/) : v.match(/(?:^|\s)([\d.]+)px(?=[\s/])/))?.[1];
function offScale() {
  const out = new Set();
  for (const r of ALL) for (const [p, v] of decls(r.body, 'font-size|font')) {
    const px = pxOf(p, v);
    if (px === undefined || TYPE_SCALE.includes(Number(px))) continue;
    for (const s of splitTop(r.sel)) if (!(px === '32' && s === HERO)) out.add(`${s} → ${px}px`);
  }
  return [...out].sort();
}
// D20: what slice 1 moves onto the scale. Shared rules by exact selector, the shell and the screens by class prefix.
// When the browser type audit (8c) finds an off-scale text on a slice-1 state that these miss, add its prefix here.
const SHARED_TYPE = ['body', 'button', '.topbar .sub', '.pill-status', '.pill-run', '.card h2', '.card-head h2', '.input', '.select',
  '.textarea', '.ta-hl-back', 'input[type="text"]', 'input[type="number"]', 'input[type="file"]', 'textarea', 'select', '.input-sm',
  '.select-sm', '.btn-sm', '.btn-lg', '.file .state', '.extra-pill-x', '.mention-item', '.form-msg', '.toast .tt',
  '.field-error', '.card-alert .ca-title', '.dirty-mark', '.field-compact .hint', '.check-row', '.opt-row', '.opt-row .opt-sub',
  '.confirm-field > label', '.confirm-field .input', '.confirm-checkbox', '.stat-value', '.stat-frac', '.stat-sub'];
const SLICE1_TYPE = new RegExp('(?:^|[\\s(,>+~])(?:' + [
  '\\.topnav', '\\.tsearch', '\\.activity-', '\\.nav(?![\\w-])', '\\.nav-', '\\.sidebar', '\\.side-', '\\.user ', '\\.acct',   // shell
  '\\.runs-', '\\.rd-', '\\.hd-', '\\.rg-', '\\.cost-pop', '\\.cost-bd-', '\\.artifact-', '\\.log(?![\\w-])',                  // Runs list, run page
  '\\.run-log-head', '\\.run-warn', '\\.label-(?:chip|more)',
  '\\.q(?:panel|text|opt|free|block|answered|tune)', '\\.af-', '\\.issue-',
  '\\.wf-pop-', '\\.wf-preview-hint', '\\.agent-type-pill', '\\.sub-model-pill', '\\.skill-pill', '\\.graphify-pill',
  '\\.gpage', '\\.feature-page', '\\.shape-', '\\.run-member', '\\.run-status', '\\.chat-rc-shaped', '\\.ask-mcard-',          // group, feature
  '\\.ask-shipcard-', '\\.plan-(?:body|meta|check-ok|tag|ground)', '\\.outline-est', '\\.ask-rp-shape-what', '\\.ask-md a\\.ask-ref-chip',
  '\\.chat-home', '\\.chat-run-tile', '\\.ask-composer', '\\.chat-head',                                                                       // Chat home
  '\\.agents-wf', '\\.agent-(?:mod|origin|row)', '\\.wf-engine-hints', '\\.step-(?:config|current)', '\\.branches-', '\\.bt-',   // New run
  '\\.sp-', '\\.pl-profile-bar', '\\.src-badge', '\\.btn-split-menu',
].join('|') + ')');
const inSlice1 = (entry) => { const s = entry.split(' → ')[0]; return SHARED_TYPE.includes(s) || SLICE1_TYPE.test(s); };

test('type: pxOf reads font-size and the font shorthand; relative sizes are not px literals; the slice-1 scope', () => {
  assert.equal(pxOf('font-size', '12.5px'), '12.5');
  assert.equal(pxOf('font', '600 9.5px/1 var(--mono)'), '9.5');
  assert.equal(pxOf('font', '13.5px/20px var(--sans)'), '13.5');
  assert.equal(pxOf('font', '700 var(--fs-page)/var(--lh-title) var(--sans)'), undefined);
  assert.equal(pxOf('font-size', 'max(9px,calc(11.5px * var(--gv-scale)))'), undefined);
  assert.equal(pxOf('font', '800 calc(12px * var(--gv-scale))/calc(21px * var(--gv-scale)) var(--sans)'), undefined);
  assert.equal(pxOf('font-size', '.92em'), undefined);
  assert.equal(inSlice1('.rd-srow → 14px'), true);
  assert.equal(inSlice1('.sidebar.collapsed .nav-count → 9.5px'), true);
  assert.equal(inSlice1('.btn-sm → 12.5px'), true);
  assert.equal(inSlice1('.wfl-name → 14px'), false);
  assert.equal(inSlice1('.log-filters .log-f → 12.5px'), false);
  assert.equal(inSlice1('.run-flow .node .fan .fl → 9.5px'), false);
});

test('type: the guide\'s Type table is the :root --fs-* set; titles 1.25, the rest 1.5; body is 13 / 1.5', () => {
  const g = readFileSync(GUIDE, 'utf8');
  const rows = [...g.matchAll(/^\| `(--fs-[a-z]+)` \| (\d+)px \| ([\d.]+) \|/gm)].map((m) => [m[1], Number(m[2]), m[3]]);
  assert.deepEqual(rows.map(([, px]) => px), [11, 12, 13, 15, 18, 22, 22, 32]);
  const root = ALL.find((r) => r.sel === ':root').body;
  for (const [tok, px, lh] of rows) {
    assert.match(root, new RegExp(`${tok}:${px}px;`), `${tok} is ${px}px in style.css`);
    assert.equal(lh, px <= 13 ? '1.5' : '1.25', `${tok} line height in the guide`);
  }
  assert.match(root, /--lh-body:1\.5;/);
  assert.match(root, /--lh-title:1\.25;/);
  const own = ALL.flatMap((r) => decls(r.body, '--fs-[\\w-]+').map(([p]) => p)).filter((p) => !rows.some(([t]) => t === p));
  assert.deepEqual(own, [], 'no --fs-* token outside the guide');
  const body = ALL.filter((r) => r.sel === 'body').map((r) => r.body).join(';');
  assert.match(body, /font-size:var\(--fs-body\)/);
  assert.match(body, /line-height:var\(--lh-body\)/);
  assert.match(ALL.filter((r) => r.sel === 'button').map((r) => r.body).join(';'), /font:inherit/, 'a bare button takes its parent\'s step');
});

test('type: every px size in style.css is a step, 32px only on the Chat home hero (design-debt.json typeScale)', () => {
  ratchet(offScale(), DEBT.typeScale, 'off-scale font size');
});

test('type: no listed off-scale size is on the shell, a shared component or a slice-1 screen', () => {
  assert.deepEqual(DEBT.typeScale.filter(inSlice1), []);
});

test('type: stat values 22, the page title 22, the Chat home hero 32 (22 under 760px)', () => {
  const body = (sel) => ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
  assert.match(body('.stat-value'), /font-size:var\(--fs-stat\)/);
  assert.match(body('.rd-page-title'), /font:700 var\(--fs-page\)\/var\(--lh-title\)/);
  assert.match(body('.chat-home-title'), /font:600 var\(--fs-hero\)\/var\(--lh-title\)/);
  assert.match(css, /@media \(max-width:760px\)\{\.chat-home-title\{font-size:var\(--fs-page\);/);
});

// D24: chart text is drawn as SVG 'font-size' attributes; slice 2 moves the three chart files onto the scale.
const SVG_TYPE = /'font-size':\s*(?!(?:11|12|13|15|18|22)(?![\d.]))[\d.]+/;
test('charts: the guide sets their heights and text steps; off-scale SVG text sizes only shrink (design-debt.json svgTypeScale)', () => {
  assert.equal(SVG_TYPE.test("'font-size': 10.5,"), true);
  assert.equal(SVG_TYPE.test("'font-size': 11.5,"), true);
  assert.equal(SVG_TYPE.test("'font-size': 11,"), false);
  const g = readFileSync(GUIDE, 'utf8');
  const at = g.indexOf('\n### Charts\n');
  assert.ok(at > 0, 'Components › Charts');
  const charts = g.slice(at, g.indexOf('\n### ', at + 1));
  assert.match(charts, /Cost and value chart about 260px/);
  assert.match(charts, /overview\s+charts \(Statistics, Team metrics\) about 180px/);
  assert.match(charts, /Axis labels are 11px/);
  assert.match(charts, /legends 12px/);
  ratchet([...new Set(scan(SVG_TYPE).map((h) => h.split(':')[0]))].sort(), DEBT.svgTypeScale, 'off-scale SVG font size');
});

// F-8: a typed uppercase kicker is a string literal of capitals set as visible text.
const STATE_CODES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPEN', 'MERGED', 'CLOSED', 'UNKNOWN', 'UNAVAILABLE', 'FAILED', 'DRAFT',
  'BUTTON', 'SELECT', 'SPAN', 'MERGEABLE', 'CONFLICTING', 'PENDING', 'NONE'];
const KICKER = new RegExp(`(['"\`])(?!(?:${STATE_CODES.join('|')})\\1)[A-Z][A-Z0-9 ·&/-]{2,}[A-Z0-9]\\1`);
const KICKER_FILES = ['ui/public/app.js', 'ui/public/team-metrics-view.mjs'].map((f) => join(ROOT, f));
test('no typed uppercase kicker in app.js or team-metrics-view.mjs (F-8, spec §1.3)', () => {
  assert.equal(KICKER.test("l.textContent = 'FILES CHANGED';"), true);
  assert.equal(KICKER.test("method: 'GET'"), false);
  // Raw lines, not code(): app.js holds a string with `/*` that code() reads as a block comment, hiding ~1300 lines.
  const hits = KICKER_FILES.flatMap((f) => readFileSync(f, 'utf8').split('\n')
    .flatMap((l, i) => (KICKER.test(l) && !/^\s*(?:\/\/|\*|\/\*)/.test(l) ? [`${rel(f)}:${i + 1}: ${l.trim().slice(0, 120)}`] : [])));
  assert.deepEqual(hits, []);
});

// F-12: a visible string that starts or ends with a glyph. `// glyph-ok` on the line keeps one (tool output, ANSI).
const EDGE_GLYPH = /['"`]\s*[✓✕✗▾▸⋯↻]\s|\s[✓✕✗▾▸⋯↻]\s*['"`]/;
test('no glyph at the edge of a visible string; use icon(doc, …) (F-12)', () => {
  assert.equal(EDGE_GLYPH.test("'✓ Saved'"), true);
  assert.equal(EDGE_GLYPH.test("'in catalog ✓'"), true);
  assert.equal(EDGE_GLYPH.test("'a ✓ b'"), false);
  const raw = FILES.filter((f) => /\.m?js$/.test(f)).flatMap((f) => readFileSync(f, 'utf8').split('\n')
    .map((l, i) => [`${rel(f)}:${i + 1}: ${l.trim().slice(0, 120)}`, l]).filter(([, l]) => EDGE_GLYPH.test(l) && !/\/\/ glyph-ok/.test(l) && !/^\s*(?:\/\/|\*|\/\*)/.test(l)));
  assert.deepEqual(raw.map(([h]) => h), []);
});

// F-13: violet is Labs-only (docs/design-system.md colour table). The merged status dot and the merged run orb are the
// two named exceptions (slice 1 shipped them as the shipped-state colour), plus the Smart run naming Labs chip and shimmer, and the
// Marketplace kind colours give the chat kind its violet tile and facet dot (docs/design-system.md › Marketplace exceptions). Exact selectors, no substring match.
const VIOLET_OK = new Set(['.badge.flag-stage-experimental', '.status-dot.is-violet', '.rg-orb-merged .rg-orb-bg', '.rg-orb-merged .rg-orb-line',
  '.sn-chip', '.sn-adorn.sn-loading .input', '.mk-t-chat', '.mk-dot-chat', '.rd-route-dot.is-merged',
  '.rd-fact-tx.is-merged']);
test('violet only inside Labs selectors and the merged dot and orb (F-13)', () => {
  const bad = ALL.filter((r) => r.sel !== ':root' && /var\(--violet/.test(r.body) && !splitTop(r.sel).every((s) => VIOLET_OK.has(s.trim())))
    .map((r) => where(r, 'violet'));
  assert.deepEqual(bad, []);
  assert.equal(VIOLET_OK.has('.rg-orb-merged-foo'), false);
  const js = scan(/\b(?:badge|pill-run) violet\b|\bn-violet\b|tone: 'violet'|var\(--violet/, FILES.filter((f) => /\.m?js$/.test(f)));
  assert.deepEqual(js, []);
});

test('type: no px size outside 11/12/13/15/18/22 in style.css or the chart SVG text (F-14)', () => {
  assert.deepEqual(offScale(), []);
  assert.deepEqual(DEBT.typeScale, []);
  assert.deepEqual(DEBT.svgTypeScale, []);
  assert.deepEqual(DEBT.typedPlus, []);
});

test('a project card sync bar is not a bordered block (F-16)', () => {
  const r = ALL.filter((x) => splitTop(x.sel).includes('.proj-sync'));
  assert.ok(r.length);
  for (const x of r) assert.deepEqual(decls(x.body, 'border|border-radius|border-style|background'), [], where(x, 'box'));
});

test('slice 3 (D18): the run page tiles read in the stat face, 22px sans with tabular figures', () => {
  const r = ALL.filter((x) => splitTop(x.sel).map((t) => t.trim()).includes('.rd-stats b'));
  assert.ok(r.length);
  const body = r.map((x) => x.body).join(';');
  assert.match(body, /var\(--fs-stat\)/);
  assert.match(body, /var\(--sans\)/);
  assert.match(body, /tabular-nums/);
  const tile = ALL.filter((x) => splitTop(x.sel).map((t) => t.trim()).includes('.rd-stats > div')).map((x) => x.body).join(';');
  assert.match(tile, /padding:var\(--pad-tile\) 8px/);
});
