// test/models-page-css.test.mjs — the Models page's CSS base (models/models-page.css): its place in parts.json, the
// hidden-panel contract, the colour and gradient rules, layout-only tab hooks, and the mark/state tokens in the first
// :root of shell/self-hosted.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const decls = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*(${prop})\\s*:\\s*([^;]+)`, 'g'))]
  .map((m) => [m[1], m[2].trim()]);
/** Split on top-level commas only: commas inside :is(…), var(…) or a gradient stay. */
const splitTop = (v) => {
  const out = []; let depth = 0; let cur = '';
  for (const ch of v) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
};
const lastCompound = (s) => s.split(/\s*[>+~]\s*|\s+/).at(-1);
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/i;

const PART = 'models/models-page.css';
const part = () => read(`ui/public/${PART}`);

test('parts.json lists models-page.css right after model-bridge.css', () => {
  const { css } = JSON.parse(read('ui/public/parts.json'));
  assert.equal(css.indexOf(PART), css.indexOf('models/model-bridge.css') + 1);
  assert.equal(css.filter((p) => p === PART).length, 1);
});

test('the served stylesheet hides a hidden .mdl-panel, and the page head wraps on phones', () => {
  const style = readStyleCss();
  const hidden = cssRules(style).filter((r) => r.sel === '.mdl-panel[hidden]' && r.media === '');
  assert.ok(hidden.some((r) => decls(r.body, 'display').some(([, v]) => v === 'none')), '.mdl-panel[hidden]{display:none}');
  assert.ok(stripComments(part()).includes('@media (max-width:760px){.mdl-head{flex-wrap:wrap}}'), 'the 760px head wrap, compact');
});

