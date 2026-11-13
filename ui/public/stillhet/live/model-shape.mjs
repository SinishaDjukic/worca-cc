// ui/public/stillhet/live/model-shape.mjs — the one shape both adapters meet (D5). Per kind, the fields the pages read,
// taken from the demo seeds: shell/world.js run() and GROUPS, chat/chats-model.js chat(), schedules/schedules-model.js,
// projects/projects.js data.projects, pulse/pulse-model.js up(), and world.facts() budget and usage. A type ending in `?`
// may be absent (a seed that has no such field). live-map.mjs copies no field outside these lists. Two optional fields
// have no seed: a project's `name` (the demo's id is its name; live, the id is dev's key) and a schedule's `nextAt` (the
// demo counts from its fixed today; live, the server's next time in ms).
export const SHAPES = Object.freeze({
  task: { id: 'string', case: 'string', title: 'string', project: 'string', detail: 'string', time: 'string', day: 'string', labels: 'array', cost: 'number|null', archived: 'boolean', unread: 'boolean', pr: 'string', group: 'string', kind: 'string', by: 'string', workflow: 'string', when: 'string?', missed: 'boolean?', over: 'boolean?' },
  group: { id: 'string', kind: 'string', case: 'string', title: 'string', project: 'string', time: 'string', day: 'string', cost: 'number|null' },
  chat: { id: 'string', title: 'string', state: 'string', kind: 'string', project: 'string', time: 'string', day: 'string', cost: 'number|null', pinned: 'boolean', archived: 'boolean', unread: 'boolean', group: 'string', origin: 'object|null', rank: 'number|null', labels: 'array', tasks: 'array' },
  schedule: { id: 'string', title: 'string', project: 'string', chat: 'string', every: 'string', at: 'string', next: 'string', day: 'string?', state: 'string', time: 'string', section: 'string', labels: 'array', what: 'string', cost: 'number|null', started: 'string', runs: 'array', missed: 'string?', missedWhy: 'string?', nextAt: 'number|null?' },
  project: { id: 'string', name: 'string?', kind: 'string', path: 'string', branch: 'string?', base: 'string?', origin: 'string', ahead: 'number|null?', behind: 'number|null?', checked: 'string?', needs: 'boolean?' },
  costs: { budget: 'object|null', usage: 'array' },
  update: { id: 'string', e: 'string', g: 'string', sev: 'string', title: 'string', meta: 'string', time: 'string', day: 'string', unread: 'boolean', go: 'string', to: 'string', run: 'string?', fix: 'string?' },
});

const is = {
  string: (v) => typeof v === 'string',
  'number|null': (v) => v === null || (typeof v === 'number' && Number.isFinite(v)),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  'object|null': (v) => v === null || (typeof v === 'object' && !Array.isArray(v)),
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
  you: { id: 'string', text: 'string', files: 'array?', refs: 'array?', quote: 'string?' },
  think: { text: 'string', steps: 'array?' },
  working: { at: 'number?', steps: 'array?' },
  words: { html: 'string', parts: 'array?' },
  ship: { id: 'string', title: 'string', reqs: 'array', how: 'string?', featureId: 'string?', done: 'string?' },   // the prototype's Ship card; live adds dev's feature id   // parts: words and the refs in them (panel.answer-refs)
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
