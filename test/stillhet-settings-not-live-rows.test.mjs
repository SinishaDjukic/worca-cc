// test/stillhet-settings-not-live-rows.test.mjs — Stillhet Settings in the live kind (ui/public/stillhet/settings/settings.js,
// settings-model.js, pulse/pulse.js): a row or section still sample shows no value and nothing to click, and reads the
// NotLiveRow sentence (docs/rail/settings.md `set.not-live`). A section all sample is its title and one line; a mixed
// section's sample rows are their name and the line. Live rows (Prompt check, Delete all chats) stay as they are, and the
// demo kind keeps every sample value. Each window is closed when its test ends (closeHosts).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, settle, clone, SOURCES, closeHosts } from './helpers/stillhet-live-counts-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const demoClosers = [];
afterEach(() => { while (demoClosers.length) demoClosers.pop()(); });

const SENTENCE = 'Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it';

async function live(opts = {}) {
  const h = await liveHost({ hash: '#chat', ...opts });
  await h.hello();
  return h;
}
const page = (d) => d.querySelector('#route-settings');
async function go(w, hash, ms = 120) { w.location.hash = hash; await settle(ms); return page(w.document).textContent; }
const secs = (d) => [...page(d).querySelectorAll('.set-sec')];
const secTitle = (s) => s.querySelector('.set-sec-h')?.textContent.trim() || '';
const secOf = (d, title) => secs(d).find((s) => secTitle(s) === title);
const rowOf = (d, name) => [...page(d).querySelectorAll('.set-row')].find((r) => r.querySelector('.set-name')?.textContent.trim() === name);
const textOf = (r) => r.querySelector('.set-text').textContent.trim();
// A section all sample: its title and exactly one line, the sentence, and nothing else.
function assertLine(d, title) {
  const s = secOf(d, title);
  assert.ok(s, `the ${title} section is drawn`);
  const lines = [...s.querySelectorAll('.el-t')].map((x) => x.textContent);
  assert.deepEqual(lines, [SENTENCE], `${title} reads the sentence once`);
  assert.equal(s.querySelectorAll('.set-row, .lr-t').length, 0, `${title} has no rows`);
}
function assertNotLiveRow(d, name) {
  const r = rowOf(d, name);
  assert.ok(r, `the ${name} row is drawn`);
  assert.equal(textOf(r), SENTENCE, `${name} reads the sentence`);
  assert.equal(r.querySelector('.row-end, .set-end')?.children.length ?? 0, 0, `${name} has nothing at its end`);
  assert.equal(r.querySelectorAll('button, [role=switch], .spick, .set-dot').length, 0, `${name} has nothing to click`);
}
async function find(w, q) {
  const d = w.document, i = d.querySelector('[data-search]');
  i.value = q; i.dispatchEvent(new w.Event('input', { bubbles: true }));
  await settle(20);
  return d.querySelector('[data-search-res]').textContent.replace(/Ask Chat:[\s\S]*$/, '');   // the tail always echoes the words
}

test('F-7b-03/F-7b-13: live Tasks: Spending, Starting, Limits, Away mode and Machine each read the sentence and show no value', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/runs');
  for (const t of ['Spending', 'Starting', 'Limits', 'Away mode', 'Machine']) assertLine(d, t);
  for (const v of ['$35', '{type}/{slug}', 'type/slug', '22:00', 'proxy.corp.example', 'Warning line', '80%']) assert.ok(!text.includes(v), `no ${v}`);
});

test('F-7b-03: a live not-live section holds nothing to click', async () => {
  const { w, d } = await live();
  await go(w, '#settings/runs');
  const all = secs(d);
  assert.ok(all.length >= 5);
  for (const s of all) assert.equal(s.querySelectorAll('[data-svdo], [data-svsw], .spick, button').length, 0, secTitle(s));
});

