// test/ui-shared-controls.test.mjs
// Run 1 of the shared-controls bundle: one switch, the on/off rule, one menu, colour meanings, one chip, card
// padding, headings, fields and focus (docs/design-system.md › Foundations, › Components).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Comments blanked, newlines kept (the same parser as test/ui-design-language.test.mjs).
const css = read('ui/public/style.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
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
function splitTop(v) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of v) {
    if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const ALL = rules(css);
const ROOT_RULE = ALL.find((r) => r.sel === ':root');            // the first :root is the token block
const decls = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*(${prop})\\s*:\\s*([^;]+)`, 'g'))].map((m) => [m[1], m[2].trim()]);
const where = (r, v) => `style.css:${r.line} ${r.sel.slice(0, 80)} → ${v}`;
const bodyOf = (sel) => ALL.filter((r) => splitTop(r.sel).includes(sel)).map((r) => r.body).join(';');
const lastCompound = (s) => s.split(/\s*[>+~]\s*|\s+/).at(-1);
const SKIP = new Set(['node_modules', 'vendor', 'fonts', 'assets']);
const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { if (SKIP.has(n)) continue; const f = join(dir, n);
  if (statSync(f).isDirectory()) walk(f, out); else if (/\.(mjs|js)$/.test(n)) out.push(f); } return out; };
const JS = walk(join(ROOT, 'ui/public'));
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).split('\n')
  .map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');
const index = new JSDOM(read('ui/public/index.html')).window.document;

test('colour: the guide has the one meaning table with the status-dot exceptions', () => {
  const g = read('docs/design-system.md');
  for (const row of ['| ink |', '| green |', '| amber |', '| red |', '| blue |', '| violet |', '| slate |']) assert.ok(g.includes(row), row);
  assert.match(g, /Status-dot exceptions: peach = working \(it pulses\), violet = merged\./);
  assert.match(g, /violet \| `--violet\*` \| Labs only/);
});

test('colour: no hex, rgb() or hsl() literal outside the token :root (data-URI images aside)', () => {
  const LIT = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
  const bad = ALL.filter((r) => r !== ROOT_RULE).flatMap((r) => r.body.replace(/url\([^)]*\)/g, '').split(';')
    .filter((d) => LIT.test(d)).map((d) => where(r, d.trim().slice(0, 60))));
  assert.deepEqual(bad, []);
});

// A recipe that reads a per-element value (a local --c, currentColor) cannot be a root token; every other
// recipe appears at most once outside the token block.
test('colour: a color-mix() recipe used twice is a named token', () => {
  const seen = new Map();
  for (const r of ALL.filter((x) => x !== ROOT_RULE)) {
    for (const m of r.body.matchAll(/color-mix\((?:[^()]|\([^()]*\))*\)/g)) {
      const k = m[0].replace(/\s+/g, '');
      if (/var\(--c\)|currentColor/i.test(k)) continue;
      seen.set(k, [...(seen.get(k) || []), r.line]);
    }
  }
  assert.deepEqual([...seen].filter(([, lines]) => lines.length > 1).map(([k, l]) => `${k} @ ${l.join(',')}`), []);
  for (const t of ['--btn-hover', '--quiet-hover', '--danger-hover', '--amber-ring', '--red-ring', '--red-tint', '--blue-glow',
    '--blue-glow-strong', '--blue-ring', '--blue-clear', '--blue-sheen', '--panel-veil', '--red-ink-soft']) {
    assert.match(ROOT_RULE.body, new RegExp(`${t}:color-mix\\(`), `${t} is a token`);
  }
});

test('spacing: one card padding and one tile padding token', () => {
  assert.match(ROOT_RULE.body, /--pad-card:24px;/);
  assert.match(ROOT_RULE.body, /--pad-tile:16px;/);
  assert.match(bodyOf('.card'), /padding:var\(--pad-card\)/);
});

const REMOVED_SWITCHES = ['switch-sm', 'ask-rp-sw', 'ask-rp-knob'];
const classRe = (c) => new RegExp(`(?<![\\w-])${c}(?![\\w-])`);
test('one switch: no other switch skin is defined or emitted in ui/public', () => {
  const files = [...JS, join(ROOT, 'ui/public/style.css'), join(ROOT, 'ui/public/index.html')];
  const hits = [];
  for (const f of files) code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => {
    for (const c of REMOVED_SWITCHES) if (classRe(c).test(l)) hits.push(`${c} — ${rel(f)}:${i + 1}`);
    if (/\.wz \.tog\b|'tog(?:\s|')/.test(l)) hits.push(`wz tog — ${rel(f)}:${i + 1}`);
  });
  assert.deepEqual(hits, []);
});

test('one switch: ink when on, a muted track and a visible knob when disabled, never an opacity fade', () => {
  assert.match(bodyOf('.switch'), /background:var\(--switch-off\)/);
  const on = ALL.find((r) => r.sel.startsWith(':is(.switch.on,') && !r.sel.includes('::after') && !r.sel.includes('disabled'));
  assert.ok(on, 'the on rule'); assert.match(on.body, /background:var\(--switch-on\)/);
  const knobOn = ALL.find((r) => r.sel.startsWith(':is(.switch.on,') && r.sel.endsWith('::after') && !r.sel.includes('disabled'));
  assert.match(knobOn.body, /left:16px;background:var\(--switch-knob-on\)/);
  const off = ALL.find((r) => r.sel.startsWith(':is(.switch.disabled,') && !r.sel.endsWith('::after'));
  assert.match(off.body, /background:var\(--switch-off-locked\)/);
  assert.match(off.body, /box-shadow:inset 0 0 0 1px var\(--line-2\)/);
  const opacity = ALL.filter((r) => splitTop(r.sel).some((s) => /\.switch(?![\w-])/.test(s)))
    .flatMap((r) => decls(r.body, 'opacity').map(([, v]) => where(r, v)));
  assert.deepEqual(opacity, []);
  assert.deepEqual(ALL.filter((r) => /\.switch/.test(r.sel) && /--green/.test(r.body)).map((r) => where(r, 'green')), []);
});

// D4: a checkbox only picks items from a list, is an opt-out / opt-in next to a field, or is a one-time consent.
// Every other on/off control is the switch. Each allowed checkbox names why.
const INDEX_CHECKBOX_OK = {
  'runs-all': 'picks: select every run',
  'wiz-select-all': 'picks: select every project',
  'askNoCap': 'opt-out next to a field: No cap',
  'confirm-checkbox': 'consent inside a confirm',
  'engineAllowUnguarded': 'consent, one attempt',
  'mock': 'hidden mirror of the #mock-switch role="switch"',
};
test('on/off rule: every checkbox in index.html is a switch or an allowed picker, opt-out or consent', () => {
  const bad = [...index.querySelectorAll('input[type="checkbox"]')]
    .filter((i) => !i.classList.contains('sw-input') && !INDEX_CHECKBOX_OK[i.id])
    .map((i) => i.id || i.className || i.outerHTML.slice(0, 60));
  assert.deepEqual(bad, []);
});

// JS emitters: a statement that makes a checkbox must be a switch (sw-input / makeSwitch within 2 lines) or carry the
// literal class/id token of a listed picker. [file, token, reason]; the token is the string on the emitting statement.
// The tokens were resolved against the emitters (label-picker `lp-check`, mcp-run-picker's `box` factory,
// report-run `confirm-checkbox`, actions-view `act-member`, widgets-input's multi-choice list). `ask-markdown.mjs`
// only sanitises rendered task lists and emits no checkbox, so it has no entry.
const JS_CHECKBOX_OK = [
  ['runs-list.mjs', 'runs-check', 'picks runs'], ['label-picker.mjs', 'lp-check', 'picks labels'], ['mcp-run-picker.mjs', 'const box = (checked, keys, kind)', 'picks MCP sets'],
  ['models-view.mjs', 'mv-effort-cb', 'picks efforts'], ['models-view.mjs', 'mvx-model-cb', 'picks models'], ['bridge-view.mjs', 'mvi-cb', 'picks items'], ['bridge-view.mjs', 'mvi-all', 'picks: select every importable model'],
  ['bridge-view.mjs', 'mvi-chip', 'opt-in filters next to the list'], ['bridge-view.mjs', 'mv-conn-cap-cb', 'opt-out next to a field'],
  ['night-mode-form.mjs', 'offBox', 'No away hours opt-out'], ['night-mode-form.mjs', 'night-never', 'Never opt-out'],
  ['team-policy-view.mjs', 'tp-null', 'No cap opt-out'], ['team-policy-view.mjs', 'tp-cat-effort', 'picks efforts'],
  ['schedule-sheet.mjs', 'sched-between', 'Only between opt-in'], ['report-run.mjs', 'input.dataset.optin', 'consent rows: what the report may include'],
  ['actions-view.mjs', 'act-member', 'picks projects'], ['actions-config-view.mjs', 'ac-builtin', 'picks built-ins'],
  ['script-bench-view.mjs', 'expect:fired', 'picks expectations'], ['ask/widgets-input.mjs', "multi ? 'checkbox'", 'a question\'s multi-choice list'], ['app.js', 'folder-pick', 'picks folders'],
  ['app.js', 'wiz-proj-cb', 'picks projects'], ['app.js', 'wiz-import-cb', 'picks imports'], ['app.js', 'wd-add-row', 'picks rows'],
  ['app.js', 'pb-include', 'picks items'], ['app.js', 'shipit-repo-pick', 'picks repos'], ['app.js', 'publish-pick', 'picks items'],
  ['app.js', 'cb.value = opt', 'picks chips'],
  ['marketplace/browse.mjs', 'mk-hide-installed', 'Hide installed: an opt-in filter next to the list'],
  ['marketplace/remove-view.mjs', 'mk-purge-box', 'opt-in consent in the Remove dialog'],
  ['marketplace/update-view.mjs', 'mk-reviewed', 'acknowledges the reviewed changes'], ['marketplace/update-view.mjs', 'mk-include', 'picks updates'],
].map(([file, token, reason]) => ({ file: `ui/public/${file}`, token, reason }));
function checkboxEmitters(files) {
  const out = [];
  for (const f of files) {
    const lines = code(readFileSync(f, 'utf8')).split('\n');
    const toks = JS_CHECKBOX_OK.filter((e) => e.file === rel(f)).map((e) => e.token);
    lines.forEach((l, i) => {
      if (!/(?<!\[)type\s*[=:]\s*['"]checkbox['"]|'input',\s*'checkbox'|(?<!\[)type="checkbox"/.test(l)) return;   // an attribute selector reads a checkbox, it does not make one
      const stmt = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
      if (/sw-input|makeSwitch/.test(stmt) || toks.some((t) => stmt.includes(t))) return;
      out.push(`${rel(f)}:${i + 1}`);
    });
  }
  return out;
}
test('on/off rule: every JS checkbox emitter is a switch or carries a listed picker token', () => {
  assert.deepEqual(checkboxEmitters(JS), [], 'a new checkbox: make it a switch or list its token with a reason');
});
test('on/off rule: every listed picker token still appears in its file', () => {
  const stale = JS_CHECKBOX_OK.filter((e) => !readFileSync(join(ROOT, e.file), 'utf8').includes(e.token)).map((e) => `${e.file}: ${e.token}`);
  assert.deepEqual(stale, []);
});

// The interface-mode cards tint their icon per level (Simple green, Advanced blue, Expert violet): an illustration
// of the chosen card, not a checked control; left for the later colour pass (plan › Out of scope).
test('checkbox ink: no checked, indeterminate or on control is filled green', () => {
  const bad = ALL.filter((r) => /:checked|:indeterminate|\.on(?![\w-])|aria-checked="true"/.test(r.sel) && !/\.lv-card-icon/.test(r.sel)
    && /var\(--green(?:-bg)?\)/.test(r.body))
    .map((r) => where(r, 'green'));
  assert.deepEqual(bad, []);
  assert.match(bodyOf('input[type="checkbox"]:checked'), /background-color:var\(--ink\)/);
  assert.match(bodyOf('input[type="radio"]:checked'), /background:var\(--ink\)/);
  assert.ok(ALL.some((r) => r.sel === ':root' && /accent-color:var\(--ink\)/.test(r.body)), 'the accent net is ink');
});

const CONTROL_LABELS = ['.check-row', '.check', '.radio', '.switch-label', '.drow-label', '.pl-enable', '.qtune-sw-t',
  '.confirm-checkbox', '.af-switch-txt', '.tl-toggle', '.ins-tog-t', '.wz-routing', '.wiz-select-all', '.wiz-import-deep', '.mv-conn-cap'];
const HELP = ['.drow-help', '.switch-why', '.ins-tog-h', '.ac-builtin-note', '.flag-row-lock'];
test('control labels are --fs-body, their help --fs-meta, and no label is mono', () => {
  for (const s of CONTROL_LABELS) {
    const b = bodyOf(s);
    const sizes = [...decls(b, 'font-size'), ...decls(b, 'font')].map(([, v]) => v);
    assert.ok(sizes.length && sizes.every((v) => v.includes('var(--fs-body)')), `${s} → ${sizes.join(' | ') || 'no size'}`);
    assert.doesNotMatch(b, /var\(--mono\)/, `${s} is sans`);
  }
  for (const s of HELP) assert.match(bodyOf(s), /font-size:var\(--fs-meta\)/, s);
});

test('one menu: the .menu box and .menu-item rows', () => {
  const box = bodyOf('.menu');
  assert.match(box, /border-radius:var\(--r-md\)/);
  assert.match(box, /box-shadow:var\(--shadow-menu\)/);
  assert.match(box, /font-size:var\(--fs-body\)/);
  const item = bodyOf('.menu-item');
  assert.match(item, /min-height:30px/);
  assert.match(item, /border-radius:var\(--r-sm\)/);
  const raw = read('ui/public/style.css');   // the markers are comments, which `css` blanks
  assert.ok(raw.indexOf('\n.menu{') > raw.indexOf('/* ---------- buttons ---------- */')
    && raw.indexOf('\n.menu{') < raw.indexOf('/* ===================== Action feedback'), 'in the buttons section, which the extension cuts');
});

// The containers only: .ask-pop-divider, -caption and the other inner parts are not boxes.
const MENU_BOX = /^(?:\.nav-fly(?:\.acct-menu|\.lvl-menu|\.act-fly)?|\.ask-pop(?:-(?:scope|model|mcp|ctx|chip|at|voice))?|\.btn-split-menu|\.wfv-menu)$/;
const MENU_ROW = /^(?:\.wfv-menu-item|\.ask-pop-item|\.btn-split-menu button|\.nav \.nav-fly button)$/;
test('one menu: the five families keep position and size only, no skin of their own', () => {
  const bad = [];
  for (const r of ALL) for (const s of splitTop(r.sel)) {
    if (/:hover|:focus|:disabled/.test(s)) continue;
    if (MENU_BOX.test(s)) for (const [p, v] of decls(r.body, 'border-radius|box-shadow|background(?:-color)?|border')) bad.push(where(r, `${p}:${v}`));
    if (MENU_ROW.test(s)) for (const [p, v] of decls(r.body, 'border-radius|background(?:-color)?|(?:min-)?height|font-size|font')) bad.push(where(r, `${p}:${v}`));
  }
  assert.deepEqual(bad, []);
});

test('one menu: the 6 role="menu" boxes in index.html are .menu and their menu items are .menu-item', () => {
  // The run, history and project pages live in <template>s, whose content querySelectorAll does not enter.
  const inTemplates = (root) => [root, ...[...root.querySelectorAll('template')].flatMap((t) => inTemplates(t.content))];
  const menus = inTemplates(index).flatMap((r) => [...r.querySelectorAll('[role="menu"]')]);
  assert.equal(menus.length, 6);   // 3 .nav-fly, 3 .btn-split-menu
  assert.deepEqual(menus.filter((m) => !m.classList.contains('menu')).map((m) => m.id || m.className), []);
  // Segmented rows inside the account menu (the theme icons) are not menu rows.
  assert.deepEqual(menus.flatMap((m) => [...m.querySelectorAll('button[role^="menuitem"], [role="menu"] > button')])
    .filter((b) => !b.matches('.menu-item, .btn, .seg button, .theme-ic')).map((b) => b.className || b.textContent.trim().slice(0, 30)), []);
});

// An emitter is a class assignment (className =, classList.add, make(…), h(…)); the class string that names a menu
// family names .menu (a box) or .menu-item (a row) too. Selector strings start with "." and never count.
const EMIT = /className\s*=|classList\.add\(|\bmake\(|\bh\(|createElement\(/;
const FAMILY = /['"`]([^'"`\n.]*(?<![\w-])(nav-fly|ask-pop|btn-split-menu|wfv-menu|wfv-menu-item|ask-pop-item)(?![\w-])[^'"`\n]*)['"`]/;
test('one menu: every JS emitter of a menu family adds .menu / .menu-item', () => {
  const bad = [];
  for (const f of JS) code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => {
    const m = EMIT.test(l) && l.match(FAMILY);
    if (!m) return;
    const want = /item$/.test(m[2]) ? /(?<![\w-])menu-item(?![\w-])/ : /(?<![\w-])menu(?![\w-])/;
    if (!want.test(m[1])) bad.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  assert.deepEqual(bad, []);
});

test('one menu: openMenu emits .menu / .menu-item and marks a danger item .is-danger', async () => {
  const { openMenu, closeMenus } = await import('../ui/public/workflows/menu.mjs');
  const doc = new JSDOM('<!doctype html><body><button id="a">⋯</button></body>').window.document;
  const m = openMenu({ doc, anchor: doc.getElementById('a'), items: [{ header: 'Run' }, { label: 'Report' }, { sep: true }, { label: 'Archive', danger: true }] });
  assert.ok(m.el.matches('.menu.wfv-menu'));
  assert.ok(m.el.querySelector('.menu-h') && m.el.querySelector('.menu-sep'));
  const [report, archive] = m.el.querySelectorAll('.menu-item.wfv-menu-item');
  assert.equal(report.classList.contains('is-danger'), false);
  assert.equal(archive.classList.contains('is-danger'), true);
  closeMenus();
});

test('badges: Official and policy are slate, "not installed" is never amber', () => {
  assert.match(bodyOf('.badge.slate'), /background:var\(--slate-bg\);color:var\(--slate-ink\)/);
  const src = (p) => code(read(p));
  assert.match(bodyOf('.badge.mk-chip-built'), /background:var\(--slate-bg\)/);   // the Marketplace's Built-in chip
  assert.match(src('ui/public/marketplace/marketplaces-view.mjs'), /chip\(doc, 'built', 'Built-in'\)/);
  for (const p of ['ui/public/team-policy-view.mjs', 'ui/public/models-view.mjs', 'ui/public/guardrails-view.mjs']) {
    const lines = src(p).split('\n').filter((l) => /['"`](?:team )?policy['"`]/i.test(l) && /badge/.test(l));
    assert.ok(lines.length, `${p} has a policy badge`);
    for (const l of lines) assert.match(l, /badge slate/, `${p}: ${l.trim().slice(0, 80)}`);
  }
  const notInstalled = JS.flatMap((f) => code(readFileSync(f, 'utf8')).split('\n').filter((l) => /not installed/i.test(l) && /badge (?:amber|waiting)|'amber'/.test(l)).map((l) => `${rel(f)}: ${l.trim().slice(0, 80)}`));
  assert.deepEqual(notInstalled, []);
});

