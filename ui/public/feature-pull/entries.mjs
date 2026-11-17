// ui/public/feature-pull/entries.mjs — the two places a person pulls a feature from Requirements into a run: the "Pull from
// Requirements" button on New Run, and the "Pull feature" add-on in the Chat composer. Both open the feature picker in a document
// modal, hand the pick to startFromFeature (the Requirements start path), and then go their own way: New Run opens the run,
// Chat posts the run's card into the thread. app.js calls `mountFeaturePull` once; the New Run form is never written to.
import { registerComposerAddon } from '../chat/extensions.mjs';
import { scopeFromContext } from '../chat/scope-ui.mjs';
import { flagOn as pageFlagOn, onFlagChange as pageOnFlagChange } from '../flags.mjs';
import { createDocumentModal } from './modal.mjs';
import { openFeaturePicker } from './picker.mjs';
import { startFromFeature } from './run-flow.mjs';

export const CHAT_ADDON_ID = 'feature-pull';
export const CARD_FAILED_TEXT = 'The run started, but its card could not be posted.';
const FLAG = 'requirements';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHAT_LABEL = 'Pull feature';

/** `fetchJson(url, { method, body, signal })` over a fetch function: the parsed JSON body, or an Error with `status` and `data`. */
export function jsonFetcher(fetchFn = (...a) => globalThis.fetch(...a)) {
  return async (url, { method = 'GET', body, signal } = {}) => {
    const init = { method, signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
    const res = await fetchFn(url, init);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
    return data;
  };
}

const firstOf = (list) => (Array.isArray(list) && typeof list[0] === 'string' && list[0] ? list[0] : null);

/** New Run's target, as the page reads it, → the picker's scope and the project directory a start reads its config from. */
export function newRunScope(target) {
  const t = target || {};
  if (t.runTarget === 'project' && t.projectKey) return { scope: { scopeType: 'project', scopeKey: t.projectKey }, projectDir: t.projectPath || null };
  if (t.runTarget === 'workspace' && t.workspaceId) return { scope: { scopeType: 'workspace', scopeKey: t.workspaceId }, projectDir: firstOf(t.workspacePaths) };
  return { scope: null, projectDir: null };
}

/** Whether `flag` shows the entry now; `sync` runs again on every flip. */
function followFlag({ flagOn, onFlagChange, sync }) {
  sync();
  return onFlagChange(FLAG, sync);
}

/**
 * Open the picker for `scope`; a pick goes to `startFeature`, and a started run to `onStarted(info, feature)`. `guard` is the
 * entry's `{ active }` flag: a press while a pull is still going (the picker, or the feature load after the pick) does nothing.
 */
function pull({ scope, resolveDir, trigger, fetchJson, createModal, startFeature, onStarted, guard, document: doc }) {
  if (guard.active) return;
  guard.active = true;
  const modal = createModal({ document: doc });
  openFeaturePicker({
    modal, fetchJson, scope, trigger, document: doc,
    onClose: ({ picked }) => { if (!picked) guard.active = false; },
    onPick: async (feature) => {
      try {
        let projectDir = null;
        try { projectDir = await resolveDir(); } catch { projectDir = null; }
        await startFeature({ seq: feature.seq, modal, fetchJson, projectDir, trigger, document: doc, onStarted: (info) => onStarted(info, feature) });
      } finally { guard.active = false; }
    },
  });
}

/**
 * The New Run button. `getTarget()` reads the page's run target:
 * `{ runTarget, projectKey, projectPath, workspaceId, workspacePaths }`. A started run opens at `#running/<runId>`.
 */
export function mountNewRunPull({
  button, getTarget, fetchJson = jsonFetcher(), createModal = createDocumentModal, startFeature = startFromFeature,
  flagOn = pageFlagOn, onFlagChange = pageOnFlagChange, win = globalThis.window, document: doc = globalThis.document,
}) {
  if (!button) return () => {};
  const guard = { active: false };
  const off = followFlag({ flagOn, onFlagChange, sync: () => { button.hidden = !flagOn(FLAG); } });
  button.addEventListener('click', () => {
    if (!flagOn(FLAG)) return;
    const { scope, projectDir } = newRunScope(getTarget());
    pull({
      scope, resolveDir: async () => projectDir, trigger: button, fetchJson, createModal, startFeature, guard, document: doc,
      onStarted: ({ runId }) => { if (runId) win.location.hash = `#running/${runId}`; },
    });
  });
  return off;
}

/** The project directory a Chat scope's runs work in: the project's path, or the workspace's first member. */
async function chatProjectDir(fetchJson, s) {
  if (s.projectKey) {
    const data = await fetchJson('/api/projects');
    const p = ((data && data.projects) || []).find((x) => x && x.key === s.projectKey);
    return (p && p.path) || null;
  }
  if (s.workspaceId) {
    const data = await fetchJson('/api/workspaces');
    const w = ((data && data.workspaces) || []).find((x) => x && x.id === s.workspaceId);
    return w ? firstOf(w.projectPaths) : null;
  }
  return null;
}

function chatScope(s) {
  if (s.projectKey) return { scopeType: 'project', scopeKey: s.projectKey };
  if (s.workspaceId) return { scopeType: 'workspace', scopeKey: s.workspaceId };
  return null;
}

/** A chat made for the pulled run's card (the panel has no thread row yet), pinned to the scope the feature came from. */
async function createChatThread(fetchJson, s) {
  const data = await fetchJson('/api/ask/threads', { method: 'POST', body: {} });
  const id = data && data.thread && data.thread.id;
  if (!id) throw new Error('no thread');
  const scope = s.projectKey ? { pinned: true, projectKey: s.projectKey } : { pinned: true, workspaceId: s.workspaceId };
  try { await fetchJson(`/api/ask/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: { scope } }); } catch { /* the chat is still usable unpinned */ }
  return id;
}

function pullIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, String(v));
  for (const d of ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14']) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Register the Chat composer add-on (CONTRACT §2): call BEFORE the Ask panel is created. The panel's live scope pill names the scope
 * (`ctx.scope()`, else the thread's own context; an unpinned chat has none). A started run's card is posted to
 * `/api/ask/threads/:id/feature-runs`; a chat with no thread yet gets one first, and the page moves to it.
 */
export function mountChatPull({
  fetchJson = null, createModal = createDocumentModal, startFeature = startFromFeature, register = registerComposerAddon,
  flagOn = pageFlagOn, onFlagChange = pageOnFlagChange, win = globalThis.window,
} = {}) {
  register({
    id: CHAT_ADDON_ID,
    mount(leadEl, ctx) {
      const doc = ctx.doc;
      const fj = fetchJson || jsonFetcher((...a) => ctx.fetch(...a));
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'fp-chat-btn';
      button.title = CHAT_LABEL;
      button.setAttribute('aria-label', CHAT_LABEL);
      button.append(pullIcon(doc));
      const notice = doc.createElement('span');
      notice.className = 'fp-chat-notice';
      notice.setAttribute('role', 'status');
      let lastThread = null;
      const guard = { active: false };

      const say = (text) => { if (typeof ctx.announce === 'function') ctx.announce(text); };
      const showNotice = (runId) => {
        const link = doc.createElement('a');
        link.href = `#running/${runId}`;
        link.textContent = 'Open the run';
        notice.replaceChildren(`${CARD_FAILED_TEXT} `, link);
        if (notice.parentNode !== leadEl) leadEl.appendChild(notice);
        say(CARD_FAILED_TEXT);
      };
      async function postCard(threadId, seq, runId) {
        try { await fj(`/api/ask/threads/${encodeURIComponent(threadId)}/feature-runs`, { method: 'POST', body: { seq, runId } }); return true; } catch { showNotice(runId); return false; }
      }
      /** The card goes into the open chat; with none yet, into a new one that the page then opens. */
      async function cardFor(threadId, s, seq, runId) {
        if (threadId) { await postCard(threadId, seq, runId); return; }
        let id;
        try { id = await createChatThread(fj, s); } catch { showNotice(runId); return; }
        if (await postCard(id, seq, runId) && win) win.location.hash = `#chat/${id}`;
      }
      const liveScope = (thread) => scopeFromContext(typeof ctx.scope === 'function' ? ctx.scope() : thread && thread.context);
      const sync = () => {
        if (flagOn(FLAG)) { if (button.parentNode !== leadEl) leadEl.appendChild(button); } else { button.remove(); notice.remove(); }
      };

      button.addEventListener('click', () => {
        if (!flagOn(FLAG)) return;
        notice.remove();
        const thread = typeof ctx.thread === 'function' ? ctx.thread() : lastThread;
        const threadId = (thread && thread.id) || (typeof ctx.threadId === 'function' ? ctx.threadId() : null);
        const s = liveScope(thread);
        pull({
          scope: chatScope(s), resolveDir: () => chatProjectDir(fj, s), trigger: button, fetchJson: fj, createModal, startFeature, guard, document: doc,
          onStarted: ({ runId }, feature) => { if (runId) void cardFor(threadId, s, feature.seq, runId); },
        });
      });

      const off = followFlag({ flagOn, onFlagChange, sync });
      return {
        update(thread) {
          if (((thread && thread.id) || null) !== ((lastThread && lastThread.id) || null)) notice.remove();
          lastThread = thread || null;
        },
        destroy() { off(); button.remove(); notice.remove(); },
      };
    },
  });
}

/** The one call app.js makes: the Chat add-on, and the New Run button when the page has one. */
export function mountFeaturePull({ button = null, getTarget, ...deps } = {}) {
  mountChatPull({ fetchJson: deps.fetchJson || null, ...pick(deps, ['createModal', 'startFeature', 'register', 'flagOn', 'onFlagChange', 'win']) });
  return mountNewRunPull({ button, getTarget, ...deps });
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}
