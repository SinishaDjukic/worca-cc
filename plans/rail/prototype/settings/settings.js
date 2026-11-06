// Settings' sections (all but Notifications, which pulse.js draws from Pulse's model), drawn from settings-model.js with
// the Rail components alone, so the look, the alignment and the motion are the components':
//   a decision  → SettingsRow: its name, its state in words (SentencePickers where it changes), a Switch or a button;
//                 its fine-tuning folds under Customise (`more`);
//   a record    → ListRow in a List: the whole row opens the thing, its own actions in its ⋯;
//   Change…     → a Dialog with Fields (`edit`), stepped when it has `steps`; a yes or no → the ConfirmStrip.
// A value lives in `sv`, a Labs flag in R.prefs. Every control acts on them; nothing is saved (a prototype).
(function () {
  const SM = window.SettingsModel, R = window.RailUI;
  for (const f of SM.FLAGS) R.prefs.setFlag(f.key, f.on);   // a Labs switch's default, for every page that reads a flag

  const flat = (rows) => (rows || []).flatMap((r) => [r, ...flat(r.more)]);
  const allSections = () => Object.values(SM.SECTIONS).flatMap((x) => x.sections);
  const rowsOf = () => allSections().flatMap((s) => flat(s.rows));
  const listsOf = () => allSections().flatMap((s) => [...(s.list || []), ...flat(s.rows).flatMap((r) => r.moreList || [])]);
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
  const optText = (p, v) => (p.options.find((o) => o[0] === v) || [v, v])[1];
  const words = (t, c) => c.esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  const vis = (x, c) => R.shows(x.min, c.level) && (!x.flag || R.prefs.flag(x.flag)) && (!x.when || x.when(c.sv));
  const textOf = (v, sv) => (typeof v === 'function' ? v(sv) : v);

  function sentence(r, sv, c) {
    return words(r.say, c).replace(/\{(\w+)\}/g, (m, k) => {
      const p = r.picks && r.picks[k];
      if (p) {
        if (c.locked) return `<b>${c.esc(optText(p, sv[k]))}</b>`;
        return c.R.sentencePicker({ id: 'sv:' + k, text: optText(p, sv[k]), open: c.open === 'sv:' + k, tip: p.tip || '', chevron: c.svg('chevron', 12), right: !!p.right,
          items: p.options.map(([id, text, help]) => ({ id, text, help, checked: sv[k] === id })) });
      }
      if (r.vals && k in r.vals) return c.esc(typeof r.vals[k] === 'function' ? r.vals[k](sv) : sv[k]);
      return m;   // a literal {word}
    });
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
    const off = c.locked || s.locked || '';
    return c.R.switchButton({ on: s.flag ? R.prefs.flag(s.flag) : sv[s.key], label, why: off || s.why || '', disabled: !!off, attrs: { 'data-svsw': s.flag ? 'flag:' + s.flag : s.key } });
  }
  const chipOf = (x, sv, c) => { const t = x.chip && textOf(x.chip, sv); return t ? c.R.chip({ text: t, title: x.chipTip || '' }) : ''; };
  function row(r, sv, c, where) {
    const key = 'more:' + where + '/' + r.name, open = sv.__open === key;
    const folds = !!(r.more || r.moreList);
    const inner = open ? (r.more || []).filter((m) => vis(m, c)).map((m) => row(m, sv, c, where + '/' + r.name)).join('') : '';
    const detail = open && r.moreList ? records(r.moreList, sv, c, where + '/' + r.name, r.empty) : '';
    const acts = (r.acts || []).filter((a) => vis(a, c)).map((a) => act(a, where + '/' + r.name, c)).join('');
    return c.R.settingsRow({ name: r.name, help: r.help || '', sentence: sentence(r, sv, c), end: chipOf(r, sv, c) + acts + swOf(r, r.name, sv, c), detailRows: inner, detail, fold: folds ? { open, attrs: { 'data-svdo': key, 'data-key': 'sv:' + key } } : null });
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
    return (s.list || []).map((it, i) => ({ ...it, id: 'r' + i }));
  }
  const goSection = (id) => setTimeout(() => { if (window.RailShell) window.RailShell.go('settings/' + id); else document.querySelector(`[data-sset="${id}"]`)?.click(); });
  const toPage = (p, say) => { if (window.RailShell) { setTimeout(() => window.RailShell.go(p)); return ''; } return say; };
  const clickThrough = (sels) => setTimeout(() => sels.forEach((s) => document.querySelector(s)?.click()));
  // The record actions every list shares; anything else is the record's own `on`, or a model error (a dead control).
  const SHARED = {
    Rename: (r, x) => x.dialog({ title: `Rename ${r.title}`, yes: 'Rename', fields: [{ key: 'name', label: 'Name', value: r.title }], then: (v) => { const old = r.title; r.title = v.name.trim() || old; return `Renamed to ${r.title}`; } }),
    Duplicate: (r, x) => { x.add({ ...r, title: r.title + ' copy', ...(r.copy || {}) }); return `Duplicated: ${r.title} copy`; },
    Edit: (r, x) => x.dialog({ title: `Edit ${r.title}`, fields: [{ key: 'name', label: 'Name', value: r.title }, { key: 'meta', label: 'Details', value: r.meta || '' }], then: (v) => { r.title = v.name.trim() || r.title; r.meta = v.meta; return `${r.title} saved`; } }),
    Reject: (r, x) => { x.remove(); return `Rejected: ${r.title}`; },
    ...Object.fromEntries(['Delete', 'Remove', 'Revoke', 'Uninstall'].map((w) => [w, (r, x) => x.confirm({ text: `${w} ${r.title}?`, yes: w, danger: true, then: () => { x.remove(); return `${w === 'Revoke' ? 'Revoked' : w === 'Uninstall' ? 'Uninstalled' : w === 'Delete' ? 'Deleted' : 'Removed'}: ${r.title}`; } })])),
  };
  function records(items, sv, c, where, empty) {
    const recs = recsOf(sv, where, items);
    const rows = recs.filter((it) => !it.when || it.when(sv, it)).map((it) => {
      const k = where + '/' + it.id, mid = 'svm:' + k;
      const menu = c.locked ? [] : (typeof it.menu === 'function' ? it.menu(it, sv) : it.menu) || [];
      for (const m of menu) {
        const fn = (it.on && it.on[m]) || SHARED[m];
        if (!fn) throw new Error(`settings-model: "${m}" on ${it.title} does nothing`);
        REG.set(k + '/' + m, { rec: fn, it, where });
      }
      REG.set(k + '/open', { rec: it.open || ((r, x) => x.dialog({ title: r.title, view: true, yes: 'Close', note: r.detail || (r.live ? r.live(sv, r) : r.meta) })), it, where });
      const meta = (it.live ? it.live(sv, it) : it.meta) || '';
      return c.R.listRow({ title: it.title, meta, mark: it.mark ? c.R.statusDot({ tone: it.mark }) : '', endText: it.fig || '', end: chipOf(it, sv, c) + swOf(it, it.title, sv, c),
        open: { 'data-svdo': k + '/open', 'data-key': 'sv:' + k + '/open', title: meta || 'Open ' + it.title },
        menu: menu.length ? { id: mid, label: 'More for ' + it.title, icon: c.svg('more', 14), items: menu, open: c.open === mid } : null });
    });
    return c.R.list({ groups: [{ rows }], empty: c.R.emptyState({ title: empty || 'Nothing here yet' }) });
  }

  // ---- the Dialog: Fields, an OptionList, a Checkbox, facts, rows; one screen per step when it has `steps` ----
  function openDialog(sv, spec) {
    const d = { ...spec, vals: {}, at: 0, status: spec.status || '' };
    for (const f of (d.steps || [d]).flatMap((s) => s.fields || [])) if (f.key) d.vals[f.key] = f.value ?? sv[f.key] ?? '';
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
    const body = (note ? `<p class="dlg-note">${words(note, c)}</p>` : '')
      + (facts ? c.R.list({ groups: [{ rows: facts.map((x) => c.R.listRow({ title: x.title, meta: x.meta || '', mark: x.mark ? c.R.statusDot({ tone: x.mark }) : '' })) }] }) : '')
      + (s.rows || []).map((r) => row(r, sv, c, 'dlg')).join('')
      + (s.fields || []).map((f) => fieldHtml(f, d, sv, c)).join('');
    const steps = d.steps ? c.R.stepper({ label: 'Steps', stages: d.steps.map((x, i) => ({ key: 'sa-' + i, label: x.label, selected: i === d.at, cells: [i < d.at ? 'is-done' : i === d.at ? 'is-now' : 'is-next'], attrs: { 'data-svdo': 'step:' + i } })) }) : '';
    return c.R.dialog({ title: d.title, yes: last ? d.yes || 'Save' : 'Next', status: c.esc(d.status || ''), close: c.svg('x', 14), id: 'sv-dlg-t', body, steps, back: !!d.steps && d.at > 0, view: !!d.view });
  }
  document.addEventListener('input', (e) => {
    const id = e.target && e.target.id, d = cur && cur.__dialog;
    if (d && id && id.startsWith('sv-f-')) d.vals[id.slice(5)] = e.target.value;
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
    const strip = sv.__confirm ? c.R.confirmStrip({ text: sv.__confirm.text, yes: sv.__confirm.yes, danger: !!sv.__confirm.danger }) : '';
    return dialogHtml(sv, c) + strip + sec.sections.filter((s) => vis(s, c)).map((s) => {
      const where = id + '/' + s.title, cc = { ...c, locked };
      const head = (s.actions || []).filter((a) => vis(a, c)).map((a) => act(a, where, cc)).join('');
      const rows = ((c.extra && c.extra[s.title]) || '') + (s.rows || []).filter((r) => vis(r, c)).map((r) => row(r, sv, cc, where)).join('');
      const table = s.table ? c.R.table({ ...s.table, rows: textOf(s.table.rows, sv) }) : '';
      return c.R.settingsSection({ title: s.title, meta: textOf(s.meta, sv) || '', action: head, rows: rows + table + (s.list ? records(s.list, sv, cc, where, s.empty) : '') });
    }).join('');
  }

  // ---- what a click means ----
  const runRec = (sv, a) => a.rec(a.it, tools(sv, a.it, a.where)) || '';
  function pick(sv, id, v) {
    if (id.startsWith('svm:')) {
      const a = REG.get(id.slice(4) + '/' + v); if (!a) return '';
      return runRec(sv, a);
    }
    const key = id.slice(3), [r, p] = findPick(sv, key);
    if (!p) return '';
    sv[key] = v;
    return `${r.name}: ${optText(p, v)}`;
  }
  function toggle(sv, key) {
    if (key.startsWith('flag:')) {
      const k = key.slice(5), f = SM.FLAGS.find((x) => x.key === k);
      R.prefs.setFlag(k, !R.prefs.flag(k));
      return `${f.name}: ${R.prefs.flag(k) ? 'on' : 'off'}`;
    }
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
    if (a.rec) return runRec(sv, a);
    if (a.edit) { openDialog(sv, typeof a.edit === 'function' ? a.edit(sv) : a.edit); return ''; }
    if (a.confirm) { sv.__confirm = typeof a.confirm === 'function' ? a.confirm(sv) : a.confirm; return ''; }
    if (a.copy) { try { navigator.clipboard?.writeText(textOf(a.copy, sv))?.catch(() => {}); } catch { /* a page without clipboard access */ } return `Copied: ${textOf(a.copy, sv)}`; }
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
    const said = d.then ? d.then(d.vals, sv) : (Object.assign(sv, d.vals), '');
    return said || d.done || `${d.title}: saved`;
  }
  function confirm(sv, yes) {
    const c = sv.__confirm; sv.__confirm = null;
    return yes && c ? c.then(sv) || '' : '';
  }
  window.SettingsView = { fresh, section, pick, toggle, act: doAct, dialog, confirm };
})();
