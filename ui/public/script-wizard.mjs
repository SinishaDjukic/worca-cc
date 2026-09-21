// ui/public/script-wizard.mjs
// The two steps of the script wizard (script-wizard plan S1, S9, S11, S16, S20):
// the runtime picker and the split workspace — identity, the interface read
// from the code, the advanced disclosure, the editor and the bench mount. Pure
// renderers returning DETACHED DOM (the script-forms.mjs posture); the page
// controller in scripts-view.mjs binds the listeners and repaints the
// Interface panel in place on every debounce. Every string is textContent;
// the ONE innerHTML sink is svgIcon, fed by the fixed set, the ƒ glyph, or a
// saved fragment that passed sanitizeIcon.
import { h, text, textarea, number } from './script-forms.mjs';
import { createCodeEditor, escapeHtml } from './code-editor.mjs';
import { sanitizeIcon } from '../../src/shared/graph/manifest.mjs';
import { SCRIPT_ICONS, SCRIPT_GLYPH, iconNameOf, iconSvgOf } from '../../src/shared/graph/script-icons.mjs';
import { SCRIPT_COLORS, SCRIPT_RUNTIMES, SCRIPT_KEY_RE } from '../../src/shared/graph/script-meta.mjs';
import { RUNTIME_DEFAULTS } from '../../src/shared/graph/script-templates.mjs';
import { WHEN_LABEL, CHIP_PARAM_TYPES, interfaceToMeta } from '../../src/shared/graph/script-infer.mjs';

export const EDITOR_LANGUAGE = Object.freeze({ node: 'javascript', shell: 'bash', python: 'python' });
export const RUNTIME_LABEL = Object.freeze({ node: 'Node.js', python: 'Python', shell: 'Shell' });
const RUNTIME_LINE = Object.freeze({
  node: 'A JavaScript module. Runs everywhere worca runs, nothing to install.',
  python: 'A Python function. Same inputs and outputs, handed in as one object.',
  shell: 'A command or script. Exit 0 passes, exit 1 fails. Ports arrive as env vars.',
});
const RUNTIME_SIG = Object.freeze({ node: 'export default async function (api)', python: 'def main(api)', shell: '$WORCA_IN_PLAN → $WORCA_OUT_LOG' });
const EXT = Object.freeze({ node: '.mjs', python: '.py', shell: '.sh' });
/** The mono hint an empty zone shows: how THIS runtime declares a port (S19). */
export const IFACE_HINTS = Object.freeze({
  node: Object.freeze({ in: 'none yet · read inputs.<name>.path', out: 'none yet · write outputs.<name>.path', param: 'none yet · read params.<name>' }),
  python: Object.freeze({ in: 'none yet · read api.inputs.<name>.path', out: 'none yet · write api.outputs.<name>.path', param: 'none yet · read api.params.<name>' }),
  shell: Object.freeze({ in: 'none yet · read $WORCA_IN_<NAME>', out: 'none yet · write $WORCA_OUT_<NAME>', param: 'none yet · read $WORCA_PARAM_<NAME>' }),
});

/** 'builtin' -> 'built-in', 'plugin:tools' -> 'tools'. (Moved from scripts-view.mjs.) */
export function originLabel(origin) {
  const o = String(origin || '');
  if (o.startsWith('plugin:')) return o.slice('plugin:'.length);
  return o === 'user' ? 'user' : 'built-in';
}

// A sidecar's `command` is a string or a per-platform map { default, win32, … }.
// The editor holds the DEFAULT entry; the other entries ride a hidden field so a
// save never flattens the map. (Moved from scripts-view.mjs.)
export const commandText = (c) => (typeof c === 'string' ? c : (c && typeof c.default === 'string' ? c.default : ''));
export const commandExtra = (c) => {
  if (!c || typeof c !== 'object') return '';
  const { default: _d, ...rest } = c;
  return Object.keys(rest).length ? JSON.stringify(rest) : '';
};
export function joinCommand(textValue, extraJson) {
  let extra = {};
  try { extra = extraJson ? JSON.parse(extraJson) : {}; } catch { extra = {}; }
  return extra && typeof extra === 'object' && Object.keys(extra).length ? { default: textValue, ...extra } : textValue;
}
/** A shell script edits a FILE when its meta names one, a command otherwise. */
export const shellMode = (meta) => (meta.runtime === 'shell' && !meta.file ? 'command' : 'file');
const csv = (list) => (Array.isArray(list) ? list.join(', ') : '');
// A BLANK entry is no exit code (`Number('')` is 0, which would list 0 as both clean and blocking).
const ints = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number).filter((n) => Number.isInteger(n));

