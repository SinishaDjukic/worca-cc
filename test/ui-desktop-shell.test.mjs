// test/ui-desktop-shell.test.mjs — ui/public/shell/desktop-shell.css: the desktop app's title bar insets and drag
// strips (docs/desktop.md "Window and icons"). Every rule is scoped to the data-shell-chrome attribute that only the
// desktop preload sets, so the web build renders exactly as before; the geometry and colours agree with
// desktop/src/title-bar.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { THEME_COLORS, TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_SIZE, TOP_BAR_HEIGHT } from '../desktop/src/title-bar.mjs';
import { windowOptions } from '../desktop/src/window.mjs';

const PART = 'shell/desktop-shell.css';
const partText = readFileSync(new URL(`../ui/public/${PART}`, import.meta.url), 'utf8');
const parts = JSON.parse(readFileSync(new URL('../ui/public/parts.json', import.meta.url), 'utf8'));
const css = readStyleCss();
const rules = cssRules(partText);
const INSET = ':root[data-shell-chrome="inset"]';
const OVERLAY = ':root[data-shell-chrome="overlay"]';
const INSET_WINDOWED = `${INSET}:not([data-shell-fullscreen])`;
const selectors = (rule) => rule.sel.split(/,(?![^()]*\))/).map((s) => s.trim());
/** Declarations of every rule that has `selector` among its comma-separated selectors, merged in order. */
function decls(selector) {
  const out = {};
  for (const r of rules) {
    if (!selectors(r).includes(selector)) continue;
    for (const d of r.body.split(';').map((x) => x.trim()).filter(Boolean)) { const i = d.indexOf(':'); out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  }
  return out;
}
const px = (v) => { const m = /^(\d+)px$/.exec(v || ''); assert.ok(m, `a px value: ${v}`); return Number(m[1]); };
const noDragRules = () => rules.filter((r) => /(^|;)\s*app-region:no-drag/.test(r.body));
const D7 = (pad) => `calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)) + ${pad}px)`;

test('the part comes last but one (chat/card-nesting.css stays last) and ends in a newline; no comment inside a rule body', () => {
  assert.deepEqual(parts.css.slice(-2), [PART, 'chat/card-nesting.css']);
  assert.equal(parts.css.filter((p) => p === PART).length, 1);
  assert.ok(partText.endsWith('\n'));
  assert.ok(rules.length > 0);
  for (const r of rules) assert.doesNotMatch(partText.slice(partText.indexOf(r.body)).split('}')[0], /\/\*/, r.sel);
  for (const c of partText.match(/\/\*[\s\S]*?\*\//g) || []) assert.doesNotMatch(c, /\}/, 'no } in a comment');
});

test('every selector is scoped to the desktop chrome attribute; no colour literal, font, radius, 76px or 298', () => {
  for (const r of rules) for (const s of selectors(r)) assert.ok(s.startsWith(INSET) || s.startsWith(OVERLAY), s);
  for (const r of rules) assert.ok(r.media === '' || r.media === '@media (max-width:900px)', `only the 900px panel wrapper: ${r.media}`);
  const bodies = rules.map((r) => r.body).join('\n');
  assert.doesNotMatch(bodies, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/i);
  assert.doesNotMatch(bodies, /\bfont|radius/);
  assert.doesNotMatch(partText, /\b298\b|\b76px\b/);
});

test('web invariant: nothing outside the part mentions app-region, data-shell or titlebar-area; the part is served unchanged', () => {
  assert.equal(css.split(partText).length, 2, 'the part appears once, unchanged');
  const web = css.replace(partText, '');
  assert.doesNotMatch(web, /app-region|data-shell|titlebar-area/);
});

test('inset geometry: the wordmark clears the lights; the rail gets a taller top; both only outside full screen', () => {
  const brand = decls(`${INSET_WINDOWED} .brand`);
  const rail = decls(`${INSET_WINDOWED} .sidebar.collapsed .brand`);
  assert.equal(brand['padding-left'], '84px');
  assert.deepEqual([rail.height, rail['padding-top'], rail['padding-left']], ['80px', '32px', '0']);
  assert.ok(!partText.includes('.sidebar.collapsed .brand > .logo-mark'));
  const { expanded, rail: r } = TRAFFIC_LIGHTS;
  const { width, height } = TRAFFIC_LIGHTS_SIZE;
  assert.ok(expanded.x + width + 14 <= px(brand['padding-left']), 'the wordmark starts right of the lights');
  assert.equal(2 * expanded.y + height, TOP_BAR_HEIGHT, 'the lights are centred on the 48px logo row');
  assert.ok(Math.abs(2 * r.x + width - 60) <= 2, 'the lights are centred in the 60px rail');
  assert.equal(2 * r.y + height, px(rail['padding-top']), 'the lights are centred in the rail\'s top strip');
  for (const rule of rules) {
    if (!/padding|height|top:|background/.test(rule.body)) continue;
    for (const s of selectors(rule)) if (s.startsWith(INSET)) assert.ok(s.startsWith(INSET_WINDOWED), `full-screen scoped: ${s}`);
  }
});

test('drag strips: the logo row and the top bar in both chromes; their controls and the overlay roots are no-drag', () => {
  for (const root of [INSET, OVERLAY]) for (const strip of ['.brand', '.topnav']) {
    assert.deepEqual([decls(`${root} ${strip}`)['-webkit-app-region'], decls(`${root} ${strip}`)['app-region']], ['drag', 'drag'], `${root} ${strip}`);
  }
  const noDrag = noDragRules().flatMap(selectors).join('\n');
  for (const root of [INSET, OVERLAY]) {
    const strips = root === OVERLAY ? ':is(.brand,.topnav,.term-head)' : ':is(.brand,.topnav)';
    assert.ok(noDrag.includes(`${root} ${strips} :is(a,button,input,select,textarea,label,summary,[role="button"],[tabindex],[contenteditable])`), `${root} strip controls`);
  }
  for (const r of noDragRules()) assert.match(r.body, /-webkit-app-region:no-drag;app-region:no-drag;/);
});

test('every overlay root named in the plan (and the header) is no-drag in both chromes', () => {
  const ROOTS = ['dialog', '[popover]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]', '[role="tooltip"]',
    '.viewer-modal', '.guide-scrim', '.guide-ring', '.guide-balloon', '.apv', '.req-help', '.ss', '.session-expired', '.chat-scrim',
    '.nav-fly', '.activity-pop', '.tsearch-pop', '.info-bubble', '.mention-popup', '.pp-pop', '.wfv-menu', '.term-pane'];
  const header = partText.slice(0, partText.indexOf(':root'));   // the comment lines above the first rule
  const sel = noDragRules().flatMap(selectors);
  for (const root of [INSET, OVERLAY]) {
    const list = sel.find((s) => s.startsWith(`${root} :is(dialog,`));
    assert.ok(list, `${root} overlay list`);
    const names = list.slice(`${root} :is(`.length, -1).split(/,(?![^()[\]]*[)\]])/);
    for (const r of ROOTS) assert.ok(names.includes(r), `${root} ${r}`);
    for (const n of names.filter((x) => x.startsWith('.'))) assert.ok(header.includes(n), `the header comment names ${n}`);
  }
  assert.match(header, /add new fixed overlays here/i);
});

test('overlay: the top bar and the terminal head keep clear of the window controls (138px fallback); no height text', () => {
  assert.equal(decls(`${OVERLAY} .topnav`)['padding-right'], D7(16));
  const head = decls(`${OVERLAY} .term-head`);
  assert.equal(head['padding-right'], D7(12));
  assert.deepEqual([head['-webkit-app-region'], head['app-region']], ['drag', 'drag']);
  for (const r of rules) if (selectors(r).some((s) => s.endsWith('.topnav'))) assert.doesNotMatch(r.body, /height/, r.sel);
  assert.ok(!rules.some((r) => selectors(r).some((s) => s.startsWith(INSET) && s.endsWith('.term-head'))), 'macOS: the lights are on the left');
});

test('the Workflows view (no top bar) gets a 48px drag strip in both chromes; the canvas is no-drag', () => {
  for (const root of [INSET_WINDOWED, OVERLAY]) {
    const wfv = decls(`${root} body.view-workflows .wfv`);
    assert.equal(wfv.top, `${TOP_BAR_HEIGHT}px`, root);
    assert.deepEqual([wfv['-webkit-app-region'], wfv['app-region']], ['no-drag', 'no-drag'], root);
    const view = decls(`${root} body.view-workflows .view[data-view="workflows"]`);
    assert.deepEqual([view['-webkit-app-region'], view['app-region'], view.background], ['drag', 'drag', 'var(--panel)'], root);
  }
  assert.equal(decls(`${INSET} body.view-workflows .wfv`).top, undefined, 'full screen: no strip');
});

test('at the window\'s minWidth every full-window fixed panel starts below the 48px top bar in both chromes', () => {
  const minWidth = windowOptions().minWidth;
  const web = cssRules(css.replace(partText, ''));
  // Every rule outside the part that makes a root position:fixed; inset:0 under a max-width query the window can reach.
  const full = web.filter((r) => {
    const m = /max-width:\s*(\d+)px/.exec(r.media);
    return m && Number(m[1]) >= minWidth && /position:\s*fixed/.test(r.body) && /(^|;)\s*inset:\s*0\s*(;|$)/.test(r.body);
  });
  assert.ok(full.length >= 3, 'the Chat run panel, Help me answer and the export sheet');
  for (const r of full) for (const s of selectors(r)) for (const root of [INSET_WINDOWED, OVERLAY]) {
    const own = rules.filter((x) => x.media === r.media && selectors(x).includes(`${root} ${s}`));
    assert.ok(own.length, `${root} ${s} (${r.media})`);
    assert.ok(own.some((x) => /(^|;)\s*top:\s*48px\s*(;|$)/.test(x.body)), `${root} ${s}: top:48px`);
  }
  assert.equal(TOP_BAR_HEIGHT, 48);
});

test('THEME_COLORS equals the light-dark() arms of --bg, --panel and --ink', () => {
  const root = /(?:^|[\s,}]):root\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))[1];
  const arm = (name) => { const m = new RegExp(`${name}:light-dark\\(\\s*([^,\\s]+)\\s*,\\s*([^)\\s]+)\\s*\\)`).exec(root); assert.ok(m, name); return [m[1], m[2]].map((c) => c.toLowerCase()); };
  for (const [token, key] of [['--bg', 'background'], ['--panel', 'overlay'], ['--ink', 'symbol']]) {
    assert.deepEqual(arm(token), [THEME_COLORS.light[key], THEME_COLORS.dark[key]].map((c) => c.toLowerCase()), token);
  }
});
