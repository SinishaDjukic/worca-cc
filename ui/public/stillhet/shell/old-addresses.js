// ui/public/stillhet/shell/old-addresses.js — dev's old addresses with Stillhet on (docs/rail/navigation.md nav.old-address,
// plans/rail/stillhet-wiring.md Moves). One table for the app and the prototype: window.RailOldAddresses = { TABLE,
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
  var dec = function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } };
  var workflowsHas = function (a) { var w = typeof window !== 'undefined' && window.RailPlaces && window.RailPlaces.workflows; return !!(w && w.has && w.has(a)); };

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
      return { hash: '#' + to, pulse: row[3] || '' };
    }
    return null;
  }
  var api = { TABLE: TABLE, resolve: resolve };
  if (typeof window !== 'undefined') window.RailOldAddresses = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // test/stillhet-old-addresses.test.mjs reads it
})();
