// The preview's voice and music (ui/public/design/film-sound.mjs; SPEC D12, D13, U5; L6, L8, L14): the worca page holds
// one `<audio>` per clip and one for the music, never attached, and follows the frame's `time` messages by the rule
// film.js keeps for a film opened alone. The music follows the shared table of src/shared/sound-services.mjs; a clip
// starts up to 0.1 s early, from its beginning, because the frame reports film time every 0.1 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createFilmSound } from '../ui/public/design/film-sound.mjs';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const FILM = JSON.parse(readFileSync(new URL('./fixtures/film-sound-cases.json', import.meta.url), 'utf8'));
const fileUrl = (name) => `/f/${name}`;

// jsdom plays nothing and its `paused` is a getter: each method defines an own `paused` and records the call.
function page() {
  const win = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' }).window;
  const calls = [];
  const P = win.HTMLMediaElement.prototype;
  const flag = (el, value) => Object.defineProperty(el, 'paused', { value, writable: true, configurable: true });
  P.play = function play() { flag(this, false); calls.push(['play', this]); return Promise.resolve(); };
  P.pause = function pause() { flag(this, true); calls.push(['pause', this]); };
  P.load = function load() { calls.push(['load', this]); };
  return { win, doc: win.document, calls };
}
const at = (t, playing = true) => ({ t, playing, dur: FILM.dur });

test('F1 the shared table: one element per clip and one looping music track, following film time', () => {
  const { doc } = page();
  const s = createFilmSound({ doc, fileUrl });
  s.load(FILM.tracks);
  assert.equal(s.hasSound(), true);
  const els = s._elements();
  assert.deepEqual(els.map((el) => new URL(el.src).pathname), ['/f/voice-a.mp3', '/f/voice-b.mp3', '/f/music.mp3']);
  assert.deepEqual(els.map((el) => [el.loop, el.preload]), [[false, 'auto'], [false, 'auto'], [true, 'auto']]);
  assert.ok(els.every((el) => el.parentNode === null), 'never attached to the page');
  const music = els[2];
  for (const c of FILM.cases.filter((x) => x.t < FILM.dur)) {
    s.onTime(at(c.t));
    assert.deepEqual([!music.paused, r6(music.volume)], [c.music[0], c.music[2]], `music at t=${c.t}`);
  }
  const fresh = createFilmSound({ doc, fileUrl });
  fresh.load(FILM.tracks);
  const [a, b] = fresh._elements();
  fresh.onTime(at(0.25));
  assert.equal(a.paused, false, 'clip a starts 0.1 s early, where the table still says off');
  fresh.onTime(at(0.28));
  assert.deepEqual([a.paused, a.currentTime, b.paused], [false, 0, true], 'from its beginning');
  fresh.onTime(at(1));
  assert.equal(r6(a.currentTime), 0.65, 'more than SOUND_DRIFT off: set right');
  a.currentTime = 0.75;
  fresh.onTime(at(1.05));
  assert.equal(a.currentTime, 0.75, 'within SOUND_DRIFT: left alone');
  fresh.onTime(at(2.35));
  assert.equal(a.paused, true, 'past its end');
  fresh.onTime(at(6));
  assert.deepEqual([b.paused, r6(b.currentTime)], [false, 0.65]);
  fresh.onTime(at(6.1, false));
  assert.ok(fresh._elements().every((el) => el.paused), 'playing: false pauses all');
});

test('F2: an agent-written gain over 1 plays at 1; a play that throws on one element leaves the others playing', () => {
  const { doc } = page();
  const s = createFilmSound({ doc, fileUrl });
  s.load({ ...FILM.tracks, music: { ...FILM.tracks.music, gain: 4 } });
  const [a, , music] = s._elements();
  s.onTime(at(0.1));
  assert.equal(r6(music.volume), 0.8, 'fading in');
  assert.doesNotThrow(() => s.onTime(at(5)));
  assert.equal(music.volume, 1);
  s.onTime(at(5.2, false));
  a.play = () => { throw new Error('no'); };
  assert.doesNotThrow(() => s.onTime(at(1)));
  assert.deepEqual([a.paused, music.paused, music.volume], [true, false, 1]);
  s.load({ clips: [], music: { file: 'm.mp3', seconds: 8, gain: Number.NaN } });
  assert.doesNotThrow(() => s.onTime(at(3)));
  assert.deepEqual([s._elements()[0].paused, s._elements()[0].volume], [false, 1], 'a volume that is not a number is not set; the music still plays');
});

