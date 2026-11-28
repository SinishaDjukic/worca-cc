// ui/public/tool-overview-sources.mjs — the sections of the tool panel's Overview (issue 1064, plan §3.10): a chat's
// Environment, Context, Runs, Pull requests, Artifacts and Background; a run's and a project's short lists. Every
// source is a dep (app.js builds them, one line each), so jsdom tests drive this without app.js. The live parts come
// from what the browser already has (the run store, the chat panel's meters and command cards, the running Actions);
// the rest from one GET /api/ask/threads/:id/overview per mount (GET /api/ask/runs/:id for a run), shared by its sections.
import { runModel } from '../../src/shared/run-model.mjs';
import { runCostLabel } from '../../src/shared/engine-switch.mjs';
import { refFromHref } from '../../src/shared/chip-refs.mjs';
import { progressRoute, runPill } from './ask-run-card.mjs';
import { fmtUsd } from './ask-meter.mjs';
import { fmtCmdDur } from './ask-command-group.mjs';
import { formatUptime } from './actions-view.mjs';
import { ago } from './branch-sync.mjs';
import { formatBytes } from './artifacts/common.mjs';
import { DESIGN_KIND_LABELS } from '../../src/shared/design-names.mjs';
import { filePreviewOf } from './chat/file-renderers.mjs';
import { fileCardAction } from './chat-link-route.mjs';
import { ITEM_PILL } from './ask-ref-chips.mjs';
import { renderContextDetails } from './ask-context-view.mjs';

export const OVERVIEW_LIMIT = 50;
const REFETCH_MS = 400;
const RECENT = 10;

const nowOf = (deps) => (typeof deps.now === 'function' ? deps.now() : Date.now());
/** A home folder shown as `~` (the Environment's project row). */
const tilde = (p) => (typeof p === 'string' ? p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~') : '');
const pillOf = (state) => { const p = ITEM_PILL[state]; return p ? { tone: p[0], text: p[1] } : null; };
const prIcon = (state) => (state === 'merged' ? 'merge' : state === 'closed' ? 'pull-request-closed' : state === 'draft' ? 'pull-request-draft' : 'pull-request');
const prStateOf = (pr) => {
  const s = String(pr?.state || 'open').toLowerCase();
  return pr?.draft === true && s === 'open' ? 'draft' : s;
};
const since = (deps, iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, nowOf(deps) - t) : 0; };

/**
 * One fetch shared by a mount's sections: `get(signal)` answers the in-flight promise; `refetchSoon()` debounces a new
 * one (400 ms) and tells the sections that redraw from it; `value` is the last answer (sync readers: Background).
 */
function sharedFetch(url, deps) {
  let promise = null;
  let timer = null;
  let signal = null;
  let gen = 0;
  let subs = 0;
  const onRefetch = new Set();
  const onValue = new Set();
  const api = {
    value: null,
    get(sig) {
      if (sig && !signal) signal = sig;
      if (!promise) {
        const my = ++gen;
        promise = Promise.resolve()
          .then(() => deps.fetch(url, signal ? { signal } : undefined))
          .then((r) => { if (!r || !r.ok) throw new Error(`overview: ${r ? r.status : 'no answer'}`); return r.json(); })
          .then((body) => {
            if (my === gen) { api.value = body; for (const fn of [...onValue]) { try { fn(); } catch { /* a section's own trouble */ } } }
            return body;
          });
        promise.catch(() => {});
      }
      return promise;
    },
    refetchSoon() {
      if (!subs || (signal && signal.aborted)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!subs || (signal && signal.aborted)) return;
        promise = null;
        api.get();
        for (const fn of [...onRefetch]) { try { fn(); } catch { /* a section's own trouble */ } }
      }, REFETCH_MS);
    },
    /** A section's live hookup: `redraw` after a refetch (and on every answer with `value: true`). → unsubscribe. */
    hook(redraw, { value = false } = {}) {
      subs += 1;
      const set = value ? onValue : onRefetch;
      set.add(redraw);
      return () => { set.delete(redraw); subs -= 1; if (subs <= 0) { clearTimeout(timer); timer = null; } };
    },
  };
  return api;
}
const all = (...unsubs) => () => { for (const u of unsubs) { try { if (typeof u === 'function') u(); } catch { /* already gone */ } } };