test('chips: the cost tag chip is filled with its × inside; the missing slot alone is outlined (dashed amber)', () => {
  const chip = bodyOf('.tag-chip');
  assert.match(chip, /background:var\(--field\)/);
  assert.doesNotMatch(chip, /border:1px solid/);
  assert.match(bodyOf('.tag-chip.tag-missing'), /border:1px dashed var\(--amber\)/);
  assert.match(bodyOf('.tag-x'), /width:14px;height:14px/);
  assert.match(bodyOf('.tag-dim-key-small'), /font-family:var\(--mono\);font-size:var\(--fs-caption\)/);
  for (const s of ['.ps-pill', '.ask-cmd-pill', '.tp-tab-badge']) {
    assert.doesNotMatch(bodyOf(s), /height:(?:2[0-9])px|font-family:var\(--mono\)|font-size:/, s);
  }
});

test('fields: the workflow name is the 32px field, the Library search the 28px one', () => {
  assert.match(bodyOf('input.wfv-name'), /height:32px/);
  assert.match(bodyOf('input.wfv-name'), /font:500 var\(--fs-body\)\/1 var\(--sans\)/);
  assert.match(bodyOf('.wfl-filter-input'), /height:28px/);
  assert.match(bodyOf('.wfl-filter-input'), /font-size:var\(--fs-meta\)/);
});

