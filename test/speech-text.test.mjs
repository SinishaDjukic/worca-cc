// test/speech-text.test.mjs
// Voice mode's pure helpers: markdown → speakable prose, streaming sentence
// chunking (fences/tables skipped, rewind/divergence never re-speaks), WAV
// encoding, and transcript cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakableText, createSpeechChunker, encodeWav, cleanTranscript, pauseProfile, sentenceUnfinished, fillerOnly, joinTranscripts, DEFAULT_PAUSE_S, UNFINISHED_HOLD_MS, createSpokenFallback, SPOKEN_FALLBACK_LINE } from '../src/shared/speech.mjs';
import { checkRows } from './helpers/rows.mjs';

test('speakableText: strips code/tables/urls/images/markdown; long inline code dropped, short kept', async () => {
  await checkRows([
    { name: 'speakableText strips code, tables, urls, images and markdown syntax', run: () => {
      const md = [
        '# Result',
        'The run **passed** — see [the log](https://x.example/log) or https://x.example/raw.',
        '',
        '```js',
        'const x = 1.5; // not spoken.',
        '```',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '- first item',
        '- second `plan.md` item',
        '![shot](https://x.example/a.png)',
        'Done.',
      ].join('\n');
      assert.equal(speakableText(md), 'Result. The run passed — see the log or. first item. second plan.md item. Done.');
    } },
    { name: 'long inline code is dropped, short inline code is kept', run: () => {
      assert.equal(speakableText('Edit `a.mjs` then run `node --test --test-timeout=300000 test/*.mjs` now.'), 'Edit a.mjs then run now.');
    } },
  ]);
});

test('chunker emits complete sentences as text streams in, never inside a fence', () => {
  const c = createSpeechChunker();
  const said = [];
  let acc = '';
  for (const part of ['Hello there. How', ' are you? I am', ' fine.\n```\nx. y. z.\n', '```\nBye', ' now.']) {
    acc += part;
    said.push(...c.push(acc));
  }
  said.push(...c.push(acc, true));
  assert.deepEqual(said, ['Hello there.', 'How are you?', 'I am fine.', 'Bye now.']);
});

test('chunker waits for a partial line that could open a fence or a table', () => {
  const c = createSpeechChunker();
  assert.deepEqual(c.push('Intro.\n`'), ['Intro.']);
  assert.deepEqual(c.push('Intro.\n``` \ncode. more.\n'), []);
  assert.deepEqual(c.push('Intro.\n``` \ncode. more.\n```\n| a. | b. |\nAfter it. '), ['After it.']);
});

test('chunker: abbreviations/decimals never split, long runs split at a comma, headings and list items end a sentence', async () => {
  await checkRows([
    { name: 'chunker: abbreviations and decimals do not split; long runs split at a comma', run: () => {
      const c = createSpeechChunker({ maxChars: 40 });
      assert.deepEqual(c.push('Use e.g. version 3.5 today. '), ['Use e.g. version 3.5 today.']);
      const long = createSpeechChunker({ maxChars: 40 });
      const out = long.push('alpha beta gamma delta, epsilon zeta eta theta iota kappa', true);
      assert.ok(out.length >= 2 && out.every((s) => s.length <= 40), JSON.stringify(out));
    } },
    { name: 'headings and list items end their own sentence even without punctuation', run: () => {
      const c = createSpeechChunker();
      assert.deepEqual(c.push('## Summary\n- one\n- two\n'), ['Summary.', 'one.', 'two.']);
    } },
  ]);
});

test('chunker: a replay rewind waits, a divergence skips ahead, nothing is spoken twice', () => {
  const c = createSpeechChunker();
  assert.deepEqual(c.push('One. Two. '), ['One.', 'Two.']);
  assert.deepEqual(c.push(''), []);                 // rewind: text restarts
  assert.deepEqual(c.push('One. '), []);            // still a prefix of what was seen
  assert.deepEqual(c.push('One. Two. Three. '), ['Three.']);
  assert.deepEqual(c.push('Different text entirely. '), []); // diverged: realign, do not re-speak
  assert.deepEqual(c.push('Different text entirely. Next. '), ['Next.']);
});

