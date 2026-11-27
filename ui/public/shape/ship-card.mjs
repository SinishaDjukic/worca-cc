// ui/public/shape/ship-card.mjs — Shaper s4: the Ship card. One renderer for the chat card (type 'ship') and the
// group page / Plans tab (feature-view.mjs shipBlock). Chrome: .ask-card .ask-mcard (style.css "Chat P2: Action cards").
import { CREATE_PR_LABEL, VIEW_PR_LABEL, VIEW_PRS_LABEL, createPrLabel } from '../ship-words.mjs';
import { icon } from '../icons.mjs';
import { renderAskChanges } from '../chat/ask-changes.mjs';
import { buildCheckFold, buildCheckRows, checkMark } from './check-row.mjs';
import { checkLine } from './plan-text.mjs';
import { ledgerCheck } from '../../../src/shared/shape/acceptance.mjs';
import { CONFIRM_REASON_MAX, MARK_WORDS } from '../../../src/shared/shape/ship-ledger.mjs';

const MINUS = '\u2212';
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const errorOf = (e) => String((e && e.body && e.body.error) || (e && e.message) || e || 'Something went wrong');

/** '3 runs · 12 files · +840 −120'; unknown counts are left out. */
export function shipSummaryLine({ runs, files = null, added = null, deleted = null }) {
  const parts = [count(runs, 'run', 'runs')];
  if (Number.isFinite(files)) parts.push(count(files, 'file', 'files'));
  if (Number.isFinite(added) || Number.isFinite(deleted)) parts.push(`+${added || 0} ${MINUS}${deleted || 0}`);
  return parts.join(' · ');
}
export function shipReason(suggested, added) {
  if (suggested === 'one') return `This feature adds ${added || 0} lines: one PR is easier to review.`;
  if (suggested === 'stacked') return `This feature adds ${added || 0} lines: stacked PRs keep each review small.`;
  return '';
}

// One ship flow: app.js registers the shared Create PR dialog on every boot (the last boot wins); every Ship card's
// Create PR opens it.
let openShipDialog = null;
export function setShipDialogOpener(fn) { openShipDialog = typeof fn === 'function' ? fn : null; }

/** Shaper requirements s3 (R-arch-7): the one save of the acceptance ledger, for the chat card and the feature page.
 *  → { ok:true, acceptance } | { ok:false, error } (never throws). */
export async function saveAcceptance(featureId, entries) {
  try {
    const r = await fetch(`/api/shape/features/${encodeURIComponent(featureId)}/acceptance`, { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries }) });
    const out = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, acceptance: out.acceptance || null } : { ok: false, error: out.error || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: errorOf(e) }; }
}

/** Feature D1: a person's mark on a marked feature's Ship (POST …/confirm): met, not-met or dropped, the last two with a
 *  reason (owner direction da6198d8d). For the chat card and the feature page.
 *  → { ok:true, smallRuns, acceptance } | { ok:false, error } (never throws). */
export async function confirmRequirement(featureId, id, mark = 'met', reason = '') {
  try {
    const r = await fetch(`/api/shape/features/${encodeURIComponent(featureId)}/confirm`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, mark, ...(mark === 'met' ? {} : { reason }) }) });
    const out = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, smallRuns: out.smallRuns || null, acceptance: out.acceptance || null } : { ok: false, error: out.error || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: errorOf(e) }; }
}

const MARKS = [['met', 'Met'], ['not-met', 'Not met'], ['dropped', 'Dropped']];
const MARK_TEXT = { 'not-met': { key: 'target', hint: 'Where it moved' }, dropped: { key: 'reason', hint: 'Why it is dropped' } };
const ledgerOf = (m) => (m.acceptance && Array.isArray(m.acceptance.agreed) && m.acceptance.agreed.length ? m.acceptance : null);

/**
 * Shaper requirements s3 (3.B): the acceptance ledger. The fold line and check rows (check-row.mjs); in the ready phase
 * (`editing`) a `.seg-sm` mark picker under each row. Met saves on pick; Not met and Dropped save once their field has
 * text (Enter or blur). The last saved entries (`committed`) are what the rows show; a refused save repaints from them.
 * → { els, unmarked(), saving(), adopt(acceptance) }; `changed()` runs after every repaint.
 */
