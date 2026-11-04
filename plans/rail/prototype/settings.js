// Settings' sections (all but Notifications, which pulse.js draws from Pulse's model), drawn from settings-model.js with
// the Rail components alone, so the look, the alignment and the motion are the components':
//   a decision  → SettingsRow: its name, its state in words (SentencePickers where it changes), a Switch or a button;
//                 its fine-tuning folds under Customise (`more`);
//   a record    → ListRow in a List: the whole row opens the thing, its own actions in its ⋯;
//   Change…     → a Dialog with Fields (`edit`); a reset of many rows → the ConfirmStrip.
// A value lives in `sv`. Everything takes effect at once and says so in the toast; nothing is saved (a prototype).
(function () {
  const SM = window.SettingsModel;
  const flat = (rows) => (rows || []).flatMap((r) => [r, ...flat(r.more)]);
  const rowsOf = () => Object.values(SM.SECTIONS).flatMap((x) => x.sections.flatMap((s) => flat(s.rows)));
  const listsOf = () => Object.values(SM.SECTIONS).flatMap((x) => x.sections.flatMap((s) => [...(s.list || []), ...flat(s.rows).flatMap((r) => r.moreList || [])]));
  const REG = new Map();   // the last drawing's actions, by key: what a click on data-svdo means

  function fresh() {
    const sv = {};
    const seen = new Set(); const once = (k) => { if (seen.has(k)) throw new Error('settings-model: the key ' + k + ' is used twice'); seen.add(k); };
    for (const r of rowsOf()) {
      for (const [k, p] of Object.entries(r.picks || {})) { once(k); sv[k] = p.value; }
      if (r.sw) { once(r.sw.key); sv[r.sw.key] = !!r.sw.on; }
    }
    for (const it of listsOf()) if (it.sw) { once(it.sw.key); sv[it.sw.key] = !!it.sw.on; }
    return sv;
  }
  const findPick = (key) => { for (const r of rowsOf()) if (r.picks && r.picks[key]) return [r, r.picks[key]]; return [null, null]; };
  const optText = (p, v) => (p.options.find((o) => o[0] === v) || [v, v])[1];
  const words = (t, c) => c.esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

  function sentence(r, sv, c) {
    return words(r.say, c).replace(/\{(\w+)\}/g, (m, k) => {
      const p = r.picks && r.picks[k];
      if (!p) return m;   // a literal {word}, as in a branch pattern
      return c.R.sentencePicker({ id: 'sv:' + k, text: optText(p, sv[k]), open: c.open === 'sv:' + k, tip: p.tip || '', chevron: c.svg('chevron', 12), right: !!p.right,
        items: p.options.map(([id, text, help]) => ({ id, text, help, checked: sv[k] === id })) });
    });
  }
  // An action: a jump to another section (go), a Dialog (edit), or a step the prototype only names.
  function act(a, where, c) {
    const key = where + '/' + a.label; REG.set(key, a);
    return c.R.button({ label: a.label, kind: a.kind ?? 'quiet', attrs: a.go ? { 'data-sset': a.go, title: a.help || null } : { 'data-svdo': key, title: a.help || null } });
  }
  function row(r, sv, c, where) {
    const key = 'more:' + where + '/' + r.name, open = sv.__open === key;
    const sw = r.sw ? c.R.switchButton({ on: sv[r.sw.key], label: r.name, why: r.sw.why || '', attrs: { 'data-svsw': r.sw.key } }) : '';
    const folds = !!(r.more || r.moreList);
    const inner = open ? (r.more || []).filter((m) => SM.shows(m.min, c.level)).map((m) => row(m, sv, c, where + '/' + r.name)).join('') : '';
    const detail = open && r.moreList ? records(r.moreList, sv, c, where + '/' + r.name) : '';
    return c.R.settingsRow({ name: r.name, help: r.help || '', sentence: sentence(r, sv, c), end: (r.acts || []).map((a) => act(a, where + '/' + r.name, c)).join('') + sw, detailRows: inner, detail, fold: folds ? { open, attrs: { 'data-svdo': key } } : null });
  }
  // Records: a List of ListRows; the whole row opens the thing; its own actions in its ⋯.
  function records(items, sv, c, where) {
    return c.R.list({ groups: [{ rows: items.map((it) => {
      const k = where + '/' + it.title; REG.set(k + '/open', { label: 'Open', say: 'Opens ' + it.title });
      const mid = 'svm:' + k;
      (it.menu || []).forEach((m) => REG.set(k + '/' + m, { label: m, say: `${m}: ${it.title}` }));
      const sw = it.sw ? c.R.switchButton({ on: sv[it.sw.key], label: it.title, attrs: { 'data-svsw': it.sw.key } }) : '';
      return c.R.listRow({ title: it.title, meta: it.meta || '', mark: it.mark ? c.R.statusDot({ tone: it.mark }) : '', endText: it.fig || '', end: sw, open: { 'data-svdo': k + '/open', title: 'Open ' + it.title },
        menu: it.menu ? { id: mid, label: 'More for ' + it.title, icon: c.svg('more', 14), items: it.menu, open: c.open === mid } : null });
    }) }] });
  }
  function dialogHtml(sv, c) {
    const d = sv.__dialog; if (!d) return '';
    return c.R.dialog({ title: d.title, yes: d.yes || 'Save', status: d.status || '', close: c.svg('x', 14), id: 'sv-dlg-t',
      body: (d.fields || []).map((f, i) => c.R.field({ id: 'sv-f' + i, label: f.label, value: f.value || '', hint: f.hint || '', multiline: !!f.multiline })).join('') });
  }
  function section(id, sv, c) {
    const sec = SM.SECTIONS[id];
    if (!sec) return '';
    REG.clear();
    const strip = sv.__confirm ? c.R.confirmStrip({ text: sv.__confirm.text, yes: sv.__confirm.yes, danger: !!sv.__confirm.done }) : '';
    return dialogHtml(sv, c) + strip + sec.sections.filter((s) => SM.shows(s.min, c.level)).map((s) => {
      const where = id + '/' + s.title;
      const head = s.action ? (s.action.confirm ? c.R.button({ label: s.action.label, kind: 'quiet', attrs: { 'data-svdo': 'confirm:' + id + ':' + s.title, title: s.action.help || null } }) : act(s.action, where, c)) : '';
      const rows = (s.rows || []).filter((r) => SM.shows(r.min, c.level)).map((r) => row(r, sv, c, where)).join('');
      return c.R.settingsSection({ title: s.title, meta: s.meta || '', action: head, rows: rows + (s.list ? records(s.list, sv, c, where) : '') });
    }).join('');
  }
  function pick(sv, id, v) {
    if (id.startsWith('svm:')) { const a = REG.get(id.slice(4) + '/' + v); return a ? `${a.say} (not in this prototype)` : ''; }
    const key = id.slice(3), [r, p] = findPick(key);
    if (!p) return '';
    sv[key] = v;
    return `${r.name}: ${optText(p, v)}`;
  }
  function toggle(sv, key) {
    sv[key] = !sv[key];
    const r = rowsOf().find((x) => x.sw && x.sw.key === key) || listsOf().find((x) => x.sw && x.sw.key === key);
    return `${r ? r.name || r.title : key}: ${sv[key] ? 'on' : 'off'}`;
  }
  function doAct(sv, say) {
    if (say.startsWith('confirm:')) {
      const [, id, title] = say.split(':'), s = SM.SECTIONS[id].sections.find((x) => x.title === title);
      sv.__confirm = { id, title, text: s.action.confirm, yes: s.action.yes || (s.action.label === 'Reset all' ? 'Reset all' : 'Reset'), done: s.action.done };
      return '';
    }
    if (say.startsWith('more:')) { sv.__open = sv.__open === say ? '' : say; return ''; }
    const a = REG.get(say);
    if (a && a.edit) { sv.__dialog = a.edit; return ''; }
    return `${a ? a.say || a.label : say} (not in this prototype)`;
  }
  // The Dialog's answer: its step says what changed; Cancel and Close leave everything as it was.
  function dialog(sv, which) {
    const d = sv.__dialog; sv.__dialog = null;
    return which === 'yes' && d ? d.done || `${d.title}: saved` : '';
  }
  function confirm(sv, yes) {
    const c = sv.__confirm; sv.__confirm = null;
    if (!yes || !c) return '';
    if (c.done) return c.done;   // a step that is not a reset (Delete all chats)
    for (const r of flat(SM.SECTIONS[c.id].sections.find((x) => x.title === c.title).rows)) {
      for (const [k, p] of Object.entries(r.picks || {})) sv[k] = p.value;
      if (r.sw) sv[r.sw.key] = !!r.sw.on;
    }
    return `${c.title}: back to its defaults`;
  }
  window.SettingsView = { fresh, section, pick, toggle, act: doAct, dialog, confirm };
})();
