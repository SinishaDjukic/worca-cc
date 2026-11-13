// src/core/design/plan.mjs
// Validators for the files a Design lead writes (SPEC C-2): plan.json, round.json and integration.json.
// Pure: no DB, no disk. Each takes the file's text or the parsed object, never throws, and returns
// `{ ok, errors, <value> }` (L1.8), so P2 can hand the error list back to the lead. The value holds only
// known keys and is null whenever there is an error.

import { DESIGN_KINDS, MAX_SECTIONS, sectionIdProblem } from './ids.mjs';
import { PAGE_SIZES, pageWidth } from './doc-kind.mjs';

/** Placeholder height (px) of a section a web round adds without one (L1.10): a small fine section, not a page band. */
export const DEFAULT_EST_HEIGHT = 240;
/** Most characters a video scene's words (`say`) may hold, once whitespace is folded (SPEC D7). */
export const MAX_SAY = 1500;

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_ERRORS = 20;
const MAX_TITLE = 120;
const MAX_NOTES = 2000;
const MAX_BRIEF = 4000;
const MAX_JOB = 24;
const MAX_BAND = 24;
const MAX_WHY = 1000;
const WEB_MIN_W = 320;
const WEB_MAX_W = 3840;
const MAX_EST_HEIGHT = 20000;
const MAX_DURATION = 600;
const PARTS = Object.freeze(['html', 'css', 'js']);
const STAGE = Object.freeze({ w: 1920, h: 1080 });
const VIDEO_FPS = 60;
const MULTI_LINE = /[\r\n]/;

/**
 * @typedef {{ id: string, job: string, brief: string, parts: string[], estHeight?: number, duration?: number, band?: string, say?: string }} DesignSection
 * @typedef {{ v: 1, kind: string, title: string, canvas: { w: number, h?: number, fps?: number }, page?: 'A4'|'Letter', toc?: boolean, numbered?: boolean, notes: string, sections: DesignSection[] }} DesignPlan
 * @typedef {DesignSection & { after?: string }} DesignRoundAdd
 * @typedef {{ v: 1, summary: string, touch: { id: string, brief: string, say?: string }[], add: DesignRoundAdd[], remove: string[] }} DesignRound
 * @typedef {{ v: 1, done?: boolean, rework: { id: string, why: string }[] }} DesignIntegration
 * @typedef {(message: string) => void} Fail
 */

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** A string holding something besides whitespace, at most `max` characters long. */
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const quote = (v) => JSON.stringify(String(v));

/**
 * Parses the input, runs `check` on the object, and caps the errors. Never throws.
 * @param {string} file the file name the messages use
 * @param {unknown} json
 * @param {(raw: object, fail: Fail) => object} check
 */
function run(file, json, check) {
  const errors = [];
  /** @type {Fail} */
  const fail = (message) => { if (errors.length < MAX_ERRORS) errors.push(message); };
  let value = null;
  try {
    const raw = readObject(file, json, fail);
    if (raw) value = check(raw, fail);
  } catch (err) {
    fail(`${file} could not be read${err instanceof Error ? `: ${err.message}` : ''}`);
  }
  return errors.length === 0 ? { ok: true, errors, value } : { ok: false, errors, value: null };
}

/** Text (at most 1 MiB, a leading BOM dropped) is parsed as JSON; the result must be an object. */
function readObject(file, json, fail) {
  let value = json;
  if (typeof json === 'string') {
    if (json.length > MAX_TEXT_BYTES || Buffer.byteLength(json, 'utf8') > MAX_TEXT_BYTES) {
      fail(`${file} is larger than 1 MiB`);
      return null;
    }
    const text = json.charCodeAt(0) === 0xfeff ? json.slice(1) : json;
    try {
      value = JSON.parse(text);
    } catch (err) {
      fail(`${file} is not valid JSON: ${err.message}`);
      return null;
    }
  }
  if (!isRecord(value)) {
    fail(`${file} must be a JSON object`);
    return null;
  }
  return value;
}

/** An absent list (undefined or null) is empty. */
function readList(value, name, fail) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  fail(`${name} must be an array`);
  return [];
}

/** The current plan's kind and section ids, or null when `plan` has no sections list. */
function planFacts(plan) {
  if (!isRecord(plan) || !Array.isArray(plan.sections)) return null;
  const ids = new Set();
  for (const s of plan.sections) if (isRecord(s) && typeof s.id === 'string') ids.add(s.id);
  return { kind: plan.kind, ids };
}