const btn = (doc, cls, label, kind = 'btn-ghost') => { const b = h(doc, 'button', `btn ${kind} btn-mini ${cls}`, label); b.type = 'button'; return b; };
const chip = (doc, cls, label) => h(doc, 'span', `chip ${cls}`, label);
const hidden = (doc, field, value) => { const i = doc.createElement('input'); i.type = 'hidden'; i.dataset.field = field; i.value = value == null ? '' : String(value); return i; };

/** A 24×24 stroke svg around a TRUSTED fragment (the set's, the glyph, or one that passed sanitizeIcon).
 *  `name` rides as data-icon-name: the set's name, 'glyph' or 'custom' — what a test can read back
 *  (jsdom re-serializes a self-closed <path/> as <path></path>, so innerHTML is not comparable). */
function svgIcon(doc, fragment, size, name = 'custom') {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.dataset.iconName = name;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = fragment;   // the ONE innerHTML in this module; every caller passes a trusted fragment
  return svg;
}
/** What a stored icon renders as: the set's fragment, else the saved one through the allowlist, else the ƒ. */
function safeIcon(icon) {
  const named = iconNameOf(icon);
  if (named) return { svg: iconSvgOf(named), name: named };
  const clean = sanitizeIcon(String(icon || ''));
  return clean ? { svg: clean, name: 'custom' } : { svg: SCRIPT_GLYPH, name: 'glyph' };
}
const safeColor = (c) => (SCRIPT_COLORS.includes(c) ? c : 'amber');

function probeChip(doc, rt, probe) {
  // process.version arrives as `v22.13.0`: one `v`, not `Node v22`.
  if (rt === 'node') return chip(doc, 'chip-ok rt-probe', probe && probe.version ? `Node ${String(probe.version).replace(/^v/, '')} · ready` : 'Node · ready');
  if (rt === 'python') {
    if (probe && probe.ok === false) return chip(doc, 'chip-warn rt-probe', 'python not found');
    return chip(doc, 'chip-ok rt-probe', probe && probe.version ? `Python ${probe.version} found` : 'Python found');
  }
  return chip(doc, 'chip-muted rt-probe', 'sh · cmd.exe on Windows');
}

/** The `1 Runtime › 2 Build & test` track. Step 1's pill is a BUTTON on step 2 (back to the picker). */
function stepTrack(doc, { step, runtime = '' }) {
  const track = h(doc, 'div', 'wz-track');
  const one = h(doc, 'button', `wz-step-pill ${step === 1 ? 'on' : 'done'}`);
  one.type = 'button'; one.dataset.step = '1'; one.disabled = step === 1;
  one.append(h(doc, 'span', 'wz-step-n', step === 1 ? '1' : '✓'), doc.createTextNode('Runtime'));
  if (step === 2 && runtime) one.appendChild(chip(doc, `chip-rt chip-${runtime}`, RUNTIME_LABEL[runtime] || runtime));
  track.appendChild(one);
  track.appendChild(h(doc, 'span', 'wz-step-sep', '›'));
  const two = h(doc, 'span', `wz-step-pill${step === 2 ? ' on' : ''}`);
  two.append(h(doc, 'span', 'wz-step-n', '2'), doc.createTextNode('Build & test'));
  track.appendChild(two);
  return track;
}

