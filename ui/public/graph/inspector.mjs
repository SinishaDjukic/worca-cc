// ui/public/graph/inspector.mjs
// Pure DOM renderers for the composer's right rail. Every function takes the
// target `document` via opts (defaults to the browser global) and returns a
// DETACHED element — no fetch, no listeners. composer-editor.mjs mounts the
// result and binds ONE delegated `change` listener, routing on `data-field`.
//
// Capability rows are gated by META BOOLEANS, exactly the way the v1
// renderStepConfigs gated its step rows: the questions row is absent when the
// agent does not ask, a locked agent's toggle is forced to its default and
// disabled with the same title copy, the fan-out row only exists for fan-out
// capable agents. No key lists anywhere — a new agent's sidecar drives its
// panel with no UI change, which is the whole point of meta v2.

import { resolveOrOutType } from './graph-model.mjs';

const ARITY_KINDS = new Set(['and', 'or', 'combine']);

const FLOW_TITLES = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };

const FLOW_BLURB = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads are discarded — pure sequencing.',
  or: 'Fires on ANY fresh input and forwards the freshest payload.',
  combine: 'Joins its md inputs into one document, in port order.',
};

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function field(doc, cls, label) {
  const wrap = h(doc, 'div', `ins-f ${cls}`);
  wrap.appendChild(h(doc, 'label', 'ins-label', label));
  return wrap;
}

function select(doc, cls, fieldName, options, value) {
  const wrap = field(doc, cls, options.label);
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = fieldName;
  for (const opt of options.items) {
    const o = doc.createElement('option');
    o.value = opt.value;
    o.textContent = opt.text;
    if (opt.value === (value == null ? '' : String(value))) o.selected = true;
    sel.appendChild(o);
  }
  wrap.appendChild(sel);
  return wrap;
}

function toggle(doc, cls, fieldName, label, hint, { checked = false, disabled = false, title = '' } = {}) {
  const row = h(doc, 'div', `ins-tog ${cls}`);
  if (title) row.title = title;
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.dataset.field = fieldName;
  box.checked = Boolean(checked);
  box.disabled = Boolean(disabled);
  const body = h(doc, 'span', 'ins-tog-b');
  body.appendChild(h(doc, 'span', 'ins-tog-t', label));
  if (hint) body.appendChild(h(doc, 'small', 'ins-tog-h', hint));
  row.append(box, body);
  return row;
}

function head(doc, title, sub) {
  const wrap = h(doc, 'div', 'ins-head');
  wrap.appendChild(h(doc, 'div', 'ins-name', title));
  if (sub) wrap.appendChild(h(doc, 'div', 'ins-sub', sub));
  return wrap;
}

/** Read-only listing of a node's ports, the mockup's lower half. */
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

/**
 * The agent node panel. `meta` is the palette entry (mergePalette shape); its
 * booleans — and nothing else — decide which capability rows exist.
 */
function agentPanel(doc, node, { meta, ports, models, efforts }) {
  const root = h(doc, 'div', 'ins-panel ins-agent');
  root.dataset.nodeId = node.id;
  root.appendChild(head(doc, (meta && meta.displayName) || node.key || node.id, `${node.key} · ${node.id}`));
  const body = h(doc, 'div', 'ins-body');

  body.appendChild(select(doc, 'ins-model', 'model', {
    label: 'Model',
    items: [{ value: '', text: 'inherit' }, ...models.map((m) => ({ value: m.id, text: m.label || m.id }))],
  }, node.config.model));
  body.appendChild(select(doc, 'ins-effort', 'effort', {
    label: 'Effort',
    items: [{ value: '', text: 'default' }, ...efforts.map((e) => ({ value: e, text: e }))],
  }, node.config.effort));

  // Fan-out: only for agents that declare the capability (v1 parity: the row
  // simply does not exist otherwise).
  if (meta && meta.fanOut) {
    body.appendChild(toggle(doc, 'ins-fanout', 'fanOut', 'Research fan-out', 'parallel research sub-agents', {
      checked: node.config.fanOut === true,
    }));
  }

  // Questions: hidden without the capability; locked agents are forced to their
  // declared default and disabled, with renderStepConfigs' exact title copy.
  if (meta && meta.asksQuestions) {
    const locked = Boolean(meta.questionsLocked);
    const saved = node.config.askQuestions;
    body.appendChild(toggle(doc, 'ins-questions', 'askQuestions', 'Ask questions', 'pauses the run for input', {
      checked: locked ? Boolean(meta.questionsDefault) : (typeof saved === 'boolean' ? saved : Boolean(meta.questionsDefault)),
      disabled: locked,
      title: locked
        ? (meta.questionsDefault ? 'Always on for this agent' : 'Always off for this agent')
        : '',
    }));
  }

  // The await-all barrier survives Amendment f: the synthesized gate counts as
  // a wired non-loop input, so the toggle is meaningful on every agent node.
  body.appendChild(toggle(doc, 'ins-awaitall', 'awaitAll', 'Await all inputs', 'gate until every wire fires', {
    checked: node.config.awaitAll === true,
  }));

  body.appendChild(h(doc, 'div', 'ins-sep'));
  body.appendChild(portList(doc, ports));
  root.appendChild(body);
  return root;
}

