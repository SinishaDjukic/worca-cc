// test/ui-design-sound-card.test.mjs — the Design chat's two sound cards (ui/public/design/sound-card.mjs, buildSoundCard)
// in the clarifying card's grammar: card 1 (sound or not, and the key when one is needed), card 2 (six voices with a
// sample button beside each, the music), their answered and closed states. jsdom plays nothing, so play() and pause()
// are stubbed on the prototype: each gives the element its own `paused` and records it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildSoundCard } from '../ui/public/design/sound-card.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });

function rig() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  doms.push(dom);
  const win = dom.window;
  const media = [];
  const own = (el, paused) => Object.defineProperty(el, 'paused', { value: paused, writable: true, configurable: true });
  win.HTMLMediaElement.prototype.play = function play() { own(this, false); media.push(['play', this]); return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function pause() { own(this, true); media.push(['pause', this]); };
  return { win, doc: win.document, media };
}
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((res) => setTimeout(res, 0)); };

const VOICES = ['Ana', 'Ben', 'Cleo', 'Dan', 'Eva', 'Finn'].map((name, i) => ({ id: `mock-voice-${i + 1}`, name, about: `${name} reads calmly.` }));
const BRIEF = { kind: 'design-start', brief: 'A pottery studio film' };
const ask = (over = {}, state = 'asking') => ({ kind: 'card', id: 'card_00000a01', state,
  card: { type: 'design-sound', step: 'ask', designId: 'd_1', heading: 'Sound for this video', summary: 'Sound for this video', keyNeeded: true, pending: BRIEF, ...over } });
const pick = (over = {}, state = 'asking') => ({ kind: 'card', id: 'card_00000a02', state,
  card: { type: 'design-sound', step: 'pick', designId: 'd_1', heading: 'Voice and music', summary: 'Voice and music', voices: VOICES, pending: BRIEF, ...over } });

/** The card on the page; `sent` records every onSubmit value; `answers` are what the next submits do, in order (a value
 *  resolves, an Error rejects); once they run out a submit resolves. */
function mount(r, block, answers = []) {
  const sent = [];
  const el = buildSoundCard(r.doc, {
    block,
    onSubmit: async (v) => { sent.push(v); const a = answers.shift(); if (a instanceof Error) throw a; return a ?? { ok: true }; },
    sampleUrl: (id) => `/api/sound/voices/${encodeURIComponent(id)}/sample`,
  });
  r.doc.body.appendChild(el);
  return { el, sent };
}
const labels = (root) => [...root.querySelectorAll('.qopt .chat-q-opt-label')].map((n) => n.textContent);
const tile = (root, label) => [...root.querySelectorAll('.qopt')].find((t) => t.querySelector('.chat-q-opt-label').textContent === label);
const go = (el) => el.querySelector('.qpanel > .qpanel-foot > button.btn.btn-primary');
const err = (el) => el.querySelector(':scope > .chat-rc-q-err');
const type = (r, input, text) => { input.value = text; input.dispatchEvent(new r.win.Event('input', { bubbles: true })); };
// The two glyphs, by their markup (icons.mjs `play`, `stop-square`): a sample button holds one or the other.
const glyph = (btn) => btn.querySelector('svg path')?.getAttribute('d') ?? (btn.querySelector('svg rect') ? 'stop' : null);
const PLAY = 'M8 5.5v13l10.5-6.5z';
const played = (media) => media.filter(([what]) => what === 'play').map(([, el]) => el);
const rejection = (message, path) => Object.assign(new Error(message), path ? { errors: [{ path, message }] } : {});

