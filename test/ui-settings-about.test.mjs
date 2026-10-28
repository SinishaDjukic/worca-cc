// test/ui-settings-about.test.mjs
// Settings ▸ About card: version (linked to its release tag) + repo link, painted
// from the `app` block of GET /api/settings, and the two feedback links ("Report a bug" /
// "Suggest an improvement") that about-links.mjs repaints from `app.bugsUrl`. Plus the
// update state from GET /api/app/version (issue #841): the Latest / Update available badge,
// the What's new / Changes since links, the update-check switch, Check now and the sidebar marker.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { paintAboutInto, paintVersionStatusInto, paintUpdateMarkerInto } from '../ui/public/about-links.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

// package.json repository.url in browsable form (same normalisation as ui/server.mjs).
const REPO_URL = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
// U+2014: what index.html's `&mdash;` placeholder parses to.
const EM_DASH = '\u2014';

// Fixture `app` values; deliberately not package.json's so painted and static states differ.
const PAINTED_VERSION = '9.9.9-test';
const PAINTED_REPO_URL = 'https://example.com/acme/widget';
const PAINTED_REPO_TEXT = 'example.com/acme/widget';
const PAINTED_RELEASE_URL = 'https://example.com/acme/widget/releases/tag/worca-app-v9.9.9-test';

const DAY = 86400000;
const okBudget = () => ({
  pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 0, allTimeSpendUsd: 0,
  remainingUsd: null, blocked: false,
});

// GET /api/settings as the real route answers it, `app` included. Keep `chat: {}`:
// loadSettings hands it to paintChatSettings un-awaited, so a throw there fails the file.
const okSettings = () => ({
  root: '', projectsRoot: '', projectsRootDefault: '/home/me', default: '/home/me',
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, chat: {},
  app: { version: PAINTED_VERSION, repoUrl: PAINTED_REPO_URL, releaseUrl: PAINTED_RELEASE_URL },
});

const settingsView = () => {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  return dom.window.document.querySelector('.view[data-view="settings"]');
};

// GET /api/app/version fixtures (issue #841).
const vOutdated = () => ({ current: PAINTED_VERSION, latest: '10.0.0', status: 'outdated', enabled: true, checkedAt: '2026-10-23T00:00:00.000Z',
  links: { releaseNotes: 'https://docs.worca.dev/changelog/', whatsNew: 'https://docs.worca.dev/changelog/10.0.0/',
           compare: 'https://example.com/acme/widget/compare/worca-app-v9.9.9-test...worca-app-v10.0.0' } });
const vLatest = () => ({ ...vOutdated(), latest: PAINTED_VERSION, status: 'up-to-date', links: { releaseNotes: 'https://docs.worca.dev/changelog/', whatsNew: '', compare: '' } });
const vSource = () => ({ ...vLatest(), latest: null, status: 'source', checkedAt: null });

// GET /api/app/update fixtures (issue #841: manual update).
const uEligible = { canUpdate: true, reason: null, message: '', distTags: { latest: '10.0.0', rc: null }, autoRestartMin: '1.14.0', startCommand: 'worca ui', lastResult: null };
const uShared = { ...uEligible, canUpdate: false, reason: 'shared', message: 'Updates are turned off on a shared install. Whoever runs this Worca updates it.' };
const uNotSupervised = { ...uEligible, canUpdate: false, reason: 'not-supervised', message: 'This Worca was not started with worca ui, so it cannot restart itself. Update from a terminal:' };
const uFailed = { ...uEligible, lastResult: { state: 'failed', from: PAINTED_VERSION, to: '10.0.0', reason: 'npm could not write to /usr/local/lib/node_modules (EACCES)', output: 'npm error code EACCES', resumed: 2 } };
const uSource = { ...uEligible, canUpdate: false, reason: 'source', message: 'Run from a git checkout: update with git pull, then worca ui restart.' };

