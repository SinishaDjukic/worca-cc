// test/ui-guide-hops.test.mjs — every onboarding-guide hop rings a control that exists.
// The guides are hop objects in app.js's "// ── Guides ──" section: NAV(view, …) rings
// `.nav button[data-nav="<view>"]` (NAV('new', …) rings the top bar's #topnav-new: New run has
// no sidebar row); every other hop carries `target:` — a string, an array
// of fallbacks, a helper call (`on('.rd-facts')`) or a named list (`card`). A hop whose
// target never shows "gives up" (guide-spot), so a renamed selector kills a tour silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const app = read('app.js');
const start = app.indexOf('// ── Guides ─');
const end = app.indexOf('\n// ── ', start + 12);            // the next banner ("Interface mode")
const section = app.slice(start, end);
const lineOf = (i) => app.slice(0, start + i).split('\n').length;
const { document } = new JSDOM(read('index.html')).window;
const roots = [document, ...[...document.querySelectorAll('template')].map((t) => t.content)];
const resolves = (sel) => { try { return roots.some((r) => r.querySelector(sel)); } catch { return false; } };

// Painted at runtime, so absent from index.html: selector -> [file, its painter (string or RegExp)].
// The painter must still be in that file, and a leading `#id` scope must exist in the page.
const RUNTIME = new Map([
  ['#runs-list [data-run-id]', ['runs-list.mjs', 'a.dataset.runId = r.runId']],                 // the Runs list card
  ['#projects-list .pl-item', ['app.js', /function buildProjectRow\(p\) \{\s*const item = document\.createElement\('div'\);\s*item\.className = 'pl-item';/]],
  ['#projects-list .pl-row', ['app.js', /function buildProjectRow\(p\) \{[\s\S]{0,300}row\.className = 'pl-row';/]],
  ['#wfv-library .wfl-wf', ['workflows/library.mjs', /wfl-wf/]],                                // the Library's Workflows rows
  ['#wfv-library [data-tab="workflows"]', ['workflows/library.mjs', 'b.dataset.tab = t']],     // the Library's tabs
  ['.ask-pill', ['ask-panel.mjs', "make('button', 'ask-pill')"]],
  ['.ask-input', ['ask-panel.mjs', "el.input.className = 'ask-input'"]],
  ['.ask-send', ['ask-panel.mjs', "make('button', 'ask-send')"]],
  ['.ask-transcript', ['ask-panel.mjs', "make('div', 'ask-transcript')"]],
  ['#pd-tab-team', ['app.js', /btn\.id = `\$\{idPrefix\}-tab-\$\{t\.key\}`/]],                  // initDetailTabs, idPrefix 'pd' + PD_TABS key 'team'
  ['#proj-detail .pd-team-metrics', ['app.js', 'card.className = `card pd-team-card pd-team-${which}`']],  // buildPdTeam, which = metrics | policy
  ['#proj-detail .pd-team-policy', ['app.js', 'card.className = `card pd-team-card pd-team-${which}`']],
  ['#proj-detail .tm-enable', ['team-metrics-surfaces.mjs', "btn(doc, 'tm-enable',"]],
  ['#plugin-modal .tm-enable-submit', ['app.js', "'btn btn-primary btn-mini tm-enable-submit'"]],
  ['#proj-detail .tp-cell', ['team-policy-view.mjs', "'tm-cell tp-cell'"]],
  ['#proj-detail .tp-enable', ['team-policy-view.mjs', "btn(doc, 'tp-enable',"]],
  ['#plugin-modal .tp-enable-submit', ['app.js', "'btn btn-primary btn-mini tp-enable-submit'"]],
  ['#tp-body .tp-edit', ['team-policy-view.mjs', "'btn btn-ghost btn-mini tp-edit'"]],
  ['#mode-cards [data-level-choice]', ['ui-level.mjs', 'data-level-choice="${id}"']],            // the mode dialog's cards
  ['#lvl-menu [data-level-choice]', ['ui-level.mjs', "if (!side.querySelector('[data-level-choice]')) side.innerHTML = levelMenuHtml(lvl);"]],   // the account menu's Interface mode side menu
]);
// `target:` keys in the section that are not hop definitions.
const NOT_HOPS = new Set(['null', 'hop.target']);              // runGuideFor's state object; runGuide's createGuideSpot call

function painted(sel) {
  if (!RUNTIME.has(sel)) return false;
  const [file, painter] = RUNTIME.get(sel);
  const src = read(file);
  assert.ok(typeof painter === 'string' ? src.includes(painter) : painter.test(src), `${sel}: its painter is gone from ${file}`);
  const scope = sel.match(/^#[\w-]+(?=\s)/);
  assert.ok(!scope || resolves(scope[0]), `${sel}: ${scope?.[0]} is not in index.html`);
  return true;
}
// One JS expression: read to the first top-level `,` `;` newline or unmatched closer.
function readExpr(src, i) {
  const close = { '[': ']', '(': ')', '{': '}' }; const stack = []; let quote = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (close[ch]) stack.push(close[ch]);
    else if (stack.length && ch === stack[stack.length - 1]) stack.pop();
    else if (!stack.length && /[,;\n)\]}]/.test(ch)) return src.slice(i, j);
  }
  return src.slice(i);
}
// String literals in an expression; a template's `="${x}"` becomes attribute presence, any other `${}` drops it.
const literals = (expr) => [...expr.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
  .map((m) => (m[3] !== undefined ? m[3].replace(/="\$\{[^}]*\}"/g, '') : m[1] ?? m[2]))
  .filter((s) => !s.includes('${'));
// A hop whose target is a name (`target: card`) reads that const's own literals.
const named = (name) => { const m = section.match(new RegExp(`const ${name} = `)); return m ? readExpr(section, m.index + m[0].length) : ''; };

test('every guide hop has at least one target that exists in the page', async () => {
  const hops = [];
  for (const m of section.matchAll(/\bNAV\(\s*'([\w-]+)'/g)) hops.push({ line: lineOf(m.index), expr: m[0], targets: [m[1] === 'new' ? '#topnav-new' : `.nav button[data-nav="${m[1]}"]`] });
  for (const m of section.matchAll(/\btarget:\s*/g)) {
    const expr = readExpr(section, m.index + m[0].length).trim();
    if (NOT_HOPS.has(expr)) continue;
    const targets = /^[A-Za-z_$][\w$]*$/.test(expr) ? literals(named(expr)) : literals(expr);
    hops.push({ line: lineOf(m.index), expr, targets });
  }
  assert.ok(hops.length > 40, `parsed ${hops.length} hops from the guides section (bounds wrong?)`);
  await checkRows([
    ...hops.map(({ line, expr, targets }) => ({
      name: `app.js:${line} ${targets.join(' | ') || expr}`,
      run: () => {
        assert.ok(targets.length, `cannot read the target expression ${expr} (extend the parser or NOT_HOPS)`);
        assert.ok(targets.some((s) => resolves(s) || painted(s)), 'no target resolves in index.html, a <template> or RUNTIME');
      },
    })),
    { name: 'every RUNTIME entry is still a hop target', run: () => {
      const used = new Set(hops.flatMap((h) => h.targets));
      assert.deepEqual([...RUNTIME.keys()].filter((s) => !used.has(s)), []);
    } },
  ]);
});

// The Workflows view's stage (`.wfv-stage{…isolation:isolate}`) and its floating bars (`.wfv-float{position:absolute;
// z-index:20}`) are stacking contexts: a ringed control inside one (`.guide-target`, z 45) stays UNDER the guide's
// scrim (z 44) unless the hop also lifts each of them (`.guide-lift`). Chrome then sends the click to the scrim and
// the tour sticks on that hop ("Leave the editor" never leaves); jsdom has no cascade, so this pins the hop text.
test('a hop ringing a control inside the Workflows stage lifts every stacking context around it', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.wfv-float\{[^}]*position:absolute;[^}]*z-index:\d+/, 'the floating bars are a stacking context');
  assert.match(css, /\.wfv-stage\{[^}]*isolation:isolate/, 'the stage is a stacking context');
  const rows = [];
  for (const m of section.matchAll(/\btarget:\s*/g)) {
    const expr = readExpr(section, m.index + m[0].length).trim();
    if (NOT_HOPS.has(expr) || /^[A-Za-z_$][\w$]*$/.test(expr)) continue;
    for (const sel of literals(expr)) {
      let node = null; try { node = document.querySelector(sel); } catch { /* not a selector */ }
      const traps = node ? ['.wfv-float', '.wfv-stage'].map((c) => node.closest(c)).filter(Boolean) : [];
      if (!traps.length) continue;
      const hop = readExpr(section, section.lastIndexOf('{ id:', m.index));
      const lift = literals((hop.match(/\blift:\s*(\[[^\]]*\])/) || [])[1] || '');
      for (const t of traps) rows.push({ at: `app.js:${lineOf(m.index)} ${sel} under .${t.className.split(' ')[0]}`, ok: lift.some((l) => t.matches(l)) });
    }
  }
  assert.ok(rows.length >= 4, `found ${rows.length} trapped hops (the Library toggle, the canvas, the chat and Back at least)`);
  assert.deepEqual(rows.filter((r) => !r.ok).map((r) => r.at), []);
});

