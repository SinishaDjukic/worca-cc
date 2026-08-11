// ui/public/graph/save-dialog.mjs
// The composer's save modal — a real <dialog>, replacing v1's two window.prompt
// calls (spec §9 kill list). Pure renderer: it returns a DETACHED dialog with a
// name field, a domain field backed by a datalist of the domains already in
// use, and .sd-confirm / .sd-cancel buttons. composer-editor.mjs mounts it,
// opens it, and owns the POST.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {{name?:string, domain?:string, domains?:string[], title?:string, doc?:Document}} opts
 * @returns {HTMLDialogElement|HTMLElement} the `.save-dialog` element
 */
export function renderSaveDialog({
  name = '', domain = '', domains = [], title = 'Save pipeline', doc = globalThis.document,
} = {}) {
  const dlg = doc.createElement('dialog');
  dlg.className = 'save-dialog';

  const form = h(doc, 'div', 'sd-body');
  form.appendChild(h(doc, 'h2', 'sd-title', title));

  const nameWrap = h(doc, 'div', 'sd-field');
  nameWrap.appendChild(h(doc, 'label', null, 'Name'));
  const nameInput = doc.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'sd-name';
  nameInput.value = name;
  nameInput.setAttribute('spellcheck', 'false');
  nameInput.placeholder = 'e.g. Full pipeline';
  nameWrap.appendChild(nameInput);
  form.appendChild(nameWrap);

  const domWrap = h(doc, 'div', 'sd-field');
  domWrap.appendChild(h(doc, 'label', null, 'Domain'));
  const domInput = doc.createElement('input');
  domInput.type = 'text';
  domInput.className = 'sd-domain';
  domInput.value = domain;
  domInput.setAttribute('spellcheck', 'false');
  domInput.placeholder = 'general';
  const listId = `sd-domains-${Math.random().toString(36).slice(2, 8)}`;
  domInput.setAttribute('list', listId);
  const list = doc.createElement('datalist');
  list.id = listId;
  for (const d of domains) {
    const opt = doc.createElement('option');
    opt.value = d;
    list.appendChild(opt);
  }
  domWrap.append(domInput, list);
  form.appendChild(domWrap);

  form.appendChild(h(doc, 'p', 'sd-msg'));

  const actions = h(doc, 'div', 'sd-actions');
  const cancel = h(doc, 'button', 'btn-ghost sd-cancel', 'Cancel');
  cancel.type = 'button';
  const confirm = h(doc, 'button', 'btn-go sd-confirm', 'Save');
  confirm.type = 'button';
  actions.append(cancel, confirm);
  form.appendChild(actions);

  dlg.appendChild(form);
  return dlg;
}

/** Open it. jsdom (and older browsers) may lack showModal — fall back to the
 *  `open` attribute so the modal is still in the accessibility tree. */
export function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') {
    try { dlg.showModal(); return; } catch { /* already open */ }
  }
  dlg.setAttribute('open', '');
}

export function closeDialog(dlg) {
  if (typeof dlg.close === 'function') {
    try { dlg.close(); return; } catch { /* not open */ }
  }
  dlg.removeAttribute('open');
}
