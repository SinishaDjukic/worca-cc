// test/ui-guide-hops.test.mjs — every onboarding-guide hop rings a control that exists.
// The guides are hop objects in app.js's "// ── Guides ──" section: NAV(view, …) rings
// `.nav button[data-nav="<view>"]`; every other hop carries `target:` — a string, an array
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
  ['#gv-saved-list .pl-row', ['app.js', /els\.savedList\.replaceChildren\(\);[\s\S]{0,400}row\.className = 'pl-row';/]],   // gvRenderSaved
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
  for (const m of section.matchAll(/\bNAV\(\s*'([\w-]+)'/g)) hops.push({ line: lineOf(m.index), expr: m[0], targets: [`.nav button[data-nav="${m[1]}"]`] });
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
