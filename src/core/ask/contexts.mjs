// src/core/ask/contexts.mjs — the Ask chat's context chips: which project / run / workspace /
// named page a chat was asked in, accumulated across turns (origin first, deduplicated).
// Pure: the route resolves names (resolveAskContext) and the store persists (addThreadContexts).
// A chip the conversation produced (mentionedRefs) carries source: 'chat'; a page sighting wins.

export const MAX_CONTEXTS = 20;
const LABEL_MAX = 80;

/** Named pages that earn a chip; every other view (lists, `new`, detail kinds) produces none. */
export const PAGE_LABELS = Object.freeze({
  settings: 'Settings',
  marketplace: 'Marketplace',
  connectors: 'Connectors',
  models: 'Models',
  providers: 'Providers',
  'team-metrics': 'Team metrics',
  'team-policy': 'Team policy',
});

const KINDS = new Set(['project', 'run', 'workspace', 'page']);
const clip = (s) => String(s ?? '').slice(0, LABEL_MAX);
const nonEmpty = (s) => typeof s === 'string' && s.length > 0;

/** Chip entries for one turn, from the validated client context (`ctx`, for the pin verdict)
 *  and the SERVER-RESOLVED header context (`header`: names only for rows that exist). */
export function contextEntries(ctx, header) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const h = header && typeof header === 'object' ? header : {};
  const out = [];
  const pinned = c.pinned === true;
  if (h.project && nonEmpty(h.project.key)) {
    const e = { kind: 'project', id: h.project.key, label: clip(h.project.name || h.project.key) };
    if (pinned && c.projectKey === h.project.key) e.pinned = true;
    out.push(e);
  }
  if (h.workspace && nonEmpty(h.workspace.id)) {
    const e = { kind: 'workspace', id: h.workspace.id, label: clip(h.workspace.name || h.workspace.id) };
    if (pinned && c.workspaceId === h.workspace.id) e.pinned = true;
    out.push(e);
  }
  // A run without a home is a live run before its pipeline id: its header id is a run-id prefix,
  // not the id a later turn resolves, so a chip for it would duplicate. The home also makes it a link.
  if (h.run && nonEmpty(h.run.id) && nonEmpty(h.run.home)) {
    out.push({ kind: 'run', id: h.run.id, label: clip(h.run.title || h.run.id), home: h.run.home });
  }
  if (nonEmpty(h.view) && Object.hasOwn(PAGE_LABELS, h.view)) {
    out.push({ kind: 'page', id: h.view, label: PAGE_LABELS[h.view] });
  }
  return out;
}

const valid = (e) => e && typeof e === 'object' && KINDS.has(e.kind) && nonEmpty(e.id) && typeof e.label === 'string';

/** Accumulate: existing order kept (origin first), new kind:id appended, label refreshed
 *  (an id-only fallback label never replaces a real one), pinned sticky (OR). A corrupt stored value degrades to [].
 *  Over the cap: the origin stays, then chat chips are dropped before page chips, oldest first. */
export function mergeContexts(existing, incoming) {
  const list = (Array.isArray(existing) ? existing : []).filter(valid).map((e) => ({ ...e }));
  const at = new Map(list.map((e, i) => [`${e.kind}:${e.id}`, i]));
  for (const e of Array.isArray(incoming) ? incoming : []) {
    if (!valid(e)) continue;
    const k = `${e.kind}:${e.id}`;
    if (at.has(k)) {
      const cur = list[at.get(k)];
      if (e.label !== e.id || !cur.label) cur.label = e.label;
      if (e.kind === 'run' && nonEmpty(e.home)) cur.home = e.home;
      if (e.pinned === true) cur.pinned = true;
      if (e.source !== 'chat') delete cur.source;               // a page sighting wins over a chat one
    } else {
      at.set(k, list.length);
      list.push({ ...e });
    }
  }
  return capContexts(list);
}

