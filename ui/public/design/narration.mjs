// ui/public/design/narration.mjs — what a build is doing, in sentences, for the Design chat (the stage shows it in
// pictures). Pure: C-5 frames in, `{live, round, phase, lines}` out. `phase` is the one sentence for right now (the
// composer's live line, which names the picture being made, or says the voice and the music are being made); `lines`
// are the round's milestones in the order they happened: the plan, what the sound stage made or why it failed, each
// finished or failed section with the summary its agent wrote, a picture that failed, the hand-over to integration.
// Nothing here is stored: a late joiner's `design-snapshot` rebuilds the lines from the section records and the
// sound stage's last frame.
import { KIND_NOUN, LIVE_BUILD, ON_STAGE, agentAction } from './stage-model.mjs';

const KIND_THING = Object.freeze({ web: 'page', presentation: 'deck', pitch: 'deck', video: 'video', document: 'document' });
const NAMES_MAX = 3;
const PICTURE_STATES = Object.freeze(['making', 'made', 'failed']);
const SOUND_STATES = PICTURE_STATES;
/** The sound stage's lines all have keys starting with this: a drive's frame replaces the last drive's. */
const SOUND_KEY = 'sound';
const isObject = (v) => typeof v === 'object' && v !== null;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const count = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
const scenes = (n) => `${n} scene${n === 1 ? '' : 's'}`;

/** `A`, `A and B`, `A, B and C`, `A, B, C and 4 more`. */
export function nameList(names, max = NAMES_MAX) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}

/** A sentence's end: the summary as written when it already ends one, else with a full stop. */
const sentence = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * @param {{designId: string, kind?: string}} o
 * @returns {{push: (frame: object) => void, view: () => {buildId: string|null, live: boolean, round: number|null,
 *   phase: string, lines: {key: string, text: string, tone: ''|'fail'}[]}}}
 */
