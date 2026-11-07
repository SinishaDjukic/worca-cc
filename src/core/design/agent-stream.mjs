// src/core/design/agent-stream.mjs
// One agent process's normalized events (P2 Task 9) turned into draft, meter and status calls. A streamed `Write` or
// `Edit` feeds one incremental reader per tool; its `file_path` names the tool for the stage, and a path a stage draws
// (L2.32) becomes a draft, for a builder only inside its own section (L2.36). The disk is the truth: every result of
// such a tool, ok or error, and the process's end read the file back and land it, so a refused or killed `Write`
// never leaves a half draft. Only the main stream counts: an event with a non-null `parentId` belongs to a sub-agent
// and is ignored.
import { createToolInputReader } from './tool-input.mjs';
import { classifyDraftPath, toWorkRel } from './draft.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
/** The files a process lands at its end even when it never touched them: they may exist from an earlier round. */
const SECTION_FILES = ['index.html', 'style.css', 'script.js'];
const LEAD_FILES = ['tokens.css', 'global.css'];
const SUMMARY_MAX = 200;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const statusFor = (name) => (WRITE_TOOLS.has(name) ? 'writing' : READ_TOOLS.has(name) ? 'reading' : null);
/** Write, Edit and Read name a file; Grep and Glob a folder. */
const inputPath = (input) => (isObj(input) ? (typeof input.file_path === 'string' ? input.file_path : input.path) : undefined);

/** The last non-empty line of `text`, trimmed, at most `SUMMARY_MAX` characters and never half a surrogate pair. */
function lastLine(text) {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.length <= SUMMARY_MAX) return line;
    const c = line.charCodeAt(SUMMARY_MAX - 1);
    return line.slice(0, c >= 0xd800 && c <= 0xdbff ? SUMMARY_MAX - 1 : SUMMARY_MAX);
  }
  return '';
}

/**
 * @param {{ agentId: string, role: 'lead'|'builder', sectionId?: string|null, cwd?: string, workDir: string,
 *   realWorkDir?: string, drafts: ReturnType<import('./draft.mjs').createDraftStore>,
 *   meter: ReturnType<import('./cost.mjs').createAgentMeter>, readDisk: (path: string) => string|null,
 *   on?: { status?: (s: string) => void, tool?: (t: {name: string, path: string|null}|null) => void,
 *     file?: (path: string, text: string, rev: number) => void, usage?: () => void, book?: (usd: number|null) => void,
 *     session?: (id: string) => void } }} opts
 * @returns {{ onEvent: (evt: object) => void, finish: () => void, summary: () => string, sawResult: () => boolean,
 *   resultSubtype: () => string|null }}
 *
 * - `on.status` fires on a change only: `writing` (Write, Edit), `reading` (Read, Grep, Glob), `thinking` after a tool
 *   result and on the first model turn, `retrying` on a retry until the next usage.
 * - `on.tool` fires once per tool, as soon as its path is known; `path` is relative to work/ or null, and may be a path
 *   no stage draws or one outside a builder's section. `on.tool(null)` clears it at the tool's result.
 * - A builder drafts and lands only its own `sections/<sectionId>/` files: the write guard (`builderWriteDirs`) refuses
 *   the rest, so a draft of them would show text that never lands (L2.36, U3). The lead drafts every drawn path.
 * - `on.file(path, text, rev)` follows `drafts.landed`: the disk's text (`''` when missing) and the rev it landed at.
 * - A listener that throws never breaks the stream.
 */