function checkParts(parts, label, fail) {
  if (!Array.isArray(parts)) {
    fail(`${label}: parts must be an array of ${PARTS.join(', ')}`);
    return;
  }
  const seen = new Set();
  for (const part of parts) {
    if (!PARTS.includes(part)) fail(`${label}: parts may hold only ${PARTS.join(', ')}, not ${quote(part)}`);
    else if (seen.has(part)) fail(`${label}: parts lists ${quote(part)} twice`);
    seen.add(part);
  }
  if (!seen.has('html')) fail(`${label}: parts must include html`);
}

/**
 * A video scene's words: runs of whitespace (line breaks too) folded to one space, then trimmed. Returns the text,
 * '' when nothing is left, or null after a failure (not a string, or longer than MAX_SAY once folded).
 * @param {unknown} value
 * @param {string} label
 * @param {Fail} fail
 * @returns {string|null}
 */
function readSay(value, label, fail) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : null;
  if (text === null || text.length > MAX_SAY) {
    fail(`${label}: say must be text of at most ${MAX_SAY} characters`);
    return null;
  }
  return text;
}

/**
 * The fields a plan section and a round `add` share. `estHeight` is read on web and document only and `duration`
 * and `say` on video only (`say` folded by `readSay`; empty, null or absent leaves no key); a document's parts hold
 * no `js`. `band` is kept, trimmed, only when given (null reads as absent); no other rule reads it.
 * @param {object} raw
 * @param {unknown} kind the plan's kind
 * @param {string} label names the section in messages
 * @param {Fail} fail
 * @param {number} [estHeightDefault] used on web or a document when `estHeight` is absent; without it `estHeight` is required
 */
function readFields(raw, kind, label, fail, estHeightDefault) {
  const out = { job: raw.job, brief: raw.brief, parts: Array.isArray(raw.parts) ? [...raw.parts] : raw.parts };
  if (!isText(raw.job, MAX_JOB)) fail(`${label}: job must be a string of 1 to ${MAX_JOB} characters`);
  else if (MULTI_LINE.test(raw.job)) fail(`${label}: job must be on one line`);
  if (!isText(raw.brief, MAX_BRIEF)) fail(`${label}: brief must be a string of 1 to ${MAX_BRIEF} characters`);
  checkParts(raw.parts, label, fail);
  if (kind === 'document' && Array.isArray(raw.parts) && raw.parts.includes('js')) {
    fail(`${label}: a document runs no script, so parts are html and css`);
  }
  if (kind === 'web' || kind === 'document') {
    const h = raw.estHeight == null && estHeightDefault !== undefined ? estHeightDefault : raw.estHeight;
    if (!Number.isFinite(h) || h <= 0 || h > MAX_EST_HEIGHT) {
      fail(`${label}: estHeight must be a number of px above 0 and at most ${MAX_EST_HEIGHT}`);
    } else {
      out.estHeight = Math.max(1, Math.round(h));
    }
  }
  if (kind === 'video') {
    const d = raw.duration;
    if (!Number.isFinite(d) || d <= 0 || d > MAX_DURATION) {
      fail(`${label}: duration must be a number of seconds above 0 and at most ${MAX_DURATION}`);
    } else {
      out.duration = d;
    }
    if (raw.say != null) {
      const say = readSay(raw.say, label, fail);
      if (say) out.say = say;
    }
  }
  if (raw.band != null) {
    const band = typeof raw.band === 'string' ? raw.band.trim() : '';
    if (band === '' || band.length > MAX_BAND || MULTI_LINE.test(band)) {
      fail(`${label}: band must be one line of 1 to ${MAX_BAND} characters`);
    } else {
      out.band = band;
    }
  }
  return out;
}

/** The plan's canvas. A document's is worca's, from its page: any canvas the lead wrote is ignored. */
function readCanvas(canvas, kind, fail, page) {
  if (kind === 'document') return { w: pageWidth(page) };
  const c = isRecord(canvas) ? canvas : {};
  if (kind === 'web') {
    if (!Number.isInteger(c.w) || c.w < WEB_MIN_W || c.w > WEB_MAX_W) {
      fail(`canvas.w must be an integer from ${WEB_MIN_W} to ${WEB_MAX_W}`);
    }
    return { w: c.w };
  }
  if (c.w !== STAGE.w || c.h !== STAGE.h) fail(`canvas must be {w:${STAGE.w},h:${STAGE.h}} for a ${kind}`);
  if (kind !== 'video') return { w: STAGE.w, h: STAGE.h };
  if (c.fps !== VIDEO_FPS) fail(`canvas.fps must be ${VIDEO_FPS} for a video`);
  return { w: STAGE.w, h: STAGE.h, fps: VIDEO_FPS };
}

