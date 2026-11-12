// ui/public/stillhet/shell/old-addresses.js — dev's old addresses with Stillhet on (docs/rail/navigation.md nav.old-address,
// plans/rail/stillhet-wiring.md Moves). One table for the app and the prototype: window.RailOldAddresses = { TABLE,
// resolve(hash) }. resolve answers null for every Stillhet address, else { hash, pulse }: where the thing lives now, and a
// Pulse tab to open there ('' for none). shell.js route() asks it first and replaces the address in place, so Back never
// loops. Dev's own router (app.js MOVED_ROUTES) is untouched; with Stillhet off these addresses stay dev's.
(function () {
  // [old place, new address, what the tail becomes]. The old place matches itself and anything under it (`old/…`).
  // tail: 'root' drops it; 'ws' carries it as a workspace in Projects; 'way' carries a Workflows way when it has one.
  var TABLE = [
    ['stats', 'insights/spend'], ['statistics', 'insights/spend'],
    ['team-metrics', 'insights/team'],
    ['pipelines', 'runs'], ['running', 'runs'], ['history', 'runs'], ['feature', 'runs'], ['group', 'runs'],
    ['activity', 'chat', 'root', 'now'],
    ['connectors', 'settings/connectors'], ['settings/mcp', 'settings/connectors'],
    ['models', 'settings/models'], ['providers', 'settings/models'], ['settings/providers', 'settings/models'],
    ['team-policy', 'settings/team'],
    ['workspaces', 'projects', 'ws'], ['workspace-create', 'projects'],
    ['new', 'chat'], ['getting-started', 'chat'],
    ['plugins', 'marketplace'],
    ['guardrails', 'settings/guardrails'],
    ['composer', 'workflows'], ['agents', 'workflows', 'way', '', '~agents'], ['scripts', 'workflows', 'way', '', '~scripts'], ['agent-create', 'workflows', 'way', '', '~agents'],
  ];
  var workflowsHas = function (a) { var w = typeof window !== 'undefined' && window.RailPlaces && window.RailPlaces.workflows; return !!(w && w.has && w.has(a)); };

  /** null, or { hash: '#…', pulse: '' | 'now' }. `has` asks Workflows whether it has a way (default: the page's own). */
  function resolve(hash, opts) {
    var path = String(hash || '').replace(/^#/, '');
    if (!path) return null;
    var has = (opts && opts.has) || workflowsHas;
    for (var i = 0; i < TABLE.length; i++) {
      var row = TABLE[i], from = row[0];
      if (path !== from && path.indexOf(from + '/') !== 0) continue;
      var tail = path.slice(from.length + 1), to = row[1];
      if (row[2] === 'ws' && tail) to += '/ws:' + tail.split('/')[0];
      if (row[2] === 'way' && has(row[4])) to += '/' + row[4];
      return { hash: '#' + to, pulse: row[3] || '' };
    }
    return null;
  }
  var api = { TABLE: TABLE, resolve: resolve };
  if (typeof window !== 'undefined') window.RailOldAddresses = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // test/stillhet-old-addresses.test.mjs reads it
})();
