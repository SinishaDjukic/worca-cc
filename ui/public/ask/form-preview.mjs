// ui/public/ask/form-preview.mjs
// The Agents view previews a DECLARATION, not a run: it has a form def and the
// def's mandatory `example`, and it wants the picture a run would draw. This
// module builds the exact envelope the engine emits for a form ask (P2), so the
// preview goes through renderAskForm unchanged — one renderer, one truth about
// what a form looks like.
//
// Pure by the ui/public module convention: plain objects in, one plain object
// out. No `doc`, no fetch, no listeners. P1 is imported at depth 3 from
// ui/public/ask/, never copied (test/shared-graph-single-source.test.mjs).

import { resolveAnswerSchema } from '../../../src/shared/forms/schema.mjs';
import { fileRefs } from '../../../src/shared/forms/answer.mjs';

/**
 * The P2-shaped ask envelope (ruling X1) a form's own `example` stands for.
 * @param {string} id   the form id (the KEY of ask.forms)
 * @param {object} def  { version, title, surface?, data, answer, layout, example }
 * @returns {object} the same shape `_ask({ kind: 'form', … })` emits
 */
export function previewAskFromDef(id, def) {
  const d = def && typeof def === 'object' && !Array.isArray(def) ? def : {};
  const data = d.example && typeof d.example === 'object' ? d.example : {};
  return {
    // A preview is not a run: there is no question to answer and no ask to serve
    // files from, so `id` and `askId` are inert markers and `files` is EMPTY
    // (ruling X14). The renderer's fileFor() then answers null for every file
    // value in the data and draws the `.af-nofile` tile with its name.
    // `fileRefs` IS built (ruling X16): it is the only thing that tells the
    // renderer a bound value is a file at all. Without it a file-typed example
    // value renders as plain text.
    id: `preview:${id}`,
    askId: `preview:${id}`,
    kind: 'form',
    agent: null,
    nodeId: null,
    executionId: null,
    form: id,
    version: Number.isInteger(d.version) && d.version > 0 ? d.version : 1,
    title: (typeof d.title === 'string' && d.title.trim()) ? d.title : id,
    surface: d.surface === 'web' ? 'web' : 'any',
    data,
    layout: Array.isArray(d.layout) ? d.layout : [],
    answerSchema: resolveAnswerSchema(d.answer || {}, data),
    fileRefs: fileRefs(d.data || {}, data).map(({ path, rel }) => ({ path, rel })),
    files: [],
  };
}

/** The preview's `fileUrl`. Always null: nothing was snapshotted, so the
 *  renderer draws a neutral placeholder tile with the file name instead of a
 *  resource that would 404 in the author's face. */
export function previewFileUrl() {
  return null;
}