function readSections(list, kind, fail) {
  if (!Array.isArray(list)) {
    fail('sections must be an array of at least one section');
    return [];
  }
  if (list.length === 0) fail('the plan needs at least one section');
  if (list.length > MAX_SECTIONS) {
    fail(`the plan has ${list.length} sections; it may have at most ${MAX_SECTIONS} sections`);
  }
  const seen = new Set();
  return list.map((raw, i) => {
    if (!isRecord(raw)) {
      fail(`sections[${i}] must be an object`);
      return null;
    }
    const problem = sectionIdProblem(raw.id);
    if (problem) fail(problem);
    else if (seen.has(raw.id)) fail(`duplicate section id ${quote(raw.id)}`);
    else seen.add(raw.id);
    const label = problem ? `sections[${i}]` : `section ${quote(raw.id)}`;
    return { id: raw.id, ...readFields(raw, kind, label, fail) };
  });
}

/** A document's own plan keys: `page` is required, `toc` defaults to true and `numbered` to false. */
function readDocFields(raw, fail) {
  if (typeof raw.page !== 'string' || !Object.hasOwn(PAGE_SIZES, raw.page)) fail('page must be "A4" or "Letter"');
  if (raw.toc != null && typeof raw.toc !== 'boolean') fail('toc must be true or false');
  if (raw.numbered != null && typeof raw.numbered !== 'boolean') fail('numbered must be true or false');
  return { page: raw.page, toc: raw.toc !== false, numbered: raw.numbered === true };
}

/**
 * Checks a lead's plan.json.
 * @param {string|object} json the file's text (a leading BOM is dropped) or the parsed object
 * @param {{ kind?: string }} [opts] `kind`: the design's own kind, which the plan must match
 * @returns {{ ok: boolean, errors: string[], plan: DesignPlan|null }}
 */
export function validatePlan(json, opts) {
  const { ok, errors, value } = run('plan.json', json, (raw, fail) => {
    const want = opts?.kind;
    if (raw.v !== 1) fail('v must be 1');
    const kind = raw.kind;
    const known = DESIGN_KINDS.includes(kind);
    if (!known) fail(`kind must be one of ${DESIGN_KINDS.join(', ')}`);
    else if (want != null && kind !== want) fail(`kind ${quote(kind)} is not this design's kind ${quote(want)}`);
    if (!isText(raw.title, MAX_TITLE)) fail(`title must be a string of 1 to ${MAX_TITLE} characters`);
    const notes = raw.notes == null ? '' : raw.notes;
    if (typeof notes !== 'string' || notes.length > MAX_NOTES) {
      fail(`notes must be a string of at most ${MAX_NOTES} characters`);
    }
    const canvas = known ? readCanvas(raw.canvas, kind, fail, raw.page) : null;
    const doc = kind === 'document' ? readDocFields(raw, fail) : null;
    const sections = readSections(raw.sections, known ? kind : null, fail);
    return doc ? { v: 1, kind, title: raw.title, canvas, ...doc, notes, sections } : { v: 1, kind, title: raw.title, canvas, notes, sections };
  });
  return { ok, errors, plan: value };
}

/**
 * Checks a lead's round.json (change mode) against the current plan.
 * `touch` and `remove` name plan sections, never both for one id. An `add` id is new (not even an id this
 * round removes) and unique; its `after` names a plan section that stays, or one added earlier in `add`.
 * On web or a document an `add` may leave out `estHeight` (DEFAULT_EST_HEIGHT); on video it needs `duration`.
 * On video a `touch` may carry `say`, folded like a section's; `''` stays and removes the words, null or absent keeps them.
 * The plan must still have 1 to MAX_SECTIONS sections after the round.
 * @param {string|object} json the file's text or the parsed object
 * @param {{ plan: object }} opts `plan`: the current plan.json object
 * @returns {{ ok: boolean, errors: string[], round: DesignRound|null }}
 */
