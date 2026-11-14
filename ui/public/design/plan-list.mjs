// The Design chat's Plan list (ui/public/design/plan-list.mjs, L4.12): the mock's Plan card (`planCard()`), then a
// Retry row per stopped section (`stoppedRows`, M12) and a recovery card per failed section (`FAIL_CARD`, M8), all in
// one `div.dz-plan-wrap` the chat mounts. It paints the plain object `selectPlanRows` gives:
// `{count, noun, rows:[{key, name, n, state, who:[{agentId, crew}]}], stopped:[{id, name}],
//   failed:[{id, name, agentId}], canRetry}`.
// Retry shows only while P2's `continue` would accept it (L4.13): a stopped row is left out until then, and a failed
// card's Retry stays disabled with its reason. A Retry is disabled while its call is out, and a refusal reads
// `Could not retry` in its row or card, with the server's word as the title, until the next press. Every string reaches
// the DOM through `textContent`; a dot's colour is only ever `var(<crew token>)`. Pure: DOM only through `doc`,
// nothing at import time.

const TOKEN_RE = /^--[a-z0-9-]+$/i;

/** The row class per plan-row state; `planned` (and anything unknown) has none. */
const STATE_CLASS = {
  done: 'is-done',
  active: 'is-active',
  waiting: 'is-active is-waiting',
  failed: 'is-failed',
  stopped: 'is-stopped',
};

const RETRY_WAIT = 'Available once the others finish';
const RETRY_REFUSED = 'Could not retry';

const tokenVar = (crew) => (typeof crew === 'string' && TOKEN_RE.test(crew) ? `var(${crew})` : '');
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
/** A stopped or failed record Retry can name: anything else would post an empty section id. */
const hasId = (s) => typeof s?.id === 'string' && s.id !== '';
const errorText = (err) => (typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : '');

// Heading ids for the failed cards' `aria-labelledby`, unique within the document.
let headSeq = 0;

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(doc, cls, text) {
  const b = make(doc, 'button', cls, text);
  b.type = 'button';
  return b;
}

function setTitle(node, text) {
  if (text) node.title = text;
  else node.removeAttribute('title');
}

/**
 * @param {{doc: Document, onRetry?: (sectionId: string) => (void|Promise<unknown>), onDetails?: (agentId: string) => void}} o
 *   `onRetry`'s promise keeps the button disabled until it settles; a rejection is the refusal shown
 * @returns {{el: HTMLElement, paint: (model: object) => void, destroy: () => void}}
 */