/** Step 1 (S16): three cards from the runtimes probe, Cancel, Continue. */
export function renderRuntimeStep({ doc = globalThis.document, runtimes = {}, picked = 'node' } = {}) {
  const root = h(doc, 'div', 'wz wz-step-1');
  root.dataset.step = '1';
  const bar = h(doc, 'div', 'wz-bar');
  bar.append(stepTrack(doc, { step: 1 }), h(doc, 'span', 'sp'), btn(doc, 'wz-cancel', 'Cancel'));
  root.appendChild(bar);
  const pick = h(doc, 'div', 'wz-pick');
  const title = h(doc, 'div', 'wz-pick-title');
  title.append(h(doc, 'h1', '', 'New script'), h(doc, 'small', 'wz-pick-line', 'Pick what runs it. Everything else is read from the code.'));
  pick.appendChild(title);
  const cards = h(doc, 'div', 'wz-rt-cards');
  for (const rt of SCRIPT_RUNTIMES) {
    const probe = runtimes[rt] || {};
    const on = rt === picked;
    const card = h(doc, 'button', `rt${on ? ' sel' : ''}`);
    card.type = 'button'; card.dataset.runtime = rt; card.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (probe.ok === false) { card.disabled = true; card.title = probe.reason || 'not available on this machine'; }
    const head = h(doc, 'span', 'rt-head');
    const tile = h(doc, 'span', `tile tile-${RUNTIME_DEFAULTS[rt].color}`);
    tile.appendChild(svgIcon(doc, iconSvgOf(RUNTIME_DEFAULTS[rt].icon), 24, RUNTIME_DEFAULTS[rt].icon));
    head.appendChild(tile);
    if (on) head.appendChild(h(doc, 'span', 'rt-check', '✓'));
    card.append(head, h(doc, 'span', 'rt-name', RUNTIME_LABEL[rt]), h(doc, 'small', 'rt-line', RUNTIME_LINE[rt]),
      h(doc, 'code', 'rt-sig mono', RUNTIME_SIG[rt]), probeChip(doc, rt, probe));
    cards.appendChild(card);
  }
  pick.appendChild(cards);
  const foot = h(doc, 'div', 'wz-pick-foot');
  const go = btn(doc, 'wz-continue', 'Continue', 'btn-primary');
  go.disabled = Boolean(runtimes[picked] && runtimes[picked].ok === false);
  foot.appendChild(go);
  pick.appendChild(foot);
  root.appendChild(pick);
  return root;
}

/** The card exactly as the palette and the canvas will show it (S9). */
export function renderTile({ doc = globalThis.document, name = '', key = '', runtime = 'node', color = 'amber', icon = '' } = {}) {
  const tile = h(doc, 'div', 'panel wz-tile');
  const box = h(doc, 'div', `tile tile-${safeColor(color)}`);
  const safe = safeIcon(icon);
  box.appendChild(svgIcon(doc, safe.svg, 22, safe.name));
  tile.appendChild(box);
  const txt = h(doc, 'div', 'wz-tile-text');
  txt.appendChild(h(doc, 'div', `pv-name${name ? '' : ' muted'}`, name || 'Untitled script'));
  const line = h(doc, 'div', 'wz-tile-line');
  line.append(h(doc, 'span', 'pv-key mono', key || 'key'), chip(doc, `chip-rt chip-${runtime}`, RUNTIME_LABEL[runtime] || runtime), chip(doc, 'chip-muted', '$0 per run'));
  txt.appendChild(line);
  tile.appendChild(txt);
  return tile;
}

function identityPanel(doc, meta, { readOnly, isNew }) {
  const panel = h(doc, 'div', 'panel wz-identity');
  const row = h(doc, 'div', 'wz-row');
  const name = text(doc, 'wz-f', 'meta:displayName', 'Name', meta.displayName);
  name.querySelector('input').placeholder = 'Run tests';
  const key = text(doc, 'wz-f', 'meta:key', 'Key', meta.key);
  const keyInput = key.querySelector('input');
  keyInput.classList.add('mono'); keyInput.placeholder = 'runTests'; keyInput.disabled = !isNew;
  row.append(name, key);
  panel.appendChild(row);
  const desc = textarea(doc, 'wz-f', 'meta:description', 'Description', meta.description, 2);
  const ta = desc.querySelector('textarea');
  ta.classList.remove('mono'); ta.placeholder = 'What it does, in one line.';
  panel.appendChild(desc);
  const colors = h(doc, 'div', 'wz-f');
  colors.appendChild(h(doc, 'span', 'ins-label', 'Color'));
  const sw = h(doc, 'div', 'wz-swatches');
  const current = safeColor(meta.color);
  for (const c of SCRIPT_COLORS) {
    const b = h(doc, 'button', `sw sw-${c}${c === current ? ' sel' : ''}`);
    b.type = 'button'; b.dataset.swatch = c; b.setAttribute('aria-label', c); b.setAttribute('aria-pressed', c === current ? 'true' : 'false');
    sw.appendChild(b);
  }
  colors.appendChild(sw);
  panel.appendChild(colors);
  const icons = h(doc, 'div', 'wz-f');
  icons.appendChild(h(doc, 'span', 'ins-label', 'Icon'));
  const grid = h(doc, 'div', 'wz-icons');
  const picked = iconNameOf(meta.icon);
  for (const { name: n, svg } of SCRIPT_ICONS) {
    const b = h(doc, 'button', `ico${n === picked ? ' sel' : ''}`);
    b.type = 'button'; b.dataset.icon = n; b.setAttribute('aria-label', n); b.setAttribute('aria-pressed', n === picked ? 'true' : 'false');
    b.appendChild(svgIcon(doc, svg, 18, n));
    grid.appendChild(b);
  }
  icons.appendChild(grid);
  panel.appendChild(icons);
  panel.append(hidden(doc, 'meta:color', current), hidden(doc, 'meta:icon', meta.icon || ''), hidden(doc, 'meta:runtime', meta.runtime || 'node'));
  if (readOnly) for (const c of panel.querySelectorAll('input:not([type="hidden"]),textarea,button')) c.disabled = true;
  return panel;
}

