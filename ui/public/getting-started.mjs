// ui/public/getting-started.mjs
// The Getting-started checklist (docs/getting-started.md): the tile shelf on the
// New pipeline view, the sidebar pill that follows the user to other views, and
// the welcome dialog's bindings. Pure DOM in, pure DOM out — no fetch, no app
// state — so test/ui-getting-started.test.mjs drives it in jsdom without booting
// app.js. Completion is never decided here: `status.steps` is the server's word
// (GET /api/onboarding, src/core/onboarding.mjs), this module only paints it.
import { icon } from './icons.mjs';
import { guardModal } from './modal-guard.mjs';
import { WORCA_LEVEL_COUNT } from '../../src/shared/worca-levels.mjs';

/** Shelf order = the arc: prerequisite → first object → see the loop → talk to
 *  it → know the workflows → real work → scale. Labels are outcomes, never settings. */
export const GETTING_STARTED_STEPS = Object.freeze([
  { id: 'claude',      label: 'Connect a model',                 vig: 'claude' },
  { id: 'project',     label: 'Add your first project',          vig: 'project' },
  { id: 'run',         label: 'Watch a run end to end',          vig: 'run' },
  { id: 'ask',         label: 'Ask about a run in Chat',         vig: 'ask' },
  { id: 'realRun',     label: 'Run a real pipeline',             vig: 'realRun' },
  { id: 'workflows',   label: 'Explore the built-in workflows',  vig: 'workflow' },
  { id: 'workspace',   label: 'Group projects into a workspace', vig: 'workspace',   level: 'advanced', helps: 'hooked' },
  { id: 'teamMetrics', label: 'Turn on team metrics',            vig: 'teamMetrics', level: 'expert',   helps: 'hooked' },
  { id: 'teamPolicy',  label: 'Set a team policy',               vig: 'teamPolicy',  level: 'expert',   helps: 'hooked' },
]);

/** The step that opens the setup assistant. Not one of the nine: it never counts and is shown only while setup is unfinished. */
const SETUP_STEP = Object.freeze({ id: 'setup', label: 'Finish setup', vig: 'project' });
const TEAM_STEP_IDS = new Set(['teamMetrics', 'teamPolicy']);
const RUNNER_LEVEL = 2;
const RUNNER_REAL_RUNS = 3;
const RUNNER_STEP_COUNT = 6;
const TOWARD_RUNNER = GETTING_STARTED_STEPS.slice(0, RUNNER_STEP_COUNT);
const HELPS_LABEL = { hooked: 'Helps Hooked' };

// `level` (docs/ui-levels.md) is the interface mode a step's controls live in; absent = simple.
// Every tile shows at every mode — the count stays "n of 9" — but a step above the current mode
// wears its level, and its guide asks to switch the mode before it starts.
const LEVEL_ORDER = ['simple', 'advanced', 'expert'];
const LEVEL_LABEL = { advanced: 'Advanced', expert: 'Expert' };

/** Seconds a tile holds the reveal sequence before the next arrives: an
 *  unfinished tile paints its drawing first, a finished one arrives already
 *  drawn and still, so it only needs its own fade. */
const TILE_HOLD = 0.32;
const DONE_HOLD = 0.1;

export const doneCount = (status) => GETTING_STARTED_STEPS.filter((s) => !!status?.steps?.[s.id]).length;
export const allStepsDone = (status) => doneCount(status) === GETTING_STARTED_STEPS.length;

/** Whether the team steps (metrics, policy) are listed (D-18). Before Runner only Expert mode lists them; from Runner on
 *  every mode lists them for a person on a team and none for a solo one. An unknown level view takes the pre-Runner rule. */
export function teamStepsVisible({ levelIndex, mode, onTeam } = {}) {
  if (!Number.isInteger(levelIndex) || levelIndex < RUNNER_LEVEL) return mode === 'expert';
  return !!onTeam;
}

