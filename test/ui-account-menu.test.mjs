// test/ui-account-menu.test.mjs — pure tests for ui/public/account-menu.mjs: the spend ring around
// the avatar, the spend card at the top of the account menu and its free-request row, who the corner
// says is signed in, and the away row. No app.js boot: renderers take `doc` explicitly and return
// detached DOM; painters write into a copy of the shell's markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { BUDGET_WARN_AT } from '../ui/public/stats-view.mjs';
import {
  spendRing, ringDash, spendPeriod, renderSpendCard, RING_R, MINI_R,
  personInitials, describeAccount, accountLabel, paintAccountCorner, paintIdentityCard, paintAwayRow,
} from '../ui/public/account-menu.mjs';
import { describeAwayRow } from '../src/shared/away-mode/describe.mjs';
import { createLevelController, levelMenuHtml, LEVEL_SHORT, LEVEL_INFO, UI_LEVELS } from '../ui/public/ui-level.mjs';
import { freeDailyRow } from '../ui/public/openrouter-free-view.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
// Local-calendar bounds, as costWindowStart/End build them, so the month reads the same in every zone.
const OCT = { windowStartMs: new Date(2026, 9, 1).getTime(), windowEndMs: new Date(2026, 10, 1).getTime() };
// /api/budget sends windowSavedUsd with a limit too; the card must not show it then.
const LIMIT = { ...OCT, totalLimitUsd: 50, resetPeriod: 'monthly', windowSpendUsd: 20, windowSavedUsd: 12, blocked: false, msUntilReset: 86400000 };
const NO_LIMIT = { ...OCT, totalLimitUsd: null, resetPeriod: 'monthly', windowSpendUsd: 163.49, windowSavedUsd: 3591.31, blocked: false };
const FREE = (o) => ({ enabled: true, known: true, limit: 50, remaining: 37, resetAt: '2026-10-09T00:00:00Z', models: [], ...o });
const rows = (card) => [...card.querySelectorAll('.mc-rows dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent, dt.nextElementSibling.className]);

test('spendRing: no ring without a limit; grey, amber from BUDGET_WARN_AT, full and red when blocked; clamped both ways', async () => {
  await checkRows([
    { name: 'no total limit: no ring', run: () => {
      assert.equal(spendRing(NO_LIMIT), null);
      assert.equal(spendRing(null), null);
      assert.equal(spendRing({ ...NO_LIMIT, totalLimitUsd: 'x' }), null, 'a non-number limit is no limit');
    } },
    { name: 'under the warn band: grey', run: () => assert.deepEqual(spendRing(LIMIT), { ratio: 0.4, tone: '' }) },
    { name: 'from BUDGET_WARN_AT: amber', run: () => {
      assert.deepEqual(spendRing({ ...LIMIT, windowSpendUsd: 50 * BUDGET_WARN_AT }), { ratio: BUDGET_WARN_AT, tone: 'warn' });
      assert.equal(spendRing({ ...LIMIT, windowSpendUsd: 50 * BUDGET_WARN_AT - 0.01 }).tone, '');
    } },
    { name: 'blocked: full and red, whatever the figures say', run: () => {
      assert.deepEqual(spendRing({ ...LIMIT, windowSpendUsd: 1, blocked: true }), { ratio: 1, tone: 'over' });
      assert.deepEqual(spendRing({ ...NO_LIMIT, blocked: true }), { ratio: 1, tone: 'over' }, 'a block is never hidden, limit or not');
    } },
    { name: 'clamped: over the limit but not blocked stays a full amber ring; a refund never sweeps backwards', run: () => {
      assert.deepEqual(spendRing({ ...LIMIT, windowSpendUsd: 75 }), { ratio: 1, tone: 'warn' });
      assert.deepEqual(spendRing({ ...LIMIT, windowSpendUsd: -5 }), { ratio: 0, tone: '' });
      assert.deepEqual(spendRing({ ...LIMIT, totalLimitUsd: 0, windowSpendUsd: 0 }), { ratio: 0, tone: '' }, 'a $0 limit and no spend: empty, no division by zero');
    } },
  ]);
});

test('ringDash: the arc length over the circumference, clamped to 0-1', () => {
  assert.equal(ringDash(0, RING_R), '0.00 109.96');
  assert.equal(ringDash(0.5, RING_R), '54.98 109.96');
  assert.equal(ringDash(1, MINI_R), '47.12 47.12');
  assert.equal(ringDash(7, MINI_R), '47.12 47.12');
  assert.equal(ringDash(Number.NaN, MINI_R), '0.00 47.12');
});

test('spendPeriod: the full month from the window midpoint, "this week" for a weekly window', () => {
  assert.equal(spendPeriod(NO_LIMIT), 'in October');
  assert.equal(spendPeriod({ ...NO_LIMIT, resetPeriod: 'weekly' }), 'this week');
  assert.equal(spendPeriod({ resetPeriod: 'monthly', windowEndMs: OCT.windowEndMs }), 'in October', 'one bound: the instant before the exclusive end');
  assert.equal(spendPeriod({ resetPeriod: 'monthly', windowStartMs: OCT.windowStartMs }), 'in October');
  assert.equal(spendPeriod({ resetPeriod: 'monthly' }), 'this month', 'no bounds: no month to name');
});

test('renderSpendCard: Spent/Saved without a limit, Limit/Spent with one, Details or Raise limit, the blocked note', async () => {
  await checkRows([
    { name: 'no limit: "Spend in October", Spent then a green Saved, no mini ring, Details opens Statistics', run: () => {
      const card = renderSpendCard(NO_LIMIT, { doc });
      assert.equal(card.querySelector('.mc-title').textContent, 'Spend in October');
      assert.equal(card.getAttribute('role'), 'group');
      assert.equal(card.getAttribute('aria-label'), 'Spend in October');
      assert.equal(card.dataset.spend, 'none');
      assert.deepEqual(rows(card), [['Spent', '$163.49', ''], ['Saved', '$3,591.31', 'pos']]);
      assert.equal(card.querySelector('.mini-ring'), null, 'no limit, no ring');
      const go = card.querySelector('.mc-btn');
      assert.deepEqual([go.textContent, go.dataset.nav, go.dataset.hash, go.getAttribute('role'), go.classList.contains('solid')], ['Details', 'stats', undefined, 'menuitem', false]);
      assert.equal(card.querySelector('.mc-note'), null);
      assert.match(card.title, /^Estimated spend this month: \$163\.4900 · resets .* not authoritative billing\. Saved this month: \$3,591\.31 \(Saved = estimated human hours × your rate − spent\)$/);
    } },
    { name: 'no limit: a loss is signed and neutral; no Saved figure in the payload means Spent alone, never a fake $0', run: () => {
      assert.deepEqual(rows(renderSpendCard({ ...NO_LIMIT, windowSavedUsd: -40 }, { doc })), [['Spent', '$163.49', ''], ['Saved', '−$40.00', '']]);
      assert.deepEqual(rows(renderSpendCard({ ...NO_LIMIT, windowSavedUsd: 0 }, { doc }))[1], ['Saved', '$0.00', 'pos'], 'zero saved is not a loss');
      for (const windowSavedUsd of [undefined, null, Number.NaN]) {
        const card = renderSpendCard({ ...NO_LIMIT, windowSavedUsd }, { doc });
        assert.deepEqual(rows(card), [['Spent', '$163.49', '']], `windowSavedUsd=${windowSavedUsd}`);
        assert.doesNotMatch(card.title, /Saved/);
      }
    } },
    { name: 'a weekly window: "Spend this week"', run: () => {
      assert.equal(renderSpendCard({ ...NO_LIMIT, resetPeriod: 'weekly' }, { doc }).querySelector('.mc-title').textContent, 'Spend this week');
    } },
    { name: 'with a limit: Limit then Spent, the mini ring, Spent toned by the band', run: () => {
      const ok = renderSpendCard(LIMIT, { doc });
      assert.deepEqual(rows(ok), [['Limit', '$50.00', ''], ['Spent', '$20.00', '']]);
      assert.doesNotMatch(ok.title, /Saved/, 'under a limit: no Saved figure, though the payload carries one');
      assert.equal(ok.dataset.spend, 'ok');
      assert.equal(ok.querySelector('.mini-ring .arc').getAttribute('stroke-dasharray'), ringDash(0.4, MINI_R));
      assert.equal(ok.querySelector('.mini-ring').getAttribute('aria-hidden'), 'true');
      assert.equal(ok.querySelector('.mc-btn').textContent, 'Details');
      const warn = renderSpendCard({ ...LIMIT, windowSpendUsd: 41.23 }, { doc });
      assert.equal(warn.dataset.spend, 'warn');
      assert.deepEqual(rows(warn)[1], ['Spent', '$41.23', 'warn']);
      assert.match(warn.title, /^Estimated spend this month: \$41\.2300 of \$50\.00 · resets /);
    } },
    { name: 'blocked: a red full ring, a solid Raise limit to the budget card, and the note with the reset', run: () => {
      const end = new Date(2026, 10, 1, 0, 0).getTime();
      const card = renderSpendCard({ ...LIMIT, windowEndMs: end, windowSpendUsd: 52.13, blocked: true }, { doc });
      assert.equal(card.dataset.spend, 'over');
      assert.deepEqual(rows(card)[1], ['Spent', '$52.13', 'over']);
      assert.equal(card.querySelector('.mini-ring .arc').getAttribute('stroke-dasharray'), ringDash(1, MINI_R));
      const go = card.querySelector('.mc-btn');
      assert.deepEqual([go.textContent, go.dataset.nav, go.dataset.hash, go.classList.contains('solid')], ['Raise limit', 'settings', 'settings/runs/budget', true]);
      assert.equal(card.querySelector('.mc-note').textContent, 'New runs are blocked until Sun Nov 1, 00:00.');
    } },
    { name: 'figures are painted as text', run: () => {
      const card = renderSpendCard(NO_LIMIT, { doc, fmt: { usd: () => '<b>x</b>', usd4: () => '' } });
      assert.equal(card.querySelector('b'), null);
      assert.equal(card.querySelector('.mc-rows dd').textContent, '<b>x</b>');
    } },
  ]);
});

test('free-request row: "Free requests today  37 / 50", amber when low, red when out, opens Providers', async () => {
  const now = Date.parse('2026-10-08T21:00:00Z');
  await checkRows([
    { name: 'freeDailyRow: null when off or unknown; the count, tone and tip otherwise', run: () => {
      for (const s of [null, { enabled: false }, FREE({ known: false })]) assert.equal(freeDailyRow(s, { now }), null);
      assert.deepEqual(freeDailyRow(FREE(), { now }), { text: '37 / 50', tone: '',
        title: 'OpenRouter free-model requests left today: 37 of 50 · resets 00:00 UTC, in 3h 0m — every model call on a :free model is one request' });
      assert.equal(freeDailyRow(FREE({ remaining: 4 }), { now }).tone, 'warn', 'under 10% left');
      assert.equal(freeDailyRow(FREE({ remaining: 0 }), { now }).tone, 'over', 'used up');
      assert.match(freeDailyRow(FREE({ remaining: 0 }), { now }).title, /one request\. Used up: free models pause until the reset\.$/);
    } },
    { name: 'the card carries the row last; it routes to the Providers page', run: () => {
      const card = renderSpendCard(LIMIT, { doc, free: FREE({ remaining: 4 }), now });
      const row = card.lastElementChild;
      assert.ok(row.classList.contains('mc-free'));
      assert.deepEqual([row.tagName, row.type, row.getAttribute('role'), row.dataset.nav, row.dataset.tone],
        ['BUTTON', 'button', 'menuitem', 'providers', 'warn']);
      assert.equal(row.querySelector('.mi-lbl').textContent, 'Free requests today');
      assert.equal(row.querySelector('.mi-val').textContent, '4 / 50');
    } },
    { name: 'no budget yet: the free row alone; nothing at all: no card', run: () => {
      const only = renderSpendCard(null, { doc, free: FREE(), now });
      assert.deepEqual([...only.children].map((c) => c.className), ['mi mc-free']);
      assert.equal(only.getAttribute('aria-label'), 'Spend');
      assert.equal(renderSpendCard(null, { doc, free: null }), null);
      assert.equal(renderSpendCard(NO_LIMIT, { doc, free: FREE({ known: false }) }).querySelector('.mc-free'), null);
    } },
  ]);
});

// ── who is signed in ────────────────────────────────────────────────────────────

const ME = 'ada.lovelace@acme.dev';
const SHARED = { name: ME, source: 'access', shared: true };
const SOLO = { name: 'Solo Operator', source: 'operator', shared: false };
// The corner, the identity card and the away row as the shell ships them (ui/public/index.html).
const SHELL = `<button type="button" class="acct" id="side-acct"><span class="acct-ring-wrap">
<svg class="acct-ring" viewBox="0 0 38 38" aria-hidden="true"><circle class="trk" cx="19" cy="19" r="17.5"></circle><circle class="arc" cx="19" cy="19" r="17.5" stroke-dasharray="0 109.96"></circle></svg>
<span class="acct-ava" aria-hidden="true">P</span><i class="acct-dot" aria-hidden="true"></i></span>
<span class="acct-name">Profile</span></button>
<div class="mcard id-card" id="acct-id" hidden><span class="mc-k">Signed in as</span><b class="id-name"></b><small class="id-via"></small></div>
<button type="button" class="mi away-item" id="acct-away" role="menuitem"><svg class="mi-ic" viewBox="0 0 24 24" aria-hidden="true"></svg><span class="mi-lbl">Step away</span><span class="mi-hint"></span></button>`;
const shell = () => new JSDOM(`<!doctype html><body>${SHELL}</body>`).window.document;

test('describeAccount: shared = initials + the name up to "@" + the card; operator = initials + name, no card; anything else = Profile', async () => {
  await checkRows([
    { name: 'a shared identity (Cloudflare Access or a sign-in proxy)', run: () => {
      assert.deepEqual(describeAccount(SHARED), { kind: 'shared', name: ME, short: 'ada.lovelace', initials: 'AL', via: 'via Cloudflare Access' });
      assert.equal(describeAccount({ ...SHARED, source: 'header' }).via, 'via your sign-in proxy');
      assert.equal(describeAccount({ ...SHARED, source: 'something-new' }).via, '', 'an unknown source names no proxy');
    } },
    { name: 'an operator-named install: initials and the name, no identity card', run: () => {
      assert.deepEqual(describeAccount(SOLO), { kind: 'operator', name: 'Solo Operator', short: 'Solo Operator', initials: 'SO', via: '' });
    } },
    { name: 'local, "local", nobody, an older server with no `shared`, a failed call: P + Profile', run: () => {
      const profile = { kind: 'local', name: '', short: 'Profile', initials: 'P', via: '' };
      for (const who of [{ name: null, source: 'local', shared: false }, { name: 'local', source: 'operator', shared: false },
        { name: ME, source: 'access' }, { name: 'Solo Operator', source: 'operator' }, { name: '  ', shared: true },
        { config: {} }, null, undefined]) {
        assert.deepEqual(describeAccount(who), profile, JSON.stringify(who));
      }
    } },
    { name: 'personInitials: up to two, from the local part or the words', run: () => {
      assert.equal(personInitials('ada.lovelace@acme.dev'), 'AL');
      assert.equal(personInitials('grace hopper'), 'GH');
      assert.equal(personInitials('x'), 'X');
      assert.equal(personInitials('@acme.dev'), '?');
      assert.equal(personInitials(''), '?');
    } },
  ]);
});

test('accountLabel: who, then away and the limit, then what the menu holds', () => {
  const acct = describeAccount(SHARED);
  assert.deepEqual(accountLabel(acct), { label: `${ME}: spend, away mode, interface mode and settings`, title: ME });
  assert.deepEqual(accountLabel(acct, { away: true, budget: LIMIT }), {
    label: `${ME} · away · $20.00 of $50.00 spent in October: spend, away mode, interface mode and settings`,
    title: `${ME} · away · $20.00 of $50.00 spent in October`,
  });
  assert.equal(accountLabel(acct, { budget: { ...LIMIT, windowSpendUsd: 52.13, blocked: true } }).title,
    `${ME} · $52.13 of $50.00 spent in October, new runs blocked`);
  assert.equal(accountLabel(acct, { budget: NO_LIMIT }).title, ME, 'no limit: nothing to say about spend');
  const local = describeAccount(null);
  assert.deepEqual(accountLabel(local, { away: true }), {
    label: 'Profile · away: spend, away mode, interface mode and settings',
    title: 'Profile: spend, away mode, interface mode and settings · away',
  });
  assert.equal(accountLabel(local, { budget: { ...NO_LIMIT, blocked: true } }).title,
    'Profile: spend, away mode, interface mode and settings · new runs blocked', 'a block is named even without a limit');
});

test('paintAccountCorner: initials, the short name, the ring and the away dot; names stay text', async () => {
  await checkRows([
    { name: 'shared: initials, the short name, the full name in the tooltip; no limit, no ring', run: () => {
      const doc = shell();
      const btn = doc.getElementById('side-acct');
      paintAccountCorner(btn, describeAccount(SHARED), { budget: NO_LIMIT });
      assert.equal(btn.querySelector('.acct-ava').textContent, 'AL');
      assert.equal(btn.querySelector('.acct-name').textContent, 'ada.lovelace');
      assert.equal(btn.title, ME);
      assert.equal(btn.getAttribute('aria-label'), `${ME}: spend, away mode, interface mode and settings`);
      assert.deepEqual([btn.dataset.account, btn.dataset.spend, btn.dataset.presence], ['shared', 'none', 'here']);
    } },
    { name: 'a limit fills the ring; amber from the warn band; red and full when blocked', run: () => {
      const doc = shell();
      const btn = doc.getElementById('side-acct');
      const arc = btn.querySelector('.acct-ring .arc');
      paintAccountCorner(btn, describeAccount(null), { budget: LIMIT });
      assert.deepEqual([btn.dataset.spend, arc.getAttribute('stroke-dasharray')], ['ok', ringDash(0.4, RING_R)]);
      paintAccountCorner(btn, describeAccount(null), { budget: { ...LIMIT, windowSpendUsd: 41.23 } });
      assert.equal(btn.dataset.spend, 'warn');
      paintAccountCorner(btn, describeAccount(null), { budget: { ...LIMIT, blocked: true } });
      assert.deepEqual([btn.dataset.spend, arc.getAttribute('stroke-dasharray')], ['over', ringDash(1, RING_R)]);
      paintAccountCorner(btn, describeAccount(null), { budget: null });
      assert.deepEqual([btn.dataset.spend, arc.getAttribute('stroke-dasharray')], ['none', ringDash(0, RING_R)], 'no snapshot yet: no ring');
    } },
    { name: 'away: the dot shows and the label says so', run: () => {
      const doc = shell();
      const btn = doc.getElementById('side-acct');
      paintAccountCorner(btn, describeAccount(SOLO), { away: true });
      assert.equal(btn.dataset.presence, 'away');
      assert.equal(btn.querySelector('.acct-name').textContent, 'Solo Operator');
      assert.match(btn.getAttribute('aria-label'), /^Solo Operator · away: /);
    } },
    { name: 'a name is painted as text, never markup', run: () => {
      const doc = shell();
      const btn = doc.getElementById('side-acct');
      const evil = '<img src=x onerror=alert(1)>';
      paintAccountCorner(btn, describeAccount({ name: evil, source: 'header', shared: true }));
      assert.equal(btn.querySelector('.acct-name').textContent, evil);
      assert.equal(btn.querySelector('img'), null);
      const card = doc.getElementById('acct-id');
      paintIdentityCard(card, describeAccount({ name: evil, source: 'header', shared: true }));
      assert.equal(card.querySelector('.id-name').textContent, evil);
      assert.equal(card.querySelector('img'), null);
    } },
  ]);
});

test('paintIdentityCard: only a shared identity gets "Signed in as"', () => {
  const doc = shell();
  const card = doc.getElementById('acct-id');
  paintIdentityCard(card, describeAccount(SHARED));
  assert.equal(card.hidden, false);
  assert.deepEqual([card.querySelector('.mc-k').textContent, card.querySelector('.id-name').textContent, card.querySelector('.id-via').textContent],
    ['Signed in as', ME, 'via Cloudflare Access']);
  paintIdentityCard(card, describeAccount({ ...SHARED, source: 'header' }));
  assert.equal(card.querySelector('.id-via').textContent, 'via your sign-in proxy');
  for (const who of [SOLO, null, { name: ME, source: 'access' }]) {
    paintIdentityCard(card, describeAccount(who));
    assert.equal(card.hidden, true, JSON.stringify(who));
    assert.equal(card.querySelector('.id-name').textContent, '', 'no stale name left behind');
  }
});

// ── the away row ────────────────────────────────────────────────────────────────

const C = { window: '22:00-07:00', timeZone: 'UTC', graceMinutes: 30, enabled: false, neverDecide: [] };
const rowAt = (iso, o = {}) => describeAwayRow({ config: C, toggle: 'auto', localZone: 'UTC', now: Date.parse(iso), ...o });

test('paintAwayRow: icon, label, hint and tip from describeAwayRow; busy or unread settings disable it', () => {
  const doc = shell();
  const btn = doc.getElementById('acct-away');
  const icon = () => [...btn.querySelectorAll('.mi-ic path')].map((p) => p.getAttribute('d')).join(' ');
  paintAwayRow(btn, rowAt('2026-09-28T15:00:00Z'));
  assert.deepEqual([btn.dataset.state, btn.dataset.status, btn.querySelector('.mi-lbl').textContent, btn.querySelector('.mi-hint').textContent],
    ['here', 'here', 'Step away', 'away at 22:00']);
  assert.match(icon(), /^M14 2\.2a1\.8/, 'here: a person walking out, never a sign-out arrow, never the moon (that is Dark in the appearance switcher)');
  assert.equal(btn.getAttribute('aria-disabled'), null);
  assert.match(btn.title, /Step away to have worca answer on every run now\.$/);
  paintAwayRow(btn, rowAt('2026-09-28T23:00:00Z'));
  assert.deepEqual([btn.dataset.state, btn.querySelector('.mi-lbl').textContent, btn.querySelector('.mi-hint').textContent],
    ['away', "I'm back", 'until 07:00']);
  assert.match(icon(), /^M3\.5 10\.5L12 3\.5/, 'away: the home');
  assert.equal(btn.querySelectorAll('.mi-ic path').length, 3, 'the icon is replaced, not stacked');
  paintAwayRow(btn, rowAt('2026-09-28T23:00:00Z'), { busy: true });
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'a click in flight');
  paintAwayRow(btn, rowAt('2026-09-28T23:00:00Z'), { err: 'HTTP 500' });
  assert.equal(btn.getAttribute('aria-disabled'), null);
  assert.match(btn.title, / \(Could not change it: HTTP 500\)$/);
  paintAwayRow(btn, describeAwayRow({ config: null, now: 0 }));
  assert.deepEqual([btn.getAttribute('aria-disabled'), btn.title], ['true', 'Away mode settings could not be read.']);
});

// ── the Interface mode row and its side menu ───────────────────────────────────

const LEVEL_SHELL = `<button type="button" class="mi" id="acct-lvl" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="lvl-menu"><span class="mi-lbl">Interface mode</span><span class="mi-val">Expert</span></button>
<div class="lvl-menu" id="lvl-menu" role="menu" aria-label="Interface mode" hidden></div>`;

test('levelMenuHtml: Simple / Advanced / Expert as radio items with the bars, a short line and one check', () => {
  const doc = new JSDOM(`<div role="menu">${levelMenuHtml('advanced')}</div>`).window.document;
  const opts = [...doc.querySelectorAll('[role="menuitemradio"]')];
  assert.deepEqual(opts.map((o) => o.dataset.levelChoice), UI_LEVELS);
  assert.deepEqual(opts.map((o) => o.querySelector('.lv-opt-name').textContent), ['Simple', 'Advanced', 'Expert']);
  assert.deepEqual(opts.map((o) => o.getAttribute('aria-checked')), ['false', 'true', 'false']);
  assert.deepEqual(opts.map((o) => o.querySelectorAll('.lv-bars rect.on').length), [1, 2, 3], 'the bars show how much is on screen');
  assert.deepEqual(opts.map((o) => o.querySelector('.lv-opt-desc').textContent), UI_LEVELS.map((l) => LEVEL_SHORT[l]));
  assert.equal(LEVEL_SHORT.advanced, 'Adds schedules, statistics, the marketplace and connectors.');
  for (const o of opts) assert.equal(o.type, 'button');
});

test('the side menu and the dialog agree on what each mode adds: the Add-ons pages, never "plugins"', () => {
  const says = (l) => `${LEVEL_SHORT[l]} ${LEVEL_INFO[l].adds}`.toLowerCase();
  for (const page of ['marketplace', 'connectors']) assert.match(says('advanced'), new RegExp(page), `Advanced adds ${page}`);
  for (const page of ['models', 'providers', 'team policy']) assert.match(LEVEL_INFO.expert.adds.toLowerCase(), new RegExp(page), `Expert adds ${page}`);
  assert.match(LEVEL_INFO.simple.adds, /Workflows/, 'Simple shows the Workflows view (agents and scripts included)');
  assert.match(LEVEL_INFO.advanced.adds, /Schedules/);
  for (const l of UI_LEVELS) assert.doesNotMatch(says(l), /plugins/, `${l}: the Plugins tab is the Marketplace page now`);
});

test('the level controller paints the menu row and the side menu; choosing there applies, saves and keeps the item', async () => {
  const dom = new JSDOM(`<!doctype html><html data-level="simple"><body>${LEVEL_SHELL}</body></html>`);
  const doc = dom.window.document;
  const saved = [];
  const ctl = createLevelController({ doc, save: async (l) => { saved.push(l); return { ok: true, level: l }; } });
  ctl.paint();
  assert.equal(doc.querySelector('#acct-lvl .mi-val').textContent, 'Simple');
  const checked = () => [...doc.querySelectorAll('#lvl-menu [aria-checked="true"]')].map((o) => o.dataset.levelChoice);
  assert.deepEqual(checked(), ['simple']);
  const expert = doc.querySelector('#lvl-menu [data-level-choice="expert"]');
  expert.focus();
  expert.click();
  assert.equal(doc.documentElement.dataset.level, 'expert', 'applies at once, before the save answers');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved, ['expert']);
  assert.equal(doc.querySelector('#acct-lvl .mi-val').textContent, 'Expert');
  assert.deepEqual(checked(), ['expert']);
  assert.equal(doc.querySelector('#lvl-menu [data-level-choice="expert"]'), expert, 'the items are updated in place, not rebuilt');
  assert.equal(doc.activeElement, expert, 'so focus stays on the chosen item');
  assert.equal(doc.querySelectorAll('#lvl-menu [data-level-choice]').length, 3);
});