test('F-7b-10: live Presets and Labels read the sentence, with no sample record', async () => {
  const { w, d } = await live();
  w.RailUI.prefs.setFlag('runLabels', true);
  for (const hash of ['#settings/presets', '#settings/labels']) {
    const text = await go(w, hash);
    const s = secs(d);
    assert.equal(s.length, 1, hash);
    assert.equal(secTitle(s[0]), '', `${hash}: a bare section has no title`);
    assert.deepEqual([...s[0].querySelectorAll('.el-t')].map((x) => x.textContent), [SENTENCE], hash);
    for (const v of ['Bug fix', 'Docs pass', 'frontend', 'needs demo', 'No presets yet', 'No labels yet']) assert.ok(!text.includes(v), `${hash}: no ${v}`);
    assert.equal(page(d).querySelectorAll('.lr-t').length, 0, hash);
  }
});

test('F-7b-08: live Models: Defaults, Jobs, Sign-ins and Catalogue each read the sentence', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/models');
  for (const t of ['Defaults', 'Jobs', 'Sign-ins', 'Catalogue']) assertLine(d, t);
  for (const v of ['GitHub Copilot', 'claude-sonnet-5-5', 'Add model']) assert.ok(!text.includes(v), `no ${v}`);
});

test('F-7b-03/F-7b-09: live Chat: Engine, Limits, Web and Connectors are not-live rows; Channels and Speech are one line each', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/ask');
  for (const n of ['Engine', 'Limits', 'Web', 'Connectors']) assertNotLiveRow(d, n);
  assertLine(d, 'Channels');
  assertLine(d, 'Speech');
  for (const v of ['Sonnet 5.5', '400', 'Telegram']) assert.ok(!text.includes(v), `no ${v}`);
});

