// ui/public/workflows/card-views.mjs
// The DOM of a drafted agent / script card and of a proposed whole workflow, shared by the Workflows chat
// (chat-cards.mjs: canvas buttons) and Ask Worca (ask-composer-cards.mjs: no canvas). Pure DOM: the host passes the
// state to show, the callbacks and any extra buttons; nothing here posts, saves or touches a canvas.
import { icon } from '../icons.mjs';

/** The green saved/applied chip: a check icon, then the words. */
export function okChip(h, text) {
  const s = h('span', 'wfc-chip-ok');
  s.append(icon(s.ownerDocument, 'check', 12), ` ${text}`);
  return s;
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const RUNNER_SIDE = { code: 'code: edits the worktree (implementer tool set)', memory: 'memory: edits worca memory only (no Bash)' };

/** `h` builds an element. `button` runs its click handler once at a time — in flight: aria-disabled + a flag, never
 *  `disabled`: Chrome moves the focus of a button that turns disabled to <body>, where the canvas owns the keys (the next
 *  Backspace deletes the selected card, an arrow nudges it) — and calls onChange when it settles. */
export function cardKit(doc, { onChange = () => {} } = {}) {
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, cls, onClick) => {
    const b = h('button', cls || 'btn btn-sm', text);
    b.type = 'button';
    let busy = false;
    b.addEventListener('click', async () => {
      if (b.disabled || busy) return;
      busy = true; b.setAttribute('aria-disabled', 'true');
      try { await onClick(); } finally { busy = false; b.removeAttribute('aria-disabled'); onChange(); }
    });
    return b;
  };
  return { h, button };
}

function portList(h, label, list, script) {
  const box = h('div', 'wfc-io');
  box.appendChild(h('div', 'wfc-k', label));
  for (const p of Array.isArray(list) ? list : []) {
    const when = p.when === 'blocking' ? (script ? 'on fail' : 'on blocking') : p.when === 'clean' ? (script ? 'on pass' : 'on clean') : '';
    const bits = [p.id, p.type, p.loop ? 'loop' : '', p.required === false ? 'optional' : '', p.expands ? '⤫N' : '', when].filter(Boolean);
    box.appendChild(h('div', 'wfc-port mono', bits.join(' · ')));
  }
  if (!(Array.isArray(list) && list.length)) box.appendChild(h('div', 'wfc-muted', '—'));
  return box;
}

/** A drafted agent / script. `state` is the state to SHOW (Ask shows a key the library holds as saved, and an older
 *  proposed card of a re-drafted key as 'superseded': Decline only); `notAdded` is
 *  the "not added to the canvas" reason a saved card shows; `savedExtra(row)` / `proposedExtra(row)` append the host's
 *  canvas buttons. */