function buildLedger(doc, h, a, { editing, onMark, err, root, changed }) {
  let committed = Array.isArray(a.entries) ? a.entries.slice() : [];
  const drafts = new Map();                         // id → { id, mark }: Not met / Dropped picked, its text not saved yet
  let saving = null;                                // the id whose mark is being saved
  const shown = () => committed.filter((e) => !drafts.has(e.id));
  const check = () => ledgerCheck(a.agreed, shown(), a.covered || [], { editing });
  const fold = buildCheckFold(doc, check(), 'Requirements');
  if (editing) { fold.rows.hidden = false; fold.line.setAttribute('aria-expanded', 'true'); }
  const pickers = new Map();
  if (editing) {
    for (const { id } of a.agreed) {
      const wrap = h('div', 'ask-shipcard-mark');
      const seg = h('div', 'seg seg-sm');
      seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `${id} mark`);
      const buttons = new Map();
      for (const [mark, label] of MARKS) {
        const b = h('button', null, label); b.type = 'button'; b.dataset.act = `ship-mark-${id}-${mark}`;
        b.addEventListener('click', () => pick(id, mark, b));
        buttons.set(mark, b); seg.appendChild(b);
      }
      const input = h('input', 'input input-sm'); input.type = 'text'; input.hidden = true; input.dataset.act = `ship-mark-${id}-text`;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(id); } });
      input.addEventListener('blur', () => commitText(id));
      wrap.append(seg, input);
      pickers.set(id, { wrap, buttons, input });
    }
  }
  const markOf = (id) => (drafts.get(id) || committed.find((e) => e.id === id) || null);
  const paint = () => {
    const c = check();
    fold.line.querySelector('.plan-fold-text').textContent = checkLine(c, 'Requirements');
    const rows = buildCheckRows(doc, c);
    const out = [];
    c.items.forEach((it, i) => { out.push(rows[i]); if (pickers.has(it.id)) out.push(pickers.get(it.id).wrap); });
    // Only the check rows are swapped: the pickers stay in place, so a focused button keeps its focus.
    const old = [...fold.rows.children];
    if (old.length === out.length) out.forEach((el, i) => { if (old[i] !== el) old[i].replaceWith(el); });
    else fold.rows.replaceChildren(...out);
    for (const [id, p] of pickers) {
      const e = markOf(id);
      for (const [mark, b] of p.buttons) { b.setAttribute('aria-pressed', String(!!e && e.mark === mark)); b.disabled = !!saving; }
      const t = e && MARK_TEXT[e.mark];
      p.input.hidden = !t;
      p.input.disabled = !!saving;
      if (t) {
        p.input.placeholder = t.hint; p.input.setAttribute('aria-label', `${id}: ${t.hint.toLowerCase()}`);
        if (!drafts.has(id)) p.input.value = e[t.key] || '';
      }
      if (saving === id) p.wrap.setAttribute('aria-busy', 'true'); else p.wrap.removeAttribute('aria-busy');
    }
    changed();
  };
  const entriesWith = (id, entry) => [...committed.filter((e) => e.id !== id), entry];
  async function save(id, entry, act) {
    err.textContent = '';
    root.dataset.focus = act;                      // Chromium blurs a disabled button: a repaint gives the focus back here
    saving = id; paint();
    let r;
    // Only this row's entry: the server merges per id, so a stale copy of another row's mark is never sent back.
    try { r = await onMark([entry]); } catch (e) { r = { ok: false, error: errorOf(e) }; }
    saving = null;
    const back = () => { const prev = committed.find((e) => e.id === id); return `ship-mark-${id}-${prev ? prev.mark : MARKS[0][0]}`; };
    drafts.delete(id);
    let focus = act;
    if (r && r.ok) committed = r.acceptance && Array.isArray(r.acceptance.entries) ? r.acceptance.entries.slice() : entriesWith(id, entry);
    else { err.textContent = (r && r.error) || 'Something went wrong'; focus = back(); }
    paint();
    delete root.dataset.focus;
    const el = root.querySelector(`[data-act="${focus}"]`);
    if (el && el.isConnected) el.focus();
  }
  function pick(id, mark, b) {
    if (saving) return;
    const cur = committed.find((e) => e.id === id);
    if (mark === 'met') {
      drafts.delete(id);
      if (cur && cur.mark === 'met') { paint(); return; }
      save(id, { id, mark }, b.dataset.act);
      return;
    }
    if (cur && cur.mark === mark) { drafts.delete(id); paint(); return; }
    drafts.set(id, { id, mark });
    pickers.get(id).input.value = '';
    paint();
    b.focus();
  }
  function commitText(id) {
    const d = drafts.get(id);
    const p = pickers.get(id);
    if (saving || !p) return;
    const cur = committed.find((e) => e.id === id);
    const mark = d ? d.mark : cur && MARK_TEXT[cur.mark] ? cur.mark : null;
    if (!mark) return;
    const text = p.input.value.trim();
    const t = MARK_TEXT[mark];
    if (!text || (!d && cur && cur[t.key] === text)) return;
    save(id, { id, mark, [t.key]: text }, p.input.dataset.act);
  }
  paint();
  const unmarked = () => a.agreed.length - check().items.filter((i) => i.pass).length;
  return {
    els: [fold.line, fold.rows], unmarked, saving: () => !!saving,
    adopt(next) {
      if (saving || !next || !Array.isArray(next.entries)) return;
      committed = next.entries.slice();
      paint();
    },
  };
}

