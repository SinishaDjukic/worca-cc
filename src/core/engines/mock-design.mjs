// src/core/engines/mock-design.mjs
// The offline Design roles (SPEC C-3): `design-lead`, `design-builder` and `design-integrate`. runMock dispatches here
// from the SYSTEM PROMPT's `MOCK_ROLE` only, before its writer switch, so these roles stay out of MOCK_WRITER_ROLES and
// text a person typed can never pick one (L2.4). Each process writes the C-2 files under its cwd and streams the raw
// stream-json frames the real CLI sends, in the recorded fixtures' order, so the Claude normalizer yields session,
// usage, toolInput, tool, toolResult and result events. No frame carries `mock: true`: the normalizer reduces such a
// frame to text and drops every tool event. `emit` is mock.mjs's emitRaw, passed in so this file imports nothing from
// mock.mjs (no import cycle). mockAsk's frame helpers are closures bound to its session, so this file has its own.
//
// Prompt tokens (`/\bTOKEN\b/`; `=`-tokens may repeat): the lead reads its prompt; a builder reads its section's
// `brief` in `<cwd>/../../plan.json` (its section id is `basename(cwd)`, never a prompt line, because a resume, rework
// or change prompt names no section); the lead and integrate read cost and rework tokens from their prompt, else from
// `<cwd>/plan.json` `notes`. A once token fires in the first process of its folder only (L2.30), a fresh start after a
// lost session included. The lead's picture tokens run the real picture kit its prompt names, as a lead's shell would.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isBoardKind, isDeckKind, isDocKind, isFilmKind } from '../design/kinds.mjs';

const SECTION_IDS = ['hero', 'features', 'pricing', 'faq', 'team', 'contact', 'cta', 'footer'];
const MAX_SECTIONS = 40;
/** `MOCK_<X>_SECTION=<id>` on the lead's prompt writes `MOCK_<X>` into that section's brief. `ASK_ALWAYS` comes first so
 *  the alternation never stops at `ASK`. */
