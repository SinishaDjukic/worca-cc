// ui/public/ask-context-view.mjs — the ONE Context renderer (issue 1064, Overview D4): the composer's context popover
// and the tool panel Overview's Context section draw the same window bar, stats, topics, agents and worktrees from
// one data object. `menu: true` is the popover (menu rows), `menu: false` the Overview (plain buttons). Pure DOM: the
// panel computes the data (and the Expert/git gating) and passes the actions.
import { fmtTokens, CTX_COST_HINT, kTok, fmtWindow, fmtCtx, fmtShare, ctxBreakdown, fmtUsd } from './ask-meter.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PIN = ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'];
const TRASH = 'M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7';

/** A context chip's in-app route, or null when it has none (a run with no known home). */
export function contextHref(c) {
  const e = encodeURIComponent;
  if (c.kind === 'project') return `#projects/${e(c.id)}`;
  if (c.kind === 'workspace') return `#workspaces/${e(c.id)}`;
  if (c.kind === 'page') return `#${e(c.id)}`;
  if (c.kind === 'run' && typeof c.home === 'string' && c.home) return `#history/${c.home.split('/').map(e).join('/')}/${e(c.id)}`;
  return null;
}

export const validContexts = (list) => (Array.isArray(list) ? list : [])
  .filter((c) => c && typeof c.kind === 'string' && typeof c.id === 'string' && c.id);
/** A chat's topics split for the popover: where it was asked from (page) and what it mentioned (source 'chat'). */
export function groupContexts(list) {
  const all = validContexts(list);
  return { asked: all.filter((c) => c.source !== 'chat'), mentioned: all.filter((c) => c.source === 'chat') };
}

export function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

/** The context ring: a track and an arc on a 100-unit path, so stroke-dasharray "<fill%> 100" draws the fill. */
export function ctxRing(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['ask-ctx-ring-track', 'ask-ctx-ring-arc']) {
    const c = doc.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '8');
    c.setAttribute('cy', '8');
    c.setAttribute('r', '6');
    c.setAttribute('stroke-width', '2.5');
    svg.appendChild(c);
  }
  const arc = svg.lastChild;
  arc.setAttribute('pathLength', '100');
  arc.setAttribute('transform', 'rotate(-90 8 8)');   // the fill starts at 12 o'clock
  arc.setAttribute('stroke-dasharray', '0 100');
  return svg;
}

/** Paints a ctxRing: `pct` is the fill (0-100, full past the window; null = empty), `level` 'warn' | 'high' | other. */
export function paintCtxRing(svg, { pct = null, level = null } = {}) {
  if (!svg) return;
  const arc = svg.querySelector('.ask-ctx-ring-arc');
  const fill = Number.isFinite(pct) ? +Math.max(0, Math.min(100, pct)).toFixed(2) : 0;
  if (arc) arc.setAttribute('stroke-dasharray', `${fill} 100`);
  svg.classList.toggle('is-ctx-warn', level === 'warn');
  svg.classList.toggle('is-ctx-high', level === 'high');
}

const levelClass = (level) => (level === 'warn' || level === 'high' ? ` is-ctx-${level}` : '');
const wtShortSha = (c) => (typeof c === 'string' ? c.slice(0, 7) : '');

/**
 * The context window's details into `host` (emptied first): caption, then the window's bar / rows / footer (or one
 * line while the window is unknown), then the topics, the agents and (while there are any) the worktrees.
 * data = { ctx, win, turns, contexts, agents, worktrees, showAgents, showWorktrees, now? }
 * actions = { openTopic(href), removeWorktree(w), copyPath(path) }
 * `menu: true`: the composer popover's rows (role="menuitem"); `menu: false`: plain buttons (the Overview).
 */
