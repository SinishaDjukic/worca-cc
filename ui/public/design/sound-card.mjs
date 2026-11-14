// ui/public/design/sound-card.mjs — the Design chat's two sound cards (`design-sound`, SPEC §6 U1–U3): step `ask` (sound
// or not, plus the ElevenLabs key when one is needed) and step `pick` (six voices, each with a sample button beside its
// tile, and the music). Built in the clarifying card's grammar (chat/question.mjs) but not with it: a voice tile has a
// sibling button, a field sits under the tiles, a refusal can focus a field, and the footer has no count. Answered, a
// card keeps its tiles disabled with the pick marked and one line saying what was chosen; closed, it is the receipt.
// Pure: DOM only through `doc`; the answer goes out through `onSubmit`.
import { icon } from '../icons.mjs';
import { buildChatReceipt } from '../chat/question.mjs';
import { MUSIC_KINDS, MUSIC_STYLES, musicLabel } from '../../../src/shared/sound-services.mjs';

const KEY_HELP = "worca makes the voice and the music with ElevenLabs. The key is saved in worca's settings on this machine. Agents never see it.";
const SOUND_TILES = [
  { value: 'yes', label: 'Yes', sub: 'A voice tells the story. Music is up to you.' },
  { value: 'no', label: 'No', sub: 'The video stays silent.' },
];
/** The music tiles in MUSIC_KINDS order: the style labels, `No music` with its sub-line, and `Something else`. */
const MUSIC_TILES = MUSIC_KINDS.map((kind) => {
  if (kind === 'none') return { value: kind, label: 'No music', sub: 'The voice alone.' };
  if (kind === 'custom') return { value: kind, label: 'Something else' };
  return { value: kind, label: MUSIC_STYLES[kind].label };
});
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * One `design-sound` card block as its element.
 * @param {Document} doc
 * @param {{ block: { id: string, state: string, card: object }, onSubmit: (values: object) => Promise<unknown>,
 *   sampleUrl: (voiceId: string) => string }} o
 *   `onSubmit` gets `{ sound, apiKey? }` (step `ask`) or `{ voiceId, music: { kind, text? } }` (step `pick`); a refusal
 *   throws the server's words, with `err.errors` (`[{ path, message }]`) when it names a field.
 * @returns {HTMLElement} with `__dispose()` (stops a playing sample); a closed card is the receipt, with none.
 */