const SECTION_TOKEN_RE = /\bMOCK_(ASK_ALWAYS|ASK|FAIL|HANG|TOOL_ERROR|RATE_LIMIT|USAGE_LIMIT)_SECTION=([a-z][a-z0-9-]*)/g;
const COST_RE = /\bMOCK_COST=(\d+(?:\.\d+)?)/;
const REWORK_RE = /\bMOCK_REWORK=([a-z][a-z0-9-]*)/g;
const ROUND_ADD_RE = /\bMOCK_ROUND_ADD=([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)/g;
const ROUND_REMOVE_RE = /\bMOCK_ROUND_REMOVE=([a-z][a-z0-9-]*)/g;
/** A video's words (`say`): `MOCK_SAY_LONG=<id>` gives that scene the long words; `MOCK_ROUND_SAY=<id>:<slug>` gives the
 *  round's touch of `<id>` the slug, hyphens as spaces, plus a full stop (an empty slug removes the words). */
const SAY_LONG_RE = /\bMOCK_SAY_LONG=([a-z][a-z0-9-]*)/g;
const ROUND_SAY_RE = /\bMOCK_ROUND_SAY=([a-z][a-z0-9-]*):([a-z0-9-]*)/g;
const SAY_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** 503 characters, 96 words: more than a 4 s scene holds. */
const LONG_SAY = 'These are many words for one short scene. '.repeat(12).trim();
/** The lead's picture asks: `MOCK_PICTURE=<name>:<shape>` is made, `MOCK_PICTURE_FAIL=` is refused (`MOCK_REFUSE` in its
 *  description). `\bMOCK_PICTURE=` never matches the longer tokens. */
const PICTURE_RE = /\bMOCK_PICTURE=([a-z0-9][a-z0-9-]{0,39}):(wide|tall|square)\b/g;
const PICTURE_FAIL_RE = /\bMOCK_PICTURE_FAIL=([a-z0-9][a-z0-9-]{0,39}):(wide|tall|square)\b/g;
/** `--wait-ms <n>` for every run of the kit, inside the command's own range (else ignored, so a typo never ends it 2). */
const PICTURE_WAIT_RE = /\bMOCK_PICTURE_WAIT_MS=(\d{1,6})\b/;
const PICTURE_WAIT_MAX = 100000;
/** ` MOCK_DELAY_MS=<n>` in every description: the mock image service waits that long. */
const PICTURE_DELAY_RE = /\bMOCK_PICTURE_DELAY_MS=(\d{1,5})\b/;
/** The name-alone runs after a `3` (still in the making), at most. */
const PICTURE_WAITS = 20;
/** `MOCK_LOOK=<word>`: the source a document lead writes on brand.md's `Look source:` line (default `worca`). */
const LOOK_RE = /\bMOCK_LOOK=([a-z]+)/;
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
/** Partial-JSON slice width: odd on purpose, so an escape like `\"` is split across two deltas. */
const SLICE = 37;
const PRICED_MODEL = 'claude-sonnet-5-5';
const UNPRICED_MODEL = 'mock';
/** The `.asks` file every mock question writes (C-2 shape: 2 options, no free text). */
const QUESTIONS = { questions: [{ id: 'q1', text: 'Tone?', why: 'mock', options: [{ label: 'Calm', value: 'a' }, { label: 'Bold', value: 'b' }] }] };

/** `${cwd}|${token}` of every once token that already fired. */
const fired = new Set();
/** sessionId -> { totalUsd, role, memo }: the running total a resume continues, and what the session's first process
 *  read from its prompt (a fix, answer or no-more-questions resume names none of it; a resume prompt never names the
 *  question file either). */
const sessions = new Map();

/** Test seam: a resume whose id is in `lost` answers like a CLI that lost the session. `reset()` clears every map. */
export const _testing = {
  lost: new Set(),
  reset() {
    _testing.lost.clear();
    fired.clear();
    sessions.clear();
  },
};

/** The pace between frames: WORCA_MOCK_DESIGN_MS (0 to 5000, read per call so a test can set it), else 0. */
export function mockDesignPaceMs() {
  const n = Number(process.env.WORCA_MOCK_DESIGN_MS);
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? Math.round(n) : 0;
}

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function stopIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/** Resolves after `ms` (the next turn of the loop at 0), or at once when the signal aborts. */
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  if (!ms) return new Promise((r) => setImmediate(r));
  return new Promise((r) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); r(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Never settles until the signal aborts, then rejects with an AbortError (the real CLI killed mid-stream). The caller
 *  checked `signal.aborted` after its last emit; this checks again before it adds the listener. */
function untilAborted(signal) {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

const has = (text, token) => new RegExp(`\\b${token}\\b`).test(text);
const capitalise = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const sectionIdAt = (i) => (i < SECTION_IDS.length ? SECTION_IDS[i] : `s${i + 1}`);
const outputTokens = (text) => Math.ceil(String(text).length / 4);
const newId = (prefix) => `${prefix}_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

/** The value of the first `<label>: <value>` line, absolute against `cwd`, or null. */
function linePath(text, label, cwd) {
  const m = new RegExp(`^[ \\t]*${label}:[ \\t]*(\\S.*?)[ \\t]*$`, 'm').exec(text);
  if (!m) return null;
  return isAbsolute(m[1]) ? m[1] : resolve(cwd, m[1]);
}

function lineKind(text) {
  const m = /^[ \t]*Kind:[ \t]*([a-z]+)[ \t]*$/m.exec(text);
  return m ? m[1] : 'web';
}

/** True the first time this folder sees this token, false ever after. */
function firstTime(cwd, token) {
  const key = `${resolve(cwd)}|${token}`;
  if (fired.has(key)) return false;
  fired.add(key);
  return true;
}

/** The cost tokens of a text, as they are copied: `MOCK_COST=<usd>`, `MOCK_PRICED`, `MOCK_NO_COST`. */
function costTokens(text) {
  const out = [];
  const m = COST_RE.exec(text);
  if (m) out.push(`MOCK_COST=${m[1]}`);
  for (const t of ['MOCK_PRICED', 'MOCK_NO_COST']) if (has(text, t)) out.push(t);
  return out;
}

/** The cost a process reports, from the first text that carries any cost token. */
function costOf(...texts) {
  const text = texts.find((t) => costTokens(t).length) ?? '';
  const m = COST_RE.exec(text);
  return { usd: m ? Number(m[1]) : 0, priced: has(text, 'MOCK_PRICED'), noCost: has(text, 'MOCK_NO_COST') };
}

async function readText(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

async function readJson(path) {
  const text = await readText(path);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

/**
 * One mock CLI process: raw frame builders bound to its session and model, the pace between frames, and the abort
 * check after every emit (an abort can fire synchronously inside any `onEvent` call).
 */
function createProcess({ sessionId, model, cwd, emit, signal }) {
  const base = { parent_tool_use_id: null, session_id: sessionId };
  const stream = (event) => ({ type: 'stream_event', event, ...base });
  const totals = { input_tokens: 0, output_tokens: 0 };
  let turns = 0;

  async function frame(raw) {
    emit(raw);
    stopIfAborted(signal);
    await sleep(mockDesignPaceMs(), signal);
    stopIfAborted(signal);
  }

  const messageStart = (id, usage) => stream({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], usage } });
  const messageDelta = (stopReason, usage) => stream({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage });
  const assistant = (id, content, usage) => ({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content, usage }, ...base });
  const jsonDelta = (partial) => stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: partial } });

  /** `''`, then 37-character slices of the JSON. */
  function partials(json) {
    const out = [''];
    for (let i = 0; i < json.length; i += SLICE) out.push(json.slice(i, i + SLICE));
    return out;
  }

  /** One assistant message carrying one streamed tool call; resolves to its tool_use id once `message_stop` is out. */
  async function toolCall(name, input, outputLen) {
    const id = newId('toolu');
    const msg = newId('msg');
    const start = { input_tokens: 100, output_tokens: 1 };
    const end = { input_tokens: 100, output_tokens: Math.ceil(outputLen / 4) };
    turns += 1;
    totals.input_tokens += end.input_tokens;
    totals.output_tokens += end.output_tokens;
    await frame(messageStart(msg, start));
    await frame(stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {}, caller: { type: 'direct' } } }));
    for (const p of partials(JSON.stringify(input))) await frame(jsonDelta(p));
    await frame(assistant(msg, [{ type: 'tool_use', id, name, input, caller: { type: 'direct' } }], start));
    await frame(stream({ type: 'content_block_stop', index: 0 }));
    await frame(messageDelta('tool_use', end));
    await frame(stream({ type: 'message_stop' }));
    return id;
  }

  async function toolResult(toolUseId, text, isError = false) {
    await frame({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text, ...(isError ? { is_error: true } : {}) }] }, ...base });
  }

  /** A whole-file `Write`: the stream, then the file, then the tool result. */
  async function write(path, content) {
    const existed = (await readText(path)) != null;
    const id = await toolCall('Write', { file_path: path, content }, content.length);
    await writeText(path, content);
    await toolResult(id, existed ? `The file ${path} has been updated successfully.` : `File created successfully at: ${path}`);
  }

  /** A `Write` the CLI refuses: the stream and an error result, no file. */
  async function refusedWrite(path, content) {
    const id = await toolCall('Write', { file_path: path, content }, content.length);
    await toolResult(id, '<tool_use_error>mock: the write was refused</tool_use_error>', true);
  }

  async function read(path) {
    const input = { file_path: path };
    const id = await toolCall('Read', input, JSON.stringify(input).length);
    const text = await readText(path);
    await toolResult(id, text ?? '<tool_use_error>File does not exist.</tool_use_error>', text == null);
    return text;
  }

  /** An `Edit` of the first `oldString`, streamed `old_string` before `new_string`; refused when it is not in the file. */
  async function edit(path, oldString, newString) {
    const input = { file_path: path, old_string: oldString, new_string: newString };
    const id = await toolCall('Edit', input, JSON.stringify(input).length);
    const text = await readText(path);
    if (text == null || !text.includes(oldString)) {
      await toolResult(id, `<tool_use_error>String to replace not found in file.\nString: ${oldString}</tool_use_error>`, true);
      return;
    }
    await writeText(path, text.replace(oldString, () => newString));
    await toolResult(id, `The file ${path} has been updated successfully.`);
  }

  /** The closing text message: its final assistant block is the line the engine keeps as the summary. */
  async function say(text) {
    const msg = newId('msg');
    const start = { input_tokens: 100, output_tokens: 1 };
    const end = { input_tokens: 100, output_tokens: outputTokens(text) };
    turns += 1;
    totals.input_tokens += end.input_tokens;
    totals.output_tokens += end.output_tokens;
    await frame(messageStart(msg, start));
    await frame(stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    await frame(stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
    await frame(assistant(msg, [{ type: 'text', text }], start));
    await frame(stream({ type: 'content_block_stop', index: 0 }));
    await frame(messageDelta('end_turn', end));
    await frame(stream({ type: 'message_stop' }));
  }

  /** `MOCK_HANG`: half of `content` as tool input only (the stream reaches into `content`, so a draft appears), then a
   *  `message_delta`, then the wait: no stop, no tool event, no file. Rejects with an AbortError on the abort. */
  async function hang(path, content) {
    const msg = newId('msg');
    const id = newId('toolu');
    // The closing `"}` dropped: the stream stops inside `content`, every escape whole.
    const half = JSON.stringify({ file_path: path, content: content.slice(0, Math.ceil(content.length / 2)) }).slice(0, -2);
    await frame(messageStart(msg, { input_tokens: 1000, output_tokens: 4 }));
    await frame(stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'Write', input: {}, caller: { type: 'direct' } } }));
    for (const p of partials(half)) await frame(jsonDelta(p));
    await frame(messageDelta(null, { input_tokens: 1000, output_tokens: 500 }));
    return untilAborted(signal);
  }

  const result = (over) => ({
    type: 'result', subtype: 'success', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: turns,
    stop_reason: 'end_turn', session_id: sessionId, usage: { ...totals }, modelUsage: {}, permission_denials: [],
    terminal_reason: 'completed', ...over,
  });

  return {
    init: () => frame({ type: 'system', subtype: 'init', cwd, session_id: sessionId, tools: [...TOOLS], mcp_servers: [], model, permissionMode: 'acceptEdits', uuid: randomUUID() }),
    write, refusedWrite, read, edit, say, hang,
    /** The success `result`; `costUsd` undefined omits `total_cost_usd` (MOCK_NO_COST). */
    finish: (text, costUsd) => frame(result({ result: text, ...(costUsd === undefined ? {} : { total_cost_usd: costUsd }) })),
    /** `MOCK_FAIL`: an error `result`, then the rejection the real CLI's exit 1 gives. */
    async fail(costUsd) {
      await frame(result({
        subtype: 'error_during_execution', is_error: true, errors: ['mock failure'], result: 'mock failure',
        terminal_reason: 'api_error', stop_reason: null, ...(costUsd === undefined ? {} : { total_cost_usd: costUsd }),
      }));
      const err = new Error('claude exited with code 1: mock failure');
      err.errorClass = null;
      throw err;
    },
  };
}

