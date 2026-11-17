// ui/public/stillhet/demo/demo-actions.js — the prototype host's demo adapter for actions: the one place a sentence starts with
// "Would". Loaded only by host-prototype (boot.js), never by the app. Pages call window.StillhetWould(phrase), which
// adapter.js answers from here in the prototype host and refuses with "Not connected to Worca yet." in the app host.
// Action ids that need a sentence of their own go in the table, keyed by id (StillhetAdapter.act reads it).
(function () {
  window.StillhetDemoActions = {
    would: function (phrase) { return 'Would ' + phrase; },
    // A change to a schedule typed in its chat ("run it at 03:00 instead", "make it weekdays", "rename it to Night check"):
    // the demo's reading of it, as { id, patch: { at?, every?, title? } }, or null when the words change nothing. `list` is
    // the chat's schedules ({ id, title, every, at }); the one the words name, else the first. A live adapter asks Worca.
    scheduleChange: function (text, list) {
      var low = String(text || '').toLowerCase().trim();
      if (!list || !list.length || !/\b(run|runs|move|change|make|set|shift|switch|rename|call|instead|start)\b/.test(low)) return null;
      var s = list.filter(function (x) { return low.indexOf(String(x.title).toLowerCase()) >= 0; })[0] || list[0];
      var pad = function (n) { return String(n).padStart(2, '0'); }, patch = {};
      var hm = /\b(\d{1,2})[:.](\d\d)\b/.exec(low), ap = /\b(\d{1,2})\s*(am|pm)\b/.exec(low);
      if (hm && +hm[1] < 24 && +hm[2] < 60) patch.at = pad(+hm[1]) + ':' + hm[2];
      else if (ap && +ap[1] >= 1 && +ap[1] <= 12) patch.at = pad((+ap[1] % 12) + (ap[2] === 'pm' ? 12 : 0)) + ':00';
      var day = /\b(mon|tues|wednes|thurs|fri|satur|sun)days?\b/.exec(low);
      var every = /\bweekdays?\b/.test(low) ? 'every weekday' : /\bweekends?\b/.test(low) ? 'every weekend' : /\b(every day|each day|daily|nightly)\b/.test(low) ? 'every day' : /\b(every hour|hourly)\b/.test(low) ? 'every hour' : day ? 'every ' + day[1][0].toUpperCase() + day[1].slice(1) + 'day' : '';
      if (every) patch.every = every;
      var name = /\b(?:rename it to|rename .+? to|call it)\s+["“']?(.+?)["”']?[.!]?$/i.exec(String(text || '').trim());
      if (name && name[1].trim()) patch.title = name[1].trim().slice(0, 80);
      if (patch.at === s.at) delete patch.at;
      if (patch.every === s.every || s.every === 'Once') delete patch.every;
      if (patch.title === s.title) delete patch.title;
      return Object.keys(patch).length ? { id: s.id, patch: patch } : null;
    }
  };
})();