export function validateRound(json, opts) {
  const { ok, errors, value } = run('round.json', json, (raw, fail) => {
    const facts = planFacts(opts?.plan);
    if (!facts) {
      fail('round.json needs the current plan to check against');
      return null;
    }
    if (raw.v !== 1) fail('v must be 1');
    if (!isText(raw.summary, Infinity)) fail('summary must be a non-empty string');

    const removed = new Set();
    readList(raw.remove, 'remove', fail).forEach((id, i) => {
      if (typeof id !== 'string') fail(`remove[${i}] must be a section id`);
      else if (!facts.ids.has(id)) fail(`remove: section ${quote(id)} is not in the plan`);
      else if (removed.has(id)) fail(`remove: duplicate section id ${quote(id)}`);
      else removed.add(id);
    });

    const touched = new Set();
    const touch = readList(raw.touch, 'touch', fail).map((t, i) => {
      if (!isRecord(t)) {
        fail(`touch[${i}] must be an object with id and brief`);
        return null;
      }
      let label = `touch[${i}]`;
      if (typeof t.id !== 'string') fail(`${label}: id must be a section id`);
      else if (!facts.ids.has(t.id)) fail(`touch: section ${quote(t.id)} is not in the plan`);
      else if (touched.has(t.id)) fail(`touch: duplicate section id ${quote(t.id)}`);
      else {
        touched.add(t.id);
        label = `touch ${quote(t.id)}`;
        if (removed.has(t.id)) fail(`section ${quote(t.id)} is in both touch and remove`);
      }
      if (!isText(t.brief, MAX_BRIEF)) fail(`${label}: brief must be a string of 1 to ${MAX_BRIEF} characters`);
      const item = { id: t.id, brief: t.brief };
      if (facts.kind === 'video' && t.say != null) {
        const say = readSay(t.say, label, fail);
        if (say !== null) item.say = say;
      }
      return item;
    });

    const added = new Set();
    const addList = readList(raw.add, 'add', fail);
    const add = addList.map((a, i) => {
      if (!isRecord(a)) {
        fail(`add[${i}] must be an object`);
        return null;
      }
      const problem = sectionIdProblem(a.id);
      if (problem) fail(problem);
      else if (facts.ids.has(a.id)) {
        const why = removed.has(a.id) ? ' (an id this round removes cannot be reused)' : '';
        fail(`add: section ${quote(a.id)} already exists in the plan${why}`);
      } else if (added.has(a.id)) fail(`add: duplicate section id ${quote(a.id)}`);
      const label = problem ? `add[${i}]` : `add ${quote(a.id)}`;
      const item = { id: a.id, ...readFields(a, facts.kind, label, fail, DEFAULT_EST_HEIGHT) };
      if (a.after != null) {
        if (typeof a.after !== 'string') fail(`${label}: after must be a section id`);
        else if (removed.has(a.after)) fail(`${label}: after ${quote(a.after)} names a section this round removes`);
        else if (!facts.ids.has(a.after) && !added.has(a.after)) {
          fail(`${label}: after ${quote(a.after)} is not a plan section or one added earlier in this round`);
        }
        item.after = a.after;
      }
      if (!problem && !facts.ids.has(a.id)) added.add(a.id);
      return item;
    });

    const count = facts.ids.size - removed.size + addList.length;
    if (count < 1) fail('after this round the plan would have no sections; it needs at least one section');
    else if (count > MAX_SECTIONS) {
      fail(`after this round the plan would have ${count} sections; it may have at most ${MAX_SECTIONS} sections`);
    }
    return { v: 1, summary: raw.summary, touch, add, remove: [...removed] };
  });
  return { ok, errors, round: value };
}

/**
 * Checks a lead's integration.json against the current plan. `done` is optional and, when given, a boolean
 * (L1.32: the engine reads `rework` only, M10). `rework` defaults to [] and names each plan section once.
 * @param {string|object} json the file's text or the parsed object
 * @param {{ plan: object }} opts `plan`: the current plan.json object
 * @returns {{ ok: boolean, errors: string[], integration: DesignIntegration|null }}
 */
export function validateIntegration(json, opts) {
  const { ok, errors, value } = run('integration.json', json, (raw, fail) => {
    const facts = planFacts(opts?.plan);
    if (!facts) {
      fail('integration.json needs the current plan to check against');
      return null;
    }
    if (raw.v !== 1) fail('v must be 1');
    const out = { v: 1 };
    if (raw.done != null) {
      if (typeof raw.done !== 'boolean') fail('done must be true or false when given');
      out.done = raw.done;
    }
    const seen = new Set();
    out.rework = readList(raw.rework, 'rework', fail).map((r, i) => {
      if (!isRecord(r)) {
        fail(`rework[${i}] must be an object with id and why`);
        return null;
      }
      let label = `rework[${i}]`;
      if (typeof r.id !== 'string') fail(`${label}: id must be a section id`);
      else if (!facts.ids.has(r.id)) fail(`rework: section ${quote(r.id)} is not in the plan`);
      else if (seen.has(r.id)) fail(`rework: duplicate section id ${quote(r.id)}`);
      else {
        seen.add(r.id);
        label = `rework ${quote(r.id)}`;
      }
      if (!isText(r.why, MAX_WHY)) fail(`${label}: why must be a string of 1 to ${MAX_WHY} characters`);
      return { id: r.id, why: r.why };
    });
    return out;
  });
  return { ok, errors, integration: value };
}