/** A rate or usage limit: the rejection carries its class, which classifyError returns as is. */
function limitError(errorClass) {
  const err = new Error(`claude exited with code 1: mock ${errorClass.replace('_', ' ')}`);
  err.errorClass = errorClass;
  return err;
}

/** Adds this process's cost to the session's running total; undefined when the cost is unknown (MOCK_NO_COST). */
function bookCost(session, cost) {
  if (cost.noCost) return undefined;
  session.totalUsd = Math.round((session.totalUsd + cost.usd) * 1e9) / 1e9;
  return session.totalUsd;
}

/** The bogus-resume shape (`test/fixtures/ask/bogus-resume.jsonl`), then the CLI's exit 1. */
function lostSession(sessionId, emit, signal) {
  const message = `No conversation found with session ID: ${sessionId}`;
  emit({
    type: 'result', subtype: 'error_during_execution', duration_ms: 0, duration_api_ms: 0, is_error: true, num_turns: 0,
    stop_reason: null, session_id: sessionId, total_cost_usd: 0,
    usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    modelUsage: {}, permission_denials: [], errors: [message],
  });
  stopIfAborted(signal);
  throw new Error(`claude exited with code 1: ${message}`);
}

/** What a builder writes: 5 layers, one root carrying `data-section`; a slide's root is a labelled `<section>`, a
 *  scene's a `<div data-scene>` (the board lint's `rootFault`); a document's heading has the id its contents list
 *  links to. */
