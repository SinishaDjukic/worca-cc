// ui/public/chat-group-dialog.mjs — the Chats column's group dialog (issue #948 slice 3): New group (Select › Group N,
// or Add to group… › New group) and Rename group (the group row's ⋯). The shared dialog anatomy (dialog-layout.mjs),
// built the way keys-sheet.mjs builds its sheet. While smartRunNaming is on, the name field takes Smart run naming's
// states (smart-naming.mjs createSuggestedName: shimmer, Suggested chip, Suggest again ⌥R, Clear); off, a plain field.
// ⌘↵ saves, Esc closes and hands the focus back. `api(method, path, body?, signal?)` answers parsed JSON, { error } on a
// refusal or { aborted: true }.
import { layoutDialog } from './dialog-layout.mjs';
import { createSuggestedName } from './smart-naming.mjs';
import { keyHint, isMac } from './list-keys.mjs';

export const GROUP_NAME_MAX = 120;   // the store's CHAT_GROUP_NAME_MAX

export function openChatGroupDialog({ doc, mode = 'create', group = null, chats = [], suggestOn = false, api, icon,
  opener = null, fallback = null, onDone = () => {} }) {
  const win = doc.defaultView;
  const mac = isMac(win);
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const rename = mode === 'rename';

  const modal = el('div', 'viewer-modal chat-group-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'chat-group-title');
  const card = el('div', 'card chat-group-dlg');
  const title = el('h2', 'chat-group-title', rename ? 'Rename group' : 'New group');
  title.id = 'chat-group-title';
  const sub = rename ? null : el('p', 'chat-group-sub', `${chats.length} chat${chats.length === 1 ? '' : 's'}`);
  const label = el('label', 'chat-group-label', 'Name');
  label.htmlFor = 'chat-group-name';
  const chipSlot = el('span', 'sn-chip-slot');
  label.append(chipSlot);
  const adorn = el('div', 'sn-adorn');
  const input = el('input', 'input');
  input.id = 'chat-group-name';
  input.maxLength = GROUP_NAME_MAX;
  input.autocomplete = 'off';
  input.placeholder = 'Group name';
  adorn.append(input);
  let retry = null, clear = null;
  if (suggestOn) {
    const acts = el('span', 'sn-actions');
    retry = btn('sn-btn');
    retry.setAttribute('aria-label', 'Suggest again');
    retry.title = `Suggest again (${keyHint(['alt', 'R'], mac)})`;
    clear = btn('sn-btn');
    clear.setAttribute('aria-label', 'Clear suggestion');
    clear.title = 'Clear suggestion';
    acts.append(retry, clear);
    adorn.append(acts);
  }
  const hint = el('p', 'hint chat-group-hint');
  hint.setAttribute('aria-live', 'polite');   // "Suggesting a name…" and the Suggested hint are read out
  const err = el('p', 'chat-group-err');
  err.setAttribute('role', 'alert');
  err.hidden = true;
  const actions = el('div', 'chat-group-foot');
  const cancel = btn('btn btn-quiet', 'Cancel');
  const ok = btn('btn btn-primary', rename ? 'Rename' : 'Create group');
  ok.title = keyHint(['mod', 'Enter'], mac);
  actions.append(cancel, ok);
  card.append(...[title, sub, label, adorn, hint, err, actions].filter(Boolean));
  layoutDialog(card, { head: [title], foot: [err, actions] });
  modal.append(card);
  doc.body.append(modal);

  const ids = chats.map((c) => c.id);
  const field = suggestOn ? createSuggestedName({ doc, input, chipSlot, hint, retry, clear, icon,
    suggest: (signal) => api('POST', '/api/ask/groups/suggest-name', { threadIds: ids }, signal) }) : null;
  if (rename) { input.value = group.name; field?.keep(); }
  else if (field && ids.length) void field.run();

  let busy = false;
  async function save() {
    if (busy) return;
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) { err.textContent = 'Name the group.'; err.hidden = false; input.focus(); return; }
    // An untouched suggestion saves as suggested; a Rename that kept the name keeps its source.
    const nameSource = field && field.state() === 'suggested' ? 'suggested'
      : rename && name === group.name ? (group.nameSource || 'user') : 'user';
    busy = true;
    ok.disabled = true;
    const r = rename
      ? await api('PATCH', `/api/ask/groups/${encodeURIComponent(group.id)}`, { name, nameSource })
      : await api('POST', '/api/ask/groups', { name, nameSource, threadIds: ids });
    busy = false;
    if (!modal.isConnected) return;
    if (!r || r.error || !r.group) {
      ok.disabled = false;
      err.textContent = `Could not save the group.${r && r.error ? ` ${r.error}` : ''}`;
      err.hidden = false;
      input.focus();
      return;
    }
    done();
    onDone(r.group);
  }
  function done() {
    win.removeEventListener('keydown', onKey, true);
    field?.dispose();
    modal.remove();
    const back = opener && opener.isConnected ? opener : (typeof fallback === 'function' ? fallback() : null);
    if (back && typeof back.focus === 'function') back.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(); return; }
    if (e.key === 'Tab') {   // aria-modal: Tab and ⇧Tab cycle inside the card
      const stops = [...card.querySelectorAll('input, button')].filter((n) => !n.disabled && !n.hidden);
      const i = stops.indexOf(doc.activeElement);
      const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i < 0 || i === stops.length - 1 ? 0 : i + 1);
      e.preventDefault();
      stops[next]?.focus();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.isComposing) { e.preventDefault(); void save(); return; }
    if (field && e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyR') { e.preventDefault(); void field.run(); }
  }
  win.addEventListener('keydown', onKey, true);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.isComposing) { e.preventDefault(); void save(); } });
  input.addEventListener('input', () => { err.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) done(); });
  cancel.addEventListener('click', done);
  ok.addEventListener('click', () => { void save(); });
  input.focus();
  return { el: modal, close: done };
}
