// Changes is turned off (2026-11-17): app.js no longer registers this kind (see its createChangesKind import). Kept as is.
// ui/public/tool-changes.mjs — the Changes tool (issue 1064): a run's own diff (live while it runs, its final diff after),
// or a project's or chat's uncommitted work (git diff HEAD plus new files). The server picks the source
// (GET /api/tools/changes); app.js lends the Diff tab's renderer (paintDiffGrid), so both draw the same rows.
import { scopeQuery } from './tool-tabs.mjs';

const SOURCE_NOTE = Object.freeze({
  'run-live': 'Live: the run\'s worktree right now, against where the run started.',
  'run-final': 'The final diff of this run.',
  'working-tree': 'Uncommitted changes in this folder, against its last commit.',
});
const EMPTY = Object.freeze({ 'run-live': 'No changes yet.', 'run-final': 'No diff captured for this run.', 'working-tree': 'No uncommitted changes.' });

/** Why Changes is off on a design chat with no project. */
export const DESIGN_NO_CHANGES = 'A design keeps versions, not git changes: its rounds are in Design.';

export function createChangesKind({ doc, fetch, renderDiff }) {
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const epochs = new Map();
  /** `focus`: Refresh was used — the focus waits on the tool while it loads, then goes back to Refresh. */
  async function draw(tab, host, api, { focus = false } = {}) {
    const epoch = (epochs.get(tab.id) || 0) + 1;
    epochs.set(tab.id, epoch);
    const live = () => epochs.get(tab.id) === epoch && api.isMounted(tab.id);
    const wrap = make('div', 'tool-changes');
    const bar = make('div', 'tool-changes-bar');
    const note = make('span', 'tool-changes-note', 'Loading…');
    const refresh = make('button', 'btn btn-sm tool-changes-refresh', 'Refresh');
    refresh.type = 'button';
    refresh.disabled = true;
    // A diff is fetched on show and on Refresh, never per frame: each fetch runs git on the server.
    refresh.addEventListener('click', () => { const t = api.tab(tab.id); if (t) draw(t, host, api, { focus: true }); });
    const body = make('div', 'tool-changes-body');
    bar.append(note, refresh);
    wrap.append(bar, body);
    wrap.tabIndex = -1;
    host.replaceChildren(wrap);
    if (focus) wrap.focus();
    let data;
    try {
      const r = await fetch(`/api/tools/changes?${scopeQuery(api.scopeFor(tab))}`);
      let j = null;
      try { j = await r.json(); } catch { j = null; }
      if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { code: j && j.code });
      data = j;
    } catch (e) {
      if (!live()) return;
      if (e.code === 'SCOPE_GONE') { api.close(tab.id); return; }
      refresh.disabled = false;
      if (focus) refresh.focus();
      note.textContent = '';
      body.append(make('p', 'tool-note tool-error', e.message));
      return;
    }
    if (!live()) return;
    refresh.disabled = false;
    if (focus) refresh.focus();
    note.textContent = `${SOURCE_NOTE[data.source] || ''}${data.untrackedCapped ? ' Some new files are not listed.' : ''}`;
    const s = data.results && data.results.summary;
    if (!s || !((s.filesNew || 0) + (s.filesChanged || 0))) { body.append(make('div', 'hd-diff-empty', EMPTY[data.source] || 'No changes.')); return; }
    renderDiff(body, data, { picked: typeof tab.state.picked === 'string' ? tab.state.picked : null,
      onPick: (key) => api.setTabState(tab.id, { picked: key }) });
  }
  return {
    kind: 'changes', label: 'Changes', icon: 'diff', order: 40,
    shortcut: { code: 'KeyG', key: 'G', ctrl: true, shift: true, label: 'Ctrl+Shift+G' },
    title: () => 'Changes',
    // A design chat's folder keeps versions, not git history: Design's rounds are its changes.
    unavailable: (view) => (view && view.design && !view.project ? DESIGN_NO_CHANGES : null),
    mount: (tab, host, api) => draw(tab, host, api),
    unmount: (tab) => { epochs.set(tab.id, (epochs.get(tab.id) || 0) + 1); },
  };
}