function sectionHtml(id, job, kind = 'web') {
  if (isDocKind(kind)) return `<section data-section="${id}"><h2 id="${id}-title" class="t">${job}</h2><p>Mock ${id}.</p><div class="grid"><div></div></div></section>`;
  const inner = `<h2 class="t">${job}</h2><p>Mock ${id}.</p><div class="grid"><div></div></div>`;
  if (isFilmKind(kind)) return `<div data-section="${id}" data-scene>${inner}</div>`;
  if (isDeckKind(kind)) return `<section data-section="${id}" data-label="${job}">${inner}</section>`;
  return `<section data-section="${id}">${inner}</section>`;
}

const sectionCss = (id) => `[data-section="${id}"] .t{font-weight:600}\n`;
/** A scene's script: seekable, on the film's timeline only (no clock, no `from`). */
const SCENE_JS = 'S.tl.set(root,{opacity:0},0).to(root,{opacity:1,duration:0.4},0);';
/** The seconds every mock scene lasts. */
const SCENE_SECONDS = 4;

/** The kind-specific fields of a mock plan section or round add: `estHeight` on a web page or a document; on a video,
 *  a `duration` and a script; a deck neither. */
function kindFields(kind) {
  if (isFilmKind(kind)) return { parts: ['html', 'css', 'js'], duration: SCENE_SECONDS };
  if (isBoardKind(kind)) return { parts: ['html', 'css'] };
  if (isDocKind(kind)) return { parts: ['html', 'css'], estHeight: 600 };
  return { parts: ['html', 'css'], estHeight: 600 };
}

