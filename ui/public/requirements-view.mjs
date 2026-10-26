// ui/public/requirements-view.mjs
// The Requirements page (plans/requirements-design.md §6): the feature specs, and one feature's interview
// and spec. app.js owns routing and the WebSocket; this module owns the host it is given and routes
// through `deps.route(param)` (#requirements/<param>).
//
//   const view = createRequirementsView({ host, subEl, msgEl, deps });
//   view.show(param)    '' the list · 'new' a new feature · 'feature/<n>' one feature ·
//                       'brief/<scopeType>/<encoded scopeKey>' a project's or workspace's Product brief (A7 §6)
//   view.changed(seq, brief)  a `requirements-changed` frame (a feature's seq, or a brief's '<scopeType>:<scopeKey>'):
//                       refetch what is on screen when the frame concerns it
//   view.destroy()

import { gitOn, onGitChange, GIT_MISSING_TEXT } from './git-gate.mjs';
import { makeSwitch } from './switch.mjs';
import { icon as sharedIcon } from './icons.mjs';
import {
  ATTACH_BINARY, extOf, checkAttachment, bytesToBase64, carriesFiles, pastedFiles, createPasteNamer, REQ_ATTACH, reqLimits, reqTypeMessage,
} from './attach-files.mjs';

// The displayed state (A2 §4), always the server's `f.state`: the page never derives it. `started` is
// drawn as the latest run's pill (runPill), not as a badge.
const STATE = Object.freeze({
  looking: { label: 'Looking', cls: 'running' },
  thinking: { label: 'Thinking', cls: 'running' },
  your_turn: { label: 'Your turn', cls: 'amber' },
  decide: { label: 'Decide', cls: 'amber' },
  ready: { label: 'Ready', cls: 'green' },
  started: { label: 'Started', cls: '' },
  archived: { label: 'Archived', cls: '' },
});
// The list's filter tabs. Counts leave archived out; Archived fetches with archived=1 and has no count.
const FILTERS = Object.freeze([
  { key: 'open', label: 'All open', has: (s) => s !== 'archived' },
  { key: 'needs', label: 'Needs you', has: (s) => s === 'your_turn' || s === 'decide' },
  { key: 'ready', label: 'Ready', has: (s) => s === 'ready' },
  { key: 'started', label: 'Started', has: (s) => s === 'started' },
  { key: 'archived', label: 'Archived', has: (s) => s === 'archived', noCount: true },
]);
const READY_CHECKS = 6;
const RUN_LIVE = ['created', 'starting', 'running', 'pausing'];
const SECTIONS = [['goal', 'Goal'], ['actors', 'Actors'], ['flow', 'Main flow'], ['edgeCases', 'Edge cases'],
  ['rules', 'Business rules'], ['outOfScope', 'Out of scope'], ['openQuestions', 'Open questions']];
// The long lists the spec card folds behind one link.
const FOLDED = ['flow', 'edgeCases', 'rules', 'outOfScope'];
const KEYS = ['A', 'B', 'C', 'D'];
const MAX_ROUNDS = 6;
// The Product brief's four sections (A7 D2) and an area's status badge.
const BRIEF_SECTIONS = [['product', 'What the product does'], ['users', 'Who uses it'], ['terms', 'The words it uses'], ['areas', 'What exists today']];
const AREA_STATUS = Object.freeze({ exists: { label: 'Exists', cls: 'green' }, partly: { label: 'Partly', cls: 'amber' } });
const BRIEF_FORMAT = Object.freeze({ users: 'One per line, as Name: what they can do.', terms: 'One per line, as Term: what it means.',
  areas: 'One per line, as Name (exists or partly): what exists. The status is optional.' });
/** An area as the page names it: "<belongsTo>: <name>" for one added from a closer look (A7 D11). */
const areaLabel = (a) => (a.belongsTo ? `${a.belongsTo}: ${a.name}` : a.name);
/** A section as the editor's text (A7 §3, the server's `sectionText`): one item per line, split on the first ": ". */
function briefSectionText(key, value) {
  if (key === 'product') return String(value ?? '');
  const line = (head, text) => `${head || ''}: ${text || ''}`.trimEnd();
  return (Array.isArray(value) ? value : []).filter(Boolean).map((x) => (key === 'users' ? line(x.name, x.can)
    : key === 'terms' ? line(x.term, x.meaning) : line(`${x.name}${x.status ? ` (${x.status})` : ''}`, x.text))).join('\n');
}

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'hidden') node.hidden = !!v;
    else if (k === 'disabled') node.disabled = !!v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// The page's icons (24px grid, drawn in currentColor; the colour comes from style.css).
