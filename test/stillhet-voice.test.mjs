// test/stillhet-voice.test.mjs — Stillhet's mic (ui/public/stillhet/chat/voice.mjs, D15): a thin binding of dev's own voice
// engine (src/shared/ask-voice.mjs). Its support is dev's, word for word; a dictated transcript fills the composer, a
// hands-free one is sent; it never touches the Web Speech API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindVoice } from '../ui/public/stillhet/chat/voice.mjs';
import { voiceSupport } from '../src/shared/ask-voice.mjs';

function fakeController() {
  const calls = [];
  let hooks;
  return { calls, hooks: () => hooks, make: (h) => { hooks = h; return { start: async (m) => calls.push(['start', m]), stop: async () => calls.push(['stop']), active: () => false, onFrame: () => {} }; } };
}

test('support() is dev\'s voiceSupport answer unchanged', () => {
  const win = { isSecureContext: true, navigator: {} };
  const v = bindVoice({ win, doc: {}, fetch: async () => ({}), onTranscript: () => {}, onState: () => {}, create: fakeController().make });
  assert.deepEqual(v.support(), voiceSupport(win));
  assert.deepEqual(v.support(), { ok: false, reason: 'This browser gives the page no microphone access.' });
});

test('dictate fills the composer; hands-free sends; stop stops; states reach the page', async () => {
  const f = fakeController(), got = [], states = [];
  const v = bindVoice({ win: {}, doc: {}, fetch: async () => ({}), onTranscript: (t, o) => got.push([t, o.send]), onState: (s) => states.push(s), create: f.make });
  await v.dictate();
  f.hooks().onTranscript('hello there', { autoSend: false });
  await v.handsFree(true);
  f.hooks().onTranscript('send this', { autoSend: true });
  f.hooks().onState('listening', { mode: 'handsfree' });
  await v.stop();
  assert.deepEqual(f.calls, [['start', 'dictate'], ['start', 'handsfree'], ['stop']]);
  assert.deepEqual(got, [['hello there', false], ['send this', true]]);
  assert.deepEqual(states, ['listening']);
});

test('the binding never reaches for the Web Speech API', () => {
  assert.doesNotMatch(readFileSync('ui/public/stillhet/chat/voice.mjs', 'utf8'), /SpeechRecognition|speechSynthesis/);
});

test('a stopped engine\'s reason reaches the page with its state (dev\'s `detail`), so the mic can say why it is off', async () => {
  const f = fakeController(), states = [];
  const v = bindVoice({ win: {}, doc: {}, fetch: async () => ({}), onTranscript: () => {}, onState: (s, info) => states.push([s, info.detail || '']), create: f.make });
  await v.dictate();
  f.hooks().onState('loading', { mode: 'dictate' });
  f.hooks().onState('error', { mode: null, detail: 'no microphone was found' });
  assert.deepEqual(states, [['loading', ''], ['error', 'no microphone was found']]);
});

test('the composer keeps the mic pressed while dev\'s engine starts (loading) and says why when it stops on an error', () => {
  const src = readFileSync('ui/public/stillhet/chat/conversation.js', 'utf8');
  assert.match(src, /const on = st !== 'off';/, 'loading, listening and transcribing are all on');
  assert.match(src, /if \(st === 'error'\) \{[^}]*Could not listen: \$\{info\.detail \|\| 'voice stopped'\}/);
});