/** A ports:"config" script's defaultPorts as inert rows (S8). */
function configRows(defaultPorts) {
  const dp = defaultPorts || { inputs: [], outputs: [] };
  return {
    inputs: (dp.inputs || []).filter((p) => p && p.id).map((p) => ({ id: p.id, type: p.type || 'md', mode: p.loop ? 'loop' : (p.required === false ? 'optional' : 'required'), inCode: true })),
    outputs: (dp.outputs || []).filter((p) => p && p.id).map((p) => ({ id: p.id, type: p.type || 'md', when: p.when || 'always', filename: p.filename || '', inCode: true })),
  };
}

/**
 * The Interface panel (S3–S8, S20). Repainted IN PLACE by the controller on every
 * debounce and every chip click; `rows` is Task 1's Rows. `verdictFilename` is
 * the sidecar's, handed in explicitly so a re-render never loses it.
 */
export function renderInterfacePanel({
  doc = globalThis.document, runtime = 'node', key = '', rows = null, verdict = false, routing = false, readOnly = false,
  configPorts = false, defaultPorts = null, verdictFilename = '',
} = {}) {
  const panel = h(doc, 'div', 'panel wz-iface');
  const head = h(doc, 'div', 'wz-iface-head');
  head.append(h(doc, 'span', 'wz-panel-title', 'Interface'), chip(doc, 'chip-muted', configPorts ? 'ports per card' : 'read from the code'));
  panel.appendChild(head);
  const base = rows || { inputs: [], outputs: [], params: [] };
  // A config script's params are the sidecar's (the runner reads them, not the program): never `not in code`.
  const r = configPorts ? { ...configRows(defaultPorts), params: (base.params || []).map((p) => ({ ...p, inCode: true })) } : base;
  const portInert = readOnly || configPorts;
  const hints = IFACE_HINTS[runtime] || IFACE_HINTS.node;
  const hasVerdict = runtime === 'shell' ? (routing || verdict) : verdict;
  const side3 = (side) => (side === 'inputs' ? 'in' : side === 'outputs' ? 'out' : 'param');
  const tchip = (dataChip, label, cls, inert) => { const b = h(doc, 'button', `tchip${cls ? ` ${cls}` : ''}`, label); b.type = 'button'; b.dataset.chip = dataChip; b.disabled = inert; return b; };
  const prow = (side, row) => {
    const el = h(doc, 'div', `wz-prow${row.inCode === false ? ' stale' : ''}`);
    el.dataset.side = side; el.dataset.id = row.id;
    el.appendChild(h(doc, 'span', 'pid mono', row.id));
    return el;
  };
  const trailer = (el, side, row, inert) => {
    el.appendChild(h(doc, 'span', 'sp'));
    if (row.inCode === false) {
      el.appendChild(chip(doc, 'chip-warn chip-tiny', 'not in code'));
      if (!inert) { const x = h(doc, 'button', 'wz-prm', '×'); x.type = 'button'; x.dataset.remove = `${side}:${row.id}`; x.title = 'Remove'; el.appendChild(x); }
    }
    el.appendChild(hidden(doc, `iface:${side3(side)}:${row.id}:inCode`, row.inCode === false ? '' : '1'));
  };
  const zone = (label, extra = null) => { const z = h(doc, 'div', 'wz-zone-head'); z.appendChild(h(doc, 'span', 'zone', label)); if (extra) z.appendChild(extra); panel.appendChild(z); };

  zone('Inputs');
  if (!r.inputs.length) panel.appendChild(h(doc, 'div', 'empty mono', hints.in));
  for (const row of r.inputs) {
    const el = prow('inputs', row);
    el.append(tchip(`in:${row.id}:type`, row.type, row.type === 'void' ? 'void' : '', portInert),
      tchip(`in:${row.id}:mode`, row.mode || 'optional', 'mode', portInert),
      hidden(doc, `iface:in:${row.id}:type`, row.type), hidden(doc, `iface:in:${row.id}:mode`, row.mode || 'optional'));
    trailer(el, 'inputs', row, portInert);
    panel.appendChild(el);
  }

  const vchip = hasVerdict
    ? chip(doc, 'chip-ok chip-tiny wz-verdict-chip', `routes on pass / fail · ${runtime === 'shell' && !verdict ? 'from the exit code' : 'returned by the script'}`)
    : null;
  zone('Outputs', vchip);
  if (!r.outputs.length) panel.appendChild(h(doc, 'div', 'empty mono', hints.out));
  for (const row of r.outputs) {
    const el = prow('outputs', row);
    el.appendChild(tchip(`out:${row.id}:type`, row.type, row.type === 'void' ? 'void' : '', portInert));
    if (hasVerdict) el.appendChild(tchip(`out:${row.id}:when`, WHEN_LABEL[row.when] || 'always', 'when', portInert));
    el.append(hidden(doc, `iface:out:${row.id}:type`, row.type), hidden(doc, `iface:out:${row.id}:when`, row.when || 'always'),
      hidden(doc, `iface:out:${row.id}:filename`, row.filename || ''));
    trailer(el, 'outputs', row, portInert);
    panel.appendChild(el);
  }
  if (runtime === 'shell' && !configPorts) {
    const tog = h(doc, 'div', 'wz-routing');
    const b = h(doc, 'button', `tog${routing ? ' on' : ''}`);
    b.type = 'button'; b.dataset.routing = ''; b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', routing ? 'true' : 'false'); b.setAttribute('aria-label', 'Route by exit code'); b.disabled = readOnly;
    tog.append(b, h(doc, 'span', 'wz-routing-line', 'exit 0 → pass · exit 1 → fail'));
    panel.appendChild(tog);
  }

  zone('Params');
  if (!r.params.length) panel.appendChild(h(doc, 'div', 'empty mono', hints.param));
  for (const row of r.params) {
    const el = prow('params', row);
    const fixed = row.fixed === true || !CHIP_PARAM_TYPES.includes(row.type);
    el.appendChild(tchip(`param:${row.id}:type`, row.type, fixed ? 'fixed' : '', readOnly || fixed));
    const dflt = doc.createElement('input');
    dflt.type = 'text'; dflt.className = 'wz-pdflt mono'; dflt.dataset.field = `iface:param:${row.id}:default`;
    dflt.value = row.default === undefined || row.default === null ? '' : String(row.default);
    dflt.placeholder = 'default'; dflt.setAttribute('aria-label', `Default for ${row.id}`); dflt.disabled = readOnly;
    el.appendChild(dflt);
    const extra = {};
    for (const f of ['required', 'label', 'options', 'language', 'description']) if (row[f] !== undefined) extra[f] = row[f];
    extra.fixed = fixed;
    el.append(hidden(doc, `iface:param:${row.id}:type`, row.type), hidden(doc, `iface:param:${row.id}:extra`, JSON.stringify(extra)));
    trailer(el, 'params', row, readOnly);
    panel.appendChild(el);
  }

  panel.append(hidden(doc, 'iface:verdict', verdict ? '1' : ''), hidden(doc, 'iface:routing', routing ? '1' : ''),
    hidden(doc, 'iface:verdictFilename', verdictFilename || ''),
    hidden(doc, 'iface:config', configPorts ? JSON.stringify(defaultPorts || { inputs: [], outputs: [] }) : ''));
  return panel;
}

