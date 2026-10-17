// test/ui-radius-scale.test.mjs — #775: one tight radius scale (--r-xs 3px, --r-sm 6px, --r-md 8px) in style.css, the
// broker page and the CSS embedded in ui/public .mjs; 999px / 50% only on the round allow-list (avatars, dots, knobs,
// progress); no 3px+ left-border accents; no decorative shadow on cards; list rows divided, not boxed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Every style rule as { sel, body }: @media / @supports bodies included, @keyframes steps and @-rules skipped. */
export function rules(css) {
  const out = [];
  for (const m of strip(css).matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const sel = norm(m[1]);
    if (sel.startsWith('@') || /^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/.test(sel)) continue;
    out.push({ sel, body: m[2] });
  }
  return out;
}

/** The radius declarations of one rule body: [{ prop, value }] (longhands too, !important dropped). */
export function radii(body) {
  const out = [];
  for (const m of body.matchAll(/(?:^|;)\s*(border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;]+)/g)) {
    out.push({ prop: m[1], value: norm(m[2].replace(/!important/, '')) });
  }
  return out;
}

/** Split a value at top-level spaces: 'var(--r-md) 0 calc(var(--r-sm) * var(--gv-scale))' -> 3 parts. */
export function parts(v) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ' ' && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const TOKEN = 'var\\(--r-(?:xs|sm|md)\\)';
// A fallback must equal the token's own value (c4-view.mjs styles its shadow DOM with fallbacks).
const TOKEN_FB = 'var\\(--r-(?:xs,3px|sm,6px|md,8px)\\)';
const PART = new RegExp(`^(?:0|inherit|${TOKEN}|${TOKEN_FB}|calc\\(${TOKEN} \\* var\\(--gv-scale\\)\\))$`);
const ROUND = new Set(['999px', '50%']);

/** One verdict per declaration: null is fine, a string names the problem. */
export function judge(sel, value, roundOk) {
  if (ROUND.has(value)) return roundOk.has(sel) ? null : `${sel}: ${value} is only for avatars, dots, knobs and progress`;
  return parts(value).every((p) => PART.test(p)) ? null : `${sel}: border-radius ${value} is not on the scale`;
}

// The round allow-list: avatars, status dots and marks, toggle tracks and knobs, radios and swatches, spinners and
// rings, progress tracks and fills. Exact selector text as written in style.css (whitespace normalised).
const ROUND_OK = new Set([
  // status dots and pips
  '.nav-rollup', '.dot', '.activity-dot', '.tsearch-dot', '.pill-status .dot', '.dirty-dot', '.pill-run .pdot',
  '.ws-rollup-dot', '.wm-dot', '.run-flow .nstat', '.script-dot', '.bench-dot', '.proj-fdot', '.tl-dot',
  '.tl-mark.is-open', '.tl-pr-start', '.tl-att-dot', '.acct-dot', '.hd-base-pill::before',
  '.rc-meta .rc-status-word::before', '.rg-td', '.rd-ag-dot', '.ask-dot', '.ask-tool-dot', '.ask-rp-kicker::before',
  '.ask-wfcard-step .st-dot', '.ask-rc-dot', '.ask-rc-agent-dot',
  '.ask-rc-graph .gv-world .node.is-done::after,.ask-rc-graph .gv-world .node.is-paused::after,.ask-rc-graph .gv-world .node.is-stopped::after,.ask-rc-graph .gv-world .node.is-error::after',
  '.sync-pill .sdot', '.gv-world .dot,.gv-world .gdot', '.gv-world .npip,.gv-world .nwarn', '.gv-world .xfoot .led',
  '.gv-world .ngate', '.ins-pitem .dot', '.ins-pitem .gdot',
  '.run-flow.gv-host .gv-world .node.is-done::after,.run-flow.gv-host .gv-world .node.is-paused::after,.run-flow.gv-host .gv-world .node.is-stopped::after,.run-flow.gv-host .gv-world .node.is-error::after',
  '.mcp-dot', '.tab-dot', '.act-srow .pdot,.act-tile .pdot', '.wfc-dotu', '.nav-count.nav-dot', '.chat-run-tile-dot',
  '.chat-home-dot', '.runs-ic',
  // status marks (fixed square, same family as .nstat / .ngate)
  '.export-done-check', '.wd-rescan-mark', '.wz .rt-check', '.gs-mark',
  // avatars and the brand mark
  '.user .ava', '.tl-ava', '.acct-ava', '.person-ini', '.brand .logo-mark',
  // toggle tracks and knobs
  '.switch', '.switch::after', '.wz .tog', '.wz .tog::after', '.ask-rp-knob', '.ask-rp-knob::after',
  // radios and colour swatches
  'input[type="radio"]', '.lv-card-radio', '.af-mark', '.wz .sw',
  // spinners, rings, circular fills
  '.is-busy[data-fb-state="busy"] .btn-spin', '.spinner', '#refresh-history.busy::after', '.tm-busy-spin',
  '.tm-refresh.busy::after', '.rd-pr-spin', '.rd-pr-fill', '.ask-ctx-ring',
  // progress tracks, fills and segments
  '.stat-meter', '.stat-meter .stat-meter-fill', '.spend-ind-meter', '.spend-ind-meter-fill',
  '.run-prog-track,.run-chain-track', '.run-chain-part', '.ask-ctx-bar', '.shape-feature-bar', '.shape-feature-seg',
]);

