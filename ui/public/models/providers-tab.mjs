// ui/public/models/providers-tab.mjs — the Models page's Providers tab (DESIGN PRV-1): two headed cards of fold rows,
// one row per provider or service. A row's head is one button (caret, mark, name, one summary line, state word); its
// body is today's row body from bridge-view.mjs, folded until opened. Every link and field stays in the body, outside
// the head button, the broker's key-page pill included. With the credential broker on, both cards carry
// .mv-providers--broker, so the broker hide rules (settings/settings-cards.css) reach every row at any depth.
import { icon } from '../icons.mjs';
import { renderCopilotRow, renderOpenRouterRow, renderEndpointRow, renderSpeechRow, renderImagesRow, renderSoundRow } from '../bridge-view.mjs';
import { markTile } from './brand-marks.mjs';
import { providerState, providerSummary } from './provider-state.mjs';

const el = (doc, tag, cls, text) => {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/** Each row's name, its mark (a provider's brand mark, or a neutral glyph for a service) and its body builder. */
const ROWS = Object.freeze({
  copilot: { name: 'GitHub Copilot', mark: { kind: 'provider', key: 'copilot' }, body: (p, doc, signIn) => renderCopilotRow(p, { doc, signIn }) },
  openrouter: { name: 'OpenRouter', mark: { kind: 'provider', key: 'openrouter' }, body: (p, doc) => renderOpenRouterRow(p, { doc }) },
  openai: { name: 'OpenAI-compatible', mark: { kind: 'provider', key: 'openai' }, body: (p, doc) => renderEndpointRow(p, 'openai', { doc }) },
  anthropic: { name: 'Anthropic-compatible', mark: { kind: 'provider', key: 'anthropic' }, body: (p, doc) => renderEndpointRow(p, 'anthropic', { doc }) },
  speech: { name: 'Speech', mark: { kind: 'glyph', key: 'mic' }, body: (p, doc) => renderSpeechRow(p, { doc }) },
  images: { name: 'Image generation', mark: { kind: 'glyph', key: 'image' }, body: (p, doc) => renderImagesRow(p, { doc }) },
  sound: { name: 'Sound', mark: { kind: 'glyph', key: 'wave' }, body: (p, doc) => renderSoundRow(p, { doc }) },
});

/** The two cards in page order; the broker note opens the first. */
const CARDS = Object.freeze([
  { id: 'mdl-sect-providers', title: 'Model providers', rows: ['copilot', 'openrouter', 'openai', 'anthropic'], note: true },
  { id: 'mdl-sect-media', title: 'Voice, pictures and sound', rows: ['speech', 'images', 'sound'], note: false },
]);

/** The broker note: keys and the Copilot sign-in are per person, on the broker's key page (linked once it is known). */
function brokerNote(doc, broker) {
  const note = el(doc, 'p', 'hint mv-broker-note', 'Keys and the GitHub Copilot sign-in are held by the credential broker: each person adds their own on the key page. Imports list models with your own key.');
  if (broker.keyPage) {
    const a = el(doc, 'a', 'mv-broker-link', 'Open the key page');
    a.href = broker.keyPage; a.target = '_blank'; a.rel = 'noopener';
    note.append(' ', a);
  }
  return note;
}

/** section.drow.drow-stack.mv-pv-card[data-row]: the fold head button over its (hidden unless open) body. */
function foldRow(doc, p, name, { signIn, open, counts }) {
  const row = ROWS[name];
  const bodyId = `mdl-pv-${name}`;
  const expanded = Boolean(open[name]) || (name === 'copilot' && Boolean(signIn));
  const item = el(doc, 'section', 'drow drow-stack mv-pv-card');
  item.dataset.row = name;
  const head = el(doc, 'button', 'mdl-fold row-btn');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expanded));
  head.setAttribute('aria-controls', bodyId);
  const caret = el(doc, 'span', 'mdl-fold-caret');
  caret.appendChild(icon(doc, 'chevron', 16));
  const txt = el(doc, 'span', 'mdl-fold-txt');
  txt.append(el(doc, 'span', 'mdl-fold-name', row.name), el(doc, 'span', 'mdl-fold-sum', providerSummary(p, name, counts)));
  const state = providerState(p, name, { hasModels: (counts[name] || 0) > 0 });
  head.append(caret, markTile(doc, { ...row.mark, size: 'lg', label: '' }), txt, el(doc, 'span', `mdl-st ${state.tone}`, state.text));
  const body = el(doc, 'div', 'mdl-fold-body');
  body.id = bodyId;
  body.hidden = !expanded;
  body.appendChild(row.body(p, doc, signIn));
  item.append(head, body);
  return item;
}

/**
 * → div.mdl-prov holding:
 *    h2.mdl-sect#mdl-sect-providers "Model providers"
 *    section.card.drows.mv-providers.mv-providers-split[aria-labelledby][.mv-providers--broker]   copilot, openrouter, openai, anthropic
 *    h2.mdl-sect#mdl-sect-media "Voice, pictures and sound"
 *    section.card.drows.mv-providers.mv-providers-split[aria-labelledby][.mv-providers--broker]   speech, images, sound
 *  Each row: section.drow.drow-stack.mv-pv-card[data-row=<name>] >
 *    button.mdl-fold.row-btn[type=button][aria-expanded][aria-controls]
 *      (span.mdl-fold-caret with the chevron icon, markTile size 'lg',
 *       span.mdl-fold-txt > (span.mdl-fold-name + span.mdl-fold-sum), span.mdl-st.<tone>)
 *    div.mdl-fold-body#mdl-pv-<name>[hidden]  > the row body (bridge-view.mjs)
 *  state = providerState(p, name, { hasModels: (counts[name] || 0) > 0 }); summary = providerSummary(p, name, counts).
 *  Open when open[name], or for copilot while signIn is set. With the broker on, the first card starts with the
 *  broker note (p.hint.mv-broker-note + a.mv-broker-link "Open the key page"). Tolerates {}.
 *  `providers` is GET /api/providers' payload (never a token); `signIn` is the Copilot device flow in flight, or null.
 */
export function renderProvidersTab(providers, { doc = globalThis.document, signIn = null, open = {}, counts = {} } = {}) {
  const p = providers || {};
  const broker = p.broker && p.broker.enabled ? p.broker : null;
  const opts = { signIn, open: open || {}, counts: counts || {} };
  const root = el(doc, 'div', 'mdl-prov');
  for (const def of CARDS) {
    const sect = el(doc, 'h2', 'mdl-sect', def.title);
    sect.id = def.id;
    const card = el(doc, 'section', 'card drows mv-providers mv-providers-split');
    card.setAttribute('aria-labelledby', def.id);
    if (broker) {
      card.classList.add('mv-providers--broker');
      if (def.note) card.appendChild(brokerNote(doc, broker));
    }
    for (const name of def.rows) card.appendChild(foldRow(doc, p, name, opts));
    root.append(sect, card);
  }
  return root;
}

/** Flips one row, or sets it when `force` is a boolean; returns the new state (false when `root` has no such row). */
export function toggleProviderRow(root, name, force) {
  const item = root ? [...root.querySelectorAll('.mv-pv-card[data-row]')].find((r) => r.dataset.row === name) : null;
  const head = item ? item.querySelector(':scope > .mdl-fold') : null;
  const body = item ? item.querySelector(':scope > .mdl-fold-body') : null;
  if (!head || !body) return false;
  const next = typeof force === 'boolean' ? force : head.getAttribute('aria-expanded') !== 'true';
  head.setAttribute('aria-expanded', String(next));
  body.hidden = !next;
  return next;
}