/** The canvas of a mock plan: 1440 wide for a web page, the 1920×1080 stage for a deck, at 60 fps for a video. */
function kindCanvas(kind) {
  if (isFilmKind(kind)) return { w: 1920, h: 1080, fps: 60 };
  if (isBoardKind(kind)) return { w: 1920, h: 1080 };
  return { w: 1440 };
}

const TOKENS_CSS = ':root{--ink:#111;--paper:#fff;--accent:#2563eb}\n';
const GLOBAL_CSS = 'body{margin:0;color:var(--ink);background:var(--paper);font-family:system-ui,sans-serif}.grid{display:grid;gap:16px}\n';
/** A document's tokens: worca's look loads its font from assets/worca/, where worca stages it. */
const TOKENS_DOC_CSS = "@font-face{font-family:'Poppins';font-weight:400;src:url(assets/worca/poppins-latin-400-normal.woff2) format('woff2')}\n:root{--ink:#111;--paper:#fff;--accent:#2563eb}\nbody{font-family:'Poppins',system-ui,sans-serif}\n";

/** A document's brand.md: the `Look source:` line first (the `MOCK_LOOK=` word, else `worca`), unless `bad`. */
function brandMd(text, bad) {
  const body = 'Calm and plain. Short paragraphs, real numbers.\n';
  return bad ? `# Brand\n\n${body}` : `Look source: ${(LOOK_RE.exec(text) || [])[1] ?? 'worca'} — mock\n\n${body}`;
}

function shellHtml(slotIds) {
  const slots = slotIds.map((id) => `<div data-worca-slot="${id}"></div>`).join('');
  return `<!doctype html><html><head><!--worca:head--></head><body><main class="grid">${slots}<!--worca:sections--></main><!--worca:foot--></body></html>`;
}

/** A scene's words under `MOCK_SAY`: its position as a word up to ten, as digits after. */
const sceneSay = (i) => `Scene ${i < SAY_WORDS.length ? SAY_WORDS[i] : i + 1} says this in plain words.`;

/** The lead's plan: `MOCK_SECTIONS` sections (default 3), shaped for its kind (`kindFields`, `kindCanvas`). A video's
 *  scenes carry `say` under `MOCK_SAY` (every scene) and `MOCK_SAY_LONG=<id>` (that scene, the long words). */
function leadPlan(text, kind) {
  const n = Math.min(MAX_SECTIONS, Math.max(1, Number((/\bMOCK_SECTIONS=(\d+)/.exec(text) || [])[1] || 3)));
  const perSection = new Map();
  for (const [, token, id] of text.matchAll(SECTION_TOKEN_RE)) {
    if (!perSection.has(id)) perSection.set(id, []);
    perSection.get(id).push(`MOCK_${token}`);
  }
  const cost = costTokens(text);
  const rework = [...text.matchAll(REWORK_RE)].map((m) => `MOCK_REWORK=${m[1]}`);
  const bands = has(text, 'MOCK_BANDS');
  const film = isFilmKind(kind);
  const sayAll = film && has(text, 'MOCK_SAY');
  const sayLong = new Set(film ? [...text.matchAll(SAY_LONG_RE)].map((m) => m[1]) : []);
  const sections = [];
  for (let i = 0; i < n; i += 1) {
    const id = sectionIdAt(i);
    const job = capitalise(id);
    const brief = [`Mock ${job} section.`, ...(perSection.get(id) || []), ...cost].join(' ');
    const say = sayLong.has(id) ? LONG_SAY : sayAll ? sceneSay(i) : null;
    sections.push({ id, job, brief, ...kindFields(kind), ...(bands && i < 2 ? { band: 'Top' } : {}), ...(say ? { say } : {}) });
  }
  const doc = isDocKind(kind) ? { page: 'A4', toc: true } : {};
  return { v: 1, kind, title: 'Mock', canvas: kindCanvas(kind), ...doc, notes: ['Mock plan.', ...cost, ...rework].join(' '), sections };
}

/** The lead's `round.json`: the default touches the first section that stays, with brief `Mock touch`. An add is
 *  shaped for the `kind` of the round's `Kind:` line (a video add needs its `duration`). On a video, each
 *  `MOCK_ROUND_SAY=<id>:<slug>` gives `<id>`'s touch its `say`, merged into a touch of that id or appended with brief
 *  `Mock new words.`; an id the round removes or the plan lacks is skipped (validateRound would refuse the round). */
