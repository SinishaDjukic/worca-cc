// ui/public/marketplace/update-sheet.mjs — the Update review sheet (marketplace P6, board 3.2): one card per update,
// previewed one at a time; apply one by one, each bound to the previewed candidateSha; a STALE_PREVIEW re-previews its
// card in place. On P3's shared sheet host (createSheet); errors stay in their card; every dependency is injected.
import { createSheet } from './layers.mjs';
import { newCard, needsTick, isIncluded, isReady, isUpToDate, footState, sheetTitle, previewedLabel } from './update-model.mjs';
import { renderUpdateCard, renderUpdateFoot } from './update-view.mjs';

const list = (v) => (Array.isArray(v) ? v : []);

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The Update review controller. open(names?) reviews those plugins (default: every row with `latest`); it resolves
 *  once every card's preview has settled. */
export function createUpdateReview({ doc, win, page, deps }) {
  let token = 0;            // bumped by every open and by the close: late previews and stale handlers stop
  let applying = false;     // a run is out: one at a time
  let running = null;       // that run: an open made meanwhile (SM70 closed its sheet) stays busy and previews after it
  let current = null;       // { t, cards, list, when } of the open on screen
  // A real close (not a hand-off) parks focus on the Installed tab first; P3 then moves it to the opener, and when the
  // reload took the opener away (Update all, a row's Update) it stays there, never on <body> (P5's rule).
  const sheet = createSheet({ doc, win, onClose: () => {
    token += 1;
    const a = doc.activeElement;
    if (sheet.root.classList.contains('hidden') && (!a || a === doc.body || sheet.root.contains(a))) doc.querySelector('.mk-tab[data-tab="installed"]')?.focus();
  } });
  const url = (card) => `/api/plugins/${encodeURIComponent(card.name)}/update`;

  const mine = () => sheet.panel.dataset.mode === 'update';
  const ours = (cur) => !!cur && cur.t === token && mine();          // SM55: this open, on our panel mode
  const live = (cur) => ours(cur) && sheet.isOpen();

  // A repaint (an apply starts or lands, a re-preview) never drops the focus it held to <body>: the card's commits
  // button takes it (a card with controls has a preview, so it has one), else the panel.
  function paintCard(cur, card) {
    if (!ours(cur)) return null;
    const old = [...cur.list.children].find((n) => n.dataset.name === card.name);
    const had = !!old?.contains(doc.activeElement);
    const fresh = renderUpdateCard(doc, card);
    if (old) old.replaceWith(fresh); else cur.list.append(fresh);
    if (had) (fresh.querySelector('.mk-disc') || sheet.panel).focus();
    return fresh;
  }

  function paintHead(cur) {
    if (ours(cur)) cur.when.textContent = previewedLabel(cur.cards);
  }

  function paintFoot(cur) {
    if (!ours(cur)) return;
    const hadFocus = sheet.foot.contains(doc.activeElement) || doc.activeElement === sheet.panel;   // the panel: a run held it
    const nodes = renderUpdateFoot(doc, footState(cur.cards));
    for (const b of nodes) {
      if (b.tagName !== 'BUTTON') continue;
      if (applying) b.disabled = true;
      b.addEventListener('click', () => onFoot(cur, b.dataset.act));
    }
    sheet.replace({ foot: nodes });
    if (hadFocus && sheet.isOpen()) {
      const go = nodes.find((n) => n.dataset?.act === 'go');
      if (go && !go.disabled) go.focus(); else sheet.panel.focus();   // never let focus fall to the page behind
    }
  }

  // One card's preview: ok → review (opened when it must be ticked) or up to date; 409 GIT_MISSING → Needs git;
  // anything else → its error. An answer for an open that is no longer current paints nothing.
  async function previewCard(cur, card) {
    if (!live(cur)) return;
    const r = await deps.api('POST', url(card), {});
    if (!live(cur)) return;
    const p = r?.ok ? r.data?.preview : null;
    if (p && typeof p === 'object' && typeof p.candidateSha === 'string' && p.candidateSha) {   // apply binds to it
      card.preview = p;
      card.error = null;
      if (isUpToDate(p)) card.state = 'uptodate';
      else { card.state = 'review'; card.expanded = needsTick(card); }
    } else if (r?.status === 409 && r.data?.code === 'GIT_MISSING') {
      card.state = 'failed';
      card.error = { message: null, gitMissing: true, phase: 'preview' };
    } else {
      card.state = 'failed';
      card.error = { message: r?.data?.error || 'update preview failed', gitMissing: false, phase: 'preview' };
    }
    paintCard(cur, card);
    paintHead(cur);
    paintFoot(cur);
  }

  // Apply the targets one by one, each bound to the commit its card previewed.
  async function run(cur, targets) {
    if (applying || !targets.length) return;
    applying = true;
    sheet.setBusy(true);
    paintFoot(cur);
    try {
      for (const card of targets) {
        if (!isReady(card)) continue;   // un-ticked (Include or the review tick) while an earlier card applied
        card.state = 'applying';
        card.error = null;
        paintCard(cur, card);
        const r = await deps.api('POST', url(card), { confirm: true, candidateSha: card.preview.candidateSha });
        if (r?.ok) card.state = r.data?.updated === false ? 'uptodate' : 'done';
        else if (r?.status === 409 && r.data?.code === 'STALE_PREVIEW') {
          card.state = 'loading';
          paintCard(cur, card);
          await previewCard(cur, card);
          if (card.state === 'review') { card.stale = true; card.reviewed = false; card.expanded = true; }
        } else if (r?.status === 409 && r.data?.code === 'GIT_MISSING') {
          card.state = 'failed';
          card.error = { message: null, gitMissing: true, phase: 'apply' };
        } else {
          card.state = 'failed';
          card.error = { message: r?.data?.error || 'update failed', gitMissing: false, phase: 'apply' };
        }
        paintCard(cur, card);
        paintFoot(cur);
      }
    } finally {
      applying = false;
      sheet.setBusy(false);
    }
    if (targets.some((c) => c.state === 'done')) deps.invalidateAgentCaches?.();   // plugin agents change with the version
    await page.load();
    paintHead(current);
    paintFoot(current);
  }

  function onFoot(cur, act) {
    if (!ours(cur) || applying) return;
    const fs = footState(cur.cards);
    if (act === 'go' && fs.finished) { close(); return; }
    const targets = act === 'go' ? (fs.enabled ? cur.cards.filter(isIncluded) : []) : act === 'only' ? cur.cards.filter(isReady) : [];
    if (targets.length) running = run(cur, targets);
  }

  function onListChange(cur, ev) {
    if (!ours(cur)) return;
    const input = ev.target;
    const card = cur.cards.find((c) => c.name === input?.dataset?.name);
    if (!card) return;
    if (input.classList.contains('mk-include')) card.include = !!input.checked;
    else if (input.classList.contains('mk-reviewed')) card.reviewed = !!input.checked;
    else return;
    paintFoot(cur);
  }

  function onListClick(cur, ev) {
    if (!ours(cur)) return;
    const disc = ev.target.closest?.('.mk-disc');
    if (!disc || !cur.list.contains(disc)) return;
    const card = cur.cards.find((c) => c.name === disc.dataset.name);
    if (!card) return;
    card.expanded = !card.expanded;
    paintCard(cur, card)?.querySelector('.mk-disc')?.focus();
  }

  async function open(names = null, { opener = null } = {}) {
    // SM70: an open asked for after the person left #marketplace (a P5 preview takes seconds) opens nothing over the page
    // they moved to; the row still offers the update.
    if (!String(win.location?.hash ?? '').startsWith('#marketplace')) return;
    const rows = list(page.state.plugins).filter((r) => r && typeof r.name === 'string');
    const wanted = Array.isArray(names) ? names : rows.filter((r) => r.latest).map((r) => r.name);
    const cards = rows.filter((r) => wanted.includes(r.name)).sort((a, b) => a.name.localeCompare(b.name)).map(newCard);
    if (!cards.length) return;
    const focusBack = opener || doc.activeElement;
    token += 1;
    const box = make(doc, 'div', 'mk-upd-list');
    const id = make(doc, 'div', 'mk-sheet-id');
    const main = make(doc, 'div', 'mk-sheet-id-main');
    const title = make(doc, 'h2', 'subpage-title', sheetTitle(cards));
    title.id = 'mk-sheet-title';
    const when = make(doc, 'div', 'mk-meta mk-upd-when');
    main.append(title, when);
    id.append(main);
    const cur = { t: token, cards, list: box, when };
    current = cur;
    box.addEventListener('change', (ev) => onListChange(cur, ev));
    box.addEventListener('click', (ev) => onListClick(cur, ev));
    box.append(...cards.map((c) => renderUpdateCard(doc, c)));
    sheet.setBusy(applying);   // a run from an earlier open is still out (SM70 closed its sheet): Escape and Close wait
    sheet.setKind('viewer');
    sheet.replace({ head: id, body: box, foot: [] });
    sheet.panel.dataset.mode = 'update';
    sheet.open(focusBack);
    if (!sheet.panel.contains(doc.activeElement)) sheet.panel.focus();   // P3 focuses Close, which a run still out holds
    paintHead(cur);
    paintFoot(cur);
    if (applying) await running;   // never preview a plugin while an earlier run applies it
    for (const card of cards) {
      if (!live(cur)) break;
      await previewCard(cur, card);
    }
  }

  function close() {
    if (!applying) sheet.close();
  }

  // SM70: leaving #marketplace closes the sheet; a run already applying keeps going and page.load() lands at its end.
  function onHash() {
    if (mine() && sheet.isOpen() && !String(win.location?.hash ?? '').startsWith('#marketplace')) sheet.close();
  }
  win.addEventListener('hashchange', onHash);

  return { open, close, isOpen: () => sheet.isOpen(), isApplying: () => applying };
}