async function boot({ settings = okSettings, version = () => null, update, versions } = {}) {
  const calls = [];
  const json = (b, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => b });
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/app/update') || u.includes('/api/health')) calls.push({ url: u, method: init.method || 'GET', body: init.body });
    if (u.includes('/api/health')) return json({ name: '@worca/app', startedAt: 'boot-a' });
    if (u.includes('/api/app/update/versions')) return json(versions ?? { current: PAINTED_VERSION, distTags: { latest: '10.0.0', rc: null }, versions: [] });
    if (u.includes('/api/app/update/preview')) return json({ target: '10.0.0', autoRestart: true, autoResume: true, startCommand: 'worca ui', runs: [], scheduled: [] });
    if (u.includes('/api/app/update/dismiss')) return json({ ok: true });
    if (u.includes('/api/app/update') && init.method === 'POST') return json({ ok: true, target: '10.0.0', autoRestart: true, startCommand: 'worca ui' }, 202);
    if (u.includes('/api/app/update')) return update === null ? json({ error: 'off' }, 503) : json(update ?? uEligible);
    if (u.includes('/api/app/version')) {
      calls.push({ url: u, method: init.method || 'GET', body: init.body });
      const v = version(u);
      return Promise.resolve(v ? { ok: true, status: 200, json: async () => v } : { ok: false, status: 503, json: async () => ({ error: 'off' }) });
    }
    if (u.includes('/api/settings')) {
      calls.push({ url: u, method: init.method || 'GET', body: init.body });
      return Promise.resolve({ ok: true, status: 200, json: async () => (init.method === 'POST' ? { ...settings(), ...JSON.parse(init.body) } : settings()) });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => okBudget() });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const $ = (sel) => window.document.querySelector(sel);
  const openSettings = async () => {
    window.location.hash = 'settings';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, tick, $, openSettings, calls };
}

test('opening Settings paints the version and repo link from the server payload', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  // None of these values is in index.html, so each line fails if paintAbout stops running.
  assert.equal($('#aboutVersion').textContent.trim(), PAINTED_VERSION, 'version painted from the payload');
  assert.equal($('#aboutVersion').getAttribute('href'), PAINTED_RELEASE_URL, 'version links to its release tag');
  assert.equal($('#aboutRepoLink').getAttribute('href'), PAINTED_REPO_URL, 'href painted from the payload');
  assert.equal($('#aboutRepoLink').textContent.trim(), PAINTED_REPO_TEXT, 'link text is the URL without its scheme');
  assert.equal($('#aboutRepoLink').getAttribute('target'), '_blank', 'paint never drops target');
  assert.equal($('#aboutRepoLink').getAttribute('rel'), 'noopener noreferrer', 'paint never drops rel');
});

// A table over two payloads: each row boots the page with its own GET /api/settings answer.
test('a payload with no app block or malformed repoUrl/releaseUrl never blanks the card nor aborts the rest of the settings paint', async () => {
  await checkRows([
    { name: 'a payload with no `app` block leaves the static fallback alone (never blanks the card)', run: async () => {
      const noApp = () => { const s = okSettings(); delete s.app; return s; };
      const { $, openSettings } = await boot({ settings: noApp });
      await openSettings();
      assert.equal($('#aboutVersion').textContent.trim(), EM_DASH, 'placeholder kept, not emptied');
      assert.equal($('#aboutVersion').hasAttribute('href'), false, 'placeholder still unlinked');
      assert.equal($('#aboutRepoLink').getAttribute('href'), REPO_URL, 'static href kept');
      // Without paintAbout's `if (!info) return` the throw would abort every later paint.
      assert.equal($('#settingsLoadMsg').hidden, true, 'the rest of the settings paint still ran');
      assert.equal($('#settingsLoadMsg').textContent, '');
    } },
    { name: 'malformed `repoUrl`/`releaseUrl` cannot abort the rest of the settings paint', run: async () => {
      const badUrl = () => ({ ...okSettings(), app: { version: PAINTED_VERSION, repoUrl: 42, releaseUrl: null } });
      const { $, openSettings } = await boot({ settings: badUrl });
      await openSettings();
      assert.equal($('#settingsLoadMsg').hidden, true, 'no throw reached the loadSettings catch');
      assert.equal($('#settingsLoadMsg').textContent, '');
      assert.equal($('#aboutRepoLink').getAttribute('href'), REPO_URL, 'static href kept');
      assert.equal($('#aboutVersion').textContent.trim(), PAINTED_VERSION, 'the usable part still painted');
      assert.equal($('#aboutVersion').hasAttribute('href'), false, 'no release link without a usable URL');
    } },
  ]);
});