const css = read('ui/public/style.css');
const all = rules(css);

test('style.css :root has the three radius tokens and none of the old ones', () => {
  const root = strip(css).slice(strip(css).indexOf(':root{'));
  const first = root.slice(0, root.indexOf('}'));
  assert.match(first, /--r-xs:3px;/);
  assert.match(first, /--r-sm:6px;/);
  assert.match(first, /--r-md:8px;/);
  assert.doesNotMatch(css, /--r-card|--r-ctrl|--btn-r\b/);
});

test('style.css: every border-radius is a token, 0 or inherit; 999px / 50% only on the round allow-list', () => {
  const bad = [];
  for (const { sel, body } of all) for (const { value } of radii(body)) {
    const why = judge(sel, value, ROUND_OK);
    if (why) bad.push(why);
  }
  assert.deepEqual(bad, []);
});

test('the round allow-list has no stale entry: each selector exists and is round', () => {
  for (const sel of ROUND_OK) {
    const hit = all.filter((r) => r.sel === sel).some((r) => radii(r.body).some((d) => ROUND.has(d.value)));
    assert.ok(hit, `${sel} is allow-listed but has no 999px / 50% rule`);
  }
});

test('broker page.css carries the tokens and uses only them', () => {
  const page = read('src/broker/ui/page.css');
  assert.match(page, /--r-xs:3px;\s*--r-sm:6px;\s*--r-md:8px;/);
  const bad = [];
  for (const { sel, body } of rules(page)) for (const { value } of radii(body)) {
    const why = judge(sel, value, new Set());
    if (why) bad.push(why);
  }
  assert.deepEqual(bad, []);
});

test('ui/public .mjs: embedded CSS radii are on the scale (interpolated ${…} values are computed, so skipped)', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) files.push(p);
    }
  };
  walk(join(ROOT, 'ui/public'));
  // Keyed by file: the C4 rail's status dot (.rail .it i) is the one round radius embedded in a .mjs.
  const MJS_ROUND_OK = new Set(['ui/public/c4/c4-view.mjs']);
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/border-radius\s*:\s*([^;}"'`\n]+)/g)) {
      const value = norm(m[1]);
      if (value.includes('${')) continue;
      const why = judge(relative(ROOT, f), value, MJS_ROUND_OK);
      if (why) bad.push(why);
    }
  }
  assert.deepEqual(bad, []);
});

test('no left-border accent cards: no 3px+ left border, .issue has no severity stripe', () => {
  // A zero-width box with a thick left border is a CSS-triangle chevron (.agent-chev, .adv-chev), a glyph, not an accent.
  const accents = all.filter((r) => /border-left(?:-width)?\s*:\s*[3-9](?:\.\d+)?px/.test(r.body)
    && !/(?:^|;)\s*width:0[;\s]/.test(r.body)).map((r) => r.sel);
  assert.deepEqual(accents, []);
  assert.equal(all.filter((r) => /^\.issue\.sev-/.test(r.sel) && /border-left-color/.test(r.body)).length, 0);
});