test('encodeWav writes a 16-bit mono PCM RIFF header and clamps samples', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint16(22, true), 1);           // channels
  assert.equal(v.getUint32(24, true), 16000);       // sample rate
  assert.equal(v.getUint16(34, true), 16);          // bits
  assert.equal(v.getUint32(40, true), 8);           // data bytes
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)], [0, 32767, -32768, 32767]);
  assert.equal(wav.length, 52);
});

test('cleanTranscript drops whisper non-speech markers', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] '), '');
  assert.equal(cleanTranscript('(silence) Hello  [ Music ] world '), 'Hello world');
});

test('pauseProfile: setting → finished/unfinished/fixed (S1)', async () => {
  assert.equal(DEFAULT_PAUSE_S, 0.7);
  await checkRows([
    [0.7, [700, 1750, 1200]],
    [0.3, [300, 750, 1200]],
    [2, [2000, 5000, 2000]],
    [5, [5000, 5000, 5000]],
    [undefined, [700, 1750, 1200]],
    [0, [700, 1750, 1200]],
    ['x', [700, 1750, 1200]],
    [9, [5000, 5000, 5000]],
    [0.1, [300, 750, 1200]],
  ].map(([pause, want]) => ({ name: `pauseProfile(${pause})`, run: () => {
    const p = pauseProfile(pause);
    assert.deepEqual([p.finishedMs, p.unfinishedMs, p.fixedMs], want);
    assert.ok(p.unfinishedMs >= p.finishedMs);
  } })));
});

test('sentenceUnfinished: trailing words, trailing punctuation, no end punctuation (S2)', async () => {
  await checkRows([
    ['Show me the runs and', true],
    ['Show me the runs and.', true],
    ['so, um.', true],
    ['I want the,', true],
    ['Let me think...', true],
    ['Let me think…', true],
    ['', true],
    ['mm-hm', true],
    ['Show me the runs.', false],
    ['Is it done?', false],
    ['Stop!', false],
  ].map(([text, want]) => ({ name: `sentenceUnfinished(${JSON.stringify(text)})`, run: () => {
    assert.equal(sentenceUnfinished(text), want);
  } })));
});

test('fillerOnly: backchannel sounds and Whisper noise, not real words (S3)', async () => {
  await checkRows([
    ['Mm-hm.', true],
    ['uh huh', true],
    ['Thank you.', true],
    ['Okay.', true],
    ['', true],
    ['Okay, and the failed ones', false],
    ['the failed ones', false],
  ].map(([text, want]) => ({ name: `fillerOnly(${JSON.stringify(text)})`, run: () => {
    assert.equal(fillerOnly(text), want);
  } })));
});

test('joinTranscripts: one space, a lone period dropped before a lowercase continuation (S4)', async () => {
  await checkRows([
    [['Show me the runs.', 'and the failed ones.'], 'Show me the runs and the failed ones.'],
    [['Is it done?', 'and why'], 'Is it done? and why'],
    [['Wait...', 'no'], 'Wait... no'],
    [['Show me the runs.', 'And more.'], 'Show me the runs. And more.'],
    [['', ' second '], 'second'],
    [[' first ', ''], 'first'],
    [[null, undefined], ''],
  ].map(([[a, b], want]) => ({ name: `joinTranscripts(${JSON.stringify(a)}, ${JSON.stringify(b)})`, run: () => {
    assert.equal(joinTranscripts(a, b), want);
  } })));
});

test('pauseProfile: heldMs is the fixed unfinished-ending hold, never shorter than the finished pause (H1)', async () => {
  assert.equal(UNFINISHED_HOLD_MS, 5000);
  await checkRows([
    [0.7, [700, 1750, 1200, 5000]],
    [undefined, [700, 1750, 1200, 5000]],
    [2, [2000, 5000, 2000, 5000]],
    [5, [5000, 5000, 5000, 5000]],
  ].map(([pause, want]) => ({ name: `pauseProfile(${pause}).heldMs`, run: () => {
    const p = pauseProfile(pause);
    assert.deepEqual([p.finishedMs, p.unfinishedMs, p.fixedMs, p.heldMs], want);
    assert.equal(p.heldMs, Math.max(p.finishedMs, 5000));
  } })));
});