test('headings: section titles and sub-heads use the shared classes, with no size of their own', () => {
  const emit = (p, cls, shared) => assert.match(code(read(p)), new RegExp(`['"\`][^'"\`]*${cls}[^'"\`]*${shared}|${shared}[^'"\`]*${cls}`), `${p} ${cls}`);
  emit('ui/public/chat/home.mjs', 'chat-home-promos-h', 'section-title');
  emit('ui/public/chat/home-presets.mjs', 'chat-home-presets-h', 'section-title');
  emit('ui/public/workflows/library.mjs', 'wfl-title', 'section-title');
  emit('ui/public/extension-settings-view.mjs', 'xi-head', 'subsection-title');
  assert.match(code(read('ui/public/night-mode-form.mjs')), /'h3', 'subsection-title'/);
  for (const s of ['.chat-home-promos-h', '.chat-home-presets-h', '.wfl-title', '.xi-head', '.away-basic h3']) {
    assert.deepEqual(decls(bodyOf(s), 'font(?:-size|-weight)?'), [], s);
  }
});

const PAGE_CARDS = ['.chart-card', '.sched-feed', '.tp-ov-card', '.rd-sheet', '.hd-ov-card', '.pd-ov-card', '.hd-cl-card', '.hd-ov-task',
  '.tp-editor .card.tp-group-card', '.tp-editor details.card', '.tm-empty .card', '.mv-card', '.mv-providers', '.settings-card'];
