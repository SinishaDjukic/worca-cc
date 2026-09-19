// ui/public/graph/inspector.mjs
// Pure DOM renderers for the composer's floating rail. Every function takes the
// target `document` via opts and returns a DETACHED element — no fetch, no
// listeners. composer.mjs mounts the result and binds ONE delegated `change`
// listener, routing on `data-field`. Capability rows are gated by META
// BOOLEANS: a new agent's sidecar drives its panel with no UI change.
import { resolveOrOutType } from '../../../src/shared/graph/ports.mjs';
import { readConfigPorts, effectiveScriptParams, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../../../src/shared/graph/script-meta.mjs';

const ARITY_KINDS = new Set(['and', 'or', 'combine']);
const FLOW_TITLES = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };
const FLOW_BLURB = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads are discarded — pure sequencing.',
  or: 'Fires on ANY fresh input and forwards the freshest payload.',
  combine: 'Joins its md inputs into one document, in port order.',
};

const h = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const field = (doc, cls, label) => { const w = h(doc, 'div', `ins-f ${cls}`); w.appendChild(h(doc, 'label', 'ins-label', label)); return w; };

function select(doc, cls, name, label, items, value, { disabled = false, title = '' } = {}) {
  const wrap = field(doc, cls, label);
  if (title) wrap.title = title;
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = name;
  sel.disabled = Boolean(disabled);
  for (const opt of items) {
    const o = doc.createElement('option');
    o.value = opt.value; o.textContent = opt.text;
    if (opt.value === (value == null ? '' : String(value))) o.selected = true;
    sel.appendChild(o);
  }
  const shell = h(doc, 'span', 'ins-select-wrap');   // the product's .select-wrap idea: the chevron is a token-coloured ::after on a wrapper
  shell.appendChild(sel);
  wrap.appendChild(shell);
  return wrap;
}
function toggle(doc, cls, name, label, hint, { checked = false, disabled = false, title = '' } = {}) {
  const row = h(doc, 'div', `ins-tog ${cls}`);
  if (title) row.title = title;
  const box = doc.createElement('input');
  box.type = 'checkbox'; box.dataset.field = name; box.checked = Boolean(checked); box.disabled = Boolean(disabled);
  const body = h(doc, 'span', 'ins-tog-b');
  body.appendChild(h(doc, 'span', 'ins-tog-t', label));
  if (hint) body.appendChild(h(doc, 'small', 'ins-tog-h', hint));
  row.append(box, body);
  return row;
}
function head(doc, title, sub) {
  const w = h(doc, 'div', 'ins-head');
  w.appendChild(h(doc, 'div', 'ins-name', title));
  if (sub) w.appendChild(h(doc, 'div', 'ins-sub', sub));
  return w;
}
function number(doc, cls, name, label, value, min) {
  const wrap = field(doc, cls, label);
  const input = doc.createElement('input');
  input.type = 'number'; input.className = 'ins-number'; input.dataset.field = name;
  input.min = String(min); input.step = '1'; input.value = String(value);
  wrap.appendChild(input);
  return wrap;
}
/** Read-only listing of a node's resolved ports. */
function portList(doc, ports) {
  const wrap = h(doc, 'div', 'ins-ports');
  const zone = (label, list, dir) => {
    if (!list.length) return;
    wrap.appendChild(h(doc, 'div', 'ins-zone', label));
    const ul = h(doc, 'div', 'ins-plist');
    for (const p of list) {
      const item = h(doc, 'div', `ins-pitem${p.synthetic ? ' gate' : ''}`);
      item.appendChild(h(doc, 'i', p.synthetic ? 'gdot' : `dot ${p.type}`));
      item.appendChild(h(doc, 'span', 'pn', p.id));
      const bits = [p.type];
      if (p.synthetic) bits.push('engine');
      else if (dir === 'in') bits.push(p.loop ? 'loop' : (p.required === false ? 'optional' : 'required'));
      else if (p.when && p.when !== 'always') bits.push(`on ${p.when}`);
      if (p.expands) bits.push('fan-out');
      item.appendChild(h(doc, 'span', 'pt mla', bits.join(' · ')));
      ul.appendChild(item);
    }
    wrap.appendChild(ul);
  };
  zone('Inputs', ports.inputs, 'in');
  zone('Outputs', ports.outputs, 'out');
  return wrap;
}

function textarea(doc, cls, name, label, value, rows) {
  const wrap = field(doc, cls, label);
  const ta = doc.createElement('textarea');
  ta.className = 'ins-textarea mono'; ta.dataset.field = name; ta.rows = rows; ta.spellcheck = false; ta.value = value == null ? '' : String(value);
  wrap.appendChild(ta);
  return wrap;
}
function text(doc, cls, name, label, value, { type = 'text', step = null } = {}) {
  const wrap = field(doc, cls, label);
  const input = doc.createElement('input');
  input.type = type; input.className = 'ins-number'; input.dataset.field = name; input.value = value == null ? '' : String(value);
  if (step) input.step = step;
  wrap.appendChild(input);
  return wrap;
}