/** Over the cap the origin always stays; chat chips go before page chips, oldest first. */
function capContexts(list) {
  const over = list.length - MAX_CONTEXTS;
  if (over <= 0) return list;
  const drop = new Set();
  const pick = (want) => { for (let i = 1; i < list.length && drop.size < over; i++) if (want(list[i])) drop.add(i); };
  pick((e) => e.source === 'chat');
  pick(() => true);
  return list.filter((_, i) => !drop.has(i));
}

// ── conversation chips ──
// What a finished turn talked about: the links in its answer and the scope of the main conversation's
// worca tool calls. Sub-agent calls (never blocks), tool results and the user's own words are left out.

const SEG = '[A-Za-z0-9_-]+';
// A hash link starts a token or follows link punctuation (`](#…`, `<#…`), never mid-word.
const LINK_RE = new RegExp(`(?<![\\w#/])#(history|running|projects|workspaces)((?:/${SEG})+)`, 'g');
const RUN_ID_RE = /^[0-9a-f]{8}$/i;
const LIVE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_TOOLS = new Set(['get_run', 'get_run_diff', 'track_run']);
const WORCA_PREFIX = 'mcp__worca__';

function linkRef(route, segs) {
  if (route === 'projects' || route === 'workspaces') return { kind: route.slice(0, -1), id: segs[0] };
  if (route === 'running') return LIVE_ID_RE.test(segs[0]) ? { kind: 'liveRun', id: segs[0] } : null;
  // #history/<projectKey>/<runId>[/details/<tab>] or #history/workspaces/<wsId>/<runId>[/…]
  if (segs[0] === 'workspaces') return segs[2] ? { kind: 'run', id: segs[2], workspaceId: segs[1] } : null;
  return segs[1] ? { kind: 'run', id: segs[1], projectKey: segs[0] } : null;
}

function toolRefs(block) {
  const out = [];
  const name = typeof block.name === 'string' && block.name.startsWith(WORCA_PREFIX) ? block.name.slice(WORCA_PREFIX.length) : null;
  const input = block.input;
  if (!name || !input || typeof input !== 'object' || input._truncated) return out;   // a clipped input is unreadable
  const projectKey = nonEmpty(input.projectKey) ? input.projectKey : null;
  const workspaceId = nonEmpty(input.workspaceId) ? input.workspaceId : null;
  if (RUN_TOOLS.has(name) && nonEmpty(input.id)) {
    if (LIVE_ID_RE.test(input.id)) out.push({ kind: 'liveRun', id: input.id });          // track_run's app run id
    else if (RUN_ID_RE.test(input.id)) {
      out.push({ kind: 'run', id: input.id, ...(workspaceId ? { workspaceId } : projectKey ? { projectKey } : {}) });
    }
  }
  if (projectKey) out.push({ kind: 'project', id: projectKey });
  if (workspaceId) out.push({ kind: 'workspace', id: workspaceId });
  return out;
}

/** Raw refs `{kind: 'project'|'workspace'|'run'|'liveRun', id, projectKey?, workspaceId?}` from one finished
 *  turn's summary (`{text, blocks}`), first sighting per kind:id. The server resolves them into chips. */
export function mentionedRefs(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const refs = [];
  if (typeof s.text === 'string') {
    for (const m of s.text.matchAll(LINK_RE)) {
      const r = linkRef(m[1], m[2].split('/').slice(1));
      if (r) refs.push(r);
    }
  }
  for (const b of Array.isArray(s.blocks) ? s.blocks : []) {
    if (b && b.kind === 'tool') refs.push(...toolRefs(b));
  }
  // Capped: the server resolves each ref before ask-done, and the thread never holds more chips than this.
  const seen = new Set();
  return refs.filter((r) => {
    const k = `${r.kind}:${r.id}`;
    return seen.has(k) ? false : seen.add(k);
  }).slice(0, MAX_CONTEXTS);
}