/**
 * model: { phase:'waiting'|'ready'|'applied'|'declined', featureId, title, runs, files, added, deleted, suggested, result,
 *          acceptance? } (acceptance: featureView's ship.acceptance, present only with agreed requirements)
 *          smallRuns? (Feature D1: featureView's ship.smallRuns; the small-runs Ship, phases ready and applied)
 * handlers: { onNotNow?() → Promise, onAskChanges?(text), onMark?(entries: the changed row's entry) → Promise<{ok, error?, acceptance?}>,
 *             onConfirm?(id, mark, reason) → Promise<{ok, error?, smallRuns?}> (Feature D1: a confirmed requirement's mark),
 *             countShown? (Feature D1: the host's state line already says "N PRs open": the done card does not repeat it),
 *             titleShown? (Feature D1: the host's head already shows the feature title: the small-runs card names only the step) }
 * (no onNotNow → no Not now button). The ready card's Create PR opens the dialog setShipDialogOpener registered, with
 * the button and the card (D20: focus after it closes).
 */
export function renderShipCard(doc, m, handlers = {}) {
  return shipCard(doc, m, handlers).root;
}

function shipCard(doc, m, handlers) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  if (m.phase === 'waiting') {
    // Slice 7 (D10): a feature with no chat gets no chat card, so the card comes only on this page.
    const w = h('div', 'ask-shipcard-wait', `Ship card comes when all ${m.runs} runs are done, ${m.hasChat === false ? 'on this page.' : 'here and in the chat.'}`);
    w.setAttribute('data-ship-card', 'waiting');
    return { root: w, ledger: null };
  }
  if (m.phase === 'declined') {
    const s = h('div', 'ask-card-stub ask-actcard-stub ask-shipcard-stub', 'Not shipped yet · ship it from the feature page');
    s.setAttribute('data-ship-card', 'declined');
    return { root: s, ledger: null };
  }
  if (m.smallRuns && (m.phase === 'ready' || m.phase === 'applied')) return smallRunsShip(doc, h, m, handlers);
  const root = h('div', `ask-card ask-mcard ask-shipcard is-${m.phase}`);
  root.setAttribute('data-ship-card', m.phase);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Ship: ${m.title || ''}`);
  if (m.featureId) root.dataset.shipFeature = m.featureId;   // D20: the dialog finds the card again after it re-renders
  const head = h('div', 'ask-mcard-head');
  const title = h('span', 'ask-mcard-title', m.title || ''); title.title = m.title || '';
  head.append(h('span', 'ask-mcard-kind', m.phase === 'applied' ? 'Shipped' : 'Ship'), title);
  const body = h('div', 'ask-mcard-body');
  root.append(head, body);
  if (m.phase === 'applied') {
    const r = m.result || {};
    // The kind chip says Shipped: the line says how.
    const done = h('div', 'ask-shipcard-done', r.mode === 'one' ? 'As one PR' : 'As stacked PRs');
    if (r.prUrl) {
      const a = h('a', 'ask-shipcard-pr', VIEW_PR_LABEL);
      a.href = r.prUrl; a.target = '_blank'; a.rel = 'noopener';
      done.append(' · ', a);
    }
    body.appendChild(done);
    if (r.closed > 0) body.appendChild(h('div', 'ask-shipcard-closed', `Closed ${count(r.closed, 'draft', 'drafts')}`));
    if (r.release) body.appendChild(releaseLine(h, r.release));
    const a = ledgerOf(m);
    const ledger = a ? buildLedger(doc, h, a, { editing: false, root, changed: () => {} }) : null;
    if (ledger) body.append(...ledger.els);
    if (handlers.onAskChanges) body.appendChild(renderAskChanges(doc, { onSend: handlers.onAskChanges }).el);   // Shaper s5
    return { root, ledger };
  }
  // ready: the kind chip says Ship; the line is the facts.
  body.appendChild(h('div', 'ask-shipcard-stats', shipSummaryLine(m)));
  const why = shipReason(m.suggested, m.added);
  if (why) body.appendChild(h('div', 'ask-shipcard-why', why));
  const err = h('div', 'ask-card-err'); err.setAttribute('aria-live', 'polite');
  const a = ledgerOf(m);
  let create = null;
  let opening = false;
  const left = a ? h('span', 'ask-shipcard-left') : null;
  // One rule sets Create PR (3.B): disabled while it opens the dialog, a mark is saving, or a row is unmarked.
  const syncCreate = () => {
    if (!create) return;
    const n = ledger ? ledger.unmarked() : 0;
    create.disabled = opening || (ledger ? ledger.saving() : false) || n > 0;
    create.classList.toggle('btn-primary', n === 0);
    if (left) { left.textContent = n ? `Mark every requirement before you create the PR · ${n} left` : ''; left.hidden = !n; }
  };
  const ledger = a ? buildLedger(doc, h, a, { editing: true, onMark: handlers.onMark || (async () => ({ ok: false, error: 'Open the feature page to mark the requirements' })),
    err, root, changed: syncCreate }) : null;
  if (ledger) body.append(...ledger.els);
  if (handlers.onAskChanges) body.appendChild(renderAskChanges(doc, { onSend: handlers.onAskChanges }).el);     // Shaper s5
  root.appendChild(err);
  const actions = h('div', 'ask-mcard-actions');
  if (left) actions.appendChild(left);
  actions.appendChild(h('span', 'ask-card-actions-spacer'));
  const buttons = [];
  const button = (cls, text, act) => { const b = h('button', cls, text); b.type = 'button'; b.dataset.act = act; buttons.push(b); actions.appendChild(b); return b; };
  const lock = (on) => { for (const b of buttons) b.disabled = on; };
  if (handlers.onNotNow) {
    const nn = button('btn btn-sm btn-quiet ask-card-not-now', 'Not now', 'ship-not-now');
    nn.addEventListener('click', async () => {
      lock(true); err.textContent = '';
      try { await handlers.onNotNow(); } catch (e) { err.textContent = errorOf(e); lock(false); }
    });
  }
  create = button('btn btn-sm btn-primary', null, 'ship-create');
  create.append(icon(doc, 'pr-create', 14), h('span', null, CREATE_PR_LABEL));
  create.addEventListener('click', () => {
    if (create.disabled) return;
    err.textContent = '';
    if (!openShipDialog) { err.textContent = 'Open the feature page to create its PR'; return; }
    // D20: busy until the dialog is open (or the load failed), so a double click opens one dialog.
    opening = true; syncCreate();
    create.setAttribute('aria-busy', 'true');
    Promise.resolve().then(() => openShipDialog(m.featureId, { opener: create, card: root }))
      .catch((e) => { err.textContent = errorOf(e); })
      .finally(() => { opening = false; syncCreate(); create.removeAttribute('aria-busy'); });
  });
  root.appendChild(actions);
  syncCreate();
  return { root, ledger };
}

const pad2 = (n) => String(n).padStart(2, '0');
/** Feature D1: what a small-runs Not met / Dropped reason field asks. */
const REASON_HINT = { 'not-met': 'Why it is not met', dropped: 'Why it is dropped' };
/** Feature D1: the reasons being written, per feature (id → {mark, text}). Module-level, so a page or chat repaint that
 *  rebuilds the card keeps a half-typed reason and its field. */
const REASON_DRAFTS = new Map();
const draftsOf = (featureId) => { const k = String(featureId || ''); if (!REASON_DRAFTS.has(k)) REASON_DRAFTS.set(k, new Map()); return REASON_DRAFTS.get(k); };
const clock = (at) => { const d = at ? new Date(at) : null; return d && !Number.isNaN(d.getTime()) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; };
let srSeq = 0;

/**
 * Feature D1: a marked feature's Ship. The model's `smallRuns` (featureView's ship.smallRuns) is read, never recomputed:
 * the confirmed rows, each with the classic `.seg-sm` Met / Not met / Dropped picker (Not met and Dropped save once their
 * reason field has text), the fold of the rows the runs own, the Care row and the block reason (ready), or the PRs in
 * finish order with the Not met / Dropped lines (applied). A mark goes through `handlers.onConfirm(id, mark, reason)`; a
 * success repaints from the answer's `smallRuns`.
 */
function smallRunsShip(doc, h, m, handlers) {
  let sr = m.smallRuns;
  const applied = m.phase === 'applied';
  const root = h('div', `ask-card ask-mcard ask-shipcard is-${m.phase} is-small-runs`);
  root.setAttribute('data-ship-card', m.phase);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Ship: ${m.title || ''}`);
  if (m.featureId) root.dataset.shipFeature = m.featureId;
  const head = h('div', 'ask-mcard-head');
  head.appendChild(h('span', 'ask-mcard-kind', applied ? 'Shipped' : 'Ship'));
  if (!handlers.titleShown) { const title = h('span', 'ask-mcard-title', m.title || ''); title.title = m.title || ''; head.appendChild(title); }
  const body = h('div', 'ask-mcard-body');
  root.append(head, body);
  const careRow = () => {
    const kv = h('dl', 'rd-kv ask-shipcard-care');
    const r = h('div', 'rd-kv-row'); r.dataset.fact = 'care';
    r.append(h('dt', 'rd-kv-k', 'Care'), h('dd', 'rd-kv-v', [sr.care.choice, sr.care.outcome].filter(Boolean).join(' · ')));
    kv.appendChild(r);
    return kv;
  };
  const list = (cls, items) => { const l = h('div', `plan-checks srows ${cls}`); l.append(...buildCheckRows(doc, { items })); return l; };
  if (applied) {
    // Shipped as One: every run holds the same PR, so it is one row (the first run of each url), named by its runs.
    const one = m.shipMode === 'one';
    const withPr = sr.order.filter((o) => o.pr);
    const prs = one ? withPr.filter((o, i) => withPr.findIndex((x) => x.pr.url === o.pr.url) === i) : withPr;
    const labelOf = (o) => {
      const runs = one ? withPr.filter((x) => x.pr.url === o.pr.url).map((x) => x.index) : [o.index];
      return runs.length > 1 ? `runs ${Math.min(...runs)}–${Math.max(...runs)}` : `run ${o.index} · ${o.title}`;   // the head names the feature
    };
    if (!handlers.countShown) body.appendChild(h('div', 'ask-shipcard-done', `${count(prs.length, 'PR', 'PRs')} open`));
    body.appendChild(h('div', 'ask-shipcard-stats', one ? 'one PR holding every run'
      : sr.along === true ? 'stacked along the real branches' : 'a PR per run, stacked in the order runs finished'));
    body.appendChild(careRow());
    body.appendChild(list('ask-shipcard-prs', prs.map((o) => ({ id: `#${o.pr.number ?? ''}`, idCol: true, pass: true,
      label: labelOf(o), note: o.onto ? `onto #${o.onto}` : `into ${sr.base || ''}`.trim(), ariaLabel: 'open' }))));
    // The Not met / Dropped requirements, as rows under the PRs (the PR descriptions carry the same lines: unmetLines).
    // Small runs D3 (D5): with the server's `shown` (on the confirmed entry of the same id), its text is the note.
    const unmet = Array.isArray(sr.unmet) ? sr.unmet : [];
    const shownOf = (id) => (sr.confirmed || []).find((c) => c.id === id)?.shown || null;
    if (unmet.length) body.appendChild(list('ask-shipcard-unmet', unmet.map((u) => ({ id: u.id, idCol: true, label: u.text, pass: true, state: u.mark,
      ariaLabel: MARK_WORDS[u.mark].toLowerCase(), note: shownOf(u.id) ? shownOf(u.id).text : `${MARK_WORDS[u.mark]} · ${u.reason}` }))));
    const actions = h('div', 'ask-mcard-actions');
    actions.appendChild(h('span', 'ask-card-actions-spacer'));
    const view = h('button', 'btn btn-sm btn-quiet', VIEW_PRS_LABEL); view.type = 'button'; view.dataset.act = 'ship-view-prs';
    view.addEventListener('click', () => { const u = prs[0] && prs[0].pr.url; if (u && /^https?:\/\//.test(u) && doc.defaultView) doc.defaultView.open(u, '_blank', 'noopener'); });
    actions.appendChild(view);
    root.appendChild(actions);
    return { root, ledger: null };
  }
  const stats = h('div', 'ask-shipcard-stats');
  body.appendChild(stats);
  // Slice 5 (D7): before shipping, the runs whose work ships inside a listed run's PR, in the server's words (carriedLine).
  const carried = Array.isArray(sr.carried) ? sr.carried : [];
  if (carried.length) {
    const ul = h('ul', 'ask-shipcard-carried');
    for (const c of carried) { const li = h('li'); li.append(icon(doc, 'merge', 14), h('span', null, c.line)); ul.appendChild(li); }
    body.appendChild(ul);
  }
  const err = h('div', 'ask-card-err'); err.setAttribute('aria-live', 'polite');
  const whyId = `ask-shipcard-why-${++srSeq}`;
  let confirming = null;                                  // the id whose mark is being sent
  const drafts = draftsOf(m.featureId);                   // id → {mark, text}: Not met / Dropped picked, its reason not saved yet
  const confirmedEl = h('div');
  const ownedEl = h('div', 'srows ask-shipcard-owned');
  const careEl = h('div');
  const whyEl = h('div');
  body.append(confirmedEl, ownedEl, careEl, whyEl);
  const actions = h('div', 'ask-mcard-actions');
  actions.appendChild(h('span', 'ask-card-actions-spacer'));
  const create = h('button', 'btn btn-sm', null); create.type = 'button'; create.dataset.act = 'ship-create';
  create.append(icon(doc, 'pr-create', 14), h('span', null, createPrLabel(sr.newPrs ?? sr.order.length)));
  actions.appendChild(create);
  root.append(err, actions);
  let opening = false;
  const noteOf = (c) => {
    const at = clock(c.at) ? ` · ${clock(c.at)}` : '';
    // Small runs D3 (D5): the server's one status: a waiting row its text, a marked one its word and the time.
    // Slice 7 (D4): a met row names you and the role (`confirmed by you · Design`), then the time.
    if (c.shown) return c.state === 'waiting' ? c.shown.text : `${c.mark === 'met' ? c.shown.text : c.shown.word}${at}`;
    if (c.state === 'waiting') return `confirmed by a person · ${c.roleLabel}`;
    if (c.mark === 'met') return `confirmed by ${c.roleLabel}${at}`;
    return `Marked ${MARK_WORDS[c.mark]} by you${at}`;
  };
  /** The classic ledger's picker (buildLedger): a `.seg-sm` group under the row, and the reason field while one is due. */
  const picker = (c) => {
    const wrap = h('div', 'ask-shipcard-mark');
    if (c.reason && !drafts.has(c.id)) wrap.appendChild(h('div', 'ask-shipcard-reason', c.reason));
    const seg = h('div', 'seg seg-sm');
    seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `Mark ${c.id} as ${c.roleLabel}: ${c.text}`);
    const shown = drafts.has(c.id) ? drafts.get(c.id).mark : c.mark;
    for (const [mk, label] of MARKS) {
      const b = h('button', null, label); b.type = 'button'; b.dataset.act = `ship-mark-${c.id}-${mk}`;
      b.setAttribute('aria-pressed', String(shown === mk));
      b.disabled = !!confirming;
      b.addEventListener('click', () => pick(c, mk));
      seg.appendChild(b);
    }
    wrap.appendChild(seg);
    const d = drafts.get(c.id);
    const due = d ? d.mark : c.state === 'needs-reason' ? c.mark : null;
    if (due) {
      const input = h('input', 'input input-sm'); input.type = 'text'; input.maxLength = CONFIRM_REASON_MAX;
      input.dataset.act = `ship-mark-${c.id}-text`; input.placeholder = REASON_HINT[due];
      input.setAttribute('aria-label', `${c.id}: ${REASON_HINT[due].toLowerCase()}`);
      input.value = d && d.text != null ? d.text : c.mark === due && c.reason ? c.reason : '';
      input.addEventListener('input', () => { const cur = drafts.get(c.id); if (cur) cur.text = input.value; });
      input.disabled = !!confirming;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(c, due, input); } });
      // Chromium blurs a focused node a repaint removes, while it is still connected: only a blur that leaves the
      // field in the document commits (the repaint's card keeps the draft through REASON_DRAFTS).
      input.addEventListener('blur', () => { queueMicrotask(() => commit(c, due, input)); });
      wrap.appendChild(input);
    }
    if (confirming === c.id) wrap.setAttribute('aria-busy', 'true');
    return wrap;
  };
  const paint = () => {
    const rows = buildCheckRows(doc, { items: sr.confirmed.map((c) => ({ id: c.id, idCol: true, label: c.text,
      pass: c.state === 'confirmed', ...(c.state === 'confirmed' && c.mark !== 'met' ? { state: c.mark } : {}), ...(c.shown ? { mark: c.shown.mark } : {}),
      ariaLabel: c.state === 'waiting' ? 'waiting' : c.mark === 'met' ? 'confirmed' : MARK_WORDS[c.mark].toLowerCase(), note: noteOf(c) })) });
    const out = [];
    sr.confirmed.forEach((c, i) => {
      if (c.state === 'waiting') rows[i].replaceChild(checkMark(doc, 'wait'), rows[i].querySelector('.plan-check-mark'));
      out.push(rows[i], picker(c));
    });
    const l = h('div', 'plan-checks srows ask-shipcard-confirmed'); l.append(...out);
    confirmedEl.replaceChildren(...(rows.length ? [l] : []));
    if (!ownedEl.firstChild && sr.owned.length) {
      const items = sr.owned.map((o) => (o.shown
        ? { id: o.id, idCol: true, label: o.text, pass: o.shown.mark === 'check', mark: o.shown.mark, ariaLabel: o.shown.word, note: o.shown.text,
          tip: `${o.id} · ${o.text} · ${o.shown.text}` }
        : { id: o.id, idCol: true, label: o.text, pass: true,
          note: `${o.run ? `run ${o.run}` : 'a run'} · ${o.status === 'gap-accepted' ? 'gap accepted' : 'holds'}` }));
      const fold = buildCheckFold(doc, { items }, 'Requirements', { text: () => `${items.length} checked by the runs' reviews and the Verifier` });
      ownedEl.append(fold.line, fold.rows);
    }
    careEl.replaceChildren(careRow());
    stats.textContent = sr.unowned && sr.unowned.length ? 'Waiting' : sr.blocked ? 'Your turn: mark what only a person can' : 'Ready to ship';
    if (sr.blocked && sr.reason) {
      const why = h('div', 'ask-shipcard-why'); why.id = whyId;
      // R-comp-4 never breaks at its hyphens on a narrow screen: each requirement id is one unbreakable span.
      for (const part of sr.reason.split(/(\bR-[A-Za-z0-9]+-\d+\b)/)) {
        if (/^R-[A-Za-z0-9]+-\d+$/.test(part)) why.appendChild(h('span', 'ask-shipcard-id', part));
        else if (part) why.appendChild(doc.createTextNode(part));
      }
      whyEl.replaceChildren(why);
      create.setAttribute('aria-describedby', whyId);
    } else { whyEl.replaceChildren(); create.removeAttribute('aria-describedby'); }
    create.disabled = opening || !!confirming || sr.blocked;
    create.classList.toggle('btn-primary', !sr.blocked);
  };
  /** The control `act` of this card, or of the card that replaced it (a repaint of the page or the chat card rebuilds it). */
  const findAct = (act) => (root.isConnected ? root : doc.querySelector(`[data-ship-feature="${m.featureId}"]`) || root)
    .querySelector(`[data-act="${act}"]`);
  function focusAct(act) { const el = findAct(act); if (el && el.isConnected && !el.disabled) el.focus(); }
  function pick(c, mk) {
    if (confirming) return;
    const act = `ship-mark-${c.id}-${mk}`;
    if (mk === 'met') { drafts.delete(c.id); if (c.mark === 'met') { paint(); focusAct(act); return; } send(c.id, mk, '', act); return; }
    // Not met / Dropped: the reason field opens (prefilled when it is the stored mark, to edit it).
    drafts.set(c.id, { mark: mk, text: null });
    paint();
    focusAct(`ship-mark-${c.id}-text`);
  }
  function commit(c, mk, input) {
    if (confirming || !input.isConnected) return;
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (c.mark === mk && c.reason === text) { drafts.delete(c.id); paint(); focusAct(`ship-mark-${c.id}-${mk}`); return; }
    send(c.id, mk, text, `ship-mark-${c.id}-${mk}`);
  }
  async function send(id, mk, reason, act) {
    err.textContent = '';
    // Chromium blurs a disabled button: a page or chat repaint during the post gives the focus back here (featureFocusOf).
    root.dataset.focus = act;
    confirming = id;
    paint();
    let r;
    try { r = handlers.onConfirm ? await handlers.onConfirm(id, mk, reason) : { ok: false, error: 'Open the feature page to mark it' }; }
    catch (e) { r = { ok: false, error: errorOf(e) }; }
    confirming = null;
    delete root.dataset.focus;
    if (r && r.ok) { drafts.delete(id); if (r.smallRuns) sr = r.smallRuns; }
    else err.textContent = (r && r.error) || 'Something went wrong';
    paint();
    focusAct(r && r.ok ? act : drafts.has(id) ? `ship-mark-${id}-text` : act);
  }
  create.addEventListener('click', () => {
    if (create.disabled) return;
    err.textContent = '';
    if (!openShipDialog) { err.textContent = 'Open the feature page to create its PR'; return; }
    opening = true; paint();
    create.setAttribute('aria-busy', 'true');
    Promise.resolve().then(() => openShipDialog(m.featureId, { opener: create, card: root }))
      .catch((e) => { err.textContent = errorOf(e); })
      .finally(() => { opening = false; paint(); create.removeAttribute('aria-busy'); });
  });
  paint();
  return { root, ledger: null };
}