// The feedback links: a table over three payloads through the pure about-links.mjs (no app.js),
// each row on a fresh copy of the Settings markup.
test('paintAboutInto points both feedback links at bugs.url (no doubled slash) and a missing bugsUrl leaves the static href alone', async () => {
  await checkRows([
    { name: 'paintAboutInto points both links at bugs.url from the settings payload', run: async () => {
      const view = settingsView();
      paintAboutInto(view, { version: '1.2.0', repoUrl: 'https://github.com/x/y',
                             bugsUrl: 'https://github.com/x/y/issues' });
      assert.equal(view.querySelector('#aboutBugLink').getAttribute('href'),
        'https://github.com/x/y/issues/new?labels=bug', 'the bug link targets the bug label');
      assert.equal(view.querySelector('#aboutIdeaLink').getAttribute('href'),
        'https://github.com/x/y/issues/new?labels=enhancement', 'the idea link targets the enhancement label');
    } },
    { name: 'a trailing slash does not produce a doubled slash', run: async () => {
      const view = settingsView();
      paintAboutInto(view, { bugsUrl: 'https://github.com/x/y/issues/' });
      assert.equal(view.querySelector('#aboutBugLink').getAttribute('href'),
        'https://github.com/x/y/issues/new?labels=bug', 'no doubled slash');
    } },
    { name: 'a missing bugsUrl leaves the static markup href alone', run: async () => {
      // A FRESH view per case: reusing the one the previous test repainted would assert
      // against a value paintAboutInto had already written, which proves nothing about
      // the static fallback.
      const view = settingsView();
      const before = view.querySelector('#aboutBugLink').getAttribute('href');
      assert.match(before, /\/issues\/new\?labels=bug$/,
        'the markup ships a usable href before /api/settings lands');
      for (const info of [{}, { bugsUrl: '' }, { bugsUrl: 42 }, undefined]) {
        paintAboutInto(view, info);
        assert.equal(view.querySelector('#aboutBugLink').getAttribute('href'), before,
          `${JSON.stringify(info)} must not blank the link`);
      }
    } },
  ]);
});

test('About shows Latest, Update available + links, or nothing, from GET /api/app/version', async () => {
  await checkRows([
    { name: 'up-to-date → "Latest", no update links, Release notes always', run: async () => {
      const { $, openSettings, tick } = await boot({ version: vLatest });
      await openSettings(); await tick();
      assert.equal($('#aboutUpdateState').hidden, false);
      assert.equal($('#aboutUpdateState').textContent, 'Latest');
      assert.equal($('#aboutUpdateLinks').hidden, true);
      assert.equal($('#aboutReleaseNotes').getAttribute('href'), 'https://docs.worca.dev/changelog/');
    } },
    { name: 'outdated → "Update available: 10.0.0", What\'s new + Changes since <current>', run: async () => {
      const { $, openSettings, tick } = await boot({ version: vOutdated });
      await openSettings(); await tick();
      assert.equal($('#aboutUpdateState').textContent, 'Update available: 10.0.0');
      assert.equal($('#aboutUpdateState').dataset.state, 'outdated');
      assert.equal($('#aboutUpdateLinks').hidden, false);
      assert.equal($('#aboutWhatsNew').getAttribute('href'), 'https://docs.worca.dev/changelog/10.0.0/');
      assert.equal($('#aboutCompare').textContent, `Changes since ${PAINTED_VERSION}`);
      assert.match($('#aboutCompare').getAttribute('href'), /\/compare\/worca-app-v9\.9\.9-test\.\.\.worca-app-v10\.0\.0$/);
    } },
    { name: 'unknown / ahead / failed read → nothing, static Release notes href kept', run: async () => {
      for (const version of [() => null, () => ({ ...vLatest(), status: 'ahead' }), () => ({ ...vLatest(), status: 'unknown', latest: null })]) {
        const { $, openSettings, tick } = await boot({ version });
        await openSettings(); await tick();
        assert.equal($('#aboutUpdateState').hidden, true);
        assert.equal($('#aboutUpdateState').textContent, '');
        assert.equal($('#aboutUpdateLinks').hidden, true);
        assert.equal($('#aboutReleaseNotes').getAttribute('href'), 'https://docs.worca.dev/changelog/');
      }
    } },
    { name: 'a non-https link from the payload is never assigned', run: async () => {
      const evil = () => ({ ...vOutdated(), links: { releaseNotes: 'javascript:alert(1)', whatsNew: 'javascript:alert(1)', compare: '' } });
      const { $, openSettings, tick } = await boot({ version: evil });
      await openSettings(); await tick();
      assert.equal($('#aboutReleaseNotes').getAttribute('href'), 'https://docs.worca.dev/changelog/');
      assert.equal($('#aboutWhatsNew').hasAttribute('href'), false);
      assert.equal($('#aboutUpdateLinks').hidden, true);
    } },
  ]);
});