// At <= 760 px the Library is an overlay (Task C1: `@media (max-width:760px){.wfl{position:absolute;…z-index:35…}}`):
// a stacking context under the guide's scrim (z 44). A hop ringing a control inside it (the Workflows tab, a saved
// workflow's row) must lift `.wfl` too, or Chrome sends the click to the scrim and the tour sticks on "Switch to
// Workflows" — on a narrow window only (wider, the Library is a plain flex column). Its rows are painted at runtime:
// resolve them by their `#id` scope.
test('a hop ringing a control inside the Library lifts the Library (its narrow-screen overlay is a stacking context)', () => {
  const rows = [];
  for (const m of section.matchAll(/\btarget:\s*/g)) {
    const expr = readExpr(section, m.index + m[0].length).trim();
    if (NOT_HOPS.has(expr) || /^[A-Za-z_$][\w$]*$/.test(expr)) continue;
    for (const sel of literals(expr)) {
      const scope = (sel.match(/^#[\w-]+/) || [])[0];
      let node = null; try { node = document.querySelector(sel) || (scope ? document.querySelector(scope) : null); } catch { /* not a selector */ }
      const lib = node ? node.closest('.wfl') : null;
      if (!lib) continue;
      const hop = readExpr(section, section.lastIndexOf('{ id:', m.index));
      const lift = literals((hop.match(/\blift:\s*(\[[^\]]*\])/) || [])[1] || '');
      rows.push({ at: `app.js:${lineOf(m.index)} ${sel}`, ok: lift.some((l) => lib.matches(l)) });
    }
  }
  assert.ok(rows.length >= 3, `found ${rows.length} hops inside the Library (the Workflows tab and the two Open Default targets at least)`);
  assert.deepEqual(rows.filter((r) => !r.ok).map((r) => r.at), []);
});