export function createPlanList({ doc, onRetry, onDetails }) {
  const el = make(doc, 'div', 'dz-plan-wrap');
  el.hidden = true;
  const meta = make(doc, 'span', 'dz-meta');
  const head = make(doc, 'div', 'dz-plan-head');
  head.append(make(doc, 'b', null, 'Plan'), meta);
  const rowsEl = make(doc, 'div', 'dz-plan-list');
  const card = make(doc, 'div', 'ask-card dz-plan');
  card.append(head, rowsEl);
  el.appendChild(card);

  let destroyed = false;
  /** row key -> {row, name, who, n, whoSig} */
  const rows = new Map();
  /** stopped section id -> {row, name, button} */
  const retryRows = new Map();
  /** failed section id -> {el, head, intro, note, retry, details, agentId} */
  const failCards = new Map();
  /** section ids whose Retry is out */
  const pending = new Set();
  /** section id -> the message of its refused Retry */
  const refused = new Map();
  let canRetryNow = false;

  function makeRow() {
    const e = {
      row: make(doc, 'div', 'dz-plan-row'),
      name: make(doc, 'span', 'dz-plan-name'),
      who: make(doc, 'span', 'dz-who'),
      n: make(doc, 'span', 'dz-plan-n'),
      whoSig: null,
    };
    e.row.append(make(doc, 'span', 'dz-sdot'), e.name, e.who, e.n);
    return e;
  }

  function fillRow(e, r) {
    const cls = Object.hasOwn(STATE_CLASS, r.state) ? STATE_CLASS[r.state] : '';
    e.row.className = cls ? `dz-plan-row ${cls}` : 'dz-plan-row';
    e.name.textContent = str(r.name);
    e.n.textContent = Number.isFinite(r.n) ? String(r.n) : '';
    const who = list(r.who);
    const sig = who.map((w) => `${str(w?.agentId)}=${str(w?.crew)}`).join('|');
    if (sig === e.whoSig) return;
    e.whoSig = sig;
    e.who.replaceChildren(...who.map((w) => {
      const dot = make(doc, 'i', 'dz-who-dot');
      const bg = tokenVar(w?.crew);
      if (bg) dot.style.background = bg;
      return dot;
    }));
  }

  // One press posts once: the button stays disabled while the call is out, and a refusal stays until the next press.
  async function retry(id) {
    if (destroyed || pending.has(id) || typeof onRetry !== 'function') return;
    pending.add(id);
    refused.delete(id);
    repaintRetry(id);
    try {
      await onRetry(id);
    } catch (err) {
      if (!destroyed) refused.set(id, errorText(err));
    } finally {
      pending.delete(id);
      if (!destroyed) repaintRetry(id);
    }
  }

  function repaintRetry(id) {
    const row = retryRows.get(`k:${id}`);
    if (row) fillRetryState(row, id);
    const card = failCards.get(`k:${id}`);
    if (card) fillFailState(card, id, canRetryNow);
  }

  function makeRetryRow(id) {
    const e = {
      row: make(doc, 'div', 'dz-retry-row'), name: doc.createTextNode(''), state: make(doc, 'small', null, 'stopped'),
      button: button(doc, 'btn btn-sm', 'Retry'),
    };
    const label = make(doc, 'span');
    label.append(e.name, e.state);
    e.button.addEventListener('click', () => { void retry(id); });
    e.row.append(label, e.button);
    return e;
  }

  function fillRetryState(e, id) {
    e.button.disabled = pending.has(id);
    const ref = refused.has(id);
    e.state.className = ref ? 'dz-retry-err' : '';
    e.state.textContent = ref ? RETRY_REFUSED : 'stopped';
    setTitle(e.state, ref ? refused.get(id) : '');
  }

  function fillRetryRow(e, s) {
    const name = str(s.name);
    e.name.data = `${name} `;
    e.button.setAttribute('aria-label', `Retry ${name}`);
    fillRetryState(e, s.id);
  }

  function makeFailCard(id) {
    const headId = `dz-fail-h-${++headSeq}`;
    const e = {
      el: make(doc, 'section', 'chat-rc-q chat-q dz-fail'),
      head: make(doc, 'h3', 'chat-rc-q-head'),
      intro: make(doc, 'p', 'gate-intro'),
      note: make(doc, 'p', 'dz-retry-err', RETRY_REFUSED),
      foot: make(doc, 'div', 'qpanel-foot gate-actions'),
      retry: button(doc, 'btn btn-sm btn-primary', 'Retry'),
      details: button(doc, 'btn btn-sm btn-quiet', 'Details'),
      agentId: null,
    };
    e.head.id = headId;
    e.el.setAttribute('aria-labelledby', headId);
    const panel = make(doc, 'div', 'qpanel');
    panel.dataset.kind = 'recovery';
    const body = make(doc, 'div', 'chat-rc-qbody');
    e.note.hidden = true;
    e.foot.append(e.retry, e.details);
    panel.append(e.intro, e.note, e.foot);
    body.appendChild(panel);
    e.el.append(e.head, body);
    e.retry.addEventListener('click', () => { void retry(id); });
    e.details.addEventListener('click', () => { if (e.agentId) onDetails?.(e.agentId); });
    return e;
  }

  function fillFailState(e, id, canRetry) {
    e.retry.disabled = !canRetry || pending.has(id);
    setTitle(e.retry, canRetry ? '' : RETRY_WAIT);
    e.note.hidden = !refused.has(id);
    setTitle(e.note, refused.get(id) ?? '');
  }

  function fillFailCard(e, f, canRetry) {
    const name = str(f.name);
    e.head.textContent = `${name} failed`;
    e.intro.textContent = `The ${name} builder stopped before it finished.`;
    fillFailState(e, f.id, canRetry);
    e.agentId = typeof f.agentId === 'string' && f.agentId ? f.agentId : null;
    if (!e.agentId) e.details.remove();
    else if (e.details.parentNode !== e.foot) e.foot.appendChild(e.details);
  }

  /** Keyed reconcile: reuse each entry by key, drop the ones no longer listed, return the elements in model order. */
  function reconcile(map, items, keyOf, create, fill, elOf) {
    const seen = new Set();
    const out = [];
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      let k = keyOf(item);
      if (k == null || seen.has(k)) k = `#${i}`;
      if (seen.has(k)) return;
      seen.add(k);
      let e = map.get(k);
      if (!e) { e = create(item); map.set(k, e); }
      fill(e, item);
      out.push(elOf(e));
    });
    for (const [k, e] of map) {
      if (seen.has(k)) continue;
      elOf(e).remove();
      map.delete(k);
    }
    return out;
  }

  /** Put `kids` into `parent` in order, moving only what is out of place. */
  function order(parent, kids) {
    let prev = null;
    for (const kid of kids) {
      const want = prev ? prev.nextSibling : parent.firstChild;
      if (want !== kid) parent.insertBefore(kid, want);
      prev = kid;
    }
  }

  return {
    el,
    paint(model) {
      if (destroyed) return;
      const m = model && typeof model === 'object' ? model : {};
      const planRows = list(m.rows);
      const canRetry = m.canRetry === true;
      canRetryNow = canRetry;
      el.hidden = planRows.length === 0;
      meta.textContent = `${Number.isFinite(m.count) ? m.count : 0} ${str(m.noun) || 'sections'}`;

      const rowEls = reconcile(rows, planRows, (r) => (typeof r.key === 'string' ? `k:${r.key}` : null),
        makeRow, fillRow, (e) => e.row);
      order(rowsEl, rowEls);

      const retryEls = reconcile(retryRows, canRetry ? list(m.stopped).filter(hasId) : [], (s) => `k:${s.id}`,
        (s) => makeRetryRow(s.id), fillRetryRow, (e) => e.row);
      const failEls = reconcile(failCards, list(m.failed).filter(hasId), (f) => `k:${f.id}`,
        (f) => makeFailCard(f.id), (e, f) => fillFailCard(e, f, canRetry), (e) => e.el);
      order(el, [card, ...retryEls, ...failEls]);
      // A refusal goes with its row or card.
      for (const id of refused.keys()) if (!retryRows.has(`k:${id}`) && !failCards.has(`k:${id}`)) refused.delete(id);
    },
    destroy() {
      destroyed = true;
      el.remove();
      rows.clear();
      retryRows.clear();
      failCards.clear();
      pending.clear();
      refused.clear();
    },
  };
}
