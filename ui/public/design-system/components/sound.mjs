// The sound Pulse makes (docs/rail/small-rules.md): whether a new event plays, and the chime itself. A short, soft pair of
// notes generated with Web Audio; there is no audio file.

/** The choices of Notifications › Channels › Sound: what plays. Info never does. */
export const SOUND_CHOICES = [
  { id: 'needs', text: 'Play a sound for what needs you', help: 'Only what waits for you: a question, a gate, a watched PR that needs a person' },
  { id: 'problems', text: 'Play a sound for what needs you and problems', help: 'Also what went wrong while nobody was waiting: a failed run, a missed start, a limit' },
  { id: 'none', text: 'Play no sound', help: 'No sound at all' },
];
/** Events closer together than this are one burst, and a burst plays once. */
export const BURST_MS = 3000;
const PLAYS = { needs: ['needs'], problems: ['needs', 'problem'], none: [] };

/**
 * Whether new events play the chime. Pure, so every page answers the same.
 * @param {object} o
 * @param {'needs'|'problems'|'none'} [o.choice]
 * @param {{sev:string}[]} o.events  what just arrived; a burst of them plays one sound
 * @param {boolean} [o.away]         in away hours, or away by the switch: never a sound
 * @param {number} [o.at]            now, in ms
 * @param {number|null} [o.lastAt]   when the last chime played; closer than BURST_MS is the same burst
 * @returns {boolean}
 */
export function soundFor({ choice = 'needs', events, away = false, at = 0, lastAt = null }) {
  if (away || !events.some((e) => (PLAYS[choice] || []).includes(e.sev))) return false;
  return lastAt === null || at - lastAt >= BURST_MS;
}

let shared = null;   // one AudioContext for the page: browsers allow only a few
/**
 * Plays the chime: two soft notes, about a third of a second. Quiet, and no error, when the browser blocks sound before
 * the first click or has no Web Audio.
 * @param {Window} [win]
 * @returns {boolean} whether it was scheduled
 */
export function playChime(win = globalThis) {
  const Ctx = win.AudioContext || win.webkitAudioContext;
  if (!Ctx || win.navigator?.userActivation?.hasBeenActive === false) return false;
  try {
    if (!shared || shared.win !== win) shared = { win, ctx: new Ctx() };
    const { ctx } = shared;
    ctx.resume?.()?.catch?.(() => {});
    [[659.25, 0], [880, 0.14]].forEach(([freq, delay]) => {
      const at = ctx.currentTime + delay, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.07, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(at); osc.stop(at + 0.24);
    });
    return true;
  } catch { return false; }
}