/** One control per sidecar param (spec §10.3). The EFFECTIVE value (sidecar
 *  default ⊕ card) is what the control shows; a required param with neither is
 *  flagged `.ins-missing` (V22's `incomplete`). */
function paramsForm(doc, node, meta) {
  const frag = doc.createDocumentFragment();
  const declared = Array.isArray(meta && meta.params) ? meta.params : [];
  if (!declared.length) return frag;
  frag.appendChild(h(doc, 'div', 'ins-zone', 'Params'));
  const values = effectiveScriptParams(meta, node.config);
  let captioned = false;
  for (const p of declared) {
    const name = `param:${p.id}`;
    const label = p.label || p.id;
    const value = values[p.id];
    let row;
    if (p.type === 'boolean') row = toggle(doc, 'ins-param', name, label, p.description || '', { checked: value === true });
    // No effective value: a blank first option, so the control never shows a choice the config does not hold.
    else if (p.type === 'enum') row = select(doc, 'ins-param', name, label, [...(value == null ? [{ value: '', text: '' }] : []), ...(p.options || []).map((o) => ({ value: o, text: o }))], value == null ? '' : value);
    else if (p.type === 'number') row = text(doc, 'ins-param', name, label, value, { type: 'number', step: 'any' });
    else if (p.type === 'command' || p.type === 'code') row = textarea(doc, 'ins-param ins-param-code', name, label, value, p.type === 'code' ? 8 : 3);
    else row = text(doc, 'ins-param', name, label, value);
    if (p.required && (value === undefined || value === '')) row.classList.add('ins-missing');
    if (p.description && p.type !== 'boolean') row.title = p.description;
    frag.appendChild(row);
    if ((p.type === 'command' || p.type === 'code') && !captioned) {
      frag.appendChild(h(doc, 'small', 'ins-caption', "Runs with worca's privileges."));
      captioned = true;
    }
  }
  return frag;
}

/** The port editor for a `ports: "config"` script (D14): one row per port, the
 *  shared reader's errors under it. Every control routes through data-field /
 *  data-port-add / data-port-remove to the composer. */
function portEditor(doc, node, meta) {
  const wrap = h(doc, 'div', 'ins-ports ins-port-editor');
  const raw = node.config && node.config.ports && typeof node.config.ports === 'object' ? node.config.ports : { inputs: [], outputs: [] };
  const hasVerdict = Boolean(meta && meta.verdict);
  const { errors } = readConfigPorts(raw, { hasVerdict });
  const sel = (name, items, value, opts) => {
    const s = select(doc, 'ins-pf', name, '', items.map((v) => ({ value: v, text: v })), value, opts);
    s.querySelector('label').remove();
    return s;
  };
  const check = (name, label, checked) => {
    const l = h(doc, 'label', 'ins-pcheck');
    const box = doc.createElement('input'); box.type = 'checkbox'; box.dataset.field = name; box.checked = Boolean(checked);
    l.append(box, doc.createTextNode(label));
    return l;
  };
  const zone = (label, dir, list) => {
    wrap.appendChild(h(doc, 'div', 'ins-zone', label));
    list.forEach((p, i) => {
      const row = h(doc, 'div', 'ins-prow');
      row.dataset.dir = dir; row.dataset.index = String(i);
      const id = doc.createElement('input');
      id.type = 'text'; id.className = 'ins-pid mono'; id.dataset.field = `port:${dir}:${i}:id`; id.value = p.id || ''; id.placeholder = 'id';
      row.append(id, sel(`port:${dir}:${i}:type`, ['md', 'json', 'void'], p.type || 'md'));
      if (dir === 'inputs') {
        row.append(check(`port:${dir}:${i}:required`, 'required', p.required !== false), check(`port:${dir}:${i}:loop`, 'loop', p.loop === true));
      } else {
        row.appendChild(sel(`port:${dir}:${i}:when`, ['always', 'blocking', 'clean'], p.when || 'always',
          hasVerdict ? {} : { disabled: true, title: 'needs a sidecar verdict' }));
        const fn = doc.createElement('input');
        fn.type = 'text'; fn.className = 'ins-pfile mono'; fn.dataset.field = `port:${dir}:${i}:filename`; fn.value = p.filename || ''; fn.placeholder = 'name-cycle{cycle}.md';
        fn.hidden = p.type === 'void';
        row.appendChild(fn);
      }
      const rm = h(doc, 'button', 'ins-prm', '×');
      rm.type = 'button'; rm.dataset.portRemove = `${dir}:${i}`; rm.title = 'Remove';
      row.appendChild(rm);
      wrap.appendChild(row);
    });
    const add = h(doc, 'button', 'ins-padd', dir === 'inputs' ? '+ input' : '+ output');
    add.type = 'button'; add.dataset.portAdd = dir;
    wrap.appendChild(add);
  };
  zone('Inputs', 'inputs', Array.isArray(raw.inputs) ? raw.inputs : []);
  zone('Outputs', 'outputs', Array.isArray(raw.outputs) ? raw.outputs : []);
  for (const e of errors) wrap.appendChild(h(doc, 'div', 'ins-perr', e));
  return wrap;
}

