// tools/parity/crawl-routes.mjs — every hash route the app registers (D5). Top-level views and settings cards come from the
// served modules (topnav.mjs PAGE_TITLES, settings-index.mjs SETTING_ENTRIES); tab lists app.js keeps private are read from
// its source by name. Params are filled from the seed; a route that cannot be filled is "unfillable" and fails the run.
// Every *_TABS list in app.js today (app.js line): WS_TABS 9399, WD_TABS 9539, PROJ_TABS 13109, PD_TABS 13358, TP_TABS 21197,
// HD_TABS 27232, RD_TABS 29302, SETTINGS_TABS 38586, SETTINGS_FORM_TABS 38589. A wrong pattern is not silent: its routes
// never render, so coverage lists them as unvisited and the run fails (D6).
export const TAB_ROUTES = {
  SETTINGS_TABS: (t) => (t === 'general' ? ['#settings'] : [`#settings/${t}`]),
  SETTINGS_FORM_TABS: () => [],   // the subset of SETTINGS_TABS painted from GET /api/settings: same routes, no new ones
  PROJ_TABS: (t, s) => [`#projects/${s.projectKey}/${t}`],
  PD_TABS: (t, s) => [`#projects/${s.projectKey}/${t}`],        // project detail's object list (key:); same hash space as PROJ_TABS
  WS_TABS: (t, s) => [`#workspaces/${s.workspaceId}/${t}`],
  WD_TABS: (t, s) => [`#workspaces/${s.workspaceId}/${t}`],     // workspace detail's object list (key:)
  HD_TABS: (t, s) => [`#history/${s.projectKey}/${s.pipelineId}/details/${t}`],   // hdHash(…, 'details', tab), app.js:23453
  RD_TABS: (t) => [`#running/{held}/details/${t}`],
  GROUP_TABS: (t, s) => [`#group/${s.groupId}/${t}`, `#feature/${s.featureId}/${t}`],
  TP_TABS: () => [],          // in-page tabs on #team-policy: exercised as elements, not routes
};
// PD/WD share the PROJ/WS hash space (parseProjParam app.js:13110, parseWsParam :9402); RD is runDetailParts (:34551).
// test/parity-crawl.test.mjs fails the moment a new *_TABS list appears in app.js without a mapping.
// Routes no list names (schedules tabs, workflows/agents/scripts sub-pages, marketplace, connectors, models, providers,
// chat/new, chat run panel, requirements sub-pages, team-metrics/timeline). Each is pinned to a string in app.js by a test.
/** PAGE_TITLES views that are only ever a detail page: bare `#feature` falls back to Chat ("Unknown address"). */
export const VIEW_ROUTES = { feature: '#feature/{featureId}' };
export const STATIC_ROUTES = ['#chat/new', '#chat/{threadId}', '#chat/{threadId}/run/{runId}', '#new', '#new/schedule', '#getting-started', '#runs',
  '#running/{held}', '#history/{projectKey}/{pipelineId}', '#schedules', '#schedules/once', '#schedules/repeating', '#stats', '#team-metrics',
  '#team-metrics/timeline', '#team-policy', '#team-policy/project:{projectKey}', '#workflows', '#workflows/{workflowId}', '#workflows/agents',
  '#workflows/agents/new', '#workflows/agents/{agentKey}', '#workflows/agents/{agentKey}/edit', '#workflows/scripts', '#workflows/scripts/new',
  '#workflows/scripts/{scriptKey}', '#requirements', '#requirements/new', '#requirements/feature/{requirementN}', '#workspaces', '#workspace-create',
  '#projects', '#projects/{projectKey}/memory/{memoryName}', '#marketplace/installed/{pluginName}', '#marketplace/browse/{marketplaceId}/{pluginName}',
  '#connectors', '#connectors/servers', '#connectors/servers/{mcpServerId}', '#connectors/skills', '#connectors/sets/{skillSetId}', '#models',
  '#models/model/{modelId}', '#providers', '#providers/copilot', '#providers/openai', '#providers/anthropic', '#providers/speech'];

/**
 * Plain string lists (`['general', 'tags']`) give their strings. Object lists (`[{ key: 'overview', label: …, level: … }]`)
 * give their `key:` values only: their labels, levels, flag names and comments are quoted strings too.
 */
export function tabListsOf(appJs) {
  const out = {};
  for (const m of appJs.matchAll(/\bconst ([A-Z][A-Z0-9_]*_TABS)\s*=\s*\[([\s\S]*?)\];/g)) {
    const body = m[2].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    out[m[1]] = body.includes('{') ? [...body.matchAll(/\bkey:\s*'([\w-]+)'/g)].map((x) => x[1]) : [...body.matchAll(/'([\w-]+)'/g)].map((x) => x[1]);
  }
  return out;
}

/**
 * { registered: [hash…], unfillable: [pattern…] }. `views` from PAGE_TITLES, `cards` from SETTING_ENTRIES[].href,
 * `groupTabs` is group-page.mjs GROUP_TABS as given ([id, label] pairs), `marketplaceTabs` is marketplace/page.mjs TABS.
 */
export function catalogue({ appJs, views, cards, groupTabs = [], marketplaceTabs = [], ids }) {
  const lists = { ...tabListsOf(appJs), GROUP_TABS: groupTabs.map((t) => (Array.isArray(t) ? t[0] : t)) };
  const pats = [...views.map((v) => VIEW_ROUTES[v] ?? `#${v}`), ...cards, ...marketplaceTabs.map((t) => `#marketplace/${t}`), ...STATIC_ROUTES];
  for (const [name, tabs] of Object.entries(lists)) {
    if (!(name in TAB_ROUTES) || TAB_ROUTES[name] === null) throw new Error(`crawl: unmapped tab list ${name} in app.js; map it in TAB_ROUTES`);
    for (const t of tabs) pats.push(...TAB_ROUTES[name](t, new Proxy(ids, { get: (o, k) => (k in o ? o[k] : `{${String(k)}}`) })));
  }
  const fill = (p) => p.replace(/\{(\w+)\}/g, (all, k) => (k === 'held' ? all : ids[k] ?? all));
  const filled = [...new Set(pats.map(fill))];
  return { registered: filled.filter((p) => !/\{(?!held\})\w+\}/.test(p)), unfillable: filled.filter((p) => /\{(?!held\})\w+\}/.test(p)) };
}
