// ui/public/spec-builder.mjs — the Spec Builder pane (docs/spec-builder.md): one idea field → a draft on a pinned Ask
// thread, followed inline (form → drafting → questions → output | failed). Pure DOM; every I/O is injected
// (api, thread, storage, timers, renderMarkdown), so jsdom tests drive it with stubs.
import { ROLES, SECTIONS, roleByKey, ownersOf } from '../../src/shared/spec-builder/roles.mjs';
import { SPEC_KINDS, SPEC_SIZES, SPEC_FLAG_STAGES, parseWorcaFrontMatter, withWaiver } from '../../src/shared/spec-builder/front-matter.mjs';
import { checkShape, REPO_PATH_RE } from '../../src/shared/spec-builder/shape.mjs';
import { answersMessage, fixMessage } from '../../src/shared/spec-builder/messages.mjs';
import { createThreadModel } from './ask-model.mjs';

export const DEFAULT_ROLES = Object.freeze(['product', 'architect', 'qa']);
export const SUGGEST_DEBOUNCE_MS = 1000;
export const SUGGEST_MIN_CHARS = 12;
export const IDEA_ROWS = 8;
export const IDEA_MAX_ROWS = 16;
export const DRAFTS_KEY = 'worca-cc.specBuilder.drafts';
const KIND_LABEL = Object.freeze({ feature: 'Feature', fix: 'Fix', refactor: 'Refactor', infra: 'Infrastructure', docs: 'Docs' });
const SIZE_LABEL = Object.freeze({ small: 'Small', medium: 'Medium', large: 'Large' });
const STAGE_LABEL = Object.freeze({ clarify: 'Clarify', planner: 'Plan', refiner: 'Refine', implementer: 'Implement', reviewer: 'Review', manualTestsChecklist: 'Manual checklist', manualWebUiTesting: 'Web UI testing' });
const SKIPPABLE = Object.freeze(['clarify', 'planner', 'refiner']);
const SPEC_CARD_TYPES = new Set(['spec', 'spec-questions']);
const TERMINAL_STATUS = new Set(['done', 'stopped', 'error']);   // ask-model row statuses that end a turn
const SECTION_KEYS = new Map(SECTIONS.map((s) => [s.title.toLowerCase(), s.key]));

/** R22: the new card's markdown with every waiver from `prevMd` re-applied whose check still fails on it. */
export function carryWaivers(prevMd, nextMd, grounding) {
  const prev = parseWorcaFrontMatter(String(prevMd || ''));
  const waivers = prev && prev.ok ? prev.fm.shapeWaived || [] : [];
  if (!waivers.length) return nextMd;
  const failing = new Set(checkShape(nextMd, { grounding }).items.filter((i) => !i.pass).map((i) => i.id));
  return waivers.filter((w) => failing.has(w.id)).reduce((md, w) => withWaiver(md, w.id, w.reason), nextMd);
}

const usd = (n) => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;
const mins = (ms) => `${Math.max(1, Math.round(ms / 60_000))} min`;
/** One line, shared with the Ask spec card (unchanged from v1). */
export function estimateSummary(e) {
  if (!e) return '';
  const basis = e.basis === 'rough' ? 'Rough estimate' : `Based on ${e.samples}+ past runs${e.basis === 'mixed' ? ' (some stages rough)' : ''}`;
  return `${usd(e.low)}–${usd(e.high)} · ${mins(e.ms)}–${mins(e.msHigh)} · ${basis}`;
}

/** One line, shared with the Ask spec card: "Shape ✓ 8 of 8" or "Shape 7 of 8 · to fix: …". */
export function shapeSummary(shape) {
  const open = shape.items.filter((i) => !i.pass && !i.waived);
  const waived = shape.items.filter((i) => i.waived).length;
  const tail = waived ? ` · ${waived} waived` : '';
  return open.length ? `Shape ${shape.passed} of ${shape.total} · to fix: ${open.map((i) => i.label).join('; ')}${tail}`
    : `Shape ✓ ${shape.passed} of ${shape.total}${tail}`;
}

/** V1: Reshape when the input already looks like a document. */
export function isReshape(idea, origin = 'typed') {
  if (origin === 'file' || origin === 'task') return true;
  const t = String(idea || '');
  return /^#{1,6}[ \t]+\S/m.test(t) || /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/m.test(t) || t.split('\n').length > 25;
}

const repoTail = (p) => /(?:^|\/)((?:src|ui|test|docs)\/.+)$/.exec(String(p || ''))?.[1] || String(p || '').split('/').slice(-2).join('/');
/** R4: the live turn's last tool call as an activity line, else its label. null when nothing is live. */
export function activityLine(model) {
  const live = model && model.live();
  if (!live) return null;
  const row = model.messages().find((r) => r.id === live.messageId);
  const tools = (row?.blocks || []).filter((b) => b && b.kind === 'tool');
  const t = tools[tools.length - 1];
  const i = t?.input || {};
  if (t && t.status !== 'done' && t.status !== 'error') {
    if (t.name === 'Read' && i.file_path) return `Reading ${repoTail(i.file_path)}…`;
    if (t.name === 'Grep' && i.pattern) return `Searching for ${String(i.pattern).slice(0, 60)}…`;
    if (t.name === 'Glob' && i.pattern) return `Listing ${String(i.pattern).slice(0, 60)}…`;
  }
  return `${live.label || 'Thinking'}…`;
}