/** The Advanced disclosure's one-line summary (S11): `10 min timeout · general · order 50`. Exported so the
 *  controller can keep it in step with the three fields as they are typed. */
export function advSummary(meta) {
  const timeoutSec = Math.round((meta.timeoutMs || 600000) / 1000);
  const order = Number.isFinite(meta.order) ? meta.order : 50;
  return `${Math.max(1, Math.round(timeoutSec / 60))} min timeout · ${meta.domain || 'general'} · order ${order}`;
}

function advancedPanel(doc, meta, { readOnly, advOpen, verdictFile }) {
  const panel = h(doc, 'div', 'panel wz-adv');
  const toggle = h(doc, 'button', 'wz-adv-toggle');
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', advOpen ? 'true' : 'false');
  const timeoutSec = Math.round((meta.timeoutMs || 600000) / 1000);
  const order = Number.isFinite(meta.order) ? meta.order : 50;
  toggle.append(h(doc, 'span', `chev${advOpen ? ' open' : ''}`, '›'), h(doc, 'span', 'wz-panel-title', 'Advanced'), h(doc, 'span', 'wz-adv-sum', advSummary(meta)));
  panel.appendChild(toggle);
  const body = h(doc, 'div', 'wz-adv-body');
  body.hidden = !advOpen;
  body.append(number(doc, 'wz-f', 'meta:timeoutSec', 'Timeout (s)', timeoutSec, 1), text(doc, 'wz-f', 'meta:domain', 'Domain', meta.domain || ''),
    number(doc, 'wz-f', 'meta:order', 'Order in the palette', order, 0));
  const vf = h(doc, 'div', 'ins-f wz-f');
  vf.append(h(doc, 'span', 'ins-label', 'Verdict file'), h(doc, 'code', 'wz-verdict-file mono', verdictFile || '—'));
  body.appendChild(vf);
  if (meta.runtime === 'shell') {
    const codes = meta.exitCodes || {};
    body.append(text(doc, 'wz-f', 'meta:exitCodesClean', 'Clean exit codes', csv(codes.clean || [0])),
      text(doc, 'wz-f', 'meta:exitCodesBlocking', 'Blocking exit codes', csv(codes.blocking || [1])));
  }
  if (readOnly) for (const c of body.querySelectorAll('input')) c.disabled = true;
  panel.appendChild(body);
  return panel;
}

