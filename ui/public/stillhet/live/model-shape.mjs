// ui/public/stillhet/live/model-shape.mjs — the one shape both adapters meet (D5). Per kind, the fields the pages read,
// taken from the demo seeds: shell/world.js run() and GROUPS, chat/chats-model.js chat(), schedules/schedules-model.js,
// projects/projects.js data.projects, pulse/pulse-model.js up(), and world.facts() budget and usage. A type ending in `?`
// may be absent (a seed that has no such field). live-map.mjs copies no field outside these lists. Three optional fields
// have no seed: a project's `name` (the demo's id is its name; live, the id is dev's key), a schedule's `nextAt` (the
// demo counts from its fixed today; live, the server's next time in ms) and an outcome update's `work` (its History row's
// total active time in ms, which keys Pulse's stored read of that one outcome).
export const SHAPES = Object.freeze({
  task: { id: 'string', case: 'string', title: 'string', project: 'string', detail: 'string', time: 'string', day: 'string', labels: 'array', cost: 'number|null', archived: 'boolean', unread: 'boolean', pr: 'string', group: 'string', kind: 'string', by: 'string', workflow: 'string', when: 'string?', missed: 'boolean?', scheduleId: 'string?', over: 'boolean?', rounds: 'object|null?', roundOf: 'string?', interrupted: 'boolean?', paused: 'boolean?' },   // interrupted: dev's status, which reads Paused (the bulk rules ask before archiving it); paused: dev's status, whatever its case (Pulse's Now says it clears on resume or stop)
  group: { id: 'string', kind: 'string', case: 'string', title: 'string', project: 'string', time: 'string', day: 'string', cost: 'number|null' },
  chat: { id: 'string', title: 'string', state: 'string', kind: 'string', project: 'string', time: 'string', day: 'string', cost: 'number|null', pinned: 'boolean', archived: 'boolean', unread: 'boolean', group: 'string', origin: 'object|null', rank: 'number|null', labels: 'array', tasks: 'array' },
  schedule: { id: 'string', title: 'string', project: 'string', chat: 'string', every: 'string', at: 'string', next: 'string', day: 'string?', state: 'string', time: 'string', section: 'string', labels: 'array', what: 'string', cost: 'number|null', started: 'string', runs: 'array', missed: 'string?', missedWhy: 'string?', nextAt: 'number|null?',
    // Schedules D10: `skip` is the skipped slot, any non-empty string (live: the ISO Keep next time restores; demo: the words
    // it said before the skip); dev's Expert facts, the paused reason, the preset, the run-after title, an ended series;
    // the saved rule (Save keeps its end), the grace window in minutes, and the run-after ref ({kind, id, policy}) a change starts from
    skip: 'string?', projectDir: 'string?', workspaceId: 'string?', overlap: 'string?', fails: 'number|null?', ifMissed: 'string?', tz: 'string?', pauseWhy: 'string?', preset: 'string?', after: 'string?', ended: 'boolean?',
    rule: 'object|null?', grace: 'number|null?', afterRef: 'object|null?' },
  project: { id: 'string', name: 'string?', kind: 'string', path: 'string', branch: 'string?', base: 'string?', origin: 'string', ahead: 'number|null?', behind: 'number|null?', checked: 'string?', needs: 'boolean?', autoSync: 'boolean?', devPath: 'string?', ownedFolder: 'boolean?', vcs: 'string?' },   // slice 9 D5: dev's raw path (what writes send), a folder Worca made, git or none
  costs: { budget: 'object|null', usage: 'array' },
  space: { id: 'string', title: 'string', home: 'string', runs: 'number|null', scanned: 'string', model: 'string', about: 'string', projects: 'array', links: 'array', paths: 'array?', fresh: 'boolean?', draft: 'object|null?' },   // a workspace (D10); slice 9: its members' folders, a fresh draft, an edit draft. A link may carry `at` (file:line of its evidence)
  update: { id: 'string', e: 'string', g: 'string', sev: 'string', title: 'string', meta: 'string', time: 'string', day: 'string', unread: 'boolean', go: 'string', to: 'string', run: 'string?', about: 'string?', fix: 'string?', work: 'number|null?' },
  // Workflows (slice 7): workflows/workflows.js data, and live/workflow-map.mjs workflowOf, agentOf and scriptOf
  workflow: { id: 'string', title: 'string', own: 'boolean', domain: 'string', what: 'string', tasks: 'number|null', merged: 'number|null', from: 'string', steps: 'array', loops: 'array', team: 'boolean?', running: 'boolean?', pinned: 'boolean?', plugin: 'string?' },
  agent: { id: 'string', title: 'string', own: 'boolean', domain: 'string', type: 'string', ins: 'string', outs: 'string', model: 'string', effort: 'string', asks: 'boolean', fan: 'boolean', plugin: 'string?' },
  script: { id: 'string', title: 'string', own: 'boolean', domain: 'string', runtime: 'string', what: 'string', param: 'array', timeout: 'string', cases: 'number|null' },
  // Marketplace (slice 8): marketplace/marketplace.js data, and live/market-map.mjs pluginsOf and marketOf
  plugin: { id: 'string', name: 'string', ver: 'string', kind: 'string', market: 'string', what: 'string', adds: 'array', asks: 'array', installed: 'boolean', brand: 'string?', update: 'string?', needsSetup: 'boolean?', source: 'object|null?', uses: 'number|null?', why: 'string?', parts: 'array?', gives: 'object|null?', row: 'object|null?' },
  market: { id: 'string', name: 'string', url: 'string', branch: 'string', sha: 'string', synced: 'string', builtin: 'boolean?', webUrl: 'string|null?', error: 'string?' },
  // Insights (slice 10 D5): a live source, live/insights-map.mjs statsSource and teamSource (the demo's are insights-model.js source())
  insight: { live: 'boolean', fields: 'array', labels: 'array', series: 'object', totals: 'object', prev: 'object|null', rows: 'object', kids: 'object?' },
});