test('F-7b-09: live Chat history reads the sentence; Delete all chats stays dev\'s action', async () => {
  const { w, d } = await live();
  await go(w, '#settings/ask');
  assertNotLiveRow(d, 'Chat history');
  assert.doesNotMatch(rowOf(d, 'Chat history').textContent, /38/);
  const del = [...secOf(d, 'History').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete all chats');
  assert.ok(del, 'Delete all chats is in the head');
  assert.equal(del.disabled, false);
});

test('F-7b-03: live Abilities keeps Prompt check live and its other abilities read the sentence', async () => {
  const withChat = (chat) => ({ ...clone(SOURCES), settings: { ...clone(SOURCES.settings || {}), chat } });
  for (const [on, words] of [[false, 'Does not check how clear a task is'], [true, 'Checks how clear a task is']]) {
    const { w, d } = await live({ sources: withChat({ promptCheck: on }) });
    await go(w, '#settings/ask');
    assert.equal(textOf(rowOf(d, 'Abilities')), words);
    d.querySelector('[data-svdo="more:ask/Assistant/Abilities"]').click();
    await settle(40);
    for (const n of ['Scripts', 'Summaries', 'Suggestions']) assertNotLiveRow(d, n);
    const sw = page(d).querySelector('[data-svsw="promptCheck"]');
    assert.ok(sw, 'Prompt check keeps its switch');
    assert.equal(sw.getAttribute('aria-checked'), String(on));
    closeHosts();
  }
});

test('F-7b-10: live Memory, Guardrails and Connectors read the sentence in every section', async () => {
  const { w, d } = await live();
  const places = { memory: ['Notes', 'Restore points', 'Proposals', 'Team memory'], guardrails: ['Sets'], connectors: ['Servers', 'Sets', 'Skills'] };
  for (const [id, titles] of Object.entries(places)) {
    const text = await go(w, '#settings/' + id);
    assert.deepEqual(secs(d).map(secTitle), titles, id);
    for (const t of titles) assertLine(d, t);
    for (const v of ['architecture.md', 'Strict', 'github', 'pdf-tools', 'New note', 'Add server']) assert.ok(!text.includes(v), `${id}: no ${v}`);
  }
});

test('F-7b-07: live General: Setup, Storage and About read the sentence; Credentials is unchanged', async () => {
  const { w, d } = await live();
  const text = await go(w, '#settings/general');
  for (const t of ['Setup', 'Storage']) assertLine(d, t);
  assert.notEqual(textOf(rowOf(d, 'Version')), SENTENCE, 'F-G-G5-04: About is live, its Version read from GET /api/app/version');
  for (const v of ['1.19', '~/.worca-cc', 'Getting started', 'Browser extension']) assert.ok(!text.includes(v), `no ${v}`);
  assert.match(text, /Each engine signs in by itself/);
  assert.notEqual(textOf(rowOf(d, 'GitHub')), SENTENCE);
});

test('F-7b-03: sweep: on live, every Settings place\'s rows are live or read the sentence', async () => {
  const { w, d, posts } = await live();
  const SM = w.SettingsModel;
  for (const f of SM.FLAGS) w.RailUI.prefs.setFlag(f.key, true);
  const LIVE = new Set(['Abilities', 'Prompt check', 'Model keys', 'GitHub', 'Version']);   // Version: F-G-G5-04
  const SKIP = new Set(['team', 'plugins', 'experimental', 'automations']);
  const n = posts.length;
  for (const id of Object.keys(SM.SECTIONS)) {
    if (SKIP.has(id)) continue;
    await go(w, '#settings/' + id);
    assert.ok(secs(d).length > 0, `${id} draws its sections`);
    for (const r of page(d).querySelectorAll('.set-row')) {
      const name = r.querySelector('.set-name').textContent.trim();
      if (!LIVE.has(name)) assert.equal(textOf(r), SENTENCE, `${id} › ${name} is live or reads the sentence`);
    }
    assert.equal(page(d).querySelectorAll('.lr-t').length, 0, `${id} draws no sample record`);
  }
  assert.equal(posts.length, n, 'nothing is sent');
});

test('F-7b-03: live search finds a not-live row by name, never its sample value', async () => {
  const { w } = await live();
  w.RailUI.prefs.setFlag('runLabels', true);
  await go(w, '#settings/runs');
  // a row of a section all sample is not found (its section's head is); a not-live row in a mixed section is, by name only
  const rate = await find(w, 'Hourly rate');
  assert.doesNotMatch(rate, /\$35|Time saved/);
  assert.match(await find(w, 'Spending'), /Spending/);
  const history = await find(w, 'Chat history');
  assert.match(history, /Chat history/);
  assert.doesNotMatch(history, /worktrees|attachments/);
  assert.doesNotMatch(await find(w, 'On 14 runs'), /frontend/, 'a sample label record is not found by its words');
  assert.doesNotMatch(await find(w, 'frontend'), /On 14 runs/);
  assert.doesNotMatch(await find(w, 'Bug fix'), /Fix workflow/);
  assert.doesNotMatch(await find(w, '35'), /Time saved is counted/);
  assert.match(await find(w, 'Prompt check'), /Prompt check/);
});

test('demo keeps every sample value and never says Not in Stillhet yet', async () => {
  const w = stillhetHost({ hash: '#chat', after: (fn) => demoClosers.push(fn) });
  await settle(200);
  assert.equal(w.RailWorld.live, false);
  w.RailUI.prefs.setMode('expert');
  assert.match(await go(w, '#settings/runs'), /\$35/);
  assert.match(await go(w, '#settings/models'), /GitHub Copilot/);
  const chat = await go(w, '#settings/ask');
  assert.match(chat, /Sonnet 5\.5/);
  const abilities = [...page(w.document).querySelectorAll('.set-row')].find((r) => r.querySelector('.set-name')?.textContent.trim() === 'Abilities');
  assert.match(abilities.querySelector('.set-text').textContent, /Runs scripts/);
  for (const id of Object.keys(w.SettingsModel.SECTIONS)) assert.ok(!(await go(w, '#settings/' + id)).includes(SENTENCE), `${id} never says it`);
});
