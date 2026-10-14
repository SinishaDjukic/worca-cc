// src/core/shape/gate.mjs — the ONE server gate for Shape it first (spec D12). Every server call site asks
// shapeFirstEnabled()/requireShapeFirst(), never an env var or a flag API. Until #675 (feature flags) merges
// the gate reads the temporary switch WORCA_SHAPE_FIRST=1 (off when unset); the #675 follow-up changes only
// these two bodies to flagEnabled('shapeFirst').

/** The env keys the gate reads: forwarded to the Ask MCP child (spawn.mjs), which validates propose_run itself. */
export const SHAPE_FIRST_ENV_KEYS = Object.freeze(['WORCA_SHAPE_FIRST']);

/** @param {NodeJS.ProcessEnv} [env] */
export function shapeFirstEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env[SHAPE_FIRST_ENV_KEYS[0]] || '').trim());
}

/** Route guard: `if (!requireShapeFirst(req, res)) return;` — answers 404 while the gate is off. */
export function requireShapeFirst(req, res, env = process.env) {
  if (shapeFirstEnabled(env)) return true;
  res.status(404).json({ error: 'not found' });
  return false;
}
