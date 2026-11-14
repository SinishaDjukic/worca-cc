// ui/public/stillhet/host-app.js — what differs in the app host (data-host="app"). The opt-out path inside Stillhet:
// the top-bar switch turns `rail` off with the same call ui/public/stillhet.mjs makes, then reloads into dev's app.
// The one reload owner (D24): the switch, and a `flags` frame with rail off that the live adapter hands over
// (RailHost.flagsChanged). A latch reloads once per page; while text is typed it waits, and says so once, as dev's
// watchRailReload (ui/public/stillhet.mjs) does. Its typed-text rule is copied here: Stillhet may not import dev's modules.
(function () {
  // a failed opt-out is said with the adapter's toast (adapter.js loads after this file), in the shell's own toast below
  function say(text) { if (window.RailAdapter) window.RailAdapter.toast(text); }
  var reloaded = false, waiting = false, toasted = false;
  function typed() {
    var f = document.querySelectorAll('input[type=text], input[type=search], input[type=url], input[type=email], input:not([type]), textarea, [contenteditable=true]');
    for (var i = 0; i < f.length; i++) {
      var x = f[i];
      if (typeof x.checkVisibility === 'function' ? !x.checkVisibility() : x.closest('[hidden]')) continue;   // a closed dialog's fields do not count
      if (x.getAttribute('contenteditable') === 'true' ? x.textContent.trim() !== '' : x.value !== x.defaultValue) return true;
    }
    return false;
  }
  function reloadOnce() { if (reloaded) return; reloaded = true; location.reload(); }
  // rail turned off elsewhere: back to dev once nothing typed would be lost
  function attempt() {
    if (!waiting || reloaded) return;
    if (typed()) { if (!toasted) { toasted = true; say('Stillhet is off.'); } return; }
    reloadOnce();
  }
  document.addEventListener('input', attempt);
  document.addEventListener('visibilitychange', attempt);
  var host = {
    name: 'app',
    // rail back on before the reload happened: nothing to wait for any more (dev's watchRailReload resets the same way)
    flagsChanged: function (flags) { if (!flags) return; if (flags.rail !== false) { waiting = false; toasted = false; return; } waiting = true; attempt(); },
    stillhetOn: function () { return true; },
    // locked by WORCA_FLAGS (the shell's stamp, src/core/stillhet-shell.mjs): the switch is drawn disabled and says why
    railLocked: function () { var h = document.documentElement; return !!h && h.getAttribute('data-rail-locked') === 'true'; },
    setStillhet: function (on) {
      return fetch('/api/flags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rail: !!on }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok) { reloadOnce(); return { ok: true }; }
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
