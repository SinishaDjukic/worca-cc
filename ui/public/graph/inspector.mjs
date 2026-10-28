// ui/public/graph/inspector.mjs
// Pure DOM renderers for the composer's floating rail. Every function takes the
// target `document` via opts and returns a DETACHED element — no fetch, no
// listeners. composer.mjs mounts the result and binds ONE delegated `change`
// listener, routing on `data-field`. Capability rows are gated by META
// BOOLEANS: a new agent's sidecar drives its panel with no UI change.
import { resolveOrOutType } from '../../../src/shared/graph/ports.mjs';
import { harnessesOf, modelGroups, modelSourceSuffix } from '../../../src/shared/connections.mjs';
import { ENGINES, engineLabel, sessionSupport, SESSION_SUBAGENTS_VERIFIED } from '../../../src/shared/engine-switch.mjs';
import { sessionCandidates, sessionNotes, SESSION_DEFAULT_LABEL, SESSION_SHARED_SELECTABLE } from '../../../src/shared/graph/sessions.mjs';
import { SESSION_LABEL_MAX } from '../../../src/shared/graph/constants.mjs';
import { icon } from '../icons.mjs';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, wirableParams, hasParamsPort } from '../../../src/shared/graph/script-meta.mjs';
// The DOM primitives and the two script forms live in ../script-forms.mjs so the
// composer, the Scripts page's Overview tab and the Test tab share ONE copy (C3).
import {
  h, field, select, toggle, number, text, renderParamsForm, renderPortEditor,
} from '../script-forms.mjs';