/** The "Later" steps (7 to 9) this person should see, done or not. */
export function laterSteps(status, { levelIndex, mode } = {}) {
  const steps = status?.steps || {};
  const onTeam = !!(steps.teamMetrics || steps.teamPolicy);
  const teamShown = teamStepsVisible({ levelIndex, mode, onTeam });
  return GETTING_STARTED_STEPS.filter((s) => s.helps && (!TEAM_STEP_IDS.has(s.id) || teamShown));
}

/** The held level; 0 for a served view with no level yet, null while no view is known. */
const levelIndexOf = (view) => (Number.isInteger(view?.level?.index) ? view.level.index : (view && view.level === null ? 0 : null));

/** Progress toward Runner: steps 1 to 6, plus one for three real runs. */
export function runnerProgress(status, worcaLevel) {
  const stepsDone = TOWARD_RUNNER.filter((s) => !!status?.steps?.[s.id]).length;
  const realRuns = Number(worcaLevel?.runner?.realRuns) || 0;
  return { done: stepsDone + (realRuns >= RUNNER_REAL_RUNS ? 1 : 0), of: RUNNER_STEP_COUNT + 1 };
}

/** The sidebar pill's wording: "Finish setup" until setup is done, then the Runner count; null once Runner (or unknown). */
export function gsPillText(status, worcaLevel) {
  if (status && !status.setupFinished) return 'Finish setup';
  const index = levelIndexOf(worcaLevel);
  if (index === null || index >= RUNNER_LEVEL) return null;
  const { done, of } = runnerProgress(status, worcaLevel);
  return `Runner · ${done} of ${of}`;
}

/* ---------------------------------------------------------------- artwork */
// Each vignette is the app's own vocabulary — hollow nodes, wires, one accent
// element per scene (the violet "Worca-authored" hue) — drawn at 120×70 on the
// theme tokens so both schemes are right by construction. `--d` is the element's
// slot in the tile's own sequence; the tile's `--tile-delay` offsets all of them.
// Constant markup only (no user data reaches innerHTML).
const el = (tag, cls, d, attrs) => `<${tag} class="${cls}" style="--d:${d}s" ${attrs}/>`;
const node = (d, cx, cy, r = 6, extra = '') => el('circle', `gs-pop gs-node ${extra}`.trim(), d, `cx="${cx}" cy="${cy}" r="${r}"`);
const wire = (d, path, extra = '') => el('path', `gs-draw gs-wire ${extra}`.trim(), d, `pathLength="1" d="${path}"`);
const shape = (d, tag, cls, attrs) => el(tag, `gs-pop ${cls}`, d, attrs);

