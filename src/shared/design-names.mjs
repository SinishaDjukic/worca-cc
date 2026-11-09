// src/shared/design-names.mjs
// Design P6 (L6.9, L6.12): the names the browser and the server share. It loads nothing, so the export dialog shows
// the very file name the server sends, and the Library uses the same kind labels.

export const DESIGN_KIND_LABELS = Object.freeze({ web: 'Web page', presentation: 'Presentation', pitch: 'Pitch deck', video: 'Video' });
export const DECK_KINDS = Object.freeze(['presentation', 'pitch']);
// M6: the Build fast label when the switch is on.
export const DESIGN_FAST_LABEL = 'up to 12';

const STEM_MAX = 60;
const EDGES = /^[.\-_ ]+|[.\-_ ]+$/g;
// Windows reserves these names with any extension too, and the stem also names the zip's top folder.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/;

/**
 * One safe file stem on every OS: printable ASCII after NFKD, lower case, `[a-z0-9._-]` with runs of anything else
 * as `-`, no `.-_ ` at either end, at most 60 chars, `file` when nothing is left, and `file-` ahead of a reserved name.
 * @param {string} title
 * @returns {string}
 */
export function exportStem(title) {
  const ascii = String(title ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').toLowerCase();
  const slug = ascii.replace(/[^a-z0-9._-]+/g, '-').replace(EDGES, '');
  const stem = slug.slice(0, STEM_MAX).replace(EDGES, '') || 'file';
  return RESERVED.test(stem) ? `file-${stem}` : stem;
}
