// test/ui-about-update.test.mjs — Settings ▸ About ▸ Updates (#841), the browser side
// (ui/public/about-update.mjs) against the real index.html markup: what each kind of instance
// shows, and that a managed one never gets an install control.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { paintUpdateInto, paintUpdateBadge, updateStateText, mountAboutUpdate } from '../ui/public/about-update.mjs';
import { checkRows } from './helpers/rows.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const page = () => trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' })).window.document;

const status = (over = {}) => ({
  current: '1.12.0', channel: 'stable', deployment: 'local', installKind: 'npm',
  check: { enabled: true, lockedBy: null, registry: 'https://registry.npmjs.org', checkedAt: '2026-10-22T08:00:00.000Z', error: null },
  latest: '1.13.0', updateAvailable: true, target: '1.13.0',
  notes: { releases: [{ version: '1.13.0', url: 'https://x/releases/tag/worca-app-v1.13.0' }, { version: '1.12.1', url: 'https://x/releases/tag/worca-app-v1.12.1' }],
    more: 0, compareUrl: 'https://x/compare/worca-app-v1.12.0...worca-app-v1.13.0', changelogUrl: 'https://docs.worca.dev/changelog' },
  apply: 'self', managedBy: null, auto: { enabled: false, allowed: true },
  instructions: { who: 'you', steps: ['npm install -g @worca/app@1.13.0', 'worca ui restart'] },
  installing: null, installed: null, restart: { available: true, busy: null },
  ...over,
});

test('the About card ships an Updates row and the account menu a hidden chip', () => {
  const doc = page();
  assert.ok(doc.querySelector('#about-card #aboutUpdate'), 'the row is inside the About card');
  assert.equal(doc.querySelector('#acct-update-badge').hidden, true, 'no chip before the status lands');
});

test('what each kind of instance shows', async () => {
  await checkRows([
    { name: 'desktop npm install with an update: notes, compare link, Update button, both switches', run: () => {
      const doc = page();
      paintUpdateInto(doc, status());
      assert.match(doc.querySelector('#aboutUpdateState').textContent, /1\.13\.0 is available/);
      assert.deepEqual([...doc.querySelectorAll('#aboutUpdateNotes a')].map((a) => a.textContent), ['1.13.0', '1.12.1']);
      assert.ok([...doc.querySelectorAll('#aboutUpdate a')].some((a) => a.textContent === 'Changes since 1.12.0'));
      const btn = doc.querySelector('#aboutUpdateApply');
      assert.equal(btn.textContent, 'Update to 1.13.0'); assert.equal(btn.dataset.version, '1.13.0');
      assert.ok(doc.querySelector('#aboutUpdateAutoToggle'));
      assert.ok(doc.querySelector('#aboutUpdateCheckToggle').checked);
      for (const a of doc.querySelectorAll('#aboutUpdate a')) assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    } },
    { name: 'hosted (SaaS): no install control, no switches, says the administrator upgrades it', run: () => {
      const doc = page();
      paintUpdateInto(doc, status({ deployment: 'hosted', apply: 'managed', managedBy: 'hosted', auto: { enabled: false, allowed: false },
        instructions: { who: 'admin', steps: ['Your administrator upgrades this instance by deploying the 1.13.0 image tag.'] } }));
      assert.equal(doc.querySelector('#aboutUpdateApply'), null);
      assert.equal(doc.querySelector('#aboutUpdateRestart'), null);
      assert.equal(doc.querySelector('#aboutUpdateCheckToggle'), null, 'a visitor does not switch the operator’s checks');
      assert.match(doc.querySelector('#aboutUpdateManaged').textContent, /administrator/);
      assert.match(doc.querySelector('#aboutUpdateNotes').textContent, /1\.13\.0/, 'the notes still show, so people know what is coming');
    } },
    { name: 'container: the pull steps instead of a button', run: () => {
      const doc = page();
      paintUpdateInto(doc, status({ deployment: 'container', apply: 'managed', managedBy: 'container', auto: { enabled: false, allowed: false },
        instructions: { who: 'operator', steps: ['Set WORCA_TAG=1.13.0 in .env (or keep latest)', 'docker compose pull && docker compose up -d'] } }));
      assert.equal(doc.querySelector('#aboutUpdateApply'), null);
      assert.match(doc.querySelector('#aboutUpdateSteps').textContent, /docker compose pull/);
      assert.equal(doc.querySelector('#aboutUpdateAutoToggle'), null);
    } },
    { name: 'installed, waiting: Restart now, disabled with the reason while a run is in progress', run: () => {
      const doc = page();
      paintUpdateInto(doc, status({ updateAvailable: false, installed: { version: '1.13.0', at: 'x' }, restart: { available: true, busy: '1 run in progress' } }));
      const r = doc.querySelector('#aboutUpdateRestart');
      assert.ok(r.disabled); assert.equal(r.title, '1 run in progress');
      assert.equal(doc.querySelector('#aboutUpdateApply'), null);
    } },
    { name: 'checks locked off by the operator: says so, no switch to undo it', run: () => {
      const doc = page();
      paintUpdateInto(doc, status({ check: { enabled: false, lockedBy: 'env', checkedAt: null, error: null }, updateAvailable: false, target: null, latest: null }));
      assert.match(doc.querySelector('#aboutUpdateState').textContent, /WORCA_UPDATE_CHECK=0/);
      assert.equal(doc.querySelector('#aboutUpdateCheckToggle'), null);
      assert.equal(doc.querySelector('#aboutUpdateCheck'), null);
    } },
    { name: 'a malformed status leaves the placeholder alone', run: () => {
      const doc = page();
      const before = doc.querySelector('#aboutUpdate').innerHTML;
      for (const s of [null, {}, { current: 5 }, 'x']) paintUpdateInto(doc, s);
      assert.equal(doc.querySelector('#aboutUpdate').innerHTML, before);
    } },
  ]);
});

test('the state line and the account chip', () => {
  assert.match(updateStateText(status({ updateAvailable: false })), /^Up to date/);
  assert.match(updateStateText(status({ check: { enabled: true, checkedAt: null, error: 'fetch failed' } })), /Could not check.*fetch failed/);
  const doc = page();
  paintUpdateBadge(doc, status());
  assert.equal(doc.querySelector('#acct-update-badge').hidden, false);
  assert.equal(doc.querySelector('#acct-update-badge').textContent, '1.13.0');
  paintUpdateBadge(doc, status({ updateAvailable: false }));
  assert.equal(doc.querySelector('#acct-update-badge').hidden, true);
});

test('mountAboutUpdate checks once when the server has not yet, and Update posts the version shown', async () => {
  const doc = page();
  const calls = [];
  let checked = false;
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : null]);
    if (url === '/api/app/update/check') checked = true;
    const body = url === '/api/app/update/apply' ? status({ updateAvailable: false, installed: { version: '1.13.0', at: 'x' } })
      : checked ? status() : status({ updateAvailable: false, target: null, check: { enabled: true, checkedAt: null, error: null } });
    return { ok: true, status: 200, json: async () => body };
  };
  await mountAboutUpdate(doc, { fetch: fetchImpl });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['GET', '/api/app/update'], ['POST', '/api/app/update/check']]);
  doc.querySelector('#aboutUpdateApply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.at(-1), ['POST', '/api/app/update/apply', { version: '1.13.0' }]);
  assert.ok(doc.querySelector('#aboutUpdateRestart'), 'after the install the card offers the restart');
});
