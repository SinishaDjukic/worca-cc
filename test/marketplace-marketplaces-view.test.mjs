// test/marketplace-marketplaces-view.test.mjs — P7: the Marketplaces tab's pure parts (board 4.1, F11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';
import { displayUrl, isLocalPath, repoWebUrl, syncedText, marketplaceNotes, renderMarketplaceCard, renderMarketplaceCards }
  from '../ui/public/marketplace/marketplaces-view.mjs';
import { shortDate } from '../ui/public/marketplace/catalog.mjs';
import { OFFICIAL, EXAMPLE, LOCAL, GITLAB, NOTE0, SKIP } from './helpers/mk-marketplaces-fixtures.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const NOW = Date.parse('2026-10-20T12:00:00Z');
// A calendar day is the viewer's local day (noon UTC is the next day east of UTC+12): 'Aug 1' / 'Sep 3' in UTC (CI).
const day = (iso) => shortDate(iso, NOW);
const kids = (n) => [...n.children].map((c) => c.textContent);
const actions = (card) => [...card.querySelector('.mk-mkt-actions').children].map((c) => c.className);
const byId = (root, id) => root.querySelector(`[id="${id}"]`);   // marketplace ids hold dots

test('helpers: display url, local path, web url, Synced text, notes', async () => {
  await checkRows([
    { name: 'displayUrl drops the scheme and .git; paths stay', run: () => {
      assert.deepEqual(['https://github.com/o/r', 'https://gitlab.com/a/m.git', 'git@github.com:o/r.git', '/Users/dp/x', 'C:\\Users\\dp\\x', '', undefined].map(displayUrl),
        ['github.com/o/r', 'gitlab.com/a/m', 'git@github.com:o/r', '/Users/dp/x', 'C:\\Users\\dp\\x', '', '']);
    } },
    { name: 'displayUrl never shows a credential; a local folder keeps .git; file:// reads as its path', run: () => {
      assert.deepEqual(['https://x-access-token:ghp_abc@github.com/org/m', 'https://user@gitlab.com/a/m.git', 'ssh://git@host/x.git',
        '/srv/git/worca-plugins.git', 'C:\\repos\\m.git', 'file:///Users/dp/mkt.git'].map(displayUrl),
      ['github.com/org/m', 'gitlab.com/a/m', 'host/x', '/srv/git/worca-plugins.git', 'C:\\repos\\m.git', '/Users/dp/mkt.git']);
    } },
    { name: 'displayUrl: a Windows file:// URL reads as its drive or UNC path (cycle 4)', run: () => {
      assert.deepEqual(['file:///C:/repos/m.git', 'file:///d:\\mkt', 'file://srv/share/mkt'].map(displayUrl), ['C:/repos/m.git', 'd:\\mkt', '//srv/share/mkt']);
    } },
    { name: 'isLocalPath: POSIX, drive, UNC, file://', run: () => {
      assert.deepEqual(['/Users/x', 'C:\\x', 'C:/x', '\\\\srv\\share', 'file:///Users/x', 'https://github.com/o/r', 'git@github.com:o/r', undefined].map(isLocalPath),
        [true, true, true, true, true, false, false, false]);
    } },
    { name: 'repoWebUrl: http(s) only, never with a credential', run: () => {
      assert.deepEqual(['https://github.com/o/r', 'https://gitlab.com/a/m.git', 'http://h/x', 'git@github.com:o/r', '/Users/x', 'file:///x', undefined].map(repoWebUrl),
        ['https://github.com/o/r', 'https://gitlab.com/a/m', 'http://h/x', null, null, null, null]);
      assert.equal(repoWebUrl('https://x-access-token:ghp_abc@github.com/org/m.git'), 'https://github.com/org/m');
    } },
    { name: 'syncedText: relative, then P3 shortDate after 30 days', run: () => {
      assert.deepEqual(['2026-10-20T11:57:00Z', '2026-10-20T11:59:40Z', '2026-08-01T12:00:00Z'].map((at) => syncedText(at, NOW)),
        ['Synced 3m ago', 'Synced just now', `Synced ${day('2026-08-01T12:00:00Z')}`]);
      assert.match(day('2026-08-01T12:00:00Z'), /^Aug [12]$/, 'a month and a day, no year (the same year as NOW)');
    } },
    { name: 'marketplaceNotes: per-plugin notes through noteText, then other manifest warnings; never the refresh failure', run: () => {
      assert.deepEqual(marketplaceNotes(EXAMPLE), [
        { plugin: 'example-models', text: 'models[0] ("example-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored' },
        { plugin: null, text: SKIP }]);
      assert.deepEqual(marketplaceNotes(OFFICIAL), []);
      assert.deepEqual(marketplaceNotes({ plugins: [{ name: 'p', notes: ['./worca-cc-plugin.json: x'] }] }), [{ plugin: 'p', text: 'x' }]);
    } },
  ]);
});

