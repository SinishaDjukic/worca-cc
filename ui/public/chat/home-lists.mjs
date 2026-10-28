// ui/public/chat/home-lists.mjs — the Chat home's tabs and the lists that are not run tiles (worca Chat P6): the tab
// strip (Needs you · Running · Recent chats · Plans (gated) · Workflows; one sliding underline; roving focus), the default-tab rule,
// Recent chats rows (GET /api/ask/threads rows) and the Workflows grid (the Library's thumbnails, thumbnail.mjs).
import { thumbnailFor } from '../graph/view.mjs';
import { fmtUsd } from '../graph/run-decor.mjs';
import { fmtStarted } from '../ask-panel.mjs';
import { classifyLoops } from '../../../src/shared/graph/loops.mjs';
import { homeIcon } from './home-icons.mjs';
import { featureHeadline } from '../shape/feature-view.mjs';

export const HOME_TABS = Object.freeze(['needs', 'running', 'chats', 'plans', 'workflows']);
export const HOME_TAB_LABELS = Object.freeze({ needs: 'Needs you', running: 'Running', chats: 'Recent chats', plans: 'Plans', workflows: 'Workflows' });
export const HOME_TAB_EMPTY = Object.freeze({ needs: 'Nothing needs you', running: 'Nothing running', chats: 'No saved chats.', plans: 'No plans yet', workflows: 'No workflows' });
/** sessionStorage: the tab the user picked this session (it wins over the default on every later visit). */
export const HOME_TAB_KEY = 'worca-cc.chat.homeTab';
export const RECENT_CHATS_MAX = 6;
export const WORKFLOWS_MAX = 12;
/** The server's built-ins (ui/server.mjs GET /api/workflows; library.mjs RESERVED). */
export const BUILTIN_WORKFLOW_IDS = Object.freeze(['wf_default', 'wf_memory_defrag']);
const PANEL_ID = 'chat-home-panel';
/** The screen-reader words for the three dots (worca Chat P1): Replying, Needs you, Following a run. */
const DOT_TEXT = Object.freeze({ think: 'Replying', wait: 'Needs you', live: 'Following a run' });

const make = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** The tab a visit opens on: Needs you if anything does, else Running, else Recent chats if any chat exists, else
 *  Workflows. null = not decidable yet (no run says so and the chat list has not loaded). */
export function defaultTab({ needs = 0, running = 0, chats = null } = {}) {
  if (needs > 0) return 'needs';
  if (running > 0) return 'running';
  if (chats == null) return null;
  return chats > 0 ? 'chats' : 'workflows';
}