test('the part carries no colour literal, no violet, and caps no models view width', () => {
  const text = part();
  const rules = cssRules(text);
  assert.ok(rules.length > 10, 'the part has rules');
  const literals = rules.filter((r) => LITERAL.test(r.body)).map((r) => `${r.sel} → ${r.body.slice(0, 80)}`);
  assert.deepEqual(literals, []);
  assert.doesNotMatch(stripComments(text), /var\(--violet/);
  const capped = rules.filter((r) => r.sel.includes('[data-view="models"]') && decls(r.body, 'max-width').length).map((r) => r.sel);
  assert.deepEqual(capped, []);
});

test('the two gradients: the own mark and the Best chip', () => {
  const rules = cssRules(part());
  const body = (sel) => rules.filter((r) => r.sel === sel && r.media === '').map((r) => r.body.replace(/\s+/g, '')).join(';');
  assert.match(body('.mdl-mark.own'), /background:linear-gradient\(135deg,var\(--ga\),var\(--gb\)\)/);
  assert.match(body('.mdl-best'), /background:linear-gradient\(135deg,var\(--best-a\),var\(--best-b\)\)/);
});

test('a .mdl-tab rule sets layout only: no height, border, background, colour or font', () => {
  const SKIN = '(?:min-|max-)?height|border(?:-[a-z]+)*|background(?:-[a-z]+)*|color|font(?:-[a-z]+)*';
  const tabRules = cssRules(readStyleCss()).filter((r) => splitTop(r.sel).some((s) => /\.mdl-tab(?![\w-])/.test(lastCompound(s))));
  assert.ok(tabRules.length >= 1, 'the part has .mdl-tab rules');
  const bad = tabRules.flatMap((r) => decls(r.body, SKIN).map(([p, v]) => `${r.sel} → ${p}:${v}`));
  assert.deepEqual(bad, []);
});

test('the first :root of self-hosted.css declares the mark, Best and on-mark tokens as equal-arm light-dark pairs', () => {
  const root = cssRules(read('ui/public/shell/self-hosted.css')).find((r) => r.sel === ':root').body;
  const TOKENS = {
    '--mark-tile': '#FFFFFF',
    '--mark-g-indigo-a': '#4457B5', '--mark-g-indigo-b': '#8C7FD6',
    '--mark-g-teal-a': '#2A8A80', '--mark-g-teal-b': '#5BA6CC',
    '--mark-g-pink-a': '#B84A7C', '--mark-g-pink-b': '#8C7FD6',
    '--mark-g-blue-a': '#3782A8', '--mark-g-blue-b': '#6A7FD8',
    '--mark-g-lime-a': '#6E8A14', '--mark-g-lime-b': '#4FB3A9',
    '--mark-g-slate-a': '#4A5661', '--mark-g-slate-b': '#8A96A3',
    '--best-a': '#2B6A8C', '--best-b': '#4457B5',
    '--on-mark': '#FFFFFF',
  };
  assert.equal(Object.keys(TOKENS).length, 16);
  for (const [name, hex] of Object.entries(TOKENS)) {
    const got = decls(root, name).map(([, v]) => v);
    assert.deepEqual(got, [`light-dark(${hex},${hex})`], name);
  }
});

test('narrow (VIS-4, ≤860px): two tiles per row, the step names hide, the list scrolls sideways in its box', () => {
  const narrow = cssRules(part()).filter((r) => r.media === '@media (max-width:860px)');
  const at = (sel) => narrow.filter((r) => r.sel === sel).map((r) => r.body.replace(/\s+/g, '')).join(';');
  assert.match(at('.mdl-hx'), /(?:^|;)grid-template-columns:repeat\(2,minmax\(0,1fr\)\)(?:;|$)/);
  assert.match(at('.mdl-hx-t.best'), /(?:^|;)grid-row:auto(?:;|$)/);
  assert.match(at('.mdl-tiles'), /(?:^|;)grid-template-columns:minmax\(0,1fr\)(?:;|$)/);
  assert.match(at('.mdl-steps'), /(?:^|;)display:none(?:;|$)/);
  assert.match(at('.mdl-add-src'), /(?:^|;)grid-template-columns:minmax\(0,1fr\)(?:;|$)/);
  assert.match(at('.mdl-add #mimp-body'), /(?:^|;)overflow-x:auto(?:;|$)/);
  assert.match(at('.mdl-add #mimp-body'), /(?:^|;)contain:inline-size(?:;|$)/);
  assert.match(at('.mdl-add #mimp-body .mvi-tbl'), /(?:^|;)min-width:720px(?:;|$)/);
});

test('a job card head wraps: at 290px "Override a helper job" drops under the title instead of scrolling the page', () => {
  const head = cssRules(part()).filter((r) => r.sel === '.card-head.mdl-card-h' && r.media === '').map((r) => r.body.replace(/\s+/g, '')).join(';');
  assert.match(head, /(?:^|;)flex-wrap:wrap(?:;|$)/);
  const over = cssRules(part()).filter((r) => r.sel === '.mdl-card-h > .mdl-override' && r.media === '').map((r) => r.body.replace(/\s+/g, '')).join(';');
  assert.match(over, /(?:^|;)margin-left:auto(?:;|$)/, 'the button keeps to the right, on its own line too');
});

test('a Jobs block an address reveals (is-found on #jobs-roles and the job cards) flashes like a found card', () => {
  const found = cssRules(part()).filter((r) => /#jobs-root\b/.test(r.sel) && /\.is-found\b/.test(r.sel));
  const motion = found.filter((r) => r.media === '').map((r) => r.sel + '{' + r.body.replace(/\s+/g, '') + '}').join(' ');
  const still = found.filter((r) => r.media === '@media (prefers-reduced-motion:reduce)').map((r) => r.sel + '{' + r.body.replace(/\s+/g, '') + '}').join(' ');
  for (const [label, text] of [['motion', motion], ['reduced motion', still]]) {
    assert.match(text, /\.mdl-job-card\b/, `${label}: the job cards`);
    assert.match(text, /#jobs-roles\b/, `${label}: the role tiles' block`);
  }
  assert.match(motion, /animation:settingFound3sease-out/);
  assert.match(still, /animation:none/);
  assert.match(still, /box-shadow:0003pxvar\(--amber-ring\)/);
});

test("Add model's blocked box draws no border of its own inside the dialog's card (B2)", () => {
  const body = cssRules(part()).filter((r) => splitTop(r.sel).some((s) => /\.mdl-add-blocked(?![\w-])/.test(s))).map((r) => r.body).join(';');
  assert.match(body, /display:flex/);
  assert.deepEqual(decls(body, 'border(?:-[a-z]+)*').filter(([, v]) => !/^(?:0|none)\b/.test(v)), []);
});

test("the model picker's menu is fixed over the page, at two classes so the Chat composer's .ask-pop rules lose", () => {
  const pop = cssRules(part()).filter((r) => r.media === '' && splitTop(r.sel).some((s) => /\.mdl-pick-pop(?![\w-])/.test(s)));
  // chat/workflow-card.css loads later (parts.json) and sets .ask-pop{position:absolute;z-index:3} and .ask-pop-model's
  // right and bottom at one class each: a one-class .mdl-pick-pop would lose on order; .ask-pop.mdl-pick-pop (0,2,0) wins.
  assert.deepEqual(pop.map((r) => r.sel), ['.ask-pop.mdl-pick-pop']);
  const body = pop[0].body.replace(/\s+/g, '');
  for (const d of ['position:fixed', 'right:auto', 'bottom:auto', 'z-index:58']) assert.match(body, new RegExp(`(?:^|;)${d}(?:;|$)`), d);
});
