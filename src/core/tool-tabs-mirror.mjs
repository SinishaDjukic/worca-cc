// src/core/tool-tabs-mirror.mjs — the server's copy of the tool panel's tabs (issue 1064 slice 3). The panel keeps its
// tabs in the browser (ui/public/tool-tabs.mjs) and mirrors every chat and project scope here (PUT /api/tools/tabs),
// so the chat's tab tools (src/core/tab-tools.mjs) work from the list even when no Worca page has the chat open. A tab
// the assistant opens (open_tab) is stored first, undelivered, until a page takes it in (GET /api/tools/tabs): a page's
// PUT never drops such a tab unless that page names it in `seen`. Run tabs are never mirrored: no tool reaches them.
// One table, tool_tabs (db.mjs v87); the worca server is its only writer (the MCP child reaches it over the tab bridge).
import { randomBytes } from 'node:crypto';
import { getDb, tx } from './db.mjs';
import { normalizeLinkPath, LINE_MAX } from '../shared/file-refs.mjs';

export const TAB_MIRROR_LIMITS = Object.freeze({ tabsPerScope: 64, urlMaxChars: 2048, pendingPerChat: 8, seenMax: 64, ownerMaxChars: 320 });
const L = TAB_MIRROR_LIMITS;
const SCOPE_RE = /^(chat|project):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/;   // tool-tabs.mjs ID_RE behind the type
const TAB_ID_RE = /^tab_[A-Za-z0-9]{1,32}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;

export class TabMirrorError extends Error {
  constructor(message, code) { super(message); this.name = 'TabMirrorError'; this.code = code; }
}

/** `chat:<threadId>` / `project:<projectKey>` — tool-tabs.mjs scopeKey for the two mirrored scope types. */
export const tabScope = (type, id) => `${type}:${id}`;
export const isTabScope = (s) => typeof s === 'string' && SCOPE_RE.test(s);
export const newTabId = () => `tab_${randomBytes(6).toString('hex')}`;
const ownerOf = (o) => (typeof o === 'string' && o.length <= L.ownerMaxChars ? o : '');

const ROOT_RE = /^run:[0-9a-f]{8}$/;
const MEMBER_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/;
/** A Files tab's file or folder as a page or open_tab sends it, or null. */
export function cleanTarget(kind, t) {
  if (kind !== 'files' || !t || typeof t !== 'object' || Array.isArray(t)) return null;
  const n = typeof t.path === 'string' ? normalizeLinkPath(t.path) : null;
  if (!n) return null;
  const int = (v) => (Number.isInteger(v) && v >= 1 && v <= LINE_MAX ? v : null);
  const dir = t.dir === true || n.dir || t.type === 'dir';
  const line = dir ? null : int(t.line);
  const endLine = line != null ? int(t.endLine) : null;
  return { path: n.path, ...(dir ? { dir: true } : {}), ...(line != null ? { line } : {}), ...(endLine != null && endLine > line ? { endLine } : {}),
    ...(typeof t.root === 'string' && ROOT_RE.test(t.root) ? { root: t.root } : {}),
    ...(typeof t.member === 'string' && MEMBER_RE.test(t.member) ? { member: t.member } : {}) };
}
const parseTarget = (s) => { try { const t = JSON.parse(s); return t && typeof t === 'object' ? t : null; } catch { return null; } };
/** One tab as a page sends it, or null: a known id and kind, an address only on a Browser tab (http/https, ≤ 2048). */
export function cleanMirrorTab(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !TAB_ID_RE.test(t.id) || typeof t.kind !== 'string' || !KIND_RE.test(t.kind)) return null;
  const url = t.kind === 'browser' && typeof t.url === 'string' && t.url.length <= L.urlMaxChars && /^https?:\/\//i.test(t.url) ? t.url : null;
  return { id: t.id, kind: t.kind, url, target: cleanTarget(t.kind, t.target), at: Number.isFinite(t.at) ? Math.trunc(t.at) : 0 };
}
const rowTab = (r) => ({ id: r.id, kind: r.kind, url: r.url ?? null, target: r.target ? parseTarget(r.target) : null,
  openedBy: r.opened_by === 'assistant' ? 'assistant' : 'user', at: r.at, delivered: r.delivered === 1 });