export function draftCardView(b, { h, button, state = b.state, notAdded = '', onEdit, onDecline, onSave, savedExtra = null, proposedExtra = null }) {
  const c = b.card;
  const d = c.draft || {};
  const m = d.meta || {};
  const isAgent = c.type === 'agent-draft';
  const el = h('div', `wfc-card wfc-draft is-${state}`);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', isAgent ? 'New agent' : 'New script');
  const head = h('div', 'wfc-card-t', isAgent ? 'New agent' : 'New script');
  head.appendChild(h('span', 'wfc-chip', state === 'saved' || state === 'added' ? 'saved' : 'draft'));
  el.appendChild(head);
  const id = h('div', 'wfc-ident');
  id.append(h('span', 'wfc-name', m.displayName || d.key), ...(isAgent ? [] : [h('span', 'wfc-chip mono', m.runtime === 'shell' ? 'Shell' : m.runtime === 'python' ? 'Python' : 'Node.js')]), h('span', 'mono wfc-muted', d.key));
  el.appendChild(id);
  if (m.description) el.appendChild(h('p', 'wfc-reason', m.description));
  if (isAgent) {
    const chips = h('div', 'wfc-chips');
    chips.appendChild(h('span', 'wfc-chip mono', m.runnerType || 'producer'));
    if (m.fanOut) chips.appendChild(h('span', 'wfc-chip', 'Research fan-out'));
    if (m.asksQuestions) chips.appendChild(h('span', 'wfc-chip', 'Asks questions'));
    chips.appendChild(h('span', 'wfc-chip', RUNNER_SIDE[m.sideEffect] || 'none: writes only its output ports'));
    el.appendChild(chips);
  }
  const io = h('div', 'wfc-iogrid');
  io.append(portList(h, 'Inputs', m.inputs, !isAgent), portList(h, 'Outputs', m.outputs, !isAgent));
  if (!isAgent && Array.isArray(m.params) && m.params.length) io.appendChild(portList(h, 'Params', m.params.map((p) => ({ id: p.id, type: p.type })), true));
  el.appendChild(io);
  const det = h('details', 'wfc-src');
  det.appendChild(h('summary', '', isAgent ? 'System prompt' : `Program${Array.isArray(d.cases) && d.cases.length ? ` · ${plural(d.cases.length, 'test case')}` : ''}`));
  det.appendChild(h('pre', 'mono', isAgent ? (d.markdown || '') : (d.source || '')));
  el.appendChild(det);
  const row = h('div', 'wfc-actions');
  const name = m.displayName || d.key;
  if (state === 'declined') row.appendChild(h('span', 'wfc-muted', `Declined: ${name}`));
  else if (state === 'failed') row.appendChild(h('span', 'wfc-err', b.error || 'failed'));
  else if (state === 'added') row.appendChild(okChip(h, 'Saved and added'));
  else if (state === 'superseded') row.append(h('span', 'wfc-muted', 'Replaced by a newer draft'), h('span', 'wfc-spacer'), button('Decline', 'btn btn-sm', () => onDecline()));
  else if (state === 'saved') {
    if (notAdded) el.appendChild(h('p', 'wfc-err', `Not added to the canvas: ${notAdded}`));   // above the actions row
    row.appendChild(okChip(h, `Saved to your ${isAgent ? 'agents' : 'scripts'}`));
    if (savedExtra) savedExtra(row);
  } else {
    row.append(
      button('Edit…', 'btn btn-sm', () => onEdit(d)),
      button('Decline', 'btn btn-sm', () => onDecline()),
      h('span', 'wfc-spacer'),
      button(isAgent ? 'Save agent' : 'Save script', 'btn btn-sm', () => onSave()),
    );
    if (proposedExtra) proposedExtra(row);
  }
  el.appendChild(row);
  return el;
}

/** A proposed whole workflow: name, reasoning, an optional graph (Ask draws one; the Workflows chat's canvas is its
 *  preview), loops, the drafts it brings, counts. Declined and failed are one line; `actions(row)` fills the rest. */
export function buildCardView(b, { h, graph = null, title = 'Proposed workflow', actions }) {
  const c = b.card;
  const el = h('div', `wfc-card wfc-plan is-${b.state}`);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Proposed workflow');
  if (b.state === 'declined') { el.appendChild(h('p', 'wfc-muted', `Declined: ${c.name}`)); return el; }
  if (b.state === 'failed') { el.appendChild(h('p', 'wfc-err', `Proposal failed: ${b.error || 'failed'}`)); return el; }
  el.appendChild(h('div', 'wfc-card-t', title));
  el.appendChild(h('div', 'wfc-name', c.name || 'Untitled pipeline'));
  if (c.reasoning) el.appendChild(h('p', 'wfc-reason', c.reasoning));
  if (graph) el.appendChild(graph);
  const titles = new Map(((c.workflow && c.workflow.nodes) || []).map((n) => [n.id, n.key || n.kind]));
  if ((c.loops || []).length) {
    const ul = h('ul', 'wfc-loops');
    for (const l of c.loops) ul.appendChild(h('li', '', `${titles.get(l.from) || l.from} → ${titles.get(l.to) || l.to} · max ${l.max} cycles`));
    el.appendChild(ul);
  }
  if ((c.drafts || []).length) {
    el.appendChild(h('div', 'wfc-sub', 'New in your library'));
    for (const key of c.drafts) el.appendChild(h('div', 'wfc-new mono', key));
  }
  const n = c.counts || {};
  el.appendChild(h('div', 'wfc-meta mono', `${plural(n.agents || 0, 'agent')} · ${plural(n.scripts || 0, 'script')} · ${plural(n.loops || 0, 'loop')}`));
  if (c.todo) el.appendChild(h('div', 'wfc-muted', `${plural(c.todo, 'port')} still to wire`));
  const row = h('div', 'wfc-actions');
  actions(row);
  el.appendChild(row);
  return el;
}

/** G6 (src/core/ask/script-approval.mjs): the chat asks before it runs a draft script or replaces a saved one. The
 *  program is shown open — it is exactly what the click runs or saves. `onAnswer(body)` posts the card's verb and
 *  resolves to '' or the refusal to show. */