/** V19: what a finished (not in-flight) thread shows. `messages` are the ask-model rows. A live `ask-error` sets
 *  `errorMessage`; a reloaded row has no error field, only its `notice` blocks (R17). */
export function deriveDraftState(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  let u = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].role === 'user') { u = i; break; }
  if (u < 0) return { view: 'form' };
  const retryText = rows[u].text || '';
  const reply = rows.slice(u + 1).reverse().find((m) => m.role === 'assistant');
  if (!reply) return { view: 'failed', error: 'The draft did not finish.', retryText };
  const blocks = Array.isArray(reply.blocks) ? reply.blocks : [];
  const notice = blocks.filter((b) => b && b.kind === 'notice' && b.text).pop()?.text || '';
  if (reply.status === 'error') return { view: 'failed', error: reply.errorMessage || notice || 'Ask Worca stopped with an error.', retryText };
  const block = blocks.filter((b) => b && b.kind === 'card' && b.card && SPEC_CARD_TYPES.has(b.card.type)).pop();
  // R24: a turn stopped by max_turns/max_budget may already hold the spec
  if (block) return { view: block.card.type === 'spec' ? 'output' : 'questions', cardId: block.id, card: block.card };
  if (reply.status === 'stopped') return { view: 'failed', error: 'Stopped.', retryText };
  return { view: 'failed', error: notice || 'Ask Worca finished without a spec.', retryText };
}

