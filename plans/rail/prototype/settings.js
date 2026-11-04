// Settings' sections (all but Notifications, which pulse.js draws from Pulse's model): each one drawn from
// settings-model.js with the Rail components alone (SettingsSection, SettingsRow, SentencePicker, Switch, Button), so
// the alignment is the components'. A row's sentence is words with {key} where a picker sits; a value lives in `sv`.
// Everything takes effect at once and says so in the toast; nothing is saved anywhere (a prototype).
(function () {
  const SM = window.SettingsModel;
  const rowsOf = () => Object.values(SM.SECTIONS).flatMap((x) => x.sections.flatMap((s) => s.rows));

  function fresh() {
    const sv = {};
    const seen = new Set(); const once = (k) => { if (seen.has(k)) throw new Error('settings-model: the key ' + k + ' is used twice'); seen.add(k); };
    for (const r of rowsOf()) {
      for (const [k, p] of Object.entries(r.picks || {})) { once(k); sv[k] = p.value; }
      if (r.sw) { once(r.sw.key); sv[r.sw.key] = !!r.sw.on; }
    }
    return sv;
  }
  const findPick = (key) => { for (const r of rowsOf()) if (r.picks && r.picks[key]) return [r, r.picks[key]]; return [null, null]; };
  const optText = (p, v) => (p.options.find((o) => o[0] === v) || [v, v])[1];

  function sentence(r, sv, c) {
    const words = c.esc(r.say || '').replace(/\{(\w+)\}/g, (m, k) => {
      const p = r.picks && r.picks[k];
      if (!p) return m;   // a literal {word}, as in a branch pattern
      return c.R.sentencePicker({ id: 'sv:' + k, text: optText(p, sv[k]), open: c.open === 'sv:' + k, tip: p.tip || '', chevron: c.svg('chevron', 12), right: !!p.right,
        items: p.options.map(([id, text, help]) => ({ id, text, help, checked: sv[k] === id })) });
    });
    return words.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  }
  const actBtn = (a, c) => c.R.button({ label: a.label, kind: a.kind ?? 'quiet', attrs: a.go ? { 'data-sset': a.go, title: a.help || null } : { 'data-svdo': a.say || a.label, title: a.help || null } });
  function end(r, sv, c) {
    const sw = r.sw ? c.R.switchButton({ on: sv[r.sw.key], label: r.name, why: r.sw.why || '', attrs: { 'data-svsw': r.sw.key } }) : '';
    return (r.acts || []).map((a) => actBtn(a, c)).join('') + sw;
  }
  // A section's reset asks first, in the strip above the sections (Rail: only a reset of many rows confirms).
  function section(id, sv, c) {
    const sec = SM.SECTIONS[id];
    if (!sec) return '';
    const strip = sv.__confirm ? c.R.confirmStrip({ text: sv.__confirm.text, yes: sv.__confirm.yes }) : '';
    return strip + sec.sections.filter((s) => SM.shows(s.min, c.level)).map((s) => c.R.settingsSection({
      title: s.title, meta: s.meta || '',
      action: s.action ? c.R.button({ label: s.action.label, kind: 'quiet', attrs: { 'data-svdo': s.action.confirm ? 'confirm:' + id + ':' + s.title : s.action.say || s.action.label, title: s.action.help || null } }) : '',
      rows: s.rows.filter((r) => SM.shows(r.min, c.level)).map((r) => c.R.settingsRow({ name: r.name, help: r.help || '', sentence: sentence(r, sv, c), end: end(r, sv, c) })).join(''),
    })).join('');
  }
  function pick(sv, id, v) {
    const key = id.slice(3), [r, p] = findPick(key);
    if (!p) return '';
    sv[key] = v;
    return `${r.name}: ${optText(p, v)}`;
  }
  function toggle(sv, key) {
    sv[key] = !sv[key];
    const r = rowsOf().find((x) => x.sw && x.sw.key === key);
    return `${r ? r.name : key}: ${sv[key] ? 'on' : 'off'}`;
  }
  // A reset puts every row of its section back to the model's value, after the strip's yes.
  function act(sv, say) {
    if (say.startsWith('confirm:')) {
      const [, id, title] = say.split(':'), s = SM.SECTIONS[id].sections.find((x) => x.title === title);
      sv.__confirm = { id, title, text: s.action.confirm, yes: s.action.label === 'Reset all' ? 'Reset all' : 'Reset' };
      return '';
    }
    return `${say} (not in this prototype)`;
  }
  function confirm(sv, yes) {
    const c = sv.__confirm; sv.__confirm = null;
    if (!yes || !c) return '';
    for (const r of SM.SECTIONS[c.id].sections.find((x) => x.title === c.title).rows) {
      for (const [k, p] of Object.entries(r.picks || {})) sv[k] = p.value;
      if (r.sw) sv[r.sw.key] = !!r.sw.on;
    }
    return `${c.title}: back to its defaults`;
  }
  window.SettingsView = { fresh, section, pick, toggle, act, confirm };
})();