/** and / or / combine: the arity stepper (V12's floor is 2), plus OR's resolved type. */
function flowPanel(doc, node, { ports, template, portsFn }) {
  const root = h(doc, 'div', `ins-panel ins-flow ins-${node.kind}`);
  root.dataset.nodeId = node.id;
  root.appendChild(head(doc, FLOW_TITLES[node.kind] || node.kind, node.id));
  const body = h(doc, 'div', 'ins-body');
  body.appendChild(h(doc, 'p', 'ins-blurb', FLOW_BLURB[node.kind] || ''));

  if (ARITY_KINDS.has(node.kind)) {
    const wrap = field(doc, 'ins-arity', 'Inputs');
    const input = doc.createElement('input');
    input.type = 'number';
    input.className = 'ins-number';
    input.dataset.field = 'arity';
    input.min = '2';
    input.step = '1';
    input.value = String(Number.isInteger(node.config.arity) ? node.config.arity : 2);
    wrap.appendChild(input);
    body.appendChild(wrap);
  }

  if (node.kind === 'or') {
    // Read-only mirror of the engine's resolution — the composer needs live
    // resolved types for the or dot and for legality, and this line is the
    // human-readable half of the same answer.
    const resolved = resolveOrOutType(node, template, portsFn);
    body.appendChild(h(doc, 'div', 'ins-resolved', resolved ? `forwards: ${resolved}` : 'unresolved'));
  }

  body.appendChild(h(doc, 'div', 'ins-sep'));
  body.appendChild(portList(doc, ports));
  root.appendChild(body);
  return root;
}

/** task / end: informational only — nothing here is configurable. */
function bookendPanel(doc, node, { ports }) {
  const root = h(doc, 'div', `ins-panel ins-flow ins-${node.kind}`);
  root.dataset.nodeId = node.id;
  root.appendChild(head(doc, FLOW_TITLES[node.kind] || node.kind, node.id));
  const body = h(doc, 'div', 'ins-body');
  body.appendChild(h(doc, 'p', 'ins-blurb', FLOW_BLURB[node.kind] || ''));
  body.appendChild(h(doc, 'div', 'ins-sep'));
  body.appendChild(portList(doc, ports));
  root.appendChild(body);
  return root;
}

/**
 * Panel for the selected node.
 * @param {object} node
 * @param {{template:object, portsFn:Function, meta?:object, models?:Array, efforts?:Array, doc?:Document}} opts
 */
export function renderNodeInspector(node, {
  template, portsFn, meta = null, models = [], efforts = [], doc = globalThis.document,
} = {}) {
  const ports = portsFn(node) || { inputs: [], outputs: [] };
  if (node.kind === 'agent') return agentPanel(doc, node, { meta, ports, models, efforts });
  if (node.kind === 'task' || node.kind === 'end') return bookendPanel(doc, node, { ports });
  return flowPanel(doc, node, { ports, template, portsFn });
}

/**
 * Panel for the selected wire. Loop wires get the per-wire cycle budget; plain
 * wires get their route and nothing to change (maxCycles on a non-loop wire is
 * V13's error, so the control must not exist there).
 */
export function renderWireInspector(wire, { loop = false, doc = globalThis.document } = {}) {
  const root = h(doc, 'div', `ins-panel ins-wire${loop ? ' ins-loop' : ''}`);
  root.dataset.wireId = wire.id;
  root.appendChild(head(doc, loop ? 'Loop wire' : 'Wire',
    `${wire.from.node}.${wire.from.port} → ${wire.to.node}.${wire.to.port}`));
  const body = h(doc, 'div', 'ins-body');
  if (loop) {
    const wrap = field(doc, 'ins-maxcycles', 'Max cycles');
    const input = doc.createElement('input');
    input.type = 'number';
    input.className = 'ins-number';
    input.dataset.field = 'maxCycles';
    input.min = '1';
    input.step = '1';
    input.value = String(
      wire.config && Number.isInteger(wire.config.maxCycles) ? wire.config.maxCycles : 3,
    );
    wrap.appendChild(input);
    body.appendChild(wrap);
    body.appendChild(h(doc, 'small', 'ins-hint', 'How many times this loop may re-deliver before the gate asks.'));
  } else {
    body.appendChild(h(doc, 'p', 'ins-blurb', 'Plain data wire. Delete it to rewire the target input.'));
  }
  root.appendChild(body);
  return root;
}

/** Nothing selected. */
export function renderEmptyInspector({ doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ins-panel ins-empty');
  root.appendChild(h(doc, 'p', 'ins-blurb', 'Select a node or a wire to configure it.'));
  return root;
}
