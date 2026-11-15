// ui/public/prompt-check/improve-view.mjs — the Improve view of the prompt check chip (docs/prompt-check.md, "Improve").
// One shared module for every surface: the chip host owns it and the Improve button. A click posts once to
// POST /api/prompt-check/improve; the view then shows the library's RewriteSuggestion (busy, ready, used, failed).
// The field changes only on Use this and Undo; Undo restores the text Use this replaced, read at that moment. The
// view's own writes are not edits (D12): a fieldEdited() with the text it just wrote keeps Undo. A reply for an older
// request, or after close() or dispose(), never paints and never writes. Every string from the reply goes through the
// component, which escapes it; nothing here sets markup from reply data.
import { KIND_LABELS } from '../../../src/shared/prompt-check/assessment.mjs';
import { rewriteSuggestion } from '../design-system/components/suggestion-field.mjs';
import { toElement } from '../design-system/components/html.mjs';

const URL_IMPROVE = '/api/prompt-check/improve';
const NO_RETRY = new Set(['model unavailable', 'total cost limit reached']);
const ACT = 'data-improve-act';

const valueOf = (v) => (typeof v === 'function' ? v() : v);

/** The request's project: a key string, or {projectKey} / {projectDir}; anything else is no project. */
function projectFields(p) {
  if (typeof p === 'string') return p ? { projectKey: p } : {};
  if (p && typeof p === 'object') {
    if (typeof p.projectKey === 'string' && p.projectKey) return { projectKey: p.projectKey };
    if (typeof p.projectDir === 'string' && p.projectDir) return { projectDir: p.projectDir };
  }
  return {};
}

/**
 * @param {{doc:Document, host:HTMLElement, surface:{kind:string,id:string},
 *   field:{read:()=>string, write:(text:string)=>void, focus?:()=>void}, project?:Function, engine?:Function|string,
 *   chatModel?:Function|string, fetchImpl?:Function, announce?:(text:string)=>void, onState?:(state:string)=>void}} o
 */