export function renderNodeInspector(node, { template, portsFn, meta = null, models = [], efforts = [], subagentModels = [], doc = globalThis.document } = {}) {
  const ports = portsFn(node) || { inputs: [], outputs: [] };
  const root = h(doc, 'div', `ins-panel ins-${node.kind === 'agent' ? 'agent' : node.kind === 'script' ? 'script' : `flow ins-${node.kind}`}`);
  root.dataset.nodeId = node.id;
  const body = h(doc, 'div', 'ins-body-in');

  if (node.kind === 'agent') {
    root.appendChild(head(doc, (meta && meta.displayName) || node.key || node.id, `${node.key} · ${node.id}`));
    // Hidden built-ins (#422) leave the list unless one is THIS node's stored
    // pick — it still resolves at run time and must stay visible here.
    const offered = models.filter((m) => m && (!m.hidden || m.id === node.config.model));
    body.appendChild(select(doc, 'ins-model', 'model', 'Model',
      [{ value: '', text: 'inherit' }, ...offered.map((m) => ({ value: m.id, text: m.label || m.id }))], node.config.model));
    body.appendChild(select(doc, 'ins-effort', 'effort', 'Effort',
      [{ value: '', text: 'default' }, ...efforts.map((e) => ({ value: e, text: e }))], node.config.effort));
    if (meta && meta.fanOut) {
      body.appendChild(lv(toggle(doc, 'ins-fanout', 'fanOut', 'Research fan-out', 'parallel research sub-agents',
        { checked: node.config.fanOut === true }), 'expert', node.config.fanOut === true));
      // What this node's sub-agents run on. Gated by the SAME meta flag as the
      // toggle above: an agent that cannot fan out has no children to place.
      // '' = unset — the run resolves the auto default (a per-spawn choice
      // rubric in the agent's prompt), so the blank option says so; 'inherit'
      // is the stored opt-out (children ride the CLI's own resolution).
      // A ROUTED model (custom-endpoint catalog entry) locks the control: the
      // run degrades every stored value to the same-endpoint policy, so
      // offering aliases here would be a lie. The stored value is kept — the
      // per-field change handler writes only the field the user edited, and
      // the locked option carries the stored value — and the full control
      // returns when the node moves back to a plain model.
      const chosen = node.config.model ? models.find((m) => m && m.id === node.config.model) : null;
      body.appendChild(lv(chosen && chosen.routed
        ? select(doc, 'ins-subagent', 'subagentModel', 'Sub-agent model',
          [{ value: node.config.subagentModel || '', text: 'same endpoint (locked)' }],
          node.config.subagentModel || '',
          { disabled: true, title: 'This model routes to a custom endpoint; its sub-agents run the same model. Pick a non-routed model to edit.' })
        : select(doc, 'ins-subagent', 'subagentModel', 'Sub-agent model',
          [{ value: '', text: 'default (agent picks)' },
            ...subagentModels.map((m) => ({ value: m, text: m === 'auto' ? 'agent picks' : m }))],
          node.config.subagentModel), 'expert', !!node.config.subagentModel));
    }
    if (meta && meta.asksQuestions) {
      const locked = Boolean(meta.questionsLocked);
      const saved = node.config.askQuestions;
      body.appendChild(lv(toggle(doc, 'ins-questions', 'askQuestions', 'Ask questions', 'pauses the run for input', {
        checked: locked ? Boolean(meta.questionsDefault) : (typeof saved === 'boolean' ? saved : Boolean(meta.questionsDefault)),
        disabled: locked,
        title: locked ? (meta.questionsDefault ? 'Always on for this agent' : 'Always off for this agent') : '',
      }), 'expert', !locked && typeof saved === 'boolean'));
    }
    body.appendChild(lv(toggle(doc, 'ins-awaitall', 'awaitAll', 'Await all inputs', 'gate until every wire fires',
      { checked: node.config.awaitAll === true }), 'expert', node.config.awaitAll === true));
  } else if (node.kind === 'script') {
    root.appendChild(head(doc, (meta && meta.displayName) || node.key || node.id, `${node.key} · ${node.id}`));
    const chips = h(doc, 'div', 'ins-chiprow');
    chips.append(h(doc, 'span', 'badge', (meta && meta.origin) || 'builtin'), h(doc, 'span', 'chip rt', (meta && meta.runtime) || 'script'));
    body.appendChild(chips);
    body.appendChild(paramsForm(doc, node, meta));
    const ms = Number.isInteger(node.config.timeoutMs) ? node.config.timeoutMs : ((meta && meta.timeoutMs) || DEFAULT_TIMEOUT_MS);
    // Interface mode (docs/ui-levels.md): what the card RUNS is never hidden; per-node tuning and ports are expert.
    const timeout = number(doc, 'ins-timeout', 'timeoutMs', 'Timeout (s)', Math.round(ms / 1000), 1);
    timeout.querySelector('input').max = String(MAX_TIMEOUT_MS / 1000);
    body.appendChild(lv(timeout, 'expert', Number.isInteger(node.config.timeoutMs)));
    body.appendChild(lv(toggle(doc, 'ins-awaitall', 'awaitAll', 'Await all inputs', 'gate until every wire fires',
      { checked: node.config.awaitAll === true }), 'expert', node.config.awaitAll === true));
    body.appendChild(lv(h(doc, 'div', 'ins-sep'), 'expert'));
    body.appendChild(lv(meta && meta.ports === 'config' ? portEditor(doc, node, meta) : portList(doc, ports), 'expert'));
    root.appendChild(body);
    return root;
  } else {
    root.appendChild(head(doc, FLOW_TITLES[node.kind] || node.kind, node.id));
    body.appendChild(h(doc, 'p', 'ins-blurb', FLOW_BLURB[node.kind] || ''));
    if (ARITY_KINDS.has(node.kind)) {
      // "Input count", not "Inputs": the read-only port listing below already
      // carries an `Inputs` heading, and two of them in one 308px rail read as
      // one control and its own list.
      body.appendChild(number(doc, 'ins-arity', 'arity', 'Input count', Number.isInteger(node.config.arity) ? node.config.arity : 2, 2));
    }
    if (node.kind === 'or') {
      const resolved = resolveOrOutType(template, portsFn, node.id, new Set());
      body.appendChild(h(doc, 'div', 'ins-resolved', resolved ? `forwards: ${resolved}` : 'unresolved'));
    }
    if (node.kind === 'task') {
      body.appendChild(lv(toggle(doc, 'ins-seed', 'planStoreSeed', 'Seed the plan store', 'treat an attached plan as the run’s plan',
        { checked: node.config.planStoreSeed === true }), 'expert', node.config.planStoreSeed === true));
    }
    if (node.kind === 'end') body.appendChild(h(doc, 'div', 'ins-result', ''));
  }
  body.appendChild(lv(h(doc, 'div', 'ins-sep'), 'expert'));
  body.appendChild(lv(portList(doc, ports), 'expert'));
  root.appendChild(body);
  return root;
}