test('cards carry no decorative shadow; floating layers keep theirs', () => {
  const CARDS = ['.card', '.rd-sheet', '.hd-header,.pd-header', '.rd-header', '.ask-card.chat-rc', '.pp-tray',
    '.hd-cmt-card', '.ask-card.ask-rp', '.rd-night-sec', '.wz .rt', '.pill-status',
    ':is(.rd-questions,.chat-rc-q) .qpanel', ':is(.rd-questions,.chat-rc-q) .qblock'];
  for (const sel of CARDS) {
    for (const r of all.filter((x) => x.sel === sel)) assert.doesNotMatch(r.body, /box-shadow:[^;]*var\(--shadow/, sel);
  }
  for (const sel of ['.activity-pop', '.toast', '.chart-tip', '.apv-card']) {
    assert.ok(all.some((r) => r.sel === sel && /box-shadow:[^;]*var\(--shadow/.test(r.body)), `${sel} keeps its shadow`);
  }
});

// Pattern A (row runs): rows that carry a border overlap by 1px; only the run's first and last row are rounded.
const RUN_C = '.run-list,.sched-list,.act-view,.pl-list,.pl-orphans,.pl-available,.pl-mkts,.grv-list,.mv-sec-body,.mcp-set,.hd-cl,.issues,.hd-ov-prs,.shape-feature-slices,.artifact-list,.report-optins,.xp-list,.ac-action-list,.ac-stack-list,.tp-cat-list,.wiz-proj-list,.grv-source-list,.mvx-step,.apick,.agent-ports-list,.agent-forms-list,.agent-forms-view,.pp-alts,.bench-col';
const RUN_R = '.card,.mv-builtin,.hd-cl-card,.issue,.hd-ov-pr,.shape-feature-slice,.artifact-row,.confirm-checkbox,.xp-row,.ac-action,.ac-stack,.tp-cat-item,.opt-row,.apick-run,.apick-art,.port-row,.agent-form-row,.afv-row,.pp-alt,.bench-port';

test('divided lists, pattern A: one row-run block names every boxed list', () => {
  const C = `:is(${RUN_C})`, R = `:is(${RUN_R})`;
  const find = (sel) => all.find((r) => r.sel === sel)?.body ?? null;
  // Longhands, not `border:` — test/ui-chat-run-card.test.mjs:750 reads border-color / border-width through jsdom,
  // which leaves the longhands of a var() shorthand empty.
  assert.match(find(`${C} > ${R}`) ?? '',
    /margin:0;border-width:1px;border-style:solid;border-color:var\(--line\);border-radius:0;box-shadow:none;/);
  assert.match(find(`${C} > ${R} + ${R}`) ?? '', /margin-top:-1px;/);
  assert.match(find(`${C} > ${R}:not(${R} + ${R})`) ?? '', /border-top-left-radius:var\(--r-md\);border-top-right-radius:var\(--r-md\);/);
  assert.match(find(`${C} > ${R}:not(:has(+ ${R}))`) ?? '', /border-bottom-left-radius:var\(--r-md\);border-bottom-right-radius:var\(--r-md\);/);
  assert.match(find(`:where(${RUN_C}) > :where(${RUN_R}):hover`) ?? '', /background:var\(--hover\)/);
});

/** Specificity [classes, elements] of a selector without ids: :is/:not/:has count their first argument (every
 *  argument of the lists used here is one class, so the first is the most specific), :where counts nothing. */
function spec(sel) {
  const s = sel.replace(/:where\([^()]*\)/g, '').replace(/:(?:is|not|has)\(([^(),]*)[^()]*\)/g, ' $1 ');
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, '').match(/(?:^|[\s>+~(])[a-z][\w-]*/g) ?? []).length;
  return [classes, elements];
}
const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];

test('divided lists, pattern A: row state rules win over the row rule', () => {
  const rowSel = `:is(${RUN_C}) > :is(${RUN_R})`;
  const blockAt = all.findIndex((r) => r.sel === rowSel);
  assert.ok(blockAt >= 0, 'the row rule exists');
  const row = spec(rowSel);
  for (const [sel, re] of [
    ['.sched-list > .sched-item.attention', /border-color:var\(--amber\)/],
    ['.pp-alts > .pp-alt.is-on', /border-color:var\(--ink-3\)/],
    ['.opt-row:has(input:checked)', /border-color:var\(--green\)/],
  ]) {
    const at = all.findIndex((r) => r.sel === sel && re.test(r.body));
    assert.ok(at >= 0, `${sel} exists`);
    assert.ok(at > blockAt || beats(spec(sel), row), `${sel} wins over the row rule`);
  }
  // The pre-#775 forms lose to the row rule; nothing may still rely on them.
  for (const sel of ['.sched-item.attention', '.pp-alt.is-on', '.opt-row:hover']) {
    assert.ok(!all.some((r) => r.sel === sel), `${sel} is gone`);
  }
});

test('divided lists, pattern A: no container rule that wins over the block brings a gap back', () => {
  // More specific than :is(…){gap:0} (0,1,0), or later in the file: each must say gap:0 itself (or set no gap).
  for (const sel of [':is(.rd-questions,.chat-rc-q) .issues', '.grv-wizard .grv-source-list',
    '.mv-section[data-section="builtin"] .mv-sec-body', '.shape-feature-slices']) {
    const bodies = all.filter((r) => r.sel === sel);
    assert.ok(bodies.length, `${sel} exists`);
    for (const r of bodies) assert.doesNotMatch(r.body, /(?:^|;)\s*gap:(?!0[;\s]|0$)/, sel);
  }
});

/** The radius a simple selector ends up with: the last radius declaration of any rule listing it exactly (by order). */
function lastRadius(simple) {
  let last = null;
  for (const r of all) {
    if (!r.sel.split(',').map((s) => s.trim()).includes(simple)) continue;
    for (const d of radii(r.body)) if (d.prop === 'border-radius') last = d.value;
  }
  return last;
}

test('divided lists, pattern B: flush rows are square, divided by --line, hover edge to edge', () => {
  // Per simple selector, so the implementer may edit a list's own rule or add a grouped one.
  const FLUSH = ['.rd-diff-row', '.afb-folder', '.afb-file', '.afb-main', '.runs-row', '.chat-home-chat',
    '.chat-home-plan-open', '.sched-feed-item', '.wfl-item', '.wfl-main', '.wfl-folder', '.mem-row', '.mcp-setrow',
    '.bench-case'];
  for (const sel of FLUSH) assert.equal(lastRadius(sel), '0', sel);
  for (const sel of ['.rd-diff-row + .rd-diff-row', '.sched-feed-item + .sched-feed-item',
    '.chat-home-chat-li + .chat-home-chat-li,.chat-home-plan + .chat-home-plan']) {
    assert.ok(all.some((r) => r.sel === sel && /border-top:1px solid var\(--line\)/.test(r.body)), sel);
  }
});