export function createImproveView({ doc, surface, field, project = null, engine = null, chatModel = null, fetchImpl = (...a) => fetch(...a), announce = null, onState = null }) {
  const el = doc.createElement('div');
  el.className = 'pcheck-improve';
  el.setAttribute('data-prompt-improve', '');
  let state = 'hidden';
  let seq = 0;
  let latestId = null;
  let ctl = null;
  let reply = null;          // the Ready reply
  let before = null;         // the text Use this replaced
  let selfWrite = null;      // the text the view itself last wrote (D12)
  let lastOpen = { kind: null, openDecisions: [] };
  let disposed = false;

  const say = (t) => { try { announce?.(t); } catch { /* an announcement never breaks the view */ } };
  const tell = () => { try { onState?.(state); } catch { /* a host bug never breaks the view */ } };
  const focusField = () => { try { field.focus?.(); } catch { /* a field without focus */ } };
  const act = (name) => el.querySelector(`[${ACT}="${name}"]`);

  function render(html) {
    el.replaceChildren(toElement(doc, html));
  }

  function abort() {
    if (ctl) { ctl.abort(); ctl = null; }
    latestId = null;
  }

  function paintBusy(kind) {
    state = 'busy';
    render(rewriteSuggestion({ kind: KIND_LABELS[kind] || '', state: 'busy', actions: { busy: { [ACT]: 'busy' } } }));
    act('busy')?.focus();   // before the host disables Improve: focus is never lost to <body>
    tell();
  }

  function paintReady(r) {
    state = 'ready';
    reply = r;
    const sections = Array.isArray(r.rewrite?.sections) ? r.rewrite.sections : [];
    const notInRepo = (Array.isArray(r.paths) ? r.paths : []).filter((p) => p && p.inRepo !== true).map((p) => String(p.path ?? ''));
    render(rewriteSuggestion({
      kind: KIND_LABELS[r.kind] || '', state: 'ready', sections, notInRepo, model: typeof r.model === 'string' ? r.model : '',
      actions: { use: { [ACT]: 'use' }, keep: { [ACT]: 'keep' } },
    }));
    act('use').addEventListener('click', useThis);
    act('keep').addEventListener('click', keepMine);
    tell();
    act('use').focus();
    say('Suggested rewrite ready');
  }

  function paintFailed(kind, reason, model) {
    state = 'failed';
    reply = null;
    const retry = NO_RETRY.has(reason) ? null : { [ACT]: 'retry' };
    render(rewriteSuggestion({ kind: KIND_LABELS[kind] || '', state: 'failed', model: typeof model === 'string' ? model : '', fail: { reason, retry } }));
    const note = el.querySelector('.pd-fail');
    const again = act('retry');
    if (again) again.addEventListener('click', () => open(lastOpen.kind, lastOpen.openDecisions));
    tell();
    (again || note)?.focus();
    say((note?.textContent || '').replace(/\s*Try again$/, ''));
  }

  function paintUsed() {
    state = 'used';
    render(rewriteSuggestion({ kind: '', state: 'used', actions: { undo: { [ACT]: 'undo' } } }));
    act('undo').addEventListener('click', undo);
    tell();
  }

  function write(text) {
    selfWrite = text;
    field.write(text);
  }

  function useThis() {
    if (state !== 'ready' || !reply) return;
    const text = typeof reply.text === 'string' ? reply.text : '';
    before = field.read();
    paintUsed();
    write(text);
    focusField();
  }

  function undo() {
    if (state !== 'used' || before === null) return;
    const t = before;
    close();
    write(t);
    focusField();
  }

  function keepMine() {
    close();
    focusField();
  }

  function open(kind, openDecisions = []) {
    if (disposed || state === 'busy') return;
    const text = String(field.read() ?? '');
    if (!text.trim() || !KIND_LABELS[kind]) return;
    abort();
    lastOpen = { kind, openDecisions: Array.isArray(openDecisions) ? [...openDecisions] : [] };
    const requestId = `improve-${surface.kind}-${++seq}`;
    latestId = requestId;
    const mine = new AbortController();
    ctl = mine;
    const e = valueOf(engine);
    const cm = valueOf(chatModel);
    const body = {
      requestId, surface, text, kind, openDecisions: lastOpen.openDecisions.slice(0, 6),
      ...projectFields(valueOf(project)),
      ...(typeof e === 'string' && e ? { engine: e } : {}),
      ...(typeof cm === 'string' && cm ? { chatModel: cm } : {}),
    };
    paintBusy(kind);
    const live = () => !disposed && latestId === requestId && state === 'busy';
    let sent;
    try {
      sent = Promise.resolve(fetchImpl(URL_IMPROVE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: mine.signal }));
    } catch (err) { sent = Promise.reject(err); }
    sent
      .then(async (r) => {
        if (!live()) return;
        const out = await r.json().catch(() => null);
        if (!live()) return;
        if (!r.ok || !out || typeof out !== 'object' || out.requestId !== requestId) { paintFailed(kind, 'model call failed', null); return; }
        // live() holds, so this IS the latest request: a superseded answer must not leave the view in Busy.
        if (out.source === 'superseded') { paintFailed(kind, 'model call failed', null); return; }
        if (out.source === 'failed') { paintFailed(kind, out.error, out.model); return; }
        if ((out.source === 'model' || out.source === 'mock') && typeof out.text === 'string') { paintReady(out); return; }
        paintFailed(kind, 'unreadable reply', out.model);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || !live()) return;
        paintFailed(kind, 'model call failed', null);
      })
      .finally(() => { if (ctl === mine) ctl = null; });
  }

  function close() {
    abort();
    reply = null;
    before = null;
    if (state === 'hidden') return;
    state = 'hidden';
    el.replaceChildren();
    tell();
  }

  return {
    el,
    state: () => state,
    open,
    close,
    /** The field's text changed (the surface's input path). The view's own write is not an edit (D12). */
    fieldEdited(text) {
      const t = String(text ?? '');
      if (selfWrite !== null && t === selfWrite) return;
      selfWrite = null;
      if (state === 'used' || state === 'failed') close();
    },
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
    },
  };
}