test('F3: mute is kept for the browser; silence, destroy and no sound at all', () => {
  const { win, doc } = page();
  const s = createFilmSound({ doc, fileUrl });
  assert.equal(s.isMuted(), false);
  s.load(FILM.tracks);
  s.setMuted(true);
  assert.ok(s._elements().every((el) => el.muted === true));
  assert.equal(win.localStorage['worca.design.mute'], '1');
  const next = createFilmSound({ doc, fileUrl });
  assert.equal(next.isMuted(), true);
  next.load(FILM.tracks);
  assert.ok(next._elements().every((el) => el.muted === true), 'a new player starts muted');
  s.setMuted(false);
  assert.equal(win.localStorage['worca.design.mute'], '0');
  assert.ok(s._elements().every((el) => el.muted === false));
  s.onTime(at(1));
  const els = s._elements();
  assert.deepEqual(els.map((el) => el.paused), [false, true, false]);
  s.silence();
  assert.ok(els.every((el) => el.paused));
  s.onTime(at(1));
  s.destroy();
  assert.deepEqual(s._elements(), []);
  assert.ok(els.every((el) => el.paused && el.getAttribute('src') === null));
  s.load(FILM.tracks);
  assert.deepEqual([s.hasSound(), s._elements()], [false, []], 'a destroyed player loads nothing');
  const none = createFilmSound({ doc, fileUrl });
  none.load(null);
  assert.equal(none.hasSound(), false);
  none.onTime(at(1));
  none.load({ clips: [], music: null });
  assert.deepEqual([none.hasSound(), none._elements()], [false, []]);
  const stored = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  Object.defineProperty(win, 'localStorage', { configurable: true, get: () => stored });
  const locked = createFilmSound({ doc, fileUrl });
  assert.doesNotThrow(() => locked.setMuted(true), 'storage that throws');
  assert.equal(locked.isMuted(), true);
});

test('F4: unlock plays then pauses each element once, skips a playing one and goes on past a throw', () => {
  const { doc, calls } = page();
  const s = createFilmSound({ doc, fileUrl });
  s.load(FILM.tracks);
  const els = s._elements();
  const seen = () => calls.splice(0).map(([name, el]) => [name, els.indexOf(el)]);
  s.onTime(at(1));
  seen();
  s.unlock();
  assert.deepEqual(seen(), [['play', 1], ['pause', 1]], 'clip a and the music play already: only clip b');
  s.silence();
  seen();
  s.unlock();
  assert.deepEqual(seen(), [['play', 0], ['pause', 0], ['play', 2], ['pause', 2]], 'clip b was unlocked already');
  s.unlock();
  assert.deepEqual(seen(), [], 'once each');
  const other = createFilmSound({ doc, fileUrl });
  other.load(FILM.tracks);
  const more = other._elements();
  more[0].play = () => { throw new Error('no'); };
  assert.doesNotThrow(() => other.unlock());
  assert.deepEqual(calls.splice(0).map(([name, el]) => [name, more.indexOf(el)]), [['play', 1], ['pause', 1], ['play', 2], ['pause', 2]]);
});

test('F5: a second load pauses and empties the elements of the first', () => {
  const { doc } = page();
  const s = createFilmSound({ doc, fileUrl });
  s.load(FILM.tracks);
  s.onTime(at(1));
  const first = s._elements();
  s.load({ clips: [FILM.tracks.clips[1]], music: null });
  assert.ok(first.every((el) => el.paused && el.getAttribute('src') === null));
  assert.equal(s._elements().length, 1);
  assert.ok(!first.includes(s._elements()[0]));
});