test('R1 card 1: the ask grammar; Yes shows the key field; an empty key is refused here; a typed key is sent, then emptied', async () => {
  const r = rig();
  const { el, sent } = mount(r, ask());
  assert.ok(el.matches('section.chat-rc-q.chat-q'));
  assert.equal(el.classList.contains('is-answered'), false);
  const head = el.querySelector(':scope > h3.chat-rc-q-head');
  assert.deepEqual([head.textContent, el.getAttribute('aria-labelledby')], ['Sound for this video', head.id]);
  const panel = el.querySelector(':scope > .chat-rc-qbody > .qpanel');
  assert.equal(panel.dataset.kind, 'clarify');
  const block = panel.querySelector(':scope > .qblock');
  assert.equal(block.querySelector('.qtext > .qtext-t').textContent, 'Add sound to this video?');
  assert.equal(block.querySelector('.qtext > .qn').textContent, '1');
  const group = block.querySelector(':scope > .qopts');
  assert.deepEqual([group.getAttribute('role'), group.getAttribute('aria-label')], ['group', 'Add sound to this video?']);
  assert.deepEqual(labels(el), ['Yes', 'No']);
  assert.deepEqual([...el.querySelectorAll('.qopt .chat-q-opt-sub')].map((n) => n.textContent), ['A voice tells the story. Music is up to you.', 'The video stays silent.']);
  for (const t of el.querySelectorAll('.qopt')) assert.deepEqual([t.type, t.getAttribute('aria-pressed'), t.querySelector(':scope > .qopt-txt > .chat-q-opt-name > .chat-q-opt-label') !== null], ['button', 'false', true]);
  assert.equal(el.querySelector('.qopt.sel'), null, 'none picked');
  assert.deepEqual([go(el).textContent, go(el).disabled, go(el).type], ['Continue', true, 'button']);
  assert.equal(el.querySelector('.qanswered'), null, 'the footer holds only the button');
  assert.deepEqual([err(el).hidden, err(el).getAttribute('role')], [true, 'status']);
  const key = el.querySelector('input.dsc-sound-key');
  const wrap = key.closest('.dsc-sound-field');
  assert.equal(wrap.parentElement, block, 'the field sits under the tiles, in the question');
  assert.equal(wrap.hidden, true);

  tile(el, 'Yes').click();
  assert.deepEqual([tile(el, 'Yes').classList.contains('sel'), tile(el, 'Yes').getAttribute('aria-pressed')], [true, 'true']);
  assert.equal(wrap.hidden, false);
  assert.deepEqual([key.type, key.getAttribute('autocomplete'), key.getAttribute('spellcheck'), key.placeholder], ['password', 'off', 'false', 'sk_…']);
  const label = wrap.querySelector('label');
  assert.deepEqual([label.textContent, label.htmlFor], ['ElevenLabs API key', key.id]);
  assert.ok(key.id);
  assert.equal(wrap.querySelector('.dsc-sound-help').textContent, "worca makes the voice and the music with ElevenLabs. The key is saved in worca's settings on this machine. Agents never see it.");
  assert.equal(go(el).disabled, false);

  go(el).click();
  await settle();
  assert.deepEqual(sent, [], 'an empty key sends nothing');
  assert.deepEqual([err(el).hidden, err(el).textContent], [false, 'Enter your ElevenLabs API key']);
  assert.equal(r.doc.activeElement, key);

  type(r, key, 'sk_typed');
  go(el).click();
  assert.deepEqual(sent, [{ sound: 'yes', apiKey: 'sk_typed' }]);
  assert.equal(err(el).hidden, true);
  assert.equal(go(el).disabled, true, 'in flight');
  assert.ok([...el.querySelectorAll('.qopt')].every((t) => t.disabled));
  await settle();
  assert.equal(key.value, '', 'a success empties the key field');
  assert.equal(go(el).disabled, true, 'the card waits for its answered block');
  assert.ok([...el.querySelectorAll('.qopt')].every((t) => t.disabled));
  go(el).click();
  await settle();
  assert.equal(sent.length, 1);
});

test('R2 card 1: No sends no key, and the field never shows', async () => {
  const r = rig();
  const { el, sent } = mount(r, ask());
  tile(el, 'No').click();
  assert.equal(el.querySelector('input.dsc-sound-key').closest('.dsc-sound-field').hidden, true);
  type(r, el.querySelector('input.dsc-sound-key'), 'sk_hidden');
  go(el).click();
  await settle();
  assert.deepEqual(sent, [{ sound: 'no' }]);
});

