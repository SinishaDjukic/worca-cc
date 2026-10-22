// ui/public/chat/question.mjs — Projects, any way P4b: a chat question card built from data alone, with no run tie
// (C §5: the run card's renderClarifyBody is run-bound). It uses the Runs page's ask-card grammar, which style.css
// draws white under `:is(.rd-questions,.chat-rc-q)`: the heading outside the card with the `?` disc, one white
// `.qblock` per question with keyed `.qopt` tiles, and the pill footer. Never an amber wash. Pure: DOM only through `doc`.

const nonEmpty = (v) => typeof v === 'string' && v !== '';
const isNode = (v) => !!v && typeof v === 'object' && typeof v.nodeType === 'number';

/** S9, shared: a card that renderTranscript re-appends in a new row drops the focus of the control the user is in to
 *  <body>. Remember that control while it has the focus, and once the card sits in its new row focus it again (only
 *  when the focus fell to nothing). A press or a Tab elsewhere ends the watch. Returns stop(). A port of
 *  `ui/public/chat/run-card.mjs`'s keeper (Open seam 4: run-card keeps its own copy for now). */
export function keepFocus(el) {
  const doc = el.ownerDocument;
  let kept = null;                                   // { node, host } while a control in this card has the focus
  let keptMo = null;
  function keptStop() {
    kept = null;
    if (keptMo) { keptMo.disconnect(); keptMo = null; }
    doc.removeEventListener('pointerdown', keptPress, true);
  }
  function keptPress(e) { if (kept && !(e.target && kept.node.contains(e.target))) keptStop(); }
  function keptRestore() {
    const k = kept;
    if (!k || doc.activeElement === k.node || el.parentNode === k.host) return;   // still in it, or the card did not move
    const a = doc.activeElement;
    if (!k.node.isConnected || (a && a !== doc.body)) { keptStop(); return; }   // gone, or the focus went somewhere
    k.node.focus({ preventScroll: true });           // its focusin records the new row
    if (doc.activeElement !== k.node) keptStop();    // it cannot take the focus now (disabled while an answer is in flight)
  }
  function onFocusin(e) {
    kept = { node: e.target, host: el.parentNode };
    const MO = doc.defaultView && doc.defaultView.MutationObserver;
    if (!keptMo && MO) {
      keptMo = new MO(keptRestore);
      keptMo.observe(doc, { childList: true, subtree: true });
      doc.addEventListener('pointerdown', keptPress, true);
    }
  }
  function onFocusout(e) { if (e.relatedTarget && !el.contains(e.relatedTarget)) keptStop(); }
  el.addEventListener('focusin', onFocusin);
  el.addEventListener('focusout', onFocusout);
  return () => {
    keptStop();
    el.removeEventListener('focusin', onFocusin);
    el.removeEventListener('focusout', onFocusout);
  };
}

/** spec = { id, heading, questions: [{ id, text, why?, options: [{ value, label, chip?: Node, sub?: string }] }],
 *          submitLabel(picks: Map<qid,value>) -> string, onSubmit(picks: Map<qid,value>) -> void | Promise<void>,
 *          answered?: Map<qid,value> }   // answered: the card stays, its picks marked, nothing left to press (B9)
 *  → { el, picks: () => Map, destroy: () => void } */