const TILES = ['.stat-tile', '.chat-run-tile', '.mcp-setlist'];
test('cards: every page card pads --pad-card, every tile --pad-tile', () => {
  for (const s of PAGE_CARDS) assert.match(bodyOf(s), /padding:var\(--pad-card\)/, s);
  for (const s of TILES) assert.match(bodyOf(s), /padding:var\(--pad-tile\)/, s);
  assert.equal(bodyOf('.card.settings-card'), '', 'a Settings section is a real .card: no rule strips its fill, border or padding');
});

test('tables: every header is 12/600 --ink-2', () => {
  const bad = ALL.filter((r) => splitTop(r.sel).some((s) => / th$|^th$|\bth:/.test(s.replace(/:not\([^)]*\)/g, ''))))
    .flatMap((r) => [...decls(r.body, 'font-size'), ...decls(r.body, 'font')].filter(([, v]) => !v.includes('var(--fs-meta)')).map(([p, v]) => where(r, `${p}:${v}`)));
  assert.deepEqual(bad, []);
  assert.match(bodyOf('.tm-tbl:not(.table) th'), /font:600 var\(--fs-meta\)\/var\(--lh-title\) var\(--sans\)/);
});

test('buttons outside .btn: the info tip has a corner and a fill; rows a person opens are .row-btn', () => {
  assert.match(bodyOf('.info-tip'), /border-radius:var\(--r-sm\)/);
  assert.match(bodyOf('.info-tip:hover'), /background:var\(--hover\)/);
  const row = bodyOf('.row-btn');
  assert.match(row, /border-radius:var\(--r-sm\)/);
  assert.match(bodyOf('.row-btn:hover'), /background:var\(--hover\)/);
  assert.match(bodyOf('.row-btn:focus-visible'), /outline-offset:-2px/);
  assert.match(code(read('ui/public/workflows/library.mjs')), /'wfl-folder row-btn'|'row-btn wfl-folder'/);
  assert.match(code(read('ui/public/memory-view.mjs')), /mem-row-main row-btn|row-btn mem-row-main/);
  assert.match(code(read('ui/public/app.js')), /'btn btn-sm btn-quiet btn-icon proj-open/);
});

// The brief: "the design-debt ratchet must end with none of them".
const SHARED_DEBT = ['.ask-pop-effort .ask-effort-pill.on', '.wz .tog.on', '.ac-builtin-note → 12.5px', '.ask-model-name → 13.5px',
  '.ask-model-tag → 10.5px', '.ask-pop-caption-meter → 10px', '.ask-pop-mcp .ask-model-name small → 11.5px', '.ask-pop-row-value → 12.5px',
  '.ask-pop-subgroup → 11.5px', '.ask-rp-ctl → 11.5px', '.info-tip → 10px', '.ins-tog-t → 12.5px', '.ps-pill → 12.5px', '.tl-toggle → 12.5px',
  '.tp-tab-badge → 10.5px', '.wfl-filter-input → 14px', '.wfl-title → 13.5px', '.wfv-menu → 12.5px', '.wiz-import-deep → 12.5px',
  '.wiz-select-all → 12.5px', '.wz-routing → 12.5px', 'input.wfv-name → 13.5px'];
test('design debt: no shared-control entry is left in test/fixtures/design-debt.json', () => {
  const debt = JSON.parse(read('test/fixtures/design-debt.json'));
  const all = Object.values(debt).filter(Array.isArray).flat();
  assert.deepEqual(SHARED_DEBT.filter((e) => all.includes(e)), []);
  const CONTROL = /switch|\.tog\b|ask-rp-(?:sw|knob|ctl)|fanout-toggle|nav-fly|ask-pop|btn-split-menu|wfv-menu|tag-chip|ps-pill|ask-cmd-pill|tp-tab-badge|check-row|info-tip|row-btn/;
  assert.deepEqual(all.filter((e) => CONTROL.test(e)), []);
});

test('the theme proof requires every shared-control check', () => {
  const proof = read('tools/verify-theme-cdp.mjs');
  for (const w of ['switch', 'checkbox ink', 'menu', 'badge slate', 'no ring on load', 'labels table', 'chip', 'card padding', 'scope label']) {
    assert.ok(proof.includes(`'${w}'`), `${w} is in the required list`);
  }
  assert.match(read('test/fixtures/theme-kitchen-sink.html'), /class="sw-input"[^>]*disabled/);
});