function leadRound(text, plan, kind) {
  if (has(text, 'MOCK_BAD_ROUND')) return { v: 1, summary: '', touch: [], add: [], remove: [] };
  const ids = Array.isArray(plan?.sections) ? plan.sections.map((s) => s?.id).filter((id) => typeof id === 'string') : [];
  const remove = [...text.matchAll(ROUND_REMOVE_RE)].map((m) => m[1]);
  const cost = costTokens(text);
  const add = [...text.matchAll(ROUND_ADD_RE)].map(([, id, after]) => {
    const job = capitalise(id);
    return { id, job, brief: [`Mock ${job} section.`, ...cost].join(' '), ...kindFields(kind), after };
  });
  const touched = ids.find((id) => !remove.includes(id));
  const touch = touched ? [{ id: touched, brief: 'Mock touch' }] : [];
  if (isFilmKind(kind)) {
    for (const [, id, slug] of text.matchAll(ROUND_SAY_RE)) {
      if (!ids.includes(id) || remove.includes(id)) continue;
      const say = slug ? `${slug.replace(/-/g, ' ')}.` : '';
      const same = touch.find((t) => t.id === id);
      if (same) same.say = say;
      else touch.push({ id, brief: 'Mock new words.', say });
    }
  }
  return { v: 1, summary: 'Mock round', touch, add, remove };
}

/** The lead's memory of its session: a fresh task prompt (a plan or a change round) is read and kept; any other resume
 *  (a plan or round fix, an answer, no more questions, a continue) reuses what the session's first process read. */
function leadMemo(prompt, cwd, session) {
  // The prompt's first line only (leadChangePrompt puts it there): a person's brief may hold such a line too.
  const change = /^\s*Change round:/.test(prompt);
  const planFile = linePath(prompt, 'Plan file', cwd);
  const fresh = change || planFile != null || session.role !== 'design-lead' || !session.memo;
  if (!fresh) return session.memo;
  const memo = {
    text: prompt, kind: lineKind(prompt), change, planFile,
    roundFile: linePath(prompt, 'Round file', cwd), questionFile: linePath(prompt, 'Question file', cwd),
  };
  session.role = 'design-lead';
  session.memo = memo;
  return memo;
}

/** One run of the picture kit, each field one argument: resolves to its exit code (a signal or spawn error's name when
 *  it has none). A run the round's signal ended rejects as the abort, never as a code. */
function runPictureKit(args, cwd, signal) {
  return new Promise((done, fail) => {
    execFile(process.execPath, args, { cwd, signal }, (err) => {
      if (!err) return done(0);
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return fail(abortError());
      return done(err.code ?? err.signal);
    });
  });
}

/**
 * The lead's pictures (`MOCK_PICTURE`, `MOCK_PICTURE_FAIL`), only when the raw prompt names a `Picture kit:` (a plan or
 * change prompt; never a fix, answer or continue). Each name runs once per session, in brief order: the whole ask, then
 * the name alone while the command ends `3`, at most PICTURE_WAITS times. `ok` is false once a picture's last code is
 * neither 0 nor 1, and the pictures after it are not asked.
 * @returns {Promise<{ tail: string, ok: boolean }>} `tail` is ` Pictures: <name> <codes>.` per picture asked.
 */
async function leadPictures({ cwd, prompt, text, sessionId, signal }) {
  const kit = linePath(prompt, 'Picture kit', cwd);
  if (!kit) return { tail: '', ok: true };
  const w = Number((PICTURE_WAIT_RE.exec(text) || [])[1]);
  const wait = w >= 1 && w <= PICTURE_WAIT_MAX ? ['--wait-ms', String(w)] : [];
  const delay = PICTURE_DELAY_RE.exec(text);
  const asks = [
    ...[...text.matchAll(PICTURE_RE)].map((m) => ({ at: m.index, name: m[1], shape: m[2], refuse: false })),
    ...[...text.matchAll(PICTURE_FAIL_RE)].map((m) => ({ at: m.index, name: m[1], shape: m[2], refuse: true })),
  ].sort((a, b) => a.at - b.at);
  let tail = '';
  for (const { name, shape, refuse } of asks) {
    if (!firstTime(cwd, `MOCK_PICTURE=${name}@${sessionId}`)) continue;
    const desc = [`Mock picture of ${name}, no text`, ...(delay ? [`MOCK_DELAY_MS=${Number(delay[1])}`] : []), ...(refuse ? ['MOCK_REFUSE'] : [])].join(' ');
    const codes = [await runPictureKit([kit, ...wait, name, shape, desc], cwd, signal)];
    for (let i = 0; codes.at(-1) === 3 && i < PICTURE_WAITS; i += 1) codes.push(await runPictureKit([kit, ...wait, name], cwd, signal));
    tail += ` Pictures: ${name} ${codes.join(',')}.`;
    if (codes.at(-1) !== 0 && codes.at(-1) !== 1) return { tail, ok: false };
  }
  return { tail, ok: true };
}

