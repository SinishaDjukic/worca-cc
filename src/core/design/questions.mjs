// src/core/design/questions.mjs
// Mid-build questions (P2). An agent writes `work/.asks/<agentId>.json` in the C-2 shape and ends its turn (P8: a
// builder that can write only its own folder writes `<section>/.asks/<agentId>.json`, L8.8; `asksFileFor`); the build
// reads it on exit, asks the person through `design-question` (C-5) and resumes that session with the answers. The
// shape is C-2's, never the clarify shape (`normalizeClarify` is not used, M10): at most 8 questions, 2 to 6 options
// each, no free text, at most one option marked `recommended:true`. `readAskFile` never throws; `asksFileFor` throws for
// a bad id, and `removeAskFile` for a path that is not a question file or a removal that fails.

import { randomBytes } from 'node:crypto';
import { closeSync, constants as fsc, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DesignError } from './ids.mjs';
import { asksDir, designRoot, designWorkDir, inWorkFolder, readFolder, removeWorkEntry, sectionDir } from './paths.mjs';

/** Question rounds per agent row (one row per session, L2.1): a lead is answered at most twice in a round, a builder
 *  once; past them, one "no more questions" resume (L2.9). */
export const ASK_ROUNDS = Object.freeze({ lead: 2, builder: 1 });
const MAX_QUESTIONS = 8;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/** A fresh id for one wait on a question: a Continue asks again under a new one (L2.25). */
export function newAskId() { return `as_${randomBytes(4).toString('hex')}`; }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';

/** One option `{label, value}`, `recommended:true` kept only when true; other keys dropped. A string is an error. */
function checkOption(o, where) {
  if (!isObject(o)) return { error: `${where}: an option must be an object {label, value}` };
  if (!filled(o.label)) return { error: `${where}: an option needs a label` };
  if (!filled(o.value)) return { error: `${where}: an option needs a value` };
  const option = { label: o.label.trim(), value: o.value };
  if (o.recommended === true) option.recommended = true;
  return { option };
}

/** One question `{id, text, why, options}`; other keys (the clarify shape's `allowFreeText`) are dropped. */
function checkQuestion(q, i) {
  if (!isObject(q)) return { error: `questions[${i}] must be an object` };
  if (!filled(q.id)) return { error: `questions[${i}] needs an id` };
  const where = `question ${q.id}`;
  if (!filled(q.text)) return { error: `${where} needs a text` };
  if (q.why !== undefined && typeof q.why !== 'string') return { error: `${where}: why must be text` };
  if (!Array.isArray(q.options) || q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
    return { error: `${where}: ${MIN_OPTIONS} to ${MAX_OPTIONS} options` };
  }
  const options = [];
  const values = new Set();
  for (const raw of q.options) {
    const { error, option } = checkOption(raw, where);
    if (error) return { error };
    if (values.has(option.value)) return { error: `${where}: the value ${JSON.stringify(option.value)} is given twice` };
    values.add(option.value);
    options.push(option);
  }
  if (options.filter((o) => o.recommended).length > 1) return { error: `${where}: one recommended option at most` };
  return { question: { id: q.id, text: q.text.trim(), why: typeof q.why === 'string' ? q.why.trim() : '', options } };
}

/**
 * The C-2 question file, as text or parsed JSON.
 * @returns {{ ok: true, questions: object[] } | { ok: false, error: string }} `questions` normalized: only the C-2 keys
 */
export function validateAsk(json) {
  let data = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch { return { ok: false, error: 'the question file is not JSON' }; }
  }
  if (!isObject(data) || !Array.isArray(data.questions)) return { ok: false, error: 'expected {"questions":[…]}' };
  const n = data.questions.length;
  if (n < 1 || n > MAX_QUESTIONS) return { ok: false, error: `1 to ${MAX_QUESTIONS} questions` };
  const questions = [];
  const ids = new Set();
  for (let i = 0; i < n; i++) {
    const { error, question } = checkQuestion(data.questions[i], i);
    if (error) return { ok: false, error };
    if (ids.has(question.id)) return { ok: false, error: `question id ${question.id} is used twice` };
    ids.add(question.id);
    questions.push(question);
  }
  return { ok: true, questions };
}

/**
 * Where agent `agentId` writes its questions: `work/.asks/` on the hook row (Claude's write guard allows it beside the
 * section, L1.4) and for every lead (its cwd is work/); `<section>/.asks/` for a builder on any other row, the only
 * place such an engine can write (L8.8). A missing `row` is the hook row. Throws the paths' `DesignError` for a bad id.
 * @param {{ row?: { confine: string }|null, designId: string, sectionId?: string|null, agentId: string }} opts
 * @returns {string}
 */
