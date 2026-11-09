// src/core/design/kind-prompts.mjs
// Design P7 (Task 7): the prompt copy a deck (`presentation`, `pitch`) or a video adds to P2's prompts. On these board
// kinds one section is one slide or one scene on a fixed 1920×1080 canvas (M5, M9), shell slots do not apply (L7.4),
// and worca wraps the sections in the stage. A web page adds nothing here: its text stays P2's, byte for byte.
// prompts.mjs composes these into the system and user prompts; this module imports nothing from it, so no ESM cycle
// can read its top-level constants before they exist.

import { isBoardKind, isDeckKind, isFilmKind } from './kinds.mjs';

const KIT_RULE = 'Read only CONTRACT.md in the kit; the rest is runtime.';

const DECK_LEAD = `One section is one slide, listed in the order they are shown. The crew works in plan order. shell.html holds the three markers and nothing of the slides: worca wraps them in the stage. Canvas {w:1920,h:1080}. No estHeight. job is at most 24 chars and appears on the slide's tile. Ids /^[a-z][a-z0-9-]{0,31}$/, at most 40 sections. ${KIT_RULE}`;
const FILM_LEAD = `One section is one scene, listed in the order they play. Give each a "duration" in seconds; the film is their sum. Canvas {w:1920,h:1080,fps:60}. No estHeight. shell.html holds the three markers and nothing of the scenes: worca wraps them in the stage. job is at most 24 chars and appears on the scene's tile and the timeline. Ids /^[a-z][a-z0-9-]{0,31}$/, at most 40 sections. tokens.css and global.css follow the film rules too: no @keyframes, animation, transition or will-change. ${KIT_RULE}`;

const DECK_BUILDER = `This section is one slide on a fixed 1920×1080 canvas. Root element: <section data-section="<id>" data-label="<job>">. Body text at least 36px, title at least 56px, nothing under 20px, contrast at least 4.5:1, at most 30 words on a live slide. Nothing reaches past the slide's edges: a shape that bleeds off one sits in a wrapper with position:absolute, inset:0 and overflow:hidden, so the slide never grows. Reveals use data-step, motion uses data-deck-anim, and a tagged element has no own animation, transform or clip-path. ${KIT_RULE}`;
const FILM_BUILDER = `This section is one scene on a fixed 1920×1080 canvas. Root element: <div data-section="<id>" data-scene>. index.html is the scene's composed state. script.js runs once with (root, S). Build everything on S.tl and S.onFrame, with S.dur as your length. The film seeks in any order: never setTimeout, setInterval, requestAnimationFrame, Date, performance.now, Math.random, fetch, await, gsap.from, CSS animations or transitions, will-change, video or audio. Initial states with S.tl.set(el, {…}, 0), then .to(). ${KIT_RULE}`;

const DECK_SHAPE = '{"v":1,"kind":"pitch","title":"…","canvas":{"w":1920,"h":1080},"notes":"…","sections":[{"id":"title","job":"Title","brief":"…","parts":["html","css"]}]}';
const FILM_SHAPE = '{"v":1,"kind":"video","title":"…","canvas":{"w":1920,"h":1080,"fps":60},"notes":"…","sections":[{"id":"open","job":"Open","brief":"…","parts":["html","css","js"],"duration":6}]}';

const LEAD_LINES = new Map([
  ['presentation', Object.freeze(['This design is a presentation. Build the argument the brief asks for, one claim per slide.'])],
  ['pitch', Object.freeze(['This design is a pitch deck. The usual arc is problem, why now, product, how it works, traction, market, business model, competition, team, ask. Follow the brief where it differs.'])],
  ['video', Object.freeze(['This design is a video made of HTML and JavaScript, with no sound. Hit the length the brief names within one second.'])],
]);

/** Seconds as a prompt prints them: at most two decimals, so `0.1 + 0.2` reads `0.3`. */
const seconds = (x) => Number(x.toFixed(2));
const durationOf = (s) => (Number.isFinite(s?.duration) ? s.duration : 0);

/**
 * The board lead's shell rule, in place of P2's slot rule: the three markers, no slots and nothing of the slides or
 * scenes. '' for a web page.
 * @param {string} kind
 * @returns {string}
 */
export function boardShellRule(kind) {
  if (!isBoardKind(kind)) return '';
  const unit = isFilmKind(kind) ? 'scene' : 'slide';
  return `Shell rules: a \`<head>\` element, then exactly one \`<!--worca:head-->\` inside \`<head>\`, one \`<!--worca:sections-->\` in \`<body>\` and one \`<!--worca:foot-->\` at the end of \`<body>\`. No slots and nothing of the ${unit}s: worca wraps them in the stage. The assembler refuses a shell that breaks these rules (BAD_SHELL) at the end of a paid round.`;
}

/**
 * The C-2 plan shape a board lead writes, one line. '' for a web page (P2's shape stays in prompts.mjs).
 * @param {string} kind
 * @returns {string}
 */
export function boardPlanShape(kind) {
  if (isDeckKind(kind)) return DECK_SHAPE;
  if (isFilmKind(kind)) return FILM_SHAPE;
  return '';
}

/**
 * The lead's section block for a deck or a video, in place of P2's bands and slots. '' for a web page.
 * @param {string} kind
 * @returns {string}
 */
export function leadKindBlock(kind) {
  if (isDeckKind(kind)) return DECK_LEAD;
  if (isFilmKind(kind)) return FILM_LEAD;
  return '';
}

/**
 * What every builder of a deck or a video is told, appended to P2's builder system prompt. '' for a web page.
 * @param {string} kind
 * @returns {string}
 */
export function builderKindBlock(kind) {
  if (isDeckKind(kind)) return DECK_BUILDER;
  if (isFilmKind(kind)) return FILM_BUILDER;
  return '';
}

/**
 * The lead's first-prompt lines for a kind: what a presentation, a pitch or a video is. None for a web page.
 * @param {string} kind
 * @returns {string[]}
 */
export function leadKindLines(kind) {
  return [...(LEAD_LINES.get(kind) ?? [])];
}

/**
 * A builder's user-prompt lines: its slide's place in the deck, or its scene's window in the film. `section` is found
 * in `plan.sections` by id, never by identity (the engine can pass its own section record); an id not in the plan, or
 * a web page, gives none.
 * @param {{ kind: string, plan: { sections?: object[] } | null | undefined, section: { id?: string } | null | undefined }} opts
 * @returns {string[]}
 */
export function builderKindLines({ kind, plan, section } = {}) {
  if (!isBoardKind(kind) || typeof section?.id !== 'string') return [];
  const list = Array.isArray(plan?.sections) ? plan.sections : [];
  const i = list.findIndex((s) => s?.id === section.id);
  if (i < 0) return [];
  if (isDeckKind(kind)) return [`Slide ${i + 1} of ${list.length}.`];
  const start = list.slice(0, i).reduce((t, s) => t + durationOf(s), 0);
  const own = durationOf(list[i]);
  const total = list.reduce((t, s) => t + durationOf(s), 0);
  return [
    `Scene ${i + 1} of ${list.length}: ${seconds(start)}s to ${seconds(start + own)}s of a ${seconds(total)}s film.`,
    `S.dur is ${seconds(own)}.`,
  ];
}