// ── rows shared by the scopes ──────────────────────────────────────────────────────────────────────────
function actionRow(s, deps) {
  return { key: `act:${s.instanceId}`, icon: s.kind === 'service' ? 'globe' : 'play', text: s.label || s.actionId || 'Action',
    meta: formatUptime(since(deps, s.startedAt)), title: s.runTitle ? `${s.label || s.actionId} · ${s.runTitle}` : undefined,
    ...(s.url && typeof deps.openService === 'function' ? { open: () => deps.openService(s) } : {}),
    stop: { label: 'Stop', run: () => deps.stopAction(s) } };
}
function prRow(pr, title, upgrade = null) {
  const state = upgrade && upgrade.state ? String(upgrade.state).toLowerCase() : pr.state;
  const ref = pr.label ? null : refFromHref(pr.url);
  const meta = (upgrade && upgrade.title) || title || '';
  // A mentioned run's PR (the server's `source: 'mentioned'`): listed after the chat's own, said and drawn quieter.
  const mentioned = pr.source === 'mentioned';
  return { key: `pr:${pr.url}`, icon: prIcon(state), text: pr.label || ref?.label || pr.url, meta: mentioned ? `Mentioned${meta ? ` · ${meta}` : ''}` : meta,
    pill: pillOf(state), href: pr.url, title: mentioned ? `${pr.url} · a PR of a run this chat mentioned` : pr.url, ...(mentioned ? { quiet: true } : {}) };
}

/** More auto-fix runs than this under one run fold into one "N auto-fixes" line. */
export const FIX_ROWS_MAX = 2;
const MENTION_WHY = { link: 'Followed by this chat', followed: 'The run this chat follows', reply: 'Named in a reply', fix: 'Its PR auto-fix reported here' };
/** A run's saved status and phase as one meta text; the live store wins (R2). */
function liveOf(rs, r) { return rs ? (rs.byPipeline(r.pipelineId) || (r.runId ? rs.get(r.runId) : null)) : null; }
function statusText(snap, r) {
  const pill = runPill(snap || { status: r.status, source: 'rest' });
  return !snap && r.status === 'running' && r.phase && r.phase !== r.status ? `${pill.text} · ${r.phase}` : pill.text;
}
/**
 * A run's auto-fix runs as child rows (↳ dot, "Auto-fix N", status/phase, its OWN cost when `cost`), or one
 * "N auto-fixes" line past FIX_ROWS_MAX. `known` collects the run ids a live poke redraws.
 */
function fixRows(parent, deps, known, { cost }) {
  const list = Array.isArray(parent.fixes) ? parent.fixes : [];
  if (!list.length) return [];
  const rs = deps.runStore;
  if (list.length > FIX_ROWS_MAX) {
    for (const f of list) { known.add(f.runId); const snap = liveOf(rs, f); if (snap?.runId) known.add(snap.runId); }
    const last = list.at(-1);
    const snap = liveOf(rs, last);
    return [{ key: `fixes:${parent.pipelineId}`, child: true, dot: runModel(snap?.run || { status: last.status }), text: `${list.length} auto-fixes`,
      meta: `Latest: ${statusText(snap, last)}`, title: `PR auto-fix runs of ${parent.title || parent.pipelineId}`,
      open: () => deps.go(parent.href || progressRoute({ runId: parent.runId, pipelineId: parent.pipelineId }, null)) }];
  }
  return list.map((f) => {
    const snap = liveOf(rs, f);
    known.add(f.runId);
    if (snap?.runId) known.add(snap.runId);
    const ident = { runId: f.runId, pipelineId: f.pipelineId };
    const own = cost ? runCostLabel(f.runEngine, snap ? snap.costUsd : f.costUsd, fmtUsd, f.runEngines) : '';
    return { key: `run:${f.pipelineId}`, child: true, dot: runModel(snap?.run || { status: f.status }), text: `Auto-fix ${f.n}`,
      meta: [statusText(snap, f), own].filter(Boolean).join(' · '), title: `PR auto-fix run ${f.pipelineId}`,
      open: () => deps.go(snap ? progressRoute(ident, snap) : (f.href || progressRoute(ident, null))) };
  });
}