const ARITY_KINDS = new Set(['and', 'or', 'combine']);
const FLOW_TITLES = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };
const FLOW_BLURB = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads are discarded (pure sequencing).',
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
export function renderNodeInspector(node, { template, portsFn, meta = null, models = [], efforts = [], subagentModels = [], editorFor = null, session = null, doc = globalThis.document } = {}) {
  const ports = portsFn(node) || { inputs: [], outputs: [] };
  const root = h(doc, 'div', `ins-panel ins-${node.kind === 'agent' ? 'agent' : node.kind === 'script' ? 'script' : `flow ins-${node.kind}`}`);
  root.dataset.nodeId = node.id;
  const body = h(doc, 'div', 'ins-body-in');

  if (node.kind === 'agent') {
    root.appendChild(head(doc, (meta && meta.displayName) || node.key || node.id, `${node.key} · ${node.id}`));
    if (session) body.appendChild(memberRow(doc, node.id, session));
    // Hidden built-ins (#422) leave the list unless one is THIS node's stored
    // pick — it still resolves at run time and must stay visible here.
    const offered = models.filter((m) => m && (!m.hidden || m.id === node.config.model));
    // A node knows no run engine: with more than one provider in the catalog the list is grouped by provider
    // (Claude sign-in, ChatGPT sign-in, OpenAI-compatible, …), each model naming the harnesses that run it when that
    // is not Claude Code alone. A pick the run's harness cannot run is skipped at run time (§4.2).
    const harnessNote = (m) => { const hs = harnessesOf(m); return hs.length === 1 && hs[0] === 'claude' ? '' : ` · ${hs.map(engineLabel).join(', ')}`; };
    // Grouped by connection like every model picker (src/shared/connections.mjs modelGroups).
    const modelItems = modelGroups(offered).map((g) => ({ group: g.label, items: g.models.map((m) => ({ value: m.id, text: (m.label || m.id) + modelSourceSuffix(m) + harnessNote(m) })) }));
    body.appendChild(select(doc, 'ins-model', 'model', 'Model', [{ value: '', text: 'inherit' }, ...modelItems], node.config.model));
    // Efforts are per engine: the picked model's own list, else the catalog-wide one.
    const picked = node.config.model ? offered.find((m) => m.id === node.config.model) : null;
    const effortList = picked && Array.isArray(picked.efforts) && picked.efforts.length ? picked.efforts : efforts;
    body.appendChild(select(doc, 'ins-effort', 'effort', 'Effort',
      [{ value: '', text: 'default' }, ...effortList.map((e) => ({ value: e, text: e }))], node.config.effort));
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

/** A member's row under its head (05 §5.2): `session` = { sid, label, index (1-based), count }. */
function memberRow(doc, nodeId, { sid, label, index, count }) {
  const row = h(doc, 'div', 'ins-member');
  row.appendChild(h(doc, 'span', 'ins-member-t', `In ${label} · step ${index} of ${count}`));
  const pick = h(doc, 'button', 'btn btn-quiet btn-sm', 'Select session');
  pick.type = 'button';
  pick.dataset.sessSelect = sid;
  const leave = h(doc, 'button', 'btn btn-quiet btn-sm', 'Leave');
  leave.type = 'button';
  leave.dataset.sessLeave = nodeId;
  row.append(pick, leave);
  return row;
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const MODE_HINT = {
  live: 'Each step runs as its own sub-agent with a fresh context. The main agent hands work over and keeps their reports.',
  separate: 'Each step runs in its own session, one after another.',
};

/**
 * The session panel (05 §5.1). It says what runs where and promises nothing the gate denies: "Sub-agents" is offered
 * only where `sessionSupport(engine, {verified})` says the steps really run as sub-agents. Fields route by data-field
 * through the composer's delegated `change` listener; the panel names its session (`data-session-id`); buttons carry
 * `data-sess-*` for the delegated click.
 * @param {object} spec  a SessionSpec (sessions.mjs sessionsOf)
 * @param {object} o  template + portsFn (the "Add" rows; none without them), labels {id: text}, models, efforts,
 *   engine, verified, members (sessionNotes' member facts), split (a V27 fires), canAdd (the Labs flag), doc
 */
export function renderSessionInspector(spec, { template = null, portsFn = null, labels = {}, models = [], efforts = [],
  engine = 'claude', verified = SESSION_SUBAGENTS_VERIFIED, members = [], split = false, canAdd = true, doc = globalThis.document } = {}) {
  const s = spec.settings || {};
  const labelOf = (id) => labels[id] || id;
  const root = h(doc, 'div', 'ins-panel ins-session');
  root.dataset.sessionId = spec.sid;
  root.appendChild(head(doc, 'One session', `${spec.sid} · ${plural(spec.members.length, 'step')}`));
  const body = h(doc, 'div', 'ins-body-in');
  const name = text(doc, 'ins-sess-label', 'label', 'Name', s.label || SESSION_DEFAULT_LABEL);
  name.querySelector('input').maxLength = SESSION_LABEL_MAX;      // V30 refuses a longer label, and Save with it
  body.appendChild(name);

  body.appendChild(h(doc, 'div', 'ins-zone', 'Steps'));
  const nodeOf = (id) => ((template && template.nodes) || []).find((n) => n && n.id === id) || null;
  const modelText = (id) => {
    const cfg = (nodeOf(id) || {}).config || {};
    const m = cfg.model ? models.find((x) => x && x.id === cfg.model) : null;
    const name = cfg.model ? ((m && m.label) || cfg.model) : 'inherit';
    return cfg.effort ? `${name} · ${cfg.effort}` : name;
  };
  const ol = h(doc, 'ol', 'ins-steps');
  spec.members.forEach((id, i) => {
    const li = h(doc, 'li', 'ins-step');
    li.dataset.stepId = id;
    li.append(h(doc, 'span', 'idx', String(i + 1)), h(doc, 'span', 'lbl', labelOf(id)), h(doc, 'span', 'mdl', modelText(id)));
    const x = h(doc, 'button', 'btn btn-quiet btn-sm btn-icon ins-step-leave');
    x.appendChild(icon(doc, 'x', 14));
    x.type = 'button';
    x.dataset.sessLeave = id;
    x.title = 'Leave the session';
    x.setAttribute('aria-label', `${labelOf(id)}: leave the session`);
    li.appendChild(x);
    ol.appendChild(li);
  });
  body.appendChild(ol);
  if (canAdd && template && typeof portsFn === 'function') {
    for (const c of sessionCandidates(template, portsFn, { sid: spec.sid, labelOf }).filter((x) => x.ok)) {
      const add = h(doc, 'button', 'btn btn-quiet btn-sm ins-step-add');
      add.append(icon(doc, 'plus', 14), doc.createTextNode(`Add ${labelOf(c.nodeId)} · ${c.side}`));
      add.type = 'button';
      add.dataset.sessAdd = c.nodeId;
      body.appendChild(add);
    }
  }

  const live = sessionSupport(engine, { verified }).subagents;
  const how = field(doc, 'ins-sess-mode', 'How it runs');
  const seg = h(doc, 'div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'How it runs');
  const segBtn = (mode, label) => {
    const on = (s.mode || 'subagents') === mode;
    const b = h(doc, 'button', on ? 'on' : '', label);
    b.type = 'button';
    b.dataset.sessMode = mode;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    return b;
  };
  // Not live: the reason names what holds it back, the Labs flag (canAdd) or else the engine's gate.
  if (live) seg.appendChild(segBtn('subagents', 'Sub-agents'));
  else how.appendChild(h(doc, 'span', 'ins-resolved', `Separate sessions (${canAdd ? 'sub-agents not available yet' : 'off in Settings › Labs'})`));
  const shared = segBtn('shared', 'One conversation');
  shared.dataset.minLevel = 'expert';
  // Selectable once `shared` runs: Task 66 flips SESSION_SHARED_SELECTABLE (sessions.mjs), here and in the toolbar.
  if (!SESSION_SHARED_SELECTABLE) { shared.disabled = true; shared.title = 'Not available yet'; }
  seg.appendChild(shared);
  how.appendChild(seg);
  body.appendChild(how);
  if (s.mode !== 'shared') body.appendChild(h(doc, 'small', 'ins-hint', live ? MODE_HINT.live : MODE_HINT.separate));

  const offered = models.filter((m) => m && (!m.hidden || m.id === s.hostModel));
  const modelItems = modelGroups(offered).map((g) => ({ group: g.label, items: g.models.map((m) => ({ value: m.id, text: (m.label || m.id) + modelSourceSuffix(m) })) }));
  body.appendChild(lv(select(doc, 'ins-sess-host-model', 'hostModel', 'Main agent model', [{ value: '', text: 'inherit' }, ...modelItems], s.hostModel || ''), 'advanced', Boolean(s.hostModel)));
  // The main agent's model decides its efforts, as a step's model does; a saved value it lacks stays visible.
  const hm = s.hostModel ? models.find((m) => m && m.id === s.hostModel) : null;
  const hostEfforts = hm && Array.isArray(hm.efforts) && hm.efforts.length ? hm.efforts : efforts;
  const effList = s.hostEffort && !hostEfforts.includes(s.hostEffort) ? [...hostEfforts, s.hostEffort] : hostEfforts;
  body.appendChild(lv(select(doc, 'ins-sess-host-effort', 'hostEffort', 'Main agent effort',
    [{ value: '', text: 'default' }, ...effList.map((e) => ({ value: e, text: e }))], s.hostEffort || ''), 'advanced', Boolean(s.hostEffort)));
  if (live && s.mode !== 'shared') body.appendChild(lv(h(doc, 'small', 'ins-hint', 'A small model is enough: the main agent only hands work to its sub-agents.'), 'advanced'));

  const harness = field(doc, 'ins-sess-harness', 'Harness');
  harness.appendChild(h(doc, 'div', 'ins-resolved', "the run's engine, chosen at Start run"));
  const yes = Object.keys(ENGINES).filter((e) => sessionSupport(e, { verified }).subagents);
  harness.appendChild(h(doc, 'small', 'ins-hint', yes.length
    ? `Sub-agents on ${yes.map(engineLabel).join(', ')}; every other engine runs these steps as separate sessions.`
    : 'Every engine runs these steps as separate sessions.'));
  body.appendChild(harness);

  // The Labs flag off is the reason the steps run separately, whatever the gate says (C14): name the flag, not the engine.
  const notes = sessionNotes(spec, { engine, verified, members, labelOf }).filter((n) => canAdd || n.code !== 'gate-off');
  if (!canAdd) notes.unshift({ level: 'info', code: 'flag-off', text: 'One session is off in Settings › Labs: these steps run as separate sessions.' });
  if (notes.length) {
    const ul = h(doc, 'ul', 'ins-notes');
    for (const n of notes) { const li = h(doc, 'li', `ins-note is-${n.level}`, n.text); li.dataset.code = n.code; ul.appendChild(li); }
    body.appendChild(ul);
  }
  body.appendChild(h(doc, 'p', 'ins-blurb', 'worca still decides what runs next, so files, loop limits and reviews work as they do today.'));
  const acts = h(doc, 'div', 'ins-sess-acts');
  if (split) { const b = h(doc, 'button', 'btn btn-sm', 'Split'); b.type = 'button'; b.dataset.sessAct = 'split'; acts.appendChild(b); }
  const ug = h(doc, 'button', 'btn btn-sm', 'Ungroup');
  ug.type = 'button';
  ug.dataset.sessAct = 'ungroup';
  acts.appendChild(ug);
  body.appendChild(acts);
  root.appendChild(body);
  return root;
}

export function renderEmptyInspector({ doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ins-panel ins-empty');
  root.appendChild(h(doc, 'p', 'ins-blurb', 'Select a node or a wire to configure it.'));
  return root;
}

/** Every field at every interface level (the Workflows view, D5): drop the simple-level alternates
 *  (`data-max-level`) and un-gate the rest (`data-min-level`, `data-level-keep`). */
export function stripLevels(root) {
  if (!root || !root.querySelectorAll) return root;
  for (const n of [...root.querySelectorAll('[data-max-level]')]) n.remove();
  for (const n of root.querySelectorAll('[data-min-level]')) { n.removeAttribute('data-min-level'); n.removeAttribute('data-level-keep'); }
  return root;
}