export function createHomeTabs({ doc, onSelect }) {
  const el = make(doc, 'div', 'chat-home-tabs');
  const list = make(doc, 'div', 'chat-home-tablist tabs');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Runs and chats');
  const panel = make(doc, 'div', 'chat-home-panel');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = 0;
  const btns = new Map();
  for (const t of HOME_TABS) {
    const b = make(doc, 'button', 'chat-home-tab tab');
    b.type = 'button';
    b.id = `chat-home-tab-${t}`;
    b.dataset.tab = t;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('aria-controls', PANEL_ID);
    b.tabIndex = t === HOME_TABS[0] ? 0 : -1;
    b.appendChild(make(doc, 'span', 'chat-home-tab-l', HOME_TAB_LABELS[t]));
    if (t === 'needs') {
      const n = make(doc, 'span', 'chat-home-tab-n');
      n.hidden = true;
      b.appendChild(n);
    }
    b.addEventListener('click', () => onSelect(t, { user: true }));
    btns.set(t, b);
    list.appendChild(b);
  }
  list.addEventListener('keydown', (e) => {
    const shown = visibleTabs();
    const i = shown.indexOf(e.target && e.target.dataset ? e.target.dataset.tab : '');
    if (i < 0) return;
    const last = shown.length - 1;
    const j = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (j < 0) return;
    e.preventDefault();
    onSelect(shown[j], { user: true });
    btns.get(shown[j]).focus();
  });
  el.append(list, panel);

  /** The tabs whose button shows. */
  function visibleTabs() { return HOME_TABS.filter((t) => !btns.get(t).hidden); }
  let sel = null;
  /** A phone-width strip scrolls sideways: bring the selected tab into it when the SELECTION changes — never from
   *  the 1 s re-read (setNeeds) or a resize: that would snap back a strip the user is
   *  swiping. Never scrollIntoView — it scrolls the home too. */
  function revealSelected() {
    const b = sel ? btns.get(sel) : null;
    if (b && list.scrollWidth > list.clientWidth) {
      const l = b.offsetLeft || 0;
      const r = l + (b.offsetWidth || 0);
      if (l < list.scrollLeft) list.scrollLeft = l;
      else if (r > list.scrollLeft + list.clientWidth) list.scrollLeft = r - list.clientWidth;
    }
  }
  function select(t) {
    sel = HOME_TABS.includes(t) ? t : null;
    for (const [k, b] of btns) {
      const on = k === sel;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on || (!sel && k === visibleTabs()[0]) ? 0 : -1;
    }
    if (sel) { panel.setAttribute('aria-labelledby', `chat-home-tab-${sel}`); panel.dataset.tab = sel; }
    else { panel.removeAttribute('aria-labelledby'); delete panel.dataset.tab; }
    revealSelected();
  }
  function setNeeds(n) {
    const c = btns.get('needs').querySelector('.chat-home-tab-n');
    const v = Number(n) > 0 ? String(n) : '';
    if (c.textContent !== v) c.textContent = v;
    c.hidden = !v;
  }
  return { el, panel, select, selected: () => sel, setNeeds, visibleTabs, destroy() {} };
}

/** A chat row's dot: green while its reply streams, amber while a run it follows waits on you, violet while a run it
 *  follows is live (P1's `waiting` flag + the list's `inFlight` / `tracking`). '' = no dot colour. */
export function chatDot(t) {
  if (t && t.inFlight) return 'think';
  if (t && t.waiting) return 'wait';
  if (t && t.tracking) return 'live';
  return '';
}
/** "2h ago · worca-cc · $0.42": when it last moved, its first topic, its cost (a zero cost is left out). */
export function chatMeta(t, now = Date.now()) {
  const parts = [];
  const when = fmtStarted(t && (t.updatedAt || t.createdAt), now);
  if (when) parts.push(when);
  const topic = t && Array.isArray(t.contexts) ? t.contexts.find((c) => c && typeof c.id === 'string' && c.id) : null;
  if (topic) parts.push(topic.label || topic.id);
  const cost = t && t.totals ? Number(t.totals.costUsd) : NaN;
  if (Number.isFinite(cost) && cost > 0) parts.push(fmtUsd(cost));
  return parts.join(' · ');
}

export function buildChatsList(doc, threads, { onOpen, now = Date.now() }) {
  const ul = make(doc, 'ul', 'chat-home-chats');
  for (const t of threads) {
    const li = make(doc, 'li', 'chat-home-chat-li');
    const b = make(doc, 'button', 'chat-home-chat');
    b.type = 'button';
    b.dataset.threadId = t.id;
    const state = chatDot(t);
    const dot = make(doc, 'span', `chat-home-dot${state ? ` is-${state}` : ''}`);
    dot.setAttribute('aria-hidden', 'true');
    if (state) dot.title = DOT_TEXT[state];
    const col = make(doc, 'span', 'chat-home-chat-col');
    col.append(make(doc, 'span', 'chat-home-chat-t', t.title || 'New chat'), make(doc, 'span', 'chat-home-chat-m', chatMeta(t, now)));
    const chev = make(doc, 'span', 'chat-home-chev');
    chev.appendChild(homeIcon(doc, 'chevron', 14));
    b.append(dot, col);
    if (state) b.appendChild(make(doc, 'span', 'sr-only', DOT_TEXT[state]));
    b.appendChild(chev);
    b.addEventListener('click', () => onOpen(t.id));
    li.appendChild(b);
    ul.appendChild(li);
  }
  return ul;
}

const PLAN_STATE_TEXT = Object.freeze({ shaping: 'shaping', waiting: 'waiting for approval', running: 'running', done: 'done', stopped: 'stopped', paused: 'paused' });

