// src/core/design/paths.mjs
// The Design library layout (SPEC C-1, with M1: no builds/ folder) under <WORCA_HOME>/.worca-cc/design.
// Every helper validates its ids first, so a bad id never reaches the disk. Only ensureDesignFolders writes.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { DesignError, DESIGN_ID_RE, sectionIdProblem } from './ids.mjs';

export function designRoot() {
  return join(worcaHome(), 'design');
}

/** `<home>/design/<designId>`; throws BAD_REQUEST for anything that is not a design id. */
export function designDir(id) {
  if (typeof id !== 'string' || !DESIGN_ID_RE.test(id)) {
    throw new DesignError('BAD_REQUEST', `design id ${JSON.stringify(String(id))} is not valid`);
  }
  return join(designRoot(), id);
}

/** `work/`: the source, and the only place agents write. */
export function designWorkDir(id) { return join(designDir(id), 'work'); }
/** `dist/`: the engine's assembled output. */
export function distDir(id) { return join(designDir(id), 'dist'); }
/** `versions/`: restore-only copies of work/ (M2). */
export function versionsDir(id) { return join(designDir(id), 'versions'); }
/** `thumb.png`: the Library's picture (P6), outside dist/ and work/, so it is never exported or agent-writable. */
export function thumbFile(id) { return join(designDir(id), 'thumb.png'); }

/** `versions/<n>/`; n is a whole number from 1. */
export function versionDir(id, n) {
  const dir = versionsDir(id);
  if (!Number.isInteger(n) || n < 1) {
    throw new DesignError('BAD_REQUEST', `version ${JSON.stringify(String(n))} must be a whole number from 1`);
  }
  return join(dir, String(n));
}

/** `work/sections/<sectionId>/`; creates nothing. */
export function sectionDir(id, sectionId) {
  const work = designWorkDir(id);
  const problem = sectionIdProblem(sectionId);
  if (problem) throw new DesignError('BAD_REQUEST', problem);
  return join(work, 'sections', sectionId);
}

/** `work/.asks/`: one `<agentId>.json` question file per waiting agent. */
export function asksDir(id) { return join(designWorkDir(id), '.asks'); }
/** `work/.kit/`: the engine-staged kit; creates nothing. */
export function kitDir(id) { return join(designWorkDir(id), '.kit'); }
/** `work/assets/att/`: the person's attachments. */
export function attDir(id) { return join(designWorkDir(id), 'assets', 'att'); }
/** `work/.crew.json`: the engine's `[{id, status, summary}]`. */
export function crewFile(id) { return join(designWorkDir(id), '.crew.json'); }

/**
 * Make the library folders of one design and return its folder. Idempotent; keeps what is there.
 * Default mode on purpose (L1.19): a shared install grants `design/` through a group and setgid.
 * @returns {string} designDir(id)
 */
export function ensureDesignFolders(id) {
  const dir = designDir(id);
  for (const p of [join(designWorkDir(id), 'sections'), attDir(id), asksDir(id), distDir(id), versionsDir(id)]) {
    mkdirSync(p, { recursive: true });
  }
  return dir;
}

/** Where the lead may write: all of work/ (the guard still denies `.kit`). */
export function leadWriteDirs(id) {
  return [designWorkDir(id)];
}

/** Where one section's builder may write: its own section folder and the question folder. */
export function builderWriteDirs(id, sectionId) {
  return [sectionDir(id, sectionId), asksDir(id)];
}
