// ui/public/stillhet/adapter.js — the data adapter seam. One global, window.RailAdapter:
// { kind: 'demo' | 'live', host, act(id, args), refuse(id, args), world(), model(area), ready, retry(), post(url, body) }.
// The server picks the kind, never the address (D2): the app host is live when its shell carries data-adapter="live"
// (src/core/stillhet-shell.mjs), demo otherwise; the prototype host is always demo. The live kind loads
// live/live-adapter.mjs once the pages have loaded (D1). `act` answers { ok, text }. In the app host nothing is connected yet, so it refuses with NOT_CONNECTED; in the
// prototype host the sentence comes from demo-actions.js (window.RailDemoActions), keyed by action id.
(function () {
  var NOT_CONNECTED = 'Not connected to Worca yet.';
  var host = window.RailHost ? window.RailHost.name : 'prototype';
  var root = typeof document !== 'undefined' ? document.documentElement : null;
  var kind = host === 'app' && root && root.getAttribute('data-adapter') === 'live' ? 'live' : 'demo';
  var live = null, readyDone = null;
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
    kind: kind,
    ready: new Promise(function (r) { readyDone = r; }),
    // Try again (the lists' and Pulse's): the live kind fetches every source again; the demo kind has nothing to fetch
    retry: function () { return live ? live.retry() : undefined; },
    // a task opened in the live kind: the adapter clears what dev clears on opening it (the failed run's unread mark)
    seenRun: function (id) { if (live) live.seenRun(id); },
    // after a Chat write the server answered ok: its sources are read again (the threads, the groups)
    refresh: function (source) { if (live) live.refresh(source); },
    // dev's own route and body (D13): { ok, status, data, error }; a refusal names dev's reason
    post: function (url, body) {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d, error: r.ok ? '' : (d && (d.error || d.message)) || 'HTTP ' + r.status }; }); })
        .catch(function () { return { ok: false, status: 0, data: {}, error: 'the server did not answer' }; });
    },
    // the same, for dev's PUT routes (a workspace link's answer, D10)
    put: function (url, body) {
      return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d, error: r.ok ? '' : (d && (d.error || d.message)) || 'HTTP ' + r.status }; }); })
        .catch(function () { return { ok: false, status: 0, data: {}, error: 'the server did not answer' }; });
    },
    importLive: function () { return import('/stillhet/live/live-adapter.mjs'); },
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
    // An action of an area this slice does not wire (R-arch-10): in the live kind it goes through act, which refuses with
    // NOT_CONNECTED, and the caller returns before it writes anything; in the demo kind it answers false and the page acts.
    refuse: function (id, args) { if (kind !== 'live') return false; adapter.act(id, args); return true; },
    world: function () { return window.RailWorld; },
    model: function (area) { return window['Rail' + area[0].toUpperCase() + area.slice(1) + 'Model']; }
  };
  window.RailAdapter = adapter;
  // The live kind starts once every page has loaded (boot.js injects them in order); a failed import fails the first load.
  function startLive() {
    var W = window.RailWorld;
    adapter.importLive().then(function (m) {
      live = m.startLive({
        fetch: window.fetch.bind(window), WebSocket: window.WebSocket, location: location, world: W, host: window.RailHost || {}, prefs: window.RailUI && window.RailUI.prefs,
        setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window), now: Date.now,
        openChat: function () { var h = location.hash.match(/^#chat\/([^/]+)/); if (!h) return ''; try { return decodeURIComponent(h[1]); } catch (e) { return h[1]; } },
        hidden: function () { return document.hidden; },
        toast: toast,
        go: function (h) { if (window.RailShell) window.RailShell.go(h); }
      });
      window.RailChatLive = live.chat;   // the live chat's reads and actions (D5): chat/conversation.js and chats-column.js
      window.RailTaskLive = live.task;   // the live Tasks reads and actions (Tasks D4): the task page, the list, the center, the card
      window.addEventListener('hashchange', function () { live.seen(); });
      readyDone(live);
    }, function () { if (W) W.setState({ list: 'failed' }); readyDone(null); });
  }
  if (kind === 'live') {
    if (document.readyState === 'complete') setTimeout(startLive, 0); else if (window.addEventListener) window.addEventListener('load', startLive);
  } else readyDone(null);
  // The sentence for an action a page cannot do yet: the demo sentence in the prototype host, the one refusal in the app host.
  window.RailWould = function (phrase) {
    var demo = window.RailDemoActions;
    return host === 'prototype' && demo ? demo.would(phrase) : NOT_CONNECTED;
  };
})();
