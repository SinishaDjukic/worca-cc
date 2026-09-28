// src/core/ask-forms.mjs
// The two host-side gates of an ask form (spec §5).
//
//   GATE 2 (ask time, prepareFormAsk): the agent wrote {form, data}. Resolve the
//     form from its sidecar, cap the data, run P1's checkAskData (the data schema
//     AND "the auto answer for THIS data must pass gate 3"), snapshot every file
//     it references, resolve enumFrom/defaultFrom into a CLOSED answer schema, and
//     hand back the ask the host gates on. A refusal carries the EXACT error list
//     the agent is resumed with — never a throw.
//
//   GATE 3 (answer time, formAnswerValidator): the human sent {values}. Drop the
//     fields `when` hides, strip unknown keys, validate against the RESOLVED
//     answer schema, and hand back {form, version, values}. A refusal carries the
//     error list POST /api/answer returns as 422 — never a throw.
//
// Gate 3 runs off the PERSISTED ask alone (layout + answerSchema): by the time a
// server restart re-runs it, the agent's sidecar may have changed or its plugin
// been removed (§9). Nothing here reads the registry.
import { join } from 'node:path';

import { ASK_LIMITS } from '../shared/forms/catalog.mjs';
import { resolveAnswerSchema } from '../shared/forms/schema.mjs';
import { checkAskData, autoAnswer, collectAnswer, fileRefs } from '../shared/forms/answer.mjs';
import { FORM_SURFACES } from '../shared/forms/form-def.mjs';
import { snapshotAskFiles } from './ask-files.mjs';

/** The snapshot root inside a pipeline dir: <pipelineDir>/ask-files/<askId>/. */
export const ASK_FILES_DIR = 'ask-files';

/** Depth cap for anything that walks a posted value recursively. P1 caps only
 *  normalizeAskBlock (256 levels, form-def.mjs); its validate / collectAnswer /
 *  clone are recursive walkers and native JSON.stringify is one too — on Node 22
 *  a value ~9 000 levels deep throws RangeError out of collectAnswer, on Node 25
 *  it sails through into the DB and onto the socket. So BOTH gates count depth
 *  with a work list (never recursive) BEFORE any recursive step and refuse by
 *  name. Same figure as P1's block cap; it is not an ASK_LIMITS value. */
const MAX_JSON_DEPTH = 256;