test('R3 a saved key: Yes shows no field; a refusal shows its words; one naming the key shows the field and focuses it', async () => {
  const r = rig();
  const { el, sent } = mount(r, ask({ keyNeeded: false }), [
    rejection('ElevenLabs could not be reached'),
    rejection('Pick Yes or No', 'sound'),
    rejection('ElevenLabs rejected the saved key. Enter a new one.', 'apiKey'),
  ]);
  const key = el.querySelector('input.dsc-sound-key');
  const wrap = key.closest('.dsc-sound-field');
  tile(el, 'Yes').click();
  assert.equal(wrap.hidden, true, 'the saved key is used');
  go(el).click();
  await settle();
  assert.deepEqual(sent, [{ sound: 'yes' }]);
  assert.deepEqual([err(el).hidden, err(el).textContent, wrap.hidden, go(el).disabled], [false, 'ElevenLabs could not be reached', true, false]);
  assert.equal(r.doc.activeElement, go(el), 'a refusal that names no field gives the focus to the button');
  go(el).click();
  await settle();
  assert.deepEqual([err(el).textContent, wrap.hidden], ['Pick Yes or No', true], 'a refusal naming another field never asks for the key');

  go(el).click();
  await settle();
  assert.deepEqual(sent, [{ sound: 'yes' }, { sound: 'yes' }, { sound: 'yes' }]);
  assert.equal(err(el).textContent, 'ElevenLabs rejected the saved key. Enter a new one.');
  assert.equal(wrap.hidden, false);
  assert.equal(r.doc.activeElement, key);
  assert.ok(tile(el, 'Yes').classList.contains('sel'), 'Yes stays picked');
  assert.equal(go(el).disabled, false);
  assert.ok([...el.querySelectorAll('.qopt')].every((t) => !t.disabled));

  type(r, key, 'sk_new');
  go(el).click();
  await settle();
  assert.deepEqual(sent.at(-1), { sound: 'yes', apiKey: 'sk_new' });
});