test('card: a healthy built-in marketplace (Browse, refresh, ⋯; url + branch; Synced line)', () => {
  const card = renderMarketplaceCard(doc, OFFICIAL, { now: NOW });
  assert.deepEqual([card.tagName, card.className, card.dataset.id, card.tabIndex], ['SECTION', 'card mk-mkt', OFFICIAL.id, -1]);
  assert.equal(card.firstElementChild.className, 'mk-mt mk-mt-md mk-t-mkt');
  const h2 = card.querySelector('h2.section-title.mk-mkt-name');
  assert.deepEqual([h2.textContent, card.getAttribute('aria-labelledby')], ['Worca CC Official', h2.id]);
  assert.equal(card.querySelector('.mk-mkt-head .badge.mk-chip-built').textContent, 'Built-in');
  assert.deepEqual(actions(card), ['btn btn-sm mk-mkt-browse', 'btn btn-sm btn-quiet btn-icon mk-mkt-refresh', 'btn btn-sm btn-quiet btn-icon mk-mkt-more']);
  const [browse, refresh, more] = card.querySelector('.mk-mkt-actions').children;
  assert.deepEqual([browse.getAttribute('aria-label'), browse.querySelector('.mk-count').textContent, browse.disabled],
    ['Browse 3 plugins from Worca CC Official', '3', false]);
  assert.equal(refresh.getAttribute('aria-label'), 'Refresh Worca CC Official');
  assert.deepEqual([more.getAttribute('aria-label'), more.getAttribute('aria-haspopup'), more.getAttribute('aria-expanded')],
    ['More actions for Worca CC Official', 'menu', 'false']);
  for (const b of [browse, refresh, more]) assert.equal(b.dataset.id, OFFICIAL.id);
  assert.deepEqual([card, browse, refresh, more].map((b) => b.dataset.focusKey),
    [`mkt:${OFFICIAL.id}`, `browse:${OFFICIAL.id}`, `refresh:${OFFICIAL.id}`, `more:${OFFICIAL.id}`]);
  assert.deepEqual(kids(card.querySelector('.mk-mkt-url')), ['github.com/SinishaDjukic/worca-cc', 'dev']);
  const health = card.querySelector('.mk-mkt-health');
  assert.deepEqual(kids(health), ['Synced 3m ago', '·', '735b354', '·', '3 plugins', '·', '2 installed']);
  assert.ok(health.querySelector('.mk-mkt-synced .status-dot.is-green'));
  assert.equal(card.querySelector('.mk-disc'), null, 'no manifest notes, no disclosure');
});

