// ui/public/stillhet/host-prototype.js — what differs in the prototype host (plans/rail/prototype/index.html). The
// prototype is Stillhet, so the switch reads on; `?stillhet=off` makes it read off, for the part comparison against dev's
// page. Also fills the prototype's stamp and the tools panel's theme buttons, which only that page has.
(function () {
  var off = new URLSearchParams(location.search).get('stillhet') === 'off';
  window.RailHost = { name: 'prototype', stillhetOn: function () { return !off; }, setStillhet: function () { /* the prototype has nothing to turn off */ } };

  var dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelectorAll('[data-theme-pick]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.themePick === 'dark') === dark)); });

  var s = window.RailStamp;
  if (!s || !document.getElementById('mk-stamp')) return;
  var when = new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('mk-stamp').textContent = '· ' + s.branch + ' · ' + when;
  document.querySelector('.mk-tools > summary').title = 'Prototype · ' + s.branch + ' · ' + when;
  document.getElementById('mk-rev').textContent = 'Last update ' + when + ' · ' + s.branch + ' at ' + s.sha + (s.dirty ? ', with uncommitted work' : '');
})();
