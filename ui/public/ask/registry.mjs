// ui/public/ask/registry.mjs
// The ask-panel renderer registry (agent-ask-forms design §6, D6). `renderQpanel`
// used to be an if/else ladder on `pq.kind`; it is now a lookup in this table and
// the five kinds — clarify, gate, recovery, workflow, form — are its registrants.
// Pure: no DOM, no imports. A renderer is registered by the module that owns its
// body (app.js for the four legacy bodies, app.js again for `form`), so this file
// never grows a dependency on any of them.

const RENDERERS = new Map();

const NOOP_COLLECT = () => null;
const NOOP_ERRORS = () => {};
const NOOP_TITLE = () => '';
const NOOP_COUNT = () => null;

/**
 * Register (or replace) the renderer for one question kind.
 * @param {string} kind
 * @param {{ render: Function, collect?: Function, setErrors?: Function,
 *           title?: Function, count?: Function }} renderer
 */
export function registerAskRenderer(kind, renderer) {
  if (typeof kind !== 'string' || kind === '') return;
  if (!renderer || typeof renderer.render !== 'function') return;
  RENDERERS.set(kind, Object.freeze({
    render: renderer.render,
    collect: typeof renderer.collect === 'function' ? renderer.collect : NOOP_COLLECT,
    setErrors: typeof renderer.setErrors === 'function' ? renderer.setErrors : NOOP_ERRORS,
    title: typeof renderer.title === 'function' ? renderer.title : NOOP_TITLE,
    count: typeof renderer.count === 'function' ? renderer.count : NOOP_COUNT,
  }));
}

/** The renderer for a kind, or null. */
export function askRendererFor(kind) {
  return RENDERERS.get(kind) || null;
}

/**
 * Which registrant draws this pending question. This IS the pre-registry ladder
 * from renderQpanel, precedence and all: workflow, then recovery, then form, then
 * gate — where `gate` still accepts a payload that only carries an `issues` array
 * (older servers never set kind:'gate') — and clarify as the catch-all, which is
 * also what `kind:'questions'` lands on.
 */
export function askKindOf(pq) {
  if (!pq) return null;
  if (pq.kind === 'workflow') return 'workflow';
  if (pq.kind === 'recovery') return 'recovery';
  if (pq.kind === 'form') return 'form';
  if (pq.kind === 'gate' || Array.isArray(pq.issues)) return 'gate';
  return 'clarify';
}
