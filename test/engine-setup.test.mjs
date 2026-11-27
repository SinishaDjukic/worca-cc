// test/engine-setup.test.mjs — Connect <engine>, the one setup dialog for every chat engine: its data
// (src/shared/engine-setup.mjs) against the engine registry and docs/models.md, the dialog's body and status words
// (ui/public/engine-setup.mjs), and the server's answer for one engine (engines/readiness.mjs engineSetupStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { ENGINE_SETUP, MODELS_DOCS, engineSetup, engineSetupDocs } from '../src/shared/engine-setup.mjs';
import { CHAT_ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { ENGINE_CLIS } from '../src/core/engines/cli-specs.mjs';
import { chatDescriptor } from '../src/core/engines/chat.mjs';
import { engineSetupStatus } from '../src/core/engines/readiness.mjs';
import { inlineParts, renderEngineSetup, paintSetupDocsLink, setupTitle, setupStatusLine, setupCheckedLine } from '../ui/public/engine-setup.mjs';

const MODELS_MD = readFileSync(new URL('../docs/models.md', import.meta.url), 'utf8');
const slug = (h) => h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
/** The text of docs/models.md's `## ` section whose heading slug is `anchor`, up to the next `## ` heading. */
function section(anchor) {
  const parts = MODELS_MD.split(/^## /m).slice(1);
  const hit = parts.find((p) => slug(p.split('\n')[0]) === anchor);
  return hit ? hit.slice(hit.indexOf('\n')) : null;
}

test('every chat engine has a setup entry, and nothing else does', () => {
  assert.deepEqual(Object.keys(ENGINE_SETUP).sort(), [...CHAT_ENGINE_NAMES].sort());
  assert.equal(engineSetup('cursor'), null, 'Cursor has no chat');
  assert.equal(engineSetup('constructor'), null, 'only own keys');
  assert.equal(engineSetup(null), null);
});

test('each entry\'s binary override is the one worca reads (cli-specs envVar)', () => {
  for (const [e, s] of Object.entries(ENGINE_SETUP)) assert.equal(s.binVar, ENGINE_CLIS[e].envVar, e);
});

test('each entry\'s commands are the ones its docs/models.md section gives (never invented)', () => {
  for (const [e, s] of Object.entries(ENGINE_SETUP)) {
    const text = section(s.docsAnchor);
    assert.ok(text, `${e}: docs/models.md has a section #${s.docsAnchor}`);
    for (const cmd of [...s.install, ...s.signIn.commands]) assert.ok(text.includes(cmd), `${e}: "${cmd}" is in #${s.docsAnchor}`);
    assert.ok(s.install.length > 0 && s.signIn.commands.length > 0, `${e}: an install and a sign-in command`);
  }
});

test('the dialog\'s docs link and each chat descriptor\'s not-ready link are the same section', () => {
  for (const e of CHAT_ENGINE_NAMES) {
    assert.equal(engineSetupDocs(e), `${MODELS_DOCS}#${ENGINE_SETUP[e].docsAnchor}`);
    if (e !== 'claude') assert.equal(chatDescriptor(e).notReady.docsUrl, engineSetupDocs(e), e);
  }
  assert.equal(engineSetupDocs('cursor'), `${MODELS_DOCS}#cursor`, 'an engine with no entry: its own section');
  assert.equal(engineSetupDocs('<x>'), MODELS_DOCS);
});

test('setup prose takes `code` and [links](https://…) only', () => {
  assert.deepEqual(inlineParts('Set `X_BIN` to its [path](https://example.test/a) now.'),
    [{ text: 'Set ' }, { code: 'X_BIN' }, { text: ' to its ' }, { link: 'path', href: 'https://example.test/a' }, { text: ' now.' }]);
  assert.deepEqual(inlineParts('a [link](javascript:alert(1)) <b>x</b>'), [{ text: 'a [link](javascript:alert(1)) <b>x</b>' }], 'no other link, no HTML');
  assert.deepEqual(inlineParts(''), []);
  // Every entry's prose parses: an odd backtick would leave a stray one in the dialog.
  for (const [e, s] of Object.entries(ENGINE_SETUP)) {
    for (const t of [s.installNote, s.signIn.lead, ...s.signIn.notes]) {
      const left = inlineParts(t).filter((p) => p.text !== undefined).map((p) => p.text).join('');
      assert.doesNotMatch(left, /`|\]\(/, `${e}: ${t}`);
    }
  }
});

test('the dialog body: install, the binary override and sign-in, the same for every engine (the docs are the foot\'s link)', () => {
  const { document: doc } = new JSDOM('<div id="g"></div>').window;
  const host = doc.getElementById('g');
  for (const [e, s] of Object.entries(ENGINE_SETUP)) {
    assert.equal(renderEngineSetup(doc, host, e), true, e);
    const cmds = [...host.querySelectorAll('pre.ob-setup-cmd code')].map((n) => n.textContent);
    assert.deepEqual(cmds, [s.install.join('\n'), s.signIn.commands.join('\n')], `${e}: install, then sign in`);
    assert.ok([...host.querySelectorAll('.ob-setup-note code')].some((c) => c.textContent === s.binVar), `${e}: names ${s.binVar}`);
    assert.match(host.querySelector('.ob-setup-step').textContent, /^Then sign it in\. /);
    assert.doesNotMatch(host.textContent, /in the docs/, `${e}: no closing docs sentence`);
    assert.equal(host.querySelector(`a[href="${engineSetupDocs(e)}"]`), null, `${e}: the docs link is the foot's, not the body's`);
    assert.equal(host.querySelector('script, [onclick]'), null);
  }
  renderEngineSetup(doc, host, 'claude');
  const claude = host.querySelector('.ob-setup-note a');
  assert.deepEqual([claude.textContent, claude.href], ['native installer', 'https://docs.anthropic.com/en/docs/claude-code/setup']);
  assert.match(host.querySelector('.ob-setup-lead').textContent, /^Worca drives Claude Code\. /);
  const before = host.innerHTML;
  assert.equal(renderEngineSetup(doc, host, 'cursor'), false, 'no setup: nothing drawn');
  assert.equal(host.innerHTML, before);
});

test('the foot\'s Docs ↗ link: the engine\'s setup section in a new tab, named for the engine', () => {
  const { document: doc } = new JSDOM('<a id="d" href="#">Docs <span aria-hidden="true">↗</span></a>').window;
  const a = doc.getElementById('d');
  for (const e of CHAT_ENGINE_NAMES) {
    assert.equal(paintSetupDocsLink(a, e), true, e);
    const name = `${setupTitle(e).replace(/^Connect /, '')} setup in the docs`;
    assert.deepEqual([a.textContent, a.href, a.target, a.rel, a.getAttribute('aria-label'), a.title],
      ['Docs ↗', engineSetupDocs(e), '_blank', 'noopener noreferrer', name, name], e);
  }
  assert.equal(a.getAttribute('aria-label'), 'Qwen Code setup in the docs');
  assert.equal(paintSetupDocsLink(a, 'cursor'), false, 'no setup: left as it was');
  assert.equal(a.getAttribute('aria-label'), 'Qwen Code setup in the docs');
  assert.equal(paintSetupDocsLink(null, 'codex'), false);
});

test('the dialog title uses the picker\'s engine names', () => {
  assert.deepEqual(CHAT_ENGINE_NAMES.map(setupTitle), ['Connect Claude Code', 'Connect OpenAI Codex', 'Connect GitHub Copilot CLI',
    'Connect Gemini CLI', 'Connect Goose', 'Connect OpenCode', 'Connect Qwen Code']);
});

test('the status line: asking, not installed, installed but not ready, a broker refusal, ready', () => {
  assert.deepEqual(setupStatusLine('codex', null), { ok: null, text: 'Checking…' });
  const missing = 'OpenAI Codex is not installed: codex was not found. Install it, or set WORCA_CODEX_BIN to its path.';
  assert.deepEqual(setupStatusLine('codex', { bin: 'codex', installed: false, missing, ready: false, reason: null }),
    { ok: false, text: `${missing} Then check again (restart the UI if PATH changed).` });
  assert.deepEqual(setupStatusLine('qwen', { bin: 'qwen', installed: false, missing: null }),
    { ok: false, text: 'qwen was not found. Install it. Then check again (restart the UI if PATH changed).' }, 'no reason given: still what to do');
  assert.deepEqual(setupStatusLine('codex', { bin: 'codex', installed: true, ready: false, reason: 'Codex is not signed in — run codex login.' }),
    { ok: false, text: 'Found codex, but it is not ready yet: Codex is not signed in — run codex login. Sign it in, then check again.' });
  assert.deepEqual(setupStatusLine('goose', { bin: '/opt/goose', installed: true, ready: false, broker: true, reason: 'This worca runs Claude Code only' }),
    { ok: false, text: 'This worca runs Claude Code only.' });
  assert.deepEqual(setupStatusLine('copilot', { bin: 'copilot', installed: true, ready: true, reason: null }), { ok: true, text: 'Found copilot. You\'re set.' });
  assert.deepEqual(setupStatusLine('opencode', { bin: null, installed: true, ready: true, reason: 'No provider key seen' }),
    { ok: true, text: 'Found opencode. You\'re set. No provider key seen.' }, 'a warning rides along; no bin named: the engine');
  assert.equal(setupCheckedLine({ installed: false }), 'Checked just now: still not found.');
  assert.equal(setupCheckedLine({ installed: true, ready: false }), 'Checked just now: still not ready.');
  assert.equal(setupCheckedLine({ installed: true, ready: true, broker: true }), 'Checked just now: still not ready.');
  assert.equal(setupCheckedLine({ installed: true, ready: true }), 'Checked just now: ready.');
});

test('engineSetupStatus: a chat engine only; a missing CLI is said without a readiness check; else its readiness row', async () => {
  const asked = [];
  const readiness = async (o) => { asked.push(o); return [{ name: 'codex', ready: false, reason: 'not signed in' }, { name: 'goose', ready: false, reason: 'off', broker: true }]; };
  const seams = (missing) => ({ notInstalled: (e) => (e === missing ? `${e} is not installed.` : null), binOf: (e) => `/bin/${e}`, readiness });
  assert.equal(await engineSetupStatus('cursor', seams(null)), null, 'not a chat engine');
  assert.equal(await engineSetupStatus('nope', seams(null)), null);
  assert.deepEqual(await engineSetupStatus('codex', seams('codex')),
    { name: 'codex', bin: '/bin/codex', installed: false, missing: 'codex is not installed.', ready: false, reason: null });
  assert.deepEqual(asked, [], 'nothing spawned for a CLI that is not there');
  assert.deepEqual(await engineSetupStatus('codex', { ...seams(null), force: true }),
    { name: 'codex', bin: '/bin/codex', installed: true, missing: null, ready: false, reason: 'not signed in' });
  assert.deepEqual(asked, [{ force: true }], 'Check again skips the readiness cache');
  assert.deepEqual(await engineSetupStatus('goose', seams(null)),
    { name: 'goose', bin: '/bin/goose', installed: true, missing: null, ready: false, reason: 'off', broker: true });
  assert.equal((await engineSetupStatus('qwen', seams(null))).ready, null, 'no readiness row: unknown, not ready');
});