export function asksFileFor({ row, designId, sectionId = null, agentId }) {
  const inSection = sectionId != null && Boolean(row) && row.confine !== 'hook';
  return join(inSection ? join(sectionDir(designId, sectionId), '.asks') : asksDir(designId), `${agentId}.json`);
}

/** A question file's path (asksFileFor) as its design, the folders from work/ down to its `.asks`, and its name:
 *  P8 reaches it through those folders held open (paths.mjs), never by path, because work/ is the owner's agents' to
 *  write. Anything else throws `BAD_REQUEST`. */
function askPlace(path) {
  const [designId, work, ...parts] = relative(designRoot(), String(path)).split(sep);
  const file = parts.pop();
  const shape = parts.length === 1 || (parts.length === 3 && parts[0] === 'sections');
  if (work !== 'work' || !shape || parts.at(-1) !== '.asks' || !/^[^.].*\.json$/.test(file ?? '')) {
    throw new DesignError('BAD_REQUEST', `${JSON.stringify(String(path))} is not a question file`);
  }
  return { designId, parts, file };
}

/** What `dir`, a question folder, is: `folder`, `none` (nothing there: an agent may delete its own section `.asks`),
 *  or `other` (a link, a file), never read or written through. Other lstat errors throw. */
function askFolder(dir) {
  try {
    return lstatSync(dir).isDirectory() ? 'folder' : 'other';
  } catch (err) {
    if (err?.code === 'ENOENT') return 'none';
    throw err;
  }
}

/** The file as text: a regular file only, never through a link at its own name and never blocking on a FIFO. */
function readRegular(path) {
  if (!lstatSync(path).isFile()) throw new Error('not a regular file');
  const fd = openSync(path, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * The question file at `path` (`asksFileFor`): null when there is none, its folder included; `{invalid}` when it
 * cannot be read, sits in a folder that is a link or a file, or is not the C-2 shape (the build removes it and judges
 * the agent by its output); else the normalized `{questions}`. Read through its folders held as they are, changing
 * nothing (readFolder): a folder above it that is a link reads as no question, never followed.
 * @param {string} path
 * @returns {{ questions: object[] } | { invalid: string } | null}
 */
export function readAskFile(path) {
  let text;
  try {
    const { designId, parts, file } = askPlace(path);
    const work = designWorkDir(designId);
    const folder = readFolder(work, parts.slice(0, -1), (base) => askFolder(join(base, '.asks')));
    if (folder === null || folder === 'none') return null;
    if (folder === 'other') return { invalid: 'the question folder is not a folder' };
    text = readFolder(work, parts, (asks) => readRegular(join(asks, file)));
    if (text === null) return null;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    return { invalid: `the question file cannot be read: ${err?.message ?? err}` };
  }
  const check = validateAsk(text);
  return check.ok ? { questions: check.questions } : { invalid: check.error };
}

/** Removes the question file at `path`, if any, whatever the agent left at that name (a link goes, never its target),
 *  through its folders held open (inWorkFolder, removeWorkEntry): a folder on the way that is a link or a file (its
 *  `.asks` included) is removed itself, and one swapped for a link meanwhile redirects nothing (P8). Retries for
 *  Windows handles. */
export function removeAskFile(path) {
  const { designId, parts, file } = askPlace(path);
  inWorkFolder(designId, parts, {}, (asks) => removeWorkEntry(designId, asks, file));
}

/**
 * The person's answers to `questions`: an array of `{id, value}`, every question exactly once, each `value` one of
 * that question's option values (no free text).
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAnswers(questions, answers) {
  if (!Array.isArray(answers)) return { ok: false, error: 'answers must be a list of {id, value}' };
  const byId = new Map((questions || []).map((q) => [q.id, q]));
  const seen = new Set();
  for (const a of answers) {
    if (!isObject(a) || typeof a.id !== 'string') return { ok: false, error: 'each answer must be {id, value}' };
    const q = byId.get(a.id);
    if (!q) return { ok: false, error: `no question ${a.id}` };
    if (seen.has(a.id)) return { ok: false, error: `question ${a.id} is answered twice` };
    if (!q.options.some((o) => o.value === a.value)) return { ok: false, error: `question ${a.id}: not one of its options` };
    seen.add(a.id);
  }
  if (seen.size !== byId.size) return { ok: false, error: 'every question needs an answer' };
  return { ok: true };
}
