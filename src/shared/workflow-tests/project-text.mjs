// src/shared/workflow-tests/project-text.mjs — workflow tests 3a: the words for examples that work on a project (canvas
// boards 32–39; plans/workflow-tests-part3a-plan.md). Shared by the server (its refusals) and the browser (cards, rows,
// dialogs), so the two never say it differently. Pure and browser-safe.
import { andList } from './checks.mjs';

// Board 39: the example's project cannot be used.
export const FOLDER_MISSING_TITLE = 'The project folder is missing';
export const folderMissingText = (name, path) => `Worca can't find ${name} in ${path}. Move the folder back, or pick where it is now. The start point is kept.`;
export const FOLDER_PROJECT_TITLE = "Folder projects can't be tested yet";
export const folderProjectText = (name) => `${name} is a Folder project. Worca can test examples on Git projects for now. Pick a Git project.`;
export const UNSUPPORTED_TITLE = "This project can't be tested yet";
export const lfsText = (name) => `${name} keeps large files with Git LFS. Worca's own copy of the project would not have them, so tries could go wrong.`;
export const submodulesText = (name) => `${name} holds other projects inside it (submodules). Worca's own copy of the project would not have them, so tries could go wrong.`;
// P11 (not drawn) and the 5 MB limit (D53).
export const START_GONE_TEXT = 'The start point of this example is no longer in the project. Pick a new start point.';
export const CHANGES_TOO_BIG_TEXT = 'Your changes that are not committed are larger than 5 MB: commit them first, or leave them out.';
// D55, board 35: why a test stopped before any step of a try.
export const setupFailedText = (cmd) => `The setup step failed: ${cmd} ended with an error.`;
// D45: the push, pull request, publish and issue routes' answer for a test try (409).
export const TRY_NEVER_SHIPS_TEXT = 'A test try stays in Worca: it is never pushed and gets no pull request or issue.';
// D60, boards 34 and 39: disk.
const GB = 2 ** 30;
export const fmtGb = (bytes) => `${Math.max(0.1, Number(bytes || 0) / GB).toFixed(1)} GB`;
const freeUp = (need, free) => fmtGb(Math.max(0, need - free));
export const DISK_TITLE = 'Not enough free disk';
export const diskRow = (need, free) => `Needs about ${fmtGb(need)} free while it runs · ${fmtGb(free)} free`;
export const diskRefusalText = (need, free) => `Not enough free disk to start. This test needs about ${fmtGb(need)} free, and this computer has ${fmtGb(free)} free. Free up at least ${freeUp(need, free)}, or pick fewer examples.`;
export const diskRefusalOnceText = (need, free) => `One try needs about ${fmtGb(need)} free, and this computer has ${fmtGb(free)} free. Free up at least ${freeUp(need, free)} and try again. Nothing was tried and nothing was charged.`;
// D62, board 34: an example a test leaves out.
export const leftOutText = (names) => `${andList(names)} ${names.length === 1 ? 'is' : 'are'} left out: pick ${names.length === 1 ? 'its' : 'their'} project first.`;