test('sentenceUnfinished: open question words and pairs at the end count whatever the punctuation; a short question is finished', async () => {
  await checkRows([
    ['Do you know how...', true],
    ['how…', true],
    ['so —', true],
    ['and,', true],
    ['Do you know how?', true],
    ['Do you know how.', true],
    ['Can you tell me what', true],
    ['and do you', true],
    ['I wonder whether?', true],
    ['Tell me, could you?', true],
    ['What?', false],
    ['How?', false],
    ['Do you?', false],
    ['Show me the runs.', false],
    ['I know I am.', false],
    ['Is it done?', false],
  ].map(([text, want]) => ({ name: `sentenceUnfinished(${JSON.stringify(text)})`, run: () => {
    assert.equal(sentenceUnfinished(text), want);
  } })));
});

test('createSpokenFallback: at most two sentences within 240 chars, else the short line; lists, code and tables give the line once', async () => {
  const all = (text, opts) => { const f = createSpokenFallback(opts); return [...f.push(text), ...f.push(text, true)]; };
  const long = `${'word '.repeat(60).trim()}.`;
  assert.equal(SPOKEN_FALLBACK_LINE, 'The full answer is on screen.');
  await checkRows([
    { name: 'three sentences give two', run: () => assert.deepEqual(all('One is here. Two is here. Three is here.'), ['One is here.', 'Two is here.']) },
    { name: 'a first sentence over 240 chars gives the line', run: () => assert.deepEqual(all(`${long} Short one.`), [SPOKEN_FALLBACK_LINE]) },
    { name: 'the first fits, the second overflows: one', run: () => assert.deepEqual(all(`Short one. ${'x'.repeat(235)}.`), ['Short one.']) },
    { name: 'a list opening gives the line once', run: () => assert.deepEqual(all('- one\n- two\n'), [SPOKEN_FALLBACK_LINE]) },
    { name: 'a numbered list opening gives the line once', run: () => assert.deepEqual(all('1. First thing.\n2. Second.\n'), [SPOKEN_FALLBACK_LINE]) },
    { name: 'a fence opening gives the line once', run: () => assert.deepEqual(all('```js\nx = 1\n```\nDone.'), [SPOKEN_FALLBACK_LINE]) },
    { name: 'a table opening gives the line once', run: () => assert.deepEqual(all('| a | b |\n|---|---|\n'), [SPOKEN_FALLBACK_LINE]) },
    { name: 'an indented code opening gives the line once', run: () => assert.deepEqual(all('    npm test\nThat runs it.'), [SPOKEN_FALLBACK_LINE]) },
    { name: 'a blank first line is skipped before the check', run: () => assert.deepEqual(all('\n\n- one\n'), [SPOKEN_FALLBACK_LINE]) },
    { name: 'empty gives nothing', run: () => assert.deepEqual(all(''), []) },
    { name: 'nothing more after the cap, even on later pushes', run: () => {
      const f = createSpokenFallback();
      assert.deepEqual(f.push('A one. B two. C three. '), ['A one.', 'B two.']);
      assert.deepEqual(f.push('A one. B two. C three. D four. ', true), []);
    } },
    { name: 'streaming over three pushes gives the same result as one push', run: () => {
      for (const parts of [['One is', ' here. Two is here. Thr', 'ee is here.'], ['1', '. First.\n2', '. Second.\n'], ['`', '``\ncode\n', '```\nAfter.']]) {
        const f = createSpokenFallback();
        const got = [];
        let acc = '';
        for (const p of parts) { acc += p; got.push(...f.push(acc)); }
        got.push(...f.push(acc, true));
        assert.deepEqual(got, all(acc), JSON.stringify(parts));
      }
    } },
  ]);
});