/** Loop wires carry the per-wire cycle budget; a plain wire must NOT expose one
 *  (maxCycles on a non-loop wire is V13's error). */
/** Interface mode (docs/ui-levels.md): model and effort are the advanced inspector; everything else
 *  here is expert. `keep` = the control holds a non-default value, so it stays on screen. */
function lv(el, min, keep = false) {
  el.dataset.minLevel = min;
  if (keep) el.dataset.levelKeep = '1';
  return el;
}

export function renderWireInspector(wire, { loop = false, doc = globalThis.document } = {}) {
  const root = h(doc, 'div', `ins-panel ins-wire${loop ? ' ins-loop' : ''}`);
  root.dataset.wireId = wire.id;
  root.appendChild(head(doc, loop ? 'Loop wire' : 'Wire', `${wire.from.node}.${wire.from.port} → ${wire.to.node}.${wire.to.port}`));
  const body = h(doc, 'div', 'ins-body-in');
  if (loop) {
    const budgeted = !!(wire.config && Number.isInteger(wire.config.maxCycles));
    body.appendChild(lv(number(doc, 'ins-maxcycles', 'maxCycles', 'Max cycles',
      budgeted ? wire.config.maxCycles : 3, 1), 'expert', budgeted));
    body.appendChild(lv(h(doc, 'small', 'ins-hint', 'How many times this loop may re-deliver before the gate asks.'), 'expert', budgeted));
    const plain = h(doc, 'p', 'ins-blurb ins-loop-plain', 'A loop: work flows back here until it passes, up to a cycle limit. Expert mode sets the limit.');
    plain.dataset.maxLevel = 'advanced';
    body.appendChild(plain);
  } else {
    body.appendChild(h(doc, 'p', 'ins-blurb', 'Plain data wire. Delete it to rewire the target input.'));
  }
  root.appendChild(body);
  return root;
}

export function renderEmptyInspector({ doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ins-panel ins-empty');
  root.appendChild(h(doc, 'p', 'ins-blurb', 'Select a node or a wire to configure it.'));
  return root;
}
