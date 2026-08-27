// ui/public/graph/inspector.mjs
// Pure DOM renderers for the composer's floating rail. Every function takes the
// target `document` via opts and returns a DETACHED element — no fetch, no
// listeners. composer.mjs mounts the result and binds ONE delegated `change`
// listener, routing on `data-field`. Capability rows are gated by META
// BOOLEANS: a new agent's sidecar drives its panel with no UI change.
import { resolveOrOutType } from '../../../src/shared/graph/ports.mjs';

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

function select(doc, cls, name, label, items, value) {
  const wrap = field(doc, cls, label);
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = name;
  for (const opt of items) {
    const o = doc.createElement('option');
    o.value = opt.value; o.textContent = opt.text;
    if (opt.value === (value == null ? '' : String(value))) o.selected = true;
    sel.appendChild(o);
  }
  wrap.appendChild(sel);
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

export function renderNodeInspector(node, { template, portsFn, meta = null, models = [], efforts = [], doc = globalThis.document } = {}) {
  const ports = portsFn(node) || { inputs: [], outputs: [] };
  const root = h(doc, 'div', `ins-panel ins-${node.kind === 'agent' ? 'agent' : `flow ins-${node.kind}`}`);
  root.dataset.nodeId = node.id;
  const body = h(doc, 'div', 'ins-body-in');

  if (node.kind === 'agent') {
    root.appendChild(head(doc, (meta && meta.displayName) || node.key || node.id, `${node.key} · ${node.id}`));
    body.appendChild(select(doc, 'ins-model', 'model', 'Model',
      [{ value: '', text: 'inherit' }, ...models.map((m) => ({ value: m.id, text: m.label || m.id }))], node.config.model));
    body.appendChild(select(doc, 'ins-effort', 'effort', 'Effort',
      [{ value: '', text: 'default' }, ...efforts.map((e) => ({ value: e, text: e }))], node.config.effort));
    if (meta && meta.fanOut) {
      body.appendChild(toggle(doc, 'ins-fanout', 'fanOut', 'Research fan-out', 'parallel research sub-agents',
        { checked: node.config.fanOut === true }));
    }
    if (meta && meta.asksQuestions) {
      const locked = Boolean(meta.questionsLocked);
      const saved = node.config.askQuestions;
      body.appendChild(toggle(doc, 'ins-questions', 'askQuestions', 'Ask questions', 'pauses the run for input', {
        checked: locked ? Boolean(meta.questionsDefault) : (typeof saved === 'boolean' ? saved : Boolean(meta.questionsDefault)),
        disabled: locked,
        title: locked ? (meta.questionsDefault ? 'Always on for this agent' : 'Always off for this agent') : '',
      }));
    }
    body.appendChild(toggle(doc, 'ins-awaitall', 'awaitAll', 'Await all inputs', 'gate until every wire fires',
      { checked: node.config.awaitAll === true }));
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
      body.appendChild(toggle(doc, 'ins-seed', 'planStoreSeed', 'Seed the plan store', 'treat an attached plan as the run’s plan',
        { checked: node.config.planStoreSeed === true }));
    }
    if (node.kind === 'end') body.appendChild(h(doc, 'div', 'ins-result', ''));
  }
  body.appendChild(h(doc, 'div', 'ins-sep'));
  body.appendChild(portList(doc, ports));
  root.appendChild(body);
  return root;
}

/** Loop wires carry the per-wire cycle budget; a plain wire must NOT expose one
 *  (maxCycles on a non-loop wire is V13's error). */
export function renderWireInspector(wire, { loop = false, doc = globalThis.document } = {}) {
  const root = h(doc, 'div', `ins-panel ins-wire${loop ? ' ins-loop' : ''}`);
  root.dataset.wireId = wire.id;
  root.appendChild(head(doc, loop ? 'Loop wire' : 'Wire', `${wire.from.node}.${wire.from.port} → ${wire.to.node}.${wire.to.port}`));
  const body = h(doc, 'div', 'ins-body-in');
  if (loop) {
    body.appendChild(number(doc, 'ins-maxcycles', 'maxCycles', 'Max cycles',
      wire.config && Number.isInteger(wire.config.maxCycles) ? wire.config.maxCycles : 3, 1));
    body.appendChild(h(doc, 'small', 'ins-hint', 'How many times this loop may re-deliver before the gate asks.'));
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
