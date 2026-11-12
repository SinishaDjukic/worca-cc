// ui/public/stillhet/host-app.js — what differs in the app host (data-host="app"). The opt-out path inside Stillhet:
// the top-bar switch turns `rail` off with the same call ui/public/stillhet.mjs makes, then reloads into dev's app.
(function () {
  // a failed opt-out is said with the adapter's toast (adapter.js loads after this file), in the shell's own toast below
  function say(text) { if (window.RailAdapter) window.RailAdapter.toast(text); }
  var host = {
    name: 'app',
    stillhetOn: function () { return true; },
    setStillhet: function (on) {
      return fetch('/api/flags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rail: !!on }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok) { location.reload(); return { ok: true }; }
          var text = 'Could not turn Stillhet off: ' + ((r.data && (r.data.error || r.data.message)) || 'try again in a moment.');
          say(text);
          return { ok: false, text: text };
        })
        .catch(function () {
          var text = 'Could not turn Stillhet off: the server did not answer.';
          say(text);
          return { ok: false, text: text };
        });
    }
  };
  // the top-bar switch (shell/frame.js draws R.designSwitch, on) is the way back: a click turns rail off. Delegated, so it
  // holds whenever the frame draws the bar; busy while the call is out, and left on (not busy) when it fails.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-design-switch]') : null;
    if (!b || b.disabled || b.getAttribute('aria-busy') === 'true') return;
    var hadFocus = document.activeElement === b;   // read before disabling: Chromium blurs a focused button on disable
    b.setAttribute('aria-busy', 'true'); b.disabled = true;
    host.setStillhet(false).then(function (r) {
      if (r.ok) return;
      b.removeAttribute('aria-busy'); b.disabled = false;
      if (hadFocus) b.focus();
    });
  });
  // the shell's own toast, drawn by the library (shell.html holds no markup of it) as a direct child of body, so it shows
  // over every page. adapter.js writes into this one: the first `.rc-toast` in the document can be a view's, e.g. the run
  // board's, which has no layout box on Chat, Tasks, Settings or Insights.
  if (window.RailUI) {
    document.body.insertAdjacentHTML('beforeend', window.RailUI.toast({}));
    host.toastEl = document.body.lastElementChild;
  }
  window.RailHost = host;
})();
