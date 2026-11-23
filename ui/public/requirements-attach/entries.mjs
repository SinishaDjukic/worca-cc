// ui/public/requirements-attach/entries.mjs — the two places a person attaches Requirements features: the New run button and the
// Chat composer button. Each shows its button by the flag, follows flag flips without a reload, labels itself from the attach
// store, opens the multi-select picker and revalidates the restored store once on mount. Button placement is the host's job.
import { flagOn as pageFlagOn, onFlagChange as pageOnFlagChange } from '../flags.mjs';
import { pullLabel } from './cards.mjs';
import { openAttachPicker } from './picker.mjs';
import { revalidate } from './revalidate.mjs';

const FLAG = 'requirements';
const SEARCH_URL = '/api/requirements/search';

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

/** A Chat scope (`{pinned, projectKey, workspaceId}` or an already-shaped `{scopeType, scopeKey}`) → the picker's scope, or null. */
function chatScope(s) {
  if (!s) return null;
  if (s.scopeType && s.scopeKey) return { scopeType: s.scopeType, scopeKey: s.scopeKey };
  if (s.projectKey) return { scopeType: 'project', scopeKey: s.projectKey };
  if (s.workspaceId) return { scopeType: 'workspace', scopeKey: s.workspaceId };
  return null;
}

function searchFnFor(fetchJson) {
  return ({ scopeType, scopeKey, q = '', exclude = [] }) => {
    const params = new URLSearchParams({ scopeType, scopeKey, q });
    if (exclude.length) params.set('exclude', exclude.join(','));
    return fetchJson(`${SEARCH_URL}?${params}`);
  };
}

/** revalidate() hands its body over as a JSON string; the page's fetchJson takes the object and stringifies it itself. */
const objectBody = (fetchJson) => (url, opts = {}) => {
  const { headers: _headers, body, ...rest } = opts;
  return fetchJson(url, { ...rest, ...(typeof body === 'string' ? { body: JSON.parse(body) } : body === undefined ? {} : { body }) });
};

/**
 * The shared mount: button visibility by flag (live), store-driven label, click → picker, revalidate once on mount and when
 * the flag comes back on. `getScope()` is the picker's scope source; `onProject(key)` applies a chosen project to the host.
 */
function mountEntry({ button, store, getScope, getProjects, onProject, doc, flagOn, onFlagChange, fetchJson, paint = null }) {
  if (!button) return () => {};
  const searchFn = searchFnFor(fetchJson);
  const toObjectBody = objectBody(fetchJson);
  let picking = false;

  const syncLabel = () => {
    const n = store.get().items.length;
    if (paint) paint(button, n); else button.textContent = pullLabel(n);
  };
  const recheck = () => revalidate(store, toObjectBody, getScope(), flagOn).catch(() => ({ ok: false, changed: false }));
  const syncFlag = () => { button.hidden = !flagOn(); };

  syncFlag();
  syncLabel();
  const offStore = store.subscribe(syncLabel);
  const offFlag = onFlagChange(() => { syncFlag(); void recheck(); });

  const onClick = async () => {
    if (!flagOn() || picking) return;
    picking = true;
    try {
      const projects = getScope() ? [] : await getProjects();
      await openAttachPicker({ store, scope: getScope, searchFn, onProject, projects, trigger: button, doc });
    } finally { picking = false; }
  };
  button.addEventListener('click', onClick);
  void recheck();

  return () => {
    button.removeEventListener('click', onClick);
    offStore();
    offFlag();
  };
}

/**
 * The New run button. `getTarget()` reads the page's run target (`{ runTarget, projectKey, workspaceId, ... }`); a project picked
 * in the dialog goes through `setRunTarget('project')` and the form's project `<select>` (value + a bubbling `change`).
 */
export function mountNewRunAttach({
  button, store, getTarget, setRunTarget, projectSelect = null, doc = globalThis.document,
  flagOn = () => pageFlagOn(FLAG), onFlagChange = (fn) => pageOnFlagChange(FLAG, fn), fetchJson = jsonFetcher(),
}) {
  const getScope = () => newRunScope(getTarget()).scope;
  const getProjects = async () => [...(projectSelect?.options || [])]
    .filter((o) => o.value).map((o) => ({ key: o.value, name: o.textContent.trim() || o.value }));
  const onProject = (key) => {
    setRunTarget('project');
    if (!projectSelect) return;
    projectSelect.value = key;
    projectSelect.dispatchEvent(new (doc.defaultView.Event)('change', { bubbles: true }));
  };
  return mountEntry({ button, store, getScope, getProjects, onProject, doc, flagOn, onFlagChange, fetchJson });
}

/**
 * The Chat composer button. `getScope()` is the thread's `{pinned, projectKey, workspaceId}`; a picked project pins the chat.
 * `paint(button, n)`, when given, draws the button in place of the words; it runs on mount and on every store commit, so it
 * must be idempotent.
 */
export function mountChatAttach({
  button, store, getScope, setScope, doc = globalThis.document,
  flagOn = () => pageFlagOn(FLAG), onFlagChange = (fn) => pageOnFlagChange(FLAG, fn), fetchJson = jsonFetcher(), paint = null,
}) {
  const scopeNow = () => chatScope(getScope());
  const getProjects = async () => {
    try {
      const data = await fetchJson('/api/projects');
      return ((data && data.projects) || []).filter((p) => p && p.key).map((p) => ({ key: p.key, name: p.name || p.key }));
    } catch { return []; }
  };
  const onProject = (key) => { setScope({ pinned: true, projectKey: key }); };
  return mountEntry({ button, store, getScope: scopeNow, getProjects, onProject, doc, flagOn, onFlagChange, fetchJson, paint });
}
