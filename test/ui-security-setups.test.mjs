// test/ui-security-setups.test.mjs — the UI of the security setups (#1619) under jsdom, against the real markup:
// Settings › Runs › Execution environment follows the selected backend (exec-env-settings-card.mjs), Settings ›
// General › Security (security-status-view.mjs), the run page's and New run's "not sandboxed" and first-use image build
// (run-sandbox-note.mjs), the hardened box's clone-only Add project (worca-box.mjs) and the docs links (docs-links.mjs).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { paintExecEnvCardBackend, paintExecEnvCardValues, readExecEnvCard, EXEC_ENV_CARD_COPY } from '../ui/public/exec-env-settings-card.mjs';
import { paintSecurityStatus, loadSecurityStatus } from '../ui/public/security-status-view.mjs';
import { runExecEnvSeg, execEnvSegNode, paintLocalRunNote, NOT_SANDBOXED_TEXT } from '../ui/public/run-sandbox-note.mjs';
import { setWorcaBox, worcaBox, inHardenedBox, paintProjectAddForBox, projectAddModeForBox, _resetWorcaBoxForTests, HARDENED_ADD_NOTE } from '../ui/public/worca-box.mjs';
import { docsUrl, DOCS_BASE } from '../ui/public/docs-links.mjs';
import { setExecEnvListForTests, setExecEnvSelectValue } from '../ui/public/exec-envs.mjs';
import { securityPosture } from '../src/core/security-posture.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const domOf = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const settingsDoc = () => domOf(read('settings/settings.html'));
const visibleRows = (card) => [...card.querySelectorAll('[data-exec-backend]')].filter((r) => !r.hidden).map((r) => r.querySelector('input').id);

beforeEach(() => _resetWorcaBoxForTests());

test('docs links open the guides on GitHub', () => {
  assert.equal(docsUrl('choose-a-setup'), `${DOCS_BASE}choose-a-setup.md`);
  assert.equal(docsUrl('security-overview.md', 'agents'), `${DOCS_BASE}security-overview.md#agents`);
  assert.match(DOCS_BASE, /^https:\/\/github\.com\/worca-org\/worca\/blob\/dev\/docs\/$/);
});

test('Execution environment card: rows, copy and links follow the selected backend', () => {
  const card = settingsDoc().getElementById('e2b-settings-card');
  paintExecEnvCardBackend(card, 'local');
  assert.deepEqual(visibleRows(card), []);
  assert.equal(card.querySelector('#exec-env-card-hint').textContent, EXEC_ENV_CARD_COPY.local);
  assert.match(card.querySelector('#exec-env-card-hint').textContent, /not sandboxed/);
  assert.doesNotMatch(card.textContent, /docs\/e2b\.md/, 'no bare file path for a link');
  paintExecEnvCardBackend(card, 'docker');
  assert.deepEqual(visibleRows(card), ['docker-max-sandboxes', 'docker-max-wait', 'docker-memory', 'docker-cpus', 'docker-pids', 'docker-runtime']);
  assert.match(card.querySelector('#exec-env-card-hint').textContent, /Local sandbox \(Docker\)/);
  const links = [...card.querySelectorAll('#exec-env-card-links a')].map((a) => [a.textContent, a.href, a.target, a.rel]);
  assert.deepEqual(links.map((l) => l[0]), ['Choose a setup', 'Security overview', 'Local sandbox guide']);
  assert.ok(links.every((l) => l[1].startsWith(DOCS_BASE) && l[2] === '_blank' && l[3] === 'noopener noreferrer'));
  paintExecEnvCardBackend(card, 'e2b');
  assert.deepEqual(visibleRows(card), ['e2b-max-sandboxes', 'e2b-max-wait']);
  assert.equal(card.querySelector('#exec-env-card-links a:last-child').href, docsUrl('e2b'));
  paintExecEnvCardBackend(card, 'loopback', { label: 'Loopback sandbox' });
  assert.deepEqual(visibleRows(card), []);
  assert.match(card.querySelector('#exec-env-card-hint').textContent, /^Loopback sandbox: /);
});

test('Execution environment card: stored values paint in, and Save sends every backend\'s fields (empty = null)', () => {
  const card = settingsDoc().getElementById('e2b-settings-card');
  paintExecEnvCardValues(card, { e2bMaxSandboxes: 5, dockerMaxSandboxes: 3, dockerMaxWaitMin: 60, dockerSandbox: { memory: '8g', runtime: 'runsc' } });
  setExecEnvListForTests([{ name: 'local', label: 'Local' }, { name: 'e2b', label: 'E2B sandbox' }, { name: 'docker', label: 'Local sandbox (Docker)' }]);
  try { setExecEnvSelectValue(card.querySelector('#e2b-exec-env'), 'docker'); } finally { setExecEnvListForTests(null); }
  card.querySelector('#docker-cpus').value = '1.5';
  assert.deepEqual(readExecEnvCard(card), { execEnv: 'docker', e2bMaxSandboxes: 5, e2bMaxWaitMin: null, dockerMaxSandboxes: 3, dockerMaxWaitMin: 60,
    dockerSandbox: { memory: '8g', cpus: 1.5, pids: null, runtime: 'runsc' } });
  for (const id of ['docker-memory', 'docker-cpus', 'docker-runtime']) card.querySelector(`#${id}`).value = '';
  card.querySelector('#e2b-exec-env').value = 'local';
  const body = readExecEnvCard(card);
  assert.equal(body.execEnv, null);
  assert.equal(body.dockerSandbox, null);
});

