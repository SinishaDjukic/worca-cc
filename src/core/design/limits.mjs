// src/core/design/limits.mjs
// Every Design concurrency limit, in one rule (P8 Task 6, M6, L8.15, L8.16): Build fast's crew is up to 12 locally and in
// a person's own container, up to 6 on a hosted worca, up to 3 with Build fast off, and at most 24 agents run at once on
// the server, every build together. `WORCA_DESIGN_MAX_BUILDERS` sets the Build fast cap (1 to MAX_SECTIONS) and Build
// fast off is the smaller of 3 and it; `WORCA_DESIGN_MAX_AGENTS` sets the server's cap. The registry, the builds'
// default and `GET /api/design/limits` all read `designCaps`.

import { MAX_SECTIONS } from './ids.mjs';

/** Builders running at once with Build fast off. */
export const CALM_CAP = 3;
/** Builders running at once with Build fast on, locally and in a container. */
export const FAST_CAP = 12;
/** Builders running at once with Build fast on, on a hosted worca. */
export const HOSTED_FAST_CAP = 6;
/** Agents running at once across every build on this server (SPEC pinned values). */
export const GLOBAL_AGENT_CAP = 24;

/** `raw` as a positive whole number, else null. */
function positiveInt(raw) {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * The caps for `deployment` (`detectDeployment`: 'local' | 'container' | 'hosted'): `fast` with Build fast on, `calm`
 * with it off, and `global`, the server's agent cap.
 * @param {{ env?: Record<string, string|undefined>, deployment?: string }} [opts]
 * @returns {{ fast: number, calm: number, global: number }}
 */
export function designCaps({ env = process.env, deployment = 'local' } = {}) {
  const builders = positiveInt(env?.WORCA_DESIGN_MAX_BUILDERS);
  const fast = builders !== null ? Math.min(builders, MAX_SECTIONS) : (deployment === 'hosted' ? HOSTED_FAST_CAP : FAST_CAP);
  return { fast, calm: Math.min(CALM_CAP, fast), global: positiveInt(env?.WORCA_DESIGN_MAX_AGENTS) ?? GLOBAL_AGENT_CAP };
}