const targetText = (t) => (t ? JSON.stringify(t) : null);

export function createToolTabsMirror({ now = () => Date.now() } = {}) {
  const db = () => getDb();
  function list(owner, scope) {
    if (!isTabScope(scope)) return [];
    return db().prepare('SELECT * FROM tool_tabs WHERE owner = ? AND scope = ? ORDER BY pos, at').all(ownerOf(owner), scope).map(rowTab);
  }
  const insert = () => db().prepare('INSERT INTO tool_tabs (owner, scope, id, kind, url, target, opened_by, delivered, at, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  return {
    list,
    /**
     * A page's list for `scope`, in its order. Who opened a tab is the server's record, never the page's word. Tabs the
     * assistant opened that this page has not taken in stay (after the page's), unless `seen` names them: the page took
     * them in, so a tab missing from its list was closed there. Answers the stored list.
     */
    replace(owner, scope, tabs, { seen = [] } = {}) {
      if (!isTabScope(scope)) throw new TabMirrorError('not a chat or project scope', 'BAD_SCOPE');
      const o = ownerOf(owner);
      const clean = [];
      const ids = new Set();
      for (const t of Array.isArray(tabs) ? tabs : []) {
        const c = cleanMirrorTab(t);
        if (c && !ids.has(c.id) && clean.length < L.tabsPerScope) { ids.add(c.id); clean.push(c); }
      }
      const saw = new Set((Array.isArray(seen) ? seen : []).filter((s) => typeof s === 'string').slice(0, L.seenMax));
      tx(() => {
        const before = list(o, scope);
        const was = new Map(before.map((t) => [t.id, t]));
        const keep = before.filter((t) => !t.delivered && !ids.has(t.id) && !saw.has(t.id));
        db().prepare('DELETE FROM tool_tabs WHERE owner = ? AND scope = ?').run(o, scope);
        const ins = insert();
        clean.forEach((t, i) => ins.run(o, scope, t.id, t.kind, t.url, targetText(t.target), was.get(t.id)?.openedBy === 'assistant' ? 'assistant' : 'user', 1, t.at || now(), i));
        keep.slice(0, Math.max(0, L.tabsPerScope - clean.length))
          .forEach((t, i) => ins.run(o, scope, t.id, t.kind, t.url, targetText(t.target), t.openedBy, 0, t.at, clean.length + i));
      });
      return list(o, scope);
    },
    /** open_tab: a new undelivered tab at the end of `scope`. Throws TabMirrorError FULL / PENDING / BAD_TAB. */
    add(owner, scope, { kind, url = null, target = null }) {
      if (!isTabScope(scope)) throw new TabMirrorError('not a chat or project scope', 'BAD_SCOPE');
      const o = ownerOf(owner);
      const cur = list(o, scope);
      if (cur.length >= L.tabsPerScope) throw new TabMirrorError(`this chat already has ${L.tabsPerScope} tabs: ask the user to close some`, 'FULL');
      if (cur.filter((t) => !t.delivered).length >= L.pendingPerChat) {
        throw new TabMirrorError(`${L.pendingPerChat} tabs you opened are still waiting for the user to open this chat's tool panel: do not open more`, 'PENDING');
      }
      const t = cleanMirrorTab({ id: newTabId(), kind, url, target, at: now() });
      if (!t) throw new TabMirrorError('not a tab worca can open', 'BAD_TAB');
      insert().run(o, scope, t.id, t.kind, t.url, targetText(t.target), 'assistant', 0, t.at, cur.length);
      return { ...t, openedBy: 'assistant', delivered: false };
    },
    /** open_tab brought an open Files tab forward at another line: the stored target follows (the page's next PUT
     *  sends its own state anyway). */
    setTarget(owner, scope, id, target) {
      if (!isTabScope(scope)) return;
      db().prepare('UPDATE tool_tabs SET target = ? WHERE owner = ? AND scope = ? AND id = ?').run(targetText(cleanTarget('files', target)), ownerOf(owner), scope, id);
    },
    /** A chat archived or deleted: its tabs go, every owner's. */
    dropScope(scope) {
      if (isTabScope(scope)) db().prepare('DELETE FROM tool_tabs WHERE scope = ?').run(scope);
    },
  };
}
