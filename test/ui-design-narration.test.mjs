// test/ui-design-narration.test.mjs — what the round says about its sound (ui/public/design/narration.mjs, SPEC U4 and
// §7): the composer's live line while the voice and the music are made, and the round's lines once they are in or failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuildNarration } from '../ui/public/design/narration.mjs';

const D = 'd_00000000a001';
const B = { designId: D, buildId: 'b_1' };
const build = (status, o = {}) => ({ ...B, type: 'design-build', status, round: 1, kind: 'first', waiting: 0, ...o });
const sound = (state, o = {}) => ({ ...B, type: 'design-sound', state, ...o });
const texts = (n) => n.view().lines.map((l) => l.text);
const soundLines = (n) => n.view().lines.filter((l) => l.key.startsWith('sound')).map((l) => [l.text, l.tone]);
const LEAD = 'The lead is planning the video';

function narration() {
  const n = createBuildNarration({ designId: D, kind: 'video' });
  n.push(build('planning'));
  return n;
}

test('making: the live line reads the making sentence, with the music or the voice alone', () => {
  const n = narration();
  n.push(sound('making', { music: true }));
  assert.equal(n.view().phase, 'Making the voice and the music');
  const alone = narration();
  alone.push(sound('making', { music: false }));
  assert.equal(alone.view().phase, 'Making the voice');
  assert.deepEqual(soundLines(alone), [], 'making writes no line');
});

test('made: the voice line counts made and reused scenes, the grown line follows, and the live line moves on', () => {
  const n = narration();
  n.push(sound('making', { music: true }));
  n.push(sound('made', { voice: { made: 2, reused: 1 }, music: true, grown: 1 }));
  assert.deepEqual(soundLines(n), [['The voice is in for 3 scenes, with music.', ''], ['1 scene got longer so the voice fits.', '']]);
  assert.equal(n.view().phase, LEAD);
  const more = narration();
  more.push(sound('made', { voice: { made: 1, reused: 0 }, music: false, grown: 3 }));
  assert.deepEqual(soundLines(more), [['The voice is in for 1 scene.', ''], ['3 scenes got longer so the voice fits.', '']]);
  const none = narration();
  none.push(sound('making', { music: true }));
  none.push(sound('made', { voice: { made: 0, reused: 0 }, music: true, grown: 0 }));
  assert.deepEqual(soundLines(none), [], 'music alone has no sentence');
  assert.equal(none.view().phase, LEAD);
});

test('failed: the made lines for what it carries, then one red line per reason', () => {
  const n = narration();
  n.push(sound('making', { music: false }));
  n.push(sound('failed', { voice: { made: 1, reused: 0 }, music: false, grown: 0, reasons: ['the ElevenLabs account is out of credits'] }));
  assert.deepEqual(soundLines(n), [['The voice is in for 1 scene.', ''], ['Sound: the ElevenLabs account is out of credits', 'fail']]);
  assert.equal(n.view().phase, LEAD);
  const only = narration();
  only.push(sound('failed', { reasons: ['ElevenLabs is not set up'] }));
  assert.deepEqual(soundLines(only), [['Sound: ElevenLabs is not set up', 'fail']]);
  const two = narration();
  two.push(sound('failed', { voice: { made: 0, reused: 0 }, music: true, reasons: ['ElevenLabs rejected the key', 'ElevenLabs did not answer in time'] }));
  assert.deepEqual(soundLines(two), [['Sound: ElevenLabs rejected the key', 'fail'], ['Sound: ElevenLabs did not answer in time', 'fail']]);
});

