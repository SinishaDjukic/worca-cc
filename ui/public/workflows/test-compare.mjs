// ui/public/workflows/test-compare.mjs — Compare (canvas board 5) and one example side by side (boards 6, 31; board 28's
// G2 one column; board 29's empty states), plus Read the whole result (plans/workflow-tests-part2-plan.md Task 14; C2,
// C10, C19, G2, G3, G9, G15). Pure DOM: app.js reads the server's models (service.compareOf / sideBySide) and owns the
// actions. A repaint keeps the focus on the same control (data-focus-key), and a button whose action is out stays busy
// across repaints (BUSY), as the progress page does.
import { el, btn } from './test-ui.mjs';
import { icon } from '../icons.mjs';
import { createDialog } from '../marketplace/layers.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { agoText, countsText, fmtDuration, pctDelta, durationDelta, countDelta, fmtTimes } from '../../../src/shared/workflow-tests/compare.mjs';
import { serverName } from '../../../src/shared/workflow-tests/connector-name.mjs';

const RESULT = { better: ['badge green', 'Better'], worse: ['badge red', 'Worse'], same: ['badge', 'Same'] };
const usdOr = (n) => (typeof n === 'number' && Number.isFinite(n) ? fmtUsd(n) : '—');
const timeOr = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? fmtDuration(ms) : '—');
const wrote = (label) => `What ${/^Your\b/.test(label) ? `y${label.slice(1)}` : label} wrote`;
const plural = (w) => (/(?:s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);
/** A test tries an example at most this often (src/core/workflow-tests/store.mjs MAX_TRIES): Try 3 more has no room above. */
const MAX_TRIES = 10;

/** N3: the count beside "Would have sent": "1 message, 1 issue", by what each call makes. */
export function sentCount(calls) {
  const by = new Map();
  for (const c of calls) by.set(c.noun, (by.get(c.noun) || 0) + 1);
  return [...by].map(([noun, n]) => `${n} ${n === 1 ? noun : plural(noun)}`).join(', ');
}

/** root → Map(busy key → { runId }) of the buttons whose action is still out (Try 3 more on two examples at once, say). */
const BUSY = new WeakMap();
const busyOf = (root) => { let m = BUSY.get(root); if (!m) { m = new Map(); BUSY.set(root, m); } return m; };
const keyed = (root, key) => [...root.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key) || null;
/** What a repaint takes away: the focused control, by its key. */
function heldFocus(root, doc) {
  const a = doc.activeElement;
  const had = !!a && a !== root && root.contains(a);
  return { had, key: had && a.dataset ? a.dataset.focusKey || null : null };
}
function giveFocusBack(root, doc, held) {
  if (!held.had || root.contains(doc.activeElement)) return;
  const again = held.key ? keyed(root, held.key) : null;
  (again && !again.disabled ? again : root).focus({ preventScroll: true });   // never <body>, where the canvas keys answer
}
/** A button with a focus key; with `busy`, disabled while its action is out, also on a page a frame repainted meanwhile.
 *  `busyKey` (default: the focus key) names the action: Read the whole result is busy per try, its focus per column. */
function act(doc, root, runId, label, fn, cls, key, { busy = false, busyKey = key } = {}) {
  const b = btn(doc, label, null, cls);
  b.dataset.focusKey = key;
  if (busy) b.dataset.busyKey = busyKey;
  const out0 = busyOf(root).get(busyKey);
  if (busy && out0 && out0.runId === runId) b.disabled = true;
  b.addEventListener('click', () => {
    if (b.disabled) return;
    if (!busy) { fn(); return; }
    b.disabled = true;
    const mine = { runId };
    busyOf(root).set(busyKey, mine);
    let out;
    try { out = fn(); } catch { out = null; }   // a throw gives the button back too
    Promise.resolve(out).catch(() => {}).finally(() => {
      const map = busyOf(root);
      if (map.get(busyKey) !== mine) return;
      map.delete(busyKey);
      // This button, or the one a repaint put in its place (none while another try shows).
      for (const n of root.querySelectorAll('[data-busy-key]')) if (n.dataset.busyKey === busyKey) n.disabled = false;
    });
  });
  return b;
}

const modeNote = (doc, name, text) => {
  const p = el(doc, 'p', 'wft-mode');
  p.append(icon(doc, name, 14), el(doc, 'span', '', text));
  return p;
};

/** Board 31: what one pretend try would have sent (C19), or what a real try did. null when the column has no try. */
function sentCard(doc, v, key) {
  if (!v) return null;
  if (v.connectors === 'real') {
    const c = el(doc, 'section', 'card wft-sent-real');
    c.append(modeNote(doc, 'plug', 'Connectors: real. This try used your real connectors.'));
    return c;
  }
  const c = el(doc, 'section', 'card wft-sent');
  const head = el(doc, 'div', 'wft-sent-head');
  const h = el(doc, 'h2', '', 'Would have sent');
  h.id = `wft-sent-${key}`;
  c.setAttribute('aria-labelledby', h.id);
  head.append(h);
  const sent = v.wouldHaveSent || [];
  if (sent.length) head.append(el(doc, 'span', 'hint', sentCount(sent)));
  c.append(head);
  for (const call of sent) {
    const d = el(doc, 'details', 'wft-call');
    const sum = el(doc, 'summary');
    const chev = icon(doc, 'chevron', 12, 'ic wft-call-chev');
    const line = el(doc, 'span', 'wft-call-line');
    line.append(el(doc, 'b', '', serverName(call.server)), el(doc, 'span', 'wft-call-what', ` · ${call.tool} · `),
      el(doc, 'span', 'wft-call-prev', call.to ? `to ${call.to}: "${call.preview}"` : `"${call.preview}"`));
    sum.append(chev, line);
    const full = el(doc, 'div', 'wft-call-full');
    full.append(el(doc, 'span', 'wft-call-cap', call.to ? `Full text · to ${call.to}` : 'Full text'), doc.createTextNode(call.full));
    d.append(sum, full);
    c.append(d);
  }
  if (!sent.length) c.append(el(doc, 'p', 'wft-sent-foot', 'Nothing would have been sent.'));
  for (const r of v.answeredReads || []) {
    c.append(el(doc, 'p', 'wft-sent-foot', `Worca also answered ${r.n === 1 ? '1 request' : `${r.n} requests`} in ${serverName(r.server)}: ${r.n === 1 ? 'it' : 'they'} came back empty.`));
  }
  return c;
}

function passed(doc, r) {
  const span = el(doc, 'span', 'wft-res');
  if (!r || !r.total) { span.classList.add('is-none'); span.textContent = 'Not tried'; return span; }
  const dot = el(doc, 'span', `wft-dot ${r.passed === r.total ? 'ok' : r.passed === 0 ? 'no' : 'mix'}`);
  dot.setAttribute('aria-hidden', 'true');
  span.append(dot, doc.createTextNode(`${r.passed} of ${r.total}`));
  return span;
}
const badge = (doc, result) => (result ? el(doc, 'span', RESULT[result][0], RESULT[result][1]) : el(doc, 'span', 'hint', '—'));

function tile(doc, label, value, sub, delta = null, note = null) {
  const t = el(doc, 'section', 'card wft-tile');
  const l = el(doc, 'div', 'wft-tile-label');
  l.append(el(doc, 'span', '', label));
  if (delta) l.append(el(doc, 'span', 'wft-tile-delta', delta));
  t.append(l, el(doc, 'div', 'wft-tile-value', value), el(doc, 'small', 'wft-tile-sub', sub));
  if (note) t.append(el(doc, 'small', 'wft-tile-note', note));
  return t;
}

/** The crumb above the title and its hint (boards 5, 6). */
function titles(doc, crumb, nameEl, hint) {
  const t = el(doc, 'div', 'wft-titles');
  t.append(crumb, nameEl, hint);
  return t;
}

/**
 * Board 5. `c` = GET …/runs/:run/compare: { run, title, labels: {a, b}, examples, costUsd, model, changes, fair }.
 * @param {{back:Function, testAgain:Function, open:(exampleId:number)=>void, tryMore:(exampleId:number)=>void|Promise}} actions
 */
export function renderCompare(root, c, actions, { doc, now = Date.now() }) {
  const held = heldFocus(root, doc);
  root.replaceChildren();
  const runId = c.run.id;
  const page = el(doc, 'div', 'wft-page wft-compare');
  const m = c.model;
  const A = c.labels.a || '—';
  const B = c.labels.b;
  const head = el(doc, 'div', 'wft-crumbs wft-pg-head');
  const when = c.run.status === 'stopped' ? 'stopped early' : `ready ${agoText(c.run.finishedAt, now)}`;
  const meta = el(doc, 'span', 'hint', `${countsText(c.examples, c.run.tries)} · ${when} · cost `);
  meta.append(el(doc, 'span', 'code', fmtUsd(c.costUsd)));
  head.append(titles(doc, act(doc, root, runId, 'Tests', () => actions.back(), 'wft-crumb', 'wft-cmp-back'), el(doc, 'h2', 'wft-title', c.title), meta));
  const acts = el(doc, 'div', 'wft-acts');
  acts.append(act(doc, root, runId, 'Test again', () => actions.testAgain(), 'btn', 'wft-cmp-again', { busy: true }));
  head.append(acts);
  page.append(head);

  if (m.inShort.length) {   // C2: the model's sentences; none when nothing compares (D38)
    const s = el(doc, 'section', 'wft-short');
    const box = el(doc, 'div');
    const h = el(doc, 'h2', '', 'In short');
    h.id = 'wft-short-h';
    s.setAttribute('aria-labelledby', h.id);
    const p = el(doc, 'p', '', m.inShort.join(' '));
    if (m.look) p.append(doc.createTextNode(` ${m.look.before}`), el(doc, 'b', '', m.look.name), doc.createTextNode(m.look.after));
    box.append(h, p);
    s.append(box);
    if (m.look) s.append(act(doc, root, runId, 'Look at it', () => actions.open(m.look.exampleId), 'btn', 'wft-cmp-look'));
    page.append(s);
  }

  const a = m.tiles.a || { passed: { passed: 0, total: 0 }, costPerTry: null, timePerTry: null, sentBack: null, steady: { n: 0, of: 0 } };
  const b = m.tiles.b;
  // The passed tile counts every finished try; the per-try tiles only the examples both versions finished. When the two
  // differ (a test stopped before every example was compared), the passed tile says so.
  const compared = m.examples.filter((r) => r.result !== null);
  const sum = (k) => compared.reduce((n, r) => n + r[k].total, 0);
  const apart = !!m.tiles.a && (sum('a') !== a.passed.total || sum('b') !== b.passed.total);
  const tiles = el(doc, 'div', 'wft-tiles');
  tiles.append(
    tile(doc, 'Tries passed', `${b.passed.passed} of ${b.passed.total}`, `${A}: ${a.passed.passed} of ${a.passed.total}`, countDelta(a.passed.passed, b.passed.passed),
      apart ? 'Counts every finished try.' : null),   // controller-approved copy (2026-10-27)
    tile(doc, 'Cost per try', usdOr(b.costPerTry), `${A}: ${usdOr(a.costPerTry)}`, pctDelta(a.costPerTry, b.costPerTry) || null),
    tile(doc, 'Time per try', timeOr(b.timePerTry), `${A}: ${timeOr(a.timePerTry)}`, durationDelta(a.timePerTry, b.timePerTry) || null),
    tile(doc, 'Sent back for fixes', fmtTimes(b.sentBack) || '—', `per try, on average · ${A}: ${fmtTimes(a.sentBack) || '—'}`),
    tile(doc, 'Steady results', `${b.steady.n} of ${b.steady.of}`, `examples with the same result in every try · ${A}: ${a.steady.n} of ${a.steady.of}`),
  );
  page.append(tiles);

  const cols = el(doc, 'div', 'wft-cmp-cols');   // board 5: By example beside What you changed
  const by = el(doc, 'section', 'wft-by');   // G9: one view, a heading, no one-tab switch
  const hb = el(doc, 'h2', 'wft-by-title', 'By example');
  hb.id = 'wft-by-h';
  by.setAttribute('aria-labelledby', hb.id);
  const table = el(doc, 'div', 'card wft-table');
  const scroll = el(doc, 'div', 'wft-scroll');
  const inner = el(doc, 'div', 'wft-crows2');
  const hr = el(doc, 'div', 'wft-crow2 is-head');
  hr.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', `${A} passed`), el(doc, 'span', '', `${B} passed`), el(doc, 'span', '', 'Result'));
  inner.append(hr);
  for (const r of m.examples) {
    const row = el(doc, 'div', 'wft-crow2');
    const cell = el(doc, 'span');
    cell.append(badge(doc, r.result));
    row.append(act(doc, root, runId, r.name, () => actions.open(r.id), 'wft-ex-open', `wft-cmp-ex-${r.id}`), passed(doc, r.a), passed(doc, r.b), cell);
    if (r.luck) {
      const why = el(doc, 'span', 'wft-why');
      const luck = `Might be luck: only ${Math.max(r.a.total, r.b.total)} tries.`;
      if (c.run.tries >= MAX_TRIES) why.textContent = luck;   // the most a test tries: the note stays, the button goes
      else {
        why.append(doc.createTextNode(`${luck} `),
          act(doc, root, runId, 'Try 3 more', () => actions.tryMore(r.id), 'wft-linkbtn', `wft-cmp-more-${r.id}`, { busy: true }));
      }
      row.append(why);
    } else if (r.why) {
      row.append(el(doc, 'span', 'wft-why', r.why));
    }
    inner.append(row);
  }
  scroll.append(inner);
  table.append(scroll);
  by.append(hb, table);
  cols.append(by);

  const ch = el(doc, 'section', 'card wft-changes');
  const hc = el(doc, 'h2', '', `What you changed since ${A}`);
  hc.id = 'wft-chg-h';
  ch.setAttribute('aria-labelledby', hc.id);
  ch.append(hc);
  if (c.changes.length) {
    for (const t of c.changes) {
      const line = el(doc, 'div', 'wft-chg');
      const ico = el(doc, 'span', 'wft-chg-ico');
      ico.setAttribute('aria-hidden', 'true');
      ico.append(icon(doc, 'diff', 13));
      line.append(ico, el(doc, 'span', '', t));
      ch.append(line);
    }
  } else {
    ch.append(el(doc, 'p', 'hint wft-nochange', 'No steps or settings changed.'));
  }
  const fair = el(doc, 'p', 'hint wft-fair-head');
  fair.append(el(doc, 'b', '', 'A fair comparison.'), doc.createTextNode(` Both versions were tried on the same ${c.examples === 1 ? 'example' : `${c.examples} examples`} and checked the same way. If that changes, for example after an example is edited, Worca says so here.`));
  ch.append(fair);
  for (const f of c.fair) {
    const p = el(doc, 'p', 'wft-fair');
    p.append(icon(doc, 'alert', 14), el(doc, 'span', '', f));
    ch.append(p);
  }
  cols.append(ch);
  page.append(cols);
  root.append(page);
  giveFocusBack(root, doc, held);
}

/** A result's text into `box`: rendered (and sanitized) by `renderMarkdown` when the app gives one, else as text. */
function resultInto(box, text, renderMarkdown) {
  if (typeof renderMarkdown === 'function') renderMarkdown(text, box);
  else box.textContent = text;
  return box;
}

/**
 * Board 6 (G2: one column after Try it once now). `s` = GET …/runs/:run/examples/:ex.
 * @param {{back:Function, pick:(index:number)=>void, readWhole:(tryId:number, title:string)=>void|Promise}} actions
 * @param {{renderMarkdown?: (text:string, mount:HTMLElement)=>void}} o the app's sandboxed markdown (ask-markdown.mjs), board 31's excerpt
 */
export function renderSideBySide(root, s, actions, { doc, tryIndex = 0, renderMarkdown = null }) {
  const held = heldFocus(root, doc);
  const live = root.querySelector('.wft-sbs-live') || el(doc, 'p', 'sr-only wft-sbs-live');
  live.setAttribute('aria-live', 'polite');
  root.replaceChildren();
  const runId = s.run.id;
  const page = el(doc, 'div', 'wft-page wft-detail');
  const once = s.run.kind === 'once' || !s.labels.a;
  const i = Math.min(Math.max(0, tryIndex), Math.max(0, s.tries.length - 1));
  const cur = s.tries[i] || null;
  const head = el(doc, 'div', 'wft-crumbs wft-pg-head');
  const name = el(doc, 'div', 'wft-detail-name');
  name.append(el(doc, 'h2', 'wft-title', s.example.name));
  if (!once && s.row.result) name.append(badge(doc, s.row.result));
  const counts = once
    ? `${s.labels.b} passed ${s.row.b.passed} of ${s.row.b.total} ${s.row.b.total === 1 ? 'try' : 'tries'}`
    : `${s.labels.a} passed ${s.row.a.passed} of ${s.row.a.total} tries · ${s.labels.b} passed ${s.row.b.passed} of ${s.row.b.total}`;
  head.append(titles(doc, act(doc, root, runId, once ? 'Tests' : s.compareTitle, () => actions.back(), 'wft-crumb', 'wft-sbs-back'),
    name, el(doc, 'span', 'hint', counts)));
  if (s.tries.length > 1) {
    const tabs = el(doc, 'div', 'seg wft-sbs-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Which try');
    const last = s.tries.length - 1;
    s.tries.forEach((t, k) => {
      const b = act(doc, root, runId, `Try ${t.n}`, () => actions.pick(k), k === i ? 'on' : '', `wft-sbs-try-${k}`);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', k === i ? 'true' : 'false');
      b.tabIndex = k === i ? 0 : -1;   // one tab stop; the arrow keys move between the tries
      b.addEventListener('keydown', (e) => {
        const to = e.key === 'ArrowRight' ? (k === last ? 0 : k + 1) : e.key === 'ArrowLeft' ? (k === 0 ? last : k - 1)
          : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
        if (to === null) return;
        e.preventDefault();
        actions.pick(to);
        // The repaint gave the focus back to the key it had (this tab, now out of the tab order): move it to the picked one.
        const next = keyed(root, `wft-sbs-try-${to}`);
        if (next) next.focus({ preventScroll: true });
      });
      tabs.append(b);
    });
    head.append(tabs);
  }
  page.append(head);
  if (s.connectors === 'pretend') page.append(modeNote(doc, 'shield', 'Connectors: pretend. Nothing was posted or sent.'));   // board 31
  if (!cur) {   // board 29
    page.append(el(doc, 'p', 'hint wft-empty-sbs', 'No finished try of this example in this test.'));
    root.append(page, live);
    if (live.textContent) live.textContent = '';
    giveFocusBack(root, doc, held);
    return;
  }

  const outs = el(doc, 'div', `wft-outs${once ? ' is-one' : ''}`);
  const out = (label, v, sideKey) => {
    const c = el(doc, 'section', 'card wft-card wft-out-card');
    const h = el(doc, 'h2', '', wrote(label));
    h.id = `wft-out-${sideKey}`;
    c.setAttribute('aria-labelledby', h.id);
    const ch = el(doc, 'div', 'wft-card-head');
    ch.append(h);
    if (v && v.text) {   // C10
      ch.append(act(doc, root, runId, 'Read the whole result', () => actions.readWhole(v.tryId, wrote(label)), 'wft-linkbtn', `wft-sbs-read-${sideKey}`,
        { busy: true, busyKey: `wft-sbs-read-${sideKey}-${v.tryId}` }));
    }
    c.append(ch);
    if (!v) c.append(el(doc, 'p', 'hint', 'No try of this version here.'));
    else if (!v.text) c.append(el(doc, 'p', 'hint', 'This try left no result.'));
    else {
      c.append(resultInto(el(doc, 'div', 'wft-out'), v.text, renderMarkdown));
      if (v.truncated) c.append(el(doc, 'p', 'hint', 'Shortened here: read the whole result.'));
    }
    return c;
  };
  // Board 31: each column is what that version wrote, then what it would have sent.
  const column = (label, v, key) => {
    const col = el(doc, 'div', 'wft-outcol');
    col.append(out(label, v, key));
    const sent = sentCard(doc, v, key);
    if (sent) col.append(sent);
    return col;
  };
  if (!once) outs.append(column(s.labels.a, cur.a, 'a'));
  outs.append(column(s.labels.b, cur.b, 'b'));
  page.append(outs);

  const sec = el(doc, 'section', 'card wft-table wft-checked');
  sec.setAttribute('aria-label', `What was checked in try ${cur.n}`);
  const scroll = el(doc, 'div', 'wft-scroll');
  const inner = el(doc, 'div', `wft-crows${once ? ' is-one' : ''}`);
  const cls = once ? 'wft-crow is-one' : 'wft-crow';
  const hr = el(doc, 'div', `${cls} is-head`);
  hr.append(el(doc, 'span', '', 'What was checked'));
  if (!once) hr.append(el(doc, 'span', '', `${s.labels.a} · try ${cur.n}`));
  hr.append(el(doc, 'span', '', `${s.labels.b} · try ${cur.n}`));
  inner.append(hr);
  const cell = (v, key, label) => {
    const it = v && v.verdict ? (v.verdict[key] || []).find((x) => x.label === label) : null;
    const span = el(doc, 'span', 'wft-res');
    if (!it) { span.classList.add('is-none'); span.textContent = '—'; return span; }
    if (!it.met) span.classList.add('is-bad');
    const d = el(doc, 'span', `wft-dot ${it.met ? 'ok' : 'no'}`);
    d.setAttribute('aria-hidden', 'true');
    span.append(d, doc.createTextNode(it.value));
    return span;
  };
  for (const [title, key] of [['Basics', 'basics'], ['Automatic checks', 'checks']]) {
    const labels = [];
    for (const v of [cur.a, cur.b]) for (const it of (v && v.verdict && v.verdict[key]) || []) if (!labels.includes(it.label)) labels.push(it.label);
    if (!labels.length) continue;
    inner.append(el(doc, 'div', 'wft-crow-grp', title));
    for (const label of labels) {
      const row = el(doc, 'div', cls);
      row.append(el(doc, 'span', '', label));
      if (!once) row.append(cell(cur.a, key, label));
      row.append(cell(cur.b, key, label));
      inner.append(row);
    }
  }
  scroll.append(inner);
  sec.append(scroll);
  page.append(sec);
  // Why a Basic was not met (a failed step, a question asked), as the server words it.
  for (const [label, v] of [[s.labels.a, cur.a], [s.labels.b, cur.b]]) {
    for (const it of (v && v.verdict && v.verdict.basics) || []) if (!it.met && it.detail) page.append(el(doc, 'p', 'hint wft-detail-why', `${label}: ${it.detail}`));
  }
  root.append(page, live);
  const said = s.tries.length > 1 ? `Try ${cur.n} of ${s.tries.length}` : '';
  if (live.textContent !== said) live.textContent = said;   // only a change is news
  giveFocusBack(root, doc, held);
}

/** "Read the whole result" (C10): the main result in full, in a large dialog. */
export function openWholeResult({ doc, win, title, name = null, text = null, renderMarkdown = null }) {
  const dlg = createDialog({ doc, win, width: 'lg', kind: 'viewer' });
  const h = el(doc, 'h2', 'mk-dialog-title', title);
  h.id = 'mk-dialog-title';
  const body = [];
  if (name) body.push(el(doc, 'p', 'hint', name));
  if (!text) body.push(el(doc, 'p', 'hint', 'This try left no result.'));
  else body.push(renderMarkdown ? resultInto(el(doc, 'div', 'wft-whole'), text, renderMarkdown) : el(doc, 'pre', 'wft-whole', text));
  dlg.replace({ head: [h], body, foot: [btn(doc, 'Close', () => dlg.close(), 'btn')] });
  dlg.open();
  return dlg;
}
