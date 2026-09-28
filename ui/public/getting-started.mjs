// ui/public/getting-started.mjs
// The Getting-started checklist (docs/getting-started.md): the tile shelf on the
// New pipeline view, the sidebar pill that follows the user to other views, and
// the welcome dialog's bindings. Pure DOM in, pure DOM out — no fetch, no app
// state — so test/ui-getting-started.test.mjs drives it in jsdom without booting
// app.js. Completion is never decided here: `status.steps` is the server's word
// (GET /api/onboarding, src/core/onboarding.mjs), this module only paints it.

/** Shelf order = the arc: prerequisite → first object → see the loop → talk to
 *  it → know the workflows → real work → scale. Labels are outcomes, never settings. */
export const GETTING_STARTED_STEPS = Object.freeze([
  { id: 'claude',      label: 'Connect Claude Code',             vig: 'claude' },
  { id: 'project',     label: 'Add your first project',          vig: 'project' },
  { id: 'run',         label: 'Watch a run end to end',          vig: 'run' },
  { id: 'ask',         label: 'Ask Worca about a run',           vig: 'ask' },
  { id: 'realRun',     label: 'Run a real pipeline',             vig: 'realRun' },
  { id: 'workflows',   label: 'Explore the built-in workflows',  vig: 'workflow',    level: 'advanced' },
  { id: 'workspace',   label: 'Group projects into a workspace', vig: 'workspace',   level: 'advanced' },
  { id: 'teamMetrics', label: 'Turn on team metrics',            vig: 'teamMetrics', level: 'expert' },
  { id: 'teamPolicy',  label: 'Set a team policy',               vig: 'teamPolicy',  level: 'expert' },
]);

// `level` (docs/ui-levels.md) is the interface mode a step's controls live in; absent = simple.
// Every tile shows at every mode — the count stays "n of 9" — but a step above the current mode
// wears its level, and its guide opens by ringing the mode switch.
const LEVEL_ORDER = ['simple', 'advanced', 'expert'];
const LEVEL_LABEL = { advanced: 'Advanced', expert: 'Expert' };

/** Seconds a tile holds the reveal sequence before the next arrives: an
 *  unfinished tile paints its drawing first, a finished one arrives already
 *  drawn and still, so it only needs its own fade. */
const TILE_HOLD = 0.32;
const DONE_HOLD = 0.1;

export const doneCount = (status) => GETTING_STARTED_STEPS.filter((s) => !!status?.steps?.[s.id]).length;
export const allStepsDone = (status) => doneCount(status) === GETTING_STARTED_STEPS.length;

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

/**
 * Paint the shelf into `host` (emptied first). Nothing is painted when the
 * status is unusable or the user hid the checklist. Rows stay clickable after
 * they are done, so any guide can be replayed.
 * @param {Element} host
 * @param {{steps?:Record<string,boolean>, hidden?:boolean}|null} status
 * @param {{onStep?:(id:string)=>void, onHide?:()=>void, animate?:boolean, hideLabel?:string, level?:string}} [handlers]  `level`: the current interface mode
 */
