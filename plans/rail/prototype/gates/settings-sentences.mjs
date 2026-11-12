// Every Settings sentence reads right for every option (docs/rail/settings.md, set.sentence), without a browser. A
// head sentence reads values from its fold, so each row is read against every option of every picker in the model,
// every switch flipped, and the money and notes cases below. It fails on what a wrong fill leaves behind: literal
// markup, an unfilled {key}, `1 runs`, and phrasing that only fits the default (`after never`, `at no limit`).
// Run: node plans/rail/prototype/gates/settings-sentences.mjs
global.window = { RailWould: (p) => 'Would ' + p };   // the prototype host's demo sentence (ui/public/stillhet/demo/demo-actions.js)
const noop = () => {};
global.document = { addEventListener: noop, querySelector: () => null };
global.window.RailUI = { ...(await import('../../../../ui/public/design-system/components/index.mjs')) };
const R = global.window.RailUI;
await import('../../../../ui/public/stillhet/settings/settings-model.js');
await import('../../../../ui/public/stillhet/settings/settings.js');
await import('../../../../ui/public/stillhet/shell/world.js'); await import('../../../../ui/public/stillhet/pulse/pulse-model.js');
const SM = global.window.SettingsModel, SV = global.window.SettingsView, M = global.window.PulseModel;
for (const f of SM.FLAGS) R.prefs.setFlag(f.key, true);

