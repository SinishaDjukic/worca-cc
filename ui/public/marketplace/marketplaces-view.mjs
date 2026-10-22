// ui/public/marketplace/marketplaces-view.mjs — the Marketplaces tab's cards (marketplace P7, board 4.1, F11). Pure:
// returns detached DOM; its only listener is each card's notes disclosure. Remove lives in the card's ⋯ menu, never on it.
import { relTime, renderNeedsGit } from '../plugins-view.mjs';
import { renderStatusDot } from '../status-dot.mjs';
import { icon } from '../icons.mjs';
import { kindTile, chip } from './kinds.mjs';
import { shortDate, noteText } from './catalog.mjs';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

function sep(doc) {
  const s = make(doc, 'span', null, '·');
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export const isLocalPath = (url) => /^(?:\/|[A-Za-z]:[\\/]|\\\\|file:\/\/)/i.test(String(url || ''));
// What a card or the Add result shows: never a URL credential (P2 masks them in its jobs too). A git URL loses its
// scheme and `.git`; a local folder (a path or file://) keeps its real name, `.git` included.
export function displayUrl(url) {
  const s = String(url || '');
  if (/^file:\/\//i.test(s)) {
    const p = s.slice(7);   // file:///C:/m is the drive path C:/m; file://host/share is the UNC path //host/share
    return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p.startsWith('/') ? p : `//${p}`;
  }
  if (isLocalPath(s)) return s;
  return s.replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^\s/]*@)?/i, '').replace(/\.git$/, '');
}
export const repoWebUrl = (url) => {
  const s = String(url || '');
  return /^https?:\/\//i.test(s) ? s.replace(/^(https?:\/\/)[^\s/]*@/i, '$1').replace(/\.git$/, '') : null;
};
export function syncedText(at, now = Date.now()) {
  const r = relTime(at, now);                        // plugins-view: 'just now' / '5m ago' / … / an ISO date after 30 days
  return `Synced ${/^\d{4}-/.test(r) ? shortDate(at, now) : r}`;
}
// SM5: notes are verbatim warning strings, also left in `warnings[]`. noteText drops the manifest path; the plugin name
// stands in for it.
export function marketplaceNotes(m) {
  const seen = new Set();
  const out = [];
  for (const p of m?.plugins || []) for (const n of p.notes || []) { seen.add(n); out.push({ plugin: p.name, text: noteText(n) }); }
  for (const w of m?.warnings || []) if (!seen.has(w) && !/; refresh failed: /.test(w)) out.push({ plugin: null, text: w });
  return out;
}

/** The notes body (div.mk-disc-body.mk-notes#<id>[hidden]): one div.mk-mono.mk-note per note, "<b>plugin</b> · text". */
export function renderNotes(doc, notes, id) {
  const body = make(doc, 'div', 'mk-disc-body mk-notes');
  body.id = id;
  body.hidden = true;
  for (const n of notes) {
    const line = make(doc, 'div', 'mk-mono mk-note');
    if (n.plugin) line.append(make(doc, 'b', null, n.plugin), doc.createTextNode(' · '));
    line.append(doc.createTextNode(n.text));
    body.append(line);
  }
  return body;
}

/** A disclosure button (chevron + label) over `body`, folded unless `open`; the click toggles `hidden` and
 *  `aria-expanded`. */
export function renderDisclosure(doc, label, body, { open = false } = {}) {
  const disc = button(doc, 'btn btn-sm btn-quiet mk-disc');
  disc.setAttribute('aria-expanded', String(open));
  body.hidden = !open;
  disc.setAttribute('aria-controls', body.id);
  disc.append(icon(doc, 'chevron', 14), doc.createTextNode(label));
  disc.addEventListener('click', () => {
    const open = disc.getAttribute('aria-expanded') !== 'true';
    disc.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });
  return disc;
}

/** One marketplace: section.card.mk-mkt[data-id] (board 4.1). `busy` = its refresh is in flight; `notesOpen` = its
 *  notes disclosure starts open (the user opened it before a re-render). */
