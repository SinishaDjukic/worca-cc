// src/core/undo-tokens.mjs — one-shot Undo for a list write (Add to group): the write keeps its inverse here and
// answers a token; the Undo route runs it once. In memory only: a restart loses tokens whose toast is long gone.
import { randomUUID } from 'node:crypto';

export const UNDO_TTL_MS = 10 * 60_000;
const MAX = 200;
const tokens = new Map();

function prune(now) {
  for (const [id, t] of tokens) if (now - t.at > UNDO_TTL_MS) tokens.delete(id);
  while (tokens.size >= MAX) tokens.delete(tokens.keys().next().value);
}

/** Keep `run` for `scope` (e.g. 'run-groups') and the actor `by`: the token to hand back. */
export function rememberUndo(run, { scope, by = null, now = Date.now() }) {
  prune(now);
  const id = `undo_${randomUUID().replace(/-/g, '')}`;
  tokens.set(id, { run, scope, by: by || null, at: now });
  return id;
}

/** The inverse for this token (removed: one use), or null when unknown, expired, another scope or another actor. */
export function takeUndo(id, { scope, by = null, now = Date.now() }) {
  const t = tokens.get(String(id || ''));
  if (!t || t.scope !== scope || t.by !== (by || null) || now - t.at > UNDO_TTL_MS) return null;
  tokens.delete(id);
  return t.run;
}