test('card: a marketplace that cannot be reached (Retry first; chip + snapshot date; notes folded)', () => {
  const card = renderMarketplaceCard(doc, EXAMPLE, { now: NOW });
  assert.equal(card.querySelector('.mk-mkt-head .mk-chip-built'), null);
  assert.deepEqual(actions(card), ['btn btn-sm mk-mkt-retry', 'btn btn-sm mk-mkt-browse', 'btn btn-sm btn-quiet btn-icon mk-mkt-more']);
  const retry = card.querySelector('.mk-mkt-retry');
  assert.deepEqual([retry.textContent, retry.getAttribute('aria-label'), retry.dataset.id], ['Retry', 'Retry refresh of example/worca-marketplace', EXAMPLE.id]);
  assert.equal(retry.dataset.focusKey, `refresh:${EXAMPLE.id}`, 'Retry and refresh share a key, so focus stays when one becomes the other');
  assert.deepEqual(kids(card.querySelector('.mk-mkt-url')), ['github.com/example/worca-marketplace']);
  const health = card.querySelector('.mk-mkt-health');
  assert.deepEqual(kids(health), ["Can't reach · HTTP 403", `Using the snapshot from ${day(EXAMPLE.lastSync.at)}`, '·', '16b6363', '·', '3 plugins', '·', '1 installed']);
  assert.deepEqual([health.firstElementChild.title, health.firstElementChild.classList.contains('mk-chip-warn')], ['HTTP 403', true]);
  const disc = card.querySelector('button.mk-disc');
  const notes = byId(card, disc.getAttribute('aria-controls'));
  assert.deepEqual([disc.textContent, disc.getAttribute('aria-expanded'), notes.hidden, notes.classList.contains('mk-disc-body')], ['2 manifest notes', 'false', true, true]);
  assert.deepEqual([...notes.querySelectorAll('.mk-note')].map((n) => [n.querySelector('b')?.textContent ?? null, n.textContent]), [
    ['example-models', 'example-models · models[0] ("example-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored'],
    [null, SKIP]]);
  disc.click();
  assert.deepEqual([disc.getAttribute('aria-expanded'), notes.hidden], ['true', false]);
  disc.click();
  assert.deepEqual([disc.getAttribute('aria-expanded'), notes.hidden], ['false', true]);
});

test('card: SYNC_FAILED, never synced, Needs git, one note', async () => {
  await checkRows([
    { name: 'SYNC_FAILED reads the same "Can\'t reach · …" with Retry (SM4)', run: () => {
      const card = renderMarketplaceCard(doc, { ...OFFICIAL, lastError: { message: 'branch "nope" not found', code: 'SYNC_FAILED', at: '2026-10-20T11:59:00Z' } }, { now: NOW });
      assert.equal(card.querySelector('.mk-mkt-health').firstElementChild.textContent, 'Can\'t reach · branch "nope" not found');
      assert.equal(actions(card)[0], 'btn btn-sm mk-mkt-retry');
    } },
    { name: 'never synced, no error: grey dot; Browse off at 0 plugins', run: () => {
      const card = renderMarketplaceCard(doc, LOCAL, { now: NOW });
      assert.deepEqual(kids(card.querySelector('.mk-mkt-health')), ['Never synced']);
      assert.ok(card.querySelector('.mk-mkt-synced .status-dot.is-grey'));
      assert.equal(card.querySelector('.mk-mkt-browse').disabled, true);
      assert.deepEqual(kids(card.querySelector('.mk-mkt-url')), ['/Users/dp/mkt']);
    } },
    { name: 'Needs git takes the refresh slot (after Browse, before ⋯); no data-needs-git anywhere', run: () => {
      const card = renderMarketplaceCard(doc, GITLAB, { now: NOW });
      assert.deepEqual(actions(card), ['btn btn-sm mk-mkt-browse', 'badge waiting pl-needs-git', 'btn btn-sm btn-quiet btn-icon mk-mkt-more']);
      assert.equal(card.querySelector('.pl-needs-git').textContent, 'Needs git');
      assert.equal(card.querySelector('[data-needs-git]'), null);
    } },
    { name: 'a refresh in flight: aria-disabled + aria-busy, never disabled (P3 pattern)', run: () => {
      const r = renderMarketplaceCard(doc, OFFICIAL, { now: NOW, busy: true }).querySelector('.mk-mkt-refresh');
      assert.deepEqual([r.getAttribute('aria-disabled'), r.getAttribute('aria-busy'), r.disabled], ['true', 'true', false]);
      const list = renderMarketplaceCards(doc, [OFFICIAL, EXAMPLE], { now: NOW, busy: new Set([EXAMPLE.id]) });
      assert.deepEqual([...list.querySelectorAll('.mk-mkt-refresh, .mk-mkt-retry')].map((b) => b.getAttribute('aria-busy')), [null, 'true']);
    } },
    { name: 'an error with no message reads "Can\'t reach"; the notes disclosure keeps its focus key', run: () => {
      const card = renderMarketplaceCard(doc, { ...EXAMPLE, lastError: { message: '', code: 'UNREACHABLE', at: '2026-10-20T11:59:00Z' } }, { now: NOW });
      assert.equal(card.querySelector('.mk-mkt-health').firstElementChild.textContent, "Can't reach");
      assert.equal(card.querySelector('button.mk-disc').dataset.focusKey, `notes:${EXAMPLE.id}`);
    } },
    { name: 'one note reads singular', run: () => {
      assert.equal(renderMarketplaceCard(doc, { ...EXAMPLE, warnings: [NOTE0] }, { now: NOW }).querySelector('.mk-disc').textContent, '1 manifest note');
    } },
    { name: 'notesOpen paints the notes open (a re-render keeps what the user opened); the toggle still folds them', run: () => {
      const list = renderMarketplaceCards(doc, [OFFICIAL, EXAMPLE], { now: NOW, notesOpen: new Set([EXAMPLE.id]) });
      const disc = list.querySelector(`section.mk-mkt[data-id="${EXAMPLE.id}"] button.mk-disc`);
      const notes = byId(list, disc.getAttribute('aria-controls'));
      assert.deepEqual([disc.getAttribute('aria-expanded'), notes.hidden], ['true', false]);
      disc.click();
      assert.deepEqual([disc.getAttribute('aria-expanded'), notes.hidden], ['false', true]);
      const shut = renderMarketplaceCard(doc, EXAMPLE, { now: NOW }).querySelector('button.mk-disc');
      assert.equal(shut.getAttribute('aria-expanded'), 'false');
    } },
  ]);
});

