// The film's sound-effect library: the names scenes may cue (kit.js F.SFX — keep both lists identical), how each
// one is generated (ElevenLabs sound-generation prompt, length, variants, leading-silence trim cap) and which
// ones loop to a cue's `dur`. Files live at <promo>/audio/sfx/<name>.mp3, variants <name>-2.mp3 … (mix.mjs
// alternates variants by occurrence).
export const SFX_STYLE = ' Clean isolated single sound effect, no music, no voice, no background noise, soft rounded cartoon UI foley, high quality.';

/** name: { prompt, seconds, variants, maxTrim } */
export const SFX_SPECS = {
  'whoosh': { prompt: 'Soft airy cartoon whoosh, fast swoosh passing by, smooth', seconds: 0.8, variants: 2, maxTrim: 0.6 },
  'whoosh-short': { prompt: 'Very short quick soft whoosh, light air swipe', seconds: 0.5, variants: 2, maxTrim: 0.3 },
  'swoosh-up': { prompt: 'Rising airy swoosh sweeping upward, light and bubbly', seconds: 0.8, variants: 1, maxTrim: 0.55 },
  'swish-down': { prompt: 'Falling soft swish sweeping downward, light and airy', seconds: 0.7, variants: 1, maxTrim: 0.5 },
  'pop': { prompt: 'Soft round bubble pop, cute cartoon pop, mid pitch', seconds: 0.5, variants: 2, maxTrim: 0.25 },
  'pop-high': { prompt: 'Tiny high pitched cute pop, bright little bubble pop', seconds: 0.5, variants: 2, maxTrim: 0.2 },
  'bubble': { prompt: 'Bubbly gloopy water bubble blip, playful, rising', seconds: 0.6, variants: 2, maxTrim: 0.4 },
  'click': { prompt: 'Soft crisp UI mouse click, subtle rounded', seconds: 0.4, variants: 2, maxTrim: 0.12 },
  'tap': { prompt: 'Gentle soft finger tap on a touchscreen, muted rounded tick', seconds: 0.4, variants: 2, maxTrim: 0.1 },
  'type': { prompt: 'Three or four soft keyboard keystrokes typing, gentle mechanical keys, evenly spaced, quiet', seconds: 1.0, variants: 1, maxTrim: 0.9 },
  'boing': { prompt: 'Cartoon spring boing, bouncy rubber twang, playful', seconds: 0.9, variants: 1, maxTrim: 0.8 },
  'thud': { prompt: 'Soft cartoon thud, muffled plush bump on the floor', seconds: 0.6, variants: 1, maxTrim: 0.35 },
  'squash': { prompt: 'Cute squishy squash and stretch sound, rubbery soft squelch', seconds: 0.6, variants: 1, maxTrim: 0.45 },
  'ding': { prompt: 'Single bright glassy bell ding, clean, short', seconds: 1.0, variants: 1, maxTrim: 0.8 },
  'success': { prompt: 'Cheerful success jingle, rising short bright chime arpeggio, game achievement, instrumental', seconds: 1.5, variants: 1, maxTrim: 1.3 },
  'sparkle': { prompt: 'Magical sparkle twinkle glissando, glittery chimes shimmer', seconds: 1.2, variants: 1, maxTrim: 1.0 },
  'stamp': { prompt: 'Rubber stamp thump on paper, soft satisfying stamp', seconds: 0.6, variants: 1, maxTrim: 0.35 },
  'slide': { prompt: 'Smooth soft sliding glide, gentle UI panel slide', seconds: 0.6, variants: 1, maxTrim: 0.45 },
  'zip': { prompt: 'Quick zip whiz, fast light zipping sound passing', seconds: 0.5, variants: 1, maxTrim: 0.35 },
  'tick': { prompt: 'Single tiny soft clock tick, wooden light', seconds: 0.3, variants: 1, maxTrim: 0.1 },
  'step': { prompt: 'Single soft tiny footstep, cute little pat on a floor, light', seconds: 0.4, variants: 2, maxTrim: 0.15 },
  'hop': { prompt: 'Single cute little hop, soft bouncy boing-pop jump', seconds: 0.5, variants: 2, maxTrim: 0.3 },
  'land': { prompt: 'Soft cute landing thump after a hop, small plush land', seconds: 0.5, variants: 2, maxTrim: 0.25 },
  'snore': { prompt: 'Cartoon sleeping snore made by a toy whistle, slow rhythmic wheeze, soft, not human', seconds: 2.2, variants: 1, maxTrim: 2.2 },
  'alarm': { prompt: 'Cute short alarm beeps, three soft digital beeps, playful warning', seconds: 1.0, variants: 1, maxTrim: 0.9 },
  'scratch': { prompt: 'Record scratch, short vinyl scratch stop, cartoon', seconds: 0.6, variants: 1, maxTrim: 0.5 },
  'drumroll': { prompt: 'Light snare drum roll, steady building roll, no final hit', seconds: 2.2, variants: 1, maxTrim: 2.2 },
  'confetti': { prompt: 'Confetti party popper pop with paper streamers fluttering, no cheering', seconds: 1.2, variants: 1, maxTrim: 1.0 },
  'lock': { prompt: 'Cute soft padlock click shut, small metallic clunk and click', seconds: 0.6, variants: 1, maxTrim: 0.4 },
  'buzz': { prompt: 'Soft error buzz, short low gentle denied buzzer, cartoon', seconds: 0.6, variants: 1, maxTrim: 0.45 },
  'cash': { prompt: 'Cartoon cash register ka-ching, bright coin bell', seconds: 1.0, variants: 1, maxTrim: 0.9 },
  'chime': { prompt: 'Warm pleasant finishing chime, two note bell glockenspiel, soft shimmer tail', seconds: 1.4, variants: 1, maxTrim: 1.2 },
  'rise': { prompt: 'Short rising whoosh riser swell building up, airy synth swell', seconds: 1.2, variants: 1, maxTrim: 1.1 },
  'impact': { prompt: 'Soft low cinematic impact boom hit with brief tail, rounded not harsh', seconds: 1.2, variants: 1, maxTrim: 0.9 },
  'wobble': { prompt: 'Wobbly jelly wobble sound, cute wobbling boing oscillation', seconds: 0.9, variants: 1, maxTrim: 0.8 },
  'blip': { prompt: 'Tiny soft electronic blip, cute UI beep, round', seconds: 0.3, variants: 2, maxTrim: 0.15 },
};

/** Every cue-able name, in kit.js F.SFX order. */
export const SFX_NAMES = Object.keys(SFX_SPECS);

/** Kinds cut to the cue's `dur` with a 40 ms crossfade seam. */
export const LOOPED_SFX = ['type', 'drumroll', 'snore'];
