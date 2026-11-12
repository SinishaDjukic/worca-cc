// src/core/design/kinds.mjs
// Design P7 (Task 1): the one home of the kind predicates, and the build-mode board style that lays every slide or
// scene out as a scaled 1920×1080 tile in fixed grid tracks (M9). The kit stager, the assembler and the engine read
// the kinds from here. The board's colours are frame data, not stage CSS, so they stay literal.

import { DECK_KINDS } from '../../shared/design-names.mjs';
import { documentCss } from './doc-kind.mjs';

export { DECK_KINDS };

// A Map, so an inherited name such as `constructor` never resolves to a folder.
const KIT_FOLDERS = new Map([['web', 'web'], ['presentation', 'deck'], ['pitch', 'deck'], ['video', 'video'], ['document', 'document']]);
// The kit scripts a kind's doc inlines from `work/.kit/`, in the order they run.
const KIT_SCRIPTS = new Map([
  ['deck', Object.freeze(['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js'])],
  ['video', Object.freeze(['gsap.min.js', 'film.js'])],
]);

/** Whether `kind` is a slide deck (`presentation` or `pitch`). */
export function isDeckKind(kind) {
  return DECK_KINDS.includes(kind);
}

/** Whether `kind` is a film (`video`). */
export function isFilmKind(kind) {
  return kind === 'video';
}

/** Whether `kind` builds as a board of 1920×1080 tiles: a deck or a film. */
export function isBoardKind(kind) {
  return isDeckKind(kind) || isFilmKind(kind);
}

/** Whether `kind` is a long-form document (`document`): it flows like a web page but takes no shell slots. */
export function isDocKind(kind) {
  return kind === 'document';
}

/** Whether the shell places `kind`'s sections in named slots: the web only. Every other kind's sections go to
 *  `<!--worca:sections-->` in plan order. */
export function usesSlots(kind) {
  return kind === 'web';
}

/** Whether the engine stages `kind`'s kit on every drive: a board or a document (the web's comes from the chat). */
export function stagesKitEachDrive(kind) {
  return isBoardKind(kind) || isDocKind(kind);
}

/**
 * The `assets/design-kit/` folder a kind stages, or null for anything that is not a design kind.
 * @param {unknown} kind
 * @returns {'web' | 'deck' | 'video' | 'document' | null}
 */
export function kitFolder(kind) {
  return KIT_FOLDERS.get(kind) ?? null;
}

/**
 * The kit script file names a kind's doc inlines, in order; none for web or an unknown kind. A fresh array per call.
 * @param {unknown} kind
 * @returns {string[]}
 */
export function kitScriptNames(kind) {
  return [...(KIT_SCRIPTS.get(kitFolder(kind)) ?? [])];
}

/** Hides the stage's slides until `deck-stage` is defined, so a deck never shows its slides stacked first. */
const DECK_HEAD = '<style>deck-stage:not(:defined){visibility:hidden}</style>';

/**
 * A film's own style outside `build`: a black 1920×1080 stage that film.js scales to the window and shows once its
 * first frame is drawn, every scene filling it, and the bar a film opened alone draws at the bottom. Frame data, so
 * its colours stay literal.
 */
export const FILM_BASE_CSS = 'html,body{margin:0;height:100%;overflow:hidden;background:#000}'
  + '[data-film]{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden;transform-origin:0 0;background:#000;visibility:hidden}'
  + '[data-scene]{position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;box-sizing:border-box}'
  + '[data-film-bar]{position:fixed;left:0;right:0;bottom:0;height:6px;background:rgba(255,255,255,.18);cursor:pointer}'
  + '[data-film-bar] i{display:block;height:100%;width:0;background:#fff}';

/**
 * What a kind's doc puts first in the `<!--worca:head-->` block outside `build`: a deck hides its stage until it is
 * defined, a film takes FILM_BASE_CSS, a document takes worca's print CSS for its plan's page, title and numbering
 * (first, so the design's own CSS wins at equal specificity); the web, and every `build` doc, put nothing there.
 * Only a document reads `plan`.
 * @param {{ kind: unknown, mode: 'build' | 'run' | 'dist' | 'standalone', plan?: { page?: unknown, numbered?: unknown, title?: unknown }|null }} opts
 * @returns {string}
 */
export function kindHead({ kind, mode, plan } = {}) {
  if (mode === 'build') return '';
  if (isDeckKind(kind)) return DECK_HEAD;
  if (isFilmKind(kind)) return `<style>${FILM_BASE_CSS}</style>`;
  if (isDocKind(kind)) return `<style data-worca-doc>${documentCss({ page: plan?.page, numbered: plan?.numbered === true, title: plan?.title })}</style>`;
  return '';
}

/**
 * The style a thumbnail adds after `staticDoc` drops every script: with no script a deck's `deck-stage` stays
 * undefined and a film unscripted, and `kindHead` hides both until JS runs, so the picture would be blank. A deck shows
 * its stage as a block (its first slide on top), a film its first scene; the web needs nothing.
 * @param {unknown} kind
 * @returns {string}
 */
export function thumbStillCss(kind) {
  if (isDeckKind(kind)) return 'deck-stage:not(:defined){visibility:visible!important;display:block}';
  if (isFilmKind(kind)) return '[data-film]{visibility:visible!important}[data-scene]~[data-scene]{display:none!important}';
  return '';
}