export function createAgentStream({ agentId, role, sectionId = null, cwd, workDir, realWorkDir, drafts, meter, readDisk, on = {} }) {
  /** toolUseId -> the reader of a streaming Write or Edit, dropped at its `stop`. */
  const readers = new Map();
  /** toolUseId -> { name, path } once the tool's path is known, streamed or whole. */
  const tools = new Map();
  /** Drawn paths a Write or Edit of this process aimed at, inside its own section or not; `finish` lands the ones
   *  this stream draws. */
  const touched = new Set();
  let status = null;
  let summary = '';
  let sawResult = false;
  let subtype = null;

  const call = (name, ...args) => {
    const fn = on[name];
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch { /* a listener error never breaks the stream */ }
  };
  const read = (path) => {
    try { const text = readDisk(path); return typeof text === 'string' ? text : null; } catch { return null; }
  };
  const setStatus = (s) => { if (s && s !== status) { status = s; call('status', s); } };
  /** A path this stream drafts and lands: one a stage draws, and for a builder one of its own section (L2.36). */
  const draws = (path) => {
    const c = classifyDraftPath(path);
    return !!c && (role !== 'builder' || c.sectionId === sectionId);
  };

  function land(path, text) {
    const t = typeof text === 'string' ? text : '';
    const rev = drafts.landed(path, t);
    call('file', path, t, rev);
  }

  /** Records and reports a tool whose path is now known; returns the path when a stage draws it from this tool. */
  function report(toolUseId, name, filePath) {
    const path = toWorkRel(filePath, { workDir, realWorkDir, cwd });
    if (toolUseId) tools.set(toolUseId, { name, path });
    call('tool', { name, path });
    if (!WRITE_TOOLS.has(name) || !classifyDraftPath(path)) return null;
    touched.add(path);
    return draws(path) ? path : null;
  }

  function toolInput(evt) {
    const id = str(evt.toolUseId);
    if (evt.phase === 'start') {
      setStatus(statusFor(evt.name));
      if (!id || !WRITE_TOOLS.has(evt.name) || readers.has(id) || tools.has(id)) return;
      const name = evt.name;
      readers.set(id, createToolInputReader({
        onField({ field, chunk, done }) {
          if (field !== 'file_path') { drafts.field({ toolUseId: id, field, chunk, done }); return; }
          const path = report(id, name, chunk);
          if (path) drafts.startTool({ toolUseId: id, agentId, name, path });
        },
      }));
      return;
    }
    const reader = id ? readers.get(id) : undefined;
    if (!reader) return;
    if (evt.phase === 'delta') reader.feed(evt.partialJson);
    else if (evt.phase === 'stop') { reader.end(); readers.delete(id); }
  }

  /** Level 2: the whole tool call. A tool already known from its stream adds nothing; the store draws an unstreamed
   *  Write or Edit once. */
  function wholeTool(c) {
    if (!isObj(c) || typeof c.name !== 'string') return;
    setStatus(statusFor(c.name));
    const id = str(c.toolUseId);
    if (id && tools.has(id)) return;
    const path = report(id, c.name, inputPath(c.input));
    if (path) drafts.applyWhole({ toolUseId: id, agentId, name: c.name, path, input: c.input });
  }

  /** Ok or error, the same: the disk says what the tool did. */
  function toolResult(evt) {
    for (const r of Array.isArray(evt.results) ? evt.results : []) {
      const t = isObj(r) && str(r.toolUseId) ? tools.get(r.toolUseId) : undefined;
      if (t && WRITE_TOOLS.has(t.name) && draws(t.path)) land(t.path, read(t.path));
    }
    setStatus('thinking');
    call('tool', null);
  }

  return {
    onEvent(evt) {
      if (!isObj(evt) || evt.parentId != null) return;
      switch (evt.type) {
        case 'toolInput': toolInput(evt); return;
        case 'tool': for (const c of Array.isArray(evt.calls) ? evt.calls : []) wholeTool(c); return;
        case 'toolResult': toolResult(evt); return;
        case 'text':
          // Final assistant text only: the deltas repeat it, and `cli`/`user` text is not the agent's.
          if (evt.from === 'assistant' && evt.delta !== true && typeof evt.text === 'string') {
            const line = lastLine(evt.text);
            if (line) summary = line;
          }
          return;
        case 'usage':
          meter.observe(evt);
          if (status === null || status === 'retrying') setStatus('thinking');
          call('usage');
          return;
        case 'retry': setStatus('retrying'); return;
        case 'session':
          meter.observe(evt);
          if (str(evt.sessionId)) call('session', evt.sessionId);
          return;
        case 'result': {
          sawResult = true;
          subtype = str(evt.subtype);
          const usd = meter.observe(evt);
          call('book', usd ?? null);
          return;
        }
        default:
      }
    },
    /** The process ended: every path it wrote and every expected file on disk lands, so the stage shows the disk.
     *  A touched path that is missing lands `''`; an untouched missing file sends nothing; a builder's touched path
     *  outside its section never lands. */
    finish() {
      const expected = role === 'lead' ? LEAD_FILES : SECTION_FILES.map((f) => `sections/${sectionId}/${f}`);
      for (const path of new Set([...expected, ...touched])) {
        if (!draws(path)) continue;
        const text = read(path);
        if (text === null && !touched.has(path)) continue;
        land(path, text);
      }
    },
    summary: () => summary,
    sawResult: () => sawResult,
    resultSubtype: () => subtype,
  };
}
