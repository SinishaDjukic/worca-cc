// ui/public/stillhet/adapter.js — the data adapter seam. One global, window.RailAdapter:
// { kind: 'demo' | 'live', host, act(id, args), world(), model(area) }. Slice 2 ships only the demo kind.
// `act` answers { ok, text }. In the app host nothing is connected yet, so it refuses with NOT_CONNECTED; in the
// prototype host the sentence comes from demo-actions.js (window.RailDemoActions), keyed by action id.
(function () {
  var NOT_CONNECTED = 'Not connected to Worca yet.';
  var host = window.RailHost ? window.RailHost.name : 'prototype';
  var announced = false;
  var toastTimer = null;   // one hide timer: a later toast gets its full 3 s

  function toast(text) {
    // the app host's own toast (host-app.js) when there is one; the prototype page's single toast otherwise
    var live = (window.RailHost && window.RailHost.toastEl) || document.querySelector('.rc-toast');
    if (!live) return;
    live.textContent = text;
    live.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { live.classList.remove('is-on'); }, 3000);
  }

  var adapter = {
    kind: 'demo',
    host: host,
    NOT_CONNECTED: NOT_CONNECTED,
    toast: toast,   // shows a sentence in the library's live toast for 3 s (host-app.js says a failed opt-out with it)
    act: function (id, args) {
      var demo = window.RailDemoActions;
      if (host === 'prototype' && demo && demo[id]) {
        var text = typeof demo[id] === 'function' ? demo[id](args || {}) : demo[id];
        toast(text);
        return { ok: true, text: text };
      }
      if (!announced) { announced = true; toast(NOT_CONNECTED); setTimeout(function () { announced = false; }, 3000); }
      return { ok: false, text: NOT_CONNECTED };
    },
    world: function () { return window.RailWorld; },
    model: function (area) { return window['Rail' + area[0].toUpperCase() + area.slice(1) + 'Model']; }
  };
  window.RailAdapter = adapter;
  // The sentence for an action a page cannot do yet: the demo sentence in the prototype host, the one refusal in the app host.
  window.RailWould = function (phrase) {
    var demo = window.RailDemoActions;
    return host === 'prototype' && demo ? demo.would(phrase) : NOT_CONNECTED;
  };
})();