export function readDrafts(storage) {
  try { const v = JSON.parse(storage.getItem(DRAFTS_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
export function writeDraft(storage, projectKey, draft) {
  if (!projectKey) return;
  try {
    const all = readDrafts(storage);
    if (draft) all[projectKey] = draft; else delete all[projectKey];
    storage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch { /* storage full or blocked: the draft lives until reload */ }
}

const blankDraft = () => ({ threadId: null, projectKey: null, idea: '', origin: 'typed', roles: [...DEFAULT_ROLES], rolesTouched: false, rolesShown: false,
  suggested: false, reasons: {}, kind: 'feature', size: 'medium', kindTouched: false, sizeTouched: false, flag: null,
  editing: false, outputCardId: null, outputMarkdown: null });
const PERSISTED = ['threadId', 'projectKey', 'idea', 'origin', 'roles', 'rolesTouched', 'kind', 'size', 'kindTouched', 'sizeTouched', 'flag', 'editing', 'outputCardId', 'outputMarkdown'];

/** The form fields a draft typed with no project hands to the project picked next. */
const CARRIED = ['idea', 'origin', 'roles', 'rolesTouched', 'reasons', 'suggested', 'kind', 'size', 'kindTouched', 'sizeTouched', 'flag'];

function h(doc, tag, cls, text) { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function button(doc, cls, text, hook, value = '') { const b = h(doc, 'button', `btn ${cls}`, text); b.type = 'button'; if (hook) b.setAttribute(hook, value); return b; }

/**
 * @param {{doc?:Document, storage:Storage, timers?:{setTimeout,clearTimeout},
 *   project:()=>({key:string,name:string,dir:string}|null),
 *   api:{suggest:(idea)=>Promise<object>, prompt:(answers)=>Promise<{text,title,projectKey,projectName}>,
 *        save:(b)=>Promise<{ok:true,path}|{ok:false,status,error,suggestion}>},
 *   thread:ReturnType<import('./spec-builder-thread.mjs').createSpecThreadClient>,
 *   renderMarkdown:(text)=>({kind:'md',frag:DocumentFragment}|{kind:'plain'}), markdownReady?:()=>Promise<boolean>,
 *   taskSources?:()=>Array<{key,label}>, taskBrowser?:(key)=>Promise<{el:HTMLElement, take:()=>Promise<string>}|null>,
 *   onUse:(spec:{markdown,projectKey,projectDir})=>void, onContinue:(threadId)=>void}} deps
 *   taskBrowser is async (R11): it awaits resolveSourceProfile, and answers null for a gated or unresolvable source.
 */
export function createSpecBuilder({ doc = globalThis.document, storage, timers = globalThis, project, api, thread, renderMarkdown,
  markdownReady = async () => true, taskSources = () => [], taskBrowser = async () => null, onUse, onContinue }) {
  const root = h(doc, 'div', 'sb-pane');
  root.setAttribute('data-spec-builder-pane', '');
  let projectKey = null;
  let draft = blankDraft();
  let view = 'form';
  let model = null;
  let sending = false;         // a turn was asked for and its first frame (or a snapshot) has not answered yet
  let posting = false;         // only while the message POST is awaited (R20)
  let loading = null;          // R23: the model whose snapshot is loading; frames wait for the subscribe replay
  let starting = false;        // Draft spec clicked and not yet posted: a second click is ignored (no disabled buttons)
  let shown = null;            // { cardId, card } in the questions/output views
  let failure = null;          // { error, retryText }
  let note = '';
  let changeOpen = false;
  let mdView = 'rendered';
  let answers = {};
  let suggestTimer = null;
  let suggestTicket = 0;
  let lastAsked = '';
  let activityEl = null;
  let attached = false;        // R19: attach(key) is a no-op for the key already attached
  let mdKicked = false;        // R18: the lazy Markdown bundle is requested once

  const persist = () => writeDraft(storage, projectKey, Object.fromEntries(PERSISTED.map((k) => [k, draft[k]])));
  const err = (box, msg) => { box.textContent = msg || ''; box.hidden = !msg; };

  // ── following the thread ──────────────────────────────────────────────────────────
  async function follow(threadId) {
    const m = createThreadModel({ threadId });
    model = m; loading = m;               // R23: pushFrame/settle wait; the subscribe below replays the job's frames
    let snap;
    try { snap = await thread.load(threadId); } catch (e) { if (model === m) { loading = null; failure = { error: e.message, retryText: null }; setView('failed'); } return; }
    if (model !== m) return;
    loading = null;
    if (snap === null) return threadGone();
    m.load(snap);
    if (!posting) sending = false;          // R20: the snapshot's inFlight is the truth about a running turn
    thread.subscribe(threadId);
    settle();
  }
  function threadGone() {
    model = null; sending = false; draft.threadId = null; draft.editing = false; persist();
    note = 'The draft\'s chat was deleted. Your idea is kept.';
    setView('form');
  }
  /** R23: a turn is running while we sent and heard nothing, a turn is live, or the snapshot's inFlight names a row
   *  that is not terminal yet. A snapshot can be stored 'done' while inFlight still names it (turn.mjs stores the row
   *  before ask-done), and the model then drops that ask-done as terminal-message: a bare inFlight would never clear. */
  function busy() {
    if (sending || model.live()) return true;
    const f = model.inFlight();
    if (!f) return false;
    const row = model.messages().find((r) => r.id === f.messageId);
    return !row || !TERMINAL_STATUS.has(row.status);
  }
  function settle() {
    if (!model || loading || draft.editing) return;      // R20: Edit input owns the screen; R23: a snapshot is loading
    if (busy()) {
      if (view === 'drafting' && activityEl) { activityEl.textContent = activityLine(model) || 'Starting…'; return; }
      return setView('drafting');
    }
    const d = deriveDraftState(model.messages());
    if (d.view === 'failed') {
      if (view === 'failed' && failure && failure.error === d.error) return;   // R20: same failure already shown
      failure = { error: d.error, retryText: d.retryText }; return setView('failed');
    }
    if (d.view === 'form') return view === 'form' ? undefined : setView('form');
    if (view === d.view && shown && shown.cardId === d.cardId) return;        // R20: never rebuild what is on screen
    if (!shown || shown.cardId !== d.cardId) {
      shown = { cardId: d.cardId, card: d.card };
      answers = {};
      if (d.view === 'output' && draft.outputCardId !== d.cardId) {
        // R22: the Fix's new spec keeps the waivers whose checks still fail
        const g = Array.isArray(d.card.grounding) ? d.card.grounding : null;
        draft.outputMarkdown = carryWaivers(draft.outputMarkdown, d.card.markdown, g);
        draft.outputCardId = d.cardId; persist();
      }
    }
    setView(d.view);
  }
  async function send(text) {
    const key = shown?.card?.projectKey || draft.projectKey || project()?.key;
    const m = model;
    sending = true; posting = true; failure = null; setView('drafting');
    try {
      const userMessageId = (await thread.send(draft.threadId, text, key))?.userMessageId;
      // The user row normally arrives as the POST's ask-message broadcast; echo it so deriveDraftState and Try again
      // never depend on that frame's timing (the panel does the same, ask-model.mjs noteLocalUserMessage).
      if (userMessageId && m && model === m) m.noteLocalUserMessage({ id: userMessageId, text });
    } catch (e) {
      if (e && e.status === 404) { posting = false; return threadGone(); }   // R26: deleted in Ask; DELETE broadcasts nothing
      sending = false; failure = { error: e.message || 'Ask Worca could not take the message.', retryText: text }; setView('failed');
    } finally { posting = false; }
  }
  async function startDraft(errBox) {
    if (starting) return;
    if (!draft.idea.trim()) return err(errBox, 'Describe the idea first');
    const p = project();
    if (!p) return err(errBox, 'Select a project first.');
    const mode = isReshape(draft.idea, draft.origin) ? 'reshape' : 'draft';
    starting = true;
    timers.clearTimeout(suggestTimer); suggestTicket += 1;     // a late suggestion must not change the roles being drafted
    try {
      const prep = await api.prompt({ idea: draft.idea, mode, roles: draft.roles, kind: draft.kind, size: draft.size, flag: draft.flag });
      const id = await thread.create(prep.title);
      // prep.projectKey is the server-resolved key (/prompt resolves projectDir); it pins every message on this thread
      Object.assign(draft, { threadId: id, projectKey: prep.projectKey || p.key, editing: false, outputCardId: null, outputMarkdown: null });
      shown = null; persist();
      model = createThreadModel({ threadId: id }); loading = null;
      model.load({ thread: { id }, messages: [], attachments: [], runLinks: [], inFlight: null });
      thread.subscribe(id);
      await send(prep.text);
    } catch (e) { err(errBox, e.message || 'Could not start the draft'); }
    finally { starting = false; }
  }

  // ── suggestion (V2/V3) ────────────────────────────────────────────────────────────
  function scheduleSuggest(paint) {
    timers.clearTimeout(suggestTimer);
    const idea = draft.idea.trim();
    if (idea.length < SUGGEST_MIN_CHARS || idea === lastAsked) return;
    suggestTimer = timers.setTimeout(async () => {
      lastAsked = idea;
      const ticket = ++suggestTicket;
      let s = null;
      try { s = await api.suggest(draft.idea); } catch { s = null; }
      if (ticket !== suggestTicket) return;
      draft.rolesShown = true;
      draft.suggested = !!s && s.source !== 'default';
      const pick = s || { roles: [...DEFAULT_ROLES], kind: draft.kind, size: draft.size, reasons: {} };
      if (!draft.rolesTouched) { draft.roles = pick.roles; draft.reasons = pick.reasons || {}; }
      if (!draft.kindTouched) draft.kind = pick.kind;
      if (!draft.sizeTouched) draft.size = pick.size;
      persist(); paint();
    }, SUGGEST_DEBOUNCE_MS);
  }

  function setView(v) { view = v; render(); }

  function formView() {
    const wrap = h(doc, 'div', 'sb-form');
    const errBox = h(doc, 'div', 'field-error'); errBox.setAttribute('data-sb-error', ''); errBox.setAttribute('role', 'alert'); errBox.hidden = true;
    if (note) wrap.appendChild(h(doc, 'small', 'hint warn', note));
    // Your idea + Load .md + From a task source. The label stays a DIRECT child of .field (§6.7, R15): the tools sit in
    // a sibling .sb-idea-tools that the .sb-idea grid places beside it.
    const field = h(doc, 'div', 'field field-compact sb-idea');
    const tools = h(doc, 'div', 'sb-idea-tools');
    const label = h(doc, 'label', '', 'Your idea');
    const idea = h(doc, 'textarea', 'textarea sb-idea-input');
    idea.id = 'sb-idea'; label.htmlFor = 'sb-idea';
    idea.rows = IDEA_ROWS; idea.value = draft.idea;
    idea.placeholder = 'A sentence, rough notes, a pasted issue or a half-written spec. Worca turns it into a spec grounded in this repo.';
    idea.setAttribute('data-sb-idea', '');
    const file = h(doc, 'input'); file.type = 'file'; file.accept = '.md,.markdown,text/markdown'; file.hidden = true; file.setAttribute('data-sb-file', '');
    const load = button(doc, 'btn-ghost btn-mini', 'Load .md', 'data-sb-load');
    load.addEventListener('click', () => file.click());
    const setIdea = (text, origin) => { draft.idea = text; draft.origin = origin; idea.value = text; grow(); onIdea(); };
    file.addEventListener('change', async () => { const f = file.files && file.files[0]; if (f) setIdea(await f.text(), 'file'); file.value = ''; });
    idea.addEventListener('drop', async (e) => {
      const f = e.dataTransfer && [...(e.dataTransfer.files || [])].find((x) => /\.(md|markdown)$/i.test(x.name));
      if (!f) return;                                 // plain text drops fall through to the textarea
      e.preventDefault(); setIdea(await f.text(), 'file');
    });
    tools.append(load, file);
    const sources = taskSources();
    const browserHost = h(doc, 'div', 'sb-task-browser'); browserHost.hidden = true;
    if (sources.length) {
      const sel = h(doc, 'select', 'select sb-source-select');
      sel.setAttribute('data-sb-source', ''); sel.setAttribute('aria-label', 'From a task source');
      sel.append(Object.assign(h(doc, 'option', '', 'From a task source'), { value: '' }), ...sources.map((s) => Object.assign(h(doc, 'option', '', s.label), { value: s.key })));
      let pickTicket = 0;
      sel.addEventListener('change', async () => {
        const ticket = ++pickTicket;
        const key = sel.value;
        browserHost.replaceChildren(); browserHost.hidden = !key;
        if (!key) return;
        browserHost.appendChild(h(doc, 'small', 'hint', 'Loading…'));
        let b = null;
        try { b = await taskBrowser(key); } catch { b = null; }          // R11: async; a throw is "not set up" too
        if (ticket !== pickTicket) return;                                // a newer pick won
        browserHost.replaceChildren();
        if (!b) { browserHost.appendChild(h(doc, 'small', 'hint', 'Set up this source in its own pane first.')); return; }
        const use = button(doc, 'btn-ghost btn-mini', 'Use this task', 'data-sb-task-use');
        use.addEventListener('click', async () => {
          try { setIdea(await b.take(), 'task'); browserHost.hidden = true; sel.value = ''; } catch (e) { err(errBox, e.message); }
        });
        browserHost.append(b.el, use);
      });
      tools.appendChild(sel);
    }
    const grow = () => { idea.rows = Math.min(IDEA_MAX_ROWS, Math.max(IDEA_ROWS, idea.value.split('\n').length)); };
    grow();
    const reshapeNote = h(doc, 'small', 'hint', "We'll keep your decisions and fill the gaps.");
    reshapeNote.setAttribute('data-sb-reshape-note', '');
    field.append(label, tools, browserHost, idea, reshapeNote);

    // Roles + summary line + Change
    const roles = h(doc, 'div', 'field field-compact sb-roles');
    const rolesLabel = h(doc, 'label', '', 'Roles');
    const chips = h(doc, 'div', 'sb-chips'); chips.setAttribute('data-sb-roles', '');
    const line = h(doc, 'div', 'sb-line'); line.setAttribute('data-sb-line', '');
    const change = h(doc, 'div', 'sb-change'); change.hidden = !changeOpen;
    roles.append(rolesLabel, chips, line, change);

    const go = button(doc, 'btn-primary sb-draft', '', 'data-sb-draft');
    go.addEventListener('click', () => startDraft(errBox));

    function paint() {
      const reshape = isReshape(draft.idea, draft.origin);
      go.textContent = reshape ? '✦ Reshape into spec' : '✦ Draft spec';
      reshapeNote.hidden = !reshape;
      chips.replaceChildren();
      if (!draft.rolesShown && !draft.rolesTouched) chips.appendChild(h(doc, 'small', 'hint', 'Roles appear as you type'));
      else {
        if (draft.suggested && !draft.rolesTouched) { const s = h(doc, 'small', 'hint sb-suggested', 'Suggested'); s.setAttribute('data-sb-suggested', ''); chips.appendChild(s); }
        for (const r of ROLES) {
          const on = draft.roles.includes(r.key);
          if (r.locked) { const c = h(doc, 'span', 'chip sb-chip on sb-locked', `🔒 ${r.label}`); c.title = 'Product is always on'; c.setAttribute('data-sb-role', r.key); chips.appendChild(c); continue; }
          const c = button(doc, `btn-mini sb-chip${on ? ' on' : ''}`, r.label, 'data-sb-role', r.key);
          c.setAttribute('aria-pressed', String(on));
          c.title = draft.reasons[r.key] || r.help;
          c.addEventListener('click', () => {
            draft.rolesTouched = true; draft.rolesShown = true;
            draft.roles = on ? draft.roles.filter((k) => k !== r.key) : [...draft.roles, r.key];
            persist(); paint();
          });
          chips.appendChild(c);
        }
      }
      line.replaceChildren(doc.createTextNode(`${KIND_LABEL[draft.kind]} · ${draft.size} · ${draft.flag ? `flag ${draft.flag.key}` : 'no flag'} · `));
      const ch = button(doc, 'btn-ghost btn-mini', changeOpen ? 'Done' : 'Change', 'data-sb-change');
      ch.addEventListener('click', () => { changeOpen = !changeOpen; change.hidden = !changeOpen; paintChange(); paint(); });
      line.appendChild(ch);
    }
    function seg(values, labels, current, hook, onPick) {
      const s = h(doc, 'div', 'seg seg-sm');
      for (const v of values) {
        const b = h(doc, 'button', current === v ? 'on' : '', labels[v]); b.type = 'button';
        b.setAttribute(hook, v); b.setAttribute('aria-pressed', String(current === v));
        b.addEventListener('click', () => { onPick(v); persist(); paintChange(); paint(); });
        s.appendChild(b);
      }
      return s;
    }
    function paintChange() {
      change.replaceChildren();
      if (!changeOpen) return;
      const k = h(doc, 'div', 'field field-compact'); k.append(h(doc, 'label', '', 'Kind'), seg(SPEC_KINDS, KIND_LABEL, draft.kind, 'data-sb-kind', (v) => { draft.kind = v; draft.kindTouched = true; }));
      const z = h(doc, 'div', 'field field-compact'); z.append(h(doc, 'label', '', 'Size'), seg(SPEC_SIZES, SIZE_LABEL, draft.size, 'data-sb-size', (v) => { draft.size = v; draft.sizeTouched = true; }));
      const f = h(doc, 'div', 'field field-compact');
      const key = h(doc, 'input', 'input'); Object.assign(key, { type: 'text', value: draft.flag?.key || '', placeholder: 'camelCase key (optional)' }); key.setAttribute('data-sb-flag-key', '');
      const stage = h(doc, 'select', 'select'); for (const s of SPEC_FLAG_STAGES) stage.appendChild(Object.assign(h(doc, 'option', '', s[0].toUpperCase() + s.slice(1)), { value: s }));
      stage.value = draft.flag?.stage || 'beta'; stage.setAttribute('data-sb-flag-stage', '');
      const sync = () => { draft.flag = key.value.trim() ? { key: key.value.trim(), stage: stage.value } : null; persist(); paint(); };
      key.addEventListener('input', sync); stage.addEventListener('change', sync);
      f.append(h(doc, 'label', '', 'Feature flag'), key, stage);
      change.append(k, z, f);
    }
    function onIdea() { note = ''; err(errBox, ''); persist(); paint(); scheduleSuggest(paint); }
    idea.addEventListener('input', () => { draft.idea = idea.value; grow(); onIdea(); });
    paint(); paintChange();
    const actions = h(doc, 'div', 'sb-actions'); actions.appendChild(go);
    wrap.append(field, roles, errBox, actions);
    return wrap;
  }

  function summaryHead() {           // V3.2: the input collapses to a two-line summary with the role chips
    const s = h(doc, 'div', 'sb-collapsed');
    s.append(h(doc, 'p', 'sb-collapsed-idea', draft.idea), h(doc, 'small', 'hint', draft.roles.map((k) => roleByKey(k)?.label || k).join(' · ')));
    return s;
  }
  function draftingView() {
    const wrap = h(doc, 'div', 'sb-drafting-view');
    const panel = h(doc, 'div', 'sb-progress'); panel.setAttribute('data-sb-progress', '');
    activityEl = h(doc, 'div', 'sb-activity', (model && activityLine(model)) || 'Starting…'); activityEl.setAttribute('data-sb-activity', ''); activityEl.setAttribute('aria-live', 'polite');
    panel.append(activityEl, h(doc, 'div', 'sb-bar'));
    const stop = button(doc, 'btn-ghost btn-mini', 'Stop', 'data-sb-stop');
    stop.addEventListener('click', () => { if (draft.threadId) thread.stop(draft.threadId); });
    const cont = button(doc, 'btn-ghost btn-mini', 'Continue in Ask Worca', 'data-sb-continue');
    cont.addEventListener('click', () => draft.threadId && onContinue(draft.threadId));
    const actions = h(doc, 'div', 'sb-actions'); actions.append(stop, cont);
    wrap.append(summaryHead(), panel, actions);
    return wrap;
  }
  function questionsView() {
    const qs = shown.card.questions || [];
    const wrap = h(doc, 'div', 'sb-questions');
    const errBox = h(doc, 'div', 'field-error'); errBox.hidden = true; errBox.setAttribute('role', 'alert');
    const count = h(doc, 'small', 'hint sb-qcount'); count.setAttribute('data-sb-qcount', '');
    const recount = () => { count.textContent = `${qs.filter((q) => String(answers[q.id] || '').trim()).length} of ${qs.length} answered`; };
    wrap.appendChild(summaryHead());
    for (const q of qs) {
      const box = h(doc, 'fieldset', 'sb-q'); box.setAttribute('data-sb-question', q.id);
      box.appendChild(h(doc, 'legend', '', q.text));
      const row = h(doc, 'div', 'sb-chips');
      const other = h(doc, 'input', 'input sb-other'); other.type = 'text'; other.hidden = true; other.placeholder = 'Your answer'; other.setAttribute('data-sb-other', '');
      const paintQ = () => { for (const b of row.querySelectorAll('button')) { const on = b.dataset.sbOption === answers[q.id] || (b.dataset.sbOption === '' && !other.hidden); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } recount(); };
      for (const opt of [...q.options, '']) {
        const b = button(doc, 'btn-mini sb-chip', opt || 'Other…', 'data-sb-option', opt);
        b.addEventListener('click', () => { other.hidden = opt !== ''; answers[q.id] = opt || other.value; if (!other.hidden) other.focus(); paintQ(); });
        row.appendChild(b);
      }
      other.addEventListener('input', () => { answers[q.id] = other.value; recount(); });
      // a kept answer that is not one of the options was typed under "Other…": show it there
      if (answers[q.id] != null && !q.options.includes(answers[q.id])) { other.hidden = false; other.value = answers[q.id]; }
      paintQ();
      box.append(row, other, h(doc, 'small', 'hint', `Why it's asking: ${q.why}`));
      wrap.appendChild(box);
    }
    recount();
    const sendBtn = button(doc, 'btn-primary', 'Send answers', 'data-sb-send-answers');
    sendBtn.addEventListener('click', () => {
      if (qs.some((q) => !String(answers[q.id] || '').trim())) return err(errBox, 'Answer every question first');
      send(answersMessage(qs, answers));
    });
    const actions = h(doc, 'div', 'sb-actions'); actions.append(count, sendBtn);
    wrap.append(errBox, actions);
    return wrap;
  }
  function failedView() {
    const wrap = h(doc, 'div', 'sb-failed'); wrap.setAttribute('data-sb-failed', '');
    wrap.append(summaryHead(), h(doc, 'div', 'field-error', failure?.error || 'The draft failed.'));
    const actions = h(doc, 'div', 'sb-actions');
    const edit = button(doc, 'btn-ghost', 'Edit input', 'data-sb-edit');
    edit.addEventListener('click', editInput);
    actions.appendChild(edit);
    if (draft.threadId) {
      const cont = button(doc, 'btn-ghost', 'Continue in Ask Worca', 'data-sb-continue');
      cont.addEventListener('click', () => onContinue(draft.threadId));
      actions.appendChild(cont);
    }
    if (failure?.retryText && draft.threadId) {
      const retry = button(doc, 'btn-primary', 'Try again', 'data-sb-retry');
      retry.addEventListener('click', () => send(failure.retryText));
      actions.appendChild(retry);
    }
    wrap.appendChild(actions);
    return wrap;
  }
  // Edit input: settle() ignores the old thread from here on (R20); Draft spec starts a new thread
  function editInput() { draft.editing = true; persist(); setView('form'); }

  function outputView() {
    const card = shown.card;
    const md = draft.outputMarkdown || card.markdown;
    const parsed = parseWorcaFrontMatter(md);
    const fm = parsed && parsed.ok ? parsed.fm : card.frontMatter || {};
    const body = parsed ? parsed.body : md;
    const shape = checkShape(md, { grounding: Array.isArray(card.grounding) ? card.grounding : null });
    const wrap = h(doc, 'div', 'sb-output');
    // header: path + Rendered | Markdown
    const head = h(doc, 'div', 'sb-out-head');
    const pathEl = h(doc, 'code', 'sb-path', card.path || 'plans/…-design.md'); pathEl.setAttribute('data-sb-path', '');
    const viewSeg = h(doc, 'div', 'seg seg-sm');
    for (const [v, label] of [['rendered', 'Rendered'], ['markdown', 'Markdown']]) {
      const b = h(doc, 'button', mdView === v ? 'on' : '', label); b.type = 'button'; b.setAttribute('data-sb-view', v); b.setAttribute('aria-pressed', String(mdView === v));
      b.addEventListener('click', () => { mdView = v; render(); });
      viewSeg.appendChild(b);
    }
    head.append(pathEl, viewSeg);
    // preview (built first so the shape row can jump into it)
    const preview = h(doc, 'div', 'sb-preview'); preview.setAttribute('data-sb-preview', '');
    const failingSections = new Set(shape.items.filter((i) => !i.pass && !i.waived && i.section).map((i) => i.section));
    const r = mdView === 'rendered' ? renderMarkdown(body) : { kind: 'plain' };
    if (r.kind === 'md') { preview.classList.add('artifact-markdown'); preview.appendChild(r.frag); decorate(preview, fm.roles || [], card.grounding || [], failingSections); }
    else preview.appendChild(h(doc, 'pre', 'sb-md', mdView === 'rendered' ? body : md));
    if (r.kind !== 'md' && mdView === 'rendered' && !mdKicked) {      // R18: the bundle loads lazily; repaint once it can render
      mdKicked = true;
      markdownReady().then((ok) => { if (ok && view === 'output') render(); }, () => {});
    }
    // shape row
    const shapeBox = h(doc, 'div', `sb-shape${shape.ok ? ' ok' : ''}`); shapeBox.setAttribute('data-sb-shape', shape.ok ? 'ok' : 'fail');
    shapeBox.appendChild(h(doc, 'strong', '', shapeSummary(shape).split(' · to fix')[0]));
    const open = shape.items.filter((i) => !i.pass && !i.waived);
    for (const it of open) {
      const row = h(doc, 'div', 'sb-shape-item'); row.setAttribute('data-sb-shape-item', it.id);
      const jump = button(doc, 'btn-ghost btn-mini', it.label, 'data-sb-jump', it.id);
      jump.addEventListener('click', () => preview.querySelector(`[data-sb-section="${it.section}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
      const fix = button(doc, 'btn-ghost btn-mini', 'Fix', 'data-sb-fix', it.id);
      fix.addEventListener('click', () => send(fixMessage([it])));
      row.append(jump, h(doc, 'small', 'hint', it.detail), fix);
      if (it.waivable) {
        const ign = button(doc, 'btn-ghost btn-mini', 'Ignore for this spec', 'data-sb-waive', it.id);
        ign.addEventListener('click', () => {
          const reason = h(doc, 'input', 'input sb-waive-reason'); Object.assign(reason, { type: 'text', placeholder: 'Why (one line)', maxLength: 200 }); reason.setAttribute('data-sb-waive-reason', it.id);
          const ok = button(doc, 'btn-ghost btn-mini', 'Ignore', 'data-sb-waive-ok', it.id);
          const e = h(doc, 'div', 'field-error'); e.hidden = true;
          ok.addEventListener('click', () => {
            if (!reason.value.trim()) return err(e, 'Give a one-line reason');
            draft.outputMarkdown = withWaiver(md, it.id, reason.value.trim()); persist(); render();
          });
          ign.replaceWith(reason, ok, e); reason.focus();
        });
        row.appendChild(ign);
      }
      shapeBox.appendChild(row);
    }
    if (open.length) { const all = button(doc, 'btn-ghost btn-mini', 'Fix all', 'data-sb-fix-all'); all.addEventListener('click', () => send(fixMessage(open))); shapeBox.appendChild(all); }
    // summary card (V4, V17)
    const sum = h(doc, 'div', 'sb-sum'); sum.setAttribute('data-sb-summary', '');
    const est = card.estimate;
    if (est) {
      const phases = (est.stages || []).map((s) => s.phase);
      const l1 = h(doc, 'div', 'sb-sum-line', estimateSummary(est));
      for (const p of phases) l1.appendChild(h(doc, 'span', 'chip', STAGE_LABEL[p] || p));
      const skipped = SKIPPABLE.filter((p) => !phases.includes(p)).map((p) => STAGE_LABEL[p]);
      if (skipped.length) l1.appendChild(h(doc, 'small', 'hint ok', `✓ skips ${skipped.join(', ')}`));
      sum.appendChild(l1);
    }
    const grounded = h(doc, 'span', 'sb-grounded', `Grounded in ${shape.found.length} files`); grounded.setAttribute('data-sb-grounded', String(shape.found.length)); grounded.title = shape.found.join('\n');
    const l2 = h(doc, 'div', 'sb-sum-line', `${KIND_LABEL[fm.kind] || ''} · ${SIZE_LABEL[fm.size] || ''} · ${fm.flag ? `Flag ${fm.flag.key}` : 'No flag'} · ${(fm.roles || []).map((k) => roleByKey(k)?.label || k).join(' ')} · `);
    l2.appendChild(grounded);
    sum.appendChild(l2);
    if (!shape.ok) sum.appendChild(h(doc, 'small', 'hint warn', `Missing: ${open.map((i) => i.label).join('; ')}`));
    // actions (V11): one primary
    const actions = h(doc, 'div', 'sb-actions');
    const edit = button(doc, 'btn-ghost', 'Edit input', 'data-sb-edit'); edit.addEventListener('click', editInput);
    const cont = button(doc, 'btn-ghost', 'Continue in Ask Worca', 'data-sb-continue'); cont.addEventListener('click', () => onContinue(draft.threadId));
    const save = button(doc, 'btn-ghost', 'Save to plans/', 'data-sb-save');
    let savePath = card.path || undefined;
    save.addEventListener('click', async () => {
      const r2 = await api.save({ projectKey: card.projectKey, path: savePath, markdown: md });
      if (r2.ok) { save.textContent = `Saved to ${r2.path}`; return; }
      if (r2.status === 409 && r2.suggestion) { savePath = r2.suggestion; save.textContent = `Save as ${r2.suggestion}`; return; }
      save.textContent = r2.error || 'Could not save';
    });
    const use = button(doc, 'btn-primary', shape.ok ? 'Use as task' : 'Use anyway', 'data-sb-use');
    use.addEventListener('click', () => onUse({ markdown: md, projectKey: card.projectKey, projectDir: card.projectDir }));
    actions.append(edit, cont, save, use);
    wrap.append(head, shapeBox, sum, preview, actions);
    return wrap;
  }

  /** R16 + V9 + V10: wrap each h2 and its siblings in a section, tag it with its roles, outline failing ones, mark paths. */
  function decorate(host, roles, grounding, failing) {
    const kids = [...host.childNodes];
    let sec = null;
    for (const n of kids) {
      if (n.nodeType === 1 && n.tagName === 'H2') {
        const title = n.textContent.replace(/^\s*\d+\.\s*/, '').trim().toLowerCase();
        const key = (SECTION_KEYS.get(title)) || '';
        sec = h(doc, 'section', `sb-sec${failing.has(key) ? ' sb-sec-fail' : ''}`);
        sec.setAttribute('data-sb-section', key);
        host.insertBefore(sec, n);
        for (const owner of ownersOf(key, roles)) n.appendChild(h(doc, 'span', 'chip sb-role-tag', roleByKey(owner).label));
      }
      if (sec) sec.appendChild(n);
    }
    const g = new Map(grounding.map((x) => [`${x.path}:${x.line ?? ''}`, x]));
    for (const code of host.querySelectorAll('code')) {
      const m = new RegExp(`^${REPO_PATH_RE.source.slice(1, -1)}$`).exec(code.textContent);
      const hit = m && g.get(`${m[1]}:${m[2] ?? ''}`);
      if (!hit) continue;
      if (hit.found) code.after(h(doc, 'span', 'sb-ground', hit.line != null ? `✓ found :${hit.line}` : '✓ exists'));
      else if (!hit.isNew) code.after(h(doc, 'span', 'sb-ground miss', 'not found'));
    }
  }

  function render() {
    activityEl = null;
    const v = view === 'questions' && !shown ? 'form' : view === 'output' && !shown ? 'form' : view;
    const build = { form: formView, drafting: draftingView, questions: questionsView, output: outputView, failed: failedView }[v];
    root.replaceChildren(build());
  }

  function attach(key) {
    if (attached && (key || null) === projectKey) return;          // R19: same project → keep the live state
    // V19/V11: what was typed with no project (it has no key to be saved under) moves to the project picked next
    const unsaved = attached && !projectKey && draft.idea.trim() ? draft : null;
    attached = true;
    projectKey = key || null;
    model = null; loading = null; sending = false; shown = null; failure = null; note = ''; changeOpen = false; answers = {};
    timers.clearTimeout(suggestTimer); suggestTicket += 1; lastAsked = '';
    const stored = projectKey ? readDrafts(storage)[projectKey] || {} : {};
    draft = { ...blankDraft(), ...stored };
    const carried = unsaved && projectKey && !String(stored.idea || '').trim();
    if (carried) {
      Object.assign(draft, Object.fromEntries(CARRIED.map((k) => [k, unsaved[k]])), { projectKey: null });
      persist();
    }
    draft.rolesShown = draft.rolesTouched || !!draft.idea;
    setView('form');
    if (draft.threadId && !draft.editing) follow(draft.threadId);
  }

  render();
  return {
    el: root,
    attach,
    /** app.js's ask-* fan-out. */
    pushFrame(frame) {
      if (!frame) return;
      if (frame.type === 'ask-history-cleared') {       // R23: no threadId; it may name the deleted threads
        if (model && !loading && (!Array.isArray(frame.threadIds) || frame.threadIds.includes(model.threadId))) follow(model.threadId);
        return;                                         // a 404 then returns to the form (threadGone)
      }
      if (!model || loading || frame.threadId !== model.threadId) return;
      if (frame.type === 'ask-start') sending = false;
      const r = model.apply(frame);
      const end = frame.type === 'ask-done' || frame.type === 'ask-error';
      // R23: a gap, or a turn end the model could not place (its ask-start was missed): re-read the snapshot
      if (r && (r.gap || (end && r.dropped === 'no-live'))) { follow(model.threadId); return; }
      if (end) sending = false;
      settle();
    },
    /** WebSocket hello (every reconnect): re-read the thread over REST. Idempotent. */
    resync() { if (draft.threadId && !draft.editing && view !== 'form') follow(draft.threadId); },
    view: () => view,
  };
}
