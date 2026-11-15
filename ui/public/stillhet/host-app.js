// ui/public/stillhet/host-app.js — what differs in the app host (data-host="app"). The opt-out path inside Stillhet:
// the top-bar icon's "Back to today's UI" (shell/frame.js's watch calls setStillhet(false)) turns `rail` off with the same
// call ui/public/stillhet.mjs makes, then reloads into dev's app. The one reload owner (D24): that pick, and a `flags`
// frame with rail off that the live adapter hands over (RailHost.flagsChanged). A latch reloads once per page; while text is typed it waits, and says so once, as dev's
// watchRailReload (ui/public/stillhet.mjs) does. Its typed-text rule is copied here: Stillhet may not import dev's modules.
(function () {
  // a failed opt-out is said with the adapter's toast (adapter.js loads after this file), in the shell's own toast below
  function say(text) { if (window.RailAdapter) window.RailAdapter.toast(text); }
  var reloaded = false, waiting = false, toasted = false, railOn = true;
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
    flagsChanged: function (flags) { if (!flags) return; railOn = flags.rail !== false; if (railOn) { waiting = false; toasted = false; return; } waiting = true; attempt(); },
    // the live flag: a `flags` frame with rail off (Labs, another tab) moves the menu's check before the reload lands
    stillhetOn: function () { return railOn; },
    // locked by WORCA_FLAGS (the shell's stamp, src/core/stillhet-shell.mjs): the icon's menu rows are drawn disabled and say why
    railLocked: function () { var h = document.documentElement; return !!h && h.getAttribute('data-rail-locked') === 'true'; },
    setStillhet: function (on) {
      var fail = 'Could not turn Stillhet ' + (on ? 'on' : 'off') + ': ';
      return fetch('/api/flags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rail: !!on }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (r) {
          // back on from inside Stillhet: already here, nothing to reload; a pending reload is called off
          if (r.ok && on) { railOn = true; waiting = false; toasted = false; return { ok: true }; }
          if (r.ok) { reloadOnce(); return { ok: true }; }
          var text = fail + ((r.data && (r.data.error || r.data.message)) || 'try again in a moment.');
          say(text);
          return { ok: false, text: text };
        })
        .catch(function () {
          var text = fail + 'the server did not answer.';
          say(text);
          return { ok: false, text: text };
        });
    }
  };
  // the shell's own toast, drawn by the library (shell.html holds no markup of it) as a direct child of body, so it shows
  // over every page. adapter.js writes into this one: the first `.rc-toast` in the document can be a view's, e.g. the run
  // board's, which has no layout box on Chat, Tasks, Settings or Insights.
  if (window.RailUI) {
    document.body.insertAdjacentHTML('beforeend', window.RailUI.toast({}));
    host.toastEl = document.body.lastElementChild;
  }
  window.RailHost = host;
})();
