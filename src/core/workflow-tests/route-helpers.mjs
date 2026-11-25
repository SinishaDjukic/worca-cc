// src/core/workflow-tests/route-helpers.mjs — the HTTP helpers Part 2's routes (routes.mjs) and Part 4's (criteria-routes.mjs)
// share (fix round 3, item A: one copy instead of two). Each part keeps its own status table: Part 2 adds NO_DISK, Part 4 FAILED.
import { actorOf } from '../identity.mjs';
import * as store from './store.mjs';

/** The error codes both parts answer with their own status. Any other code is a 500. */
export const STATUS_BASE = Object.freeze({ BAD_REQUEST: 400, NOT_VERSIONABLE: 400, NOT_FOUND: 404, BUSY: 409, NOT_READY: 422 });
/** STATUS_BASE plus one part's own codes. */
export const statusWith = (extra = {}) => Object.freeze({ ...STATUS_BASE, ...extra });

/** A route parameter as a whole number of 1 or more, else a 400 that names `what`. */
export const num = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw store.testError(`${what} must be a whole number`, 'BAD_REQUEST');
  return n;
};

/** A route's handler: a thrown error answers `{ error }` with its code's status (else 500); an error's `errors` list reaches the response. */
export const handleWith = (status) => (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    res.status(status[e && e.code] || 500).json({ error: e && e.message ? e.message : String(e), ...(e && Array.isArray(e.errors) ? { errors: e.errors } : {}) });
  }
};
/** `route(method, path, fn)`: every route behind `gate` (the workflowTests flag) and `handle`. */
export const routeOn = (app, gate, handle) => (method, path, fn) => app[method.toLowerCase()](path, gate, handle(fn));

/** The route's workflow id (`:id`). */
export const wid = (req) => String(req.params.id || '');
/** Who asked (identity.mjs), or null. */
export const by = (req) => actorOf(req) || null;
/** The route's example (`:ex`) of this workflow, or 404. */
export const exampleOf = (req) => {
  const ex = store.readExample(wid(req), num(req.params.ex, 'example'));
  if (!ex) throw store.testError(`no example ${req.params.ex}`, 'NOT_FOUND');
  return ex;
};