test('the About card: anchors carry target/rel, and the controls are the update switch, Check now and the update row', () => {
  const card = settingsView().querySelector('#about-card');
  for (const a of card.querySelectorAll('a')) {
    assert.equal(a.getAttribute('target'), '_blank', a.id);
    assert.equal(a.getAttribute('rel'), 'noopener noreferrer', a.id);
  }
  const controls = [...card.querySelectorAll('button, input, select, textarea')].map((n) => n.id).sort();
  assert.deepEqual(controls, ['aboutCheckNow', 'aboutUpdateCheck', 'aboutUpdateChoose', 'aboutUpdateCopy',
    'aboutUpdateDismiss', 'aboutUpdateFailedCopy', 'aboutUpdateGo'].sort());
  assert.equal(card.querySelector('.hint, .info-tip'), null, 'still no hint and no info-tip');
  assert.equal(card.querySelector('#aboutUpdateCheck').checked, true, 'the markup default matches the server default (on)');
});

test('Check now is a plain small button, and only the Updates row centres its items', () => {
  const card = settingsView().querySelector('#about-card');
  const btn = card.querySelector('#aboutCheckNow');
  assert.ok(btn.classList.contains('btn') && btn.classList.contains('btn-sm'), 'btn btn-sm like the other small Settings buttons');
  assert.equal(btn.classList.contains('btn-quiet'), false, 'btn-quiet is borderless and reads as grey text');
  const rows = [...card.querySelectorAll('.about-row')];
  const centred = rows.filter((r) => r.classList.contains('about-row-center'));
  assert.deepEqual(centred, [btn.closest('.about-row')], 'the switch row alone (its label takes its baseline from the text-less pill)');
  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.about-row\{display:flex;align-items:baseline;/, 'the other rows stay on baseline');
  assert.match(css, /\.about-row\.about-row-center\{align-items:center;\}/);
  assert.match(css, /\.about-update\[data-state="source"\]\{background:var\(--field\);color:var\(--ink-2\);\}/, 'Source build is neutral');
});

test('a source build: neutral "Source build" badge, no update links, no Check now, no sidebar marker; switch and Release notes stay', async () => {
  const { $, openSettings, tick } = await boot({ version: vSource });
  await openSettings(); await tick();
  assert.equal($('#aboutUpdateState').hidden, false);
  assert.equal($('#aboutUpdateState').textContent, 'Source build');
  assert.equal($('#aboutUpdateState').dataset.state, 'source');
  assert.equal($('#aboutUpdateLinks').hidden, true);
  assert.equal($('#aboutWhatsNew').hidden, true);
  assert.equal($('#aboutCompare').hidden, true);
  assert.equal($('#aboutReleaseNotes').getAttribute('href'), 'https://docs.worca.dev/changelog/');
  assert.equal($('#aboutCheckNow').hidden, true, 'nothing to check');
  assert.equal($('#aboutUpdateCheck').closest('.about-row').hidden, false, 'the switch stays');
  assert.equal($('#side-update').hidden, true);
});

test('focus re-reads GET /api/app/version (never the forced check): the marker appears once the server answers outdated', async () => {
  let answer = vLatest;
  const { window, $, tick, calls } = await boot({ version: () => answer() });
  await tick();
  assert.equal($('#side-update').hidden, true);
  answer = vOutdated;
  const before = calls.length;
  window.dispatchEvent(new window.Event('focus'));
  await tick(); await tick();
  assert.equal($('#side-update').hidden, false);
  const after = calls.slice(before).filter((c) => c.url.includes('/api/app/version'));
  assert.ok(after.length >= 1, 'focus asked again');
  assert.ok(after.every((c) => c.method === 'GET' && !c.url.includes('/check')), 'GET only, never force');
});

test('the switch posts { updateCheck } on change, and off hides Check now and the badge', async () => {
  let enabled = true;
  const version = () => (enabled ? vOutdated() : { ...vOutdated(), enabled: false, status: 'unknown', latest: null, links: { releaseNotes: 'https://docs.worca.dev/changelog/', whatsNew: '', compare: '' } });
  const { window, $, openSettings, tick, calls } = await boot({ version });
  await openSettings(); await tick();
  assert.equal($('#aboutUpdateState').hidden, false);
  enabled = false;
  $('#aboutUpdateCheck').checked = false;
  $('#aboutUpdateCheck').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/settings'));
  assert.deepEqual(JSON.parse(post.body), { updateCheck: false });
  assert.equal($('#aboutCheckNow').hidden, true);
  assert.equal($('#aboutUpdateState').hidden, true);
  assert.equal($('#side-update').hidden, true);
});