export function renderContextDetails(doc, host, data, actions = {}, { menu = true } = {}) {
  const d = data || {};
  const make = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgIcon = (dd, size, sw) => {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(sw));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const part of Array.isArray(dd) ? dd : [dd]) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', part);
      svg.appendChild(path);
    }
    return svg;
  };
  const item = (className, onPick) => {
    const b = make('button', menu ? `menu-item ask-pop-item ${className}` : className);
    b.type = 'button';
    if (menu) { b.setAttribute('role', 'menuitem'); b.tabIndex = -1; }
    if (onPick) b.addEventListener('click', onPick);
    return b;
  };
  const call = (name, ...args) => { if (typeof actions[name] === 'function') actions[name](...args); };
  const now = typeof d.now === 'function' ? d.now : () => Date.now();

  /** A section under its own divider, captioned "<title>" with a meter on the right. Expert-only sections carry the
   *  level on the box, so the divider hides with them. */
  function popSection(className, title, meter, minLevel) {
    const box = make('div', className);
    if (minLevel) box.dataset.minLevel = minLevel;
    box.appendChild(make('div', 'ask-pop-divider'));
    const head = make('div', 'ask-pop-caption-row');
    head.appendChild(make('span', 'ask-pop-caption', title));
    head.appendChild(make('span', 'ask-pop-caption-meter', meter));
    box.appendChild(head);
    return box;
  }
  /** One topic row: a row that routes (a menuitem in the popover), or a plain row when it has no route. */
  function topicRow(c) {
    const href = contextHref(c);
    const mentioned = c.source === 'chat';                       // only a page topic is ever pinned
    const pinned = c.pinned && !mentioned;
    const row = href ? item('ask-ctx-topic', () => call('openTopic', href)) : make('div', 'ask-ctx-topic');
    if (mentioned) row.classList.add('is-mentioned');
    if (pinned) row.classList.add('is-pinned');
    row.dataset.kind = c.kind;
    row.title = `${c.label || c.id}${mentioned ? ' (mentioned)' : pinned ? ' (pinned)' : ''}`;   // the full name when it is cut off; History's wording
    row.appendChild(make('span', 'ask-ctx-swatch'));
    row.appendChild(make('span', 'ask-ctx-topic-name', c.label || c.id));
    if (pinned) {
      row.appendChild(svgIcon(PIN, 11, 2));
      row.appendChild(make('span', 'ask-ctx-topic-pin', 'pinned'));
    }
    row.appendChild(make('span', 'ask-ctx-topic-kind', c.kind));
    return row;
  }
  function topicsSection() {
    const box = make('div', 'ask-ctx-topics');
    const { asked, mentioned } = groupContexts(d.contexts);
    const total = asked.length + mentioned.length;
    const head = make('div', 'ask-pop-caption-row');
    head.appendChild(make('span', 'ask-pop-caption', 'Topics'));
    head.appendChild(make('span', 'ask-pop-caption-meter', total ? String(total) : ''));
    box.appendChild(head);
    if (!total) { box.appendChild(make('div', 'ask-pop-empty', 'No topics yet.')); return box; }
    for (const [key, label, list] of [['asked', 'Asked from', asked], ['mentioned', 'Mentioned in chat', mentioned]]) {
      if (!list.length) continue;
      const g = make('div', 'ask-ctx-topic-group');
      g.dataset.ctxGroup = key;
      g.appendChild(make('div', 'ask-ctx-group', label));
      for (const c of list) g.appendChild(topicRow(c));
      box.appendChild(g);
    }
    return box;
  }
  /** The chat's sub-agents, one row each (the panel rebuilds on every meters flush, so rows move while agents run). */
  function agentsSection() {
    const agents = Array.isArray(d.agents) ? d.agents : [];
    // Count and cost: costs sum across agents; context fills do not.
    const cost = agents.reduce((n, a) => n + (Number.isFinite(a.costUsd) ? a.costUsd : 0), 0);
    const box = popSection('ask-ctx-agents', 'Agents', agents.length ? `${agents.length} · ≈${fmtUsd(cost)}` : '', 'expert');
    if (!agents.length) { box.appendChild(make('div', 'ask-pop-empty', 'No agents spawned yet.')); return box; }
    for (const a of agents) {
      const row = make('div', 'ask-runinfo-row');
      row.appendChild(make('span', `ask-dot${a.status === 'running' ? ' ask-dot-run' : a.status === 'done' ? ' ask-dot-done' : ''}`));
      const col = make('span', 'ask-runinfo-col');
      col.appendChild(make('span', 'ask-runinfo-name', a.label || a.type || 'agent'));
      const sub = make('span', 'ask-runinfo-sub', [a.model, fmtCtx(a.ctx, a.ctxWindow) || fmtTokens(a.tokens), Number.isFinite(a.costUsd) ? `≈${fmtUsd(a.costUsd)}` : null, a.status || null].filter(Boolean).join(' · '));
      sub.title = sub.textContent;                                // one line in the popover; the whole of it on hover
      col.appendChild(sub);
      row.appendChild(col);
      row.appendChild(make('span', 'ask-runinfo-elapsed', fmtElapsed(a.durationMs) || '—'));
      box.appendChild(row);
    }
    return box;
  }
  function renderWorktreeRows(panel, list) {
    for (const w of list) {
      const row = make('div', 'ask-runinfo-row ask-wt-row');
      const col = make('span', 'ask-runinfo-col');
      col.appendChild(make('span', 'ask-runinfo-name', `${w.projectKey} · ${w.ref}@${wtShortSha(w.commit)}`));
      const path = make('span', 'ask-runinfo-sub ask-wt-path', w.path);
      path.title = 'Click to copy';
      path.addEventListener('click', () => call('copyPath', w.path));
      col.appendChild(path);
      row.appendChild(col);
      // AGE (spec §10 row: project · ref@sha7 · AGE · path · trash). Reuses the run-info popover's
      // `.ask-runinfo-elapsed` cell — its `margin-left:auto` also right-aligns the trash that follows.
      row.appendChild(make('span', 'ask-runinfo-elapsed', w.createdAt ? fmtElapsed(now() - Date.parse(w.createdAt)) : '—'));
      const trash = make('button', 'ask-thread-trash');
      trash.type = 'button';
      trash.setAttribute('aria-label', `Remove worktree ${w.worktreeId}`);
      trash.appendChild(svgIcon(TRASH, 14, 1.8));
      trash.addEventListener('click', (e) => { e.stopPropagation(); call('removeWorktree', w); });
      row.appendChild(trash);
      panel.appendChild(row);
    }
  }
  /** The chat's open worktrees, or null while it has none (or git is off). */
  function worktreesSection() {
    const list = Array.isArray(d.worktrees) ? d.worktrees : [];
    if (!list.length || !d.showWorktrees) return null;
    const box = popSection('ask-ctx-worktrees', 'Worktrees', String(list.length), 'expert');
    renderWorktreeRows(box, list);
    return box;
  }

  host.replaceChildren();
  const ctx = d.ctx;
  const win = d.win;
  const b = ctxBreakdown(ctx, win);
  const head = make('div', 'ask-pop-caption-row');
  head.appendChild(make('span', 'ask-pop-caption', 'Context window'));
  head.appendChild(make('span', 'ask-pop-caption-meter', b ? `${kTok(ctx)} / ${fmtWindow(win)} (${b.pct}%)` : (ctx > 0 ? kTok(ctx) : '')));
  host.appendChild(head);
  if (!b) {
    host.appendChild(make('div', 'ask-pop-empty', 'The window shows after the first answer.'));
  } else {
    const bar = make('div', 'ask-ctx-bar');
    bar.setAttribute('aria-hidden', 'true');               // the rows below carry the numbers
    const used = make('span', `ask-ctx-bar-used${levelClass(b.level)}`);
    used.style.width = `${+Math.min(100, (ctx / win) * 100).toFixed(2)}%`;
    bar.appendChild(used);
    // The hatch covers only the window the fill has not reached, so past the compaction point it shrinks
    // instead of painting over the fill (the row below still reports the whole buffer).
    const hatch = Math.min(b.buffer, Math.max(0, win - ctx));
    if (hatch > 0) {
      const buf = make('span', 'ask-ctx-bar-buffer');
      buf.style.width = `${+((hatch / win) * 100).toFixed(2)}%`;
      bar.appendChild(buf);
    }
    host.appendChild(bar);
    const rows = [['used', 'Used', b.used], ['buffer', 'Autocompact buffer', b.buffer], ['free', 'Free space', b.free]];
    for (const [key, name, n] of rows) {
      if (key === 'buffer' && n <= 0) continue;
      const r = make('div', `ask-ctx-stat${key === 'used' ? levelClass(b.level) : ''}`);
      r.dataset.stat = key;
      r.appendChild(make('span', 'ask-ctx-swatch'));
      r.appendChild(make('span', 'ask-ctx-stat-name', name));
      r.appendChild(make('span', 'ask-ctx-stat-tokens', kTok(n)));
      r.appendChild(make('span', 'ask-ctx-stat-share', fmtShare(n, win)));
      host.appendChild(r);
    }
    host.appendChild(b.level === 'high'
      ? make('div', 'ask-ctx-foot is-ctx-high', 'Compaction soon')
      : make('div', 'ask-ctx-foot', `${kTok(b.untilCompact)} until auto-compact`));
  }
  if (ctx >= CTX_COST_HINT) host.appendChild(make('div', 'ask-ctx-hint', `Each message re-sends about ${(ctx / 1000).toFixed(1)}k tokens.`));
  host.appendChild(make('div', 'ask-pop-divider'));
  host.appendChild(topicsSection());
  if (d.showAgents !== false) host.appendChild(agentsSection());
  const wts = worktreesSection();
  if (wts) host.appendChild(wts);
}
