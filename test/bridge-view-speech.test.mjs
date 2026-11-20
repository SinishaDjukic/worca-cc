// test/bridge-view-speech.test.mjs
// The Providers tab's Speech row (docs/speech.md): collectSpeechRow's PATCH
// body (unchanged key omitted, '' clears).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSpeechRow, renderSoundRow, collectSpeechRow } from '../ui/public/bridge-view.mjs';
import { renderProvidersTab } from '../ui/public/models/providers-tab.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const SPEECH = {
  stt: { engine: 'server', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1', language: 'bg', configured: true, keySet: true, keySource: 'stored', keyMasked: '••••••abcd', keyRef: null, keyMissing: false },
  tts: { engine: 'off', baseUrl: '', model: 'tts-1', voice: 'alloy', speed: 1, configured: false, keySet: false, keySource: null, keyMasked: null, keyRef: null, keyMissing: false },
};

test('collectSpeechRow on the tab: unchanged key omitted, edits and clears carried', () => {
  const tab = renderProvidersTab({ speech: SPEECH }, { doc });
  const f = (kind, field) => tab.querySelector(`.mv-sp-field[data-kind="${kind}"][data-field="${field}"]`);
  f('stt', 'language').value = 'auto';
  f('stt', 'pause').value = '2';
  f('tts', 'baseUrl').value = 'http://127.0.0.1:8880/v1';
  f('tts', 'speed').value = '1.1';
  assert.deepEqual(collectSpeechRow(tab), {
    stt: { engine: 'server', language: 'auto', pause: 2, baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1' },
    tts: { engine: 'off', voice: 'alloy', speed: 1.1, baseUrl: 'http://127.0.0.1:8880/v1', model: 'tts-1' },
  });
  f('stt', 'apiKey').value = '';
  assert.equal(collectSpeechRow(tab).stt.apiKey, '');
});

test('collectSpeechRow on the row\'s own body: both sides, the untouched keys left out; another row is no Speech row', () => {
  const row = renderSpeechRow({ speech: SPEECH }, { doc });
  assert.deepEqual(collectSpeechRow(row), {
    stt: { engine: 'server', language: 'bg', pause: '', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1' },
    tts: { engine: 'off', voice: 'alloy', speed: 1, baseUrl: '', model: 'tts-1' },
  });
  assert.equal(collectSpeechRow(renderSoundRow({}, { doc })), null);
  // No title or intro of its own (the tab's row head names it); the two boxes keep theirs.
  assert.doesNotMatch(row.textContent, /Speech \(Chat voice\)|Voice mode for Chat/);
  assert.deepEqual([...row.querySelectorAll('.mv-sp-kind > .mv-head .mv-name')].map((n) => n.textContent), ['Speech-to-text', 'Text-to-speech']);
});