async function runLead({ cwd, prompt, sessionId, session, emit, signal }) {
  const memo = leadMemo(prompt, cwd, session);
  const text = memo.text;
  const planPath = memo.planFile ?? join(cwd, 'plan.json');
  const prior = await readJson(join(cwd, 'plan.json'));
  const cost = costOf(text, typeof prior?.notes === 'string' ? prior.notes : '');
  const proc = createProcess({ sessionId, model: cost.priced ? PRICED_MODEL : UNPRICED_MODEL, cwd, emit, signal });
  await proc.init();
  if (has(text, 'MOCK_FAIL_LEAD')) return proc.fail(bookCost(session, cost));
  if (has(text, 'MOCK_HANG_LEAD')) return proc.hang(resolve(cwd, 'tokens.css'), TOKENS_CSS);
  // After the session event (the build sees the lead before the long command) and before any file is written.
  const pictures = await leadPictures({ cwd, prompt, text, sessionId, signal });
  if (!pictures.ok) return proc.fail(bookCost(session, cost));
  let reply;
  if (has(text, 'MOCK_ASK_LEAD') && memo.questionFile && firstTime(cwd, 'MOCK_ASK_LEAD')) {
    await proc.write(memo.questionFile, JSON.stringify(QUESTIONS));
    reply = 'Asked a question.';
  } else if (memo.change) {
    const plan = await readJson(planPath);
    // A document round that names a look rewrites brand.md's Look source line, as the change prompt asks.
    if (isDocKind(memo.kind) && LOOK_RE.test(text)) await proc.write(resolve(cwd, 'brand.md'), brandMd(text, false));
    await proc.write(memo.roundFile ?? resolve(cwd, 'round.json'), `${JSON.stringify(leadRound(text, plan, memo.kind), null, 2)}\n`);
    reply = 'Planned the change round.';
  } else {
    const plan = leadPlan(text, memo.kind);
    // A deck or a video has no shell slots (L7.4): worca wraps its sections in the stage.
    const slots = has(text, 'MOCK_SHELL_SLOTS') && !isBoardKind(memo.kind) ? plan.sections.map((s) => s.id) : [];
    const doc = isDocKind(memo.kind);
    await proc.write(resolve(cwd, 'tokens.css'), doc ? TOKENS_DOC_CSS : TOKENS_CSS);
    await proc.write(resolve(cwd, 'global.css'), GLOBAL_CSS);
    await proc.write(resolve(cwd, 'shell.html'), shellHtml(slots));
    if (doc) {
      const badBrand = has(text, 'MOCK_BAD_BRAND_ALWAYS') || (has(text, 'MOCK_BAD_BRAND') && firstTime(cwd, 'MOCK_BAD_BRAND'));
      await proc.write(resolve(cwd, 'brand.md'), brandMd(text, badBrand));
    }
    const bad = has(text, 'MOCK_BAD_PLAN_ALWAYS') || (has(text, 'MOCK_BAD_PLAN') && firstTime(cwd, 'MOCK_BAD_PLAN'));
    await proc.write(planPath, `${JSON.stringify(bad ? { ...plan, sections: [] } : plan, null, 2)}\n`);
    reply = `Planned ${plan.sections.length} sections.`;
  }
  reply += pictures.tail;
  await proc.say(reply);
  await proc.finish(reply, bookCost(session, cost));
  return { text: reply, exitCode: 0 };
}