// ── a chat ─────────────────────────────────────────────────────────────────────────────────────────────
/** The chat Overview's sections (D6-D9): Environment, Context, Runs (then its quiet Mentioned group), Pull requests,
 *  Artifacts, Background. */
export function chatOverviewSections(threadId, deps) {
  const ap = deps.askPanel;
  const data = sharedFetch(`/api/ask/threads/${encodeURIComponent(threadId)}/overview`, deps);
  const mine = () => !!ap && ap.threadId() === threadId;
  const started = () => new Set((data.value?.runs || []).map((r) => r.pipelineId));
  const watch = (kinds, fn) => (ap && typeof ap.watch === 'function' ? ap.watch((k) => { if (kinds.includes(k)) fn(k); }) : null);

  const environment = {
    id: 'environment', label: 'Environment',
    async rows(signal) {
      const out = [];
      const scope = mine() ? ap.scope() : null;
      const p = scope?.projectKey ? deps.projectOf(scope.projectKey) : null;
      const w = !p && scope?.workspaceId ? deps.workspaceOf(scope.workspaceId) : null;
      if (scope?.projectKey) out.push({ key: 'project', icon: 'project', text: p?.name || scope.projectKey, meta: tilde(p?.path), title: p?.path });
      else if (scope?.workspaceId) out.push({ key: 'workspace', icon: 'workspace', text: w?.name || scope.workspaceId, meta: 'Workspace' });
      else out.push({ key: 'project', icon: 'project', text: 'No project', meta: '' });
      const facts = mine() ? ap.threadFacts() : null;
      const model = facts ? [facts.engineLabel, facts.modelLabel].filter(Boolean).join(' · ') : '';
      if (model) out.push({ key: 'model', icon: 'model', text: model });
      try {
        const f = (await data.get(signal))?.environment?.followedRun;
        if (f && f.branch) out.push({ key: 'branch', icon: 'git', text: f.branch, meta: f.title || '', title: `Branch of ${f.title || f.pipelineId}` });
      } catch { /* the rows above stay */ }
      return out;
    },
    subscribe: (redraw) => all(data.hook(redraw), watch(['thread'], redraw)),
  };

  let refreshed = false;
  const snapshot = () => {
    if (!mine() || ap.host() !== 'page') return null;
    const s = ap.contextSnapshot();
    return s && s.win != null ? s : null;
  };
  const context = {
    id: 'context', label: 'Context', collapsed: true,
    summary() {
      const s = snapshot();
      if (!s) return null;
      const fill = Number.isFinite(s.ctx) && s.win > 0 ? Math.min(100, (s.ctx / s.win) * 100) : null;
      return { text: s.pct != null ? `${s.pct}%` : '', meter: { pct: fill, level: s.level } };
    },
    body(host) {
      const s = snapshot();
      if (!s) return;
      renderContextDetails(host.ownerDocument, host, s, ap.contextActions, { menu: false });
      if (!refreshed) { refreshed = true; try { ap.contextActions.refresh(); } catch { /* the list stays */ } }
    },
    subscribe: (redraw) => watch(['context', 'thread'], redraw),
  };

  const known = new Set();
  const runs = {
    id: 'runs', label: 'Runs',
    async rows(signal) {
      const list = (await data.get(signal))?.runs || [];
      known.clear();
      const rs = deps.runStore;
      return list.flatMap((r) => {
        // The live store wins over the saved facts at draw time (R2: a fetch that lands after a poke never undoes it).
        const snap = liveOf(rs, r);
        known.add(r.runId);
        if (snap?.runId) known.add(snap.runId);
        const pill = runPill(snap || { status: r.status, source: 'rest' });
        const cost = snap ? snap.costUsd : r.costUsd;
        const costText = runCostLabel(r.runEngine, cost, fmtUsd, r.runEngines);   // "cost unknown" on an engine that reports none
        const ident = { runId: r.runId, pipelineId: r.pipelineId };
        return [{ key: `run:${r.pipelineId}`, icon: 'run', dot: runModel(snap?.run || { status: r.status, title: r.title }),
          text: snap?.title || r.title, meta: [pill.text, costText].filter(Boolean).join(' · '), title: r.branch ? `Branch ${r.branch}` : undefined,
          open: () => deps.go(snap ? progressRoute(ident, snap) : (r.href || progressRoute(ident, null))) },
        ...fixRows(r, deps, known, { cost: true })];
      });
    },
    subscribe(redraw) {
      const rs = deps.runStore;
      const unStore = rs && typeof rs.subscribe === 'function' ? rs.subscribe((runId, type) => {
        if (type === 'done') data.refetchSoon();
        if (known.has(runId)) redraw();          // a live status: drawn from the store, no fetch
      }) : null;
      return all(data.hook(redraw), unStore, watch(['links'], () => data.refetchSoon()));
    },
  };

  // Mentioned (at the end of Runs): the runs the chat followed, tracked or named but did not start. Quiet, collapsed by
  // default with a count; status, no cost; a mentioned run's auto-fixes under it.
  const knownMentioned = new Set();
  const mentioned = {
    id: 'mentioned', label: 'Mentioned', collapsed: true, quiet: true,
    async rows(signal) {
      const list = (await data.get(signal))?.mentioned || [];
      knownMentioned.clear();
      const rs = deps.runStore;
      return list.flatMap((r) => {
        const snap = liveOf(rs, r);
        knownMentioned.add(r.runId);
        if (snap?.runId) knownMentioned.add(snap.runId);
        const ident = { runId: r.runId, pipelineId: r.pipelineId };
        return [{ key: `run:${r.pipelineId}`, dot: runModel(snap?.run || { status: r.status, title: r.title }), text: snap?.title || r.title,
          meta: statusText(snap, r), title: MENTION_WHY[r.source] || undefined,
          open: () => deps.go(snap ? progressRoute(ident, snap) : (r.href || progressRoute(ident, null))) },
        ...fixRows(r, deps, knownMentioned, { cost: false })];
      });
    },
    subscribe(redraw) {
      const rs = deps.runStore;
      const unStore = rs && typeof rs.subscribe === 'function' ? rs.subscribe((runId) => { if (knownMentioned.has(runId)) redraw(); }) : null;
      return all(data.hook(redraw), unStore);
    },
  };

  const upgrades = new Map();   // refKey → { state, title } from the chip lookup
  let resolving = null;
  let redrawPrs = null;
  const prs = {
    id: 'prs', label: 'Pull requests',
    async rows(signal) {
      const list = (await data.get(signal))?.prs || [];
      const keys = list.map((p) => p.refKey).filter((k) => k && !upgrades.has(k));
      if (!resolving && keys.length && typeof deps.resolveRefs === 'function') {
        resolving = Promise.resolve().then(() => deps.resolveRefs(keys)).then((map) => {
          let any = false;
          for (const [k, v] of Object.entries(map || {})) if (v && typeof v === 'object') { upgrades.set(k, v); any = true; }
          if (any && redrawPrs) redrawPrs();
        }, () => { /* a failed lookup keeps the stored states */ });
      }
      return list.map((p) => prRow(p, p.title, p.refKey ? upgrades.get(p.refKey) : null));
    },
    subscribe(redraw) {
      redrawPrs = redraw;
      return all(data.hook(() => { resolving = null; redraw(); }), () => { redrawPrs = null; });
    },
  };

  const artifacts = {
    id: 'artifacts', label: 'Artifacts', limit: 5,
    async rows(signal) {
      const list = (await data.get(signal))?.artifacts || [];
      const items = list.filter((a) => a.source === 'shown').map((a) => ({ attId: a.attId, name: a.name, bytes: a.bytes, kind: a.kind, mime: a.mime }));
      return list.map((a) => {
        const meta = [formatBytes(a.bytes), ago(a.at, nowOf(deps))].filter(Boolean).join(' · ');
        if (a.source === 'design') {   // a design the chat holds or named: it opens as its design chat
          const kind = a.kind && Object.hasOwn(DESIGN_KIND_LABELS, a.kind) ? DESIGN_KIND_LABELS[a.kind] : 'Design';
          return { key: `design:${a.designId}`, icon: 'design', text: a.name, meta: [kind, ago(a.at, nowOf(deps))].filter(Boolean).join(' · '),
            title: `${kind}: open the design`, ...(typeof deps.openDesign === 'function' ? { open: () => deps.openDesign(a.designId) } : {}) };
        }
        if (a.source === 'out') {
          return { key: `out:${a.path}`, icon: 'file', text: a.path, meta, title: `Saved by the chat: ${a.path}`, open: () => deps.openOutFile(threadId, a.path) };
        }
        const index = items.findIndex((x) => x.attId === a.attId);
        const item = items[index];
        return { key: `att:${a.attId}`, icon: 'file', text: a.name, meta, title: 'Shown in the chat',
          open: () => {
            // The Overview sits in the panel and reads no setting (clarify answer 2): a non-image opens the chat copy in a
            // Files tab, an image or svg the pop-up, exactly as the files card does with the setting on.
            const action = fileCardAction({ preview: filePreviewOf(item), enabled: true });
            if (action === 'panel') deps.openInPanel({ threadId, item });
            else deps.openFiles({ threadId, items, index });
          } };
      });
    },
    note: () => (data.value && data.value.artifactsTotal > OVERVIEW_LIMIT ? `Showing the newest ${OVERVIEW_LIMIT} of ${data.value.artifactsTotal}` : null),
    subscribe: (redraw) => all(data.hook(redraw), watch(['cards'], () => data.refetchSoon())),
  };

  const background = {
    id: 'background', label: 'Background', tick: 1000,
    rows() {
      const out = [];
      for (const c of mine() ? ap.runningCommands() : []) {
        out.push({ key: `cmd:${c.blockId}`, icon: 'terminal', text: c.command, meta: fmtCmdDur(since(deps, c.startedAt)),
          ...(c.sessionId ? { open: () => deps.showSession(c.sessionId), stop: { label: 'Stop', run: () => ap.stopCommand(c.sessionId) } } : {}) });
      }
      const ids = started();
      for (const s of deps.actionsRunning() || []) if (s && ids.has(s.runId)) out.push(actionRow(s, deps));
      return out;
    },
    subscribe(redraw) {
      const unActions = typeof deps.onActions === 'function' ? deps.onActions(redraw) : null;
      return all(watch(['commands', 'thread'], redraw), unActions, data.hook(redraw, { value: true }));
    },
  };

  return [environment, context, runs, mentioned, prs, artifacts, background];
}