/**
 * The text `<!--worca:sections-->` takes: a deck's slides as the real stage's direct children, its own rail off in
 * `run`, where worca's chrome is the only chrome, and kept in `dist` and `standalone`, which open with no worca
 * around them; a film's scenes as the direct children of `[data-film]`, where film.js finds them. In `build` a deck or
 * a film is the board (M9): the same wrapper marked `data-worca-board`, upgraded by no script, holding the sections
 * comment after the fills, so the bridge's `plan` puts each missing slot on the board (P3's sections anchor). A
 * document's sections follow its contents list `toc` outside `build`; in `build` they keep the sections comment after
 * them, as a board's do, so a round's new slot lands in the shell's sections container in plan order. The web's
 * sections take the fills unchanged. Only a document reads `toc`.
 * @param {{ kind: unknown, mode: 'build' | 'run' | 'dist' | 'standalone', fills: string, toc?: string }} opts
 * @returns {string}
 */
export function wrapFills({ kind, mode, fills, toc = '' } = {}) {
  if (mode === 'build') {
    if (isDeckKind(kind)) return `<deck-stage data-worca-board width="1920" height="1080">${fills}<!--worca:sections--></deck-stage>`;
    if (isFilmKind(kind)) return `<div data-film data-worca-board>${fills}<!--worca:sections--></div>`;
    if (isDocKind(kind)) return `${fills}<!--worca:sections-->`;
    return fills;
  }
  if (isDeckKind(kind)) return `<deck-stage width="1920" height="1080"${mode === 'run' ? ' no-rail' : ''}>\n${fills}\n</deck-stage>`;
  if (isFilmKind(kind)) return `<div data-film>\n${fills}\n</div>`;
  if (isDocKind(kind)) return `${toc}${fills}`;
  return fills;
}

/** `<` as JSON's own escape, so the plan's text can never end the script it sits in. */
const JSON_LT = '\\u003c';

/**
 * The film's first script: `window.FILM_PLAN`, which film.js reads at load. Every plan scene is listed with its
 * duration, included or not, so a scene with no element keeps its window and the parent's timeline stays true
 * (L7.9). Only the run doc is `embedded`: it waits for the parent, while a film opened alone plays (L7.16).
 * @param {{ plan: { canvas?: { w?: number, h?: number, fps?: number }, sections?: { id: string, duration?: number }[] }|null, mode: 'build' | 'run' | 'dist' | 'standalone' }} opts
 * @returns {string}
 */
export function filmPlanScript({ plan, mode } = {}) {
  const canvas = plan?.canvas ?? {};
  const sections = Array.isArray(plan?.sections) ? plan.sections.filter((s) => typeof s?.id === 'string') : [];
  const json = JSON.stringify({
    w: canvas.w, h: canvas.h, fps: canvas.fps, embedded: mode === 'run',
    scenes: sections.map(({ id, duration }) => ({ id, duration })),
  });
  return `window.FILM_PLAN=${json.replace(/</g, () => JSON_LT)};`;
}

/** How a board tile is scaled. R8's probe (tools/spikes/design-board-r8/probe.mjs) decided it; the flip is this one
 *  constant, as the grid tracks are fixed in both modes. */
export const BOARD_SCALE = 'transform';

const S = 'var(--worca-board-s,.178)';
const SCALES = new Map([
  ['transform', `transform:scale(${S})!important;transform-origin:0 0!important;zoom:1!important`],
  ['zoom', `zoom:${S}!important;transform:none!important`],
]);

/**
 * The build-mode board style: every child of `[data-worca-board]` keeps its 1920×1080 box, scaled by
 * `--worca-board-s` into fixed grid tracks; steps and reveals all show, captions hide. The bridge's `board` message
 * sets the `--worca-board-*` variables on the document element.
 * @param {'transform' | 'zoom'} [scale]
 * @returns {string}
 */
export function boardCss(scale = BOARD_SCALE) {
  const scaling = SCALES.get(scale);
  if (!scaling) throw new TypeError(`boardCss: unknown scale ${String(scale)}`);
  return [
    'html,body{margin:0;min-height:100%;overflow-x:hidden;background:var(--worca-board-bg,#101217)}',
    '[data-worca-board]{display:grid!important;position:static!important;box-sizing:border-box;width:auto!important;height:auto!important;'
      + 'visibility:visible!important;opacity:1!important;'
      + 'padding:var(--worca-board-pad,16px) var(--worca-board-pad,16px) var(--worca-board-pad-b,76px);gap:var(--worca-board-gap,12px);'
      + `justify-content:center;align-content:start;grid-template-columns:repeat(var(--worca-board-cols,3),calc(1920px*${S}));`
      + `grid-auto-rows:calc(1080px*${S})}`,
    '[data-worca-board]>*{box-sizing:border-box!important;width:1920px!important;height:1080px!important;margin:0!important;'
      + 'position:relative!important;inset:auto!important;overflow:hidden!important;justify-self:start;align-self:start;'
      + `opacity:1!important;visibility:visible!important;border-radius:calc(var(--worca-board-r,8px)/${S});${scaling}}`,
    '[data-worca-board]>[data-worca-slot]{background:#0B0D11}',
    '[data-worca-board] [data-step],[data-worca-board] [data-deck-anim]{opacity:1!important;visibility:visible!important;animation:none!important}',
    '[data-worca-board] [data-deck-caption]{display:none!important}',
  ].join('\n');
}