test('R4 card 2: six voices, each with a sample beside it; the music in order; Something else asks for words; Start or Save', async () => {
  const r = rig();
  const { el, sent } = mount(r, pick());
  assert.equal(el.querySelector(':scope > h3.chat-rc-q-head').textContent, 'Voice and music');
  const [q1, q2] = el.querySelectorAll('.qpanel > .qblock');
  assert.deepEqual([q1.querySelector('.qtext-t').textContent, q2.querySelector('.qtext-t').textContent], ['Which voice?', 'Background music?']);
  assert.deepEqual([q1.querySelector('.qn').textContent, q2.querySelector('.qn').textContent], ['1', '2']);
  const rows = [...q1.querySelectorAll(':scope > .qopts > .dsc-sound-voice')];
  assert.equal(rows.length, 6);
  for (const [i, row] of rows.entries()) {
    const [t, play] = row.children;
    assert.equal(row.children.length, 2);
    assert.ok(t.matches('button.qopt'));
    assert.deepEqual([t.querySelector('.chat-q-opt-label').textContent, t.querySelector('.chat-q-opt-sub').textContent], [VOICES[i].name, VOICES[i].about]);
    assert.ok(play.matches('button.btn.btn-sm.btn-quiet.btn-icon.dsc-sound-play'), 'the app\'s 28 px icon button, beside the tile');
    assert.equal(play.type, 'button');
    assert.equal(t.contains(play), false, 'never inside the tile');
    assert.deepEqual([play.getAttribute('aria-label'), glyph(play)], [`Play a sample of ${VOICES[i].name}`, PLAY]);
  }
  assert.deepEqual(labels(q2), ['No music', 'Calm', 'Upbeat', 'Cinematic', 'Playful', 'Something else']);
  assert.deepEqual([...q2.querySelectorAll('.qopt')].map((t) => t.dataset.value), ['none', 'calm', 'upbeat', 'cinematic', 'playful', 'custom']);
  assert.deepEqual([...q2.querySelectorAll('.qopt')].map((t) => t.querySelector('.chat-q-opt-sub')?.textContent ?? null), ['The voice alone.', null, null, null, null, null]);
  assert.deepEqual([go(el).textContent, go(el).disabled], ['Start', true]);
  assert.equal(el.querySelector('.qanswered'), null);

  const plays = () => [...el.querySelectorAll('.dsc-sound-play')];
  plays()[0].click();
  const audio = played(r.media).at(-1);
  assert.ok(audio.src.endsWith('/api/sound/voices/mock-voice-1/sample'), audio.src);
  assert.deepEqual([plays()[0].getAttribute('aria-label'), glyph(plays()[0])], ['Stop the sample', 'stop']);
  assert.equal(el.querySelector('.qopt.sel'), null, 'a sample picks nothing');
  plays()[1].click();
  assert.equal(played(r.media).at(-1), audio, 'one audio element');
  assert.ok(audio.src.endsWith('/api/sound/voices/mock-voice-2/sample'), audio.src);
  assert.deepEqual([plays()[0].getAttribute('aria-label'), glyph(plays()[0])], ['Play a sample of Ana', PLAY]);
  assert.equal(plays()[1].getAttribute('aria-label'), 'Stop the sample');
  assert.equal(el.querySelector('.qopt.sel'), null);

  const music = el.querySelector('input.dsc-sound-music');
  const wrap = music.closest('.dsc-sound-field');
  assert.equal(wrap.parentElement, q2);
  tile(el, 'Ben').click();
  assert.equal(go(el).disabled, true, 'a voice alone is not enough');
  assert.equal(wrap.hidden, true);
  tile(el, 'Something else').click();
  assert.equal(wrap.hidden, false);
  assert.deepEqual([music.type, music.maxLength, music.placeholder], ['text', 300, 'Soft piano and strings, slow']);
  const label = wrap.querySelector('label');
  assert.deepEqual([label.textContent, label.htmlFor], ['Describe the music', music.id]);
  assert.equal(go(el).disabled, false);
  assert.ok(tile(el, 'Ben').classList.contains('sel'), 'a pick in one question keeps the other');
  type(r, music, 'Soft piano');
  go(el).click();
  assert.deepEqual(sent, [{ voiceId: 'mock-voice-2', music: { kind: 'custom', text: 'Soft piano' } }]);
  assert.equal(audio.paused, true, 'a submit stops the sample');
  assert.equal(plays()[1].getAttribute('aria-label'), 'Play a sample of Ben');
  await settle();
  assert.equal(go(el).disabled, true);

  const second = mount(r, { ...pick({ pending: null }), id: 'card_00000a03' });
  assert.equal(go(second.el).textContent, 'Save', 'a card from the gear');
  tile(second.el, 'Ana').click();
  tile(second.el, 'Something else').click();
  type(r, second.el.querySelector('input.dsc-sound-music'), 'Drums');
  tile(second.el, 'Calm').click();
  assert.equal(second.el.querySelector('input.dsc-sound-music').closest('.dsc-sound-field').hidden, true);
  go(second.el).click();
  await settle();
  assert.deepEqual(second.sent, [{ voiceId: 'mock-voice-1', music: { kind: 'calm' } }]);
  assert.notEqual(second.el.querySelector('input.dsc-sound-music').id, music.id, 'two cards, two field ids');
});