export function buildSoundCard(doc, { block, onSubmit, sampleUrl }) {
  const b = isObj(block) ? block : {};
  const card = isObj(b.card) ? b.card : {};
  if (b.state !== 'asking' && b.state !== 'answered') return buildChatReceipt(doc, 'Not answered');
  const answered = b.state === 'answered';
  const answers = isObj(card.answers) ? card.answers : {};
  const pickStep = card.step === 'pick';
  const id = `chat-q-${str(b.id)}`;

  const h = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const tileOf = (o) => {
    const btn = h('button', 'qopt');
    btn.type = 'button';
    btn.dataset.value = o.value;
    btn.setAttribute('aria-pressed', 'false');
    const name = h('span', 'chat-q-opt-name');
    name.appendChild(h('span', 'chat-q-opt-label', o.label));
    const txt = h('span', 'qopt-txt');
    txt.appendChild(name);
    if (o.sub) txt.appendChild(h('span', 'chat-q-opt-sub', o.sub));
    btn.appendChild(txt);
    return btn;
  };
  /** A question: `div.qblock` with its number and words, and the tiles' group. */
  const question = (n, words) => {
    const qb = h('div', 'qblock');
    const text = h('div', 'qtext');
    text.append(h('span', 'qn', String(n)), h('span', 'qtext-t', words));
    const group = h('div', 'qopts');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', words);
    qb.append(text, group);
    return { qb, group };
  };
  /** A labelled field under the tiles (label, input, help line in one wrapper), hidden until its tile asks for it. */
  const fieldOf = (cls, label, attrs, help) => {
    const wrap = h('div', 'dsc-sound-field');
    wrap.hidden = true;
    const input = h('input', cls);
    input.id = `${id}-${cls}`;
    for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    const lab = h('label', 'dsc-sound-label', label);
    lab.htmlFor = input.id;
    wrap.append(lab, input);
    if (help) {
      const line = h('p', 'dsc-sound-help', help);
      line.id = `${input.id}-help`;
      input.setAttribute('aria-describedby', line.id);
      wrap.append(line);
    }
    return { wrap, input };
  };
  const mark = (tiles, value) => {
    for (const t of tiles) {
      const on = value != null && t.dataset.value === value;
      t.classList.toggle('sel', on);
      t.setAttribute('aria-pressed', String(on));
    }
  };

  const el = h('section', answered ? 'chat-rc-q chat-q is-answered' : 'chat-rc-q chat-q');
  const head = h('h3', 'chat-rc-q-head', pickStep ? 'Voice and music' : 'Sound for this video');
  head.id = `${id}-h`;
  el.setAttribute('aria-labelledby', head.id);
  const body = h('div', 'chat-rc-qbody');
  const panel = h('div', 'qpanel');
  panel.dataset.kind = 'clarify';
  body.appendChild(panel);
  const err = h('div', 'chat-rc-q-err');
  err.setAttribute('role', 'status');
  err.hidden = true;
  el.append(head, body, err);

  // ── samples: one audio element, one sample at a time ──
  let audio = null;
  let playing = null;               // the sample button whose voice plays
  const playLabel = (btn) => `Play a sample of ${btn.dataset.name}`;
  function face(btn, on) {
    btn.replaceChildren(icon(doc, on ? 'stop-square' : 'play', 16));
    btn.setAttribute('aria-label', on ? 'Stop the sample' : playLabel(btn));
    btn.title = on ? 'Stop the sample' : playLabel(btn);
  }
  function stopSample() {
    if (!playing) return;
    const btn = playing;
    playing = null;
    if (audio) audio.pause();
    face(btn, false);
  }
  function playSample(btn) {
    if (playing === btn) { stopSample(); return; }
    stopSample();
    if (!audio) {
      audio = doc.createElement('audio');
      audio.preload = 'none';
      const reset = () => { if (playing) { face(playing, false); playing = null; } };
      audio.addEventListener('ended', reset);
      audio.addEventListener('error', reset);
    }
    audio.src = sampleUrl(btn.dataset.voice);
    playing = btn;
    face(btn, true);
    // As film.js's playEl: a missing or rejected play promise is swallowed.
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  el.__dispose = () => stopSample();

  // ── the questions ──
  const groups = [];                // { key, tiles, pick: value | null }
  let keyField = null;
  let musicField = null;
  let keyAsked = card.keyNeeded === true;   // the key is needed, or a refusal named it since this card was made
  if (pickStep) {
    const voices = (Array.isArray(card.voices) ? card.voices : []).filter((v) => isObj(v) && typeof v.id === 'string' && v.id);
    const q1 = question(1, 'Which voice?');
    const voiceTiles = voices.map((v) => {
      const row = h('div', 'dsc-sound-voice');
      const t = tileOf({ value: v.id, label: str(v.name) || v.id, sub: str(v.about) });
      row.appendChild(t);
      if (!answered) {
        const play = h('button', 'btn btn-sm btn-quiet btn-icon dsc-sound-play');
        play.type = 'button';
        play.dataset.voice = v.id;
        play.dataset.name = str(v.name) || v.id;
        face(play, false);
        play.addEventListener('click', () => playSample(play));
        row.appendChild(play);
      }
      q1.group.appendChild(row);
      return t;
    });
    const q2 = question(2, 'Background music?');
    const musicTiles = MUSIC_TILES.map((o) => { const t = tileOf(o); q2.group.appendChild(t); return t; });
    if (!answered) {
      musicField = fieldOf('dsc-sound-music', 'Describe the music', { type: 'text', maxlength: '300', placeholder: 'Soft piano and strings, slow', autocomplete: 'off' });
      q2.qb.appendChild(musicField.wrap);
    }
    panel.append(q1.qb, q2.qb);
    groups.push({ key: 'voice', tiles: voiceTiles, pick: null }, { key: 'music', tiles: musicTiles, pick: null });
  } else {
    const q = question(1, 'Add sound to this video?');
    const tiles = SOUND_TILES.map((o) => { const t = tileOf(o); q.group.appendChild(t); return t; });
    if (!answered) {
      keyField = fieldOf('dsc-sound-key', 'ElevenLabs API key', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk_…' }, KEY_HELP);
      q.qb.appendChild(keyField.wrap);
    }
    panel.append(q.qb);
    groups.push({ key: 'sound', tiles, pick: null });
  }
  const group = (key) => groups.find((g) => g.key === key);

  // ── answered: the picks marked, every tile disabled, one line ──
  if (answered) {
    let said;
    if (pickStep) {
      const music = isObj(answers.music) ? answers.music : {};
      mark(group('voice').tiles, str(answers.voiceId));
      mark(group('music').tiles, str(music.kind));
      said = `${str(answers.voiceName)} · ${musicLabel(music)}`;
    } else {
      mark(group('sound').tiles, str(answers.sound));
      said = answers.sound === 'yes' ? 'Sound: yes' : 'No sound';
    }
    for (const g of groups) for (const t of g.tiles) t.disabled = true;
    panel.appendChild(h('p', 'dsc-sound-said', said));
    return el;
  }

  // ── asking ──
  const foot = h('div', 'qpanel-foot');
  const go = h('button', 'btn btn-primary', pickStep ? (card.pending ? 'Start' : 'Save') : 'Continue');
  go.type = 'button';
  go.dataset.qpanelSubmit = '';
  foot.appendChild(go);
  panel.appendChild(foot);
  let busy = false;

  const keyShown = () => group('sound')?.pick === 'yes' && keyAsked;
  function paint() {
    if (keyField) keyField.wrap.hidden = !keyShown();
    if (musicField) musicField.wrap.hidden = group('music').pick !== 'custom';
    for (const g of groups) for (const t of g.tiles) t.disabled = busy;
    go.disabled = busy || groups.some((g) => g.pick == null);
  }
  for (const g of groups) {
    for (const t of g.tiles) {
      t.addEventListener('click', () => {
        if (busy) return;
        g.pick = t.dataset.value;
        mark(g.tiles, g.pick);
        paint();
      });
    }
  }
  const fail = (message, input) => {
    err.textContent = message;
    err.hidden = false;
    paint();
    (input || go).focus();
  };
  function values() {
    if (!pickStep) {
      const out = { sound: group('sound').pick };
      if (keyShown() && keyField.input.value.trim()) out.apiKey = keyField.input.value;
      return out;
    }
    const kind = group('music').pick;
    return { voiceId: group('voice').pick, music: kind === 'custom' ? { kind, text: musicField.input.value } : { kind } };
  }
  go.addEventListener('click', () => {
    if (busy || groups.some((g) => g.pick == null)) return;
    if (keyShown() && !keyField.input.value.trim()) { fail('Enter your ElevenLabs API key', keyField.input); return; }
    const out = values();
    stopSample();
    busy = true;
    err.hidden = true;
    paint();
    new Promise((res) => { res(onSubmit(out)); })
      .then(() => { if (keyField) keyField.input.value = ''; })   // the card stays busy: it waits for its answered block
      .catch((e) => {
        busy = false;
        const named = Array.isArray(e && e.errors) && e.errors[0] && e.errors[0].path === 'apiKey';
        if (named && keyField) keyAsked = true;
        fail((e && e.message) || 'Answer not sent', named && keyField ? keyField.input : null);
      });
  });
  paint();
  return el;
}
