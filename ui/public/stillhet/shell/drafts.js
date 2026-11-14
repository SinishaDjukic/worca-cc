// ui/public/stillhet/shell/drafts.js — the one drafts store (docs/rail/philosophy.md rail.drafts, Schedules D6). What you
// change by hand is a draft until you save it: per thing (`kind:id`, e.g. `schedule:sch_1`) the fields you changed and how
// many, kept in localStorage `worca-rail.drafts`, so leaving and coming back keeps it. A field set back to its saved value
// leaves the draft; a draft with no change left is gone. Nothing here talks to Worca: Save is the page's (schedule-live.mjs).
// window.RailDrafts = { get, touch, changes, discard, all, onChange }.
(function () {
  var KEY = 'worca-rail.drafts';
  function make(storage) {
    var listeners = [];
    function read() {
      try { var v = JSON.parse((storage && storage.getItem(KEY)) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; }   // a corrupt value reads as no drafts
    }
    function write(all) { try { if (storage) storage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* storage full or off: the draft lives for this page only */ } }
    var all = read();
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    function changed() { write(all); listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
    var api = {
      /** The draft of a thing: { fields, changes }, or null. */
      get: function (key) { var d = all[key]; return d && d.fields && typeof d.fields === 'object' ? d : null; },
      /** Change fields of a thing's draft: fn(fields so far) → the fields to set. `base` is the saved thing; a field equal to it leaves the draft. */
      touch: function (key, base, fn) {
        var d = api.get(key), fields = Object.assign({}, d ? d.fields : {}), set = fn(Object.assign({}, fields)) || {};
        Object.keys(set).forEach(function (k) { if (base && same(set[k], base[k])) delete fields[k]; else fields[k] = set[k]; });
        var n = Object.keys(fields).length;
        if (n) all[key] = { fields: fields, changes: n }; else delete all[key];
        changed();
        return api.get(key);
      },
      changes: function (key) { var d = api.get(key); return d ? d.changes : 0; },
      discard: function (key) { if (!all[key]) return false; delete all[key]; changed(); return true; },
      /** Every draft of a kind: [{ key, id, changes }]. */
      all: function (kind) { return Object.keys(all).filter(function (k) { return k.indexOf(kind + ':') === 0 && api.get(k); }).map(function (k) { return { key: k, id: k.slice(kind.length + 1), changes: all[k].changes }; }); },
      onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
    };
    return api;
  }
  if (typeof window !== 'undefined') { var s = null; try { s = window.localStorage; } catch (e) { s = null; } window.RailDrafts = make(s); }
  if (typeof module !== 'undefined' && module.exports) module.exports = { make: make, KEY: KEY };   // test/stillhet-drafts.test.mjs
})();