/**
 * The editor panel alone (S15): the file name, the runtime chip, a shell script's
 * Command | File and sh | win32 controls, Load example, the code editor and the
 * hidden mirrors of the halves that are not on screen. Exported so the controller
 * can swap ONLY this panel on a mode / tab hop — the bench under it (a run in
 * flight, its result, the typed inputs) stays mounted.
 */
export function renderEditorPanel(doc, data, { readOnly, highlight, srcMode, srcTab, editors, onSourceInput, key }) {
  const meta = data.meta;
  const rt = meta.runtime || 'node';
  const panel = h(doc, 'div', 'panel wz-editor script-source');   // .script-source: the controller reads dataset.srcMode off it
  panel.dataset.srcMode = srcMode; panel.dataset.srcTab = srcTab;
  const head = h(doc, 'div', 'wz-ed-head');
  const command = rt === 'shell' && srcMode === 'command';
  const win32 = srcMode === 'file' && srcTab === 'win32';
  head.append(h(doc, 'span', 'wz-file mono', command ? 'command' : `${key || 'script'}${win32 ? '.cmd' : EXT[rt]}`), chip(doc, `chip-rt chip-${rt}`, RUNTIME_LABEL[rt]));
  if (rt === 'shell') {
    const seg = h(doc, 'div', 'seg script-src-mode');
    for (const [mode, label] of [['command', 'Command'], ['file', 'File']]) {
      const b = h(doc, 'button', mode === srcMode ? 'on' : '', label);
      b.type = 'button'; b.dataset.srcMode = mode; b.disabled = readOnly; b.setAttribute('aria-pressed', mode === srcMode ? 'true' : 'false');
      seg.appendChild(b);
    }
    head.appendChild(seg);
    if (srcMode === 'file') {
      const plat = h(doc, 'div', 'seg script-src-plat');
      for (const [id, label] of [['default', 'sh'], ['win32', 'win32']]) {
        const b = h(doc, 'button', id === srcTab ? 'on' : '', label);
        b.type = 'button'; b.dataset.srcTab = id; b.disabled = readOnly; b.setAttribute('aria-pressed', id === srcTab ? 'true' : 'false');
        plat.appendChild(b);
      }
      head.appendChild(plat);
    }
  }
  head.appendChild(h(doc, 'span', 'sp'));
  if (!readOnly) head.appendChild(btn(doc, 'wz-example', 'Load example'));
  panel.appendChild(head);
  const editor = createCodeEditor({
    doc,
    value: command ? commandText(meta.command) : (win32 ? data.sourceWin32 : data.source),
    language: command ? 'bash' : (EDITOR_LANGUAGE[rt] || 'javascript'),
    readOnly,
    rows: command ? 4 : 18,
    name: command ? 'meta:command' : (win32 ? 'script:sourceWin32' : 'script:source'),
    highlight,
    onInput: typeof onSourceInput === 'function' ? onSourceInput : null,
  });
  editors.push(editor);
  const mount = h(doc, 'div', 'script-editor-mount');
  mount.appendChild(editor.el);
  panel.appendChild(mount);
  // The half that is not on screen still reaches the server on Save (the hidden-mirror idiom).
  for (const [name, value] of [['script:source', data.source], ['script:sourceWin32', data.sourceWin32],
    ['meta:command', commandText(meta.command)], ['meta:commandExtra', commandExtra(meta.command)]]) {
    if (panel.querySelector(`[data-field="${name}"]`)) continue;
    panel.appendChild(hidden(doc, name, value || ''));
  }
  return panel;
}

