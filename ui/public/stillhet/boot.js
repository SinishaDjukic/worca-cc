// ui/public/stillhet/boot.js — the one loader for Stillhet's classic scripts and stylesheets. The app shell
// (shell.html, data-host="app") and the prototype page (plans/rail/prototype/index.html, data-host="prototype") both load
// only this file, so the order lives here once. Scripts are injected with async = false, which keeps this order.
(function () {
  var self = typeof document !== 'undefined' ? document.currentScript : null;
  var host = (self && self.getAttribute('data-host')) === 'app' ? 'app' : 'prototype';
  var base = self ? self.src.replace(/boot\.js(\?.*)?$/, '') : '';

  var STYLES = {
    app: ['/style.css', 'css/rail-look.css', 'css/rail.css', 'pulse/pulse.css', 'shell/shell.css'],
    prototype: ['app.css', 'css/rail-look.css', 'css/rail.css', 'pulse/pulse.css', 'shell/shell.css', '../workflows/node-graph.css']
  };
  var HEAD = ['components.js', 'graph.js'];
  var HOST_SCRIPTS = {
    app: ['host-app.js'],
    prototype: ['demo/demo-actions.js', 'host-prototype.js']
  };
  var PAGES = [
    'shell/frame.js', 'adapter.js',
    'runs/run-page-model.js', 'shell/world.js', 'pulse/pulse-model.js', 'runs/runs-model.js', 'chat/chats-model.js',
    'schedules/schedules-model.js', 'settings/settings-model.js', 'settings/settings.js', 'shell/old-addresses.js', 'shell/drafts.js', 'shell/shell.js',
    'runs/runs-list.js', 'chat/chats-column.js', 'chat/conversation.js', 'schedules/schedules.js', 'centers/centers.js',
    'projects/projects.js', 'workflows/workflows.js', 'requirements/requirements.js', 'marketplace/marketplace.js',
    'insights/insights-model.js', 'insights/insights.js', 'workspaces/workspaces.js', 'runs/run-page.js', 'pulse/pulse.js'
  ];

  function list(h) { return { styles: STYLES[h], scripts: HEAD.concat(HOST_SCRIPTS[h], PAGES) }; }
  var url = function (f) { return f.charAt(0) === '/' ? f : base + f; };

  if (typeof module !== 'undefined' && module.exports) module.exports = { list: list };   // test/stillhet-boot.test.mjs reads the list
  if (!self) return;
  var l = list(host);
  l.styles.forEach(function (f) {
    var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url(f); document.head.appendChild(link);
  });
  l.scripts.forEach(function (f) {
    var s = document.createElement('script'); s.async = false; s.src = url(f); document.body.appendChild(s);
  });
})();
