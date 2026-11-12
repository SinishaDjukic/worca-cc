// src/shared/design-names.mjs
// Design P6 (L6.9, L6.12): the names the browser and the server share. It loads nothing, so the export dialog shows
// the very file name the server sends, and the Library uses the same kind labels.

export const DESIGN_KIND_LABELS = Object.freeze({ web: 'Web page', presentation: 'Presentation', pitch: 'Pitch deck', video: 'Video' });
export const DECK_KINDS = Object.freeze(['presentation', 'pitch']);
// M6: the Build fast label when the switch is on.
export const DESIGN_FAST_LABEL = 'up to 12';
// Build fast on a new design: on, until the person turns it off (the start composer's switch and the store agree).
export const DESIGN_FAST_DEFAULT = true;
// Pictures on a new design (SPEC D7): on, until the person turns the switch off; it takes effect once the image
// service is set up (the gear's switch and the store agree).
export const DESIGN_PICTURES_DEFAULT = true;
// A made picture's name (SPEC D8): the kit command, the desk and the store check it alike; it names the file too.
export const DESIGN_PICTURE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The engines Design builds on (core/design/engines.mjs DESIGN_ENGINES, gate not `refused`, the mock left out): the
// Models page lists a Design lead and Design builders row for each.
export const DESIGN_ENGINE_NAMES = Object.freeze(['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode', 'qwen']);
// Design's two agents, as the pills and the Models page name them.
export const DESIGN_AGENT_LABELS = Object.freeze({ lead: 'Lead', builder: 'Builders' });

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
