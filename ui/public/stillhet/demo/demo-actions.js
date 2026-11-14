// ui/public/stillhet/demo/demo-actions.js — the prototype host's demo adapter for actions: the one place a sentence starts with
// "Would". Loaded only by host-prototype (boot.js), never by the app. Pages call window.RailWould(phrase), which
// adapter.js answers from here in the prototype host and refuses with "Not connected to Worca yet." in the app host.
// Action ids that need a sentence of their own go in the table, keyed by id (RailAdapter.act reads it).
(function () {
  window.RailDemoActions = {
    would: function (phrase) { return 'Would ' + phrase; }
  };
})();