const VIGNETTES = {
  // The terminal prompt, then the once-node lights up: the CLI is reachable.
  claude: () => [
    shape(0.05, 'rect', 'gs-frame', 'x="12" y="14" width="56" height="42" rx="7"'),
    shape(0.3, 'path', 'gs-glyph', 'd="M24 28l8 7-8 7M36 42h12"'),
    wire(0.5, 'M68 35 C 80 35, 86 35, 96 35'),
    node(0.8, 102, 35, 6, 'gs-accent'),
  ],
  // A folder, then a node grows out of it.
  project: () => [
    shape(0.05, 'path', 'gs-frame', 'd="M14 22a4 4 0 0 1 4-4h12l6 6h22a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z"'),
    wire(0.35, 'M62 38 C 76 38, 84 30, 96 26'),
    node(0.6, 102, 24, 6, 'gs-accent'),
  ],
  // The loop: plan → refine → implement → review, the review wire curling back.
  run: () => [
    node(0.05, 16, 35, 5),
    wire(0.15, 'M22 35h18'),
    node(0.3, 46, 35, 5),
    wire(0.4, 'M52 35h18'),
    node(0.55, 76, 35, 5),
    wire(0.65, 'M82 35h18'),
    node(0.8, 106, 35, 5, 'gs-accent'),
    wire(0.9, 'M76 41 C 76 58, 46 58, 46 41'),
  ],
  // The same pipeline, but the last node carries a spark: real tokens spent.
  realRun: () => [
    node(0.05, 18, 35, 5),
    wire(0.15, 'M24 35h16'),
    node(0.3, 46, 35, 5),
    wire(0.4, 'M52 35h16'),
    node(0.55, 74, 35, 5),
    wire(0.65, 'M80 35h14'),
    shape(0.85, 'path', 'gs-spark gs-accent', 'd="M104 26l2.2 5.6 5.6 2.2-5.6 2.2-2.2 5.6-2.2-5.6-5.6-2.2 5.6-2.2z"'),
  ],
  // A speech bubble reaches a run's node.
  ask: () => [
    shape(0.05, 'path', 'gs-frame', 'd="M14 18h34a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H28l-9 9v-9h-5a7 7 0 0 1-7-7V25a7 7 0 0 1 7-7z"'),
    shape(0.25, 'path', 'gs-glyph', 'd="M24 31h18"'),
    wire(0.45, 'M55 34 C 72 34, 82 40, 96 40'),
    node(0.7, 102, 40, 6, 'gs-accent'),
  ],
  // A canvas: three nodes being wired by hand, the new wire in accent.
  workflow: () => [
    node(0.05, 22, 22, 6),
    node(0.15, 22, 50, 6),
    node(0.25, 64, 36, 6),
    wire(0.4, 'M28 24 C 44 28, 50 32, 58 34'),
    wire(0.5, 'M28 48 C 44 44, 50 40, 58 38'),
    wire(0.65, 'M70 36 C 82 36, 88 36, 96 36', 'gs-accent'),
    node(0.85, 102, 36, 6, 'gs-accent'),
  ],
  // Two project folders under one roof.
  workspace: () => [
    shape(0.05, 'rect', 'gs-frame', 'x="14" y="26" width="26" height="22" rx="5"'),
    shape(0.15, 'rect', 'gs-frame', 'x="48" y="26" width="26" height="22" rx="5"'),
    wire(0.35, 'M27 26 C 27 12, 61 12, 61 26'),
    wire(0.5, 'M74 37 C 84 37, 90 37, 96 37'),
    node(0.75, 102, 37, 6, 'gs-accent'),
  ],
  // A shared branch: three teammates' nodes feeding one line.
  teamMetrics: () => [
    node(0.05, 18, 18, 5),
    node(0.15, 18, 35, 5),
    node(0.25, 18, 52, 5),
    wire(0.35, 'M24 18 C 44 18, 50 35, 64 35'),
    wire(0.45, 'M24 35h40'),
    wire(0.55, 'M24 52 C 44 52, 50 35, 64 35'),
    wire(0.65, 'M64 35h30'),
    shape(0.85, 'path', 'gs-chart gs-accent', 'd="M84 46l6-8 5 4 7-10"'),
  ],
  // One document, read by every teammate: a page with its rules ticked, wired to three nodes.
  teamPolicy: () => [
    shape(0.05, 'rect', 'gs-frame', 'x="12" y="12" width="40" height="46" rx="6"'),
    shape(0.25, 'path', 'gs-glyph', 'd="M22 24h20M22 33h20"'),
    shape(0.4, 'path', 'gs-chart gs-accent', 'd="M22 45l4 4 8-8"'),
    wire(0.5, 'M52 35 C 70 35, 76 20, 94 20'),
    wire(0.6, 'M52 35h42'),
    wire(0.7, 'M52 35 C 70 35, 76 50, 94 50'),
    node(0.85, 100, 20, 5),
    node(0.9, 100, 35, 5),
    node(0.95, 100, 50, 5),
  ],
};

/**
 * One tile's artwork. `animate` false paints the FINISHED drawing with no
 * motion — a step already done should not ask for attention again.
 * @param {Document} doc
 * @param {string} id  a GETTING_STARTED_STEPS vig key
 * @param {{animate:boolean, delay:number}} o
 */
