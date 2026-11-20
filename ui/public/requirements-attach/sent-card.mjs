// A sent `feature` block as a card in the chat transcript. Click toggles a read-only panel in place with the frozen
// snapshot markdown; nothing navigates. The snapshot is never replaced by server data — resolve only adds a note.
import { icon } from '../icons.mjs';

const RESOLVE_URL = '/api/requirements/attach/resolve';
const GONE_STATUSES = new Set(['archived', 'missing']);
export const GONE_NOTE = 'This feature is no longer available.';

function make(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Fill `mount` with the snapshot: the injected markdown renderer, or plain text when it is missing or fails. */
async function fillMarkdown(mount, markdown, renderMarkdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const plain = () => { mount.textContent = text; };
  if (typeof renderMarkdown !== 'function') return plain();
  try {
    const out = await renderMarkdown(text, mount);
    if (typeof out === 'string') mount.textContent = out;
    else if (out && typeof out === 'object' && out.nodeType && !mount.contains(out)) mount.replaceChildren(out);
  } catch {
    plain();
  }
}

/** True when the server says this feature is archived or deleted. Any failure or odd shape is false. */
async function isGone(seq, fetchJson) {
  try {
    const res = await fetchJson(RESOLVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seqs: [seq] }),
    });
    if (!res || typeof res !== 'object' || res.ok === false) return false;
    const data = res.data && typeof res.data === 'object' ? res.data : res;
    if (!Array.isArray(data.items)) return false;
    const item = data.items.find((i) => i && i.seq === seq);
    return Boolean(item) && GONE_STATUSES.has(item.status);
  } catch {
    return false;
  }
}

/** Render one frozen `feature` block. `block` is read, never written. */
export function renderSentFeatureCard(doc, block, { fetchJson, flagOn, renderMarkdown }) {
  const id = block.id ?? `FEAT-${block.seq}`;
  const card = make(doc, 'div', 'sent-feature-card');
  card.dataset.seq = String(block.seq);

  const head = make(doc, 'button', 'sent-feature-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.append(make(doc, 'span', 'sent-feature-title', block.title ?? id), make(doc, 'span', 'sent-feature-id', id));
  if (Number.isInteger(block.criteriaCount)) {
    const n = block.criteriaCount;
    head.append(make(doc, 'span', 'sent-feature-count', `${n} ${n === 1 ? 'criterion' : 'criteria'}`));
  }
  head.append(icon(doc, 'chevron-down', 12));

  const panel = make(doc, 'div', 'sent-feature-panel');
  panel.hidden = true;
  const body = make(doc, 'div', 'sent-feature-body');
  panel.append(body);
  card.append(head, panel);

  let opened = false;
  head.addEventListener('click', async () => {
    const show = panel.hidden;
    panel.hidden = !show;
    head.setAttribute('aria-expanded', String(show));
    if (!show || opened) return;
    opened = true;
    await fillMarkdown(body, block.markdown, renderMarkdown);
    if (typeof flagOn === 'function' && flagOn() && typeof fetchJson === 'function' && await isGone(block.seq, fetchJson)) {
      panel.append(make(doc, 'div', 'sent-feature-note', GONE_NOTE));
    }
  });
  return card;
}
