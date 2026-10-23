// folder-changes.mjs — Projects, any way: what a run on a copy of a plain folder changed, and landing it.
// The counts and words, the Apply bar (`Discard` · `Apply to folder`), the Apply to folder dialog (board 10) and
// Discard. DOM over an injected `doc`, network over an injected `fetch`; no work at import. Paths shown here are
// the server's (`/`-separated in changes.json and apply-plan on every OS); every path goes in through textContent.

import { kindChip } from './run-kind.mjs';
import { layoutDialog } from './dialog-layout.mjs';

export const CHANGE_SIGN = Object.freeze({ added: '+', modified: '~', deleted: '−' });
export const CHANGE_WORD = Object.freeze({ added: 'Added', modified: 'Updated', deleted: 'Deleted' });

const FINISHED = new Set(['done', 'stopped', 'error']);
const NO_RETRY = new Set(['CHANGES_SETTLED', 'COPY_MISSING', 'NO_CHANGES']);

export function filesWord(n) { return `${n} file${n === 1 ? '' : 's'}`; }

export function changesCounts(changes) {
  if (!changes || !changes.counts || typeof changes.counts !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const added = num(changes.counts.added), modified = num(changes.counts.modified), deleted = num(changes.counts.deleted);
  return { added, modified, deleted, total: added + modified + deleted };
}

export function folderDoneWords(state, total) {
  // a run that changed nothing settles as discarded (P1b S7), yet nobody discarded anything
  const lead = total === 0 ? 'Finished' : state === 'applied' ? 'Applied' : state === 'discarded' ? 'Discarded' : 'Finished';
  const sub = total == null ? '' : total === 0 ? 'No files changed' : `${filesWord(total)} changed`;
  return { lead, sub };
}

export function applyBarModel({ status, changes } = {}) {
  if (!FINISHED.has(status)) return null;
  const c = changesCounts(changes);
  if (!c || !(c.total > 0)) return null;
  const state = changes.state === 'applied' || changes.state === 'discarded' ? changes.state : 'pending';
  const tail = state === 'applied' ? 'Applied' : state === 'discarded' ? 'Discarded' : 'on a copy';
  return { state, label: `${filesWord(c.total)} · ${tail}`, actions: state === 'pending' };
}

const svgAttrs = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const GLYPHS = {
  copy: `<svg ${svgAttrs}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  folder: `<svg ${svgAttrs}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  warning: `<svg ${svgAttrs}><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/></svg>`,
};
function glyph(doc, name) {
  const t = doc.createElement('template');
  t.innerHTML = GLYPHS[name];
  return t.content.firstElementChild;
}
function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(doc, cls, text) {
  const b = el(doc, 'button', cls, text);
  b.type = 'button';
  return b;
}

export function renderCountsNode(doc, counts) {
  const c = counts || {};
  const n = el(doc, 'span', 'fc-counts mono');
  n.append(el(doc, 'span', 'fc-add', `${CHANGE_SIGN.added}${c.added || 0}`), ' ',
    el(doc, 'span', 'fc-upd', `${CHANGE_SIGN.modified}${c.modified || 0}`), ' ',
    el(doc, 'span', 'fc-del', `${CHANGE_SIGN.deleted}${c.deleted || 0}`));
  return n;
}

export function renderApplyBar(doc, model, { onApply, onDiscard } = {}) {
  const bar = el(doc, 'div', 'fc-bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Changes');
  const l = el(doc, 'span', 'fc-bar-l');
  l.append(glyph(doc, 'copy'), doc.createTextNode(model.label));
  bar.append(l);
  if (model.actions) {
    const r = el(doc, 'span', 'fc-bar-r');
    const discard = btn(doc, 'btn fc-discard', 'Discard');
    const apply = btn(doc, 'btn btn-primary fc-apply', 'Apply to folder');
    discard.addEventListener('click', () => { if (typeof onDiscard === 'function') onDiscard(); });
    apply.addEventListener('click', () => { if (typeof onApply === 'function') onApply(); });
    r.append(discard, apply);
    bar.append(r);
  }
  return bar;
}

export function paintApplyBar(host, model, handlers) {
  if (!host) return;
  host._fcHandlers = handlers || {};
  if (!model) {
    host.replaceChildren();
    delete host.dataset.sig;
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const sig = JSON.stringify(model);
  if (host.dataset.sig === sig && host.firstElementChild) return;
  host.dataset.sig = sig;
  host.replaceChildren(renderApplyBar(host.ownerDocument, model, {
    onApply: () => host._fcHandlers.onApply?.(),
    onDiscard: () => host._fcHandlers.onDiscard?.(),
  }));
}

export function runChangesUrl(pipelineId, tail, { memberKey = '' } = {}) {
  return `/api/runs/${encodeURIComponent(pipelineId)}/${tail}${memberKey ? `?memberKey=${encodeURIComponent(memberKey)}` : ''}`;
}

async function readJson(res) {
  try { return (await res.json()) || {}; } catch { return {}; }
}
const reasonOf = (body, status) => (body && body.error) || `The server answered ${status}.`;

let seq = 0;

export function openApplyDialog({ doc, fetch, pipelineId, memberKey = '', memberName = '', opener = null }) {
  const win = doc.defaultView;
  const id = `fc-apply-title-${++seq}`;
  const modal = el(doc, 'div', 'viewer-modal confirm-modal fc-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', id);
  const dlg = el(doc, 'div', 'card fc-dlg');
  const title = el(doc, 'h2', 'fc-dlg-title', 'Apply to folder');
  title.id = id;
  const target = el(doc, 'div', 'fc-target');
  target.hidden = true;
  const targetPath = el(doc, 'span', 'fc-target-path mono');
  target.append(glyph(doc, 'folder'), targetPath);
  const loading = el(doc, 'p', 'fc-loading', 'Loading…');
  const plan = el(doc, 'ul', 'fc-plan');
  const skipped = el(doc, 'section', 'fc-skipped');
  skipped.hidden = true;
  const skippedH = el(doc, 'h3', 'fc-skipped-h');
  const skippedList = el(doc, 'ul');
  skipped.append(skippedH, skippedList);
  const err = el(doc, 'p', 'fc-err');
  err.setAttribute('role', 'alert');
  err.hidden = true;
  const foot = el(doc, 'div', 'fc-foot');
  const cancel = btn(doc, 'btn fc-cancel', 'Cancel');
  const go = btn(doc, 'btn btn-primary fc-go', 'Apply to folder');
  go.disabled = true;
  foot.append(cancel, go);
  // P5: a workspace member's dialog names the member (name + Folder chip) above the target line.
  const member = memberName ? el(doc, 'div', 'fc-member-line') : null;
  if (member) member.append(el(doc, 'span', 'fc-member-name', String(memberName)), kindChip(doc, 'folder'));
  dlg.append(...[title, member, target, loading, plan, skipped, err, foot].filter(Boolean));
  layoutDialog(dlg, { head: [title, member], foot: [err, foot] });
  modal.append(dlg);
  doc.body.append(modal);

  let busy = false;
  let closed = false;
  let result = null;
  let n = 0;
  let resolve;
  const done = new Promise((r) => { resolve = r; });

  const setSkippedHead = (text) => { skippedH.replaceChildren(glyph(doc, 'warning'), doc.createTextNode(text)); };
  const showErr = (text) => { err.textContent = text; err.hidden = false; };
  const close = () => {
    if (closed) return;
    closed = true;
    win.removeEventListener('keydown', onKey, true);
    modal.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    resolve(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!busy) close();
      return;
    }
    if (e.key === 'Tab') {
      const btns = [...dlg.querySelectorAll('button')].filter((b) => !b.disabled);
      if (!btns.length) { e.preventDefault(); return; }
      const first = btns[0], last = btns[btns.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dlg.contains(doc.activeElement)) { e.preventDefault(); first.focus(); }
    }
  };
  win.addEventListener('keydown', onKey, true);
  modal.addEventListener('click', (e) => { if (e.target === modal && !busy) close(); });
  cancel.addEventListener('click', () => { if (!busy) close(); });
  cancel.focus();

  const showResult = (body) => {
    result = body;
    go.remove();
    plan.remove();
    setSkippedHead('Not applied');
    skippedList.replaceChildren(...(Array.isArray(body.skipped) ? body.skipped : []).map((s) => {
      const li = el(doc, 'li', 'fc-sfile');
      const failed = s && s.reason === 'failed';
      li.append(el(doc, 'span', 'fc-sfile-path mono', String((s && s.path) || '')),
        el(doc, 'span', failed ? 'chip fc-skip fc-fail' : 'chip fc-skip', failed ? 'Failed' : 'Skipped'));
      if (failed) li.append(el(doc, 'span', 'fc-sfile-msg mono', String(s.message || '')));
      return li;
    }));
    skipped.hidden = false;
    cancel.textContent = 'Close';
    cancel.disabled = false;
    cancel.focus();
  };

  go.addEventListener('click', async () => {
    if (busy || go.disabled || closed) return;
    busy = true;
    err.hidden = true;
    go.textContent = 'Applying…';
    go.disabled = true;
    cancel.disabled = true;
    let ok = false, body = {}, status = 0, thrown = '';
    try {
      const res = await fetch(runChangesUrl(pipelineId, 'apply', { memberKey }), { method: 'POST' });
      status = res.status;
      ok = !!res.ok;
      body = await readJson(res);
    } catch (e) {
      thrown = (e && e.message) || String(e);
    }
    busy = false;
    if (closed) return;
    if (ok && !thrown) {
      const res = { applied: body.applied, skipped: Array.isArray(body.skipped) ? body.skipped : [] };
      if (res.skipped.some((s) => s && s.reason === 'failed')) { showResult(body); return; }
      result = body;
      close();
      return;
    }
    showErr(thrown || reasonOf(body, status));
    go.textContent = `Apply ${filesWord(n)}`;
    go.disabled = n === 0 || NO_RETRY.has(body && body.code);
    cancel.disabled = false;
  });

  (async () => {
    let ok = false, body = {}, status = 0, thrown = '';
    try {
      const res = await fetch(runChangesUrl(pipelineId, 'apply-plan', { memberKey }));
      status = res.status;
      ok = !!res.ok;
      body = await readJson(res);
    } catch (e) {
      thrown = (e && e.message) || String(e);
    }
    if (closed) return;
    loading.remove();
    if (!ok || thrown) { showErr(thrown || reasonOf(body, status)); return; }
    const list = (k) => (Array.isArray(body[k]) ? body[k] : []);
    const skips = list('skipped');
    targetPath.textContent = String(body.displayTarget || body.target || '');
    target.hidden = false;
    const rows = [['add', 'fc-add', CHANGE_SIGN.added, 'Add'], ['update', 'fc-upd', CHANGE_SIGN.modified, 'Update'], ['delete', 'fc-del', CHANGE_SIGN.deleted, 'Delete']];
    for (const [k, cls, sign, word] of rows) {
      const items = list(k);
      if (!items.length) continue;
      const li = el(doc, 'li', 'fc-plan-row');
      const s = el(doc, 'span', `fc-sign ${cls}`, sign);
      s.setAttribute('aria-hidden', 'true');
      li.append(s, el(doc, 'span', 'fc-plan-w', word), el(doc, 'span', 'fc-plan-n', filesWord(items.length)));
      plan.append(li);
    }
    if (skips.length) {
      setSkippedHead('Changed in the folder since the run started');
      skippedList.replaceChildren(...skips.map((x) => {
        const li = el(doc, 'li', 'fc-sfile');
        li.append(el(doc, 'span', 'fc-sfile-path mono', String((x && x.path) || '')), el(doc, 'span', 'chip fc-skip', 'Skipped'));
        return li;
      }));
      skipped.hidden = false;
    }
    const all = new Set([...list('add'), ...list('update'), ...list('delete')]);
    for (const x of skips) all.delete(x && x.path);
    n = all.size;
    go.textContent = `Apply ${filesWord(n)}`;
    go.disabled = n === 0;
  })();

  return done;
}

export async function discardChanges({ fetch, pipelineId, memberKey = '' }) {
  try {
    const res = await fetch(runChangesUrl(pipelineId, 'discard', { memberKey }), { method: 'POST' });
    const body = await readJson(res);
    if (!res.ok) return { error: reasonOf(body, res.status) };
    return { ok: true };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}