/** The Plans tab: one row per shaped plan (GET /api/shape/plans). The row button opens its chat; a sliced plan adds a
 *  sibling <details> (never nested in the button) whose feature card mounts on the first open. `open` (a Set of feature
 *  ids, kept by home.mjs) survives a rebuild: a row whose feature is in it is built open and mounted at once. */
export function buildPlansList(doc, rows, { onOpen, mountFeature, open = null }) {
  const ul = make(doc, 'ul', 'chat-home-plans');
  for (const row of rows) {
    const li = make(doc, 'li', 'chat-home-plan');
    const b = make(doc, 'button', 'chat-home-plan-open');
    b.type = 'button';
    b.dataset.threadId = row.threadId;
    const col = make(doc, 'span', 'chat-home-plan-col');
    col.append(make(doc, 'span', 'chat-home-plan-t', row.title || 'Plan'), make(doc, 'span', 'chat-home-plan-m', row.threadTitle || ''));
    const chip = make(doc, 'span', `chat-home-plan-state is-${row.state}`, PLAN_STATE_TEXT[row.state] || row.state || '');
    b.append(col, chip);
    b.addEventListener('click', () => onOpen(row.threadId));
    li.appendChild(b);
    if (row.feature) {
      const details = make(doc, 'details', 'chat-home-plan-feature');
      details.appendChild(make(doc, 'summary', null, featureHeadline(row.feature)));
      const host = make(doc, 'div', 'chat-home-plan-feature-body');
      details.appendChild(host);
      const mount = () => { if (!host.dataset.mounted) { host.dataset.mounted = '1'; mountFeature(host, row.feature.id); } };
      details.addEventListener('toggle', () => {
        if (details.open) { open?.add(row.feature.id); mount(); } else open?.delete(row.feature.id);
      });
      if (open?.has(row.feature.id)) { details.open = true; mount(); }
      li.appendChild(details);
    }
    ul.appendChild(li);
  }
  return ul;
}

/** "2 agents · 1 loop · built-in" (loops by the shared classifier, like the Library). '' for a legacy row. */
export function workflowMeta(w, portsFn) {
  const parts = [];
  if (Array.isArray(w && w.nodes)) {
    const agents = w.nodes.filter((n) => n && n.kind === 'agent').length;
    parts.push(`${agents} agent${agents === 1 ? '' : 's'}`);
    if (typeof portsFn === 'function') {
      let loops = 0;
      try { loops = classifyLoops(w, portsFn).loopWireIds.size; } catch { loops = 0; }
      if (loops) parts.push(`${loops} loop${loops === 1 ? '' : 's'}`);
    }
  }
  if (w && BUILTIN_WORKFLOW_IDS.includes(w.id)) parts.push('built-in');
  return parts.join(' · ');
}

export function buildWorkflowsGrid(doc, list, portsFn, { onRun }) {
  const grid = make(doc, 'div', 'chat-home-wfs');
  for (const w of list) {
    const b = make(doc, 'button', 'chat-home-wf');
    b.type = 'button';
    b.dataset.workflowId = w.id;
    const tb = make(doc, 'span', 'chat-home-wf-tb');
    tb.setAttribute('aria-hidden', 'true');
    const svg = w.version === 2 && typeof portsFn === 'function' ? thumbnailFor(w, portsFn, { width: 240, height: 112 }) : '';
    if (svg) tb.innerHTML = svg;   // thumbnail.mjs: numbers only — no ids, names or author text
    b.append(tb, make(doc, 'span', 'chat-home-wf-n', w.name || w.id), make(doc, 'span', 'chat-home-wf-m', workflowMeta(w, portsFn)));
    b.addEventListener('click', () => onRun(w));
    grid.appendChild(b);
  }
  return grid;
}

/** The New run prefill a workflow card leaves: "Run <name> on <project>: " (no project known: "Run <name>: "). */
export function runWorkflowText(name, project) {
  return project ? `Run ${name} on ${project}: ` : `Run ${name}: `;
}

export function emptyState(doc, text) {
  return make(doc, 'p', 'chat-home-empty', text);
}