const BAD = [
  [/\*\*|`/, 'literal markup'],
  [/\bundefined\b|\bnull\b|\bNaN\b|\[object/, 'an empty value'],
  [/(?<![\d.,$])\b1 (?!minute\b)[a-z]+s\b/, 'a plural after 1'],
  [/\b(after|at|by|for|on|in) never\b|\bat no limit\b|\bwith no login\b.*signing|signing in with no\b|\bno cap spent\b|\bat nothing\b|\bwith nothing\b|\bfor also\b|\bcounts nothing\b|\babout needs you\b|\bon Pulse only\b|\bchecked never\b|\bmost any number\b/, 'phrasing that fits only the default'],
  [/\s[;,.]|;;|\.\.(?!\.)/, 'stray punctuation'],
];
const found = new Map();
const check = (where, text, why) => { for (const [re, what] of BAD) if (re.test(text)) { const k = `${what}: ${where}: "${text}"`; if (!found.has(k)) found.set(k, why); } };
const rows = SV.rowsOf();
const unfilled = (r, sv) => { const t = String(typeof r.say === 'function' ? r.say(sv) : r.say).replace(/`[^`]*`/g, ''); for (const m of t.matchAll(/\{(\w+)\}/g)) if (!(r.picks && r.picks[m[1]]) && !(r.vals && m[1] in r.vals)) return m[0]; return ''; };
const records = (o) => Object.values(SM.SECTIONS).flatMap((x) => x.sections).flatMap((s) => [...(s.list || []), ...(s.groups || []).flatMap((g) => g.list || [])]);
function readAll(sv, why) {
  for (const r of rows) {
    if (r.when && !r.when(sv)) continue;
    const u = unfilled(r, sv); if (u) found.set(`an unfilled ${u}: ${r.name}`, why);
    check(r.name, SV.sentenceText(r, sv), why);
  }
  for (const it of records()) if (it.live && (!it.when || it.when(sv, it))) check(it.title, it.live(sv, { ...it, id: 'r' }), why);
  for (const s of Object.values(SM.SECTIONS).flatMap((x) => x.sections)) if (typeof s.meta === 'function') check(s.title, s.meta(sv), why);
}
const base = () => { const sv = SV.fresh(); sv.__recs = {}; return sv; };
let reads = 0;
const read = (why, change) => { const sv = base(); change(sv); readAll(sv, why); reads += 1; };
read('the defaults', noop);
for (const r of rows) for (const [k, p] of Object.entries(r.picks || {})) {
  const opts = typeof p.options === 'function' ? p.options(base()) : p.options;
  for (const [id] of opts) read(`${k} = ${id}`, (sv) => { sv[k] = id; });
}
for (const r of rows) if (r.sw && r.sw.key) read(`${r.name} switched`, (sv) => { sv[r.sw.key] = !sv[r.sw.key]; });
for (const [why, change] of Object.entries({
  'no budget of your own': (sv) => { sv.total = ''; sv.perRun = ''; },
  'a budget above the team\'s': (sv) => { sv.total = '5000'; sv.perRun = '500'; },
  'a daily budget': (sv) => { sv.period = 'day'; sv.total = '100'; },
  'a weekly budget': (sv) => { sv.period = 'week'; },
  'one note': (sv) => { sv.__recs['memory/Notes'] = [{ title: 'one.md' }]; },
  'a proxy on, no login': (sv) => { sv.proxy = true; sv.auth = 'none'; },
  'no chat channels working': (sv) => { sv.chTelegram = false; sv.chDiscord = false; },
  'nothing the Abilities row can do': (sv) => { sv.scripts = false; sv.summaries = false; sv.nextPrompt = false; },
  'a policy change waiting': (sv) => { sv.capRun = '75'; sv.blockMcp = false; },
  'a failed update': (sv) => { sv.upd = 'failed'; sv.latest = '1.20.0'; },
})) read(why, change);

// The Changed dot (set.changed): nothing at Worca's defaults; a moved value names itself and its default, on its row and
// on the row it folds under; back at the default it goes.
for (const f of SM.FLAGS) R.prefs.setFlag(f.key, f.on);
const dotC = { level: 'expert', sv: base() }, top = Object.values(SM.SECTIONS).flatMap((x) => x.sections).flatMap((s) => [...(s.rows || []), ...(s.groups || []).flatMap((g) => g.rows || [])]);
for (const r of rows) { const c = SV.changesOf(r, dotC.sv, dotC); if (c.length) found.set(`a dot at the defaults: ${r.name}: ${JSON.stringify(c)}`, 'fresh'); }
for (const r of rows) for (const [k, p] of Object.entries(r.picks || {})) {
  const other = (typeof p.options === 'function' ? p.options(dotC.sv) : p.options).find((o) => o[0] !== p.value); if (!other) continue;
  const old = dotC.sv[k]; dotC.sv[k] = other[0];
  const lines = SV.changesOf(r, dotC.sv, dotC);
  if (lines.length !== 1 || /undefined|model:|\bnull\b/.test(lines[0].was)) found.set(`the dot's line for ${k}: ${JSON.stringify(lines)}`, 'a pick moved');
  dotC.sv[k] = old;
}
dotC.sv.runId = true; if (!SV.changesOf(top.find((r) => r.name === 'Naming'), dotC.sv, dotC).some((x) => x.name === 'Add run id' && x.was === 'off')) found.set('a folded value does not reach its row', 'runId on'); dotC.sv.runId = false;
dotC.sv.total = '500'; const budget = SV.changesOf(top.find((r) => r.name === 'Budget'), dotC.sv, dotC); if (budget.length !== 1 || budget[0].name !== 'Total' || budget[0].was !== '$1,000 a month') found.set(`Budget's line: ${JSON.stringify(budget)}`, 'total 500');

// Notifications: pulse.js fills these from Pulse's model.
for (const b of M.BADGE) check('Badge', `The tab title ${b.text}`, b.id);
for (const s of R.SOUND_CHOICES) check('Sound', s.text, s.id);
for (const l of M.LEVELS) for (const w of M.WHERE) check('Updates', w.id === 'pulse' ? w.text : `Send ${l.text} to ${w.text}`, `${l.id}, ${w.id}`);
for (const n of [[], ['Telegram'], ['Telegram', 'Discord']]) check('Chat', M.chatWords(n), `${n.length} working`);

if (found.size) {
  for (const [k, why] of found) console.error(`${k}  (with ${why})`);
  console.error(`\n${found.size} sentences read wrong, in ${reads} readings`);
  process.exit(1);
}
console.log(`settings-sentences: ${rows.length} rows read right in ${reads} readings`);