export function buildChatQuestion(doc, spec) {
  const h = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const questions = Array.isArray(spec.questions) ? spec.questions : [];
  const answered = spec.answered instanceof Map ? spec.answered : null;
  const picks = new Map();
  let busy = false;

  const el = h('section', answered ? 'chat-rc-q chat-q is-answered' : 'chat-rc-q chat-q');
  const headId = `${spec.id}-h`;
  el.setAttribute('aria-labelledby', headId);
  const head = h('h3', 'chat-rc-q-head', spec.heading);
  head.id = headId;
  const body = h('div', 'chat-rc-qbody');
  const panel = h('div', 'qpanel');
  panel.dataset.kind = 'clarify';
  body.appendChild(panel);

  const blocks = questions.map((q, i) => {
    const block = h('div', 'qblock');
    block.dataset.q = q.id;
    const text = h('div', 'qtext');
    text.append(h('span', 'qn', String(i + 1)), h('span', 'qtext-t', q.text));
    if (nonEmpty(q.why)) text.appendChild(h('span', 'qwhy', q.why));
    const group = h('div', 'qopts');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', q.text);
    const tiles = (Array.isArray(q.options) ? q.options : []).map((o, k) => {
      const btn = h('button', 'qopt');
      btn.type = 'button';
      btn.dataset.key = String.fromCharCode(65 + k);
      btn.dataset.value = o.value;
      btn.setAttribute('aria-pressed', 'false');
      const name = h('span', 'chat-q-opt-name');
      name.appendChild(h('span', 'chat-q-opt-label', o.label));
      if (isNode(o.chip)) name.appendChild(o.chip);
      const txt = h('span', 'qopt-txt');
      txt.appendChild(name);
      if (nonEmpty(o.sub)) txt.appendChild(h('span', 'chat-q-opt-sub', o.sub));
      btn.appendChild(txt);
      group.appendChild(btn);
      return btn;
    });
    block.append(text, group);
    panel.appendChild(block);
    return { q, block, tiles };
  });

  const err = h('div', 'chat-rc-q-err');
  err.setAttribute('role', 'status');
  err.hidden = true;
  el.append(head, body, err);

  function mark(entry, btn) {
    for (const t of entry.tiles) {
      const on = t === btn;
      t.classList.toggle('sel', on);
      t.setAttribute('aria-pressed', String(on));
    }
  }

  // B9: an answered card keeps its markup, its picks marked and every tile disabled; no footer, no keys.
  if (answered) {
    for (const entry of blocks) {
      if (!answered.has(entry.q.id)) continue;
      const value = answered.get(entry.q.id);
      picks.set(entry.q.id, value);
      mark(entry, entry.tiles.find((t) => t.dataset.value === String(value)) || null);
    }
    for (const entry of blocks) for (const t of entry.tiles) t.disabled = true;
    const stop = keepFocus(el);
    return { el, picks: () => new Map(picks), destroy: stop };
  }

  const foot = h('div', 'qpanel-foot');
  const count = h('span', 'qanswered');
  const go = h('button', 'btn btn-primary');
  go.type = 'button';
  go.dataset.qpanelSubmit = '';
  foot.append(count, go);
  panel.appendChild(foot);

  const complete = () => questions.every((q) => picks.has(q.id));
  function paint() {
    count.textContent = `${picks.size} of ${questions.length} answered`;
    go.textContent = spec.submitLabel(new Map(picks));
    for (const entry of blocks) for (const t of entry.tiles) t.disabled = busy;
    go.disabled = busy || !complete();
  }
  function pick(entry, btn) {
    if (busy) return;
    picks.set(entry.q.id, btn.dataset.value);
    mark(entry, btn);
    paint();
  }
  function submit() {
    if (busy || !complete()) return;
    busy = true;
    paint();
    new Promise((res) => { res(spec.onSubmit(new Map(picks))); })
      .then(() => { err.hidden = true; })   // the card stays busy: it waits for its answered state
      .catch((e) => {
        busy = false;
        err.textContent = (e && e.message) || 'Answer not sent';
        err.hidden = false;
        paint();
        go.focus();
      });
  }

  for (const entry of blocks) for (const t of entry.tiles) t.addEventListener('click', () => pick(entry, t));
  go.addEventListener('click', submit);

  panel.addEventListener('keydown', (e) => {
    if (busy || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target && typeof e.target.closest === 'function' ? e.target : null;
    const tile = target && target.closest('.qopt');
    const entry = tile && blocks.find((b) => b.tiles.includes(tile));
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (!entry) return;
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const n = entry.tiles.length;
      const next = entry.tiles[(entry.tiles.indexOf(tile) + step + n) % n];
      pick(entry, next);
      next.focus();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (!entry) return;
      pick(entry, tile);
      e.preventDefault();
      submit();
      return;
    }
    if (/^[a-z]$/i.test(e.key)) {
      const holder = target && target.closest('.qblock');
      const into = blocks.find((b) => b.block === holder) || blocks[0];
      const hit = into && into.tiles.find((t) => t.dataset.key === e.key.toUpperCase());
      if (!hit) return;
      pick(into, hit);
      hit.focus();
      e.preventDefault();
    }
  });

  paint();
  const stop = keepFocus(el);
  return { el, picks: () => new Map(picks), destroy: stop };
}

/** A question that closed unanswered: one plain line, never the question. */
export function buildChatReceipt(doc, text) {
  const el = doc.createElement('section');
  el.className = 'chat-rc-q chat-q is-closed';
  el.setAttribute('aria-label', 'Question');
  const line = doc.createElement('div');
  line.className = 'chat-rc-receipt';
  line.textContent = text;
  el.appendChild(line);
  return el;
}
