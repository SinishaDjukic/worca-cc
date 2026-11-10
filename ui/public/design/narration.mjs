// ui/public/design/narration.mjs — what a build is doing, in sentences, for the Design chat (the stage shows it in
// pictures). Pure: C-5 frames in, `{live, phase, lines}` out. `phase` is the one sentence for right now (the composer's
// live line); `lines` are the round's milestones in the order they happened: the plan, each finished or failed section
// with the summary its agent wrote, the hand-over to integration. Nothing here is stored: a late joiner's
// `design-snapshot` rebuilds the lines from the section records.
import { KIND_NOUN, LIVE_BUILD, ON_STAGE, agentAction } from './stage-model.mjs';

const KIND_THING = Object.freeze({ web: 'page', presentation: 'deck', pitch: 'deck', video: 'video' });
const NAMES_MAX = 3;
const isObject = (v) => typeof v === 'object' && v !== null;
const text = (v) => (typeof v === 'string' ? v.trim() : '');

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
 * @returns {{push: (frame: object) => void, view: () => {buildId: string|null, live: boolean, phase: string,
 *   lines: {key: string, text: string, tone: ''|'fail'}[]}}}
 */
export function createBuildNarration({ designId, kind = 'web' } = {}) {
  const thing = KIND_THING[kind] ?? 'page';
  const noun = KIND_NOUN[kind] ?? 'section';
  let buildId = null;
  let status = null;
  let buildKind = 'first';
  let waiting = 0;
  let order = [];                 // plan section ids, in plan order
  let jobs = new Map();           // section id -> its job (the name the Plan list shows)
  let secs = new Map();           // section id -> {status, summary}
  let agents = new Map();         // agent id -> its last `design-agent` fields
  let lines = [];

  function reset(id) {
    buildId = id;
    status = null;
    waiting = 0;
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

  function push(f) {
    if (!isObject(f) || f.designId !== designId || typeof f.buildId !== 'string' || !f.buildId) return;
    if (f.type === 'design-build') {
      if (f.buildId !== buildId) reset(f.buildId);
      if (typeof f.kind === 'string') buildKind = f.kind;
      if (f.status === 'integrating' && status !== 'integrating') setLine('integrate', `Every ${noun} is in. Putting the ${thing} together.`);
      status = typeof f.status === 'string' ? f.status : status;
      waiting = Number.isSafeInteger(f.waiting) ? f.waiting : 0;
      return;
    }
    if (f.type === 'design-snapshot') {
      reset(f.buildId);
      if (isObject(f.build)) {
        status = typeof f.build.status === 'string' ? f.build.status : null;
        if (typeof f.build.kind === 'string') buildKind = f.build.kind;
        waiting = Number.isSafeInteger(f.build.waiting) ? f.build.waiting : 0;
      }
      // A first round finished every done section itself; a change round's snapshot cannot tell, so it names none.
      takePlan(f.sections, { fresh: buildKind !== 'change' });
      for (const a of Array.isArray(f.agents) ? f.agents : []) if (isObject(a) && typeof a.agentId === 'string') agents.set(a.agentId, a);
      if (status === 'integrating') setLine('integrate', `Every ${noun} is in. Putting the ${thing} together.`);
      return;
    }
    if (f.buildId !== buildId) return;
    if (f.type === 'design-plan') { takePlan(f.sections, { fresh: false }); return; }
    if (f.type === 'design-section' && typeof f.sectionId === 'string') {
      const prev = secs.get(f.sectionId);
      secs.set(f.sectionId, { status: f.status, summary: text(f.summary), fresh: f.status === 'done' });
      if (f.status === 'removed' || prev?.status === 'removed') planLine();
      sectionLine(f.sectionId);
      return;
    }
    if (f.type === 'design-agent' && typeof f.agentId === 'string') agents.set(f.agentId, f);
  }

  function phase() {
    if (!LIVE_BUILD.includes(status)) return '';
    if (waiting > 0) return 'The crew is waiting for your answer';
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
    view: () => ({ buildId, live: LIVE_BUILD.includes(status), phase: phase(), lines: lines.map((l) => ({ ...l })) }),
  };
}