function wsHead(doc, meta, { readOnly, isNew, runtimes, sourcePath }) {
  const bar = h(doc, 'div', 'wz-bar wz-head');
  bar.appendChild(btn(doc, 'script-back', 'Scripts'));
  const track = stepTrack(doc, { step: 2, runtime: meta.runtime || 'node' });
  if (readOnly) track.querySelector('.wz-step-pill[data-step="1"]').disabled = true;
  bar.appendChild(track);
  if (meta.origin && meta.origin !== 'user') bar.appendChild(h(doc, 'span', 'badge script-origin', originLabel(meta.origin)));
  const probe = runtimes && runtimes[meta.runtime];
  if (meta.runtime === 'python' && probe && probe.ok === false) bar.appendChild(chip(doc, 'script-warn', 'python not found'));
  bar.appendChild(h(doc, 'span', 'sp'));
  const dirty = chip(doc, 'script-dirty', 'unsaved');
  dirty.hidden = true;
  bar.appendChild(dirty);
  if (readOnly) {
    const row = h(doc, 'span', 'script-path-row');
    row.append(h(doc, 'code', 'script-path mono', sourcePath || meta.scriptPath || meta.commandResolved || ''), btn(doc, 'script-copy', 'Copy'));
    bar.appendChild(row);
  }
  if (!isNew) bar.appendChild(btn(doc, 'script-duplicate', 'Duplicate'));
  if (!isNew && meta.origin === 'user') bar.appendChild(btn(doc, 'script-delete', 'Delete', 'btn-danger'));
  if (!readOnly) {
    const save = btn(doc, 'script-save', isNew ? 'Save script' : 'Save', 'btn-primary');
    save.disabled = !String(meta.displayName || '').trim() || !SCRIPT_KEY_RE.test(String(meta.key || ''));
    bar.appendChild(save);
  }
  return bar;
}

/**
 * Step 2 (S1): the whole workspace. `rows` / `verdict` / `routing` are the
 * controller's interface state; `onSourceInput(text)` is the editor's live hook.
 * `root._editors` carries the code editors so the caller can tear them down.
 */
export function renderWorkspace(data, {
  doc = globalThis.document, runtimes = {}, readOnly = false, isNew = false, highlight = async (t) => escapeHtml(t),
  srcMode = '', srcTab = 'default', rows = null, verdict = false, routing = false, advOpen = false, onSourceInput = null,
  verdictFilename = null,     // the SIDECAR's verdict filename; null = read it off data.meta
} = {}) {
  const meta = data.meta;
  const editors = [];
  const root = h(doc, 'div', 'script-detail wz wz-step-2');
  root.dataset.scriptKey = meta.key || ''; root.dataset.step = '2'; root._editors = editors;
  root.appendChild(wsHead(doc, meta, { readOnly, isNew, runtimes, sourcePath: data.sourcePath || '' }));
  const body = h(doc, 'div', 'wz-body');
  const left = h(doc, 'div', 'wz-left');
  left.appendChild(renderTile({ doc, name: meta.displayName, key: meta.key, runtime: meta.runtime, color: meta.color, icon: meta.icon }));
  left.appendChild(identityPanel(doc, meta, { readOnly, isNew }));
  const configPorts = meta.ports === 'config';
  const hasVerdict = meta.runtime === 'shell' ? (routing || verdict) : verdict;
  const savedVerdict = verdictFilename !== null ? String(verdictFilename || '') : ((meta.verdict && meta.verdict.filename) || '');
  left.appendChild(renderInterfacePanel({ doc, runtime: meta.runtime, key: meta.key, rows, verdict, routing, readOnly, configPorts,
    defaultPorts: configPorts ? meta.defaultPorts : null, verdictFilename: savedVerdict }));
  left.appendChild(advancedPanel(doc, meta, { readOnly, advOpen, verdictFile: hasVerdict || (configPorts && savedVerdict) ? (savedVerdict || `${meta.key || 'script'}-cycle{cycle}.json`) : '' }));
  const right = h(doc, 'div', 'wz-right');
  right.appendChild(renderEditorPanel(doc, data, { readOnly, highlight, srcMode: srcMode || shellMode(meta), srcTab, editors, onSourceInput, key: meta.key }));
  right.appendChild(h(doc, 'div', 'script-test-mount'));
  body.append(left, right);
  root.appendChild(body);
  return root;
}