function releaseLine(h, rel) {
  if (rel.url) {
    const d = h('div', 'ask-shipcard-rel', `Draft release ${rel.version} · `);
    const a = h('a', null, 'open it'); a.href = rel.url; a.target = '_blank'; a.rel = 'noopener';
    d.appendChild(a);
    return d;
  }
  if (rel.error) return h('div', 'ask-shipcard-rel is-failed', `Draft release ${rel.version} failed: ${rel.error}`);
  return h('div', 'ask-shipcard-rel', `Release ${rel.version} · draft after merge`);
}

/** The chat card (registerChatCard('ship', …)): verbs go to POST /api/ask/threads/:id/cards/:cardId. Marks are saved
 *  through saveAcceptance; the server writes them into this block, which `blockChanged` takes in place. */
export function buildShipChatCard(block, ctx) {
  const c = block.card || {};
  const phase = block.state === 'applied' ? 'applied' : block.state === 'declined' ? 'declined' : 'ready';
  const say = (t) => { if (ctx && typeof ctx.announce === 'function') ctx.announce(t); };
  const save = typeof ctx.saveAcceptance === 'function' ? ctx.saveAcceptance : saveAcceptance;
  const ledgerOn = !!c.acceptance;
  const { root, ledger } = shipCard(ctx.doc, { phase, featureId: c.featureId, title: c.title, runs: c.runs, files: c.files, added: c.added,
    deleted: c.deleted, suggested: c.suggested, result: c.result || null, ...(ledgerOn ? { acceptance: c.acceptance } : {}) }, {
    onNotNow: async () => { await ctx.postCard(block, { verb: 'not-now' }); say('Ship card dismissed'); },
    ...(typeof ctx.postChanges === 'function' ? { onAskChanges: (t) => ctx.postChanges({ featureId: c.featureId }, t) } : {}),
    onMark: (entries) => save(c.featureId, entries),
  });
  const rest = (card) => JSON.stringify({ ...(card || {}), acceptance: undefined });
  const handle = ledger ? {
    // Only a new ledger is taken in place (the card keeps its focus); any other change rebuilds the card.
    blockChanged(next) {
      if (next.state !== block.state || rest(next.card) !== rest(c)) throw new Error('the ship card changed');
      ledger.adopt(next.card && next.card.acceptance);
    },
  } : null;
  return { el: root, ...(handle ? { handle } : {}) };
}
