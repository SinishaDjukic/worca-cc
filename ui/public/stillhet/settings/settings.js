// Settings' sections (all but Notifications, which pulse.js draws from Pulse's model), drawn from settings-model.js with
// the Rail components alone, so the look, the alignment and the motion are the components':
//   a decision  → SettingsRow: its name, its state in words (SentencePickers where it changes), a Switch or a button;
//                 its fine-tuning folds under Customise (`more`);
//   a record    → ListRow in a List: the row opens what it does not already show, or nothing; its one action a button, more in its ⋯;
//   Change…     → a Dialog with Fields (`edit`), stepped when it has `steps`; a yes or no → the ConfirmStrip.
// A value lives in `sv`, a Labs flag in R.prefs. Every control acts on them; nothing is saved (a prototype).
(function () {
  const SM = window.SettingsModel, R = window.RailUI;
  for (const f of SM.FLAGS) R.prefs.setFlag(f.key, f.on);   // a Labs switch's default, for every page that reads a flag
  const noSlash = () => { if (window.location?.hash === '#settings/') window.location.replace('#settings'); };   // the landing has one address
  window.addEventListener?.('hashchange', noSlash); noSlash();

  const flat = (rows) => (rows || []).flatMap((r) => [r, ...flat(r.more)]);
  const allSections = () => Object.values(SM.SECTIONS).flatMap((x) => x.sections);
  const secRows = (s) => [...(s.rows || []), ...(s.groups || []).flatMap((g) => g.rows || [])];
  const secRecs = (s) => [...(s.list || []), ...(s.groups || []).flatMap((g) => g.list || []), ...(s.actions || []).flatMap((a) => a.list || [])];
  const recordsOf = () => allSections().flatMap((s) => { const rs = secRecs(s); return [...rs, ...flat(secRows(s)).flatMap((r) => r.moreList || []), ...rs.flatMap((r) => r.moreList || [])]; });
  const rowsOf = () => [...allSections().flatMap((s) => flat(secRows(s))), ...recordsOf().flatMap((r) => flat(r.more))];
  const listsOf = recordsOf;
  const REG = new Map();   // the last drawing's actions, by key: what a click on data-svdo means
  let cur = null;          // the values on the page: what a keystroke in a Dialog's Field writes to

  const seed = (r, sv) => { for (const [k, p] of Object.entries(r.picks || {})) if (!(k in sv)) sv[k] = p.value; };
  function fresh() {
    const sv = { __recs: {}, ...SM.STATE };
    const seen = new Set(); const once = (k) => { if (seen.has(k)) throw new Error('settings-model: the key ' + k + ' is used twice'); seen.add(k); };
    for (const r of rowsOf()) {
      for (const [k, p] of Object.entries(r.picks || {})) { once(k); sv[k] = p.value; }
      for (const [k, v] of Object.entries(r.vals || {})) { once(k); if (typeof v !== 'function') sv[k] = v; }
      if (r.sw && r.sw.key) { once(r.sw.key); sv[r.sw.key] = !!r.sw.on; }
    }
    for (const it of listsOf()) if (it.sw) { once(it.sw.key); sv[it.sw.key] = !!it.sw.on; }
    return sv;
  }
  const dialogRows = (sv) => { const d = sv.__dialog; return d ? (d.steps ? d.steps.flatMap((s) => s.rows || []) : d.rows || []) : []; };
  const findPick = (sv, key) => { for (const r of [...dialogRows(sv), ...rowsOf()]) if (r.picks && r.picks[key]) return [r, r.picks[key]]; return [null, null]; };
  const optsOf = (p, sv) => (typeof p.options === 'function' ? p.options(sv) : p.options);
  const optText = (p, v, sv) => (optsOf(p, sv).find((o) => o[0] === v) || [v, v])[1];
  const words = (t, c) => c.esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  const vis = (x, c) => R.shows(x.min, c.level) && (!x.flag || R.prefs.flag(x.flag)) && (!x.when || x.when(c.sv));
  const textOf = (v, sv) => (typeof v === 'function' ? v(sv) : v);

  function sentence(r, sv, c) {
    return words(textOf(r.say, sv), c).replace(/\{(\w+)\}/g, (m, k) => {
      const p = r.picks && r.picks[k];
      if (p) {
        if (c.locked) return `<b>${c.esc(optText(p, sv[k], sv))}</b>`;
        return c.R.sentencePicker({ id: 'sv:' + k, text: optText(p, sv[k], sv), open: c.open === 'sv:' + k, tip: p.tip || '', chevron: c.svg('chevron', 12), right: !!p.right,
          items: optsOf(p, sv).map(([id, text, help, off]) => ({ id, text, help, off: !!off, checked: sv[k] === id })) });
      }
      if (r.vals && k in r.vals) return c.esc(typeof r.vals[k] === 'function' ? r.vals[k](sv) : sv[k]);
      return m;   // a literal {word}
    });
  }
  // The sentence as plain words, the same fill as above: a toast says it, and gates/settings-sentences.mjs reads it.
  function sentenceText(r, sv) {
    return textOf(r.say, sv).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\{(\w+)\}/g, (m, k) => {
      const p = r.picks && r.picks[k];
      if (p) return optText(p, sv[k], sv);
      if (r.vals && k in r.vals) return String(typeof r.vals[k] === 'function' ? r.vals[k](sv) : sv[k]);
      return m;
    });
  }
  // What differs from Worca's default, each value with its default's words: the row's own, then its folded rows' (the
  // ChangedDot; docs/rail/settings.md `set.changed`). A pick's default is its start value; a value only a Dialog sets is
  // in the model's STATE. A secret is never in the list.
  const same = (a, b) => String(a ?? '') === String(b ?? '');
  const defaultWords = (k, v, fallback) => (SM.VALUE_WORDS[k] ? SM.VALUE_WORDS[k](v, SM.STATE) : fallback ?? (v === '' || v == null ? 'none' : String(v)));
  function changesOf(r, sv, c) {
    const out = [], seen = new Set();
    const add = (k, name, start, words) => { if (seen.has(k)) return; seen.add(k); if (!same(sv[k], start)) out.push({ name: SM.VALUE_NAMES[k] || name, was: defaultWords(k, start, words) }); };
    for (const [k, p] of Object.entries(r.picks || {})) add(k, p.name || r.name, p.value, optText(p, p.value, sv));
    for (const a of r.acts || []) for (const f of (a.edit && typeof a.edit !== 'function' && a.edit.fields) || []) {
      if (!f.key || f.button || f.type === 'password') continue;
      const start = r.vals && f.key in r.vals ? r.vals[f.key] : SM.STATE[f.key];
      if (start !== undefined && typeof start !== 'function') add(f.key, f.label.replace(' (USD)', ''), start);
    }
    for (const [k, v] of Object.entries(r.vals || {})) if (typeof v !== 'function') add(k, r.name, v);
    if (r.sw && r.sw.key) add(r.sw.key, r.name, !!r.sw.on, r.sw.on ? 'on' : 'off');
    if (r.sw && r.sw.flag) { const on = !!(SM.FLAGS.find((f) => f.key === r.sw.flag) || {}).on; if (R.prefs.flag(r.sw.flag) !== on) out.push({ name: r.name, was: on ? 'on' : 'off' }); }
    return [...out, ...(r.more || []).filter((m) => vis(m, c)).flatMap((m) => changesOf(m, sv, c))];
  }
  // An action: a jump to another section (go), a Dialog (edit), a ConfirmStrip (confirm), a copy, a change (do), or a
  // place outside Settings (page, click), with a toast (say). What it needs when off: `off(sv)` says why.
  function act(a, where, c) {
    const label = textOf(a.label, c.sv), key = where + '/' + (a.id || label);
    const known = a.go || a.edit || a.confirm || a.copy || a.do || a.page || a.click || a.say;
    if (!known) throw new Error(`settings-model: "${label}" at ${where} does nothing`);
    REG.set(key, a);
    if (a.copy) return R.copyButton({ text: textOf(a.copy, c.sv), label: label, attrs: { 'data-svdo': key, 'data-key': 'sv:' + key } });
    const why = (c.locked && !a.read && !a.go && !a.page ? c.locked : '') || (a.off && a.off(c.sv)) || '';
    if (why) return c.R.tooltip({ text: why, off: true, html: c.R.button({ label, kind: a.kind ?? 'quiet', attrs: { disabled: true, 'data-key': 'sv:' + key } }) });
    return c.R.button({ label, kind: a.kind ?? 'quiet', attrs: a.go ? { 'data-sset': a.go, title: a.help || null } : { 'data-svdo': key, 'data-key': 'sv:' + key, title: a.help || null } });
  }
  function swOf(r, label, sv, c) {
    const s = r.sw; if (!s) return '';
    const off = c.locked || s.locked || (s.off && s.off(sv)) || '';
    return c.R.switchButton({ on: s.flag ? R.prefs.flag(s.flag) : sv[s.key], label, why: off || s.why || '', disabled: !!off, attrs: { 'data-svsw': s.flag ? 'flag:' + s.flag : s.key } });
  }
  const chipOf = (x, sv, c) => { const t = x.chip && textOf(x.chip, sv); return t ? c.R.chip({ text: t, title: x.chipTip || '' }) : ''; };
  function row(r, sv, c, where) {
    const key = 'more:' + where + '/' + r.name, open = sv.__open === key;
    const folds = !!r.moreList || (r.more || []).some((m) => vis(m, c));   // nothing to open, no Customise
    const inner = open ? (r.more || []).filter((m) => vis(m, c)).map((m) => row(m, sv, c, where + '/' + r.name)).join('') : '';
    const detail = open && r.moreList ? records(r.moreList, sv, c, where + '/' + r.name, r.empty) : '';
    const acts = (r.acts || []).filter((a) => vis(a, c)).map((a) => act(a, where + '/' + r.name, c)).join('');
    return c.R.settingsRow({ name: r.name, help: r.help || '', changed: changesOf(r, sv, c), sentence: sentence(r, sv, c), end: chipOf(r, sv, c) + acts + swOf(r, r.name, sv, c), detailRows: inner, detail, fold: folds ? { open, label: r.foldLabel, attrs: { 'data-svdo': key, 'data-key': 'sv:' + key } } : null });
  }

  // ---- records: each list's own copy, so a rename or a delete holds until the case changes ----
  const recsOf = (sv, where, items) => (sv.__recs[where] ||= items.map((it, i) => ({ ...it, id: 'r' + i })));
  function tools(sv, rec, where) {
    const list = sv.__recs[where] || [];
    return { sv, rec, list,
      remove: () => { const i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); },
      add: (it, to) => { const l = to ? (sv.__recs[to] ||= recsFromModel(to)) : list; l.unshift({ ...it, id: 'n' + (sv.__seq = (sv.__seq || 0) + 1) }); },
      dialog: (d) => { openDialog(sv, d); return ''; }, confirm: (x) => { sv.__confirm = x; return ''; }, go: (id) => { goSection(id); return ''; }, page: (p, say) => toPage(p, say), click: clickThrough };
  }
  function recsFromModel(where) {
    const [id, ...rest] = where.split('/'), s = SM.SECTIONS[id].sections.find((x) => x.title === rest.join('/'));
    return (s?.list || []).map((it, i) => ({ ...it, id: 'r' + i }));
  }
  const goSection = (id) => setTimeout(() => { if (window.RailShell) window.RailShell.go('settings/' + id); else document.querySelector(`[data-sset="${id}"]`)?.click(); });
  const toPage = (p, say) => { if (window.RailShell) { setTimeout(() => window.RailShell.go(p)); return ''; } return say; };
  const clickThrough = (sels) => setTimeout(() => sels.forEach((s) => document.querySelector(s)?.click()));
  // The record actions every list shares; anything else is the record's own `on`, or a model error (a dead control).
  const SHARED = {
    Rename: (r, x) => x.dialog({ title: `Rename ${r.title}`, yes: 'Rename', fields: [{ key: 'name', label: 'Name', value: r.title }], check: (v) => { const t = v.name.trim(); return !t ? 'It needs a name' : x.list.some((o) => o !== r && o.title.toLowerCase() === t.toLowerCase()) ? `${t} already exists` : ''; }, then: (v) => { const t = v.name.trim(); if (t === r.title) return ''; r.title = t; return `Renamed to ${t}`; } }),
    Duplicate: (r, x) => { const base = r.title + ' copy'; let title = base; for (let n = 2; x.list.some((o) => o.title === title); n += 1) title = `${base} ${n}`; x.add({ ...r, title, ...(r.copy || {}) }); return `Duplicated: ${title}`; },
    Edit: (r, x) => x.dialog({ title: `Edit ${r.title}`, fields: [{ key: 'name', label: 'Name', value: r.title }, { key: 'meta', label: 'Details', value: r.meta || '' }], then: (v) => { r.title = v.name.trim() || r.title; r.meta = v.meta; return `${r.title} saved`; } }),
    Reject: (r, x) => { x.remove(); return `Rejected: ${r.title}`; },
    ...Object.fromEntries(['Delete', 'Remove', 'Revoke', 'Uninstall'].map((w) => [w, (r, x) => x.confirm({ text: `${w} ${r.title}?${r.follows ? ` ${typeof r.follows === 'function' ? r.follows(r) : r.follows}` : ''}`, yes: w, danger: true, then: () => { x.remove(); return `${w === 'Revoke' ? 'Revoked' : w === 'Uninstall' ? 'Uninstalled' : w === 'Delete' ? 'Deleted' : 'Removed'}: ${r.title}`; } })])),
  };
  function recordRows(items, sv, c, where) {
    const recs = recsOf(sv, where, items);
    return recs.filter((it) => !it.when || it.when(sv, it)).map((it) => {
      const k = where + '/' + it.id, mid = 'svm:' + k;
      const all = c.locked ? [] : (typeof it.menu === 'function' ? it.menu(it, sv) : it.menu) || [];
      const nameOf = (m) => (typeof m === 'string' ? m : m.text);
      for (const m of all) {
        const n = nameOf(m), fn = (it.on && it.on[n]) || SHARED[n];
        if (!fn) throw new Error(`settings-model: "${n}" on ${it.title} does nothing`);
        if (!m.off) REG.set(k + '/' + n, { rec: fn, it, where });
      }
      // The one answer sits on the row (`quick`); a ⋯ with one item is that item, as a button.
      const quick = all.filter((m) => (it.quick || []).includes(nameOf(m))), rest = all.filter((m) => !quick.includes(m));
      const onRow = rest.length === 1 ? [...quick, ...rest] : quick, menu = rest.length === 1 ? [] : rest;
      const btns = onRow.map((m) => { const n = nameOf(m), b = c.R.button({ label: n, kind: 'quiet', attrs: m.off ? { disabled: true, 'data-key': 'sv:' + k + '/' + n } : { 'data-svdo': k + '/' + n, 'data-key': 'sv:' + k + '/' + n } }); return m.off ? c.R.tooltip({ text: m.help || '', off: true, html: b }) : b; }).join('');
      // The row opens what it does not already show; with nothing more, it has no click. A level above yours: no link to a lock page.
      const opener = (it.openMin && !R.shows(it.openMin, c.level) ? null : it.open) || (it.detail ? (r, x) => x.dialog({ title: r.title, view: true, yes: 'Close', note: r.detail }) : null);
      if (opener) REG.set(k + '/open', { rec: opener, it, where });
      const meta = (it.live ? it.live(sv, it) : it.meta) || '';
      // A record's own fine-tuning (a tracker's Ticket updates) folds under it, as a row's does.
      const foldKey = 'more:' + where + '/' + it.title, foldOpen = sv.__open === foldKey;
      const canFold = it.more && (!it.foldFlag || R.prefs.flag(it.foldFlag));
      const under = canFold && foldOpen ? `<div class="set-detail" data-motion="open"><div class="set-rows">${it.more.filter((m) => vis(m, c)).map((m) => row(m, sv, c, where + '/' + it.title)).join('')}</div>${it.moreList ? records(it.moreList, sv, c, where + '/' + it.title, it.empty) : ''}</div>` : '';
      return c.R.listRow({ title: it.title, meta, mark: '',   /* a record's state is in its words (signed in, 1 update), never a loose dot */ endText: it.fig || '', end: chipOf(it, sv, c) + btns + swOf(it, it.title, sv, c), after: under,
        fold: canFold ? { open: foldOpen, help: it.foldHelp || '', attrs: { 'data-svdo': foldKey, 'data-key': 'sv:' + foldKey } } : null,
        open: opener ? { 'data-svdo': k + '/open', 'data-key': 'sv:' + k + '/open', title: meta || 'Open ' + it.title } : null,
        menu: menu.length ? { id: mid, label: 'More for ' + it.title, icon: c.svg('more', 14), items: menu, open: c.open === mid } : null });
    });
  }
  const emptyOf = (c, empty) => c.R.emptyState({ title: empty || 'Nothing here yet' });
  const records = (items, sv, c, where, empty) => c.R.list({ groups: [{ rows: recordRows(items, sv, c, where) }], empty: emptyOf(c, empty) });
  // A section's groups: records under a List's group heads, or rows under SettingsGroups.
  function groupsHtml(s, sv, c, where) {
    if (!s.groups) return '';
    const of = (g) => g.list !== undefined;
    return (s.groups.some(of) ? c.R.list({ groups: s.groups.filter(of).map((g) => ({ title: g.title, meta: g.meta || '', rows: recordRows(g.list, sv, c, where + '/' + g.title) })), empty: emptyOf(c, s.empty) }) : '')
      + s.groups.filter((g) => !of(g)).map((g) => c.R.settingsGroup({ title: g.title, rows: g.rows.filter((r) => vis(r, c)).map((r) => row(r, sv, c, where)).join('') })).join('');
  }

  // ---- the Dialog: Fields, an OptionList, a Checkbox, facts, rows; one screen per step when it has `steps` ----
  function openDialog(sv, spec) {
    const d = { ...spec, vals: {}, at: 0, status: spec.status || '' };
    for (const f of (d.steps || [d]).flatMap((s) => s.fields || [])) if (f.key) d.vals[f.key] = f.value ?? sv[f.key] ?? '';
    d.start = { ...d.vals };
    dialogRows({ __dialog: d }).forEach((r) => seed(r, sv));
    sv.__dialog = d;
  }
  function fieldHtml(f, d, sv, c) {
    if (f.when && !f.when(d.vals)) return '';
    const key = `sv:f:${f.key}`;
    if (f.options) {
      const sel = f.options.findIndex((o) => o[0] === d.vals[f.key]);
      return `<div class="dlg-choice"><span class="fld-l">${c.esc(f.label)}</span>${c.R.optionList({ label: f.label, options: f.options.map((o) => o[1]), selected: sel, optAttrs: (i) => ({ 'data-svdo': `dlgopt:${f.key}:${i}`, 'data-key': `${key}:${i}` }) })}</div>`;
    }
    if (f.check) return c.R.checkbox({ label: f.label, checked: !!d.vals[f.key], attrs: { 'data-svdo': 'dlgchk:' + f.key, 'data-key': key } });
    if (f.button) return c.R.button({ label: f.button, kind: 'quiet', attrs: { 'data-svdo': 'dlgbtn:' + f.key, 'data-key': key, title: f.hint || null } });
    return c.R.field({ id: 'sv-f-' + f.key, label: f.label, value: String(d.vals[f.key] ?? ''), hint: f.hint || '', multiline: !!f.multiline, type: f.type || 'text', placeholder: f.placeholder || '' });
  }
  function dialogHtml(sv, c) {
    const d = sv.__dialog; if (!d) return '';
    const s = d.steps ? d.steps[d.at] : d, last = !d.steps || d.at === d.steps.length - 1;
    const note = textOf(s.note, sv) || '';
    const facts = s.facts ? (typeof s.facts === 'function' ? s.facts(d.vals, sv) : s.facts) : null;
    const strip = sv.__confirm ? c.R.confirmStrip({ text: sv.__confirm.text, yes: sv.__confirm.yes, danger: !!sv.__confirm.danger }) : '';
    const body = strip + (note ? `<p class="dlg-note">${words(note, c)}</p>` : '')
      + (s.list ? records(s.list, sv, c, s.where) : '')
      + (facts ? c.R.list({ groups: [{ rows: facts.map((x) => c.R.listRow({ title: x.title, meta: x.meta || '', mark: '' })) }] }) : '')
      + (s.rows || []).map((r) => row(r, sv, c, 'dlg')).join('')
      + (s.fields || []).map((f) => fieldHtml(f, d, sv, c)).join('');
    const steps = d.steps ? c.R.stepper({ label: 'Steps', stages: d.steps.map((x, i) => ({ key: 'sa-' + i, label: x.label, selected: i === d.at, cells: [i < d.at ? 'is-done' : i === d.at ? 'is-now' : 'is-next'], attrs: { 'data-svdo': 'step:' + i } })) }) : '';
    return c.R.dialog({ title: d.title, yes: last ? d.yes || 'Save' : 'Next', status: c.esc(d.status || ''), close: c.svg('x', 14), id: 'sv-dlg-t', body, steps, back: !!d.steps && d.at > 0, view: !!d.view });
  }
  document.addEventListener('input', (e) => {
    const id = e.target && e.target.id, d = cur && cur.__dialog;
    if (!d || !id || !id.startsWith('sv-f-')) return;
    d.vals[id.slice(5)] = e.target.value;
    // form.check-at-save: Fields are checked when you press its Yes; typing only clears the problem once it is mended
    const s = d.steps ? d.steps[d.at] : d, root = e.target.closest('.dlg');
    if (!d.status || !s.check || !root || s.check(d.vals, cur)) return;
    d.status = ''; root.querySelector('.dlg-status').textContent = '';
  });
  // The whole section: a flag that is off leaves its section empty, with the way to turn it on.
  function section(id, sv, c0) {
    const sec = SM.SECTIONS[id];
    if (!sec) return '';
    cur = sv; REG.clear();
    const level = c0.level ?? R.prefs.mode(), c = { ...c0, level, sv };
    if (sec.flag && !R.prefs.flag(sec.flag)) {
      const f = SM.FLAGS.find((x) => x.key === sec.flag);
      return c.R.emptyState({ title: `${f.name} is off`, text: 'Turn it on in Labs.', actions: c.R.button({ label: 'Open Labs', kind: 'quiet', attrs: { 'data-sset': 'experimental' } }) });
    }
    const locked = sec.lock && !R.atLevel(level, sec.lock.level) ? sec.lock.why : '';
    return dialogHtml(sv, c) + sec.sections.filter((s) => vis(s, c)).map((s) => {
      const where = id + '/' + s.title, cc = { ...c, locked };
      const head = (s.actions || []).filter((a) => vis(a, c)).map((a) => act(a, where, cc)).join('');
      const rows = ((c.extra && c.extra[s.title]) || '') + (s.rows || []).filter((r) => vis(r, c)).map((r) => row(r, sv, cc, where)).join('');
      const table = s.table ? c.R.table({ ...s.table, rows: textOf(s.table.rows, sv) }) : '';
      const list = s.list && (!s.listWhen || s.listWhen(sv)) ? records(s.list, sv, cc, where, s.empty) : '';
      return c.R.settingsSection({ icon: ''   /* the place's icon is in the bar beside; a section's head is its words */, title: s.bare ? '' : s.title, meta: textOf(s.meta, sv) || '', action: head, rows: rows + table + list + groupsHtml(s, sv, cc, where) });
    }).join('');
  }

  // The strip of a yes or no on the page, drawn under the top bar by the page around Settings (docs/rail/actions.md).
  const strip = (sv) => (sv.__confirm && !sv.__dialog ? R.confirmStrip({ text: sv.__confirm.text, yes: sv.__confirm.yes, danger: !!sv.__confirm.danger }) : '');

  // ---- what a click means ----
  const runRec = (sv, a) => a.rec(a.it, tools(sv, a.it, a.where)) || '';
  // R-arch-10: the live kind does not wire Settings yet; a change goes through the adapter, which refuses, and nothing is written
  const refused = (what) => !!window.RailAdapter?.refuse?.(`settings.${what}`);
  function pick(sv, id, v) {
    if (id.startsWith('svm:')) {
      const a = REG.get(id.slice(4) + '/' + v); if (!a || refused(id.slice(4) + '/' + v)) return '';
      return runRec(sv, a);
    }
    const key = id.slice(3), [, p] = findPick(sv, key);
    if (!p || sv[key] === v || optsOf(p, sv).find((o) => o[0] === v)?.[3] || refused(key)) return '';   // no change, no toast; an off choice does nothing
    sv[key] = v;
    const also = p.then ? p.then(sv) : '';
    return also || '';   // the sentence has changed before your eyes; a toast says only what else happened
  }
  function toggle(sv, key) {
    if (key.startsWith('flag:')) {
      const k = key.slice(5), f = SM.FLAGS.find((x) => x.key === k);
      R.prefs.setFlag(k, !R.prefs.flag(k));
      const hidden = R.prefs.flag(k) && f.min && !R.shows(f.min, R.prefs.mode());   // on, but this mode does not draw what it adds: the toast says so
      return `${f.name}: ${R.prefs.flag(k) ? 'on' : 'off'}${hidden ? `. It shows in ${f.min[0].toUpperCase()}${f.min.slice(1)}; you are in ${R.prefs.mode()[0].toUpperCase()}${R.prefs.mode().slice(1)}` : ''}`;
    }
    if (refused(key)) return '';
    sv[key] = !sv[key];
    const r = rowsOf().find((x) => x.sw && x.sw.key === key) || listsOf().find((x) => x.sw && x.sw.key === key);
    return `${r ? r.name || r.title : key}: ${sv[key] ? 'on' : 'off'}`;
  }
  function doAct(sv, say) {
    if (say.startsWith('more:')) { sv.__open = sv.__open === say ? '' : say; return ''; }
    const d = sv.__dialog;
    if (d && say.startsWith('step:')) { d.at = +say.slice(5); d.status = ''; return ''; }
    if (d && say.startsWith('dlgopt:')) {
      const [, key, i] = say.split(':'), f = (d.steps ? d.steps[d.at] : d).fields.find((x) => x.key === key);
      d.vals[key] = f.options[+i][0]; if (f.then) f.then(d.vals);
      return '';
    }
    if (d && say.startsWith('dlgchk:')) { const k = say.slice(7); d.vals[k] = !d.vals[k]; return ''; }
    if (d && say.startsWith('dlgbtn:')) { const k = say.slice(7), f = (d.steps ? d.steps[d.at] : d).fields.find((x) => x.key === k); d.status = f.do(d.vals) || ''; return ''; }
    const a = REG.get(say);
    if (!a) throw new Error('settings: no action ' + say);
    if (a.live && window.RailWorld?.live && window.RailChatLive) { a.live(sv, () => window.dispatchEvent(new Event('rail-settings'))); return ''; }   // wired to dev in this slice (stillhet-wiring.md)
    if ((a.rec && !say.endsWith('/open')) || a.do) { if (refused(say)) return ''; }   // a row's open only shows it; what it then saves is the Dialog's
    if (a.rec) return runRec(sv, a);
    if (a.edit) { openDialog(sv, typeof a.edit === 'function' ? a.edit(sv) : a.edit); return ''; }
    if (a.confirm) { sv.__confirm = typeof a.confirm === 'function' ? a.confirm(sv) : a.confirm; return ''; }
    if (a.copy) { try { navigator.clipboard?.writeText(textOf(a.copy, sv))?.catch(() => {}); } catch { /* a page without clipboard access */ } return a.copied || window.RailWould(`copy: ${textOf(a.copy, sv)}`); }
    if (a.do) return a.do(sv) || '';
    if (a.click) { clickThrough(a.click); return a.say || ''; }
    if (a.page) return toPage(a.page, a.say);
    return a.say;
  }
  // The Dialog's answer: Next or Back move through its steps; its step says what changed; Cancel and Close leave
  // everything as it was. A problem keeps it open, in its status line.
  function dialog(sv, which) {
    const d = sv.__dialog; if (!d) return '';
    if (which === 'back') { d.at = Math.max(0, d.at - 1); d.status = ''; return ''; }
    if (which !== 'yes') { sv.__dialog = null; return ''; }
    const s = d.steps ? d.steps[d.at] : d;
    const wrong = s.check && s.check(d.vals, sv);
    if (wrong) { d.status = wrong; return ''; }
    if (d.steps && d.at < d.steps.length - 1) { d.at += 1; d.status = ''; return ''; }
    sv.__dialog = null;
    if (d.view && !d.then) return '';
    if (['Save', 'Add to changes'].includes(d.yes || 'Save') && Object.keys(d.vals).length && Object.keys(d.vals).every((k) => same(d.vals[k], d.start[k]))) return '';   // Save with nothing changed: no toast
    if (refused('save')) return '';
    const said = d.then ? d.then(d.vals, sv) : (Object.assign(sv, d.vals), undefined);
    return said === '' ? '' : said || d.done || `${d.title}: saved`;   // a then that returns '' changed nothing
  }
  function confirm(sv, yes) {
    const c = sv.__confirm; sv.__confirm = null;
    if (yes && c && !c.live && refused('confirm')) return '';   // a live confirm (`live: true`) is wired to dev; the rest are not yet
    return yes && c ? c.then(sv) || '' : '';
  }
  window.SettingsView = { fresh, section, strip, sentenceText, changesOf, rowsOf, pick, toggle, act: doAct, dialog, confirm };
})();