/** Read the workspace back as the wire body `POST /api/scripts` / `PUT` take (S17, S20). Pure over `root`. */
export function collectScriptDraft(root) {
  const val = (name, scope = root) => { const n = scope.querySelector(`[data-field="${name}"]`); return n ? String(n.value) : ''; };
  // A CLEARED box is '' and Number('') is 0: blank = the default, never a 1 s timeout or order 0.
  const num = (name, fallback) => { const raw = val(name).trim(); const n = Number(raw); return raw !== '' && Number.isFinite(n) ? n : fallback; };
  const runtime = val('meta:runtime') || 'node';
  const key = (val('meta:key') || root.dataset.scriptKey || '').trim();
  const meta = {
    key, metaVersion: 2, displayName: val('meta:displayName'), description: val('meta:description'), domain: val('meta:domain'),
    color: val('meta:color') || 'amber', icon: val('meta:icon'), order: num('meta:order', 50), runtime,
    timeoutMs: Math.max(1000, Math.round(num('meta:timeoutSec', 600) * 1000)),
  };
  const iface = root.querySelector('.wz-iface') || root;
  const rows = { inputs: [], outputs: [], params: [] };
  for (const el of iface.querySelectorAll('.wz-prow')) {
    const { side, id } = el.dataset;
    const pre = side === 'inputs' ? 'in' : side === 'outputs' ? 'out' : 'param';
    const f = (name) => val(`iface:${pre}:${id}:${name}`, el);
    if (side === 'inputs') rows.inputs.push({ id, type: f('type') || 'md', mode: f('mode') || 'optional' });
    else if (side === 'outputs') rows.outputs.push({ id, type: f('type') || 'md', when: f('when') || 'always', filename: f('filename') });
    else {
      let extra = {};
      try { extra = JSON.parse(f('extra') || '{}'); } catch { extra = {}; }
      rows.params.push({ id, type: f('type') || 'string', default: f('default'), ...extra });
    }
  }
  const verdictFilename = val('iface:verdictFilename', iface);
  const built = interfaceToMeta(rows, { key, runtime, verdict: val('iface:verdict', iface) === '1', routing: val('iface:routing', iface) === '1', verdictFilename });
  const config = val('iface:config', iface);
  // A key this form can CLEAR is always sent, `null` when cleared: the store merges the sent meta
  // over the stored one and reads null as "remove" (script-store.mjs stripNullKeys).
  if (config) {
    let dp = null;
    try { dp = JSON.parse(config); } catch { dp = null; }
    meta.ports = 'config'; meta.defaultPorts = dp || { inputs: [], outputs: [] }; meta.inputs = null; meta.outputs = null;
    meta.verdict = verdictFilename ? { filename: verdictFilename } : null;       // the sidecar's, untouched (S8)
  } else {
    meta.inputs = built.inputs; meta.outputs = built.outputs; meta.ports = null; meta.defaultPorts = null;
    meta.verdict = built.verdict;
  }
  meta.params = built.params;
  meta.exitCodes = null;
  meta.command = null;
  const box = root.querySelector('.script-source');
  const mode = box ? box.dataset.srcMode : shellMode(meta);
  if (runtime === 'shell') {
    const clean = ints(val('meta:exitCodesClean'));
    const blocking = ints(val('meta:exitCodesBlocking'));
    if (clean.length || blocking.length) meta.exitCodes = { clean, blocking };
    const command = val('meta:command');
    if (mode === 'command' && command.trim()) meta.command = joinCommand(command, val('meta:commandExtra'));
  }
  const file = !(runtime === 'shell' && mode === 'command');
  return {
    meta,
    source: file ? val('script:source') : '',
    sourceWin32: runtime === 'shell' && mode === 'file' ? val('script:sourceWin32') : '',
  };
}