// ── a run ──────────────────────────────────────────────────────────────────────────────────────────────
/** A run's Overview (D10): Environment (status, branch, project, checkout), Pull request, Artifacts, Background. */
export function runOverviewSections(scope, deps) {
  const pid = scope.id;
  const data = sharedFetch(`/api/ask/runs/${encodeURIComponent(pid)}`, deps);
  const live = () => (deps.runStore ? deps.runStore.byPipeline(pid) : null);
  const row = () => (typeof deps.historyRow === 'function' ? deps.historyRow(pid) : null);
  const environment = {
    id: 'environment', label: 'Environment',
    async rows(signal) {
      let body = null;
      try { body = await data.get(signal); } catch { body = null; }
      const snap = live();
      const h = row();
      const status = snap?.status || body?.state?.status || h?.status || null;
      const out = [];
      if (status) out.push({ key: 'status', icon: 'run', dot: runModel(snap?.run || h || { status }), text: runPill(snap || { status, source: 'rest' }).text });
      const branch = snap?.branch || h?.branch || body?.state?.branch?.feature || '';
      if (branch) out.push({ key: 'branch', icon: 'git', text: branch, meta: 'Branch' });
      if (scope.workspaceId) { const w = deps.workspaceOf(scope.workspaceId); out.push({ key: 'workspace', icon: 'workspace', text: w?.name || scope.workspaceId, meta: 'Workspace' }); }
      else if (scope.projectKey) { const p = deps.projectOf(scope.projectKey); out.push({ key: 'project', icon: 'project', text: p?.name || 'No project', meta: tilde(p?.path), title: p?.path }); }
      const co = (h?.checkout?.members || []).find((m) => m && m.worktreeDir);
      if (co) out.push({ key: 'checkout', icon: 'folder', text: 'Checked out', meta: tilde(co.worktreeDir), title: co.worktreeDir });
      return out;
    },
    subscribe(redraw) {
      const rs = deps.runStore;
      const un = rs && typeof rs.subscribe === 'function' ? rs.subscribe((runId) => { const s = live(); if (s && s.runId === runId) redraw(); }) : null;
      return all(un, data.hook(redraw));
    },
  };
  const pr = {
    id: 'pr', label: 'Pull request',
    async rows(signal) {
      const p = (await data.get(signal))?.extras?.pr;
      if (!p || !p.url) return [];
      const title = live()?.title || row()?.title || '';
      return [prRow({ url: p.url, state: prStateOf(p) }, title)];
    },
  };
  const artifacts = {
    id: 'artifacts', label: 'Artifacts', limit: 5,
    async rows(signal) {
      const list = (await data.get(signal))?.extras?.artifacts || [];
      return list.map((a) => ({ key: `art:${a.relPath}:${a.cycle ?? ''}`, icon: 'file', text: a.relPath, meta: formatBytes(a.bytes),
        open: () => deps.openRunArtifact({ pipelineId: pid, runId: live()?.runId || null }, a) }));
    },
  };
  const background = {
    id: 'background', label: 'Background', tick: 1000,
    rows: () => (deps.actionsRunning() || []).filter((s) => s && s.runId === pid).map((s) => actionRow(s, deps)),
    subscribe: (redraw) => (typeof deps.onActions === 'function' ? deps.onActions(redraw) : () => {}),
  };
  return [environment, pr, artifacts, background];
}

