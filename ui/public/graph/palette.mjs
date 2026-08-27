// ui/public/graph/palette.mjs
// The rail's Agents tab: one DISCLOSURE per domain (plus the PINNED Flow group),
// a filter, and agent pills stacked one per row. Pure DOM + one delegated
// controller; it never touches the template — it calls back into the composer,
// which owns every mutation.
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

/** The disclosure caret. Turned by CSS off `aria-expanded`, so the header's
 *  state can never disagree with the pills it hides. */
function chevron(doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  for (const [k, v] of [['class', 'chev'], ['width', '13'], ['height', '13'], ['viewBox', '0 0 24 24'],
    ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2.6'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  const path = doc.createElementNS(NS, 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export function renderPalette(host, { agents = [], placedKinds = [], collapsed = new Set(), query = '', doc = globalThis.document } = {}) {
  if (!host) return;
  const groups = paletteEntries(agents, { placedKinds });
  const frag = doc.createDocumentFragment();
  for (const g of groups) {
    const sec = h(doc, 'section', `pal-group${g.flow ? ' pal-pinned' : ''}`);
    sec.dataset.domain = g.domain;
    // The group HEAD is the control: there is no separate chip row, so a domain
    // can only be reached — and only be folded away — through its own header.
    const head = h(doc, 'button', 'pal-grp');
    head.type = 'button';
    head.dataset.domain = g.domain;
    head.append(chevron(doc), h(doc, 'span', 'lab', g.flow ? 'Flow' : g.domain), h(doc, 'span', 'chip', String(g.agents.length)));
    if (g.flow) head.appendChild(h(doc, 'span', 'chip pinned-tag', 'pinned'));
    const pills = h(doc, 'div', 'pills');
    for (const a of g.agents) pills.appendChild(pill(doc, a));
    sec.append(head, pills);
    frag.appendChild(sec);
  }
  // host IS the scroll container: replaceChildren collapses scrollHeight, which
  // clamps scrollTop to 0 and would bounce the list to the top after every
  // spawn, throwing the pinned Flow group out of reach.
  const keep = host.scrollTop;
  host.replaceChildren(frag);
  if (keep) host.scrollTop = keep;
  applyFilter(host, query, collapsed);
}

/** Hides non-matching pills, then settles each group's disclosure. A LIVE QUERY
 *  force-expands every matching group: a hit folded away inside a collapsed
 *  header reads as a broken filter. Clearing the query restores the collapse. */
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
    const open = Boolean(q) || !collapsed.has(sec.dataset.domain);
    sec.hidden = !any;
    const head = sec.querySelector('.pal-grp');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    const pills = sec.querySelector('.pills');
    if (pills) pills.hidden = !open;
  }
}