test('Check now POSTs /api/app/version/check', async () => {
  const { $, openSettings, tick, calls } = await boot({ version: vLatest });
  await openSettings(); await tick();
  $('#aboutCheckNow').click();
  await tick(); await tick();
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('/api/app/version/check')));
});

test('the sidebar marker shows only while outdated and opens Settings › General', async () => {
  await checkRows([
    { name: 'outdated at boot → visible with the version in its label; click routes to #settings', run: async () => {
      const { window, $, tick } = await boot({ version: vOutdated });
      await tick();
      const m = $('#side-update');
      assert.equal(m.hidden, false);
      assert.equal(m.getAttribute('aria-label'), 'Update available: Worca 10.0.0');
      window.location.hash = 'chat';
      m.click();
      assert.equal(window.location.hash, '#settings');
    } },
    { name: 'up-to-date / unknown / failed read → hidden', run: async () => {
      for (const version of [vLatest, () => null, () => ({ ...vLatest(), status: 'unknown', latest: null })]) {
        const { $, tick } = await boot({ version });
        await tick();
        assert.equal($('#side-update').hidden, true);
      }
    } },
  ]);
});

// The pure painters (no app.js): malformed payloads never throw and always read as unknown.
test('paintVersionStatusInto / paintUpdateMarkerInto: malformed payloads read as unknown, never throw', async () => {
  const sideFoot = () => {
    const dom = trackDom(new JSDOM('<div id="side-foot"><a class="side-update" id="side-update" href="#settings" hidden aria-label="Update available" title="Update available"></a></div>'));
    return dom.window.document;
  };
  await checkRows([
    { name: 'outdated paints the badge, both links and the marker label', run: async () => {
      const view = settingsView(); const foot = sideFoot();
      paintVersionStatusInto(view, vOutdated());
      paintUpdateMarkerInto(foot, vOutdated());
      assert.equal(view.querySelector('#aboutUpdateState').textContent, 'Update available: 10.0.0');
      assert.equal(view.querySelector('#aboutUpdateLinks').hidden, false);
      assert.equal(view.querySelector('#aboutCompare').textContent, `Changes since ${PAINTED_VERSION}`);
      assert.equal(foot.querySelector('#side-update').hidden, false);
      assert.equal(foot.querySelector('#side-update').title, 'Update available: Worca 10.0.0');
    } },
    { name: 'outdated with no links object: badge and marker, but no update links', run: () => {
      const view = settingsView(); const foot = sideFoot();
      const vs = { status: 'outdated', latest: '10.0.0', current: PAINTED_VERSION };
      paintVersionStatusInto(view, vs);
      paintUpdateMarkerInto(foot, vs);
      assert.equal(view.querySelector('#aboutUpdateState').textContent, 'Update available: 10.0.0');
      assert.equal(view.querySelector('#aboutUpdateLinks').hidden, true);
      assert.equal(view.querySelector('#aboutReleaseNotes').getAttribute('href'), 'https://docs.worca.dev/changelog/');
      assert.equal(foot.querySelector('#side-update').hidden, false);
    } },
    { name: 'source paints the neutral badge, hides Check now and never the marker', run: () => {
      const view = settingsView(); const foot = sideFoot();
      paintVersionStatusInto(view, vSource());
      paintUpdateMarkerInto(foot, vSource());
      assert.equal(view.querySelector('#aboutUpdateState').textContent, 'Source build');
      assert.equal(view.querySelector('#aboutUpdateState').dataset.state, 'source');
      assert.equal(view.querySelector('#aboutCheckNow').hidden, true);
      assert.equal(view.querySelector('#aboutUpdateLinks').hidden, true);
      assert.equal(foot.querySelector('#side-update').hidden, true);
    } },
    ...[undefined, null, {}, { status: 42 }, { status: 'outdated', latest: null, links: vOutdated().links }].map((vs) => ({
      name: `${JSON.stringify(vs)} → unknown`,
      run: () => {
        const view = settingsView(); const foot = sideFoot();
        paintVersionStatusInto(view, vs);
        paintUpdateMarkerInto(foot, vs);
        assert.equal(view.querySelector('#aboutUpdateState').hidden, true);
        assert.equal(view.querySelector('#aboutUpdateLinks').hidden, true);
        assert.equal(view.querySelector('#aboutReleaseNotes').getAttribute('href'), 'https://docs.worca.dev/changelog/');
        assert.equal(foot.querySelector('#side-update').hidden, true);
      },
    })),
  ]);
});