// ── a project ──────────────────────────────────────────────────────────────────────────────────────────
/** A project page's Overview (D10): its recent runs (live first, then History; at most 10) and their pull requests. */
export function projectOverviewSections(projectKey, deps) {
  const recent = () => {
    const out = [];
    const seen = new Set();
    for (const snap of deps.liveRunsOf(projectKey) || []) {
      if (!snap || out.length >= RECENT) break;
      if (snap.pipelineId) seen.add(snap.pipelineId);
      out.push({ snap });
    }
    for (const h of deps.historyRows(projectKey) || []) {
      if (out.length >= RECENT) break;
      if (!h || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push({ h });
    }
    return out;
  };
  const subscribeStore = (redraw) => (deps.runStore && typeof deps.runStore.subscribe === 'function' ? deps.runStore.subscribe(() => redraw()) : () => {});
  const runs = {
    id: 'runs', label: 'Recent runs',
    rows: () => recent().map(({ snap, h }) => (snap
      ? { key: `live:${snap.runId}`, icon: 'run', dot: runModel(snap.run || snap), text: snap.title || 'Run', meta: runPill(snap).text,
        open: () => deps.go(progressRoute({ runId: snap.runId, pipelineId: snap.pipelineId }, snap)) }
      : { key: `hist:${h.id}`, icon: 'run', dot: runModel(h), text: h.title || h.id,
        meta: [runPill({ status: h.status, source: 'rest' }).text, h.startedAt ? ago(h.startedAt, nowOf(deps)) : ''].filter(Boolean).join(' · '),
        open: () => deps.go(`#history/${projectKey}/${h.id}`) })),
    subscribe: subscribeStore,
  };
  const prs = {
    id: 'prs', label: 'Pull requests',
    rows: () => recent().filter(({ h }) => h && h.pr && h.pr.url).slice(0, RECENT)
      .map(({ h }) => prRow({ url: h.pr.url, state: prStateOf(h.pr) }, h.title)),
    subscribe: subscribeStore,
  };
  return [runs, prs];
}

/** The view's sections: a chat side → the chat's; a run side → the run's; a project page → the project's; else null. */
export function overviewSourceFor(view, deps) {
  if (!view) return null;
  if (view.side && view.side.type === 'chat') return chatOverviewSections(view.side.id, deps);
  if (view.side && view.side.type === 'run') return runOverviewSections(view.side, deps);
  if (!view.side && view.project && !view.blocked) return projectOverviewSections(view.project, deps);
  return null;
}