export function vignette(doc, id, { animate = true, delay = 0 } = {}) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 70');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `gs-vig-svg ${animate ? 'play' : 'static'}`);
  svg.style.setProperty('--tile-delay', `${delay}s`);
  const parts = (VIGNETTES[id] || (() => []))();
  svg.innerHTML = parts.join('');
  return svg;
}

/* ------------------------------------------------------------------ shelf */

const isText = (v) => typeof v === 'string' && v !== '';

/** The art and the sentence for the level line. At Curious the line looks ahead to the next level (its art, its name);
 *  from Runner up it says where the person stands. Null when the view cannot supply what its copy needs. */
function levelLineParts(view) {
  const level = view?.level;
  if (!level || !isText(level.name) || !Number.isInteger(level.index)) return null;
  if (level.index === 1) {
    const next = view.nextLevel;
    if (!next || !isText(next.name)) return null;
    const entry = (view.ladder || []).find((l) => l.index === next.index);
    return { avatar: next.avatar || entry?.avatar, text: `Finishing these moves you toward ${next.name}, your next level. ` };
  }
  return { avatar: level.avatar, text: `You are ${level.name}, level ${level.index} of ${WORCA_LEVEL_COUNT}. ` };
}

/** The one line that ties the checklist to the person's Worca level (docs/worca-levels.md). Null without a usable view. */
function levelLine(doc, view) {
  const parts = levelLineParts(view);
  if (!parts) return null;
  const line = doc.createElement('p');
  line.className = 'gs-level-line';
  if (isText(parts.avatar)) {
    const img = doc.createElement('img');
    img.className = 'gs-level-avatar';
    img.setAttribute('src', parts.avatar);
    img.alt = '';
    img.setAttribute('width', '16');
    img.setAttribute('height', '16');
    line.append(img, ' ');
  }
  line.append(parts.text);
  const link = doc.createElement('a');
  link.className = 'gs-level-link';
  link.href = '#profile/level';
  link.textContent = 'See levels';
  line.appendChild(link);
  return line;
}

/**
 * Paint the shelf into `host` (emptied first). Nothing is painted when the
 * status is unusable or the user hid the checklist. Rows stay clickable after
 * they are done, so any guide can be replayed.
 * @param {Element} host
 * @param {{steps?:Record<string,boolean>, hidden?:boolean}|null} status
 * @param {{onStep?:(id:string)=>void, onHide?:()=>void, animate?:boolean, hideLabel?:string, level?:string, worcaLevel?:object|null}} [handlers]
 *   `level`: the current interface mode. `worcaLevel`: the served WorcaLevelView; when usable, one line under the
 *   header says where the person stands (or, at Curious, points at Runner). The steps and counts do not change.
 */