export function renderGettingStarted(host, status, { onStep, onHide, animate = true, hideLabel = 'Hide', level = 'expert' } = {}) {
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
  h2.textContent = done === total ? 'All set' : 'Your progress';   // the page's topbar already says Getting started
  const progress = doc.createElement('span');
  progress.className = 'gs-progress';
  progress.textContent = `${done} of ${total}`;
  const hide = doc.createElement('button');
  hide.type = 'button';
  hide.className = 'gs-hide';
  hide.textContent = hideLabel;
  hide.title = 'The sidebar entry; Settings › General › Getting started also opens this page';
  hide.addEventListener('click', () => onHide && onHide());
  head.append(h2, progress, hide);
  card.appendChild(head);

  const tiles = doc.createElement('div');
  tiles.className = 'gs-tiles';
  // Tiles arrive one at a time IN ORDER, so a new user reads one idea at a
  // time instead of nine at once. A finished tile takes its turn but arrives
  // already drawn and still, so it holds the sequence only briefly.
  let at = 0;
  for (const s of GETTING_STARTED_STEPS) {
    const isDone = !!status.steps[s.id];
    const delay = at;
    at += isDone ? DONE_HOLD : TILE_HOLD;
    const tile = doc.createElement('button');
    tile.type = 'button';
    tile.className = `gs-tile${animate ? ' reveal' : ''}${isDone ? ' done' : ''}`;
    tile.dataset.step = s.id;
    tile.style.setProperty('--tile-delay', `${animate ? delay : 0}s`);
    tile.setAttribute('aria-label', `${s.label} — ${isDone ? 'done' : 'not done yet'}`);
    const mark = doc.createElement('span');
    mark.className = 'gs-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✓';
    const vig = doc.createElement('span');
    vig.className = 'gs-vig';
    vig.appendChild(vignette(doc, s.vig, { animate: animate && !isDone, delay }));
    const label = doc.createElement('span');
    label.className = 'gs-label';
    label.textContent = s.label;
    tile.append(mark, vig, label);
    if (s.level && LEVEL_ORDER.indexOf(s.level) > LEVEL_ORDER.indexOf(level)) {
      const lv = doc.createElement('span');
      lv.className = 'lv-pill gs-level';
      lv.dataset.lv = s.level;
      lv.textContent = LEVEL_LABEL[s.level];
      tile.appendChild(lv);
      tile.setAttribute('aria-label', `${tile.getAttribute('aria-label')} — part of ${LEVEL_LABEL[s.level]} mode`);
    }
    tile.addEventListener('click', () => onStep && onStep(s.id));
    tiles.appendChild(tile);
  }
  card.appendChild(tiles);
  host.appendChild(card);
}

/* ------------------------------------------------------------------- pill */

/**
 * The sidebar row under New pipeline: "Getting started · 2/9". It follows the
 * user to every view (the guides leave the shelf behind) and vanishes once the
 * checklist is hidden or complete — nothing left to nag about.
 * @param {Element} host
 * @param {object|null} status
 * @param {() => void} onOpen
 */
export function renderGettingStartedPill(host, status, onOpen) {
  if (!host) return;
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (!status || !status.steps || status.hidden || allStepsDone(status)) { host.hidden = true; return; }
  host.hidden = false;
  const done = doneCount(status);
  const total = GETTING_STARTED_STEPS.length;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'gs-pill';
  btn.setAttribute('aria-label', `Getting started — ${done} of ${total} done`);
  btn.title = 'Getting started';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l4.5 4.5L20 6"></path></svg>';
  const text = doc.createElement('span');
  text.textContent = 'Getting started';
  const count = doc.createElement('span');
  count.className = 'nav-count n-grey gs-pill-count';
  count.textContent = `${done}/${total}`;
  btn.append(text, count);
  btn.addEventListener('click', () => onOpen && onOpen());
  host.appendChild(btn);
}

/* ---------------------------------------------------------------- welcome */

/**
 * Wire the static welcome dialog (#welcome-modal in index.html): each door
 * hands its step id to `onDoor`, Skip / the backdrop / Esc call `onSkip`.
 * Returns a function that unbinds the Esc listener (the modal itself is reused).
 * @param {Element} modal
 * @param {{onDoor:(step:string)=>void, onSkip:()=>void, win?:Window}} h
 */
export function bindWelcome(modal, { onDoor, onSkip, win }) {
  if (!modal) return () => {};
  const w = win || modal.ownerDocument.defaultView;
  for (const door of modal.querySelectorAll('[data-door]')) {
    door.addEventListener('click', () => onDoor(door.dataset.door));
  }
  modal.querySelector('.ob-skip')?.addEventListener('click', () => onSkip());
  modal.addEventListener('click', (e) => { if (e.target === modal) onSkip(); });
  const onKey = (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) onSkip(); };
  w.document.addEventListener('keydown', onKey);
  return () => w.document.removeEventListener('keydown', onKey);
}