async function runBuilder({ cwd, prompt, sessionId, session, emit, signal }) {
  const id = basename(resolve(cwd));
  const plan = await readJson(join(cwd, '..', '..', 'plan.json'));
  const section = Array.isArray(plan?.sections) ? plan.sections.find((s) => s?.id === id) : null;
  const brief = typeof section?.brief === 'string' ? section.brief : '';
  const job = typeof section?.job === 'string' && section.job ? section.job : capitalise(id);
  const kind = typeof plan?.kind === 'string' ? plan.kind : 'web';
  const named = linePath(prompt, 'Question file', cwd);
  if (named) { session.role = 'design-builder'; session.memo = { questionFile: named }; }
  const questionFile = named ?? (session.role === 'design-builder' ? session.memo?.questionFile ?? null : null);
  const cost = costOf(brief);
  const proc = createProcess({ sessionId, model: cost.priced ? PRICED_MODEL : UNPRICED_MODEL, cwd, emit, signal });
  await proc.init();
  if (has(brief, 'MOCK_FAIL') && firstTime(cwd, 'MOCK_FAIL')) return proc.fail(bookCost(session, cost));
  if (has(brief, 'MOCK_RATE_LIMIT') && firstTime(cwd, 'MOCK_RATE_LIMIT')) throw limitError('rate_limit');
  if (has(brief, 'MOCK_USAGE_LIMIT') && firstTime(cwd, 'MOCK_USAGE_LIMIT')) throw limitError('usage_limit');
  const index = resolve(cwd, 'index.html');
  const html = sectionHtml(id, job, kind);
  let reply;
  if (questionFile && (has(brief, 'MOCK_ASK_ALWAYS') || (has(brief, 'MOCK_ASK') && firstTime(cwd, 'MOCK_ASK')))) {
    await proc.write(questionFile, JSON.stringify(QUESTIONS));
    reply = 'Asked a question.';
  } else if (has(brief, 'MOCK_HANG') && firstTime(cwd, 'MOCK_HANG')) {
    return proc.hang(index, html);
  } else if (/^\s*(?:Rework|Change):/.test(prompt)) {
    await proc.read(index);
    await proc.edit(index, `Mock ${id}.`, `Changed ${id}.`);
    reply = `Changed ${id}.`;
  } else {
    if (has(brief, 'MOCK_TOOL_ERROR')) await proc.refusedWrite(index, html);
    await proc.write(index, html);
    await proc.write(resolve(cwd, 'style.css'), sectionCss(id));
    if (isFilmKind(kind) && Array.isArray(section?.parts) && section.parts.includes('js')) await proc.write(resolve(cwd, 'script.js'), SCENE_JS);
    reply = `Built ${id}.`;
  }
  await proc.say(reply);
  await proc.finish(reply, bookCost(session, cost));
  return { text: reply, exitCode: 0 };
}

async function runIntegrate({ cwd, prompt, sessionId, session, emit, signal }) {
  const plan = await readJson(join(cwd, 'plan.json'));
  const notes = typeof plan?.notes === 'string' ? plan.notes : '';
  const cost = costOf(prompt, notes);
  const fromPrompt = [...prompt.matchAll(REWORK_RE)].map((m) => m[1]);
  const ids = fromPrompt.length ? fromPrompt : [...notes.matchAll(REWORK_RE)].map((m) => m[1]);
  const rework = [...new Set(ids)].map((id) => ({ id, why: 'Mock rework' }));
  const proc = createProcess({ sessionId, model: cost.priced ? PRICED_MODEL : UNPRICED_MODEL, cwd, emit, signal });
  await proc.init();
  await proc.write(linePath(prompt, 'Integration file', cwd) ?? resolve(cwd, 'integration.json'), `${JSON.stringify({ v: 1, done: true, rework })}\n`);
  const reply = 'Integrated.';
  await proc.say(reply);
  await proc.finish(reply, bookCost(session, cost));
  return { text: reply, exitCode: 0 };
}

/**
 * One mock Design process. A resume continues its session id and running total; a fresh process starts a new id at 0.
 * @param {{ role: string, cwd: string, prompt?: string, resumeSessionId?: string, onEvent?: Function,
 *   signal?: AbortSignal, emit: (raw: object) => void }} opts
 * @returns {Promise<{ text: string, exitCode: number }>}
 */
export async function runMockDesign({ role, cwd, prompt, resumeSessionId, signal, emit }) {
  stopIfAborted(signal);
  if (resumeSessionId && _testing.lost.has(resumeSessionId)) return lostSession(resumeSessionId, emit, signal);
  const sessionId = resumeSessionId || randomUUID();
  let session = sessions.get(sessionId);
  if (!session) {
    session = { totalUsd: 0, role: null, memo: null };
    sessions.set(sessionId, session);
  }
  const ctx = { cwd: resolve(cwd), prompt: String(prompt ?? ''), sessionId, session, emit, signal };
  if (role === 'design-lead') return runLead(ctx);
  if (role === 'design-builder') return runBuilder(ctx);
  if (role === 'design-integrate') return runIntegrate(ctx);
  const proc = createProcess({ sessionId, model: UNPRICED_MODEL, cwd: ctx.cwd, emit, signal });
  await proc.init();
  const reply = `[mock] no side effects for unknown role ${role}`;
  await proc.say(reply);
  await proc.finish(reply, 0);
  return { text: reply, exitCode: 0 };
}
