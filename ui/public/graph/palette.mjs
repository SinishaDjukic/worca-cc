// ui/public/graph/palette.mjs
// The agents card: domain chips, filter, agent pills and the PINNED Flow group.
// Pure DOM + one delegated controller; it never touches the template — it calls
// back into the composer, which owns every mutation.
export const FLOW_GROUP = 'flow';
/** Flow pills advertise their ports the way agent pills do (pill line 2). */
export const FLOW_PORT_LINE = {
  task: 'source · out task',
  end: 'in result · terminal',
  and: 'in in1..inN · out out',
  or: 'in in1..inN · out out',
  combine: 'in in1, in2 · out out',
};
export const FLOW_PILLS = Object.freeze([
  Object.freeze({ kind: 'task', displayName: 'Task', description: 'The pipeline entry: the prompt and its attached files.' }),
  Object.freeze({ kind: 'end', displayName: 'End', description: 'The pipeline sink. A token arriving here completes the run.' }),
  Object.freeze({ kind: 'and', displayName: 'AND', description: 'Fires when ALL of its inputs are fresh. Payloads discarded — pure sequencing.' }),
  Object.freeze({ kind: 'or', displayName: 'OR', description: 'Fires on ANY fresh input and forwards the freshest payload.' }),
  Object.freeze({ kind: 'combine', displayName: 'Combine', description: 'Joins its md inputs into one document, in port order.' }),
]);
const SINGLETON_KINDS = new Set(['task', 'end']);

/** Pill line 2: META port ids only. The synthesized `await` gate is never listed —
 *  it is not part of the agent's declared contract and every agent has one. */
export function portLineOf(entry) {
  const ids = (ports) => (Array.isArray(ports) ? ports : []).filter((p) => p && !p.synthetic).map((p) => p.id);
  const reads = ids(entry && entry.inputs);
  const writes = ids(entry && entry.outputs);
  return [reads.length ? `in ${reads.join(', ')}` : '', writes.length ? `out ${writes.join(', ')}` : ''].filter(Boolean).join(' · ');
}

/** Ordered groups: every non-shared, non-general domain in first-seen order,
 *  then `general`, then the pinned Flow group. `shared` agents are folded into
 *  every domain group; `placeable:false` agents are dropped everywhere (that is
 *  how workspaceScanner never reaches a canvas). Empty groups are omitted. */
export function paletteEntries(agents, { placedKinds = [] } = {}) {
  const list = (Array.isArray(agents) ? agents : []).filter((a) => a && a.placeable !== false)
    .map((a) => ({ ...a, order: typeof a.order === 'number' ? a.order : 99, domain: a.domain || 'general' }));
  const shared = list.filter((a) => a.domain === 'shared');
  const byOrder = (x, y) => x.order - y.order || String(x.key).localeCompare(String(y.key));
  const domains = [];
  for (const a of list) if (a.domain !== 'shared' && a.domain !== 'general' && !domains.includes(a.domain)) domains.push(a.domain);
  domains.push('general');
  const groups = domains
    .map((domain) => ({ domain, flow: false, agents: [...shared, ...list.filter((a) => a.domain === domain)].sort(byOrder) }))
    .filter((g) => g.agents.length);
  const placed = new Set(placedKinds);
  groups.push({
    domain: FLOW_GROUP, flow: true,
    agents: FLOW_PILLS.map((p) => ({ ...p, portLine: FLOW_PORT_LINE[p.kind] || '', disabled: SINGLETON_KINDS.has(p.kind) && placed.has(p.kind) })),
  });
  return groups;
}

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function pill(doc, entry) {
  const btn = h(doc, 'button', 'ap');
  btn.type = 'button';
  if (entry.key) btn.dataset.key = entry.key; else btn.dataset.kind = entry.kind;
  btn.disabled = Boolean(entry.disabled);
  if (entry.disabled) btn.classList.add('dim');
  const dot = h(doc, 'span', 'd');
  dot.dataset.color = entry.kind ? 'flow' : (entry.color || 'blue');
  const body = h(doc, 'span', 'b');
  body.append(h(doc, 'span', 'n', entry.displayName || entry.key || entry.kind),
    h(doc, 'span', 'p pt', entry.portLine != null ? entry.portLine : portLineOf(entry)));
  btn.append(dot, body);
  if (entry.disabled) btn.appendChild(h(doc, 'span', 'chip', '1 placed'));
  if (entry.description) btn.title = entry.description;
  return btn;
}

export function renderPalette(host, { agents = [], placedKinds = [], collapsed = new Set(), query = '', doc = globalThis.document } = {}) {
  if (!host) return;
  const groups = paletteEntries(agents, { placedKinds });
  const frag = doc.createDocumentFragment();
  const chips = h(doc, 'div', 'pal-chips');
  for (const g of groups) {
    if (g.flow) continue;
    const c = h(doc, 'button', `pal-chip${collapsed.has(g.domain) ? ' off' : ''}`, g.domain);
    c.type = 'button';
    c.dataset.domain = g.domain;
    chips.appendChild(c);
  }
  frag.appendChild(chips);
  for (const g of groups) {
    const sec = h(doc, 'section', `pal-group${g.flow ? ' pal-pinned' : ''}`);
    sec.dataset.domain = g.domain;
    const head = h(doc, 'div', 'grp');
    head.append(h(doc, 'span', 'lab', g.flow ? 'Flow' : g.domain), h(doc, 'span', 'chip', String(g.agents.length)));
    if (g.flow) head.appendChild(h(doc, 'span', 'chip pinned-tag', 'pinned'));
    const pills = h(doc, 'div', 'pills');
    for (const a of g.agents) pills.appendChild(pill(doc, a));
    sec.append(head, pills);
    frag.appendChild(sec);
  }
  // host IS the 300px scroll container: replaceChildren collapses scrollHeight,
  // which clamps scrollTop to 0 and would bounce the list to the top after every
  // spawn, throwing the pinned Flow group out of reach.
  const keep = host.scrollTop;
  host.replaceChildren(frag);
  if (keep) host.scrollTop = keep;
  applyFilter(host, query, collapsed);
}

export function applyFilter(host, query, collapsed = new Set()) {
  if (!host) return;
  const q = String(query || '').trim().toLowerCase();
  for (const sec of host.querySelectorAll('.pal-group')) {
    let any = false;
    for (const btn of sec.querySelectorAll('.ap')) {
      const hay = `${btn.querySelector('.n').textContent} ${btn.dataset.key || btn.dataset.kind || ''} ${btn.querySelector('.p').textContent}`.toLowerCase();
      const show = !q || hay.includes(q);
      btn.hidden = !show;
      if (show) any = true;
    }
    sec.hidden = !any || (sec.dataset.domain !== FLOW_GROUP && collapsed.has(sec.dataset.domain));
  }
}