export function renderGettingStarted(host, status, { onStep, onHide, animate = true, hideLabel = 'Hide', level = 'expert', worcaLevel = null } = {}) {
  if (!host) return;
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (!status || !status.steps || typeof status.steps !== 'object' || status.hidden) { host.hidden = true; return; }
  host.hidden = false;
  const done = doneCount(status);
  const total = GETTING_STARTED_STEPS.length;

  const card = doc.createElement('section');
  card.className = 'card gs-card';
  card.setAttribute('role', 'complementary');
  card.setAttribute('aria-label', 'Getting started');

  const head = doc.createElement('div');
  head.className = 'gs-head';
  const h2 = doc.createElement('h2');
  h2.className = 'section-title';
  h2.textContent = done === total ? 'All set' : 'Your progress';   // the page's topbar already says Getting started
  const progress = doc.createElement('span');
  progress.className = 'gs-progress';
  progress.textContent = `${done} of ${total}`;
  const hide = doc.createElement('button');
  hide.type = 'button';
  hide.className = 'btn btn-sm btn-quiet gs-hide';
  hide.textContent = hideLabel;
  hide.title = 'The sidebar entry; Settings › General › Getting started also opens this page';
  hide.addEventListener('click', () => onHide && onHide());
  head.append(h2, progress, hide);
  card.appendChild(head);
  const worcaLine = levelLine(doc, worcaLevel);
  if (worcaLine) card.appendChild(worcaLine);

  const levelIndex = levelIndexOf(worcaLevel);
  // Tiles arrive one at a time IN ORDER, so a new user reads one idea at a
  // time instead of nine at once. A finished tile takes its turn but arrives
  // already drawn and still, so it holds the sequence only briefly.
  const seq = { at: 0 };
  const tile = (s, isDone) => stepTile(doc, s, { isDone, animate, level, onStep, seq });
  const later = laterSteps(status, { levelIndex, mode: level });

  const tiles = doc.createElement('div');
  tiles.className = 'gs-tiles';
  if (!status.setupFinished) tiles.appendChild(tile(SETUP_STEP, false)).classList.add('gs-setup-tile');
  if (levelIndex !== null && levelIndex >= RUNNER_LEVEL) {
    card.appendChild(tiles);
    card.appendChild(foldedShelf(doc, status, later, { onStep }));
  } else {
    card.appendChild(tiles);
    card.appendChild(section(doc, 'Toward Runner', [
      ...TOWARD_RUNNER.map((s) => tile(s, !!status.steps[s.id])),
      realRunsCounter(doc, worcaLevel),
    ]));
    if (later.length) card.appendChild(section(doc, 'Later', later.map((s) => tile(s, !!status.steps[s.id]))));
  }
  host.appendChild(card);
}

/** One checklist tile (also step 0). Advances `seq.at` so the next tile arrives after it. */
function stepTile(doc, s, { isDone, animate, level, onStep, seq }) {
  const delay = seq.at;
  seq.at += isDone ? DONE_HOLD : TILE_HOLD;
  const tile = doc.createElement('button');
  tile.type = 'button';
  tile.className = `gs-tile${animate ? ' reveal' : ''}${isDone ? ' done' : ''}`;
  tile.dataset.step = s.id;
  tile.style.setProperty('--tile-delay', `${animate ? delay : 0}s`);
  tile.setAttribute('aria-label', `${s.label}: ${isDone ? 'done' : 'not done yet'}`);
  const mark = doc.createElement('span');
  mark.className = 'gs-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.append(icon(doc, 'check', 12));
  const vig = doc.createElement('span');
  vig.className = 'gs-vig';
  vig.appendChild(vignette(doc, s.vig, { animate: animate && !isDone, delay }));
  const label = doc.createElement('span');
  label.className = 'gs-label';
  label.textContent = s.label;
  tile.append(mark, vig, label);
  if (s.helps) {
    const helps = doc.createElement('span');
    helps.className = 'gs-helps';
    helps.textContent = HELPS_LABEL[s.helps];
    tile.appendChild(helps);
  }
  if (s.level && LEVEL_ORDER.indexOf(s.level) > LEVEL_ORDER.indexOf(level)) {
    const lv = doc.createElement('span');
    lv.className = 'lv-pill gs-level';
    lv.dataset.lv = s.level;
    lv.textContent = LEVEL_LABEL[s.level];
    tile.appendChild(lv);
    tile.setAttribute('aria-label', `${tile.getAttribute('aria-label')}, part of ${LEVEL_LABEL[s.level]} mode`);
  }
  tile.addEventListener('click', () => onStep && onStep(s.id));
  return tile;
}

function section(doc, title, children) {
  const sec = doc.createElement('section');
  sec.className = 'gs-section';
  const h3 = doc.createElement('h3');
  h3.className = 'gs-section-title';
  h3.textContent = title;
  const grid = doc.createElement('div');
  grid.className = 'gs-tiles';
  grid.append(...children);
  sec.append(h3, grid);
  return sec;
}