test('Security card: one row per protection with a chip, the box image in a container, the docs links', () => {
  const doc = settingsDoc();
  const card = doc.getElementById('security-card');
  assert.equal(card.dataset.minLevel, 'advanced');
  const host = doc.getElementById('securityStatusBody');
  paintSecurityStatus(host, securityPosture({ env: {}, proxy: { state: 'not-configured' } }));
  const rows = [...host.querySelectorAll('.security-row')];
  assert.deepEqual(rows.map((r) => r.dataset.row), ['where', 'broker', 'agents', 'network', 'proxy', 'exec-env']);
  assert.equal(rows[0].querySelector('.exec-env-status').textContent, 'Native install');
  assert.equal(rows[1].querySelector('.exec-env-status').dataset.tone, 'muted');
  assert.match(rows[5].textContent, /not sandboxed/);
  assert.deepEqual([...host.querySelectorAll('.security-links a')].map((a) => a.href), [docsUrl('security-overview'), docsUrl('choose-a-setup')]);

  const H = `sha256:${'c'.repeat(64)}`;
  const box = securityPosture({ env: { WORCA_BOX: 'hardened', WORCA_BOX_IMAGE: 'worca-box:abcdefabcdef', WORCA_BOX_IMAGE_PROJECTS: `acme-web=${H}` }, specHashOf: () => `sha256:${'d'.repeat(64)}` });
  paintSecurityStatus(host, box);
  const img = host.querySelector('.security-row[data-state]');
  assert.equal(img.dataset.state, 'stale');
  assert.match(img.textContent, /worca-box:abcdefabcdef/);
  assert.match(img.textContent, /acme-web changed its environment spec/);
  assert.equal(img.querySelector('code').textContent, 'worca container build');
  assert.equal(img.querySelector('.exec-env-status').dataset.tone, 'warn');
  assert.ok([...host.querySelectorAll('.security-links a')].some((a) => a.href === docsUrl('hardened-box')));
});

test('Security card: a failed fetch says so instead of a blank card', async () => {
  const host = settingsDoc().getElementById('securityStatusBody');
  assert.equal(await loadSecurityStatus(host, { fetchFn: async () => { throw new Error('offline'); } }), null);
  assert.match(host.textContent, /not available/);
  const posture = await loadSecurityStatus(host, { fetchFn: async () => ({ ok: true, json: async () => securityPosture({ env: {} }) }) });
  assert.equal(posture.where, 'native');
});

test('run page segment: a backend, its slot wait, its first-use image build, and Local on a native install only', () => {
  const o = { label: (n) => (n === 'docker' ? 'Local sandbox (Docker)' : n), titleWithArticle: () => 'a Docker' };
  assert.deepEqual(runExecEnvSeg({ execEnv: 'docker' }, o).slice(0, 2), ['rd-exec-env', 'Local sandbox (Docker)']);
  assert.equal(runExecEnvSeg({ execEnv: 'docker', execEnvWaiting: true }, o)[1], 'waiting for a Docker slot');
  const build = runExecEnvSeg({ execEnv: 'docker', execEnvWaiting: true, execEnvPreparing: 'image-build' }, o);
  assert.equal(build[1], 'building the sandbox image, first use…');
  assert.match(build[3].title, /once per Worca upgrade/);
  const local = runExecEnvSeg({}, { ...o, box: 'native' });
  assert.equal(local[1], NOT_SANDBOXED_TEXT);
  assert.equal(local[3].href, docsUrl('choose-a-setup'));
  for (const box of ['container', 'hardened', 'hosted', null]) assert.equal(runExecEnvSeg({}, { ...o, box }), null, String(box));
  const doc = domOf('');
  const a = execEnvSegNode(doc, local);
  assert.equal(a.tagName, 'A');
  assert.equal(a.target, '_blank');
  assert.match(a.title, /directly on this machine/);
  assert.equal(execEnvSegNode(doc, runExecEnvSeg({ execEnv: 'docker' }, o)).tagName, 'SPAN');
});

test("New run's note: the real markup, shown for Local on a native install, with the Choose a setup link", () => {
  const doc = domOf(read('new-run/new.html'));
  const note = doc.getElementById('exec-env-local-note');
  assert.equal(note.dataset.minLevel, 'advanced');
  paintLocalRunNote(note, { show: true });
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /not sandboxed/);
  assert.equal(note.querySelector('a').href, docsUrl('choose-a-setup'));
  paintLocalRunNote(note, { show: false });
  assert.equal(note.hidden, true);
});

test('the hardened box: Add project offers Clone from URL only, with the reason', () => {
  const doc = domOf(read('projects/project-add.html'));
  const modal = doc.getElementById('project-add-modal');
  assert.equal(worcaBox(), null, 'unknown until the server answers');
  assert.equal(projectAddModeForBox('folder'), 'folder');
  paintProjectAddForBox(modal);
  assert.equal(doc.getElementById('proj-add-tab-folder').hidden, false);
  assert.equal(doc.getElementById('proj-add-box-note').hidden, true);
  assert.equal(setWorcaBox('hardened'), true);
  assert.equal(inHardenedBox(), true);
  assert.equal(projectAddModeForBox('folder'), 'clone');
  assert.equal(projectAddModeForBox('new'), 'clone');
  paintProjectAddForBox(modal);
  assert.equal(doc.getElementById('proj-add-tab-folder').hidden, true);
  assert.equal(doc.getElementById('proj-add-tab-new').hidden, true);
  assert.equal(doc.getElementById('proj-add-tab-clone').hidden, false);
  const note = doc.getElementById('proj-add-box-note');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, HARDENED_ADD_NOTE);
  assert.ok(note.closest('#proj-add-clone-pane'), 'the reason sits in the Clone pane');
  assert.equal(setWorcaBox('bogus'), true);
  assert.equal(worcaBox(), 'native', 'an older server (no box) reads as native');
});
