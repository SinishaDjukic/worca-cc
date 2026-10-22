// src/core/ask/project-proposal.mjs
// The ONE validator behind mcp__worca__propose_project_change, and the event/notice text of the
// project card (P2: New by name, or add a folder that already exists). Pure: createProject and
// addProjectFolder are injected (project-deps.mjs binds the real ones from ../project-create.mjs),
// so the MCP child validates for the model's self-correction and the parent turn re-validates
// authoritatively and mints the card — the clone-proposal.mjs split. Nothing here creates or
// registers anything: both calls are dry runs; applying the card (ui/server.mjs) does it, behind
// the user's click.

import { isAbsolute } from 'node:path';

const str =(v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
// A name the model types for `add` is what the user confirms on the card and what the registry stores: one line,
// no bidirectional controls that reorder what the card shows, at most 100 characters (New's limit).
// eslint-disable-next-line no-control-regex
const NAME_BAD_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * @param {object} r
 * @param {(input:object) => Promise<object>} r.createProject     project-create.mjs#createProject (called with dryRun: true)
 * @param {(input:object) => Promise<object>} r.addProjectFolder  project-create.mjs#addProjectFolder (called with dryRun: true)
 */
export function createProjectChangeValidator(r) {
  /** @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>} */
  return async function validateProjectProposal(input) {
    const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const kind = str(inp.kind);
    if (kind !== 'create' && kind !== 'add') return { ok: false, errors: ['kind must be "create" or "add"'] };
    if (inp.useGit !== undefined && typeof inp.useGit !== 'boolean') return { ok: false, errors: ['useGit must be true or false'] };
    const useGit = inp.useGit === true;
    const typed = kind === 'add' ? str(inp.name) : '';
    if (typed && [...typed].length > 100) return { ok: false, errors: ['the name may be up to 100 characters'] };
    if (typed && NAME_BAD_RE.test(typed)) return { ok: false, errors: ['the name cannot contain control characters'] };
    // A relative path resolves against the cwd, and the MCP child and the parent run in different folders.
    const rawPath = kind === 'add' ? str(inp.path) : '';
    if (rawPath && !rawPath.startsWith('~') && !isAbsolute(rawPath)) return { ok: false, errors: ['the path must be absolute or start with ~'] };
    let dry;
    try {
      dry = kind === 'create'
        ? await r.createProject({ name: inp.name, useGit, dryRun: true })
        : await r.addProjectFolder({ name: inp.name, path: inp.path, useGit, dryRun: true });
    } catch (err) {
      return { ok: false, errors: [String(err && err.message ? err.message : err)] };
    }
    const note = clip(str(inp.note), 200);
    const vcs = kind === 'create' ? (useGit ? 'git' : 'none') : dry.vcs;
    return { ok: true, card: {
      type: 'project', kind,
      summary: `${kind === 'create' ? 'Create' : 'Add'} ${dry.name}`,
      name: dry.name, path: dry.path, displayPath: dry.displayPath, vcs,
      ...(note ? { note } : {}),
      change: kind === 'create' ? { kind, name: dry.name, useGit } : { kind, name: dry.name, path: dry.path, useGit },
    } };
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a project card. */
export function projectEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] project card ${cardId} declined; "${summary}"`;
  if (state === 'failed') {
    return `[worca event] project card ${cardId} failed${result?.code ? ` (${eventText(result.code, 40)})` : ''}: ${eventText(result?.error || 'unknown error', 300)}; "${summary}"`;
  }
  const done = card.kind === 'add' ? 'registered' : 'created and registered';
  const p = result?.project;
  const where = p ? `; project ${eventText(p.name, 100)} at ${eventText(p.path, 300)}` : '';
  const scope = p && result?.scope ? `; this chat now works in ${eventText(p.name, 100)}` : '';
  return `[worca event] project card ${cardId} applied: ${done}${where}${scope}; "${summary}"`;
}

/** The user-row notice above the event turn. */
export function projectNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  const add = card.kind === 'add';
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not ${add ? 'add' : 'create'} — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `${add ? 'Added' : 'Created'} — ${s}${result?.project?.path ? ` · ${clip(result.project.path, 200)}` : ''}`;
}