test('R5 answered and closed: the picks stay, read-only, with one line; a closed card is the receipt', () => {
  const r = rig();
  const two = mount(r, pick({ pending: null, answers: { voiceId: 'mock-voice-1', voiceName: 'Ana', music: { kind: 'none' } } }, 'answered')).el;
  assert.ok(two.matches('section.chat-rc-q.chat-q.is-answered'));
  assert.equal(two.querySelector('.qpanel-foot'), null);
  assert.equal(two.querySelector('.dsc-sound-play'), null);
  assert.equal(two.querySelector('input'), null);
  assert.equal(two.querySelectorAll('.qopt').length, 12, 'every tile kept');
  assert.ok([...two.querySelectorAll('.qopt')].every((t) => t.disabled));
  assert.deepEqual([...two.querySelectorAll('.qopt.sel')].map((t) => t.dataset.value), ['mock-voice-1', 'none']);
  assert.deepEqual([...two.querySelectorAll('.qopt.sel')].map((t) => t.getAttribute('aria-pressed')), ['true', 'true']);
  assert.equal(two.querySelector('.dsc-sound-said').textContent, 'Ana · No music');
  assert.ok(two.textContent.includes('Ana · No music'));
  const custom = mount(r, pick({ answers: { voiceId: 'mock-voice-3', voiceName: 'Cleo', music: { kind: 'custom', text: 'Harp' } } }, 'answered')).el;
  assert.equal(custom.querySelector('.dsc-sound-said').textContent, 'Cleo · Own music');

  const no = mount(r, ask({ pending: null, answers: { sound: 'no' } }, 'answered')).el;
  assert.ok(no.classList.contains('is-answered'));
  assert.deepEqual([no.querySelector('.dsc-sound-said').textContent, no.querySelector('.qopt.sel').dataset.value, no.querySelector('input'), no.querySelector('.qpanel-foot')], ['No sound', 'no', null, null]);
  const yes = mount(r, ask({ pending: null, answers: { sound: 'yes' } }, 'answered')).el;
  assert.deepEqual([yes.querySelector('.dsc-sound-said').textContent, yes.querySelector('.qopt.sel').dataset.value], ['Sound: yes', 'yes']);

  for (const block of [ask({}, 'closed'), pick({}, 'closed')]) {
    const closed = mount(r, block).el;
    assert.ok(closed.matches('section.chat-rc-q.chat-q.is-closed'));
    assert.equal(closed.querySelector(':scope > .chat-rc-receipt').textContent, 'Not answered');
    assert.equal(typeof closed.__dispose, 'undefined');
  }
});

test('R6 samples: dispose stops a playing one; the button resets when its sample ends or fails, and stops on a second press', () => {
  const r = rig();
  const { el } = mount(r, pick());
  const plays = () => [...el.querySelectorAll('.dsc-sound-play')];
  plays()[2].click();
  const audio = played(r.media).at(-1);
  assert.equal(audio.paused, false);
  el.__dispose();
  assert.equal(audio.paused, true, 'dispose pauses it');
  assert.equal(plays()[2].getAttribute('aria-label'), 'Play a sample of Cleo');

  plays()[3].click();
  assert.equal(plays()[3].getAttribute('aria-label'), 'Stop the sample');
  audio.dispatchEvent(new r.win.Event('ended'));
  assert.deepEqual([plays()[3].getAttribute('aria-label'), glyph(plays()[3])], ['Play a sample of Dan', PLAY]);
  plays()[4].click();
  audio.dispatchEvent(new r.win.Event('error'));
  assert.deepEqual([plays()[4].getAttribute('aria-label'), glyph(plays()[4])], ['Play a sample of Eva', PLAY]);

  plays()[5].click();
  assert.equal(audio.paused, false);
  plays()[5].click();
  assert.deepEqual([audio.paused, plays()[5].getAttribute('aria-label')], [true, 'Play a sample of Finn']);
  assert.equal(el.querySelector('.qopt.sel'), null, 'no sample ever picked a tile');
});

test('a play() that returns nothing or rejects never throws', async () => {
  const r = rig();
  const errors = [];
  r.win.addEventListener('error', (e) => { errors.push(e.message); });
  r.win.HTMLMediaElement.prototype.play = () => undefined;
  const { el } = mount(r, pick());
  el.querySelector('.dsc-sound-play').click();
  r.win.HTMLMediaElement.prototype.play = () => Promise.reject(new Error('NotAllowedError'));
  el.querySelectorAll('.dsc-sound-play')[1].click();
  await settle();
  assert.deepEqual(errors, []);
  assert.equal(el.querySelectorAll('.dsc-sound-play')[1].getAttribute('aria-label'), 'Stop the sample');
});
