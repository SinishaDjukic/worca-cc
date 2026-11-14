// src/core/design/ids.mjs
// Design ids and the section-id rules every Design writer shares (SPEC C-1, section 6).
// Imports only node:crypto, so the write guard can take WINDOWS_RESERVED from here without reaching db.mjs.

import { randomBytes } from 'node:crypto';

export class DesignError extends Error {
  /** @param {'BAD_REQUEST'|'NOT_FOUND'|'CONFLICT'|'BAD_SHELL'|'IO'} code
   *  @param {object} [data] extra detail for the caller, kept on err.data */
  constructor(code, message, data) {
    super(message); this.name = 'DesignError'; this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export const DESIGN_KINDS = Object.freeze(['web', 'presentation', 'pitch', 'video', 'document']);
export const DESIGN_ID_RE = /^d_[0-9a-f]{12}$/;
export const BUILD_ID_RE = /^b_[0-9a-f]{12}$/;
export const AGENT_ID_RE = /^a_[0-9a-f]{8}$/;
export const SECTION_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_SECTIONS = 40;
/** Windows device names (L1.7: com0 and lpt0 included). Section ids are lowercase, so no `i` flag. */
export const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
/** C-6 `css.file` uses these as file names next to the sections, so a section may not take them. */
const GLOBAL_FILE_NAMES = Object.freeze(['tokens', 'global']);

export function newDesignId() { return `d_${randomBytes(6).toString('hex')}`; }
export function newBuildId() { return `b_${randomBytes(6).toString('hex')}`; }
export function newAgentId() { return `a_${randomBytes(4).toString('hex')}`; }

/**
 * Why `id` cannot be a section id, or null when it can.
 * Every message starts `section id "<id>" ` so callers can match on it.
 * @param {unknown} id
 * @returns {string|null}
 */
export function sectionIdProblem(id) {
  const head = `section id ${JSON.stringify(String(id))} `;
  if (typeof id !== 'string') return `${head}must be a string`;
  if (!SECTION_ID_RE.test(id)) {
    return `${head}must start with a lowercase letter and hold only lowercase letters, digits and -, at most 32 characters`;
  }
  if (WINDOWS_RESERVED.test(id)) return `${head}is a reserved Windows device name`;
  if (GLOBAL_FILE_NAMES.includes(id)) return `${head}is reserved for the design's global files`;
  return null;
}

/** @param {unknown} id @returns {boolean} */
export function isSectionId(id) {
  return sectionIdProblem(id) === null;
}