test('a failed save from the side menu puts the check back and hands the reason to onError (no dialog is up to show it)', async () => {
  const dom = new JSDOM(`<!doctype html><html data-level="advanced"><body>${LEVEL_SHELL}</body></html>`);
  const doc = dom.window.document;
  const errs = [];
  createLevelController({ doc, save: async () => ({ ok: false, error: 'disk full' }), onError: (e) => errs.push(e) }).paint();
  doc.querySelector('#lvl-menu [data-level-choice="simple"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.documentElement.dataset.level, 'advanced');
  assert.equal(doc.querySelector('#lvl-menu [aria-checked="true"]').dataset.levelChoice, 'advanced');
  assert.equal(doc.querySelector('#acct-lvl .mi-val').textContent, 'Advanced');
  assert.deepEqual(errs, ['disk full'], 'the app is told why, so it can say so');
});

test('a failed save while the dialog is up shows its own line and does not call onError twice over', async () => {
  const DIALOG = '<div id="mode-modal" class="viewer-modal hidden"><div id="mode-cards"></div><small id="mode-msg" class="hint"></small><button type="button" id="mode-done">Done</button></div>';
  const dom = new JSDOM(`<!doctype html><html data-level="advanced"><body>${LEVEL_SHELL}${DIALOG}</body></html>`);
  const doc = dom.window.document;
  const errs = [];
  const ctl = createLevelController({ doc, save: async () => ({ ok: false, error: 'disk full' }), onError: (e) => errs.push(e) });
  ctl.paint();
  ctl.open(null);
  doc.querySelector('#mode-cards [data-level-choice="expert"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.documentElement.dataset.level, 'advanced');
  assert.equal(doc.getElementById('mode-msg').textContent, 'Could not save the mode: disk full');
  assert.deepEqual(errs, [], 'the dialog said it');
  ctl.close();
  await ctl.choose('simple', { report: false });
  assert.equal(doc.documentElement.dataset.level, 'advanced');
  assert.deepEqual(errs, [], 'report: false — the caller says why itself (a tour\'s start opens the dialog)');
});
