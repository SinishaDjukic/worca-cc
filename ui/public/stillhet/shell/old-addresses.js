// ui/public/stillhet/shell/old-addresses.js — dev's old addresses with Stillhet on (docs/stillhet/navigation.md nav.old-address,
// plans/stillhet/stillhet-wiring.md Moves). One table for the app and the prototype: window.StillhetOldAddresses = { TABLE,
// resolve(hash) }. resolve answers null for every Stillhet address, else { hash, pulse }: where the thing lives now, and a
// Pulse tab to open there ('' for none). shell.js route() asks it first and replaces the address in place, so Back never
// loops. Dev's own router (app.js MOVED_ROUTES) is untouched; with Stillhet off these addresses stay dev's.
(function () {
  // [old place, new address, what the tail becomes]. The old place matches itself and anything under it (`old/…`).
  // tail: 'root' drops it; 'ws' carries it as a workspace in Projects; 'way' carries a Workflows way when it has one;
  // 'tab' matches only the old tabs under a place that kept its name; 'task' keeps the task id (the first segment, or History's KEY/PID's PID, before any tab): the task page. A History address without
  // its PID names no task, so it lands on Tasks. 'group' keeps a feature's or group's id: its group page, #run/group:ID (a
// re-planned feature follows to its newest there, task-live.mjs group); a Run-after chain lands on its first task or Schedules.
  var TABLE = [
    ['stats', 'insights/spend'], ['statistics', 'insights/spend'],
    ['team-metrics', 'insights/team'],
    ['pipelines', 'runs'], ['running', 'runs', 'task'], ['history', 'runs', 'task'], ['feature', 'runs', 'group'], ['group', 'runs', 'group'],
    ['activity', 'chat', 'root', 'now'],
    ['connectors', 'settings/connectors'], ['settings/mcp', 'settings/connectors'],
    ['models', 'settings/models'], ['providers', 'settings/models'], ['settings/providers', 'settings/models'],
    ['team-policy', 'settings/team'],
    ['workspaces', 'projects', 'ws'], ['workspace-create', 'projects'],
    ['new', 'chat'], ['getting-started', 'chat'], ['chat/new', 'chat'],
    ['plugins', 'marketplace'],
    ['guardrails', 'settings/guardrails'],
    ['schedules', 'schedules', 'tab'],   // dev's Schedules tabs (#schedules/once, /repeating, /activity): the one Schedules place (D12); bare #schedules is Stillhet's own
    ['composer', 'workflows'], ['agents', 'workflows', 'way', '', '~agents'], ['scripts', 'workflows', 'way', '', '~scripts'], ['agent-create', 'workflows', 'way', '', '~agents'],
    ['workflows', 'workflows', 'dev-workflows'],   // dev's own Workflows forms (app.js routeWorkflows); Stillhet's are never touched
    ['marketplace', 'marketplace', 'dev-marketplace'],   // dev's own Marketplace forms (app.js enterMarketplace); Stillhet's are never touched
    ['projects', 'projects', 'dev-projects'],   // dev's project tabs (app.js PROJ_TABS); Stillhet's own Projects routes are never touched
  ];
  // 'dev-workflows' (slice 7 D18): dev's ten forms, to fixed places (it never asks `has`). A bare #workflows, a ~way and a
  // kind:id route are Stillhet's own and stay as they are.
  var STILLHET_WF = /^(~|(workflow|agent|script|edit):)/;
  function devWorkflows(segs) {
    if (!segs.length || STILLHET_WF.test(segs[0])) return null;
    var head = segs[0], key = segs[1];
    if (head === 'agents') return !key || key === 'new' ? 'workflows/~agents' : 'workflows/agent:' + key;
    if (head === 'scripts') return !key || key === 'new' ? 'workflows/~scripts' : 'workflows/script:' + key;
    return 'workflows/workflow:' + head;
  }
  // 'dev-marketplace' (slice 8 D16): dev's tabs and its plugin targets, to fixed places (it never asks `has`). A bare
  // #marketplace, a ~way and a plugin id are Stillhet's own and stay as they are.
  function devMarketplace(segs) {
    var head = segs[0];
    if (head === 'marketplaces') return 'marketplace';
    if (head === 'installed') return segs[1] ? 'marketplace/' + dec(segs[1]) : 'marketplace/~installed';
    if (head === 'browse') return segs[2] ? 'marketplace/' + dec(segs[2]) : 'marketplace/~all';
    return null;
  }
  // 'dev-projects' (slice 9 D17): dev's project tabs land on the project's page, a stopgap until Settings › Projects (slice 12)
  // gives each a home. Only the tail after KEY is read; a bare #projects, #projects/KEY, ws:ID, KEY@ID and any other tail
  // are Stillhet's own (it never asks `has`).
  var DEV_PROJECT_TABS = ['team', 'settings', 'mcp', 'actions', 'automations', 'away', 'memory'];
  function devProjects(segs) {
    if (segs.length < 2 || /^ws:/.test(segs[0]) || DEV_PROJECT_TABS.indexOf(segs[1]) < 0) return null;
    return 'projects/' + segs[0];
  }
  var dec = function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } };
  var workflowsHas = function (a) { var w = typeof window !== 'undefined' && window.StillhetPlaces && window.StillhetPlaces.workflows; return !!(w && w.has && w.has(a)); };

  /** null, or { hash: '#…', pulse: '' | 'now' }. `has` asks Workflows whether it has a way (default: the page's own). */
  function resolve(hash, opts) {
    var path = String(hash || '').replace(/^#/, '');
    if (!path) return null;
    var has = (opts && opts.has) || workflowsHas;
    for (var i = 0; i < TABLE.length; i++) {
      var row = TABLE[i], from = row[0];
      if (path !== from && path.indexOf(from + '/') !== 0) continue;
      if (row[2] === 'tab' && path === from) continue;   // only the old tabs under it, never the place itself
      var tail = path.slice(from.length + 1), to = row[1];
      if (row[2] === 'ws' && tail) to += '/ws:' + tail.split('/')[0];
      var segs = tail.split('/').filter(Boolean);
      if (row[2] === 'task' && segs.length && (from !== 'history' || segs.length > 1)) to = 'run/' + (from === 'history' ? segs[1] : segs[0]);
      // dev's #group/ID is a run group, or a Run-after chain keyed by its first run (p:PID) or its ticket (t:ID)
      if (row[2] === 'group' && segs.length) { var gid = dec(segs[0]); to = /^p:/.test(gid) ? 'run/' + gid.slice(2) : /^t:/.test(gid) ? 'schedules' : 'run/group:' + gid; }
      if (row[2] === 'way' && has(row[4])) to += '/' + row[4];
      if (row[2] === 'dev-workflows') { to = devWorkflows(segs); if (!to) return null; }
      if (row[2] === 'dev-marketplace') { to = devMarketplace(segs); if (!to) return null; }
      if (row[2] === 'dev-projects') { to = devProjects(segs); if (!to) return null; }
      return { hash: '#' + to, pulse: row[3] || '' };
    }
    return null;
  }
  // Classic's names as search words (key.search): [old name, what it is called now, where it lives, where it opens, the
  // place whose icon it wears]. The one search finds a thing by the name a classic user knows and lands on today's place.
  var WORDS = [
    ['providers', 'Models', 'Settings · was Providers', 'settings/models', 'settings'],
    ['import models', 'Models', 'Settings · was Import models', 'settings/models', 'settings'],
    ['runs', 'Tasks', 'was Runs', 'runs', 'runs'],
    ['statistics', 'Insights', 'was Statistics', 'insights', 'insights'],
    ['activity', 'Pulse', 'in the top bar · was Activity', 'activity', 'chat'],
    ['new run', 'New task', 'in Chat · was New run', '~new-task', 'chat'],
  ];
  /** What a search for `q` finds among classic's names: [{ label, where, hash, id }], one per place, at three letters or more. */
  function words(q) {
    var t = String(q || '').trim().toLowerCase(), out = [], seen = {};
    if (t.length < 3) return out;
    for (var i = 0; i < WORDS.length; i++) {
      var w = WORDS[i];
      if (w[0].indexOf(t) < 0 || seen[w[3]]) continue;
      seen[w[3]] = true; out.push({ label: w[1], where: w[2], hash: w[3], id: w[4] });
    }
    return out;
  }
  var api = { TABLE: TABLE, WORDS: WORDS, resolve: resolve, words: words };
  if (typeof window !== 'undefined') window.StillhetOldAddresses = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // test/stillhet-old-addresses.test.mjs reads it
})();