// Manual update (issue #841): the Update row per eligibility, the failed callout, and the confirm → POST flow.
test('outdated + eligible → "Update to 10.0.0" enabled, Choose version shown, no command', async () => {
  const { $, openSettings, tick } = await boot({ version: vOutdated, update: uEligible });
  await openSettings(); await tick(); await tick();
  assert.equal($('#aboutUpdateRow').hidden, false);
  assert.equal($('#aboutUpdateGo').hidden, false);
  assert.equal($('#aboutUpdateGo').textContent, 'Update to 10.0.0');
  assert.equal($('#aboutUpdateGo').disabled, false);
  assert.equal($('#aboutUpdateChoose').hidden, false);
  assert.equal($('#aboutUpdateCmdRow').hidden, true);
});

test('shared → button visible but disabled, shared hint, no command', async () => {
  const { $, openSettings, tick } = await boot({ version: vOutdated, update: uShared });
  await openSettings(); await tick(); await tick();
  assert.equal($('#aboutUpdateGo').hidden, false);
  assert.equal($('#aboutUpdateGo').disabled, true);
  assert.match($('#aboutUpdateNote').textContent, /shared install/);
  assert.equal($('#aboutUpdateCmdRow').hidden, true);
});

test('not started by worca ui → no primary, reason + copy-able npm command', async () => {
  const { $, openSettings, tick } = await boot({ version: vOutdated, update: uNotSupervised });
  await openSettings(); await tick(); await tick();
  assert.equal($('#aboutUpdateGo').hidden, true);
  assert.match($('#aboutUpdateNote').textContent, /not started with worca ui/);
  assert.equal($('#aboutUpdateCmdRow').hidden, false);
  assert.equal($('#aboutUpdateCmd').textContent, 'npm install -g @worca/app@10.0.0 && worca ui restart');
});

test('failed result → red callout with reason, command and folded npm output', async () => {
  const { $, openSettings, tick } = await boot({ version: vOutdated, update: uFailed });
  await openSettings(); await tick(); await tick();
  assert.equal($('#aboutUpdateFailed').hidden, false);
  assert.equal($('#aboutUpdateFailedTitle').textContent, `The update to 10.0.0 failed. Still on ${PAINTED_VERSION}.`);
  assert.match($('#aboutUpdateFailedReason').textContent, /EACCES\)\. Worca started again on 9\.9\.9-test and resumed 2 runs\./);
  assert.equal($('#aboutUpdateFailedCmd').textContent, 'npm install -g @worca/app@10.0.0 && worca ui restart');
  assert.equal($('#aboutUpdateOutputWrap').hidden, false);
  assert.equal($('#aboutUpdateOutput').textContent, 'npm error code EACCES');
  assert.equal($('#aboutUpdateBack').hidden, true);
});

test('source build → git pull hint, no Choose version', async () => {
  const { $, openSettings, tick } = await boot({ version: vSource, update: uSource });
  await openSettings(); await tick(); await tick();
  assert.equal($('#aboutUpdateRow').hidden, false);
  assert.match($('#aboutUpdateNote').textContent, /git pull/);
  assert.equal($('#aboutUpdateChoose').hidden, true);
  assert.equal($('#aboutUpdateGo').hidden, true);
  assert.equal($('#aboutUpdateCmdRow').hidden, true);
});

test('Update to → confirm pane with "No runs are active."; Update & restart POSTs {version} once', async () => {
  const { $, openSettings, tick, calls } = await boot({ version: vOutdated, update: uEligible });
  await openSettings(); await tick(); await tick();
  $('#aboutUpdateGo').click();
  await tick(); await tick();
  assert.equal($('#update-modal').classList.contains('hidden'), false);
  assert.equal($('#update-modal [data-pane="confirm"]').hidden, false);
  assert.equal($('#update-modal [data-pane="pick"]').hidden, true);
  assert.equal($('#updateConfirmRuns').textContent, 'No runs are active.');
  assert.equal($('#updateConfirmGo').disabled, false);
  $('#updateConfirmGo').click();
  await tick(); await tick(); await tick();
  const posts = calls.filter((c) => c.method === 'POST' && /\/api\/app\/update$/.test(c.url));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { version: '10.0.0' });
  assert.equal($('#update-modal').classList.contains('hidden'), true);
  assert.equal($('#update-overlay').classList.contains('hidden'), false);
  assert.equal($('#updateOverlayTitle').textContent, 'Updating Worca to 10.0.0');
});