const ICONS = Object.freeze({
  pencil: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4z' }], ['path', { d: 'M13.5 6.5l4 4' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  remove: [['path', { d: 'M7 7l10 10M17 7L7 17' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  circle: [['circle', { cx: 12, cy: 12, r: 7.5 }]],
  dots: [['circle', { cx: 5, cy: 12, r: 1.6 }], ['circle', { cx: 12, cy: 12, r: 1.6 }], ['circle', { cx: 19, cy: 12, r: 1.6 }]],
  ask: [['path', { d: 'M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6.5L8 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z' }],
    ['path', { d: 'M9.9 9.1a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.9-1.1 1.6' }], ['path', { d: 'M12 15v.01' }]],
  play: [['path', { d: 'M6 4l14 8-14 8V4Z' }]],
  warn: [['path', { d: 'M12 3l9.5 17h-19L12 3z' }], ['path', { d: 'M12 10v4.5M12 17.5v.01' }]],
  // A8 (board 15): the drop zone's clip, a file chip's page and picture, the privacy note's i
  clip: [['path', { d: 'M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5' }]],
  file: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }]],
  image: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ['circle', { cx: 9, cy: 10, r: 1.6 }], ['path', { d: 'M20.5 16l-5-5-8.5 8.5' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 8h.01M11 12h1v5h1' }]],
});
const AUTO_WORKFLOW = 'wf_auto';
// Workflows a feature never starts with: the memory defragment is a maintenance run, not a build.
const NOT_FOR_BUILDS = ['wf_auto', 'wf_memory_defrag'];
const REASON_MAX = 500;
const NOTES_MAX = 10000;   // Your notes for Worca (store.mjs LIMITS.context)
/** An inline SVG icon; decorative (aria-hidden) unless `label` names it (role=img). */
function icon(shapes, { size = 16, label = null, width = 2, fill = 'none', stroke = 'currentColor' } = {}) {
  const set = (el, attrs) => { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const svg = set(document.createElementNS(SVG_NS, 'svg'), { width: size, height: size, viewBox: '0 0 24 24', fill, stroke,
    'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  if (label) set(svg, { role: 'img', 'aria-label': label }); else svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) svg.append(set(document.createElementNS(SVG_NS, tag), attrs));
  return svg;
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
/** How old `iso` is, in words (A7 §6): "today", "yesterday", "<n> days", "<n> weeks" (up to 8), "<n> months";
 *  by calendar day in local time; '' for something that is not a date. */
export function age(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const day = (ms) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
  const days = Math.max(0, Math.round(day(now) - day(t)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days`;
  if (days < 61) return `${Math.floor(days / 7)} weeks`;
  return `${Math.max(2, Math.floor(days / 30.44))} months`;
}
/** A brief's age as the pages say it (A7 §6): "made today", "made yesterday", "<age> old". */
function ageOld(iso) {
  const a = age(iso);
  return a === 'today' || a === 'yesterday' ? `made ${a}` : a ? `${a} old` : 'made';
}

// ---- A8: files (plans/requirements-a8-design.md §6; design round 3, boards 15–21) ----
const KIND_TITLE = Object.freeze({ text: 'Text', image: 'Image', binary: 'PDF' });
const READ_RANGE = '$0.05–0.20';   // a read's cost before any read has been made
/** 640 B, 9 KB, 2.1 MB (the server's sizeLabel). */
export function sizeText(bytes) {
  const v = Number(bytes) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}
const kindOfName = (name) => { const m = ATTACH_BINARY[extOf(name)]; return m ? (m.startsWith('image/') ? 'image' : 'binary') : 'text'; };
/** The picks of the feature and brief pages, in requests of at most 100 MB each (D7). */
export function uploadBatches(files) {
  const out = [];
  let cur = [];
  let n = 0;
  for (const f of files) {
    if (cur.length && n + f.size > REQ_ATTACH.maxRequestBytes) { out.push(cur); cur = []; n = 0; }
    cur.push(f);
    n += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}
const encodeFile = async (file) => ({ name: file.name, dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) });
/** "$0.05", "$0.05–0.12", or READ_RANGE while none of the kinds has an estimate (board 15). */
function readRange(kinds, estimates) {
  const known = [...new Set(kinds)].map((k) => estimates && estimates[k]).filter((x) => typeof x === 'number');
  if (!known.length) return READ_RANGE;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi).slice(1)}`;
}
/** D15: the privacy note, naming the interview model. */
const privacyNote = (interview, id = null) => h('p', { class: 'hint req-files-privacy', id }, icon(ICONS.info, { size: 14 }),
  h('span', { text: `Worca sends each file to ${(interview && (interview.label || interview.model)) || 'the interview model'} to read it. Text is checked for keys and passwords first; images and PDFs go as they are.` }));
/** A refusal line of the files' amber alert, the file's name in bold (board 15). */
function refusalLine(message) {
  const m = /^(.+?) (was not added: .*)$/.exec(message);
  return h('span', { class: 'req-file-refusal' }, ...(m ? [h('b', { text: m[1] }), ` ${m[2]}`] : [message]));
}
/** "a", "a and b", "a, b and c". */
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** A brief frame's key, split on its FIRST ':' (a workspace id may hold ':' itself); null when it is not one. */
function briefScope(key) {
  const k = typeof key === 'string' ? key : '';
  const i = k.indexOf(':');
  return i > 0 && i < k.length - 1 ? { scopeType: k.slice(0, i), scopeKey: k.slice(i + 1) } : null;
}
const scopeId = (s) => `${s.scopeType}:${s.scopeKey}`;
const briefPath = (scopeType, scopeKey) => `brief/${scopeType}/${encodeURIComponent(scopeKey)}`;
const decodeKey = (k) => { try { return decodeURIComponent(k); } catch { return k; } };
const sentence = (s) => { const t = String(s || '').replace(/[_-]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const badge = (state) => h('span', { class: `badge ${STATE[state]?.cls || ''}`.trim(), text: STATE[state]?.label || state });
const runColour = (status) => (RUN_LIVE.includes(status) ? 'peach' : status === 'done' ? 'green'
  : status === 'error' || status === 'stopped' ? 'red' : '');
/** The latest run as a pill: peach while it runs (its phase as the text), amber while it waits for the person
 *  (a question or the Auto confirmation), green done, red error / stopped. */
function runPill(run) {
  const status = run && run.status;
  if (run && run.waiting === true) return h('span', { class: 'pill-run req-run amber' }, h('span', { class: 'pdot' }), 'Waiting for you');
  const text = (RUN_LIVE.includes(status) && run.phase ? sentence(run.phase) : sentence(status)) || 'Started';
  return h('span', { class: `pill-run req-run ${runColour(status)}`.trim() }, h('span', { class: 'pdot' }), text);
}
// A list row carries `latestRun`; the feature page has its starts, newest first, each with its run.
const latestRunOf = (f) => (f.latestRun !== undefined ? f.latestRun : (f.starts && f.starts[0] && f.starts[0].run) || null);
const stateMark = (f) => (f.state === 'started' ? runPill(latestRunOf(f)) : badge(f.state));
/** The line under a row's title, by state; `need` when it asks something of the person. */
function rowMeta(f) {
  const run = f.latestRun;
  switch (f.state) {
    case 'your_turn': {
      const k = Number.isInteger(f.pendingCount) && f.pendingCount > 0 ? `${plural(f.pendingCount, 'question')} for you` : 'Your turn';
      return { text: `Round ${Math.min(Number(f.rounds) || 1, MAX_ROUNDS)} of ${MAX_ROUNDS} · ${k}`, need: true };
    }
    case 'decide': {
      const n = Number(f.openAssumptions) || 0;
      return { text: `Interview done · Ready ${Number(f.ready) || 0} of ${READY_CHECKS}${n > 0 ? ` · ${plural(n, 'assumption')} to decide` : ''}`, need: true };
    }
    case 'ready': return { text: `Ready ${READY_CHECKS} of ${READY_CHECKS}` };
    case 'started': {
      // the interview goes on after a start (A2 D11): questions waiting are said here too
      const k = Number.isInteger(f.pendingCount) && f.pendingCount > 0 ? f.pendingCount : 0;
      const waits = !!(run && run.waiting === true);
      const runText = waits ? ' · run waiting for you'
        : run && run.status ? ` · run ${run.status}${run.phase ? ` · ${sentence(run.phase)}` : ''}` : '';
      return { text: `Started${runText}${k ? ` · ${plural(k, 'question')} for you` : ''}`, need: k > 0 || waits };
    }
    case 'looking': return { text: 'Worca is looking at the code…' };
    case 'thinking': return { text: 'Worca is thinking…' };
    default: return null;
  }
}
const isWorking = (f) => !!f.busy || f.status === 'looking' || f.status === 'thinking';
// Worca is working, or the feature is archived: nothing on the page may be changed.
const isLocked = (f) => isWorking(f) || f.status === 'archived';

export function createRequirementsView({ host, subEl, msgEl, deps = {} }) {
  const route = deps.route || ((p) => { location.hash = p ? `#requirements/${p}` : '#requirements'; });
  let param = '';
  let seqShown = null;
  let paintNo = 0;
  let draft = null;          // { roundTurnId, picks: {id: option}, texts: {id: text}, drafted: {id: msgId} } — the open card's unsent answers (drafted: Worca's, A3 D6)
  let revising = null;       // the earlier round being changed (its round turn id), shown as a card (D12)
  let revDraft = null;       // that card's unsent answers, as `draft`
  let editing = null;        // the section open in its editor
  let current = null;        // the feature page on screen: { f, turns }, for a repaint without a fetch
  let focusNext = null;      // the data-ui field the next feature paint focuses (a field just opened)
  let targets = { projects: [], workspaces: [] };
  let filter = 'open';      // the list's filter tab (FILTERS), kept across repaints and visits
  let paintedKey = null;     // what the host currently shows: 'list' | 'new' | 'feature/<n>' | 'brief/<type>:<key>'
  // The brief page (A7 §6): the scope on screen, its last body (a repaint without a fetch), a Create in flight,
  // the notes as last painted and their unsaved text, and each feature's scope as the page has seen it
  // (seq -> '<type>:<key>'), so a feature's frame repaints the brief page of its scope only.
  let briefShown = null;     // { scopeType, scopeKey } | null
  let briefData = null;
  let creating = false;
  let notesBase = null;      // { body, look } as painted from the server
  let notesDraft = null;     // { body, look } typed and not saved yet
  // The made brief (board 12): the section open in its editor and its unsaved text ({ key, text }), the notes
  // editor opened from Edit notes, the right column's folds, a save in flight, the field the next paint focuses.
  let briefEditing = null;
  let briefEditVal = null;
  let notesEditing = false;
  let briefFolds = { notes: true, read: false };
  let briefSaving = false;
  let briefFocusNext = null;
  const seqScope = new Map();
  let focusLater = null;     // a data-ui to focus once it is on screen, while the focus is lost (a round sent)
  let relook = null;         // New feature's look line, said again when git appears or goes missing
  let carry = null;          // { param, text }: a create's message that the page it routes to says (A8 filesNotStored)
  let readingEl = null;      // the feature page's "Reading N files…" role=status line, kept across paints (A8 D2)
  // A8 (board 16): the Files card. Per file id its open editor text, ask text, Show all and history fold; per owner key
  // ('feature:<seq>') the last pick's refusals. The live nodes are kept across paints so they speak once (role=alert /
  // role=status): each file's Reading… badge and failed line, each owner's refusal line, and the card's status line.
  const fileUi = new Map();
  const fileMsgs = new Map();
  const fileMsgList = new Map();    // the same refusals, one per file, for the bold names
  const fileNodes = new Map();      // a file id → { badge, failed }
  const refusalEls = new Map();     // an owner key → its role=alert line
  const fileWas = new Map();        // a file id → its status at the last paint (what the status line says changed)
  const droppedKeys = new Set();    // owner keys whose refusal line says a dropped draft's file is being read
  const DROPPED_DRAFT = 'Worca is reading this file.';
  let filesLive = null;             // the Files card's sr-only role=status line
  let keptSel = null;               // the focused text field's selection, read by capture() before a feature repaint
  // Start in Worca: the workflow / branch choices per feature seq ({ workflowId, sourceBranch, open }),
  // the workflow list and each project's branches (loaded once, when Change opens), a start in flight,
  // and the start-before-Ready dialog ({ wrap, trigger, triggerUi }).
  const choices = new Map();
  let workflows = null;      // null not loaded · 'loading' · [{ id, name }]
  const branchLists = new Map();   // projectDir -> 'loading' | { branches, current }
  let starting = false;
  let dialog = null;
  let workflowsFailed = false;     // GET /api/workflows failed: Auto only, and the card says so
  const assumePosting = new Set(); // assumption ids whose Confirm / Reject POST is in flight
  const pickPosting = new Set();   // file ids whose Files for the run chip PATCH is in flight (board 18)
  // A3 (boards 22–25): Ask Worca. Whether the panel is open, per feature for the page session (D2); the chat as last fetched
  // (GET …/helper, or null); the composer's unsent text, its focus cap (Help me answer), the control that opened the panel
  // (Escape, Close and Back give the focus back to it), the last refusal and a spent budget; the drafts applied to the question
  // card this visit ('<msgId>:<questionId>', so a repaint never applies one again, D6); the log and its message nodes, kept
  // across paints so the live region announces only what is new (D18); the Answering… line and the log's other lines (card 7,
  // D20's line, the spending limit), kept likewise; the newest message the log was scrolled to (a repaint without a new
  // message leaves the reader where they are); a chat POST (or a reload) in flight, so a second press is ignored (each send is
  // a paid call); how many times Try again reloaded a chat that could not be read (its line is announced again each time).
  const helperOpen = new Map();
  let helperData = null;
  let helperUi = freshHelperUi();
  const helperApplied = new Set();
  const helperNodes = new Map();
  const helperTails = new Map();
  let helperLog = null;
  let helperWaitEl = null;
  let helperNewest = null;
  let helperBusy = false;
  let viewGen = 0;   // bumped on each visit to another feature: a reply from an earlier visit (A, B, back to A) is dropped
  let helperGen = 0;   // who owns the helperBusy guard: show() on another feature bumps it, so a late call cannot release a guard it no longer holds
  let helperReloads = 0;
  function freshHelperUi() { return { text: '', focus: null, opener: null, error: null, budget: false }; }
  // Unsaved input of the feature page, kept across repaints (read from the DOM before a rebuild, put back after).
  let ui = freshUi();
  function freshUi() {
    return { editVals: null, crit: '', critOpen: false, orientOpen: false, moreOpen: false, menu: null, decideMore: false, specTab: 'draft' };
  }

  if (subEl) subEl.textContent = 'Define a feature with Worca before anything is built. Nothing runs until you start it.';
  const say = (text, kind = '') => { if (msgEl) { msgEl.textContent = text || ''; msgEl.className = `form-msg${kind ? ` ${kind}` : ''}`; } };
  const GONE = 'Requirements are turned off, or this feature no longer exists.';
  const fail = (err) => say(err && err.status === 404 ? GONE : (err && err.message) || String(err), 'err');
  /** A refusal for a dialog's or a panel's own line: the server's words, the 404 as `fail` says it, and product copy for
   *  anything else (an HTTP failure without a JSON error, a network failure): never a raw "HTTP 502". */
  const errText = (err) => (err && err.status === 404 ? GONE
    : err && err.data && typeof err.data.error === 'string' && err.data.error ? err.data.error : 'Worca could not finish that. Try again.');
  const act = async (fn) => { say(''); try { await fn(); } catch (err) { fail(err); } };
  // "Started build v<n>." with a link to the run (the page stays on the feature, D10).
  const sayStarted = (version, runId) => {
    if (!msgEl) return;
    msgEl.className = 'form-msg ok';
    msgEl.replaceChildren(`Started build v${version}. `, h('a', { class: 'req-msg-link', href: `#running/${runId}` }, 'Open the run'));
  };

  async function loadTargets() {
    const [p, w] = await Promise.all([api('GET', '/api/projects').catch(() => ({})), api('GET', '/api/workspaces').catch(() => ({}))]);
    targets = { projects: p.projects || [], workspaces: w.workspaces || [] };
  }
  const targetName = (f) => (f.scopeType === 'workspace'
    ? targets.workspaces.find((w) => w.id === f.scopeKey)?.name
    : targets.projects.find((p) => p.key === f.scopeKey)?.name) || f.scopeKey;
  const targetLabel = (f) => `${f.scopeType === 'workspace' ? 'Workspace' : 'Project'} · ${targetName(f)}`;

  async function show(p = '') {
    param = String(p || '');
    const m = /^feature\/(?:FEAT-)?(\d+)$/.exec(param);
    const next = m ? Number(m[1]) : null;
    if (next !== seqShown) {
      draft = null; revising = null; revDraft = null; editing = null; current = null; ui = freshUi(); focusLater = null; readingEl = null;
      for (const map of [fileUi, fileMsgs, fileMsgList, fileNodes, refusalEls, fileWas, droppedKeys]) map.clear();
      filesLive = null;
      helperData = null; helperUi = freshHelperUi(); helperApplied.clear(); helperNodes.clear(); helperTails.clear(); helperLog = null; helperWaitEl = null; helperNewest = null;
      helperBusy = false; helperGen += 1; viewGen += 1;   // another feature: a chat POST still in flight for the last one never blocks this one's controls
      closeDialog(false);
    }
    seqShown = next;
    const b = /^brief\/(project|workspace)\/([^/]+)$/.exec(param);
    const nextBrief = b ? { scopeType: b[1], scopeKey: decodeKey(b[2]) } : null;
    // leaving a shown brief (to the list, a feature, another brief): a dialog opened on it closes with it
    if (briefShown && (!nextBrief || scopeId(nextBrief) !== scopeId(briefShown))) closeDialog(false);
    if (nextBrief && (!briefShown || scopeId(nextBrief) !== scopeId(briefShown))) {
      // another brief's Documents card (board 19): its files' ui state and live nodes start afresh, as a feature's do
      for (const map of [fileUi, fileMsgs, fileMsgList, fileNodes, refusalEls, fileWas, droppedKeys]) map.clear();
      filesLive = null;
    }
    if (!nextBrief || !briefShown || scopeId(nextBrief) !== scopeId(briefShown)) {
      briefData = null; notesBase = null; notesDraft = null;
      briefEditing = null; briefEditVal = null; notesEditing = false; briefFolds = { notes: true, read: false }; briefFocusNext = null;
      if (ui.menu && ui.menu.startsWith('brief-')) ui.menu = null;
    }
    briefShown = nextBrief;
    // .req-msg-warn: --amber-ink-strong on --amber-bg (AA); the shared .form-msg.warn is under 4.5:1 on --bg
    if (carry && carry.param === param) say(carry.text, 'req-msg-warn'); else say('');
    carry = null;
    await paint();
  }
  // A live frame never touches the new-feature form. The list repaints on every frame; a feature page on its own
  // seq or its scope's brief; the brief page on its scope's brief, and on a feature's frame when that feature is
  // of its scope (usedBy changes as rounds complete) or not seen yet (it may be).
  async function changed(seq, brief) {
    if (param === 'new') return;
    const scope = briefScope(brief);
    if (briefShown) {
      const mine = scopeId(briefShown);
      if (scope) { if (scopeId(scope) === mine) await paint(); return; }
      if (seq == null) return;
      const of = seqScope.get(Number(seq));
      if (of === undefined || of === mine) await paint();
      return;
    }
    if (seqShown == null) { await paint(); return; }
    if (scope) {
      const f = current && current.f;
      if (f && f.seq === seqShown && scopeId(f) === scopeId(scope)) await paint();
      return;
    }
    if (Number(seq) === seqShown) await paint();
  }

  async function paint() {
    const mine = ++paintNo;
    const key = param === 'new' ? 'new' : seqShown != null ? `feature/${seqShown}` : briefShown ? `brief/${scopeId(briefShown)}` : 'list';
    try {
      await loadTargets();
      if (briefShown) {
        const data = await api('GET', `/api/requirements/${briefPath(briefShown.scopeType, briefShown.scopeKey)}`);
        if (mine === paintNo) { paintBrief(data); paintedKey = key; }
        return;
      }
      if (key === 'new') {
        // The list call carries the code-look cost for the hint, who interviews (A1.1) and the briefs (A7 board 13);
        // the form renders without it.
        const list = await api('GET', '/api/requirements').then((d) => d, () => null);
        const look = list && list.lookCostUsd;
        const interview = list && list.interview && typeof list.interview === 'object' ? list.interview : null;
        const briefs = list && Array.isArray(list.briefs) ? list.briefs : [];
        const estimates = list && list.readEstimates && typeof list.readEstimates === 'object' ? list.readEstimates : {};
        if (mine === paintNo) { paintNew(typeof look === 'number' ? look : null, interview, briefs, estimates); paintedKey = key; }
        return;
      }
      if (seqShown != null) {
        const data = await api('GET', `/api/requirements/${seqShown}`);
        // A3: the chat too while the panel is open, or when it has messages (their drafts fill the question card, D6). A chat that
        // cannot be read keeps the one last shown (show() empties it on another feature): never the first-open text and its
        // starters, each a paid call, over a chat that has messages, and the drafts stay in the question card.
        const f0 = data.feature || {};
        const wantChat = helperOpen.get(seqShown) || (f0.helper && f0.helper.messages > 0);
        let chatFailed = false;
        const chatBody = wantChat ? await api('GET', `/api/requirements/${seqShown}/helper`).catch(() => { chatFailed = true; return null; }) : null;
        if (mine === paintNo) { if (!chatFailed) takeChat(chatBody); paintFeature(data.feature, data.turns || []); paintedKey = key; }
        return;
      }
      const data = await api('GET', `/api/requirements${filter === 'archived' ? '?archived=1' : ''}`);
      if (mine === paintNo) { paintList(data); paintedKey = key; }
    } catch (err) {
      if (mine !== paintNo) return;
      // Only a 404, or a first load, blanks the host; any other failure keeps what is on screen.
      if ((err && err.status === 404) || paintedKey !== key) { host.replaceChildren(); paintedKey = null; }
      fail(err);
    }
  }

  // Read the unsaved input from the current feature page into `ui`, and which field has focus.
  function capture(f) {
    keptSel = null;
    if (!host.querySelector(`[data-req-feature="${f.seq}"]`)) return null;
    const q = (k) => host.querySelector(`[data-ui="${k}"]`);
    const active = document.activeElement;
    const focus = active && host.contains(active) ? active.getAttribute('data-ui') : null;
    // a typed field keeps its caret and selection across the rebuild (as the brief page's captureBrief)
    if (focus && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'))) {
      keptSel = [active.selectionStart, active.selectionEnd, active.selectionDirection];
    }
    const ea = q('edit-a');
    if (ea) {
      const eb = q('edit-b');
      ui.editVals = { key: ea.closest('[data-section]')?.getAttribute('data-section'), a: ea.value, b: eb ? eb.value : '' };
    }
    const crit = q('new-criterion');
    if (crit) ui.crit = crit.value;
    const orient = host.querySelector('.req-orient');
    if (orient) ui.orientOpen = orient.open;
    const hin = q('helper-in'); if (hin) helperUi.text = hin.value;
    return focus;
  }

  // Every paint goes through here: a null or false child never reaches the DOM
  // (replaceChildren would render it as the text "null").
  const paintHost = (...kids) => host.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const setFilter = (key) => { if (key === filter) return; filter = key; void paint(); };

  function filterTabs(all) {
    const onKey = (e) => {
      const i = FILTERS.findIndex((F) => F.key === filter);
      const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? FILTERS.length - 1 : null;
      if (j == null) return;
      e.preventDefault();
      setFilter(FILTERS[(j + FILTERS.length) % FILTERS.length].key);
    };
    return h('div', { class: 'seg req-filter', role: 'tablist', 'aria-label': 'Filter features', onkeydown: onKey },
      ...FILTERS.map((F) => {
        const on = F.key === filter;
        return h('button', { type: 'button', role: 'tab', class: on ? 'on' : null, 'aria-selected': on ? 'true' : 'false',
          tabindex: on ? '0' : '-1', 'data-filter': F.key, onclick: () => setFilter(F.key) },
        F.noCount ? F.label : `${F.label} · ${all.filter((f) => F.has(f.state)).length}`);
      }));
  }

  function listRow(f) {
    const meta = rowMeta(f);
    return h('button', { type: 'button', class: 'req-row', 'data-feature': f.seq, onclick: () => route(`feature/${f.seq}`) },
      h('code', { class: 'req-id', text: f.id }),
      h('span', { class: 'req-row-main' },
        h('span', { class: 'req-title', text: f.title }),
        meta ? h('span', { class: `hint req-row-meta${meta.need ? ' need' : ''}`, text: meta.text }) : null),
      stateMark(f),
      h('span', { class: 'req-cost', text: usd(f.costUsd) }));
  }

  // A group header's brief (board 11, A7 §6 "Elsewhere"): none yet (no row, or an `empty` one) with Create,
  // being made, or its age; each a link to the brief page. Create needs git, so " · Create" hides while git is
  // missing (git-gate.mjs); the brief page's notes stay reachable from a feature's ⋯.
  function groupBrief(g, b) {
    const to = briefPath(g.scopeType, g.scopeKey);
    const link = (label, aria = null) => h('a', { class: 'req-brief-link', href: `#requirements/${to}`, 'aria-label': aria,
      onclick: (e) => { e.preventDefault(); route(to); } }, label);
    if (b && b.madeAt) {
      return h('span', { class: 'hint req-group-brief' }, link(`Product brief · ${ageOld(b.madeAt)}`));
    }
    if (b && b.status === 'making') return h('span', { class: 'hint req-group-brief' }, link('Product brief: being made…'));
    return h('span', { class: 'hint req-group-brief' }, 'Product brief: none yet',
      h('span', { 'data-needs-git': true }, ' · ', link('Create', `Create the product brief for ${g.name}`)));
  }

  function paintList(data) {
    const all = data.features || [];
    const F = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const shown = all.filter((f) => F.has(f.state));
    for (const f of all) seqScope.set(Number(f.seq), scopeId(f));
    const briefs = new Map((data.briefs || []).filter((b) => b && b.scopeType && b.scopeKey).map((b) => [scopeId(b), b]));
    const groups = new Map();
    for (const f of shown) {
      const k = scopeId(f);
      if (!groups.has(k)) groups.set(k, { label: targetLabel(f), name: targetName(f), scopeType: f.scopeType, scopeKey: f.scopeKey, items: [] });
      groups.get(k).items.push(f);
    }
    const spend = data.spend;
    const tabFocused = host.contains(document.activeElement) && document.activeElement.getAttribute('role') === 'tab';
    paintHost(
      h('div', { class: 'req-bar' },
        filterTabs(all),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => route('new') }, 'New feature')),
      shown.length ? null : h('p', { class: 'hint req-empty', text: all.length === 0 && filter !== 'archived'
        ? 'No features yet. Describe one in a few sentences and Worca interviews you about it.'
        : 'Nothing here.' }),
      [...groups.values()].map((g) => h('section', { class: 'req-group', 'aria-label': g.label },
        h('div', { class: 'req-group-head' }, h('h2', { text: g.label }), groupBrief(g, briefs.get(scopeId(g)))),
        h('div', { class: 'card req-rows' }, g.items.map(listRow)))),
      spend && typeof spend.windowUsd === 'number'
        ? h('p', { class: 'hint req-spend', text: `Spent on requirements this ${spend.resetPeriod === 'weekly' ? 'week' : 'month'}: ${usd(spend.windowUsd)}${
          typeof spend.totalLimitUsd === 'number' ? ` of your ${usd(spend.totalLimitUsd)} limit` : ''}.` })
        : null,
    );
    // a filter chosen from the keyboard keeps the focus on the tabs across the rebuild
    if (tabFocused) host.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }

  // The green line under For when the chosen target has a usable brief (A7 board 13, D10): no look before round 1.
  function briefLine(s, name, b) {
    const to = briefPath(s.scopeType, s.scopeKey);
    return h('p', { class: 'req-brief-line' }, icon(ICONS.check, { size: 16, width: 2.4 }),
      h('span', {}, `Worca knows ${name} from its `, briefLink(to), ` (${ageOld(b.madeAt)}), so it starts asking right away.`,
        b.lookAtCode !== false ? ' It looks closer at the code only if you ask.' : ''));
  }
  const briefLink = (to) => h('a', { class: 'req-brief-link', href: `#requirements/${to}`, onclick: (e) => { e.preventDefault(); route(to); } }, 'product brief');

  // The line under the form: who interviews (A1.1), then what it costs. With a usable brief for the chosen target (or
  // without git) there is no code look (A7 D10), so only the cost words after the dot change; the model part never does.
  // A8 (board 15): with files picked, the words say each file is read once before round 1. Without interview info:
  // A2's sentence; with nothing to say (no look estimate, no files) there is no line at all, as in A2.
  function costHint(lookCost, interview, estimates = {}) {
    let noLook = false;
    let kinds = [];
    const lookPart = () => (lookCost != null && !noLook ? `about ${usd(lookCost)} for the code look, ` : '');
    const words = () => (kinds.length
      ? `${lookPart()}reads each file once before round 1, about ${readRange(kinds, estimates)} a file, then cents per round`
      : lookPart() ? `${lookPart()}then cents per round` : 'cents per round');
    if (!interview) {
      let el = lookCost != null ? h('span', { class: 'hint req-new-cost' }) : null;
      const sync = () => {
        if (!el && kinds.length) el = h('span', { class: 'hint req-new-cost' });
        if (!el) return;
        const w = words();
        el.textContent = `${w[0].toUpperCase()}${w.slice(1)}.`;
        el.hidden = !lookPart() && !kinds.length;
      };
      sync();
      return { get el() { return el; }, brief: (on) => { noLook = on; sync(); }, files: (k) => { kinds = k; sync(); } };
    }
    const name = interview.label || interview.model;
    const who = `Worca interviews with ${name}${interview.effort ? ` at ${interview.effort} effort` : ''}`;
    const tail = document.createTextNode(` · ${words()}`);
    const el = h('span', { class: 'hint req-new-cost' }, h('span', { class: 'req-new-model', text: who }), tail);
    return { el, brief: (on) => { noLook = on; tail.data = ` · ${words()}`; }, files: (k) => { kinds = k; tail.data = ` · ${words()}`; } };
  }

  function paintNew(lookCost, interview = null, briefs = [], estimates = {}) {
    const select = h('select', { id: 'req-new-target' },
      targets.projects.length ? h('optgroup', { label: 'Projects' }, targets.projects.map((p) => h('option', { value: `project:${p.key}`, text: p.name }))) : null,
      targets.workspaces.length ? h('optgroup', { label: 'Workspaces' }, targets.workspaces.map((w) => h('option', { value: `workspace:${w.id}`, text: w.name }))) : null);
    const title = h('input', { id: 'req-new-title', type: 'text', maxlength: '200', placeholder: 'Cancel an order before it ships' });
    const desc = h('textarea', { id: 'req-new-desc', rows: '5', placeholder: 'A few sentences, the way you would tell a colleague.' });
    // A brief is usable once made (D10), also while it is being refreshed.
    const usable = new Map(briefs.filter((b) => b && b.scopeType && b.scopeKey && b.madeAt).map((b) => [scopeId(b), b]));
    const cost = costHint(lookCost, interview, estimates);
    let lookHint = h('span', { class: 'hint req-new-look' });
    const sayLook = () => {
      const [scopeType, ...rest] = select.value.split(':');
      const s = { scopeType, scopeKey: rest.join(':') };
      const b = select.value ? usable.get(scopeId(s)) : null;
      // without git a new feature skips its look (interview.mjs orient), so nothing promises one
      const git = gitOn();
      const next = b ? briefLine(s, select.options[select.selectedIndex]?.textContent || s.scopeKey, b)
        : h('span', { class: 'hint req-new-look', text: !git
          ? `Worca does not look at the code: ${GIT_MISSING_TEXT}. It starts asking right away.`
          : scopeType === 'workspace'
            ? "Worca looks at the code of this workspace's projects once, read-only, to learn what already exists. Change that in Your notes for Worca."
            : "Worca looks at this project's code once, read-only, to learn what already exists. Change that in Your notes for Worca." });
      if (lookHint.parentNode) lookHint.replaceWith(next);
      lookHint = next;
      // with a brief, or without git, the code look's cost is not said: only the words after the dot change (A7 §6 / §9)
      cost.brief(!!b || !git);
    };
    select.addEventListener('change', sayLook);
    sayLook();
    relook = sayLook;
    // A8 (board 15): the Files field. Picks are checked here (D7: 10 files, 25 MB each, 100 MB in all on this form);
    // a refused one is named in the amber alert and not added; a chip per accepted file.
    let picked = [];
    const chips = h('div', { class: 'req-new-chips' });
    const refused = h('p', { class: 'req-file-refused', role: 'alert', hidden: true });
    const note = h('p', { class: 'hint req-new-files-note', hidden: true, text: 'Files stay on the feature. Which files go with a run is chosen later, on the feature page.' });
    const actions = h('div', { class: 'actions req-new-actions' });
    const input = h('input', { type: 'file', id: 'req-new-files-input', multiple: true, accept: REQ_ATTACH.accept, hidden: true });
    const choose = h('button', { type: 'button', class: 'link-btn', onclick: () => input.click() }, 'Choose files');
    const sync = () => {
      chips.replaceChildren(...picked.map((file) => {
        const kind = kindOfName(file.name);
        return h('span', { class: 'req-new-chip' },
          icon(kind === 'image' ? ICONS.image : ICONS.file, { size: 16 }),
          h('span', { class: 'req-new-chip-name', text: file.name }),
          h('span', { class: 'hint', text: `${KIND_TITLE[kind]} · ${sizeText(file.size)}` }),
          icoBtn('remove', `Remove ${file.name}`, () => removePicked(file), { cls: 'req-new-chip-x' }));
      }));
      note.hidden = !picked.length;
      cost.files(picked.map((p) => kindOfName(p.name)));
      if (cost.el && cost.el.parentNode !== actions) actions.prepend(cost.el);   // A2's line appears with the first file
    };
    // A removed chip hands the focus to the next chip's ×, else the previous one's, else Choose files.
    const removePicked = (file) => {
      const at = picked.indexOf(file);
      picked = picked.filter((p) => p !== file);
      sync();
      const xs = chips.querySelectorAll('.req-new-chip-x');
      (xs[Math.min(at, xs.length - 1)] || choose).focus();
    };
    const addPicked = (files) => {
      const errors = [];
      for (const file of files) {
        const c = checkAttachment(file, { pending: picked.map((p) => ({ name: p.name, bytes: p.size })), limits: reqLimits({ create: true }), typeMessage: reqTypeMessage });
        if (!c.ok) { errors.push(c.error); continue; }
        picked = [...picked.filter((p) => p.name !== file.name), file];
      }
      refused.replaceChildren(...errors.flatMap((e, i) => (i ? [' ', refusalLine(e)] : [refusalLine(e)])));
      refused.hidden = !errors.length;
      sync();
    };
    input.addEventListener('change', () => { const files = [...(input.files || [])]; input.value = ''; addPicked(files); });
    const namer = createPasteNamer((parts, n, o) => new File(parts, n, o));
    const zone = h('div', { class: 'req-drop', tabindex: '0', role: 'group', 'aria-label': 'Drop files here, paste them, or choose files',
      'aria-describedby': 'req-new-files-opt req-new-files-limits req-new-files-privacy' },
      'Drop files here, paste them, or ',
      choose,
      h('span', { class: 'hint', id: 'req-new-files-limits', text: 'Text, images and PDF · up to 10 files, 25 MB each' }),
      h('span', { class: 'req-drop-ico' }, icon(ICONS.clip, { size: 22, width: 1.8 })));
    // Enter or Space on the focused zone opens the picker, as Choose files does (the button keeps its own keys).
    zone.addEventListener('keydown', (e) => {
      if (e.target !== zone || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      input.click();
    });
    zone.addEventListener('dragover', (e) => { if (!carriesFiles(e.dataTransfer)) return; e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      zone.classList.remove('over');
      addPicked([...e.dataTransfer.files]);
    });
    zone.addEventListener('paste', (e) => { const files = pastedFiles(e.clipboardData); if (!files) return; e.preventDefault(); addPicked(namer(files)); });
    // One create at a time: reading the files slows the press down, so a second press while it runs does nothing.
    let sending = false;
    const create = () => (sending ? undefined : act(async () => {
      sending = true;
      try {
        const [scopeType, ...rest] = select.value.split(':');
        const attachments = picked.length ? await Promise.all(picked.map(encodeFile)) : undefined;
        const data = await api('POST', '/api/requirements', { scopeType, scopeKey: rest.join(':'), title: title.value, description: desc.value, ...(attachments ? { attachments } : {}) });
        // A file the server could not store is named on the feature page (the feature stays; the create's filesNotStored).
        const lost = Array.isArray(data.filesNotStored) ? data.filesNotStored : [];
        if (lost.length) carry = { param: `feature/${data.feature.seq}`, text: lost.map((n) => `${n} was not added: Worca could not store it. Add it on the feature page.`).join(' ') };
        route(`feature/${data.feature.seq}`);
      } finally { sending = false; }
    }));
    actions.append(...[cost.el, h('div', { class: 'req-new-btns' },
      h('button', { type: 'button', class: 'btn', onclick: () => route('') }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: create }, 'Start the interview'))].filter(Boolean));
    const field = (id, label, control, ...after) => h('div', { class: 'field' }, h('label', { for: id }, ...label), control, ...after);
    paintHost(h('div', { class: 'req-new-page' },
      h('a', { href: '#requirements', class: 'hint req-back', onclick: (e) => { e.preventDefault(); route(''); } }, '← All features'),
      h('div', { class: 'req-new-head' },
        h('h2', { text: 'New feature' }),
        h('p', { class: 'req-sub', text: 'Describe it the way you would to a colleague. Worca asks the rest, a few questions at a time.' })),
      h('div', { class: 'card req-new' },
        field('req-new-title', ['Title'], title),
        field('req-new-desc', ['Describe it ', h('span', { class: 'opt', text: 'who needs it, what they want to do, and why' })], desc),
        h('div', { class: 'field req-new-files' },
          h('label', { for: 'req-new-files-input' }, 'Files ', h('span', { class: 'opt', id: 'req-new-files-opt', text: 'optional: emails, a spec, screenshots, a mockup' })),
          input, zone, privacyNote(interview, 'req-new-files-privacy'), chips, refused),
        field('req-new-target', ['For'], h('div', { class: 'select-wrap' }, select), lookHint),
        actions),
      note));
  }

  // ---- the Product brief page (A7 §6; board BriefEmpty.dc.html): the header, Give Worca a head start while
  // there is no brief yet, and Your notes for Worca (A2's Project context, moved here, D12) ----

  const briefLabel = (s, name) => `${s.scopeType === 'workspace' ? 'Workspace' : 'Project'} · ${name}`;

  // Read the page's unsaved input before a rebuild: the notes' text and switch (kept only when they differ from
  // what was painted), the open section editor's text, the folds, and the focused field with its caret.
  function captureBrief() {
    const s = briefShown;
    const page = host.querySelector('[data-req-brief]');
    if (!s || !page || page.getAttribute('data-req-brief') !== scopeId(s)) return null;
    const active = document.activeElement;
    const focus = active && host.contains(active) ? active.getAttribute('data-ui') : null;
    const typed = !!(focus && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text')));
    const sel = typed ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    const area = host.querySelector('[data-ui="notes-body"]');
    const look = host.querySelector('[data-ui="notes-look"]');
    if (area && look && notesBase) {
      const v = { body: area.value, look: look.checked };
      notesDraft = v.body !== notesBase.body || v.look !== notesBase.look ? v : null;
    }
    const ed = host.querySelector('[data-ui="brief-edit-text"]');
    if (ed && briefEditing) briefEditVal = { key: ed.closest('[data-section]')?.getAttribute('data-section'), text: ed.value };
    const notesFold = host.querySelector('details.req-brief-notes-read');
    if (notesFold) briefFolds.notes = notesFold.open;
    const readFold = host.querySelector('details.req-brief-read');
    if (readFold) briefFolds.read = readFold.open;
    return { focus, sel };
  }

  function paintBrief(data) {
    // A brief that was being made and is not any more (the frame-driven repaint after the job): said once in the
    // message line, the polite live region, for whoever is not looking at the page.
    const wasMaking = !!(briefData && briefData.brief && briefData.brief.status === 'making');
    const now = data && data.brief;
    if (wasMaking && now && now.status !== 'making') {
      if (now.error && now.error.message) say(`The product brief could not be made: ${now.error.message}`, 'err');
      else if (now.madeAt) say('The product brief is ready.', 'ok');
    }
    briefData = data;
    const s = briefShown;
    for (const u of data.usedBy || []) if (u && u.seq != null) seqScope.set(Number(u.seq), scopeId(s));
    const kept = captureBrief();
    const name = (data.target && data.target.name) || s.scopeKey;
    const b = data.brief || null;
    const made = !!(b && b.madeAt);
    if (!made) { briefEditing = null; briefEditVal = null; notesEditing = false; }
    paintHost(h('div', { class: `req-page req-brief-page${made ? ' req-brief-made' : ''}`, 'data-req-brief': scopeId(s) },
      h('a', { href: '#requirements', class: 'hint req-back', onclick: (e) => { e.preventDefault(); route(''); } }, '← All features'),
      briefHead(data, name, made),
      made ? staleNotice(data) : headStartCard(data),
      made ? h('div', { class: 'req-brief-cols' }, briefCard(b), briefSide(data, name)) : notesCard(data)));
    if (briefEditVal && briefEditVal.key !== briefEditing) briefEditVal = null;
    // A field just opened takes the focus; otherwise the focused field keeps it, with its caret and selection.
    const want = briefFocusNext || (kept && kept.focus);
    const sel = briefFocusNext ? null : kept && kept.sel;
    briefFocusNext = null;
    const el = want ? host.querySelector(`[data-ui="${want}"]`) : null;
    if (el && !el.disabled) {
      el.focus();
      if (sel && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(sel[0], sel[1], sel[2] || 'none'); } catch { /* not a text field */ } }
    }
  }
  const redrawBrief = () => { if (briefShown && briefData) paintBrief(briefData); };
  const briefApi = (s) => `/api/requirements/${briefPath(s.scopeType, s.scopeKey)}`;
  // Paint a brief route's answer (the GET body) when the page still shows that scope.
  function paintAnswer(s, data) {
    if (!briefShown || scopeId(briefShown) !== scopeId(s)) return;
    paintNo += 1;   // a fetch already under way would paint the page as it was before
    paintBrief(data);
    paintedKey = `brief/${scopeId(s)}`;
  }

  // Create, and Refresh (the same POST, D7): every control that starts it is marked `data-brief-go` and disabled
  // at once, so a double press posts once.
  function createBrief() {
    if (creating || !briefShown) return;
    const s = briefShown;
    creating = true;
    for (const el of host.querySelectorAll('[data-brief-go]')) el.disabled = true;
    say('');
    void (async () => {
      try {
        const refresh = !!(briefData && briefData.brief && briefData.brief.madeAt);
        const data = await api('POST', briefApi(s), {});
        creating = false;
        paintAnswer(s, data);
        // the pressed button is disabled now, so the focus is lost: the polite message line says the work started
        say(`Worca is ${refresh ? 'refreshing' : 'making'} the brief. This takes a few minutes; you can leave this page.`, 'ok');
      } catch (err) {
        creating = false;
        // refused (budget, busy, the switch, no repository): said in the message line; the button stays
        fail(err);
        redrawBrief();
      }
    })();
  }

  // Give Worca a head start (board 11): the four parts and the cost box with Create; the smallest behaviours of
  // §6 "Not on the boards": being made, a failed first make, the switch off, no repository, members left out.
  function headStartCard(data) {
    const s = briefShown;
    const b = data.brief || null;
    const t = data.target || {};
    const est = data.estimate || {};
    const making = !!(b && b.status === 'making');
    const failed = !making && b && b.error && b.error.message ? b.error.message : null;
    const switchOff = !!(data.notes && data.notes.lookAtCode === false);
    const slow = Array.isArray(t.slow) && t.slow.length > 0;
    // no repository: a project without a default branch, a workspace whose members have none (`repositories` 0)
    const noRepo = !slow && (s.scopeType === 'project' ? !t.branch : t.repositories === 0);
    const whyNot = making ? 'Worca is reading the code. This takes a few minutes; you can leave this page.'
      : switchOff ? 'Looking at the code is off. Turn it on under Your notes for Worca.'
        : noRepo ? 'There is no repository to look at.' : null;
    const facts = [
      s.scopeType === 'workspace' ? ["Each project's default branch"] : t.branch ? ['Branch ', h('code', { text: t.branch })] : null,
      typeof est.costUsd === 'number' ? ['about ', h('code', { text: usd(est.costUsd) })] : null,
      ['3 to 5 minutes'],
    ].filter(Boolean).flatMap((part, i) => (i ? [' · ', ...part] : part));
    const leftOut = s.scopeType === 'workspace' && Array.isArray(t.leftOut) && t.leftOut.length ? t.leftOut : null;
    const part = (title, rest) => h('li', {}, icon(ICONS.check, { size: 15, width: 2.4 }), h('span', {}, h('b', { text: title }), rest));
    return h('section', { class: 'card req-brief-start', 'aria-label': 'Give Worca a head start' },
      h('div', { class: 'req-brief-main' },
        h('h3', { text: 'Give Worca a head start' }),
        h('p', { class: 'req-brief-why', text: 'Today Worca looks at the code again for every new feature. A brief is one deeper look, done once, that every feature here reuses: interviews ask better questions sooner, and each feature saves its own look.' }),
        h('ul', { class: 'req-brief-parts' },
          part('What the product does', ', in a few sentences'),
          part('Who uses it', ' and what each of them can do'),
          part('The words the product uses', ': its concepts and what they mean'),
          part('What exists today', ', area by area, and what only partly exists')),
        h('p', { class: 'hint req-brief-plain', text: 'Plain product language, no code. You can edit every part; your text is kept.' })),
      // The look's box (facts, estimate, Create) checks out the code: hidden while git is missing (git-gate.mjs).
      h('div', { class: 'req-brief-cost', 'data-needs-git': true },
        h('span', { class: 'req-brief-look', text: 'One look, read-only' }),
        h('span', { class: 'req-brief-facts' }, ...facts),
        est.model && est.model.label ? h('span', { class: 'hint req-brief-model', text: `${est.model.label} · counts toward your limit` }) : null,
        slow ? h('span', { class: 'hint req-brief-slow', text: `Worca could not read ${joinAnd(t.slow)} in time; Create tries again.` }) : null,
        leftOut ? h('span', { class: 'hint req-brief-left-out',
          text: `Worca reads at most 8 projects of a workspace: ${joinAnd(leftOut)} ${leftOut.length === 1 ? 'is' : 'are'} left out.` }) : null,
        failed ? h('p', { class: 'form-msg err req-brief-failed', role: 'status', text: failed }) : null,
        h('button', { type: 'button', class: 'btn btn-primary req-brief-create', 'data-ui': 'brief-create', 'data-brief-go': true, disabled: creating || !!whyNot, onclick: createBrief },
          making || creating ? 'Creating…' : failed ? 'Try again' : 'Create the brief'),
        whyNot ? h('span', { class: 'hint req-brief-why-not', text: whyNot }) : null),
      // shown only while git is missing (style.css), in place of the box above
      h('p', { class: 'hint req-brief-nogit-create', text: `A brief needs git to read the code, and ${GIT_MISSING_TEXT}.` }));
  }

  // Your notes for Worca (A2's Project / Workspace context, D12): the notes and the switch, saved together. On a
  // made brief it is opened by Edit notes (`onCancel` closes it) and goes back to the notes once saved.
  function notesCard(data, { onCancel = null } = {}) {
    const s = briefShown;
    const n = data.notes || {};
    notesBase = { body: typeof n.body === 'string' ? n.body : '', look: n.lookAtCode !== false };
    const v = notesDraft || notesBase;
    const area = h('textarea', { rows: '4', 'aria-label': 'Your notes for Worca', 'data-ui': 'notes-body', maxlength: String(NOTES_MAX),
      placeholder: 'Actors, terms and standing rules every feature here should know' });
    area.value = v.body;
    // the shared switch (switch.mjs): an on/off setting is a switch, not a checkbox (docs/design-system.md › Switch)
    const { row: lookRow, input: look } = makeSwitch(document, { checked: v.look, rowClass: 'req-brief-notes-look', data: { ui: 'notes-look' },
      label: 'Let Worca look at the code (for the brief, and when you ask it to look closer at a feature)' });
    const save = () => act(async () => {
      await api('PUT', `/api/requirements/context/${s.scopeType}/${encodeURIComponent(s.scopeKey)}`, { body: area.value, lookAtCode: look.checked });
      notesDraft = null; notesBase = null;
      if (notesEditing) { notesEditing = false; briefFocusNext = 'notes-edit'; }
      say('Notes saved.', 'ok');
      await paint();
    });
    return h('section', { class: 'card req-brief-notes', 'aria-label': 'Your notes for Worca' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Your notes for Worca' })),
      area,
      lookRow,
      h('div', { class: 'req-brief-notes-foot' },
        onCancel ? h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'notes-cancel', onclick: onCancel }, 'Cancel') : null,
        h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'notes-save', onclick: save }, 'Save notes')));
  }

  // ---- the brief page once made (board Brief.dc.html; A7 §6 "Board 12 states" and "Elsewhere") ----

  /** The header: the title and target chip; once made, the chips, Export ▾ and ⋯, and a failed refresh under them. */
  function briefHead(data, name, made) {
    const s = briefShown;
    const title = h('div', { class: 'req-head-title' }, h('h2', { text: 'Product brief' }), h('span', { class: 'chip', text: briefLabel(s, name) }));
    if (!made) {
      return h('div', { class: 'req-brief-head' },
        h('div', { class: 'req-brief-head-row' }, h('div', { class: 'req-brief-head-main' }, title)),
        h('p', { class: 'req-sub', text: `What the product does, in your words and Worca's. Every interview for ${name} starts from it.` }));
    }
    const b = data.brief;
    const making = b.status === 'making';
    const failed = !making && b.error && b.error.message ? String(b.error.message) : null;
    return h('div', { class: 'req-brief-head' },
      h('div', { class: 'req-brief-head-row' },
        h('div', { class: 'req-brief-head-main' }, title,
          h('div', { class: 'req-brief-chips' }, ...briefChips(data), making ? h('span', { class: 'badge running', text: 'Refreshing' }) : null)),
        h('div', { class: 'req-head-tools' }, exportMenu(), moreMenu(data))),
      failed ? h('p', { class: 'form-msg err req-brief-refresh-failed', role: 'status' }, `The last refresh failed: ${failed} `,
        refreshButton(data, 'Refresh', 'brief-refresh-again')) : null);
  }

  /** "Made from <branch @ sha> · <age> ago" (a workspace: its number of projects), the cost, the features using it,
   *  and for a workspace seeded from its map, when the map was scanned. */
  function briefChips(data) {
    const b = data.brief;
    const a = age(b.madeAt);
    const when = a === 'today' || a === 'yesterday' ? a : a ? `${a} ago` : '';
    const srcs = (b.sources || []).filter((x) => x && typeof x.sha === 'string' && x.sha);
    let from;
    if (briefShown.scopeType === 'workspace' && srcs.length) from = [`Made from ${plural(srcs.length, 'project')}`];
    else if (srcs.length) from = ['Made from ', h('code', { text: `${srcs[0].branch ? `${srcs[0].branch} @ ` : ''}${srcs[0].sha.slice(0, 7)}` })];
    else from = ['Made'];
    const used = (data.usedBy || []).length;
    const docs = docsOf(data).length;
    const seed = b.seed && b.seed.kind === 'workspace-map' ? b.seed : null;
    return [
      h('span', { class: 'chip' }, ...from, when ? (srcs.length ? ` · ${when}` : ` ${when}`) : ''),
      h('span', { class: 'chip', text: usd(b.costUsd) }),
      h('span', { class: 'chip', text: `Used by ${plural(used, 'feature')}` }),
      docs ? h('span', { class: 'chip', text: plural(docs, 'document') }) : null,   // A8 board 19
      seed ? h('span', { class: 'chip', text: `Built from the workspace map${seed.scannedAt ? `, scanned ${String(seed.scannedAt).slice(0, 10)}` : ''}` }) : null,
    ];
  }

  const estimateText = (data) => (data.estimate && typeof data.estimate.costUsd === 'number' ? ` · about ${usd(data.estimate.costUsd)}` : '');
  /** A Refresh button (the notice's, the failed refresh's): the same POST as Create, disabled while the brief is made. */
  function refreshButton(data, label, key) {
    const making = !!(data.brief && data.brief.status === 'making');
    // a refresh checks out the code again: hidden while git is missing (git-gate.mjs)
    return h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': key, 'data-brief-go': true, 'data-needs-git': true, disabled: creating || making, onclick: createBrief }, label);
  }

  function exportMenu() {
    const s = briefShown;
    const copy = () => act(async () => {
      const res = await fetch(`${briefApi(s)}/markdown`);
      if (!res.ok) throw new Error(`Could not copy the Markdown (HTTP ${res.status}).`);
      await navigator.clipboard.writeText(await res.text());
      say('Copied as Markdown.', 'ok');
    });
    return menu('brief-export', h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'brief-export' }, 'Export', sharedIcon(document, 'chevron-down', 14)), [
      menuItem('Copy Markdown', copy, { ui: 'mi-brief-copy' }),
      h('a', { role: 'menuitem', class: 'menu-item req-menu-item', 'data-ui': 'mi-brief-download', href: `${briefApi(s)}/markdown?download=1`, download: '' }, 'Download .md'),
    ]);
  }

  // ⋯: Refresh the brief (D7) and Delete the brief, whose confirmation names the features using it (§6).
  function moreMenu(data) {
    const s = briefShown;
    const making = data.brief.status === 'making';
    const refresh = menuItem(`Refresh the brief${estimateText(data)}`, createBrief, { disabled: creating || making, ui: 'mi-brief-refresh' });
    refresh.setAttribute('data-brief-go', '');
    refresh.dataset.needsGit = '';   // a refresh checks out the code again: hidden while git is missing (git-gate.mjs)
    const del = () => act(async () => {
      const ids = ((briefData && briefData.usedBy) || []).map((u) => u && (u.id || (u.seq != null ? `FEAT-${u.seq}` : null))).filter(Boolean);
      const who = !ids.length ? 'No feature uses this brief yet.'
        : ids.length === 1 ? `${ids[0]} uses this brief; it goes back to looking at the code when asked.`
          : `${joinAnd(ids)} use this brief; they go back to looking at the code when asked.`;
      // A8 (design §6): the brief's documents go with it
      const nDocs = docsOf(briefData).length;
      const docsWord = nDocs === 1 ? ' Its 1 document is deleted too.' : nDocs ? ` Its ${nDocs} documents are deleted too.` : '';
      if (!window.confirm(`Delete the brief? ${who}${docsWord}`)) return;
      briefEditing = null; briefEditVal = null; notesEditing = false;
      const data = await api('DELETE', briefApi(s));
      briefFocusNext = 'brief-create';
      paintAnswer(s, data);
      say('The brief is deleted.', 'ok');
    });
    return menu('brief-more', h('button', { type: 'button', class: 'req-ico', 'aria-label': 'More actions', title: 'More actions', 'data-ui': 'brief-more' },
      icon(ICONS.dots, { size: 18, fill: 'currentColor', stroke: 'none' })), [
      refresh,
      menuItem('Delete the brief', del, { disabled: making, ui: 'mi-brief-delete' }),
    ]);
  }

  // The newest commits the staleness check reads files of (D9: `commitFilesSince … -n 2000`).
  const STALE_SCAN = 2000;
  /** "A", "A and B", "A, B and C", each bold. */
  const boldList = (xs) => xs.flatMap((x, i) => [i === 0 ? null : i === xs.length - 1 ? ' and ' : ', ', h('b', { text: x })]).filter(Boolean);
  const STALE_REASON = Object.freeze({
    missing: (branch, ws) => [ws ? "a project's folder is missing." : "the project's folder is missing."],
    removed: () => ['none of the projects it was made from is in the workspace any more.'],
    'branch-gone': (branch) => (branch ? ['the branch ', h('code', { text: branch }), ' no longer exists.'] : ['its branch no longer exists.']),
    rewritten: (branch) => (branch ? ['the commit this brief was made from is no longer on ', h('code', { text: branch }), '.']
      : ['the commit this brief was made from is no longer on its branch.']),
    slow: () => ['checking took too long; reload to try again.'],
  });

  /**
   * The code moved on since this brief (board 12, D9): the commits since, the areas they change, and one Refresh
   * (D7/Q2); or, when that cannot be told, why. None when nothing moved on, when the areas were not checked, or
   * when the product owner owns What exists today (D6).
   */
  function staleNotice(data) {
    const b = data.brief;
    const st = data.staleness;
    if (!st || typeof st !== 'object' || (b.edited && b.edited.areas)) return null;
    const ws = briefShown.scopeType === 'workspace';
    const unknown = ws && Array.isArray(st.unknown) ? st.unknown.filter(Boolean) : [];
    const added = ws && Array.isArray(st.added) ? st.added.filter(Boolean) : [];
    const members = [
      unknown.length ? h('p', { class: 'req-brief-stale-unknown', text: `Not checked: ${joinAnd(unknown)}.` }) : null,
      added.length ? h('p', { class: 'req-brief-stale-added', text: `${joinAnd(added)} joined after this brief; refresh to include them.` }) : null,
    ];
    // Nothing moved on: a workspace still says which members the brief does not cover, as a small note.
    const small = () => (unknown.length || added.length ? h('div', { class: 'hint req-brief-members', role: 'note' }, ...members,
      added.length ? h('div', { class: 'req-actions' }, refreshButton(data, `Refresh${estimateText(data)}`, 'brief-refresh')) : null) : null);
    // Without git nothing is known about the code (routes.mjs answers reason 'no-git'): a quiet note, not the amber box.
    if (st.known === false && st.reason === 'no-git') {
      return h('p', { class: 'hint req-brief-nogit', role: 'note', text: `Worca cannot check this brief against the code: ${GIT_MISSING_TEXT}.` });
    }
    let says;
    if (st.known === true) {
      const n = Number(st.commits) || 0;
      if (n <= 0 || st.checked === false) return small();
      const m = Number(st.touching) || 0;
      const areas = Array.isArray(st.areas) ? st.areas.filter((x) => typeof x === 'string' && x) : [];
      const src = (Array.isArray(st.sources) && st.sources[0]) || (b.sources || [])[0] || {};
      const sha = typeof src.sha === 'string' ? src.sha.slice(0, 7) : '';
      const where = ws ? [' in its projects since this brief']
        : [...(src.branch ? [' on ', h('code', { text: src.branch })] : []), ...(sha ? [' since ', h('code', { text: sha })] : [' since this brief'])];
      // partial (D9): the file scan read only the newest STALE_SCAN commits, so the area count is of those, and says so
      const partial = !!st.partial && n > STALE_SCAN;
      const of = partial ? `; of the newest ${STALE_SCAN}, ` : '; ';
      const some = partial ? `${m}` : `${m} of them`;
      const what = m <= 0 ? [`${of}${partial ? 'none' : 'none of them'} change areas the brief describes.`]
        : areas.length ? [`${of}${some} ${m === 1 ? 'changes' : 'change'} areas the brief describes: `, ...boldList(areas), '.']
          : [`${of}${some} ${m === 1 ? 'changes' : 'change'} areas the brief describes.`];
      says = [partial ? `More than ${STALE_SCAN} commits` : plural(n, 'commit'), ...where, ...what, ' Interviews still use the brief as it is.'];
    } else if (st.known === false) {
      const branch = st.branch || ((Array.isArray(st.sources) ? st.sources : []).find((x) => x && x.known === false && x.branch) || {}).branch || null;
      const why = STALE_REASON[st.reason];
      says = why ? ['Worca cannot tell how far the code moved on: ', ...why(branch, ws)] : ['Worca cannot tell how far the code moved on.'];
    } else return small();
    return h('section', { class: 'req-changed req-brief-stale', 'aria-label': 'The brief is behind the code' },
      icon(ICONS.warn, { size: 18 }),
      h('div', { class: 'req-changed-body' },
        h('b', { text: st.known === false ? 'Worca cannot check this brief against the code' : 'The code moved on since this brief' }),
        h('p', { class: 'req-brief-stale-text' }, ...says),
        ...members,
        h('div', { class: 'req-actions' }, refreshButton(data, `Refresh${estimateText(data)}`, 'brief-refresh'))));
  }

  // A8 (board 19): a made brief's documents (a page from before A8 has none), and a brief item's source (D13) as
  // "(from <name>)" after its text.
  const docsOf = (data) => (data && Array.isArray(data.documents) ? data.documents : []);
  const fromHint = (x) => (x && typeof x.source === 'string' && x.source ? h('span', { class: 'hint req-brief-src', text: ` (from ${x.source})` }) : null);

  /** One section's body as read (D2, §6): the product text, users with the name bold, terms as a grid, areas as rows. */
  function briefSectionBody(key, value) {
    const none = () => h('p', { class: 'hint', text: 'Not yet.' });
    if (key === 'product') return typeof value === 'string' && value.trim() ? h('p', { class: 'req-brief-product', text: value }) : none();
    const list = Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') : [];
    if (!list.length) return none();
    if (key === 'users') return h('ul', { class: 'req-brief-users' }, ...list.map((u) => h('li', {}, h('b', { text: u.name || '' }), u.can ? `: ${u.can}` : '', fromHint(u))));
    if (key === 'terms') return h('div', { class: 'req-brief-terms' }, ...list.flatMap((t) => [h('b', { text: t.term || '' }), h('span', {}, t.meaning || '', fromHint(t))]));
    return h('div', { class: 'req-brief-areas' }, ...list.map((a) => {
      const st = AREA_STATUS[a.status];
      return h('div', { class: 'req-brief-area' },
        h('span', {}, h('b', { text: areaLabel(a) || '' }), a.text ? ` · ${a.text}` : '', fromHint(a)),
        st ? ' ' : null, st ? h('span', { class: `badge ${st.cls}`, text: st.label }) : null);
    }));
  }

  // One section with its head (the pencil, "· edited by you", Let Worca rewrite this) and its body, or A1's inline
  // editor (§3 text, Save / Cancel). Editable while a refresh runs (D6).
  function briefSection(b, key, title) {
    const s = briefShown;
    const edited = !!(b.edited && b.edited[key]);
    const value = (b.sections || {})[key];
    const url = `${briefApi(s)}/sections/${key}`;
    let body;
    if (briefEditing === key) {
      const text = briefEditVal && briefEditVal.key === key ? briefEditVal.text : briefSectionText(key, value);
      const lines = text.split('\n').length;
      const ta = h('textarea', { rows: String(Math.min(14, Math.max(5, lines + 2))), 'aria-label': title, 'data-ui': 'brief-edit-text' });
      ta.value = text;
      const save = () => act(async () => {
        if (briefSaving) return;
        briefSaving = true;
        try {
          const out = await api('PUT', url, { value: ta.value });
          briefEditing = null; briefEditVal = null; briefFocusNext = `brief-edit-${key}`;
          paintAnswer(s, out);
        } finally { briefSaving = false; }
      });
      body = h('div', { class: 'req-edit' }, ta,
        BRIEF_FORMAT[key] ? h('p', { class: 'hint', text: BRIEF_FORMAT[key] }) : null,
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { briefEditing = null; briefEditVal = null; briefFocusNext = `brief-edit-${key}`; redrawBrief(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Save')));
    } else body = briefSectionBody(key, value);
    const rewrite = () => act(async () => { briefFocusNext = `brief-edit-${key}`; paintAnswer(s, await api('DELETE', `${url}/edited`)); });
    return h('section', { class: 'req-sect', 'data-section': key },
      h('div', { class: 'req-sect-head' },
        h('h4', {}, title, edited ? h('span', { class: 'req-edited', text: ' · edited by you' }) : null),
        edited ? h('button', { type: 'button', class: 'link-btn req-rewrite', 'aria-label': `Let Worca rewrite this — ${title}`, onclick: rewrite }, 'Let Worca rewrite this') : null,
        icoBtn('pencil', `Edit ${title}`, () => { briefEditing = key; briefEditVal = null; briefFocusNext = 'brief-edit-text'; redrawBrief(); },
          { cls: null, 'data-ui': `brief-edit-${key}` })),
      body);
  }

  const briefCard = (b) => h('section', { class: 'card req-brief-card', 'aria-label': 'The brief' }, ...BRIEF_SECTIONS.map(([key, title]) => briefSection(b, key, title)));

  /** The right column: How Worca uses it (with the features using the brief), Your notes for Worca, What Worca read. */
  function briefSide(data, name) {
    const b = data.brief;
    const used = (data.usedBy || []).filter((u) => u && u.seq != null);
    const featureLink = (u) => h('a', { class: 'req-brief-link', href: `#requirements/feature/${u.seq}`,
      onclick: (e) => { e.preventDefault(); route(`feature/${u.seq}`); } }, u.id || `FEAT-${u.seq}`);
    const notesBody = data.notes && typeof data.notes.body === 'string' ? data.notes.body : '';
    const notes = notesEditing
      ? notesCard(data, { onCancel: () => { notesEditing = false; notesDraft = null; briefFocusNext = 'notes-edit'; redrawBrief(); } })
      : h('details', { class: 'card req-brief-notes-read', open: briefFolds.notes },
        h('summary', {}, 'Your notes for Worca'),
        notesBody.trim() ? h('p', { text: notesBody }) : h('p', { class: 'hint', text: 'No notes yet.' }),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'notes-edit',
          onclick: () => { notesEditing = true; notesDraft = null; briefFocusNext = 'notes-body'; redrawBrief(); } }, 'Edit notes'));
    const files = Array.isArray(b.files) ? b.files.filter((p) => typeof p === 'string') : [];
    const reads = docsOf(data).length ? `Every interview round for ${name} reads the brief and these documents. ` : `Every interview round for ${name} reads it. `;
    return h('aside', { class: 'req-brief-side' },
      docsCard(data, name),
      h('section', { class: 'card req-brief-how', 'aria-label': 'How Worca uses it' },
        h('h3', { text: 'How Worca uses it' }),
        h('p', {}, `${reads}New features no longer need their own look at the code; `,
          h('b', { text: 'Look closer' }), ' on a feature adds one when the brief is not enough.'),
        used.length ? h('p', { class: 'req-brief-used' }, 'Used by ', ...used.flatMap((u, i) => [i ? ', ' : null, featureLink(u)])) : null),
      notes,
      h('details', { class: 'card req-brief-read', open: briefFolds.read, 'data-min-level': 'advanced' },   // as a look's files (docs/ui-levels.md)
        h('summary', {}, 'What Worca read', ' ', h('span', { class: 'hint req-brief-read-n', text: plural(files.length, 'file') })),
        files.length ? h('ul', { class: 'req-brief-files' }, ...files.map((p) => h('li', { text: p }))) : null));
  }

  // ---- the feature page (board Interview.dc.html): header, the conversation left, Ready + spec right ----

  // Every round with its number, questions, note and the latest answers given (a revision supersedes).
  function roundsOf(turns) {
    const latest = new Map();
    for (const t of turns) if (t.kind === 'answers') latest.set(t.payload.roundTurnId, t.payload.answers || []);
    let n = 0;
    return turns.filter((t) => t.kind === 'round').map((t) => ({
      turnId: t.id, n: ++n, questions: t.payload.questions || [], note: t.payload.note || '',
      given: new Map((latest.get(t.id) || []).map((a) => [a.id, a])),
    }));
  }

  // The question card: the pending round (recommended answers preselected), or with `revise` an earlier
  // round prefilled from its latest answers (design D12), posted as a revision of that round.
  function questionCard(f, round, { revise = false } = {}) {
    let d = revise ? revDraft : draft;
    if (!d || d.roundTurnId !== round.turnId) {
      d = { roundTurnId: round.turnId, picks: {}, texts: {}, drafted: {} };
      for (const q of round.questions) {
        const a = revise && round.given ? round.given.get(q.id) : null;
        if (a && a.answer) { if (q.options.includes(a.answer)) d.picks[q.id] = a.answer; else d.texts[q.id] = a.answer; }
        else if (q.recommended) d.picks[q.id] = q.recommended;
      }
      if (revise) revDraft = d; else draft = d;
    }
    if (!d.drafted) d.drafted = {};
    if (!revise) applyHelperDrafts(round, d);   // A3 D6: Worca's drafts, on the pending card only
    const count = h('span', { class: 'qanswered' });
    const recount = () => {
      const n = round.questions.filter((q) => d.picks[q.id] || d.texts[q.id]).length;
      count.textContent = `${n} of ${round.questions.length} answered`;
    };
    const answers = () => round.questions.map((q) => (d.texts[q.id] ? { id: q.id, text: d.texts[q.id] }
      : d.picks[q.id] ? { id: q.id, option: d.picks[q.id] } : null)).filter(Boolean);
    const post = (extra) => act(async () => {
      await api('POST', `/api/requirements/${f.seq}/answers`, { roundTurnId: round.turnId, ...extra, answers: answers() });
      // a revision sent: the focus goes back to that round's Change, as soon as it is on screen again
      if (revise) { revDraft = null; revising = null; focusLater = `change-${round.turnId}`; } else draft = null;
      await paint();
    });
    const foot = revise
      ? [h('button', { type: 'button', class: 'btn btn-sm req-revise-cancel',
        onclick: () => { revising = null; revDraft = null; focusNext = `change-${round.turnId}`; redraw(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => post({}) }, 'Submit changes')]
      : [h('button', { type: 'button', class: 'btn btn-sm req-finish', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/finish`, {}); await paint(); }) }, 'Finish now'),
        h('button', { type: 'button', class: 'btn btn-sm req-skip', onclick: () => post({ useRecommended: true }) }, 'Skip, use recommended'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => post({}) }, 'Submit')];
    const panel = h('div', { class: `qpanel req-q${revise ? ' req-revise' : ''}` },
      h('div', { class: 'qpanel-head' }, h('b', { text: revise ? `Change round ${round.n}` : 'Your turn' }),
        h('span', { class: 'qcount', text: plural(round.questions.length, 'question') })),
      round.note ? h('p', { class: 'hint req-q-note', text: round.note }) : null,
      ...round.questions.map((q, i) => {
        const buttons = q.options.map((o, k) => h('button', { type: 'button', class: 'qopt', 'data-key': KEYS[k], 'data-ui': `q-${round.turnId}-${i}-${k}`,
          'aria-pressed': d.picks[q.id] === o && !d.texts[q.id] ? 'true' : 'false' },
          h('span', { class: 'qopt-txt', text: o }), o === q.recommended ? h('span', { class: 'qrec', text: 'Recommended' }) : null));
        const free = h('input', { class: 'qfree', type: 'text', value: d.texts[q.id] || '', placeholder: 'Or type your own answer…', 'aria-label': `Your own answer to: ${q.question}` });
        // A3 D6: Worca's draft: the chip after the options row (the options are buttons: no button inside one), its × and its why
        const why = !revise && d.drafted[q.id] != null ? draftWhy(d.drafted[q.id], q.id) : '';
        const chip = revise ? null : h('div', { class: 'req-help-drafted-row', hidden: d.drafted[q.id] == null },
          // the × is the remove icon (no glyph as an icon, ui-design-language)
          h('span', { class: 'req-help-drafted' }, 'drafted by Worca',
            h('button', { type: 'button', class: 'req-help-drafted-x', 'aria-label': `Clear Worca's draft for question ${i + 1}`, 'data-ui': `undraft-${round.turnId}-${i}`,
              onclick: () => {   // back to the recommended pick, not to "nothing picked"
                delete d.drafted[q.id];
                delete d.texts[q.id];
                if (q.recommended) d.picks[q.id] = q.recommended; else delete d.picks[q.id];
                free.value = '';
                sync();
                (buttons[Math.max(0, q.options.indexOf(q.recommended))] || buttons[0]).focus();
              } }, icon(ICONS.remove, { size: 12 }))),
          why ? h('p', { class: 'hint req-help-draft-why', text: `Worca's draft: ${why}` }) : null);
        const sync = () => {
          buttons.forEach((b, k) => { const on = !d.texts[q.id] && d.picks[q.id] === q.options[k]; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('sel', on); });
          free.classList.toggle('has', !!d.texts[q.id]);
          if (chip) chip.hidden = d.drafted[q.id] == null;
          recount();
        };
        // picking or typing by hand removes the mark (D6)
        buttons.forEach((b, k) => b.addEventListener('click', () => { d.picks[q.id] = q.options[k]; delete d.texts[q.id]; delete d.drafted[q.id]; free.value = ''; sync(); }));
        free.addEventListener('input', () => { const v = free.value.trim(); if (v) { d.texts[q.id] = v; delete d.picks[q.id]; } else delete d.texts[q.id]; delete d.drafted[q.id]; sync(); });
        queueMicrotask(sync);
        const qtext = h('div', { class: 'qtext', id: `qtext-${round.turnId}-${i}` }, h('span', { class: 'qn', text: String(i + 1) }), q.question);
        return h('div', { class: 'qblock' },
          // A3 D1: Help me answer, on the pending round's questions only (not on an earlier round being changed)
          revise ? qtext : h('div', { class: 'req-qhead' }, qtext, h('button', { type: 'button', class: 'link-btn req-help-ask', 'data-ui': `help-${round.turnId}-${i}`, 'aria-describedby': `qtext-${round.turnId}-${i}`,
            onclick: () => helpMeAnswer(f, round, q, i) }, 'Help me answer')),
          // A8 (board 16): a question that came from a file names it before its why
          q.why || q.source ? h('div', { class: 'hint req-why' }, q.source ? h('span', { class: 'req-why-src', text: `From ${q.source}: ` }) : null, q.why || '') : null,
          h('div', { class: 'qopts' }, ...buttons), chip, free);
      }),
      h('div', { class: 'qpanel-foot' }, count, ...foot));
    recount();
    return panel;
  }

  // Earlier rounds: one card, each answered question with its latest answer, a Change per round (D12).
  // The round waiting for answers is the question card instead.
  function earlierRounds(f, rounds) {
    const open = !isLocked(f);
    const shown = rounds.filter((r) => !(f.pending && r.turnId === f.pending.turnId));
    if (!shown.length) return null;
    return h('section', { class: 'card req-rounds' }, h('h3', { text: 'Earlier rounds' }),
      ...shown.map((r) => h('div', { class: 'req-round', 'data-round': r.turnId },
        h('div', { class: 'req-round-head' }, h('span', { class: 'req-round-n', text: `Round ${r.n}` }),
          open && r.questions.length && revising !== r.turnId
            ? h('button', { type: 'button', class: 'hint req-link req-change', 'data-ui': `change-${r.turnId}`, 'aria-label': `Change round ${r.n}`,
              onclick: () => { revising = r.turnId; revDraft = null; focusNext = `q-${r.turnId}-0-0`; redraw(); } }, 'Change')
            : null),
        r.note ? h('p', { class: 'hint req-round-note', text: r.note }) : null,
        ...r.questions.map((q) => {
          const a = r.given.get(q.id);
          return h('div', { class: 'req-round-q' },
            h('div', { class: 'req-round-qt', text: q.question }),
            h('div', { class: 'req-round-answer' }, a ? `→ ${a.answer}` : 'Not answered',
              a && a.recommended ? ' ' : null, a && a.recommended ? h('code', { text: 'recommended' }) : null));
        }))));
  }

  // A8 D2: a feature created with files reads them before round 1. One role=status node for the page, moved into
  // each paint and updated in place, so a screen reader announces the count as it drops (2 → 1).
  function readingLine(f) {
    const n = (f.attachments || []).filter((a) => a && a.status === 'reading').length;
    if (!n || (Number(f.rounds) || 0) > 0 || f.pending) { readingEl = null; return null; }
    if (!readingEl) {
      readingEl = h('p', { class: 'req-reading', role: 'status' }, h('span', { class: 'badge blue' }), ' ',
        h('span', { class: 'hint', text: 'Worca reads the files first, then shows round 1.' }));
    }
    const badgeEl = readingEl.querySelector('.badge');
    const words = `Reading ${plural(n, 'file')}…`;
    if (badgeEl.textContent !== words) badgeEl.textContent = words;
    return readingEl;
  }

  function conversation(f, turns, rounds, moved = null) {
    const working = isWorking(f);
    const open = !isLocked(f);
    let rev = null;
    if (revising != null) {
      rev = rounds.find((r) => r.turnId === revising && r.questions.length) || null;
      if (!rev) { revising = null; revDraft = null; }
    }
    const hasStarts = (f.starts || []).length > 0;
    // The current card: a round being changed, the pending round, Ready to build, or Decide (A2 §5).
    const card = !open ? null
      : rev ? questionCard(f, rev, { revise: true })
        : f.pending ? questionCard(f, { ...f.pending, n: rounds.find((r) => r.turnId === f.pending.turnId)?.n })
          : buildCardShown(f) ? buildCard(f)
            : f.state === 'decide' || decideNeeded(f) ? decideCard(f)
              : null;
    return h('div', { class: 'req-left' },
      hasStarts ? runsCard(f) : null,
      hasStarts && (f.changedSinceStart || []).length ? changedNotice(f) : null,
      f.status === 'archived' ? h('p', { class: 'hint req-note', text: 'This feature is archived. Restore it to continue.' }) : null,
      readingLine(f) || (working ? h('p', { class: 'hint req-working', text: f.status === 'looking' ? 'Worca is looking at the code…' : 'Worca is thinking…' }) : null),
      open && f.lastError ? h('div', { class: 'req-error form-msg err' }, f.lastError, ' ',
        h('button', { type: 'button', class: 'btn btn-sm req-retry', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/retry`, {}); await paint(); }) }, 'Try again')) : null,
      card,
      moved,   // A3 D2: Ready to start?, Files and Spec, while Ask Worca takes the right column
      earlierRounds(f, rounds),
      f.brief ? knowsCard(f, turns) : orientationBox(f, turns));
  }

  // ---- Decide (board Decisions.dc.html, A2 D3/D4): Confirm / Reject per assumption, Confirm the N left,
  // and the follow-up round on the rejected ones not yet asked about ----
  // The Confirm / Reject toggle of one assumption (Decide card and spec card): a role=group of two
  // aria-pressed buttons; pressing the pressed one reopens it (A1). Both stay disabled while the POST runs,
  // across a live repaint too, so a double click never posts twice. `prefix` keeps the data-ui unique.
  function assumeToggle(f, a, { prefix = '', disabled = false, extraCls = '' } = {}) {
    const groupButtons = () => host.querySelectorAll(`[data-assume-toggle="${a.id}"] button`);
    const set = (status) => {
      if (assumePosting.has(a.id)) return;
      assumePosting.add(a.id);
      for (const b of groupButtons()) b.disabled = true;
      void act(async () => {
        try { await api('POST', `/api/requirements/${f.seq}/assumptions/${a.id}`, { status }); } finally { assumePosting.delete(a.id); }
        await paint();
      }).then(() => { for (const b of groupButtons()) if (!assumePosting.has(a.id)) b.disabled = disabled; });
    };
    const btn = (label, status, cls, key) => {
      const on = a.status === status;
      return h('button', { type: 'button', class: `${cls}${extraCls ? ` ${extraCls}` : ''}${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        'aria-label': `${label} ${a.id}`, 'data-ui': `${prefix}${key}-${a.id}`, disabled: disabled || assumePosting.has(a.id),
        onclick: () => set(on ? 'open' : status) }, label);
    };
    return h('div', { class: 'seg seg-sm req-toggle', role: 'group', 'aria-label': `Decide ${a.id}`, 'data-assume-toggle': a.id },
      btn('Confirm', 'confirmed', 'req-yes req-confirm', 'confirm'), btn('Reject', 'rejected', 'req-no req-reject', 'reject'));
  }

  // A8 D8: the files to ask about, in upload order, once none of them is still being read: Worca starts the follow-up
  // itself when the read is done, and it takes them all then (the server asks only about files whose text the prompt
  // carries). While one is read the Decide panel offers no file button.
  const askableFiles = (f) => {
    const files = (f.attachments || []).filter((a) => a && (f.unaskedFiles || []).includes(a.id));
    return files.some((a) => a.status === 'reading') ? [] : files.filter((a) => a.status === 'done');
  };

  function decideCard(f) {
    const all = (f.spec && f.spec.assumptions) || [];
    const waitingIds = f.unaskedRejections || [];
    const fileNames = askableFiles(f).map((a) => a.name);
    const post = (path, body) => act(async () => { await api('POST', `/api/requirements/${f.seq}/${path}`, body); await paint(); });
    // One follow-up covers both (POST …/follow-up): "Ask about A-4 and b.pdf"; without files, A2's "Done, ask about A-4".
    const askItems = [...waitingIds, ...fileNames];
    const askLabel = fileNames.length
      ? `Ask about ${askItems.length <= 2 ? joinAnd(askItems) : `${askItems[0]} and ${askItems.length - 1} more`}`
      : `Done, ask about ${waitingIds[0]}${waitingIds.length > 1 ? ` and ${waitingIds.length - 1} more` : ''}`;
    const askBtn = askItems.length ? h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'follow-up', onclick: () => post('follow-up', {}) }, askLabel) : null;
    if (!all.length) {
      const done = h('p', { class: 'hint req-note', text: 'The interview is done. Edit the spec on the right; every change is kept.' });
      return askBtn ? h('section', { class: 'qpanel req-decide', 'aria-label': fileNames.length === 1 ? 'Ask about the new file' : 'Ask about the new files' },
        done, h('div', { class: 'qpanel-foot' }, askBtn)) : done;
    }
    const open = all.filter((a) => a.status === 'open');
    const waiting = all.filter((a) => a.status === 'rejected' && waitingIds.includes(a.id));
    const rest = all.filter((a) => !open.includes(a) && !waiting.includes(a));
    const rejected = all.filter((a) => a.status === 'rejected').length;
    const row = (a) => h('div', { class: `req-arow ${a.status}`, 'data-decide': a.id },
      h('code', { class: 'req-id', text: a.id }),
      h('span', { class: 'req-arow-text', text: a.text }),
      assumeToggle(f, a, { prefix: 'decide-' }));
    return h('section', { class: 'qpanel req-decide', 'aria-label': 'Decide the assumptions' },
      h('div', { class: 'qpanel-head' }, icon(ICONS.ask, { size: 17, width: 1.8 }), h('b', { text: 'Decide the assumptions' }),
        h('span', { class: 'qcount', text: `${open.length} of ${all.length} left` })),
      h('p', { class: 'hint req-decide-note', text: 'Worca filled these gaps itself. Confirm what is right, reject what is not: a rejected one is asked again in one short round.' }),
      h('div', { class: 'req-arows' }, ...open.map(row), ...waiting.map(row), ...(ui.decideMore ? rest.map(row) : [])),
      rest.length ? h('button', { type: 'button', class: 'hint req-link req-decide-more', 'aria-expanded': ui.decideMore ? 'true' : 'false', 'data-ui': 'decide-more',
        onclick: () => { ui.decideMore = !ui.decideMore; focusNext = 'decide-more'; redraw(); } }, ui.decideMore ? 'Show fewer' : `Show the other ${rest.length}`) : null,
      h('div', { class: 'qpanel-foot' },
        h('span', { class: 'qanswered', text: `${all.length - open.length} decided · ${rejected} rejected` }),
        open.length ? h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'confirm-all', onclick: () => post('assumptions', { confirmOpen: true }) },
          `Confirm the ${open.length} left`) : null,
        askBtn));
  }

  // Something to decide, from the data rather than the state (A2 D11): a started feature still decides its
  // assumptions and asks about the rejected ones (the state there is `started`, never `decide`).
  const decideNeeded = (f) => !f.pending && f.status === 'done'
    && (((f.spec && f.spec.assumptions) || []).some((a) => a.status === 'open') || (f.unaskedRejections || []).length > 0
      || askableFiles(f).length > 0);

  // The Ready to build card is the current card: Ready, nothing to answer or change, not locked.
  const buildCardShown = (f) => f.state === 'ready' && !isLocked(f) && !f.pending && revising == null;

  // ---- Ready to build (board Ready.dc.html, A2 D6): what Start does, the workflow and base branch ----
  // The choices of a feature, kept per seq; a feature already started defaults to its last start's.
  function choiceOf(f) {
    let c = choices.get(f.seq);
    if (!c) {
      const last = (f.starts || [])[0];
      c = { workflowId: (last && last.workflowId) || AUTO_WORKFLOW, sourceBranch: (last && last.sourceBranch) || '', open: false };
      choices.set(f.seq, c);
    }
    return c;
  }
  // The version the next start saves the spec as: the latest start's + 1 (1 before any start).
  const nextVersion = (f) => ((((f.starts || [])[0]) || {}).version || 0) + 1;
  const projectPath = (f) => (f.scopeType === 'project' ? targets.projects.find((p) => p.key === f.scopeKey)?.path || null : null);
  const workflowName = (id) => (id === AUTO_WORKFLOW ? 'Auto' : (Array.isArray(workflows) && workflows.find((w) => w.id === id)?.name) || id);
  // Repaint for a list that just arrived, only while the Ready to build card is on screen.
  const redrawBuild = () => { if (current && host.querySelector('.req-build')) redraw(); };
  function loadBuildOptions(f) {
    if (workflows == null) {
      workflows = 'loading';
      api('GET', '/api/workflows').then((d) => { workflows = (d.workflows || []).filter((w) => w && w.id && !NOT_FOR_BUILDS.includes(w.id)); workflowsFailed = false; },
        () => { workflows = []; workflowsFailed = true; }).then(redrawBuild);
    }
    const dir = projectPath(f);
    if (dir && !branchLists.has(dir)) {
      branchLists.set(dir, 'loading');
      api('GET', `/api/branches?projectDir=${encodeURIComponent(dir)}`)
        .then((d) => { branchLists.set(dir, { branches: d.branches || [], current: d.current || null }); },
          () => { branchLists.set(dir, { branches: [], current: null }); }).then(redrawBuild);
    }
  }
  function buildChoices(f, c, chipBranch) {
    const opt = (value, text) => h('option', { value, text });
    const wfs = Array.isArray(workflows) ? workflows : [];
    const wf = h('select', { id: 'req-build-wf', 'data-ui': 'build-workflow' }, opt(AUTO_WORKFLOW, 'Auto'), ...wfs.map((w) => opt(w.id, w.name || w.id)),
      c.workflowId !== AUTO_WORKFLOW && !wfs.some((w) => w.id === c.workflowId) ? opt(c.workflowId, c.workflowId) : null);
    wf.value = c.workflowId;
    wf.addEventListener('change', () => { c.workflowId = wf.value || AUTO_WORKFLOW; redraw(); });
    let branch;
    if (f.scopeType === 'workspace') {
      branch = h('input', { type: 'text', id: 'req-build-branch', 'data-ui': 'build-branch', value: c.sourceBranch,
        placeholder: "Branch for every project (empty: each project's default)", 'aria-label': 'Branch for every project' });
      branch.addEventListener('input', () => { c.sourceBranch = branch.value.trim(); chipBranch.textContent = `Branch from · ${c.sourceBranch || 'default'}`; });
    } else {
      const list = branchLists.get(projectPath(f));
      const known = list && list !== 'loading' ? list : { branches: [], current: null };
      branch = h('select', { id: 'req-build-branch', 'data-ui': 'build-branch' },
        opt('', known.current ? `Project default (${known.current})` : 'Project default'), ...known.branches.map((b) => opt(b, b)),
        c.sourceBranch && !known.branches.includes(c.sourceBranch) ? opt(c.sourceBranch, c.sourceBranch) : null);
      branch.value = c.sourceBranch;
      branch.addEventListener('change', () => { c.sourceBranch = branch.value; redraw(); });
    }
    return h('div', { class: 'req-build-choices' },
      h('div', { class: 'req-build-field' }, h('label', { for: 'req-build-wf', text: 'Workflow' }), h('div', { class: 'select-wrap' }, wf),
        workflowsFailed ? h('span', { class: 'hint warn req-build-warn', role: 'status', text: 'Could not load workflows; Auto is used.' }) : null),
      h('div', { class: 'req-build-field' }, h('label', { for: 'req-build-branch', text: 'Branch from' }),
        f.scopeType === 'workspace' ? branch : h('div', { class: 'select-wrap' }, branch)));
  }
  // ---- Files for the run (board 18, D14): a chip per feature file, then the brief's documents. A chip is the same setting
  // as the file's switch on the Files card (a document's: Send with every run); the row is hidden with no files and no
  // documents. A file Start would refuse (the server's `sendable: false`: a version Worca could not store, a body missing
  // or not its size) cannot be switched on and says why in Start's words; switched on, it can still be left out. A file
  // being read has no switch (D1): its chip waits. Names are text only.
  const unsendable = (a) => a.sendable === false;
  const cannotGo = (name) => `${name} cannot go with the run: Worca could not open the stored file. Replace it, or leave it out of the run.`;
  // a brief document's switch is "Send with every run": it speaks of runs and of interviews
  const cannotGoDoc = (name) => `${name} cannot go with runs: Worca could not open the stored file. Replace it, or leave it out.`;
  function filesForRun(f) {
    const files = Array.isArray(f.attachments) ? f.attachments : [];
    const docs = Array.isArray(f.briefDocuments) ? f.briefDocuments : [];
    if (!files.length && !docs.length) return null;
    const on = files.filter((a) => a.sendWithRun).length + docs.filter((a) => a.sendWithEveryRun).length;
    const bad = [];
    const chip = (a, doc) => {
      const key = doc ? 'sendWithEveryRun' : 'sendWithRun';
      const sel = !!a[key];
      const reading = a.status === 'reading';
      const stuck = !reading && unsendable(a);
      const why = stuck || reading ? `req-fpick-why-${a.id}` : null;
      if (stuck) bad.push(h('p', { class: 'hint req-build-files-bad', id: why, text: cannotGo(a.name) }));
      return h('button', { type: 'button', class: `req-fpick${sel ? ' on' : ''}${stuck ? ' bad' : ''}`, 'aria-pressed': sel ? 'true' : 'false',
        'aria-label': doc ? `Send ${a.name} with every run` : `Send ${a.name} with the run`, 'aria-describedby': why, 'data-ui': `fpick-${a.id}`,
        disabled: starting || reading || (stuck && !sel),
        onclick: () => {
          if (pickPosting.has(a.id)) return;   // the first press is on its way: a second would send the same value again
          pickPosting.add(a.id);
          void act(async () => {
            try { await api('PATCH', a.href, { [key]: !sel }); } finally { pickPosting.delete(a.id); }
            await paint();   // the chip keeps the focus (its data-ui), and the Files card's switch shows the change
          });
        } },
      icon(stuck ? ICONS.warn : sel ? ICONS.check : ICONS.plus, { size: 13, width: sel && !stuck ? 2.6 : 2.2 }),
      h('span', { class: 'req-fpick-name', text: a.name }),
      reading ? [' ', h('span', { class: 'req-fpick-state', id: why, text: 'Reading…' })] : null);
    };
    const told = [...files, ...docs].filter((a) => (a.mentions || []).length).map((a) => `${a.name} (${a.mentions.join(', ')})`);
    return h('div', { class: 'req-build-files', role: 'group', 'aria-labelledby': 'req-build-files-h' },
      h('div', { class: 'req-build-files-head' }, h('h4', { id: 'req-build-files-h', text: 'Files for the run' }),
        h('span', { class: 'hint', text: `${on} of ${files.length + docs.length} go with it · click a file to add or leave it out` })),
      files.length ? h('div', { class: 'req-fpicks' }, ...files.map((a) => chip(a, false))) : null,
      docs.length ? h('div', { class: 'req-fpicks' }, h('span', { class: 'req-fpick-group', text: 'From the brief' }), ...docs.map((a) => chip(a, true))) : null,
      ...bad,
      h('p', { class: 'hint req-build-files-note' }, 'Left out, a file still shaped the spec through what Worca took from it.',
        told.length ? ` The spec mentions ${joinAnd(told)}.` : null));
  }
  function buildCard(f) {
    const c = choiceOf(f);
    if (c.open) loadBuildOptions(f);
    const version = nextVersion(f);
    const total = (f.readiness && f.readiness.total) || READY_CHECKS;
    const chipBranch = h('span', { class: 'chip', text: `Branch from · ${c.sourceBranch || 'default'}` });
    return h('section', { class: 'card req-build', 'aria-label': 'Ready to build' },
      h('div', { class: 'req-build-main' },
        h('h3', { text: 'Ready to build' }),
        h('p', {}, `All ${total} checks pass. Starting saves this spec as version ${version} and starts a run on `, h('b', { text: targetName(f) }),
          ' with it as the task. The run plans, builds and reviews; its cost counts toward your limit like any run.'),
        h('div', { class: 'req-build-chips' },
          h('span', { class: 'chip', text: `Workflow · ${workflowName(c.workflowId)}` }), chipBranch,
          h('button', { type: 'button', class: 'hint req-link', 'data-ui': 'build-change', 'aria-expanded': c.open ? 'true' : 'false',
            'aria-label': 'Change the workflow and branch', 'data-min-level': 'advanced',   // docs/ui-levels.md: the chips show the values at every level
            onclick: () => { c.open = !c.open; focusNext = c.open ? 'build-workflow' : 'build-change'; redraw(); } }, 'Change')),
        c.open ? buildChoices(f, c, chipBranch) : null,
        filesForRun(f)),
      h('button', { type: 'button', class: 'btn btn-primary req-build-go', 'data-ui': 'start-go', 'data-start': '', disabled: starting,
        onclick: (e) => startFlow(f, { trigger: e.currentTarget }) }, icon(ICONS.play, { size: 14, fill: 'currentColor', stroke: 'none' }), 'Start in Worca'));
  }

  // ---- Started (board Started.dc.html, A2 D10/D11): the runs, the total, what changed since ----
  function runsCard(f) {
    const starts = f.starts || [];
    const r = f.readiness || {};
    const changed = (f.changedSinceStart || []).length > 0;
    const build = starts.reduce((sum, s) => sum + (Number(s.run && s.run.costUsd) || 0), 0);
    const req = Number(f.costUsd) || 0;
    const row = (s) => {
      const early = Array.isArray(s.failing) && s.failing.length > 0;
      const label = h('span', { class: 'req-run-label', title: early && s.reason ? s.reason : null,
        text: `Run · spec v${s.version}${early ? ' · started before Ready' : ''}` });
      if (!s.run) {
        return h('div', { class: 'req-run-row gone' }, h('span', { class: 'req-run-main' }, label, h('span', { class: 'hint', text: 'Run not found' })));
      }
      return h('a', { class: 'req-run-row', href: s.run.href || `#running/${s.runId}` },
        runPill(s.run), h('span', { class: 'req-run-main' }, label),
        h('span', { class: 'req-run-cost', text: usd(s.run.costUsd) }), h('span', { class: 'req-run-go', 'aria-hidden': 'true', text: '→' }));
    };
    return h('section', { class: 'card req-runs', 'aria-label': 'Runs from this feature' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Runs from this feature' }),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'start-again', 'data-start': '',
          disabled: !changed || isLocked(f) || starting || !(r.ok || r.overridable),
          title: changed ? null : 'Nothing changed since the last start',
          onclick: (e) => startFlow(f, { trigger: e.currentTarget }) }, `Start again with v${nextVersion(f)}`)),
      h('div', { class: 'req-run-rows' }, ...starts.map(row)),
      h('p', { class: 'hint req-run-total' }, `Total for ${f.id} so far: `, h('code', { text: usd(req + build) }),
        ` (requirements ${usd(req)} + build ${usd(build)})`));
  }

  const sectionTitle = (key) => (SECTIONS.find(([k]) => k === key) || [key, sentence(key)])[1];
  // One line of the changed-since notice: what was there struck through, what is there now marked.
  function changeLine(c) {
    const del = (t) => h('del', { class: 'req-del', text: t });
    const ins = (t) => h('ins', { class: 'req-ins', text: t });
    const both = (a, b) => [a ? del(a) : null, a && b ? ' ' : null, b ? ins(b) : null];
    let kids;
    if (c.kind === 'file') {   // A8 D14: a feature file the run got, or would get now
      kids = ['File: ', c.change === 'removed' ? del(c.name) : h('b', { text: c.name }),
        c.change === 'added' ? ' goes with the run now.' : c.change === 'removed' ? ' no longer goes with the run.' : ' was replaced with a newer version.'];
    } else if (c.kind === 'goal') kids = [`${c.field === 'measure' ? 'Success measure' : 'Goal'}: `, ...both(c.before, c.after)];
    else if (c.kind === 'section') {
      const items = [...(c.removed || []).map(del), ...(c.added || []).map(ins)];
      kids = [`${sectionTitle(c.section)}: `, ...items.flatMap((x, i) => (i ? [' ', x] : [x]))];
    } else {
      const id = h('code', { class: 'req-id', text: c.id });
      kids = c.change === 'added' ? [id, ' added: ', ins(c.after || '')]
        : c.change === 'removed' ? [id, ' removed: ', del(c.before || '')]
          : [id, ' ', ...both(c.before, c.after)];
    }
    return h('div', { class: 'req-change-line' }, ...kids);
  }
  function changedNotice(f) {
    const v = f.starts[0].version;
    const undo = () => act(async () => {
      if (!window.confirm(`Undo your changes since build v${v}? The spec goes back to the one that run started with.`)) return;
      await api('POST', `/api/requirements/${f.seq}/revert`, { version: v });
      await paint();
    });
    return h('section', { class: 'req-changed', 'aria-label': 'Changed since the run started' },
      icon(ICONS.warn, { size: 18 }),
      h('div', { class: 'req-changed-body' },
        h('b', { text: 'Changed since the run started' }),
        ...f.changedSinceStart.map(changeLine),
        h('p', { text: `The running build still works from v${v}; it does not see this change.` }),
        // D14: Undo turns the feature files' switches back, never a removed or replaced body, never a document's switch
        f.changedSinceStart.some((c) => c.kind === 'file') ? h('p', { class: 'req-changed-files',
          text: "Undo puts the spec and the files' Send switches back. A removed or replaced file stays as it is now, and so do the documents' switches." }) : null,
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'revert', disabled: isLocked(f), onclick: undo }, 'Undo my changes'))));
  }

  // A small icon button (`req-ico`); `req-sect-edit` marks it as one of the edits the lock disables.
  const icoBtn = (name, label, onclick, { disabled = false, cls = 'req-sect-edit', ...rest } = {}) => h('button',
    { type: 'button', class: `req-ico${cls ? ` ${cls}` : ''}`, 'aria-label': label, title: label, disabled, onclick, ...rest }, icon(ICONS[name], { size: 15 }));

  // `ro`: the started version (A2 §5), read-only: no pencil, no edited mark, no rewrite.
  function sectionBlock(f, key, title, ro = false) {
    const s = f.spec;
    const edited = !ro && !!s.edited?.[key];
    const working = isLocked(f);
    let body;
    if (editing === key && !ro) {
      const isGoal = key === 'goal';
      const a = isGoal ? h('input', { type: 'text', value: s.goal.text, 'aria-label': 'Goal', 'data-ui': 'edit-a' }) : h('textarea', { rows: '5', 'aria-label': title, 'data-ui': 'edit-a' }, (s[key] || []).join('\n'));
      const b = isGoal ? h('input', { type: 'text', value: s.goal.measure, placeholder: 'Success measure', 'aria-label': 'Success measure', 'data-ui': 'edit-b' }) : null;
      if (ui.editVals && ui.editVals.key === key) { a.value = ui.editVals.a; if (b) b.value = ui.editVals.b; }
      body = h('div', { class: 'req-edit' }, a, b,
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { editing = null; ui.editVals = null; redraw(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => act(async () => {
            await api('PUT', `/api/requirements/${f.seq}/spec/${key}`, { value: isGoal ? { text: a.value, measure: b.value } : a.value });
            editing = null; ui.editVals = null; await paint();
          }) }, 'Save')));
    } else if (key === 'goal') {
      body = s.goal.text ? h('div', {}, h('p', { text: s.goal.text }), s.goal.measure ? h('p', { class: 'hint', text: `Measure: ${s.goal.measure}` }) : null) : h('p', { class: 'hint', text: 'Not yet.' });
    } else {
      const list = s[key] || [];
      body = list.length ? h(key === 'flow' ? 'ol' : 'ul', {}, ...list.map((t) => h('li', { text: t }))) : h('p', { class: 'hint', text: 'Not yet.' });
    }
    return h('section', { class: 'req-sect', 'data-section': key },
      h('div', { class: 'req-sect-head' },
        h('h4', {}, title, edited ? h('span', { class: 'req-edited', text: ' · edited by you' }) : null),
        edited ? h('button', { type: 'button', class: 'btn btn-quiet btn-sm req-sect-edit req-rewrite', disabled: working, 'aria-label': `Let Worca rewrite ${title}`,
          onclick: () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/spec/${key}/edited`); await paint(); }) }, 'Let Worca rewrite this') : null,
        ro ? null : icoBtn('pencil', `Edit ${title}`, () => { editing = key; focusNext = 'edit-a'; redraw(); }, { disabled: working, 'data-ui': `edit-${key}` })),
      body);
  }

  function criteriaBlock(f, ro = false) {
    const working = isLocked(f);
    const adding = !ro && (ui.critOpen || !!ui.crit);
    // the draft marks a criterion changed since the latest start (the version switch is on)
    const changedIds = new Map(ro ? [] : (f.changedSinceStart || []).filter((c) => c.kind === 'criterion' && c.change !== 'removed').map((c) => [c.id, c.change]));
    let input = null;
    let addBtn = null;
    if (adding) {
      input = h('input', { type: 'text', placeholder: 'Add a criterion: what a tester can check', 'aria-label': 'New acceptance criterion', 'data-ui': 'new-criterion' });
      input.value = ui.crit;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
        else if (e.key === 'Escape') { e.preventDefault(); ui.critOpen = false; ui.crit = ''; input.value = ''; focusNext = 'add-criterion'; redraw(); }
      });
      addBtn = h('button', { type: 'button', class: 'btn btn-sm req-sect-edit', disabled: working,
        onclick: () => act(async () => {
          await api('POST', `/api/requirements/${f.seq}/criteria`, { text: input.value });
          input.value = ''; ui.crit = ''; ui.critOpen = false;
          await paint();
        }) }, 'Add');
    }
    const list = f.spec.criteria || [];
    return h('section', { class: 'req-sect', 'data-section': 'criteria' },
      h('div', { class: 'req-sect-head' }, h('h4', { text: 'Acceptance criteria' }),
        ro ? null : icoBtn('plus', 'Add a criterion', () => { ui.critOpen = true; focusNext = 'new-criterion'; redraw(); },
          { disabled: working, 'aria-expanded': adding ? 'true' : 'false', 'data-ui': 'add-criterion' })),
      list.length ? h('ul', { class: 'req-items' }, ...list.map((c) => h('li', { class: 'req-item', 'data-criterion': c.id },
        h('code', { text: c.id }), h('span', { class: 'req-item-text' }, c.text, srcTag(f, c.source)),
        changedIds.has(c.id) ? h('span', { class: 'hint req-changed-mark', text: changedIds.get(c.id) === 'added' ? 'new' : 'changed' }) : null,
        ro ? null : icoBtn('remove', `Remove ${c.id}`, () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/criteria/${c.id}`); await paint(); }),
          { disabled: working })))) : adding ? null : h('p', { class: 'hint', text: 'None yet.' }),
      adding ? h('div', { class: 'req-item req-add' }, input, addBtn) : null);
  }

  function assumptionsBlock(f, ro = false) {
    const working = isLocked(f);
    const list = f.spec.assumptions || [];
    return h('section', { class: 'req-sect', 'data-section': 'assumptions' },
      h('div', { class: 'req-sect-head' }, h('h4', { text: 'Assumptions' })),
      list.length ? null : h('p', { class: 'hint', text: 'None yet.' }),
      ...list.map((a) => h('div', { class: `req-item req-assume ${a.status}`, 'data-assumption': a.id },
        h('code', { text: a.id }), h('span', { class: 'req-item-text' }, a.text, srcTag(f, a.source)),
        // the frozen version shows the status as a badge; the draft's toggle carries it (aria-pressed)
        ro ? h('span', { class: `badge ${a.status === 'confirmed' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`, text: a.status })
          : assumeToggle(f, a, { disabled: working, extraCls: 'req-sect-edit' }))));
  }

  // The spec card: goal, actors, criteria, assumptions and open questions; the long lists folded behind one link.
  // Once started and changed since, a switch shows the draft (v<n+1>, editable) or the frozen spec the
  // latest run started with (v<n>, read-only).
  function specSwitch(f) {
    const n = nextVersion(f) - 1;
    const tab = (key, label) => {
      const on = ui.specTab === key;
      return h('button', { type: 'button', role: 'tab', class: on ? 'on' : null, 'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1',
        'data-ui': `spec-tab-${key}`, onclick: () => { ui.specTab = key; focusNext = `spec-tab-${key}`; redraw(); } }, label);
    };
    const onKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      ui.specTab = ui.specTab === 'draft' ? 'started' : 'draft';
      focusNext = `spec-tab-${ui.specTab}`;
      redraw();
    };
    return h('div', { class: 'seg seg-sm req-spec-switch', role: 'tablist', 'aria-label': 'Spec version', onkeydown: onKey },
      tab('draft', `v${nextVersion(f)} draft`), tab('started', `v${n} started`));
  }

  function specCard(f) {
    const latest = (f.starts || [])[0];
    const canSwitch = !!(latest && latest.spec && (f.changedSinceStart || []).length);
    if (!canSwitch) ui.specTab = 'draft';
    const ro = canSwitch && ui.specTab === 'started';
    const v = ro ? { ...f, spec: latest.spec } : f;
    const s = v.spec;
    const n = FOLDED.reduce((k, key) => k + (s[key] || []).length, 0);
    const titleOf = (key) => SECTIONS.find(([k]) => k === key)[1];
    const interviewing = f.status === 'your_turn' || f.status === 'thinking' || f.status === 'looking';
    return h('section', { class: 'card req-spec' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Spec' }),
        canSwitch ? h('span', { class: 'hint req-spec-ver', text: ro ? `v${latest.version} is with the run, read-only` : `v${nextVersion(f)} draft · v${latest.version} is with the run` })
          : interviewing ? h('span', { class: 'hint', text: 'updates after every round' }) : null,
        canSwitch ? specSwitch(f) : null),
      sectionBlock(v, 'goal', 'Goal', ro), sectionBlock(v, 'actors', 'Actors', ro),
      criteriaBlock(v, ro), assumptionsBlock(v, ro),
      sectionBlock(v, 'openQuestions', 'Open questions', ro),
      ui.moreOpen ? FOLDED.map((k) => sectionBlock(v, k, titleOf(k), ro)) : null,
      h('button', { type: 'button', class: 'link-btn req-more', 'aria-expanded': ui.moreOpen ? 'true' : 'false', 'data-ui': 'spec-more',
        onclick: () => { ui.moreOpen = !ui.moreOpen; focusNext = 'spec-more'; redraw(); } },
      ui.moreOpen ? 'Hide flow, edge cases, rules and out of scope' : `Show flow, edge cases, rules and out of scope (${plural(n, 'item')})`));
  }

  // ---- Start (A2 D5): a plain start, or with `override` the start-before-Ready dialog straight away.
  // A plain start the server refuses as NOT_READY opens the dialog too, naming the checks it reported. ----
  function startFlow(f, { override = false, trigger = null } = {}) {
    if (starting || dialog) return;
    if (override) { openStartDialog(f, failingChecks(f), trigger); return; }
    void startPlain(f, trigger);
  }
  // The checks that fail: the server's keys (NOT_READY) looked up in the readiness, else every failing one.
  function failingChecks(f, keys = null) {
    const checks = (f.readiness && f.readiness.checks) || [];
    if (!keys) return checks.filter((c) => !c.ok);
    return keys.map((k) => checks.find((c) => c.key === k) || { key: k, ok: false, label: sentence(k), hint: '' });
  }
  function postStart(f, extra = {}) {
    const c = choiceOf(f);
    const branch = String(c.sourceBranch || '').trim();
    return api('POST', `/api/requirements/${f.seq}/start`, { ...extra, workflowId: c.workflowId || AUTO_WORKFLOW, ...(branch ? { sourceBranch: branch } : {}) });
  }
  // A start went through: the answer carries the feature, now started; repaint from it and say so.
  function started(f, data) {
    starting = false;
    const c = choices.get(f.seq);
    if (c) c.open = false;
    // Another feature is on screen now: its page keeps its paint and its focus (only its Start buttons,
    // disabled while this start ran, come back).
    if (seqShown !== f.seq) { redraw(); return; }
    paintNo += 1;   // a fetch already under way would paint the feature as it was before the start
    if (data && data.feature && seqShown === data.feature.seq) { paintFeature(data.feature, data.turns || []); paintedKey = `feature/${seqShown}`; }
    sayStarted(data.version, data.runId);
    // The control pressed is gone with the repaint: the focus goes to the message's run link, else the runs card.
    const link = msgEl && msgEl.querySelector('a');
    const to = link && link.isConnected ? link : host.querySelector('.req-runs a.req-run-row, .req-runs button:not(:disabled)');
    if (to) to.focus();
  }
  async function startPlain(f, trigger) {
    say('');
    starting = true;
    for (const b of host.querySelectorAll('[data-start]')) b.disabled = true;
    const triggerUi = trigger && trigger.getAttribute ? trigger.getAttribute('data-ui') : null;
    try {
      started(f, await postStart(f));
    } catch (err) {
      starting = false;
      redraw();
      if (err && err.status === 409 && err.data && Array.isArray(err.data.failing)) {
        const now = current && current.f.seq === f.seq ? current.f : f;
        openStartDialog(now, failingChecks(now, err.data.failing), host.querySelector(`[data-ui="${triggerUi}"]`) || trigger);
      } else fail(err);
    }
  }

  // The start-before-Ready dialog (board StartAnyway.dc.html): the upstream modal overlay (.viewer-modal),
  // on <body> so a live repaint of the page never drops what is typed. Escape and Keep deciding close it;
  // Tab stays inside; the focus goes to the reason on open and back to the trigger on close.
  function openStartDialog(f, failing, trigger) {
    closeDialog(false);
    const openN = ((f.spec && f.spec.assumptions) || []).filter((a) => a.status === 'open').length;
    const assumptionsFail = failing.some((c) => c.key === 'assumptions');
    const who = (typeof deps.who === 'function' && deps.who()) || 'you';
    let busy = false;
    const area = h('textarea', { id: 'req-dlg-reason', rows: '3', maxlength: String(REASON_MAX), 'aria-required': 'true', 'aria-describedby': 'req-dlg-count' });
    const count = h('span', { class: 'hint req-dlg-count', id: 'req-dlg-count', text: `0 / ${REASON_MAX}` });
    const msg = h('p', { class: 'form-msg err req-dlg-msg', role: 'alert' });
    const go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, assumptionsFail && openN ? `Start with ${openN} open` : 'Start anyway');
    const sync = () => { count.textContent = `${area.value.length} / ${REASON_MAX}`; go.disabled = busy || !area.value.trim(); };
    area.addEventListener('input', sync);
    go.addEventListener('click', async () => {
      if (busy || !area.value.trim()) return;
      busy = true; starting = true; sync(); msg.textContent = '';
      try {
        const data = await postStart(f, { reason: area.value.trim() });
        closeDialog(false);
        started(f, data);
      } catch (err) {
        starting = false;
        msg.textContent = errText(err);
      } finally { busy = false; sync(); }
    });
    const card = h('section', { class: 'card req-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-dlg-title' },
      h('h2', { id: 'req-dlg-title', text: `Start ${f.id} before it's Ready?` }),
      h('p', { class: 'req-dlg-lead', text: failing.length === 1 ? 'One check does not pass yet:' : `${failing.length} checks do not pass yet:` }),
      h('div', { class: 'req-dlg-fail' },
        h('ul', {}, ...failing.map((c) => h('li', {}, icon(ICONS.circle, { label: 'Not passed' }),
          h('span', {}, h('b', { text: c.label || sentence(c.key) }), c.hint ? `: ${c.hint}` : '')))),
        assumptionsFail ? h('p', { text: 'The run treats open assumptions as confirmed: the build follows them as written.' }) : null),
      h('div', { class: 'field req-dlg-field' },
        h('label', { for: 'req-dlg-reason' }, 'Why start now? ', h('span', { class: 'opt', text: 'required, kept on the feature with your name' })),
        area, count),
      h('p', { class: 'hint req-dlg-who', text: `Recorded as: ${who} · started before Ready` }),
      msg,
      h('div', { class: 'req-dlg-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => { if (!busy) closeDialog(true); } }, 'Keep deciding'), go));
    openModal(card, { trigger, first: area, canClose: () => !busy });
  }
  /** A modal on the page (the start dialog's pattern): Escape closes it when `canClose()`, Tab stays inside, the page
   *  behind is inert; `first` takes the focus, and `closeDialog(true)` hands it back to `trigger`. */
  function openModal(card, { trigger = null, first = null, canClose = () => true } = {}) {
    const wrap = h('div', { class: 'viewer-modal req-dlg-wrap' }, card);
    const triggerUi = trigger && trigger.getAttribute ? trigger.getAttribute('data-ui') : null;
    // On the document, in the capture phase: Escape and Tab work wherever the focus is, even after a click
    // on the scrim left it on <body>. Removed on close.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (canClose()) closeDialog(true); return; }
      if (e.key !== 'Tab') return;
      // a radio group is one stop: its checked radio
      const all = [...card.querySelectorAll('button, textarea, input, select, a[href]')].filter((el) => !el.disabled && !(el.type === 'radio' && !el.checked));
      if (!all.length) return;
      const head = all[0], last = all[all.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === head || !card.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !card.contains(at))) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(wrap);
    // the page behind cannot be reached while the dialog is open
    host.inert = true; host.setAttribute('inert', '');
    dialog = { wrap, trigger, triggerUi, onKey };
    if (first) first.focus();
  }
  function restoreFocus(trigger, triggerUi) {
    const el = trigger && trigger.isConnected ? trigger : triggerUi ? host.querySelector(`[data-ui="${triggerUi}"]`) : null;
    if (el && !el.disabled) el.focus();
  }
  function closeDialog(restore = true) {
    if (!dialog) return;
    const { wrap, trigger, triggerUi, onKey } = dialog;
    dialog = null;
    document.removeEventListener('keydown', onKey, true);
    host.inert = false; host.removeAttribute('inert');
    wrap.remove();
    if (restore) restoreFocus(trigger, triggerUi);
  }

  // Ready to start? (A2 D1): the server's six checks, never derived here; every state but archived.
  function readyPanel(f) {
    const r = f.readiness;
    if (!r || !Array.isArray(r.checks) || f.status === 'archived') return null;
    // Once started, starting again needs a change since (the runs card's Start again, A2 D11).
    const hasStarts = (f.starts || []).length > 0;
    const same = hasStarts && !(f.changedSinceStart || []).length;
    const locked = isLocked(f) || starting || same;
    // While the Ready to build card is on screen its Start is the one (board Ready.dc.html), and once started
    // the runs card's Start again is: no second button here.
    const cardStarts = buildCardShown(f) || hasStarts;
    return h('section', { class: 'card req-ready' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Ready to start?' }), h('code', { text: `${r.passed} of ${r.total || READY_CHECKS}` })),
      h('ul', { class: 'req-checks' }, ...r.checks.map((c) => h('li', { class: `req-check${c.ok ? ' ok' : ''}`, 'data-check': c.key },
        icon(c.ok ? ICONS.check : ICONS.circle, { label: c.ok ? 'Passed' : 'Not yet', width: c.ok ? 2.4 : 2 }),
        h('span', { class: 'req-check-label', text: c.label }),
        !c.ok && c.hint ? h('span', { class: 'hint req-check-hint', text: c.hint }) : null))),
      h('div', { class: 'req-ready-foot' },
        h('span', { class: 'hint', text: 'Nothing is built until you start it.' }),
        h('div', { class: 'req-ready-btns' },
          r.overridable ? h('button', { type: 'button', class: 'link-btn req-start-anyway', 'data-ui': 'start-anyway', 'data-start': '', disabled: locked,
            onclick: (e) => startFlow(f, { override: true, trigger: e.currentTarget }) }, "Start before it's Ready…") : null,
          cardStarts ? null : h('button', { type: 'button', class: r.ok ? 'btn btn-primary btn-sm req-start' : 'btn btn-sm req-start', 'data-ui': 'start', 'data-start': '', disabled: !r.ok || locked,
            onclick: (e) => startFlow(f, { override: false, trigger: e.currentTarget }) }, 'Start in Worca'))));
  }

  // ---- A8: the Files card (board 16; 17 is its dark theme; 20 its phone width) ----
  const fu = (id) => { if (!fileUi.has(id)) fileUi.set(id, { all: false, edit: null, ask: null, asked: null, history: false }); return fileUi.get(id); };
  const hasTextOf = (a) => !!a.summary && (a.summaryEdited || a.status === 'done');
  const READ_REASON = Object.freeze({ TIMEOUT: 'it ran out of time', BAD_REPLY: 'its reply could not be read', INTERRUPTED: 'Worca restarted' });
  const reasonOf = (error) => READ_REASON[error && error.code] || String((error && error.message) || '').replace(/\.\s*$/, '');
  const CLAMP_CHARS = 240;   // board 16: three lines of the card
  const isClamped = (s) => s.length > CLAMP_CHARS || (s.match(/\n/g) || []).length >= 3;
  // At phone width the pencil is in the ⋯ menu (board 20, style.css): the focus goes back to whichever is shown.
  const narrow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width:600px)').matches;
  const editReturn = (a) => (narrow() ? `file-more-${a.id}` : `file-edit-${a.id}`);
  const fileNode = (id) => { if (!fileNodes.has(id)) fileNodes.set(id, { badge: null, failed: null }); return fileNodes.get(id); };

  /** A hidden file input; `onFiles` gets the picked files. */
  function filePicker(onFiles, { multiple = true } = {}) {
    const input = h('input', { type: 'file', accept: REQ_ATTACH.accept, hidden: true, multiple: multiple || null, tabindex: '-1', 'aria-hidden': 'true' });
    input.addEventListener('change', () => { const files = [...(input.files || [])]; input.value = ''; if (files.length) onFiles(files); });
    return input;
  }

  /** D7: the page's early checks, the accepted files in requests of at most 100 MB, the refusals in the card's alert line.
   *  The focus goes back to Add files (`focusUi`) once the card is painted again; when the upload filled the card and
   *  Add files is disabled, to the card's heading (`fallbackUi`, tabindex=-1). `setFocus` names the field the owner's next
   *  paint focuses (the feature page's by default; the brief page passes its own). */
  async function uploadFiles({ url, key, existing, owner, rerender, focusUi = 'files-add', fallbackUi = 'files-head',
    setFocus = (k) => { focusNext = k; } }, files) {
    const errors = [];
    const ok = [];
    const pending = existing.map((x) => ({ name: x.name, bytes: x.bytes }));
    for (const file of files) {
      const c = checkAttachment(file, { pending, limits: reqLimits({ owner }), typeMessage: reqTypeMessage });
      if (!c.ok) { errors.push(c.error); continue; }
      ok.push(file);
      pending.push({ name: file.name, bytes: file.size });
    }
    fileMsgs.set(key, errors.join(' '));
    fileMsgList.set(key, errors);
    setFocus(focusUi);
    if (!ok.length) { rerender(); return; }
    await act(async () => {
      try {
        for (const batch of uploadBatches(ok)) await api('POST', url, { attachments: await Promise.all(batch.map(encodeFile)) });
      } finally {
        setFocus(focusUi);
        await paint();   // the batches already sent show, also when a later one is refused (the message comes after)
        const add = host.querySelector(`[data-ui="${focusUi}"]`);
        if (add && add.disabled) host.querySelector(`[data-ui="${fallbackUi}"]`)?.focus();
      }
    });
  }

  /** An owner's refusal line (role=alert), one node across paints: it speaks when a pick is refused, not on every repaint. */
  function refusalAlert(key) {
    let el = refusalEls.get(key);
    if (!el) { el = h('p', { class: 'req-file-refused', role: 'alert', hidden: true }); el.said = ''; refusalEls.set(key, el); }
    const msg = fileMsgs.get(key) || '';
    if (el.said !== msg) {
      el.said = msg;
      const list = fileMsgList.get(key) || (msg ? [msg] : []);
      el.replaceChildren(...list.flatMap((e, i) => (i ? [' ', refusalLine(e)] : [refusalLine(e)])));
      el.hidden = !msg;
    }
    return el;
  }

  function editBox(a, ctx) {
    const s = fu(a.id);
    const ta = h('textarea', { rows: '5', maxlength: '1500', 'aria-label': `What Worca took from ${a.name}`, 'data-ui': `file-edit-text-${a.id}` });
    ta.value = s.edit;
    ta.addEventListener('input', () => { s.edit = ta.value; });
    const cancel = () => { s.edit = null; ctx.focus(editReturn(a)); ctx.redraw(); };
    // Escape cancels, as Cancel does (the new-criterion field's grammar)
    ta.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); cancel(); });
    return h('div', { class: 'req-edit req-file-edit' }, ta,
      h('div', { class: 'req-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: cancel }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-ui': `file-save-${a.id}`, disabled: ctx.locked,
          onclick: () => act(async () => { await api('PATCH', a.href, { summary: ta.value }); s.edit = null; ctx.focus(editReturn(a)); await paint(); }) }, 'Save')));
  }
  const openEdit = (a, ctx) => { fu(a.id).edit = a.summary; ctx.focus(`file-edit-text-${a.id}`); ctx.redraw(); };

  // A replace whose new body could not be stored (D11): only Replace mends it, so the server refuses Ask and Read again.
  const storeFailedOf = (a) => a.status === 'failed' && !!a.error && a.error.code === 'STORE_FAILED';
  const ASK_RANGE = '$0.05–0.15';   // an ask's cost before any read of that kind has been made (D12)
  const moreUi = (a) => `file-more-${a.id}`;
  const focusMore = (a) => { const el = host.querySelector(`[data-ui="${moreUi(a)}"]`); if (el) el.focus(); };

  /** The ⋯ of a file (boards 16, 20, 21): Open · Edit what Worca took from it (the pencil at phone width) · Ask about this
   *  file… · Replace with a newer version… · Read again · Remove. Each state offers only what applies: nothing but Open
   *  and Remove while the file is read; Ask once it is read; Read again not on a version that could not be stored. The
   *  A1 lock disables all but Open. `replace` is the row's file picker (also behind a stored-version failure's button). */
  function fileMenu(a, ctx, replace) {
    const reading = a.status === 'reading' || !!a.asking;   // an ask in progress waits like a read (one job per file)
    const stuck = storeFailedOf(a);
    const off = ctx.locked;
    const remove = menuItem('Remove', () => removeFile(a, ctx), { disabled: off, ui: `fmi-remove-${a.id}` });
    remove.classList.add('is-danger');
    const items = [
      h('a', { role: 'menuitem', class: 'menu-item req-menu-item', 'data-ui': `fmi-open-${a.id}`, href: a.href, target: '_blank', rel: 'noopener' }, 'Open'),
      hasTextOf(a) && !reading ? menuItem('Edit what Worca took from it', () => openEdit(a, ctx), { disabled: off, ui: `fmi-edit-${a.id}` }) : null,
      a.status === 'done' && !reading ? menuItem('Ask about this file…', () => openAsk(a, ctx), { disabled: off, ui: `fmi-ask-${a.id}` }) : null,
      reading ? null : menuItem('Replace with a newer version…', () => { focusMore(a); replace.click(); }, { disabled: off, ui: `fmi-replace-${a.id}` }),
      reading || stuck ? null : menuItem('Read again', () => act(async () => {
        if (a.summaryEdited && !window.confirm("Read again? Your text goes to the file's history.")) { focusMore(a); return; }
        await api('POST', `${a.href}/read-again`, {});
        ctx.focus(moreUi(a));
        await paint();
      }), { disabled: off, ui: `fmi-again-${a.id}` }),
      h('div', { class: 'menu-sep', role: 'separator' }),
      remove,
    ];
    const wrap = menu(`file-${a.id}`, h('button', { type: 'button', class: 'req-ico req-file-more', 'aria-label': `More for ${a.name}`, title: `More for ${a.name}`, 'data-ui': moreUi(a) },
      icon(ICONS.dots, { size: 16, fill: 'currentColor', stroke: 'none' })), items);
    wrap.append(replace);
    return wrap;
  }

  /** Remove (design §6): asked first; the focus then goes to the next file, else the previous one, else Add files. */
  function removeFile(a, ctx) {
    return act(async () => {
      if (!window.confirm(`Remove ${a.name}? The file and what Worca took from it are deleted from Worca.`)) { focusMore(a); return; }
      const list = ctx.list || [];
      const i = list.findIndex((x) => x.id === a.id);
      const near = list[i + 1] || list[i - 1] || null;
      await api('DELETE', a.href);
      const to = near ? `file-name-${near.id}` : ctx.addUi || 'files-add';
      ctx.focus(to);
      await paint();
      const el = host.querySelector(`[data-ui="${to}"]`);
      if (!el || el.disabled) host.querySelector(`[data-ui="${ctx.headUi || 'files-head'}"]`)?.focus();
    });
  }

  const openAsk = (a, ctx) => {
    const s = fu(a.id);
    s.ask = s.ask ?? '';
    const n = fileNode(a.id);
    if (n.askMsg) n.askMsg.textContent = '';
    ctx.focus(`file-ask-text-${a.id}`);
    ctx.redraw();
  };
  /** Ask about this file… (D12, board 21): a panel under the file; the question is 1–200 characters. A refusal (the
   *  budget, one question at a time) shows in the panel's own alert line, which is one node across paints. */
  function askPanel(a, ctx) {
    const s = fu(a.id);
    const n = fileNode(a.id);
    if (!n.askMsg) n.askMsg = h('p', { class: 'req-file-failed req-file-askmsg', role: 'alert' });
    const id = `req-ask-${a.id}`;
    const input = h('input', { type: 'text', id, maxlength: '200', autocomplete: 'off', 'data-ui': `file-ask-text-${a.id}` });
    input.value = s.ask || '';
    // in flight: on the file's ui state (not this paint's panel), so a live repaint mid-request does not re-enable Ask
    const go = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-ui': `file-ask-go-${a.id}` }, 'Ask');
    const sync = () => { go.disabled = ctx.locked || !!s.askBusy || !input.value.trim(); };
    const close = () => { s.ask = null; n.askMsg.textContent = ''; ctx.focus(moreUi(a)); ctx.redraw(); };
    const send = async () => {
      const q = input.value.trim();
      if (s.askBusy || !q || ctx.locked) return;
      s.askBusy = true; sync(); n.askMsg.textContent = '';
      try {
        await api('POST', `${a.href}/ask`, { question: q });
        s.ask = null;
        s.asked = q;
        ctx.focus(moreUi(a));
        await paint();
      } catch (err) {
        n.askMsg.textContent = errText(err);
      } finally {
        s.askBusy = false;
        // the panel on screen now (a repaint may have replaced this one)
        const now = host.querySelector(`[data-ui="file-ask-go-${a.id}"]`);
        const field = host.querySelector(`[data-ui="file-ask-text-${a.id}"]`);
        if (now && field) now.disabled = ctx.locked || !field.value.trim();
      }
    };
    input.addEventListener('input', () => { s.ask = input.value; sync(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void send(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    go.addEventListener('click', () => { void send(); });
    sync();
    return h('div', { class: 'req-file-askpanel' },
      h('label', { for: id, text: 'What should Worca look for?' }), input,
      h('div', { class: 'req-file-askfoot' },
        h('span', { class: 'hint', text: `One more read of this file · about ${typeof a.estimateUsd === 'number' ? usd(a.estimateUsd) : ASK_RANGE}` }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: close }, 'Cancel'), go),
      n.askMsg);
  }

  /** Replace with a newer version… (D11, board 21): the page's early checks of the new file (a refusal goes to the card's
   *  alert line), then the dialog; the choice of D11 only when the summary was edited; the server's refusals in it. */
  function openReplace(a, ctx, file) {
    const c = checkAttachment(file, { pending: [], limits: reqLimits({ owner: ctx.doc ? 'brief' : 'feature' }), typeMessage: reqTypeMessage });
    if (!c.ok) { if (ctx.refuse) ctx.refuse(c.error); else say(c.error, 'err'); focusMore(a); return; }
    if (ctx.refuse) ctx.refuse('');
    closeDialog(false);
    const est = typeof a.estimateUsd === 'number' && a.kind === c.attKind ? usd(a.estimateUsd) : READ_RANGE;
    const on = ctx.doc ? !!a.sendWithEveryRun : !!a.sendWithRun;
    let keep = false;
    let busy = false;
    const radio = (value, label, checked, more = null) => {
      const r = h('input', { type: 'radio', name: 'req-replace-keep', value, checked: checked || null, 'data-ui': `replace-${value}` });
      r.addEventListener('change', () => { keep = value === 'keep'; });
      return h('label', { class: 'req-replace-opt' }, r, h('span', {}, label, more ? h('span', { class: 'hint', text: ` ${more}` }) : null));
    };
    const choice = a.summaryEdited ? h('fieldset', { class: 'req-replace-choice' }, h('legend', { text: 'You edited what Worca took from the old file' }),
      radio('rewrite', 'Let Worca write it again from the new file', true, "(your text is kept in the file's history)"), radio('keep', 'Keep my text', false)) : null;
    const msg = h('p', { class: 'form-msg err req-dlg-msg', role: 'alert' });
    const go = h('button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'replace-go' }, 'Replace');
    go.addEventListener('click', async () => {
      if (busy) return;
      busy = true; go.disabled = true; msg.textContent = '';
      try {
        await api('POST', `${a.href}/replace`, { attachments: [await encodeFile(file)], keepSummary: keep });
        closeDialog(true);
        await paint();
      } catch (err) {
        msg.textContent = errText(err);
      } finally { busy = false; go.disabled = false; }
    });
    const card = h('section', { class: 'card req-dialog req-replace', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-dlg-title', 'aria-describedby': 'req-dlg-desc' },
      h('h2', { id: 'req-dlg-title', text: `Replace ${a.name}` }),
      h('p', { class: 'req-dlg-lead req-replace-lead', id: 'req-dlg-desc' }, 'New file: ', h('b', { text: file.name }),
        ` · ${KIND_TITLE[c.attKind]} · ${sizeText(file.size)}. Worca reads it again (about ${est}); ${ctx.doc ? '“Send with every run”' : '“Send with the run”'} stays ${on ? 'on' : 'off'}.`),
      choice,
      h('p', { class: 'hint req-replace-hint', text: ctx.doc ? "Interviews use the new version right away; the brief's sections change only when you Refresh it."
        : 'The next round uses the new version. A Ready feature gets one short follow-up round; after the start it counts as a change since the start.' }),
      msg,
      h('div', { class: 'req-dlg-btns' }, h('button', { type: 'button', class: 'btn', onclick: () => { if (!busy) closeDialog(true); } }, 'Cancel'), go));
    openModal(card, { trigger: host.querySelector(`[data-ui="${moreUi(a)}"]`), first: choice ? choice.querySelector('input:checked') : go, canClose: () => !busy });
  }

  /** D13: an item's source as a tag after its text: a link to the file while a feature file or brief document of that name
   *  exists (case-insensitive), plain text once none does. */
  function srcTag(f, source) {
    if (!source) return null;
    const k = String(source).toLowerCase();
    const all = [...(f.attachments || []), ...(f.briefDocuments || [])].filter(Boolean);
    const same = (name) => String(name || '').toLowerCase() === k;
    // a file replaced by a newer version under another name still counts: its history keeps the earlier name
    const file = all.find((x) => same(x.name)) || all.find((x) => (x.history || []).some((e) => e && e.reason === 'replaced' && same(e.name)));
    const kids = [icon(ICONS.clip, { size: 11 }), h('span', { class: 'sr-only', text: 'from ' }), String(source)];
    return file && file.href ? h('a', { class: 'req-src-tag', href: file.href, target: '_blank', rel: 'noopener' }, ...kids)
      : h('span', { class: 'req-src-tag' }, ...kids);
  }

  /** The Reading… badge (role=status), one node per file while it is read. */
  function readingBadge(a) {
    const n = fileNode(a.id);
    if (!n.badge) n.badge = h('span', { class: 'badge blue', role: 'status', text: 'Reading…' });
    return n.badge;
  }
  /** The Asking… badge (role=status), the same pattern: one node per file while a question about it is answered. */
  function askingBadge(a) {
    const n = fileNode(a.id);
    if (!n.asking) n.asking = h('span', { class: 'badge blue', role: 'status', text: 'Asking…' });
    return n.asking;
  }
  /** The failed line (role=alert) with Try again, one node per failure: a repaint updates it in place and says nothing. */
  function failedLine(a, ctx, replace) {
    const n = fileNode(a.id);
    if (!n.failed) {
      const words = h('span', { class: 'req-file-failed-text' });
      const btn = h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': `file-retry-${a.id}` }, 'Try again');
      btn.addEventListener('click', () => n.failed.run());
      n.failed = { p: h('p', { class: 'req-file-failed', role: 'alert' }, words, ' ', btn), words, btn, run: () => {} };
    }
    // A version that could not be stored (D11): the server's words, and Replace, which mends it (Read again is refused).
    const stuck = storeFailedOf(a);
    const said = stuck ? String(a.error.message || '')
      : `Worca could not read this file${reasonOf(a.error) ? `: ${reasonOf(a.error)}` : ''}. ${ctx.doc ? 'Interviews list' : 'The interview lists'} it by name only.`;
    if (n.failed.words.textContent !== said) n.failed.words.textContent = said;
    const label = stuck ? 'Replace with a newer version…' : 'Try again';
    if (n.failed.btn.textContent !== label) n.failed.btn.textContent = label;
    n.failed.btn.setAttribute('data-ui', `${stuck ? 'file-replace' : 'file-retry'}-${a.id}`);
    n.failed.btn.disabled = ctx.locked;
    n.failed.run = stuck ? () => replace.click()
      : () => act(async () => { await api('POST', `${a.href}/read-again`, {}); ctx.focus(`file-name-${a.id}`); await paint(); });
    return n.failed.p;
  }
  /** A failed ask (D12): one role=alert node per failure, so a repaint does not say it again. */
  function askFailedLine(a) {
    const n = fileNode(a.id);
    const e = a.error && a.error.job === 'ask' && a.status !== 'failed' ? a.error : null;
    if (!e) { n.askFailed = null; return null; }
    const said = `Worca could not answer “${e.question || ''}”${reasonOf(e) ? `: ${reasonOf(e)}` : ''}.`;
    const key = `${e.question}|${e.at || ''}`;
    if (!n.askFailed || n.askFailed.key !== key) n.askFailed = { key, p: h('p', { class: 'req-file-failed req-file-ask-failed', role: 'alert' }) };
    if (n.askFailed.p.textContent !== said) n.askFailed.p.textContent = said;
    return n.askFailed.p;
  }

  /** One file of the Files card or of the Documents card (boards 16, 19, 20). The switch shows in every state but Reading (D1):
   *  a file Worca could not read, or that the budget stopped, may still go to the run. Names and summaries are text only. */
  function fileRow(a, ctx) {
    const s = fu(a.id);
    const reading = a.status === 'reading';
    const hasText = hasTextOf(a);
    const n = fileNode(a.id);
    if (!reading) n.badge = null;
    const asking = !reading && !!a.asking;   // an ask in progress (D12): the answer's frame clears it
    if (!asking) n.asking = null;
    if (a.status !== 'failed') n.failed = null;   // a later failure is a new alert
    if (s.ask != null && (a.status !== 'done' || asking)) {   // Ask is for a read file (board 21); the lock only disables it
      if (document.activeElement && document.activeElement.getAttribute('data-ui') === `file-ask-text-${a.id}`) ctx.focus(moreUi(a));
      s.ask = null;
    }
    const replace = filePicker((files) => openReplace(a, ctx, files[0]), { multiple: false });
    const sendKey = ctx.doc ? 'sendWithEveryRun' : 'sendWithRun';
    const usesIt = ctx.doc ? 'Interviews use it once it is read.' : 'The next round uses it.';
    const meta = [`${KIND_TITLE[a.kind] || 'Text'} · ${sizeText(a.bytes)}`, a.costUsd > 0 ? `read for ${usd(a.costUsd)}` : null].filter(Boolean).join(' · ');
    const top = h('div', { class: 'req-file-top' },
      h('a', { class: 'req-file-name', href: a.href, target: '_blank', rel: 'noopener', 'data-ui': `file-name-${a.id}`, text: a.name }),
      h('span', { class: 'hint req-file-meta', text: meta }),
      h('span', { class: 'req-file-gap' }),
      reading ? readingBadge(a) : null,
      asking ? askingBadge(a) : null,
      a.status === 'unread-budget' ? h('span', { class: 'badge amber', text: 'Not read yet' }) : null,
      hasText && !reading && !asking ? icoBtn('pencil', `Edit what Worca took from ${a.name}`, () => openEdit(a, ctx),
        { cls: 'req-file-pencil', disabled: ctx.locked, 'data-ui': `file-edit-${a.id}` }) : null,
      fileMenu(a, ctx, replace));
    const state = reading
      ? h('p', { class: 'hint req-file-state', text: typeof a.estimateUsd === 'number'
        ? `Worca is reading it (about ${usd(a.estimateUsd)}). ${usesIt}` : `Worca is reading it. ${usesIt}` })
      : a.status === 'failed' ? failedLine(a, ctx, replace)
        : a.status === 'unread-budget'
          ? h('p', { class: 'hint req-file-state', text: `The Requirements budget is used up for this ${ctx.period === 'weekly' ? 'week' : 'month'}. Worca reads it when the budget allows; until then ${ctx.doc ? 'interviews list' : 'the interview lists'} it by name only.` })
          : asking ? h('p', { class: 'hint req-file-state req-file-asking', text: `Worca is looking for: “${a.asking}”…` }) : null;
    if (s.edit != null && (!hasText || reading)) {
      // The text went away under the open editor (read again, replaced): the draft cannot be saved, and the card says why.
      // The editor had the focus: it goes to the file's ⋯, which every state has.
      const typing = document.activeElement && document.activeElement.getAttribute('data-ui') === `file-edit-text-${a.id}`;
      s.edit = null;
      // only a file that is being read says so; one that went straight to failed has its own alert
      if (reading && ctx.dropped) ctx.dropped();
      if (typing) ctx.focus(`file-more-${a.id}`);
    }
    const clamp = hasText && !s.all && isClamped(a.summary);
    const took = s.edit != null ? editBox(a, ctx) : hasText ? [
      h('p', { class: 'req-file-cap' }, 'What Worca took from it', a.summaryEdited ? h('span', { class: 'req-edited', text: ' · edited by you' }) : null),
      h('p', { class: `req-file-took${clamp ? ' req-clamp' : ''}`, 'data-ui': `file-took-${a.id}`, tabindex: '-1', text: a.summary }),
      clamp ? h('button', { type: 'button', class: 'link-btn req-file-all', 'data-ui': `file-all-${a.id}`,
        onclick: () => { s.all = true; ctx.focus(`file-took-${a.id}`); ctx.redraw(); } }, 'Show all') : null,
    ] : null;
    // The answers under the summary, newest first, each labelled with its question; the one just asked on this page says
    // it was added (board 21; the card's status line says it once).
    const newest = [...(a.asks || [])].reverse();
    const asks = newest.length ? h('div', { class: 'req-file-asks' }, ...newest.map((q, i) => {
      const added = i === 0 && s.asked != null && q.question === s.asked;
      return h('div', { class: 'req-file-ask' },
        h('p', { class: `req-file-q${added ? ' req-file-added' : ''}`, text: added ? `Added to what Worca took from it · Q: ${q.question}` : `Q: ${q.question}` }),
        ' ', h('p', { class: 'req-file-a', text: q.answer }));
    })) : null;
    let history = null;
    if ((a.history || []).length) {
      history = h('details', { class: 'req-file-history', 'data-min-level': 'advanced', open: s.history },   // as a look's files (docs/ui-levels.md)
        h('summary', {}, `Earlier text (${a.history.length})`),
        h('ol', {}, ...a.history.map((x) => h('li', {}, h('span', { class: 'hint', text: `${String(x.at || '').slice(0, 10)} · ${x.name}` }), ' ', h('p', { text: x.summary })))));
      history.addEventListener('toggle', () => { s.history = history.open; });
    }
    let send = null;
    if (!reading) {
      const sw = makeSwitch(document, { label: ctx.doc ? 'Send with every run' : 'Send with the run',
        ariaLabel: ctx.doc ? `Send ${a.name} with every run` : `Send ${a.name} with the run`, checked: !!a[sendKey], data: { ui: `file-send-${a.id}` } });
      // D14: a file Start would refuse (sendable: false) can be switched off, not on, as its Files for the run chip
      const stuck = unsendable(a);
      sw.input.disabled = ctx.locked || (stuck && !a[sendKey]);
      if (stuck) sw.input.setAttribute('aria-describedby', `req-file-why-${a.id}`);
      // the focused switch keeps the focus across the repaint (capture() reads its data-ui)
      sw.input.addEventListener('change', () => act(async () => { await api('PATCH', a.href, { [sendKey]: sw.input.checked }); await paint(); }));
      send = h('div', { class: 'req-file-send' }, sw.row,
        ...((a.mentions || []).length ? [' ', h('span', { class: 'hint', text: `The spec mentions this file (${a.mentions.join(', ')}).` })] : []),
        stuck ? h('p', { class: 'hint req-file-unsendable', id: `req-file-why-${a.id}`, text: ctx.doc ? cannotGoDoc(a.name) : cannotGo(a.name) }) : null);
    }
    const ask = s.ask != null ? askPanel(a, ctx) : null;
    return h('div', { class: 'req-file', 'data-file': a.id }, top, state, took, ask, askFailedLine(a), asks, history, send);
  }

  /** What changed since the last paint, said once in the card's status line: a read that finished or that the budget stopped
   *  (a failed read has its own alert). */
  function filesStatus(list) {
    if (!filesLive) filesLive = h('p', { class: 'sr-only req-files-live', role: 'status' });
    const said = [];
    for (const a of list) {
      const was = fileWas.get(a.id);
      if (was === 'reading' && a.status === 'done') said.push(`Worca read ${a.name}.`);
      else if (was === 'reading' && a.status === 'unread-budget') said.push(`${a.name}: Not read yet.`);
      // an answer to a question asked on this page has come (board 21)
      const s = fileUi.get(a.id);
      if (s && s.asked != null && s.saidAsked !== s.asked && (a.asks || []).some((q) => q.question === s.asked)) {
        s.saidAsked = s.asked;
        said.push(`Added to what Worca took from it · Q: ${s.asked}`);
      }
    }
    fileWas.clear();
    for (const a of list) fileWas.set(a.id, a.status);
    if (said.length) filesLive.textContent = said.join(' ');
    return filesLive;
  }

  /** The setup the Files card and the Documents card share (boards 16, 19): the rows' context, the card's message line
   *  (`dropped`, a draft the page had to drop while its file is read, said until no file is read any more; `refuse`, a
   *  Replace pick the early checks refused, said now), the picker that uploads, and the rows. */
  function fileCardCtx({ key, list, doc, locked, period, redraw: rerender, setFocus, url, owner, addUi, headUi }) {
    const say1 = (text) => { fileMsgs.set(key, text); fileMsgList.set(key, text ? [text] : []); };
    const ctx = { doc, locked, period, list, redraw: rerender, focus: setFocus, addUi, headUi,
      dropped: () => { say1(DROPPED_DRAFT); droppedKeys.add(key); },
      refuse: (text) => { droppedKeys.delete(key); say1(text); const el = refusalAlert(key); if (!el.isConnected) rerender(); } };
    for (const id of fileNodes.keys()) if (!list.some((a) => a.id === id)) fileNodes.delete(id);
    const input = filePicker((files) => {
      droppedKeys.delete(key);
      uploadFiles({ url, key, existing: list, owner, rerender, focusUi: addUi, fallbackUi: headUi, setFocus }, files);
    });
    const rows = list.map((a) => fileRow(a, ctx));   // before the message line: a row may put a line there
    if (droppedKeys.has(key) && !list.some((a) => a.status === 'reading')) { droppedKeys.delete(key); say1(''); }
    return { input, rows };
  }

  function filesCard(f) {
    if (!Array.isArray(f.attachments)) return null;   // a feature view from before A8
    const list = f.attachments;
    const locked = isLocked(f) || starting;
    const key = `feature:${f.seq}`;
    const { input, rows } = fileCardCtx({ key, list, doc: false, locked, period: f.resetPeriod, redraw,
      setFocus: (k) => { focusNext = k; }, url: `/api/requirements/${f.seq}/attachments`, owner: 'feature', addUi: 'files-add', headUi: 'files-head' });
    return h('section', { class: 'card req-files', 'aria-label': 'Files', 'data-ui': 'files-card' },
      h('div', { class: 'req-card-head req-files-head' },
        h('div', {}, h('h3', { text: `Files · ${list.length}`, tabindex: '-1', 'data-ui': 'files-head' }),
          h('p', { class: 'hint', text: 'Worca reads each one once and uses what it took from it in every round.' })),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'files-add', disabled: locked || list.length >= REQ_ATTACH.maxFiles, onclick: () => input.click() }, 'Add files'),
        input),
      privacyNote(f.interview),
      refusalAlert(key),
      filesStatus(list),
      list.length ? h('div', { class: 'req-files-list' }, ...rows)
        : h('p', { class: 'hint req-files-empty', text: 'No files yet. Add emails, a spec, screenshots or a mockup.' }));
  }

  /** The Documents card (board 19, D2 (c)): a made brief's documents, used by every feature of its scope. The rows, ⋯ menu,
   *  editor, Ask, Replace and Remove are the Files card's (`ctx.doc` names the switch "Send with every run" and the replace
   *  hint); the routes are the documents' (each row's `href`). Allowed while a refresh runs (A7-D6), so never locked. A
   *  page from before A8 (no `documents`) has no card. */
  function docsCard(data, name) {
    if (!Array.isArray(data.documents)) return null;
    const s = briefShown;
    const list = data.documents;
    const key = `brief:${scopeId(s)}`;
    const { input, rows } = fileCardCtx({ key, list, doc: true, locked: false, period: data.resetPeriod, redraw: redrawBrief,
      setFocus: (k) => { briefFocusNext = k; }, url: `${briefApi(s)}/documents`, owner: 'brief', addUi: 'docs-add', headUi: 'docs-head' });
    return h('section', { class: 'card req-files req-docs', 'aria-label': 'Documents', 'data-ui': 'docs-card' },
      h('div', { class: 'req-card-head req-files-head' },
        h('div', {}, h('h3', { text: `Documents · ${list.length}`, tabindex: '-1', 'data-ui': 'docs-head' }),
          h('p', { class: 'hint', text: `Worca uses these for every feature in ${name}.` })),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'docs-add', disabled: list.length >= REQ_ATTACH.maxFiles, onclick: () => input.click() }, 'Add documents'),
        input),
      privacyNote(data.interview),
      refusalAlert(key),
      filesStatus(list),
      list.length ? h('div', { class: 'req-files-list' }, ...rows) : h('p', { class: 'hint req-files-empty', text: 'No documents yet.' }),
      h('p', { class: 'hint req-docs-foot', text: `Interviews use a new document right away. The brief's sections change only when you Refresh it. “Send with every run” adds the document to every run started from a ${name} feature; each start card lists it.` }));
  }

  // The looks at the code this feature made (A2: the orientation turns not skipped), and what they cost.
  function looksOf(turns) {
    const looks = turns.filter((t) => t.kind === 'orientation' && !(t.payload && t.payload.skipped));
    return { looks, cost: looks.reduce((sum, t) => sum + (Number(t.costUsd) || 0), 0) };
  }
  const postLook = (f) => act(async () => { await api('POST', `/api/requirements/${f.seq}/look`, {}); await paint(); });

  // A2's folded box, for a feature whose scope has no usable brief. An orientation skipped for a brief that is
  // gone now (deleted, or the feature moved) says so and offers Look again (D10).
  function orientationBox(f, turns) {
    const o = f.orientation;
    const text = !o ? 'Not looked yet.'
      : o.skipped === 'brief' ? 'Worca has not looked at the code for this feature.'
        : o.skipped === 'off' ? 'Looking at the code is turned off for this one (Your notes for Worca).'
          : o.skipped === 'no-git' ? `Worca did not look at the code: ${GIT_MISSING_TEXT}.`
            : o.skipped === 'no-repo' ? 'There is no repository to look at yet.'
              : o.skipped === 'failed' ? 'Worca could not look at the code this time; the interview runs without it.'
                : o.summary || 'Nothing relevant found.';
    const { looks, cost } = looksOf(turns);
    const times = looks.length === 1 ? 'looked once' : looks.length === 2 ? 'looked twice' : `looked ${looks.length} times`;
    const nFiles = ((o && o.files) || []).length;
    const meta = looks.length ? [times, nFiles ? plural(nFiles, 'file') : null, cost > 0 ? usd(cost) : null].filter(Boolean).join(' · ') : null;
    return h('details', { class: 'card req-orient', open: ui.orientOpen }, // `open: false` is skipped by h()
      h('summary', {}, 'What Worca found in the code', meta ? h('span', { class: 'hint req-orient-meta', text: meta }) : null),
      h('p', { text }),
      o && o.skipped === 'brief' ? h('div', { class: 'req-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'orient-look-again', 'data-needs-git': true, disabled: isLocked(f), onclick: () => postLook(f) }, 'Look again')) : null,
      o && o.files && o.files.length ? h('ul', { class: 'hint', 'data-min-level': 'advanced' }, ...o.files.map((p) => h('li', { text: p }))) : null);
  }

  // What Worca knows (board 14, A7 D10/D11): the card that replaces A2's box when the scope has a usable brief.
  // Before a closer look Worca works from the brief (Look closer offers one); after it, the look's summary, Add
  // this to the brief (until added) and Look again. The switch off hides both looks; the A1 lock disables them.
  function knowsCard(f, turns) {
    const b = f.brief;
    const o = f.orientation || null;
    const locked = isLocked(f);
    const lookOn = b.lookAtCode !== false;
    const looked = !!(o && !o.skipped);
    const to = briefPath(f.scopeType, f.scopeKey);
    let meta;
    let body;
    let foot = null;
    if (!looked) {
      // the brief's own names (areas first, then terms), at most 3, and how many more matched (A7 §5)
      const names = (Array.isArray(b.matches) ? b.matches : []).filter((m) => typeof m === 'string' && m);
      const more = names.length && Number.isInteger(b.matchesMore) && b.matchesMore > 0 ? b.matchesMore : 0;
      const subject = names.length ? (more ? `${names.join(', ')} and ${more} more` : joinAnd(names)) : '';
      const isAre = names.length + more === 1 ? 'is' : 'are';
      const said = (f.attachments || []).length
        // A8 (board 16): the feature's files are part of what Worca works from
        ? `Worca works from the ${targetName(f)} brief and the files below.${subject ? ` ${subject[0].toUpperCase()}${subject.slice(1)} ${isAre} described in the brief.` : ''} It has not looked at the code for this feature.`
        : `Worca works from the ${targetName(f)} brief${names.length ? `: ${subject} ${isAre} described there.` : '.'} It has not looked at the code for this feature.`;
      meta = ['from the ', briefLink(to), ` · ${ageOld(b.madeAt)}`];
      body = [h('p', { class: 'req-knows-text', text: said }),
        o && o.skipped === 'failed' ? h('p', { class: 'hint req-knows-failed', text: 'Worca could not look at the code this time.' }) : null];
      if (lookOn) {
        // a look checks out the code: the hint and Look closer hide while git is missing (git-gate.mjs)
        foot = [h('span', { class: 'hint', 'data-needs-git': true, text: 'Worth it when the feature touches something the brief only skims.' }),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'look-closer', 'data-needs-git': true, disabled: locked, onclick: () => postLook(f) },
            `Look closer${typeof f.lookCostUsd === 'number' ? ` · about ${usd(f.lookCostUsd)}` : ''}`)];
      }
    } else {
      const { cost } = looksOf(turns);
      const nFiles = (Array.isArray(o.files) ? o.files : []).length;
      meta = [['brief + a closer look', nFiles ? plural(nFiles, 'file') : null, usd(cost)].filter(Boolean).join(' · ')];
      // The link goes once added: the focus moves to Look again (else to this card) and the message line names the area.
      const add = () => act(async () => {
        await api('POST', `/api/requirements/${f.seq}/brief-addition`, {});
        focusNext = lookOn && gitOn() ? 'look-again' : 'knows';   // Look again hides while git is missing
        await paint();
        say(`Added to the product brief as “${areaLabel({ belongsTo: o.area || null, name: f.title })}”.`, 'ok');
      });
      // Only a look made for this scope against this brief can be added (the server refuses any other, A7 D11).
      const ofThisBrief = o.scopeType === f.scopeType && o.scopeKey === f.scopeKey && o.briefId != null && (b.id == null || o.briefId === b.id);
      body = [h('p', { class: 'req-knows-text', text: o.summary || 'Nothing relevant found.' }),
        o.summary && !o.addedToBrief && ofThisBrief ? h('p', { class: 'hint req-knows-add' }, 'Not in the brief yet. ',
          h('button', { type: 'button', class: 'link-btn', 'data-ui': 'brief-add', disabled: locked, onclick: add }, 'Add this to the brief')) : null];
      if (lookOn) foot = [h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'look-again', 'data-needs-git': true, disabled: locked, onclick: () => postLook(f) }, 'Look again')];
    }
    return h('section', { class: `card req-knows${looked ? ' req-knows-looked' : ''}`, 'aria-label': 'What Worca knows', 'data-ui': 'knows', tabindex: '-1' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'What Worca knows' }), h('span', { class: 'hint req-knows-meta' }, ...meta)),
      ...body,
      foot ? h('div', { class: 'req-knows-foot' }, ...foot) : null);
  }

  // A menu button (the ⋯ header menu's pattern, .hd-more-wrap / .hd-menu, in upstream's one .menu box): the trigger toggles a role=menu
  // list; a choice, Escape (focus back on the trigger) or a press outside closes it. The open one is kept
  // in `ui.menu`, so a live repaint does not shut it.
  function menu(key, trigger, items) {
    const on = ui.menu === key;
    const list = h('div', { class: 'menu hd-menu req-menu-list', role: 'menu', hidden: !on }, ...items);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', on ? 'true' : 'false');
    trigger.addEventListener('click', () => setMenu(ui.menu === key ? null : key));
    list.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) setMenu(null); }, true);
    const wrap = h('div', { class: 'hd-more-wrap req-menu', 'data-menu': key }, trigger, list);
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || ui.menu !== key) return;
      e.preventDefault(); e.stopPropagation();
      setMenu(null);
      trigger.focus();
    });
    return wrap;
  }
  function setMenu(key) {
    ui.menu = key;
    for (const w of host.querySelectorAll('[data-menu]')) {
      const on = w.getAttribute('data-menu') === key;
      w.querySelector('[role="menu"]').hidden = !on;
      w.querySelector('[aria-haspopup]').setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  }
  // Each item has a data-ui, so a live repaint keeps the focus on it inside the open menu.
  const menuItem = (label, onclick, { disabled = false, ui: key = null, needsGit = false } = {}) => h('button', { type: 'button', role: 'menuitem', class: 'menu-item req-menu-item', 'data-ui': key, 'data-needs-git': needsGit, disabled, onclick }, label);

  // ---- A3: Ask Worca (boards 22, 23, 25; plans/requirements-a3-design.md §6) ----
  const HELP_STARTERS = ['Is anything missing from this spec?', "Which criteria can't be tested?", 'What edge cases am I missing?'];
  const HELP_FAILED = 'Worca could not answer. Try again.';
  /** A 404 that names a chat message or a change (another tab cleared the chat) says so; any other 404 is the page's own line. */
  const HELP_GONE = new Set(['This message is no longer in the chat.', 'This change is no longer in the chat.']);
  const helpErr = (err) => (err && err.status === 404 && err.data && HELP_GONE.has(err.data.error) ? err.data.error : errText(err));
  /** The section a proposal changes, in the spec card's words (SECTIONS), plus the criteria and the assumptions. */
  const helpLabel = (p) => (p.target === 'criterion' ? 'Acceptance criteria' : p.target === 'assumption' ? 'Assumptions' : sectionTitle(p.target));
  /** D13: "$L–H" from the last helper calls (one value when they agree); "$0.01–0.05" before any. */
  function helpRange(est) {
    if (!est || typeof est.low !== 'number' || typeof est.high !== 'number') return '$0.01–0.05';
    const lo = est.low.toFixed(2);
    const hi = est.high.toFixed(2);
    return lo === hi ? `$${lo}` : `$${lo}–${hi}`;
  }
  const helpChat = (f) => helperData || { messages: [], answering: !!(f.helper && f.helper.answering), estimate: null };
  /** A chat read from the server. A reply that started, or rows that are new since the last one, mean the cause of a spent
   *  budget or a refusal is gone: their lines go (§6). */
  function takeChat(body) {
    const lastId = (d) => { const rows = (d && d.messages) || []; return rows.length ? rows.at(-1).id : null; };
    if (body && ((body.answering && !(helperData && helperData.answering)) || lastId(body) !== lastId(helperData))) {
      helperUi.budget = false;
      helperUi.error = null;
    }
    helperData = body;
  }
  /** A refused chat POST: a spent budget says so in the chat, one way for every control (§6); anything else under the composer. */
  function helpRefused(err) {
    if (err && err.data && err.data.code === 'BUDGET') helperUi.budget = true;
    else helperUi.error = helpErr(err);
  }
  /** The composer's text, in the state and on screen (capture() reads the screen before every repaint). */
  function setComposer(value) {
    helperUi.text = value;
    const el = host.querySelector('[data-ui="helper-in"]');
    if (el) el.value = value;
  }
  /** The cap above a product owner's message (D1, D10): its question, or the proposal it asks again about. */
  function helpCap(m) {
    const fo = m.focus;
    if (!fo) return null;
    if (fo.questionId) return `Help me answer · question ${fo.n}`;
    if (fo.askAgain) {
      const src = ((helperData && helperData.messages) || []).find((x) => x.id === fo.askAgain.msgId);
      const p = src && (src.proposals || []).find((x) => x.n === fo.askAgain.n);
      return p ? `Ask again · ${helpLabel(p)}` : 'Ask again';
    }
    return null;
  }
  function openHelper(f, opener) {
    helperOpen.set(f.seq, true);
    helperUi.opener = opener;
    helperUi.error = null;
    focusNext = f.status === 'archived' ? 'helper-more' : 'helper-in';
    redraw();
    void paint();   // the chat and its estimate
  }
  function closeHelper(f, to = null) {
    helperOpen.set(f.seq, false);
    focusNext = to || helperUi.opener || 'helper-toggle';
    helperUi.opener = null;
    redraw();
  }
  function toggleHelper(f) {
    if (helperOpen.get(f.seq)) { closeHelper(f, 'helper-toggle'); return; }
    helperUi.focus = null;   // D1: the header toggle is for general talk; no Help me answer cap is carried over
    openHelper(f, 'helper-toggle');
  }
  /** D1: Help me answer opens the panel with the question in focus: the composer holds its text and the cap; it never sends. */
  function helpMeAnswer(f, round, q, i) {
    helperOpen.set(f.seq, true);
    helperUi.focus = { roundTurnId: round.turnId, questionId: q.id, n: i + 1 };
    setComposer(q.question);
    helperUi.opener = `help-${round.turnId}-${i}`;
    helperUi.error = null;
    helperUi.budget = false;
    focusNext = 'helper-in';
    redraw();
    void paint();
  }
  /** D6: the drafts of the newest reply whose round is this pending one fill the card, each once per visit (a cleared or
   *  hand-changed draft stays so until the page is loaded again). */
  function applyHelperDrafts(round, d) {
    const msgs = (helperData && helperData.messages) || [];
    const m = [...msgs].reverse().find((x) => x.role === 'worca' && x.roundTurnId === round.turnId && (x.drafts || []).some((y) => !y.dropped));
    if (!m) return;
    for (const dr of m.drafts) {
      const k = `${m.id}:${dr.question}`;
      const q = round.questions.find((x) => x.id === dr.question);
      if (dr.dropped || !q || helperApplied.has(k)) continue;
      helperApplied.add(k);
      if (typeof dr.option === 'string' && q.options.includes(dr.option)) { d.picks[q.id] = dr.option; delete d.texts[q.id]; }
      else if (typeof dr.text === 'string' && dr.text) { d.texts[q.id] = dr.text; delete d.picks[q.id]; }
      else continue;
      d.drafted[q.id] = m.id;
    }
  }
  const draftWhy = (msgId, qid) => {
    const m = ((helperData && helperData.messages) || []).find((x) => x.id === msgId);
    const dr = m && (m.drafts || []).find((x) => x.question === qid);
    return dr && dr.why ? dr.why : '';
  };

  /** Send (the composer's text or a starter's): a refusal keeps the typed text and says why under the composer; a spent budget
   *  says so in the chat instead (§6). */
  async function sendHelper(f, text = helperUi.text, focus = helperUi.focus) {
    if (helperBusy) return;   // a second press while the first is in flight (each send is a paid call)
    helperBusy = true;
    const seq = f.seq;
    const vg = viewGen;
    const gen = ++helperGen;
    helperUi.error = null;
    let late = false;
    try {
      const data = await api('POST', `/api/requirements/${seq}/helper/messages`, { text, ...(focus ? { focus } : {}) });
      if (seqShown !== seq || vg !== viewGen) { late = true; return; }   // another feature is shown now: this reply is not for it
      helperData = data;
      helperUi.budget = false;
      if (text === helperUi.text) { setComposer(''); helperUi.focus = null; }
    } catch (err) {
      if (seqShown !== seq || vg !== viewGen) { late = true; return; }
      helpRefused(err);
    } finally {
      if (gen === helperGen) helperBusy = false;
    }
    if (late) return;
    focusNext = 'helper-in';
    redraw();
  }
  /** Stop, Try again, Clear chat, and Tasks 8's Accept / Reject / Ask again: the server's chat comes back, then the feature is
   *  fetched again (an accepted change is in the spec). A spent budget shows in the chat, any other refusal under the composer.
   *  A press while another chat POST is in flight is ignored; the follow-up refetch does not hold the guard (a Stop pressed while
   *  it runs is sent). A reply that lands after another feature was opened is dropped. */
  async function helperPost(f, method, path, focusUi = null) {
    if (helperBusy) return;
    helperBusy = true;
    const seq = f.seq;
    const vg = viewGen;
    const gen = ++helperGen;
    helperUi.error = null;
    let late = false;
    try {
      const data = await api(method, `/api/requirements/${seq}/helper${path}`, method === 'DELETE' ? undefined : {});
      if (seqShown !== seq || vg !== viewGen) { late = true; return; }
      helperData = data;
      helperUi.budget = false;
    } catch (err) {
      if (seqShown !== seq || vg !== viewGen) { late = true; return; }
      helpRefused(err);
    } finally {
      if (gen === helperGen) helperBusy = false;
    }
    if (late) return;
    if (focusUi) focusNext = focusUi;
    await paint();
  }
  /** Try again on a chat that could not be read: the feature and its chat are fetched again. */
  async function reloadHelper() {
    if (helperBusy) return;
    helperBusy = true;
    const gen = ++helperGen;
    helperReloads += 1;
    focusNext = 'helper-in';
    try { await paint(); } finally { if (gen === helperGen) helperBusy = false; }
  }
  function clearHelper(f) {
    if (helperBusy || !window.confirm('Clear the chat? Changes you accepted stay in the spec.')) return;
    void helperPost(f, 'DELETE', '', 'helper-in');
  }

  const budgetLine = (f) => h('p', { class: 'req-help-budget', role: 'alert',
    text: `You have reached the Requirements spending limit for this ${f.resetPeriod === 'weekly' ? 'week' : 'month'}. Worca can answer again when it resets, or raise the limit in Settings › Budget.` });
  /** A failed, stopped or refused reply (§6 Lines in the chat); `m` null: a message left without a reply (D20). Try again only on
   *  the newest row, never while answering or on an archived feature. */
  function helperLine(f, m, ctx) {
    const code = m && m.error ? m.error.code : null;
    if (code === 'BUDGET') return budgetLine(f);
    const again = ctx.newest && !ctx.answering && !ctx.archived
      ? h('button', { type: 'button', class: 'btn btn-sm req-help-retry', 'data-ui': 'helper-retry', disabled: ctx.working,
        onclick: () => helperPost(f, 'POST', '/retry', 'helper-in') }, 'Try again') : null;
    if (code === 'STOPPED') return h('p', { class: 'hint req-help-stopped' }, 'You stopped this reply.', again ? ' ' : null, again);
    return h('p', { class: 'req-help-fail', role: 'alert' }, HELP_FAILED, again ? ' ' : null, again);
  }
  /** What a reply carries besides its text: the dropped-draft line (D6); Task 8 adds the proposal cards. */
  function helperExtras(f, m) {
    return [
      (m.drafts || []).some((x) => x.dropped)
        ? h('p', { class: 'hint req-help-dropped', text: "The question you asked about has been answered, so Worca's draft for it was dropped." }) : null,
    ];
  }
  function helperMessage(f, m, ctx) {
    if (m.role === 'po') {
      const cap = helpCap(m);
      return h('div', { class: 'req-help-msg-po', 'data-msg': m.id }, cap ? h('span', { class: 'req-help-cap', text: cap }) : null, m.text);
    }
    return h('div', { class: 'req-help-msg-w', 'data-msg': m.id },
      m.error ? helperLine(f, m, ctx) : h('p', { class: 'req-help-text', text: m.text }),
      ...helperExtras(f, m, ctx),
      m.costUsd > 0 ? h('p', { class: 'hint req-help-cost', text: usd(m.costUsd) }) : null);
  }
  /** D18: a message's node is rebuilt only when this key changes, so the key holds the message and ONLY the parts of `ctx` (and of
   *  `f`) that change that message's DOM: a rebuilt node in the role=log live region is read out again, so a key with the whole
   *  ctx would re-read the history on every Send, reply and round. This is the one place a row's dependencies are listed: the
   *  dropped-draft line (D6) reads only `m.drafts`, already in the key; Task 8 (the proposal cards: their state, stale mark, Ask
   *  again, and the ctx their Accept / Reject / Ask again read) adds its parts here. */
  function helperRowKey(f, m, ctx) {
    if (m.role === 'po') return JSON.stringify([m, helpCap(m)]);
    const code = m.error ? m.error.code : null;
    // helperLine: the spending limit names the period; any other failed row shows Try again on the newest row only, off while a
    // round or look runs
    const again = !!code && code !== 'BUDGET' && ctx.newest && !ctx.answering && !ctx.archived;
    const line = !code ? null : code === 'BUDGET' ? f.resetPeriod : [again, again && ctx.working];
    return JSON.stringify([m, line]);
  }
  /** The log's message nodes; an unchanged message keeps its node across paints (D18: a live region announces only what is new). */
  function helperLogNodes(f, msgs, ctx) {
    const out = [];
    const keep = new Map();
    msgs.forEach((m, i) => {
      const c = { ...ctx, newest: i === msgs.length - 1 };
      const sig = helperRowKey(f, m, c);
      let node = helperNodes.get(m.id);
      if (!node || node.sig !== sig) node = { sig, el: helperMessage(f, m, c) };
      keep.set(m.id, node);
      out.push(node.el);
    });
    helperNodes.clear();
    for (const [id, node] of keep) helperNodes.set(id, node);
    return out;
  }
  /** The log's other lines (card 7, D20's line, the spending limit), kept across paints while they read the same (`sig`). */
  function helperTail(k, sig, make) {
    const had = helperTails.get(k);
    if (had && had.sig === sig) return had.el;
    const el = make();
    helperTails.set(k, { sig, el });
    return el;
  }
  /** D18: the log's children made `wanted`, in order, without taking out a node that stays (a live region can announce a
   *  re-inserted node as new): the gone ones are removed, the new ones inserted where they belong, the rest left in place. */
  function reconcileLog(log, wanted) {
    const keep = new Set(wanted);
    for (const el of [...log.children]) if (!keep.has(el)) el.remove();
    wanted.forEach((el, i) => { if (log.children[i] !== el) log.insertBefore(el, log.children[i] || null); });
  }
  /** Card 8, kept while Worca answers so its status is announced once. */
  function waitingLine(f) {
    if (!helperWaitEl) {
      helperWaitEl = h('div', { class: 'req-help-waiting' },
        h('p', { class: 'req-help-waiting-line', role: 'status' }, h('span', { class: 'badge blue', text: 'Answering…' }), ' Worca is answering. ',
          h('button', { type: 'button', class: 'btn btn-sm req-help-stop', 'data-ui': 'helper-stop' }, 'Stop')),
        h('p', { class: 'hint', text: 'Send and Accept wait while Worca answers. Stop cancels the reply; your message stays in the chat.' }));
    }
    helperWaitEl.querySelector('.req-help-stop').onclick = () => helperPost(f, 'POST', '/stop', 'helper-in');
    return helperWaitEl;
  }
  /** Card 7: what Worca knows, and three questions that send at once (none on an archived feature). */
  const helperEmpty = (f, ctx) => h('div', { class: 'req-help-empty' },
    h('p', { text: 'Ask Worca about this feature. It knows the spec, the interview so far, the product brief, your files and what it found in the code. It can draft answers to open questions and suggest spec changes — nothing changes until you accept.' }),
    ctx.archived ? null : h('div', { class: 'req-help-starters' }, ...HELP_STARTERS.map((q, i) => h('button', { type: 'button', class: 'btn btn-sm req-help-starter',
      'data-ui': `helper-starter-${i}`, disabled: ctx.working, onclick: () => sendHelper(f, q, null) }, q))));
  /** The composer (board 22): Enter sends, Shift+Enter adds a line; the count past 1,800; Send off when empty, past 2,000, while
   *  Worca answers and while a round or look runs (D11). */
  function helperComposer(f, data, ctx) {
    const ta = h('textarea', { id: 'req-help-in', class: 'req-help-in', rows: '2', 'data-ui': 'helper-in' });
    ta.value = helperUi.text;
    const count = h('p', { class: 'hint req-help-count' });
    const send = h('button', { type: 'button', class: 'btn btn-sm btn-primary req-help-send', 'data-ui': 'helper-send' }, 'Send');
    const cap = helperUi.focus ? h('span', { class: 'req-help-cap', text: `Help me answer · question ${helperUi.focus.n}` }) : null;
    const go = () => { if (!send.disabled) void sendHelper(f); };
    const sync = () => {
      helperUi.text = ta.value;
      if (!ta.value.trim() && helperUi.focus) { helperUi.focus = null; if (cap) cap.remove(); }   // emptied: general talk again (D1)
      const n = ta.value.length;
      count.hidden = n <= 1800;
      count.textContent = n > 1800 ? `${n.toLocaleString('en-US')} of 2,000 characters` : '';
      const t = ta.value.trim();
      send.disabled = !t || t.length > 2000 || ctx.answering || ctx.working;
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
    send.addEventListener('click', go);
    sync();
    return h('form', { class: 'req-help-composer', onsubmit: (e) => { e.preventDefault(); go(); } },
      h('label', { class: 'req-help-label', for: 'req-help-in', text: 'Ask about this feature' }),
      helperUi.focus ? cap : null,
      ta, count,
      h('div', { class: 'req-help-foot' },
        h('span', { class: 'hint req-help-costline' },
          f.interview && f.interview.label ? h('span', { class: 'req-help-wide', text: `${f.interview.label} · ` }) : null,
          `about ${helpRange(data.estimate)} a message`,
          h('span', { class: 'req-help-wide', text: ' · Enter sends, Shift+Enter new line' })),
        send),
      helperUi.error ? h('p', { class: 'req-help-refusal', role: 'alert', text: helperUi.error }) : null);
  }
  /** The panel (board 22) and, at 900 px and narrower, the full-screen sheet (board 25): the same DOM, the CSS decides. */
  function helperPanel(f) {
    const data = helpChat(f);
    const msgs = data.messages || [];
    const ctx = { answering: !!data.answering, archived: f.status === 'archived', locked: isLocked(f), working: isWorking(f) };
    if (!helperLog) helperLog = h('div', { class: 'req-help-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Ask Worca chat' });
    const lastRow = msgs.at(-1);
    const unanswered = !ctx.answering && lastRow && lastRow.role === 'po';   // D20
    // a chat with messages that could not be read: never card 7's text and its starters (each a paid call) over it
    const unloaded = !helperData && !!(f.helper && f.helper.messages > 0);
    // the tails' keys hold only the ctx their DOM reads (D18, as helperRowKey)
    reconcileLog(helperLog, [
      ...helperLogNodes(f, msgs, ctx),
      unloaded ? helperTail('unloaded', String(helperReloads), () => h('p', { class: 'req-help-fail req-help-unloaded', role: 'alert' },
        'Worca could not load the chat. Try again. ',
        h('button', { type: 'button', class: 'btn btn-sm req-help-retry', 'data-ui': 'helper-reload', onclick: () => reloadHelper() }, 'Try again'))) : null,
      !msgs.length && !ctx.answering && !unloaded
        ? helperTail('empty', JSON.stringify([ctx.archived, ctx.working]), () => helperEmpty(f, ctx)) : null,
      ctx.answering ? waitingLine(f) : null,
      unanswered ? helperTail('d20', JSON.stringify([lastRow.id, ctx.archived, ctx.working]), () => helperLine(f, null, { ...ctx, newest: true })) : null,
      helperUi.budget ? helperTail('budget', String(f.resetPeriod), () => budgetLine(f)) : null,
    ].filter(Boolean));
    if (!ctx.answering) helperWaitEl = null;
    const more = menu('helper-more', h('button', { type: 'button', class: 'req-ico', 'aria-label': 'More for this chat', title: 'More for this chat', 'data-ui': 'helper-more' },
      icon(ICONS.dots, { size: 16, fill: 'currentColor', stroke: 'none' })), [
      menuItem('Clear chat', () => clearHelper(f), { ui: 'helper-clear', disabled: ctx.answering || ctx.archived || !msgs.length }),
    ]);
    return h('aside', { class: 'req-help', 'aria-label': 'Ask Worca', onkeydown: (e) => {
      // an open menu closes itself first (menu()); an input method's Escape cancels its composition, not the panel
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      closeHelper(f);
    } },
      h('div', { class: 'req-help-head' },
        h('button', { type: 'button', class: 'req-ico req-help-back', 'aria-label': `Back to ${f.id}`, 'data-ui': 'helper-back', onclick: () => closeHelper(f) },
          sharedIcon(document, 'chevron-left', 18)),
        h('div', { class: 'req-help-title' }, h('h3', { text: 'Ask Worca' }),
          h('p', { class: 'hint' }, `About ${f.id}`, h('span', { class: 'req-help-wide', text: ' · uses what Worca already knows' }))),
        more,
        h('button', { type: 'button', class: 'req-ico req-help-close', 'aria-label': 'Close Ask Worca', title: 'Close Ask Worca', 'data-ui': 'helper-close',
          onclick: () => closeHelper(f) }, icon(ICONS.remove, { size: 15 }))),
      helperLog,
      ctx.archived ? h('p', { class: 'hint req-help-archived', text: 'This feature is archived: you can read the chat, not send. Restore the feature to ask Worca again.' })
        : helperComposer(f, data, ctx));
  }

  function header(f) {
    const save = () => act(async () => {
      try {
        const r = await api('POST', `/api/requirements/${f.seq}/save`, {});
        say(`Saved to ${r.path} (not committed).`, 'ok');
      } catch (err) {
        if (err.data?.error !== 'exists') throw err;
        if (!window.confirm(`${err.data.path} already exists. Replace it?`)) return;
        const r = await api('POST', `/api/requirements/${f.seq}/save`, { overwrite: true });
        say(`Saved to ${r.path} (not committed).`, 'ok');
      }
    });
    const copy = () => act(async () => {
      const res = await fetch(`/api/requirements/${f.seq}/markdown`);
      if (!res.ok) throw new Error(`Could not copy the Markdown (HTTP ${res.status}).`);
      await navigator.clipboard.writeText(await res.text());
      say('Copied as Markdown.', 'ok');
    });
    const archived = f.status === 'archived';
    const rounds = Number(f.rounds) || 0;
    const done = f.status === 'done' || !!f.readiness?.checks?.find((c) => c.key === 'interview')?.ok;
    return h('div', { class: 'req-head', 'data-req-feature': f.seq },
      h('div', { class: 'req-head-main' },
        h('div', { class: 'req-head-title' }, h('code', { class: 'req-id', text: f.id }), h('h2', { text: f.title }), stateMark(f)),
        h('div', { class: 'req-chips' },
          h('span', { class: 'chip', text: targetLabel(f) }),
          h('span', { class: 'chip', text: done ? `Interview done · ${plural(rounds, 'round')}` : `Round ${Math.min(rounds || 1, MAX_ROUNDS)} of ${MAX_ROUNDS}` }),
          h('span', { class: 'chip', text: `${usd(f.costUsd)} so far` }),
          (f.attachments || []).length ? h('span', { class: 'chip', text: plural(f.attachments.length, 'file') }) : null,   // A8 (board 16)
          f.savedPath ? h('span', { class: 'chip', text: `Saved as ${f.savedPath}` }) : null)),
      h('div', { class: 'req-head-tools' },
        // A3 D1: Ask Worca opens and closes the chat beside the spec; pressed, an ink border (never a green fill)
        h('button', { type: 'button', class: 'btn btn-sm req-help-toggle', 'aria-pressed': helperOpen.get(f.seq) ? 'true' : 'false', 'data-ui': 'helper-toggle',
          onclick: () => toggleHelper(f) }, 'Ask Worca'),
        menu('export', h('button', { type: 'button', class: 'btn btn-sm', 'data-ui': 'menu-export' }, 'Export', sharedIcon(document, 'chevron-down', 14)), [
          f.scopeType === 'project' ? menuItem('Save to specs/', save, { ui: 'mi-save' }) : null,
          menuItem('Copy Markdown', copy, { ui: 'mi-copy' }),
          h('a', { role: 'menuitem', class: 'menu-item req-menu-item', 'data-ui': 'mi-download', href: `/api/requirements/${f.seq}/markdown?download=1`, download: '' }, 'Download .md'),
        ]),
        menu('more', h('button', { type: 'button', class: 'req-ico', 'aria-label': 'More actions', title: 'More actions', 'data-ui': 'menu-more' },
          icon(ICONS.dots, { size: 18, fill: 'currentColor', stroke: 'none' })), [
          // the notes moved to the brief page (A7 D12)
          menuItem('Your notes for Worca', () => route(briefPath(f.scopeType, f.scopeKey)), { ui: 'mi-notes' }),
          // with a brief: Look closer while Worca works from it alone; none with the switch off (D11)
          f.brief && f.brief.lookAtCode === false ? null
            : menuItem(f.brief && !(f.orientation && !f.orientation.skipped) ? 'Look closer' : 'Look again', () => postLook(f),
              { disabled: isLocked(f), ui: 'mi-look', needsGit: true }),   // a look checks out the code (git-gate.mjs)
          menuItem(archived ? 'Restore' : 'Archive', () => act(async () => {
            await api('POST', `/api/requirements/${f.seq}/archive`, archived ? { restore: true } : {});
            await paint();
          }), { disabled: !!f.busy, ui: 'mi-archive' }),
        ])));
  }

  // A repaint from the feature on screen, without a fetch (a fold, an editor opened, Change, Cancel).
  function redraw() { if (current) paintFeature(current.f, current.turns); }

  function paintFeature(f, turns = []) {
    current = { f, turns };
    seqScope.set(Number(f.seq), scopeId(f));
    const focus = capture(f);
    const rounds = roundsOf(turns);
    // A3 D2: while Ask Worca is open it takes the right column, and Ready to start?, Files and Spec move under the current card
    // (A2's Ready panel stays first; boards 16 and 18 draw the Files card above the spec)
    const open = !!helperOpen.get(f.seq);
    const left = conversation(f, turns, rounds, open ? h('div', { class: 'req-moved' }) : null);
    const right = [readyPanel(f), filesCard(f), specCard(f)];
    if (open) left.querySelector('.req-moved').append(...right.filter(Boolean));
    paintHost(h('div', { class: 'req-page' },
      h('a', { href: '#requirements', class: 'hint req-back', onclick: (e) => { e.preventDefault(); route(''); } }, '← All features'),
      header(f),
      h('div', { class: `req-cols${open ? ' with-helper' : ''}` }, left, open ? helperPanel(f) : h('div', { class: 'req-right' }, ...right))));
    if (ui.editVals && ui.editVals.key !== editing) ui.editVals = null;
    const want = focusNext || focus;
    const sel = focusNext ? null : keptSel;   // a field just opened starts fresh; the focused one keeps its caret
    focusNext = null;
    keptSel = null;
    if (want) {
      const el = host.querySelector(`[data-ui="${want}"]`);
      if (el && !el.disabled) {
        el.focus();
        if (sel && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(sel[0], sel[1], sel[2] || 'none'); } catch { /* not a text field */ } }
      }
    }
    // A focus kept for later (a revision sent: that round's Change): taken once the control is back and the
    // focus is still nowhere; dropped as soon as the focus is somewhere else.
    if (focusLater) {
      const a = document.activeElement;
      const lost = !a || a === document.body || !a.isConnected;
      const el = host.querySelector(`[data-ui="${focusLater}"]`);
      if (!lost) focusLater = null;
      else if (el && !el.disabled) { el.focus(); focusLater = null; }
    }
    // A3: the newest message in view, only when a new one came: a repaint (another tab's edit, a file read) never pulls the
    // product owner back down while they read older messages; opening the panel scrolls once
    const log = helperOpen.get(f.seq) ? host.querySelector('.req-help-log') : null;
    const rows = log && helperData ? helperData.messages || [] : [];
    const newest = log ? String(rows.length ? rows.at(-1).id : '') : null;
    if (log && newest !== helperNewest) log.scrollTop = log.scrollHeight;
    helperNewest = newest;
  }

  const onDocClick = (e) => {
    if (!ui.menu) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('[data-menu]') && host.contains(t)) return;
    setMenu(null);
  };
  document.addEventListener('click', onDocClick, true);
  // git appears or goes missing (git-gate.mjs): New feature says its look line again (the form keeps what was typed)
  // and the brief page repaints its notice; the rest follows the CSS gate on [data-needs-git].
  const offGit = onGitChange(() => {
    if (paintedKey === 'new') { if (relook) relook(); } else if (paintedKey && paintedKey.startsWith('brief/')) void paint();
  });

  return { show, changed, destroy: () => { paintNo += 1; closeDialog(false); offGit(); document.removeEventListener('click', onDocClick, true); host.replaceChildren(); } };
}