test('card: Needs git with an old sync error offers no Retry: the chip keeps the refresh slot (cycle 6)', () => {
  const card = renderMarketplaceCard(doc, { ...GITLAB, lastError: { message: 'git is not installed on this machine', code: 'GIT_MISSING', at: '2026-10-20T11:59:00Z' } }, { now: NOW });
  assert.deepEqual(actions(card), ['btn btn-sm mk-mkt-browse', 'badge waiting pl-needs-git', 'btn btn-sm btn-quiet btn-icon mk-mkt-more']);
});

test('a card never carries a destructive button; the list keeps the server order', () => {
  for (const m of [OFFICIAL, EXAMPLE, LOCAL, GITLAB]) assert.equal(renderMarketplaceCard(doc, m, { now: NOW }).querySelector('.btn-danger, [class*="remove"]'), null, m.id);
  const list = renderMarketplaceCards(doc, [OFFICIAL, EXAMPLE], { now: NOW });
  assert.equal(list.className, 'mk-mkts');
  assert.deepEqual([...list.children].map((c) => c.dataset.id), [OFFICIAL.id, EXAMPLE.id]);
});

test('the P7 CSS block sits after P6\'s and uses tokens only (SM56, SM69, the chat CSS-slice bans); a long card chip wraps and grows (cycles 4, 5); ⋯ wraps inside the card (cycle 5)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p6 = css.indexOf('/* ── marketplace P6 ── */');
  const at = css.indexOf('/* ── marketplace P7 ── */');
  assert.ok(p6 > 0 && at > p6, 'after P6');
  const end = css.indexOf('/* ── marketplace', at + 1);
  const block = css.slice(at, end === -1 ? undefined : end);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|box-shadow|text-transform|border-left|\bwhite\b(?!-)|\bblack\b(?!-)|isolation:isolate|\b298\b|76px/i);
  assert.deepEqual([...block.matchAll(/font-size:([^;}]+)/g)].map((m) => m[1]).filter((v) => !v.startsWith('var(--fs-')), []);
  // .badge is nowrap and never shrinks: at 390px a long "Can't reach · …" or branch chip ran past the card (cycle 4).
  // Its 18px one-line box kept a wrapped text printing over the lines around it (cycle 5, 290–390px): the box grows.
  assert.ok(block.includes('\n.mk-mkt-health > .mk-chip, .mk-mkt-url > .mk-chip{flex:0 1 auto;min-width:0;height:auto;min-height:18px;padding-block:2px;line-height:14px;align-items:flex-start;text-wrap-mode:wrap;overflow-wrap:anywhere;}'));
  assert.ok(block.includes('\n.mk-mkt-health > .mk-chip > .ic, .mk-mkt-url > .mk-chip > .ic{flex:none;margin-top:1px;}'));
  // At 290px Browse · Needs git · ⋯ ran past the card: the actions wrap, ⋯ stays inside (cycle 5).
  assert.ok(block.includes('\n.mk-mkt-actions{margin-left:auto;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:4px;}'));
});
