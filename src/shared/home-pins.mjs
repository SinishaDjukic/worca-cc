// src/shared/home-pins.mjs — the Chat home's pinned workflows: one ordered list of workflow ids per person
// (settings.json chatHomePins, src/core/settings.mjs; GET/PUT /api/chat-home/pins). Pure: the server validates with
// it and the home picks its tiles with it. Shaper (wf_shape) is pinned by default; its tile shows while the
// Shape it first flag is on (the flag is pushed live, the workflow list is read per visit). Any other pin shows
// while GET /api/workflows lists it — a deleted or hidden workflow simply does not show.
export const SHAPER_PIN_ID = 'wf_shape';
export const DEFAULT_HOME_PINS = Object.freeze([SHAPER_PIN_ID]);
export const HOME_PINS_MAX = 50;
export const PIN_ID_MAX = 200;
/** Inline pin tiles: 7 built-ins + 1 pin keep today's 8 tiles + More; the rest go into More. */
export const PIN_SLOTS = 1;

/** { pins, errors }: trimmed, first occurrence kept, at most HOME_PINS_MAX. errors is empty for a valid list. */
export function normalizePins(list) {
  if (!Array.isArray(list)) return { pins: [], errors: ['pins must be a list of workflow ids'] };
  const pins = [];
  const errors = [];
  for (const raw of list) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || id.length > PIN_ID_MAX) {
      if (!errors.includes('each pin must be a workflow id')) errors.push('each pin must be a workflow id');
      continue;
    }
    if (!pins.includes(id)) pins.push(id);
  }
  if (pins.length > HOME_PINS_MAX) errors.push(`at most ${HOME_PINS_MAX} pins`);
  return { pins: pins.slice(0, HOME_PINS_MAX), errors };
}

/** A stored value read back: never set (undefined/null) = the default pin; a list = exactly that list, [] included. */
export function storedPins(value) {
  return value === undefined || value === null ? [...DEFAULT_HOME_PINS] : normalizePins(value).pins;
}

export const isPinned = (pins, id) => Array.isArray(pins) && pins.includes(id);

/** Append `id` (pin order = the order pins were added). Already pinned or a full list: unchanged. */
export function pinWorkflow(pins, id) {
  const cur = normalizePins(pins).pins;
  if (typeof id !== 'string' || !id.trim() || cur.includes(id) || cur.length >= HOME_PINS_MAX) return cur;
  return [...cur, id];
}

export function unpinWorkflow(pins, id) {
  return normalizePins(pins).pins.filter((p) => p !== id);
}

/** The pins that show, in pin order: [{ id, name, shaper }]. `workflows` null = not loaded yet. */
export function visiblePins({ pins, workflows = null, flags = {} } = {}) {
  const byId = new Map((Array.isArray(workflows) ? workflows : []).filter((w) => w && w.id).map((w) => [w.id, w]));
  const out = [];
  for (const id of normalizePins(pins).pins) {
    if (id === SHAPER_PIN_ID) {
      if ((flags || {})['shapeFirst'] === true) out.push({ id, name: 'Shaper', shaper: true });
      continue;
    }
    const w = byId.get(id);
    if (w) out.push({ id, name: String(w.name || id), shaper: false });
  }
  return out;
}

export function splitPins(visible, slots = PIN_SLOTS) {
  const list = Array.isArray(visible) ? visible : [];
  return { inline: list.slice(0, slots), overflow: list.slice(slots) };
}