const is = {
  string: (v) => typeof v === 'string',
  'number|null': (v) => v === null || (typeof v === 'number' && Number.isFinite(v)),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  'object|null': (v) => v === null || (typeof v === 'object' && !Array.isArray(v)),
  'string|null': (v) => v === null || typeof v === 'string',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

/** [] when `item` has every field of `kind` with its type, else one line per wrong field ("task.cost: expected number|null"). */
export function shapeErrors(kind, item) {
  const shape = SHAPES[kind];
  if (!shape) return [`${kind}: unknown kind`];
  if (!item || typeof item !== 'object') return [`${kind}: expected an object`];
  const out = [];
  for (const [k, t0] of Object.entries(shape)) {
    const optional = t0.endsWith('?'), t = optional ? t0.slice(0, -1) : t0;
    if (optional && item[k] === undefined) continue;
    if (!is[t](item[k])) out.push(`${kind}.${k}: expected ${t}`);
  }
  return out;
}

/** The fields of `kind` that `item` carries: what live-map.mjs keeps (D12). */
export function pick(kind, item) {
  const out = {};
  for (const k of Object.keys(SHAPES[kind])) if (k in item) out[k] = item[k];
  return out;
}

// ---- turns (D18): per turn kind `t`, the fields chat/conversation.js reads to draw it, as the demo threads
// (chat/chats-model.js thread) and the live mapper (live/chat-turns.mjs) write them. `failed` is a reply that failed
// (fail.chat-turn): its calm sentence, the raw error behind Details, and Try again.
export const TURN_SHAPES = Object.freeze({
  you: { id: 'string', text: 'string', files: 'array?', refs: 'array?', quote: 'string?', at: 'number?' },
  think: { text: 'string', steps: 'array?' },
  working: { at: 'number?', steps: 'array?' },
  words: { html: 'string', md: 'string?', at: 'number?', key: 'string?' },   // md: a finished answer's words, drawn by Prose (panel.rendered-prose)
  ship: { id: 'string', title: 'string', reqs: 'array', how: 'string?', featureId: 'string?', done: 'string?' },   // the prototype's Ship card; live adds dev's feature id
  code: { file: 'string?', text: 'string' },
  commands: { id: 'string', rows: 'array' },
  cmd: { cmd: 'string', sum: 'string?', dir: 'string?' },
  cmds: { text: 'string', body: 'string?' },
  fail: { cmd: 'string?', body: 'string?' },
  failed: { id: 'string', text: 'string', detail: 'string' },
  files: { text: 'string', meta: 'string?' },
  filesgrid: { label: 'string', files: 'array' },
  divider: { text: 'string' },
  notice: { text: 'string' },
  act: { id: 'string', text: 'string', actions: 'array' },
  gate: { id: 'string', title: 'string', actions: 'array' },
  feature: { id: 'string', title: 'string', slices: 'array' },
  plan: { id: 'string', title: 'string' },
  question: { id: 'string', text: 'string', options: 'array' },
  form: { id: 'string', text: 'string', kind: 'string' },
  change: { id: 'string', kind: 'string', state: 'string', rows: 'array?' },
  proposal: { id: 'string', title: 'string' },
  runwith: { id: 'string', title: 'string', workflow: 'string' },
  craft: { id: 'string', label: 'string' },
  task: { id: 'string', task: 'string' },
  schedule: { id: 'string', task: 'string' },
});
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** [] when `turn` is a known kind with every field its kind lists, else one line per wrong field
 *  ("turn.question.options: expected array"). */
export function turnErrors(turn) {
  if (!turn || typeof turn !== 'object') return ['turn: expected an object'];
  const shape = TURN_SHAPES[turn.t];
  if (!shape) return [`turn.t: unknown kind ${JSON.stringify(turn.t)}`];
  const out = [];
  for (const [k, t0] of Object.entries(shape)) {
    const optional = t0.endsWith('?'), t = optional ? t0.slice(0, -1) : t0;
    if (optional && turn[k] === undefined) continue;
    if (!(t === 'number' ? isNum(turn[k]) : is[t](turn[k]))) out.push(`turn.${turn.t}.${k}: expected ${t}`);
  }
  return out;
}

/** The task page's live view (task-page.mjs taskPageOf): the instance facts run-page-model.js liveRun hands to view(),
 *  which draws them over the prototype's case (not the full head/stages/tabs view plan D3 names: view() builds those).
 *  Unlike D3's "left absent", a fact dev cannot fill is empty ('' / [] / null), never absent, so the page hides its part. */
export const TASK_PAGE_SHAPE = Object.freeze({
  id: 'string', case: 'string', title: 'string', branch: 'string', base: 'string', pr: 'string', prUrl: 'string', detail: 'string', why: 'array', git: 'string',
  cost: 'number|null', cap: 'number|null', mins: 'number|null', startedAgo: 'number|null', startedAt: 'string', project: 'string', labels: 'array', tags: 'array',
  prompt: 'string', stages: 'array', pauseAfterStep: 'boolean', workflow: 'object|null', resumeEngines: 'array',
});
/** [] when `page` has every TASK_PAGE_SHAPE field with its type, else one line per wrong field ("taskPage.cost: expected number|null"). */
export function taskPageErrors(page) {
  if (!page || typeof page !== 'object') return ['taskPage: expected an object'];
  return Object.entries(TASK_PAGE_SHAPE).filter(([k, t]) => !is[t](page[k])).map(([k, t]) => `taskPage.${k}: expected ${t}`);
}