export function renderMarketplaceCard(doc, m, { now = Date.now(), busy = false, notesOpen = false } = {}) {
  const id = m.id;
  const name = m.name || m.id;
  const plugins = Array.isArray(m.plugins) ? m.plugins : [];
  const n = plugins.length;
  const k = plugins.filter((p) => p?.installed === true).length;
  const card = make(doc, 'section', 'card mk-mkt');
  card.dataset.id = id;
  card.dataset.focusKey = `mkt:${id}`;
  card.tabIndex = -1;
  card.setAttribute('aria-labelledby', `mk-mkt-${id}-name`);

  const head = make(doc, 'div', 'mk-mkt-head');
  const h2 = make(doc, 'h2', 'section-title mk-mkt-name', name);
  h2.id = `mk-mkt-${id}-name`;
  head.append(h2);
  if (m.builtin) head.append(chip(doc, 'built', 'Built-in'));
  const actions = make(doc, 'div', 'mk-mkt-actions');
  const markBusy = (b) => {
    b.dataset.id = id;
    b.dataset.focusKey = `refresh:${id}`;   // Retry and refresh share a key: focus stays when one becomes the other
    if (busy) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-busy', 'true'); }
    return b;
  };
  if (m.lastError && !m.needsGit) {
    const retry = markBusy(button(doc, 'btn btn-sm mk-mkt-retry', 'Retry'));
    retry.setAttribute('aria-label', `Retry refresh of ${name}`);
    actions.append(retry);
  }
  const browse = button(doc, 'btn btn-sm mk-mkt-browse', 'Browse');
  browse.append(make(doc, 'span', 'mk-count', String(n)));
  browse.dataset.id = id;
  browse.dataset.focusKey = `browse:${id}`;
  browse.setAttribute('aria-label', `Browse ${plural(n, 'plugin')} from ${name}`);
  browse.disabled = n === 0;
  actions.append(browse);
  if (m.needsGit) actions.append(renderNeedsGit(doc));
  else if (!m.lastError) {
    const refresh = markBusy(button(doc, 'btn btn-sm btn-quiet btn-icon mk-mkt-refresh'));
    refresh.setAttribute('aria-label', `Refresh ${name}`);
    refresh.append(icon(doc, 'refresh', 16));
    actions.append(refresh);
  }
  const more = button(doc, 'btn btn-sm btn-quiet btn-icon mk-mkt-more');
  more.dataset.id = id;
  more.dataset.focusKey = `more:${id}`;
  more.setAttribute('aria-label', `More actions for ${name}`);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.append(icon(doc, 'more', 16));
  actions.append(more);
  head.append(actions);

  const url = make(doc, 'div', 'mk-mkt-url');
  url.append(make(doc, 'span', 'mk-mono', displayUrl(m.url)));
  if (m.ref) {
    const branch = chip(doc, 'n', '', { icon: 'git' });
    branch.append(make(doc, 'span', 'mk-mono', String(m.ref)));
    url.append(branch);
  }

  const health = make(doc, 'div', 'mk-mkt-health');
  const sha = typeof m.lastSync?.sha === 'string' ? m.lastSync.sha.slice(0, 7) : '';
  const facts = () => {
    if (sha) health.append(sep(doc), make(doc, 'span', 'mk-mono', sha));
    health.append(sep(doc), make(doc, 'span', null, plural(n, 'plugin')), sep(doc), make(doc, 'span', null, `${k} installed`));
  };
  if (m.lastError) {
    const msg = String(m.lastError.message ?? '');
    const warn = chip(doc, 'warn', msg ? `Can't reach · ${msg}` : "Can't reach", { icon: 'alert' });
    warn.title = msg;
    health.append(warn);
    if (m.lastSync) {
      health.append(make(doc, 'span', null, `Using the snapshot from ${shortDate(m.lastSync.at, now)}`));
      facts();
    }
  } else if (m.lastSync) {
    const synced = make(doc, 'span', 'mk-mkt-synced');
    synced.append(renderStatusDot(doc, { state: 'synced', dot: 'green' }), doc.createTextNode(syncedText(m.lastSync.at, now)));
    health.append(synced);
    facts();
  } else {
    const synced = make(doc, 'span', 'mk-mkt-synced');
    synced.append(renderStatusDot(doc, { state: 'never', dot: 'grey' }), doc.createTextNode('Never synced'));
    health.append(synced);
  }

  const main = make(doc, 'div', 'mk-mkt-main');
  main.append(head, url, health);
  const notes = marketplaceNotes(m);
  if (notes.length) {
    const body = renderNotes(doc, notes, `mk-mkt-${id}-notes`);
    const disc = renderDisclosure(doc, notes.length === 1 ? '1 manifest note' : `${notes.length} manifest notes`, body, { open: notesOpen });
    disc.dataset.focusKey = `notes:${id}`;
    main.append(disc, body);
  }
  card.append(kindTile(doc, 'mkt', { size: 'md' }), main);
  return card;
}

/** div.mk-mkts: the cards in the API's order; `busy` = the ids whose refresh is in flight; `notesOpen` = the ids whose
 *  notes are open. */
export function renderMarketplaceCards(doc, list, { now = Date.now(), busy = new Set(), notesOpen = new Set() } = {}) {
  const root = make(doc, 'div', 'mk-mkts');
  for (const m of Array.isArray(list) ? list : []) {
    root.append(renderMarketplaceCard(doc, m, { now, busy: busy.has(m.id), notesOpen: notesOpen.has(m.id) }));
  }
  return root;
}