test('a later drive replaces the last one\'s sound lines', () => {
  const n = narration();
  n.push(sound('failed', { voice: { made: 1, reused: 0 }, music: true, reasons: ['ElevenLabs rejected the key', 'ElevenLabs could not be reached'] }));
  n.push(sound('made', { voice: { made: 0, reused: 2 }, music: true, grown: 0 }));
  assert.deepEqual(soundLines(n), [['The voice is in for 2 scenes, with music.', '']]);
  // Stop, then Continue: the paused drive's lines go as the round turns live again, before any sound frame.
  n.push(build('paused'));
  n.push(build('building'));
  assert.deepEqual(soundLines(n), []);
  n.push(sound('failed', { voice: { made: 0, reused: 0 }, music: false, reasons: ['ElevenLabs is busy'] }));
  n.push(build('building', { waiting: 0 }));
  assert.deepEqual(soundLines(n), [['Sound: ElevenLabs is busy', 'fail']], 'a frame that keeps the round live keeps them');
  assert.ok(texts(n).every((t) => t !== 'The voice is in for 2 scenes, with music.'));
});

test('an abort sends making and nothing after: the round leaving live ends the making sentence', () => {
  const n = narration();
  n.push(sound('making', { music: true }));
  n.push(build('paused'));
  assert.equal(n.view().phase, '');
  n.push(build('building'));
  assert.notEqual(n.view().phase, 'Making the voice and the music');
  assert.equal(n.view().phase, LEAD);
});

test('a Continue with no lead due: making while the status is already building still reads the making sentence', () => {
  const n = narration();
  n.push(build('building', { kind: 'change' }));
  n.push(sound('making', { music: false }));
  assert.equal(n.view().phase, 'Making the voice');
  n.push(build('building', { kind: 'change', waiting: 0 }));
  assert.equal(n.view().phase, 'Making the voice', 'a frame that keeps the round live keeps it');
});

test('a late joiner\'s snapshot replays the sound the same way', () => {
  const snap = (status, s) => ({ ...B, type: 'design-snapshot', build: { status, round: 1, kind: 'first', waiting: 0 }, sections: [], agents: [], sound: s });
  const n = createBuildNarration({ designId: D, kind: 'video' });
  n.push(snap('building', { state: 'made', voice: { made: 2, reused: 1 }, music: true, grown: 1 }));
  assert.deepEqual(soundLines(n), [['The voice is in for 3 scenes, with music.', ''], ['1 scene got longer so the voice fits.', '']]);
  n.push(snap('building', { state: 'failed', voice: { made: 1, reused: 0 }, music: false, reasons: ['the ElevenLabs account is out of credits'] }));
  assert.deepEqual(soundLines(n), [['The voice is in for 1 scene.', ''], ['Sound: the ElevenLabs account is out of credits', 'fail']]);
  n.push(snap('planning', { state: 'making', music: true }));
  assert.equal(n.view().phase, 'Making the voice and the music');
  n.push(snap('planning', null));
  assert.deepEqual([soundLines(n), n.view().phase], [[], LEAD], 'a snapshot without sound has none');
  // A paused round's snapshot holds no making state: its Continue does not read the sentence.
  n.push(snap('paused', { state: 'making', music: true }));
  n.push(build('building'));
  assert.equal(n.view().phase, LEAD);
});

test('a frame of another build, or an odd one, changes nothing', () => {
  const n = narration();
  n.push(sound('made', { voice: { made: 1, reused: 0 }, music: true }));
  n.push({ ...sound('failed', { reasons: ['x'] }), buildId: 'b_2' });
  n.push({ ...sound('making', { music: true }), designId: 'd_other' });
  n.push(sound('later', { reasons: ['y'] }));
  assert.deepEqual(soundLines(n), [['The voice is in for 1 scene, with music.', '']]);
  n.push(sound('made', { voice: { made: 1, reused: 0 }, music: true, reasons: ['z'] }));
  assert.deepEqual(soundLines(n), [['The voice is in for 1 scene, with music.', '']], 'only a failure has reasons');
  n.push(sound('made', { voice: { made: 2, reused: 0 } }));
  assert.deepEqual(soundLines(n), [['The voice is in for 2 scenes.', '']], 'no music said, none claimed');
  assert.equal(n.view().phase, LEAD);
  n.push(sound('failed', { voice: 'many', grown: 'x', reasons: ['  ', 7, 'ElevenLabs could not be reached'] }));
  assert.deepEqual(soundLines(n), [['Sound: ElevenLabs could not be reached', 'fail']]);
});