/** The counter beside the Toward Runner steps; no number when the level view is unknown. */
function realRunsCounter(doc, worcaLevel) {
  const counter = doc.createElement('div');
  counter.className = 'gs-counter';
  const runs = worcaLevel?.runner?.realRuns;
  counter.textContent = Number.isInteger(runs) ? `Real runs · ${Math.min(runs, RUNNER_REAL_RUNS)} of ${RUNNER_REAL_RUNS}` : `${RUNNER_REAL_RUNS} real runs`;
  return counter;
}

/** From Runner up: one line, then a compact list of the visible Later steps still to do. */
function foldedShelf(doc, status, later, { onStep }) {
  const wrap = doc.createElement('div');
  wrap.className = 'gs-folded';
  const fold = doc.createElement('p');
  fold.className = 'gs-fold';
  fold.textContent = "You're a Runner. Your level card shows what to try next.";
  wrap.appendChild(fold);
  const undone = later.filter((s) => !status.steps[s.id]);
  if (undone.length) {
    const list = doc.createElement('ul');
    list.className = 'gs-later-list';
    for (const s of undone) {
      const li = doc.createElement('li');
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-quiet gs-later-item';
      btn.dataset.step = s.id;
      btn.textContent = s.label;
      btn.addEventListener('click', () => onStep && onStep(s.id));
      li.appendChild(btn);
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }
  return wrap;
}

/* ------------------------------------------------------------------- pill */

/**
 * The sidebar's first row: "Getting started · 2/9". It follows the
 * user to every view (the guides leave the shelf behind) and vanishes once the
 * checklist is hidden or complete — nothing left to nag about.
 * @param {Element} host
 * @param {object|null} status
 * @param {() => void} onOpen
 * @param {object|null} [worcaLevel]  the served WorcaLevelView; with it the pill reads gsPillText instead of the count
 */
export function renderGettingStartedPill(host, status, onOpen, worcaLevel = null) {
  if (!host) return;
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (!status || !status.steps || status.hidden || allStepsDone(status)) { host.hidden = true; return; }
  host.hidden = false;
  const done = doneCount(status);
  const total = GETTING_STARTED_STEPS.length;
  const pillText = gsPillText(status, worcaLevel);
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'gs-pill';
  btn.setAttribute('aria-label', pillText ? `Getting started: ${pillText}` : `Getting started: ${done} of ${total} done`);
  btn.title = 'Getting started';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l4.5 4.5L20 6"></path></svg>';
  const text = doc.createElement('span');
  text.textContent = pillText || 'Getting started';
  btn.appendChild(text);
  if (!pillText) {
    const count = doc.createElement('span');
    count.className = 'nav-count n-grey gs-pill-count';
    count.textContent = `${done}/${total}`;
    btn.appendChild(count);
  }
  btn.addEventListener('click', () => onOpen && onOpen());
  host.appendChild(btn);
}

/* ---------------------------------------------------------------- welcome */

/**
 * Wire the static welcome dialog (#welcome-modal in index.html): each door hands its step id to `onDoor`;
 * Skip, a backdrop click and Esc call `onSkip` (modal-guard: a decision, Skip is its safe answer).
 * Returns a function that takes the dialog off those rules (the modal itself is reused).
 * @param {Element} modal
 * @param {{onDoor:(step:string)=>void, onSkip:()=>void, win?:Window}} h
 */
export function bindWelcome(modal, { onDoor, onSkip }) {
  if (!modal) return () => {};
  // One signal for every listener, so an unbind removes the door listeners too: a second show binds each door once (A6).
  // The modal's own window makes it: jsdom refuses a signal from another realm (Node's global AbortController).
  const ac = new modal.ownerDocument.defaultView.AbortController(); const opts = { signal: ac.signal };
  for (const door of modal.querySelectorAll('[data-door]')) {
    door.addEventListener('click', () => onDoor(door.dataset.door), opts);
  }
  modal.querySelector('.ob-skip')?.addEventListener('click', () => onSkip(), opts);
  const guard = guardModal(modal, { kind: 'decision', close: () => onSkip() }).opened();
  return () => { ac.abort(); guard.release(); };
}
