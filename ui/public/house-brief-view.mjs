// ui/public/house-brief-view.mjs — Settings → Project → House brief: the generated brief (read-only), its word count,
// its sources with read times, the pinned lines, and one action row whose only button is the secondary 'Refresh now'.
import { notify, cardAlert } from './feedback.mjs';

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const num = (n) => Number(n || 0).toLocaleString('en-US');
const EMPTY = 'No sources yet. Add a CLAUDE.md, project memory or a spec in plans/, then refresh.';

export function mountHouseBrief(host, { projectKey, fetchFn = (url, options) => fetch(url, options) }) {
  const doc = host.ownerDocument;
  const base = `/api/projects/${encodeURIComponent(projectKey)}/house-brief`;
  const el = (tag, className, text) => { const n = doc.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const button = (label, className) => { const b = el('button', `btn btn-sm ${className}`, label); b.type = 'button'; return b; };

  const card = el('section', 'card house-brief'); card.dataset.card = 'house-brief';
  const summary = el('p', 'hint hb-summary', 'Reading sources…');
  const sources = el('ul', 'hb-list hb-sources');
  const text = el('pre', 'hb-text'); text.hidden = true;
  const pins = el('ul', 'hb-list hb-pins');
  const input = el('input', 'hb-pin-input'); input.type = 'text'; input.maxLength = 240; input.placeholder = 'Add a line every rebuild keeps';
  const pinAdd = button('Pin line', 'hb-pin-add');
  const add = el('div', 'hb-add'); add.append(input, pinAdd);
  const msg = el('small', 'hint hb-msg');
  const refresh = button('Refresh now', 'hb-refresh'); refresh.disabled = true;
  const actions = el('div', 'add-project-actions engine-save-row hb-actions'); actions.append(msg, refresh);
  card.append(el('h3', '', 'House brief'), summary, sources, text, el('h4', 'hb-pins-head', 'Pinned lines'),
    el('p', 'hint', 'Kept at the top of every rebuild.'), pins, add, actions);
  host.replaceChildren(card);
  let pinned = [];

  const render = (view) => {
    pinned = view.pinned || [];
    // No sources → the empty line, even when pins exist (the brief would hold only the pins).
    const empty = !(view.sources || []).length || !view.brief;
    const trimmed = view.trimmed?.lines ? ` · ${num(view.trimmed.lines)} index lines trimmed` : '';
    summary.textContent = empty ? EMPTY : `${num(view.words)} of ${num(view.budget)} words · built ${when(view.builtAt)}${trimmed}`;
    text.hidden = empty; text.textContent = view.brief || '';
    sources.hidden = empty;
    sources.replaceChildren(...(view.sources || []).map((s) => {
      const li = el('li', 'hb-source'); li.dataset.kind = s.kind;
      li.append(el('span', 'hb-source-label', s.label), el('small', 'hint', `${num(s.files)} ${s.files === 1 ? 'file' : 'files'} · read ${when(s.readAt)}`));
      return li;
    }));
    pins.replaceChildren(...pinned.map((line, i) => {
      const li = el('li', 'hb-pin');
      const remove = button('Remove', 'hb-pin-remove');
      remove.addEventListener('click', () => void savePins(pinned.filter((_, j) => j !== i)));
      li.append(el('span', 'hb-pin-text', line), remove);
      return li;
    }));
    refresh.disabled = false;
  };
  const call = async (method, path = '', body) => {
    const response = await fetchFn(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `The server answered ${response.status}.`);
    return data;
  };
  const savePins = async (next) => {
    cardAlert(card, null);
    try { render(await call('PUT', '/pinned', { pinned: next })); input.value = ''; }
    catch (error) { cardAlert(card, { title: 'Pinned lines not saved', detail: error.message }); }
  };
  pinAdd.addEventListener('click', () => { if (input.value.trim()) void savePins([...pinned, input.value]); });
  refresh.addEventListener('click', async () => {
    cardAlert(card, null);
    refresh.disabled = true; refresh.textContent = 'Refreshing…';
    try {
      const view = await call('POST', '/refresh');
      render(view);
      notify({ tone: 'ok', title: 'Brief refreshed', detail: `${num(view.words)} of ${num(view.budget)} words` }, { doc });
    } catch (error) { cardAlert(card, { title: 'House brief could not be refreshed', detail: error.message }); }
    finally { refresh.disabled = false; refresh.textContent = 'Refresh now'; }
  });
  const reload = async () => {
    try { render(await call('GET')); }
    catch (error) { summary.textContent = ''; refresh.disabled = false; cardAlert(card, { title: 'House brief could not be read', detail: error.message }); }
  };
  void reload();
  return { reload };
}