export function createBuildNarration({ designId, kind = 'web' } = {}) {
  const thing = KIND_THING[kind] ?? 'page';
  const noun = KIND_NOUN[kind] ?? 'section';
  let buildId = null;
  let status = null;
  let round = null;               // the build's round number, once a frame has said it
  let buildKind = 'first';
  let waiting = 0;
  let making = new Set();         // the pictures in the making, by name, in the order the asks came (the last is the live line's)
  let soundMaking = null;         // the sound stage at work: {music}, until its made or failed frame, or the round stops
  let order = [];                 // plan section ids, in plan order
  let jobs = new Map();           // section id -> its job (the name the Plan list shows)
  let secs = new Map();           // section id -> {status, summary}
  let agents = new Map();         // agent id -> its last `design-agent` fields
  let lines = [];

  function reset(id) {
    buildId = id;
    status = null;
    round = null;
    waiting = 0;
    making = new Set();
    soundMaking = null;
    order = [];
    jobs = new Map();
    secs = new Map();
    agents = new Map();
    lines = [];
  }
  const jobOf = (id) => jobs.get(id) || id;
  function setLine(key, words, tone = '') {
    const line = { key, text: words, tone };
    const at = lines.findIndex((l) => l.key === key);
    if (at >= 0) lines[at] = line; else lines.push(line);
  }
  const dropLine = (key) => { lines = lines.filter((l) => l.key !== key); };

  function planLine() {
    const names = order.filter((id) => secs.get(id)?.status !== 'removed').map(jobOf);
    if (!names.length) return;
    setLine('plan', `${buildKind === 'change' ? 'The plan has' : 'The lead planned'} ${names.length} ${noun}${names.length === 1 ? '' : 's'}: ${nameList(names, 6)}.`);
  }
  function sectionLine(id) {
    const s = secs.get(id);
    if (!s) return;
    const key = `sec:${id}`;
    if (s.status === 'done' && s.fresh) setLine(key, s.summary ? `${jobOf(id)}: ${sentence(s.summary)}` : `${jobOf(id)} is done.`);
    else if (s.status === 'failed') setLine(key, `${jobOf(id)} failed.`, 'fail');
    else if (s.status === 'stopped') setLine(key, `${jobOf(id)} was stopped.`);
    else dropLine(key);
  }
  function takePlan(sections, { fresh }) {
    const list = (Array.isArray(sections) ? sections : []).filter((s) => isObject(s) && typeof s.id === 'string');
    order = list.map((s) => s.id);
    for (const s of list) {
      jobs.set(s.id, text(s.job) || s.id);
      // A section a change round carried over as done is no news; one this round finished is.
      const prev = secs.get(s.id);
      secs.set(s.id, { status: s.status ?? 'planned', summary: text(s.summary), fresh: fresh || Boolean(prev?.fresh) });
    }
    planLine();
    for (const id of order) sectionLine(id);
  }
  const dropSoundLines = () => { lines = lines.filter((l) => !l.key.startsWith(SOUND_KEY)); };
  /** A `design-sound` frame, or a snapshot's `sound` (SPEC §5, §7): each drive's frame replaces the last one's lines.
   *  Making is the live line's; made and failed say how many scenes have their voice, how many grew, and why it failed
   *  (music alone has no sentence). */
  function takeSound(s) {
    if (!isObject(s) || !SOUND_STATES.includes(s.state)) return;
    dropSoundLines();
    if (s.state === 'making') { soundMaking = { music: s.music !== false }; return; }
    soundMaking = null;
    const voiced = isObject(s.voice) ? count(s.voice.made) + count(s.voice.reused) : 0;
    if (voiced) setLine(SOUND_KEY, `The voice is in for ${scenes(voiced)}${s.music === true ? ', with music' : ''}.`);
    const grown = count(s.grown);
    if (grown) setLine(`${SOUND_KEY}-grown`, `${scenes(grown)} got longer so the voice fits.`);
    if (s.state !== 'failed' || !Array.isArray(s.reasons)) return;
    s.reasons.map(text).filter(Boolean).forEach((reason, i) => setLine(`${SOUND_KEY}-fail-${i}`, `Sound: ${reason}`, 'fail'));
  }

  function push(f) {
    if (!isObject(f) || f.designId !== designId || typeof f.buildId !== 'string' || !f.buildId) return;
    if (f.type === 'design-build') {
      if (f.buildId !== buildId) reset(f.buildId);
      if (typeof f.kind === 'string') buildKind = f.kind;
      if (Number.isSafeInteger(f.round)) round = f.round;
      if (f.status === 'integrating' && status !== 'integrating') setLine('integrate', `Every ${noun} is in. Putting the ${thing} together.`);
      const wasLive = LIVE_BUILD.includes(status);
      status = typeof f.status === 'string' ? f.status : status;
      waiting = Number.isSafeInteger(f.waiting) ? f.waiting : 0;
      // An aborted sound stage sends `making` and nothing after; a Continue's drive makes the sound again.
      if (!LIVE_BUILD.includes(status)) soundMaking = null;
      else if (!wasLive) dropSoundLines();
      return;
    }
    if (f.type === 'design-snapshot') {
      reset(f.buildId);
      if (isObject(f.build)) {
        status = typeof f.build.status === 'string' ? f.build.status : null;
        round = Number.isSafeInteger(f.build.round) ? f.build.round : null;
        if (typeof f.build.kind === 'string') buildKind = f.build.kind;
        waiting = Number.isSafeInteger(f.build.waiting) ? f.build.waiting : 0;
      }
      // A first round finished every done section itself; a change round's snapshot cannot tell, so it names none.
      takePlan(f.sections, { fresh: buildKind !== 'change' });
      for (const a of Array.isArray(f.agents) ? f.agents : []) if (isObject(a) && typeof a.agentId === 'string') agents.set(a.agentId, a);
      takeSound(f.sound);
      if (!LIVE_BUILD.includes(status)) soundMaking = null;
      if (status === 'integrating') setLine('integrate', `Every ${noun} is in. Putting the ${thing} together.`);
      return;
    }
    if (f.buildId !== buildId) return;
    if (f.type === 'design-sound') { takeSound(f); return; }
    if (f.type === 'design-plan') { takePlan(f.sections, { fresh: false }); return; }
    if (f.type === 'design-section' && typeof f.sectionId === 'string') {
      const prev = secs.get(f.sectionId);
      secs.set(f.sectionId, { status: f.status, summary: text(f.summary), fresh: f.status === 'done' });
      if (f.status === 'removed' || prev?.status === 'removed') planLine();
      sectionLine(f.sectionId);
      return;
    }
    if (f.type === 'design-agent' && typeof f.agentId === 'string') agents.set(f.agentId, f);
    if (f.type === 'design-picture' && typeof f.name === 'string' && f.name && PICTURE_STATES.includes(f.state)) {
      // A finished ask leaves the live line, with or without its row; a new ask under a name already in the making
      // becomes the last one. A failure is a line of the round in its own words; a picture made under that name ends it.
      making.delete(f.name);
      if (f.state === 'making') making.add(f.name);
      else if (f.state === 'failed') setLine(`pic:${f.name}`, text(f.reason) ? `${f.name}: ${text(f.reason)}` : `${f.name} failed.`, 'fail');
      else dropLine(`pic:${f.name}`);
    }
  }

  function phase() {
    if (!LIVE_BUILD.includes(status)) return '';
    if (waiting > 0) return 'The crew is waiting for your answer';
    if (making.size) return `Making a picture: ${[...making].at(-1)}`;
    if (soundMaking) return soundMaking.music ? 'Making the voice and the music' : 'Making the voice';
    const crew = [...agents.values()].filter((a) => ON_STAGE.includes(a.status));
    if (status === 'integrating') return `Putting the ${thing} together`;
    const builders = crew.filter((a) => a.role === 'builder' && a.status !== 'waiting');
    if (builders.length) {
      const names = [...new Set(builders.map((a) => (a.sectionId ? jobOf(a.sectionId) : text(a.job))).filter(Boolean))];
      const planned = order.filter((id) => secs.get(id)?.status !== 'removed');
      const done = planned.filter((id) => secs.get(id)?.status === 'done').length;
      const count = planned.length ? ` · ${done} of ${planned.length} done` : '';
      return `${builders.length === 1 ? 'One agent is' : `${builders.length} agents are`} working on ${nameList(names) || `the ${thing}`}${count}`;
    }
    const lead = crew.find((a) => a.role === 'lead');
    const doing = lead ? agentAction(lead, null) : '';
    const what = buildKind === 'change' && order.length ? 'working out the change' : `planning the ${thing}`;
    if (doing && doing !== 'Thinking' && doing !== 'Starting') return `The lead is ${what}: ${doing.charAt(0).toLowerCase()}${doing.slice(1)}`;
    return `The lead is ${what}`;
  }

  return {
    push,
    view: () => ({ buildId, live: LIVE_BUILD.includes(status), round, phase: phase(), lines: lines.map((l) => ({ ...l })) }),
  };
}
