// src/core/flags.mjs — feature flags on the server (docs/feature-flags.md, D3/D7).
//
// flagEnabled(key)        the resolved value, read fresh (env + settings.json) on every call
// requireFlag(key)        Express middleware: 404 { error: 'not found' } while the flag is off —
//                         a disabled feature looks exactly like an absent one (never a 403)
// setFlags(patch)         { key: true|false|null }: validate, cascade `requires`, persist, emit ({} = no-op)
// checkFlags(patch)       the same validation + cascade, synchronous, no side effects (POST /api/settings pre-assert)
// flagEvents 'changed'    { key: bool } for every registry flag (ui/server.mjs broadcasts it)
//
// A flag is never a security boundary: code that must not run while a flag is off checks
// flagEnabled itself. Keep literal keys out of this file's comments (test/flags-usage.test.mjs).
import { EventEmitter } from 'node:events';
import { FLAGS } from '../shared/flags/registry.mjs';
import { resolveFlags } from '../shared/flags/resolve.mjs';
import { storedFlags, writeStoredFlags } from './settings.mjs';

export class FlagError extends Error {
  /** @param {'invalid'|'locked'} code  @param {string} message  @param {string|null} [key] */
  constructor(code, message, key = null) { super(message); this.code = code; this.key = key; }
}

const warned = new Set();
function warnUnknownOnce(key, where) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[worca] unknown feature flag ${JSON.stringify(key)} in ${where} — ignored (src/shared/flags/registry.mjs lists the flags)`);
}

/**
 * A flag service over an injectable registry, environment and store (tests inject all four).
 * @param {{registry?:ReadonlyArray<object>, env?:()=>string|undefined, read?:()=>object, write?:(m:object)=>Promise<void>, warn?:(key:string, where:string)=>void}} [o]
 */
export function createFlags({
  registry = FLAGS, env = () => process.env.WORCA_FLAGS, read = storedFlags, write = writeStoredFlags, warn = warnUnknownOnce,
} = {}) {
  const events = new EventEmitter();
  const byKey = new Map(registry.map((f) => [f.key, f]));
  const resolve = (stored = read(), w = warn) => resolveFlags({ registry, env: env() || '', stored, warn: w });
  const map = (r = resolve()) => Object.fromEntries(registry.map((f) => [f.key, r[f.key].on]));

  function enabled(key) {
    if (!byKey.has(key)) { warn(key, 'code'); return false; }
    return resolve()[key].on;
  }

  function list() {
    const r = resolve();
    return registry.filter((f) => f.stage !== 'retiring').map((f) => ({
      key: f.key, title: f.title, description: f.description, stage: f.stage,
      on: r[f.key].on, source: r[f.key].source, locked: r[f.key].locked,
      docs: f.docs || null, requires: [...(f.requires || [])],
    }));
  }

  // Concurrent PATCHes must not interleave their read-modify-write of settings.json.
  let queue = Promise.resolve();
  function set(patch) {
    const run = queue.then(() => apply(patch));
    queue = run.catch(() => {});
    return run;
  }

  // Validate the body, cascade `requires` and return the map to store. Synchronous and side-effect
  // free, so POST /api/settings can run it as a pre-assert before it writes anything (checkFlags).
  function plan(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new FlagError('invalid', 'send an object of flag keys, each true, false or null');
    const before = resolve();
    for (const [k, v] of Object.entries(patch)) {
      const def = byKey.get(k);
      if (!def || def.stage === 'retiring') throw new FlagError('invalid', `unknown flag ${JSON.stringify(k)}`, k);
      if (v !== true && v !== false && v !== null) throw new FlagError('invalid', `${JSON.stringify(k)} must be true, false or null`, k);
      if (before[k].locked) throw new FlagError('locked', `${JSON.stringify(k)} is locked by WORCA_FLAGS`, k);
    }
    const next = { ...read() };
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
    cascade(next, patch);
    // Only registry, non-retiring keys whose value differs from the default are kept (D2, D3):
    // a key removed from the registry drops out of settings.json here.
    const clean = {};
    for (const f of registry) {
      if (f.stage !== 'retiring' && typeof next[f.key] === 'boolean' && next[f.key] !== f.default) clean[f.key] = next[f.key];
    }
    return clean;
  }

  async function apply(patch) {
    const clean = plan(patch);
    if (!Object.keys(patch).length) return list();   // {} (the settings-api probe, a Reset with nothing unlocked): no write, no frame
    await write(clean);
    events.emit('changed', map());
    return list();
  }

  // §3.1 requires: turning a flag on turns its whole prerequisite closure on; turning a flag off turns
  // off everything that (transitively) requires it. On wins over off within one body. Locked flags refuse (409).
  function cascade(next, patch) {
    const quiet = () => {};
    const closure = new Set();
    const add = (k) => { for (const r of byKey.get(k).requires || []) if (!closure.has(r)) { closure.add(r); add(r); } };
    for (const [k, v] of Object.entries(patch)) if (v === true) add(k);
    let r = resolve(next, quiet);
    for (const k of closure) {
      if (r[k].self) continue;
      if (r[k].locked) throw new FlagError('locked', `${JSON.stringify(k)} is locked off by WORCA_FLAGS, and the flag you turned on needs it`, k);
      next[k] = true;
    }
    // Off pass: only the dependents of a flag THIS body actually turned off (on before, off now) are
    // switched off. A flag already on with a prerequisite off (an env lock contradicting settings) is
    // left as stored — the resolver reports it off anyway (fail closed) — so an unrelated PATCH, or one
    // that repeats an off, never answers 409 for it.
    const prev = resolve(read(), quiet);
    r = resolve(next, quiet);
    const off = new Set(Object.keys(patch).filter((k) => patch[k] !== true && prev[k].self && !r[k].self));
    for (let grew = true; grew;) {
      grew = false;
      r = resolve(next, quiet);
      for (const f of registry) {
        if (off.has(f.key) || patch[f.key] === true || closure.has(f.key)) continue;
        if (!(f.requires || []).some((q) => off.has(q))) continue;
        if (r[f.key].self) {
          if (r[f.key].locked) throw new FlagError('locked', `${JSON.stringify(f.key)} is locked on by WORCA_FLAGS and needs the flag you turned off`, f.key);
          next[f.key] = false;
        }
        off.add(f.key);
        grew = true;
      }
    }
  }

  function requireFlag(key) {
    if (!byKey.has(key)) throw new Error(`requireFlag: unknown flag ${JSON.stringify(key)}`);
    return (_req, res, next) => (enabled(key) ? next() : res.status(404).json({ error: 'not found' }));
  }

  return { events, enabled, list, map, set, check: (patch) => { plan(patch); }, requireFlag };
}

// The process-wide instance (env WORCA_FLAGS + settings.json).
const flags = createFlags();
export const flagEvents = flags.events;
export const flagEnabled = (key) => flags.enabled(key);
export const allFlags = () => flags.map();
export const listFlags = () => flags.list();
export const setFlags = (patch) => flags.set(patch);
export const checkFlags = (patch) => flags.check(patch);
export const requireFlag = (key) => flags.requireFlag(key);
