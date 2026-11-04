// src/shared/ask-where.mjs — which page a chat context names ("on Run · Diff"): a label and an icon (a key of
// ui/public/icons.mjs ICONS). Pure and import-free: the server writes it on the user row (ui/server.mjs startAskTurn,
// the `where` block) and the browser names the composer's page chip with it (ui/public/ask-page-chips.mjs).

const page = (label, icon) => Object.freeze({ label, icon });

/** Every view with a top bar but Chat and Workflows (app.js VIEW_NAMES, plus the resolved detail kinds). */
export const WHERE_PAGES = Object.freeze({
  runs: page('Runs', 'run'),
  history: page('Runs', 'run'),
  running: page('Run', 'run'),
  'history-detail': page('Run', 'run'),
  feature: page('Group', 'run'),
  group: page('Group', 'run'),
  schedules: page('Schedules', 'schedule'),
  stats: page('Statistics', 'metrics'),
  'team-metrics': page('Team metrics', 'metrics'),
  'team-policy': page('Team policy', 'shield'),
  requirements: page('Requirements', 'shape'),
  marketplace: page('Marketplace', 'bag'),
  connectors: page('Connectors', 'plug'),
  models: page('Models', 'cube'),
  providers: page('Providers', 'layers'),
  projects: page('Projects', 'project'),
  'project-detail': page('Project', 'project'),
  workspaces: page('Workspaces', 'workspace'),
  'workspace-create': page('New workspace', 'workspace'),
  new: page('New run', 'play'),
  settings: page('Settings', 'gear'),
  'getting-started': page('Getting started', 'question'),
});

/** A run page's part (prompt.mjs RUN_PAGE_PARTS) as the caption names it; the glance has none. */
export const RUN_PART_LABELS = Object.freeze({
  overview: 'Overview', diff: 'Diff', changes: 'Changes', artifacts: 'Artifacts', actions: 'Actions', workflow: 'Workflow',
  qa: 'Q&A', clarify: 'Q&A', logs: 'Logs', sessions: 'Sessions', agents: 'Agents',
});

const RUN_VIEWS = new Set(['running', 'history-detail']);

/** `{ label, icon }` for the page a context names, or null (no context, Chat, Workflows, an unknown view). */
export function whereOf(ctx) {
  if (!ctx || typeof ctx !== 'object' || typeof ctx.view !== 'string') return null;
  if (!Object.hasOwn(WHERE_PAGES, ctx.view)) return null;
  const base = WHERE_PAGES[ctx.view];
  if (RUN_VIEWS.has(ctx.view)) {
    const part = typeof ctx.runPage === 'string' && Object.hasOwn(RUN_PART_LABELS, ctx.runPage) ? RUN_PART_LABELS[ctx.runPage] : '';
    return { label: part ? `${base.label} · ${part}` : base.label, icon: ctx.runPage === 'diff' ? 'diff' : base.icon };
  }
  if (ctx.view === 'workspaces' && typeof ctx.pageWorkspaceId === 'string' && ctx.pageWorkspaceId) return { label: 'Workspace', icon: base.icon };
  return { label: base.label, icon: base.icon };
}
