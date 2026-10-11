// ui/public/topnav.mjs — the top bar's page name. Pure: no DOM and no app state. app.js
// (paintTopnavTitle) writes pageTitle(<route>) into #topnav-title on every showView, so the
// bar names the open page and the pages themselves carry no title of their own.
//
// A page's name is its sidebar label. The exceptions: New run (no sidebar row — the bar's own
// button opens it), the three Runs routes (#runs, #running/<id>, #history/<key>/<id>), and the
// pages the sidebar does not list (Getting started, the two wizards, Settings).

/** Route (a showView name) -> the name the top bar shows. test/ui-topnav.test.mjs keeps it in
 *  step with the sidebar labels in index.html and with app.js#VIEW_NAMES. */
export const PAGE_TITLES = Object.freeze({
  new: 'New run',
  'getting-started': 'Getting started',
  runs: 'Runs',
  running: 'Runs',
  history: 'Runs',
  schedules: 'Schedules',
  stats: 'Statistics',
  'team-metrics': 'Team metrics',
  workflows: 'Workflows',
  marketplace: 'Marketplace',
  connectors: 'Connectors',
  models: 'Models',
  providers: 'Providers',
  projects: 'Projects',
  workspaces: 'Workspaces',
  'team-policy': 'Team policy',
  'workspace-create': 'New workspace',
  settings: 'Settings',
});

/** The top bar's title for route `view`; 'Worca' for a route it does not know. */
export function pageTitle(view) {
  return Object.prototype.hasOwnProperty.call(PAGE_TITLES, view) ? PAGE_TITLES[view] : 'Worca';
}
