// ui/public/worca-box.mjs — where this Worca runs (GET /api/settings `box`: native | container | hardened | hosted,
// src/core/security-posture.mjs). The hardened box (docs/hardened-box.md) adds projects by clone only: its Folder tab
// would browse the box's own disk, not the person's machine, and POST /api/projects refuses a folder there.
const KNOWN = ['native', 'container', 'hardened', 'hosted'];
let box = null;   // null until GET /api/settings answers: nothing box-specific shows before then

export const worcaBox = () => box;
export const inHardenedBox = () => box === 'hardened';
/** Remember the server's answer; an unknown or missing value (an older server) reads as 'native'. @returns {boolean} whether it changed */
export function setWorcaBox(value) {
  const next = KNOWN.includes(value) ? value : 'native';
  const changed = next !== box;
  box = next;
  return changed;
}

export const HARDENED_ADD_NOTE = "In the hardened box, Worca clones projects from their remote: a folder here would be on the box's own disk, not your machine.";

/** The Add project dialog (projects/project-add.html) for this box: clone only in the hardened box, else as shipped. */
export function paintProjectAddForBox(root) {
  if (!root) return;
  const hardened = inHardenedBox();
  for (const id of ['proj-add-tab-new', 'proj-add-tab-folder']) {
    const tab = root.querySelector(`#${id}`);
    if (tab) tab.hidden = hardened;
  }
  const note = root.querySelector('#proj-add-box-note');
  if (note) { note.hidden = !hardened; note.textContent = hardened ? HARDENED_ADD_NOTE : ''; }
}

/** The mode the dialog may open on here: the hardened box turns New and Folder into Clone from URL. */
export const projectAddModeForBox = (mode) => (inHardenedBox() ? 'clone' : mode);

/** Tests only. */
export function _resetWorcaBoxForTests() { box = null; }