export function scriptApprovalCardView(b, { h, button, onAnswer }) {
  const c = b.card || {};
  const isSave = c.kind === 'save';
  const isSaved = !isSave && !c.draft && !!c.saved;   // a saved script run by its key (built-in, plugin, or a command/code param set)
  const p = (isSave ? c.save : c.draft || c.saved) || {};
  const m = p.meta || {};
  const el = h('div', `wfc-card wfc-draft wfc-approval is-${b.state}`);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', isSave ? 'Replace a script' : 'Run a draft script');
  if (b.state === 'declined') { el.appendChild(h('p', 'wfc-muted', `Declined: ${c.summary || c.key}`)); return el; }
  const what = isSaved ? 'Script' : 'Draft script';
  const title = b.state === 'applied' ? (isSave ? 'Script saved' : `${what} ran`)
    : b.state === 'failed' ? (isSave ? 'Script not saved' : `${what} did not run`)
      : (isSave ? 'Chat wants to replace your script' : isSaved ? 'Chat wants to run a script' : 'Chat wants to run a draft script');
  el.appendChild(h('div', 'wfc-card-t', title));
  const id = h('div', 'wfc-ident');
  id.append(h('span', 'wfc-name', c.displayName || m.displayName || c.key),
    h('span', 'wfc-chip mono', c.runtime === 'shell' ? 'Shell' : c.runtime === 'python' ? 'Python' : 'Node.js'), h('span', 'mono wfc-muted', c.key));
  el.appendChild(id);
  if (b.state === 'proposed') {
    const r = c.request || {};
    el.appendChild(h('p', 'wfc-reason', isSave
      ? 'Saving replaces the program your workflows and schedules run with this one.'
      : `It runs on this machine with your access and no sandbox, in ${r.cwd === 'project' ? `the checkout of ${r.projectKey}` : 'an empty scratch folder'}, for up to ${r.timeoutSec || 120} s.`));
  }
  // Every value that decides what runs, open: a command/code param or meta.command replaces or drives the program.
  for (const v of Array.isArray(c.values) ? c.values : []) {
    const vd = h('details', 'wfc-src');
    vd.open = b.state === 'proposed';
    vd.appendChild(h('summary', '', v.type === 'meta' ? 'Command' : `${v.type === 'code' ? 'Code' : 'Command'} (param ${v.id})`));
    vd.appendChild(h('pre', 'mono', String(v.value ?? '')));
    el.appendChild(vd);
  }
  const det = h('details', 'wfc-src');
  det.open = b.state === 'proposed';
  det.appendChild(h('summary', '', isSaved ? 'Saved program' : 'Program'));
  det.appendChild(h('pre', 'mono', p.source || ''));
  if (p.sourceTruncated) det.appendChild(h('p', 'wfc-muted', `Shortened here: the whole program is on the Scripts page (${c.key}).`));
  el.appendChild(det);
  if (p.sourceWin32) {
    const win = h('details', 'wfc-src');
    win.appendChild(h('summary', '', 'Program (Windows)'));
    win.appendChild(h('pre', 'mono', p.sourceWin32));
    el.appendChild(win);
  }
  const err = h('p', 'wfc-err');
  err.hidden = true;
  err.setAttribute('role', 'status');
  const answer = async (body) => {
    err.hidden = true;
    const why = await onAnswer(body);
    if (why) { err.textContent = why; err.hidden = false; }
  };
  const row = h('div', 'wfc-actions');
  const res = (c.result && c.result.result) || null;
  if (b.state === 'failed') row.appendChild(h('span', 'wfc-err', b.error || (c.result && c.result.error) || 'failed'));
  else if (b.state === 'applied') {
    row.appendChild(okChip(h, isSave ? 'Saved to your scripts'
      : `${res && res.status ? res.status : 'done'}${res && Number.isInteger(res.exitCode) ? `, exit ${res.exitCode}` : ''}`));
  } else {
    row.append(
      button(isSave ? 'Don’t save' : 'Don’t run', 'btn btn-sm', () => answer({ state: 'declined' })),
      h('span', 'wfc-spacer'),
      button(isSave ? 'Save' : 'Run', 'btn btn-sm btn-primary', () => answer({ state: 'applied' })),
    );
  }
  el.append(row, err);
  return el;
}