/** Is `value` nested deeper than `max` object/array levels? Iterative on purpose. */
function nestsDeeperThan(value, max) {
  const todo = [[value, 0]];
  while (todo.length) {
    const [cur, depth] = todo.pop();
    if (cur === null || typeof cur !== 'object') continue;
    if (depth > max) return true;
    for (const child of Object.values(cur)) todo.push([child, depth + 1]);
  }
  return false;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The ask id, reduced to the token that is BOTH the snapshot dir name and the
 *  file route's `:askId` segment. Deterministic and total: the real ask id is
 *  `questions-x:n_impl:1-r1`, which is neither a legal Windows path segment nor
 *  something a route may take as a path. */
export function askIdToken(id) {
  const token = String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  return token || 'ask';
}

/**
 * Gate 2. Never throws.
 * @param {{agentMeta: object, payload: {form: string, data: unknown},
 *          cwd: string, pipelineDir: string, askId: string}} args
 * @returns {Promise<{ok: true, ask: object, autoValues: object}|{ok: false, errors: Array}>}
 */
export async function prepareFormAsk({ agentMeta, payload, cwd, pipelineDir, askId }) {
  const forms = agentMeta?.ask?.forms || {};
  const id = typeof payload?.form === 'string' ? payload.form.trim() : '';
  const def = Object.hasOwn(forms, id) ? forms[id] : null;
  if (!def) {
    const known = Object.keys(forms);
    return { ok: false, errors: [{ path: 'form', code: 'unknown-field',
      message: `unknown form "${id}" — this agent declares ${known.length ? known.join(', ') : 'none'}` }] };
  }
  const data = payload?.data === undefined ? {} : payload.data;
  // Gate 1 admits only a form with both object schemas; a def grafted past the
  // registry may lack one, and resolveAnswerSchema(undefined) throws. Never throw.
  if (!isObj(def.data) || !isObj(def.answer)) {
    return { ok: false, errors: [{ path: 'form', code: 'unknown-field',
      message: `form "${id}" has no data or answer schema` }] };
  }

  // The caps run FIRST, depth before bytes: a schema walk over a 50 MB blob is
  // the denial of service the byte cap exists to prevent, and JSON.stringify
  // (the byte count itself) is a recursive walker a deep value overflows on
  // Node 22 — the depth count is iterative, so it goes first.
  if (nestsDeeperThan(data, MAX_JSON_DEPTH)) {
    return { ok: false, errors: [{ path: 'data', code: 'too-big',
      message: `data is nested deeper than ${MAX_JSON_DEPTH} levels` }] };
  }
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(data ?? null) ?? 'null', 'utf8');
  } catch {
    return { ok: false, errors: [{ path: 'data', code: 'type', message: 'data must be JSON-serializable' }] };
  }
  if (bytes > ASK_LIMITS.dataBytes) {
    return { ok: false, errors: [{ path: 'data', code: 'too-big',
      message: `data is ${bytes} bytes; the limit is ${ASK_LIMITS.dataBytes}` }] };
  }

  // Ruling X4 / P1 C13: NOT a bare validate(def.data, data). checkAskData also
  // proves that the auto answer built from THIS data passes gate 3 — which is
  // what makes autoAnswer() below total, and D10 ("auto can never produce an
  // invalid answer") true at run time rather than only for `example`. Its error
  // paths are already prefixed `data.` / `answer.`; never prefix them again.
  const shape = checkAskData(def, data);
  if (!shape.ok) return { ok: false, errors: shape.errors };

  const token = askIdToken(askId);
  // ONE fileRefs() call: its result feeds the snapshot AND becomes the envelope's
  // `fileRefs` (ruling X16). Calling P1 twice would let the two arrays disagree,
  // and the renderer's "is this bound value a file?" lookup depends on them
  // lining up index for index.
  const refs = fileRefs(def.data, data);
  const { files, errors } = await snapshotAskFiles({
    refs,
    // Resolution order is the spec's: the node's working tree, then the pipeline
    // dir (§7.1). Both are already absolute.
    roots: [cwd, pipelineDir].filter(Boolean),
    destDir: join(pipelineDir, ASK_FILES_DIR, token),
  });
  if (errors.length) return { ok: false, errors };

  const ask = {
    kind: 'form',
    // The route-safe snapshot token. NOT the question id (ruling X1): the caller
    // keeps that and passes it as `_ask({ id })`; only this ever reaches a URL.
    askId: token,
    form: id,
    version: Number.isInteger(def.version) ? def.version : 1,
    title: typeof def.title === 'string' && def.title.trim() ? def.title.trim() : id,
    // 'any' | 'web' (P1 FORM_SURFACES, C5). P2 never branches on it — it rides the
    // envelope and the persisted ask so P3 and P4 can. An unrecognized value fails
    // safe to 'any', the surface that refuses nothing.
    surface: FORM_SURFACES.includes(def.surface) ? def.surface : 'any',
    data,
    layout: Array.isArray(def.layout) ? def.layout : [],
    // Resolved HERE and stored with the ask, so gate 3 validates against a closed
    // set even after the sidecar changed (§3.1, §9).
    answerSchema: resolveAnswerSchema(def.answer, data),
    // X16: the renderer's file lookup table — every `type:'file'` value's data
    // path, in the same order as `files`. `accept` is dropped: it is a gate-2
    // input, not something any surface renders.
    fileRefs: refs.map((r) => ({ path: r.path, rel: r.rel })),
    files,
  };
  // D10's auto answer travels BESIDE the ask, never inside it: the persisted
  // shape (§9) is exactly `ask` plus `values`.
  return { ok: true, ask, autoValues: autoAnswer(def, data) };
}

/**
 * Gate 3, bound to one resolved ask. The returned validator is what
 * RunHarness._ask hands to `pendingQuestion.validate`; a `{ ok: false }` result
 * keeps the question OPEN and becomes the 422 body.
 * @param {object} ask the resolved (or persisted) ask
 * @returns {(payload: unknown) => {ok: true, payload: object}|{ok: false, errors: Array}}
 */
export function formAnswerValidator(ask) {
  // R1: collectAnswer reads only `def.layout`, so a persisted ask is enough.
  const def = { layout: Array.isArray(ask?.layout) ? ask.layout : [] };
  const schema = ask?.answerSchema || { type: 'object', properties: {} };
  const form = ask?.form;
  const version = ask?.version;
  return (payload) => {
    const raw = payload && typeof payload === 'object' && !Array.isArray(payload)
      && payload.values && typeof payload.values === 'object' && !Array.isArray(payload.values)
      ? payload.values
      : null;
    if (!raw) {
      return { ok: false, errors: [{ path: '', code: 'type', message: 'an answer is { values: { … } }' }] };
    }
    // Depth before collectAnswer: its clone() is a JSON round trip, which a deep
    // value overflows on Node 22 — a RangeError out of answer(), not a 422.
    if (nestsDeeperThan(raw, MAX_JSON_DEPTH)) {
      return { ok: false, errors: [{ path: '', code: 'too-big', message: `values are nested deeper than ${MAX_JSON_DEPTH} levels` }] };
    }
    const { values, errors } = collectAnswer(def, schema, raw);
    if (errors.length) return { ok: false, errors };
    return { ok: true, payload: { form, version, values } };
  };
}

/**
 * The generic question a twice-refused form downgrades to (§5 gate 2). The text
 * is the form's own title — the host adds no prose of its own.
 * @param {{form: string, title?: string}} args
 */
export function downgradeQuestion({ form, title }) {
  const text = typeof title === 'string' && title.trim() ? title.trim() : String(form || 'form');
  return { id: `form-${askIdToken(form)}`, question: text, options: [], allowFreeText: true };
}
