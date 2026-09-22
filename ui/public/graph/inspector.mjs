// ui/public/graph/inspector.mjs
// Pure DOM renderers for the composer's floating rail. Every function takes the
// target `document` via opts and returns a DETACHED element — no fetch, no
// listeners. composer.mjs mounts the result and binds ONE delegated `change`
// listener, routing on `data-field`. Capability rows are gated by META
// BOOLEANS: a new agent's sidecar drives its panel with no UI change.
import { resolveOrOutType } from '../../../src/shared/graph/ports.mjs';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, wirableParams, hasParamsPort } from '../../../src/shared/graph/script-meta.mjs';
// The DOM primitives and the two script forms live in ../script-forms.mjs so the
// composer, the Scripts page's Overview tab and the Test tab share ONE copy (C3).
import {
  h, field, select, toggle, number, renderParamsForm, renderPortEditor,
} from '../script-forms.mjs';

const ARITY_KINDS = new Set(['and', 'or', 'combine']);
const FLOW_TITLES = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };
const FLOW_BLURB = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads are discarded — pure sequencing.',
  or: 'Fires on ANY fresh input and forwards the freshest payload.',
  combine: 'Joins its md inputs into one document, in port order.',
};

function head(doc, title, sub) {
  const w = h(doc, 'div', 'ins-head');
  w.appendChild(h(doc, 'div', 'ins-name', title));
  if (sub) w.appendChild(h(doc, 'div', 'ins-sub', sub));
  return w;
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
      if (p.synthetic || p.engine) bits.push('engine');
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
export function renderNodeInspector(node, { template, portsFn, meta = null, models = [], efforts = [], subagentModels = [], editorFor = null, doc = globalThis.document } = {}) {
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
    body.appendChild(renderParamsForm(meta, node.config, { doc, editorFor }));
    const ms = Number.isInteger(node.config.timeoutMs) ? node.config.timeoutMs : ((meta && meta.timeoutMs) || DEFAULT_TIMEOUT_MS);
    // Interface mode (docs/ui-levels.md): what the card RUNS is never hidden; per-node tuning and ports are expert.
    const timeout = number(doc, 'ins-timeout', 'timeoutMs', 'Timeout (s)', Math.round(ms / 1000), 1);
    timeout.querySelector('input').max = String(MAX_TIMEOUT_MS / 1000);
    body.appendChild(lv(timeout, 'expert', Number.isInteger(node.config.timeoutMs)));
    body.appendChild(lv(toggle(doc, 'ins-awaitall', 'awaitAll', 'Await all inputs', 'gate until every wire fires',
      { checked: node.config.awaitAll === true }), 'expert', node.config.awaitAll === true));
    // Offered only where ticking it takes effect: `meta` here is the registry entry, so the forced-on probe is honest.
    // A ticked box always renders, so an opt-in V22 refuses (the script changed under the card) can still be un-ticked.
    if (node.config.paramsPort === true || hasParamsPort(meta, { ...node.config, paramsPort: true })) {
      body.appendChild(lv(toggle(doc, 'ins-paramsport', 'paramsPort', 'Params from a wire', `json sets: ${wirableParams(meta).map((p) => p.id).join(', ') || 'nothing'}`,
        { checked: node.config.paramsPort === true }), 'expert', node.config.paramsPort === true));
    }
    body.appendChild(lv(h(doc, 'div', 'ins-sep'), 'expert'));
    body.appendChild(lv(meta && meta.ports === 'config'
      ? renderPortEditor(node.config.ports, { doc, hasVerdict: Boolean(meta && meta.verdict) })
      : portList(doc, ports), 'expert'));
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
