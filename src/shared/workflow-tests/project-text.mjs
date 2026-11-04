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
// F3: the start route's refusal of a project try when a fresh probe finds no git (400). No full stop: "Stopped: …" composes it.
export const TRY_NEEDS_GIT_TEXT = 'a project try needs git, and Worca cannot find git on this computer. Install git, then choose Finish the rest';
// D55, board 35: why a test stopped before any step of a try.
export const setupFailedText = (cmd) => `The setup step failed: ${cmd} ended with an error.`;
// D45: the push, pull request, publish and issue routes' answer for a test try (409).
export const TRY_NEVER_SHIPS_TEXT = 'A test try stays in Worca: it is never pushed and gets no pull request or issue.';
// Final review C1: the checkout, base-check and update-branch routes' answer for a test try (409). Its branch lives only in
// Worca's copy of the project, so nothing acts on it from the person's folder.
export const TRY_STAYS_IN_COPY_TEXT = "A test try's branch stays in Worca's copy of the project: it cannot be checked out, checked against its base or updated.";
// D60, boards 34 and 39: disk.
const GB = 2 ** 30;
/** "0.9 GB", "1.2 GB", and whole GB from 10 GB up ("48 GB"), as boards 34 and 35 write them. */
export const fmtGb = (bytes) => {
  const gb = Math.max(0.1, Number(bytes || 0) / GB);
  return `${gb < 9.95 ? gb.toFixed(1) : Math.round(gb)} GB`;
};
const freeUp = (need, free) => fmtGb(Math.max(0, need - free));
export const DISK_TITLE = 'Not enough free disk';
export const diskRow = (need, free) => `Needs about ${fmtGb(need)} free while it runs · ${fmtGb(free)} free`;
export const diskRefusalText = (need, free) => `Not enough free disk to start. This test needs about ${fmtGb(need)} free, and this computer has ${fmtGb(free)} free. Free up at least ${freeUp(need, free)}, or pick fewer examples.`;
export const diskRefusalOnceText = (need, free) => `One try needs about ${fmtGb(need)} free, and this computer has ${fmtGb(free)} free. Free up at least ${freeUp(need, free)} and try again. Nothing was tried and nothing was charged.`;
// D62, board 34: an example a test leaves out.
export const leftOutText = (names) => `${andList(names)} ${names.length === 1 ? 'is' : 'are'} left out: pick ${names.length === 1 ? 'its' : 'their'} project first.`;
// P27 (decided 2026-10-30 by the controller): left out for any other reason (its project is missing, a Folder project or no
// longer registered); the Tests list's row says which.
export const leftOutBlockedText = (names) => `${andList(names)} ${names.length === 1 ? 'is' : 'are'} left out: ${names.length === 1 ? 'it cannot' : 'they cannot'} be tried yet. See the Tests list.`;
// P28 (decided 2026-10-30 by the controller): Test a version when no example can be tried.
export const NONE_READY_TEXT = 'Nothing to try yet: every example is left out. Fix them in the Tests list, then test again.';

// ── Board 32: Edit an example, where it starts ───────────────────────────────
export const shortSha = (sha) => String(sha || '').slice(0, 7);
export const WHERE_TITLE = 'Where it starts';
export const WHERE_HINT = "Each try works in Worca's own copy of the project. Your folder and your branches are never touched.";
export const START_HINT = 'Both versions start from here. It stays the same until you change it, so results can be compared.';
export const behindText = (n, ref) => `The project has moved on: ${n} newer ${n === 1 ? 'commit' : 'commits'} on ${ref} since this start point.`;
export const LATEST_BUTTON = 'Start from the latest';
export const LATEST_HINT = 'Both versions are then tried again from the new point, so their results stay comparable.';
export const CHANGES_LABEL = 'Include my changes that are not committed yet';
export const CHANGES_HINT = 'Off: the example starts from the commit only. On: your changes are saved with the example.';
export const DEV_CAPTION = 'For developers';
export const SETUP_LABEL = 'Before each try, run';
export const SETUP_HINT = "Filled in from the project's setup. If it fails, the test stops and no try counts as failed.";
export const SETUP_HINT_PAST = "Filled in from the project's setup.";
export const CARD1_HINT_PROJECT = 'The same request and the same starting point are used every time this example is tried.';
export const CHECKS_HINT_PROJECT = "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.";
export const PROJECT_LABEL = 'Project';
export const START_LABEL = 'Start point';
export const CHANGE_BUTTON = 'Change';
export const NO_PROJECT_OPTION = 'No project';
export const PICK_PROJECT_OPTION = 'Pick a project';
// P2 (not drawn): the start point dialog.
export const START_DIALOG_TITLE = 'Start point';
export const START_DIALOG_HINT = 'Pick the branch this example starts from. Worca takes its newest commit.';
export const START_DIALOG_OK = 'Use this start point';
// Task 10 review (not drawn; decided 2026-10-29 by the controller, plan P19–P26): the editor's other states and lines.
export const MISSING_FOLDER_ADD_AGAIN = 'If the folder moved, add it again under Projects, then pick it here.';   // P19
export const notRegisteredText = (name) => `${name} is no longer one of Worca's projects. Add it again under Projects, or pick another project.`;   // P20
export const PROJECTS_UNREAD_TEXT = 'Worca could not read your projects. Reload the page to try again.';   // P21
export const NOT_ON_BRANCH_TEXT = 'The project folder is not on a branch. Check out a branch in it, then come back.';   // P22
export const changesMovesText = (branch) => `Turning this on also moves the start point to the newest commit on ${branch}.`;   // P23
export const FILE_NAME_NEEDED = 'Write the file name.';   // P24
export const NO_BRANCHES_TEXT = 'Worca found no branches in this project.';   // P25
export const startNowText = (ref, short) => `The start point is now ${ref} at ${short}.`;   // P26
export const startWillBeText = (ref, short) => `The start point will be ${ref} at ${short} when you save the example.`;   // P26: a Change pick, not yet saved
// The editor's fallbacks and labels (Task 10 review, item 15).
export const PICK_BRANCH_FIRST = 'Pick a branch first.';
export const BRANCHES_UNREAD_TEXT = 'Worca could not read the branches of the project.';
export const START_NOT_MOVED_TEXT = 'The start point did not move.';
export const FILE_IN_PROJECT_LABEL = 'File in the project';
export const SAVE_FIRST_TEXT = 'Save the example first.';

// ── Board 33: the project checks ─────────────────────────────────────────────
export const CHECK_DIALOG_HINT_PROJECT = "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.";
export const GROUP_RESULT = 'The result';
export const GROUP_PROJECT = 'The project';
export const COMMAND_LABEL = 'Command';
export const COMMAND_HINT = 'It runs in Worca\'s own copy of the project after the try is done. Met when the command ends without an error. Worca shows its last summary line, for example "212 passed, 1 failed".';
export const TIMEOUT_LABEL = 'Stop the command after';
export const TIMEOUT_HINT = 'A command that runs longer counts as not met.';
export const timeoutText = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
export const READ_FROM_LEGEND = 'Read from';
export const READ_FROM_RESULT = 'The final result';
export const READ_FROM_RESULT_SUB = ' · what the workflow says at the end';
export const READ_FROM_FILE = 'A file in the project';
export const ADD_CHECK = 'Add check';

// ── Board 34: Test a version ─────────────────────────────────────────────────
export const LOCK_LEAD = 'Tests never push, create pull requests or change your project.';
export const LOCK_REST = " Each try works in Worca's own copy of the project, which is deleted after the checks.";
export const REAL_BLOCKED_HINT = ' Pushes, pull requests and issues stay blocked.';
export const allOnProject = (n, name) => `All ${n} · on ${name}`;
export const DISK_KEY = 'Disk';
export const TIME_KEY = 'Time';
/** "about 1 hour 10 minutes", "about 2 minutes": the time row (board 34). */
export function aboutDuration(ms) {
  const m = Math.max(1, Math.round(Number(ms || 0) / 60000));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const mins = (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  if (!h) return `about ${mins(r)}`;
  return `about ${h} ${h === 1 ? 'hour' : 'hours'}${r ? ` ${mins(r)}` : ''}`;
}
export const SETUP_TAKES_LEAD = ' · setup ';
export const setupTakesRest = (ms) => ` takes ${aboutDuration(ms)} a try`;

// ── Board 35: while the test runs ────────────────────────────────────────────
export const PHASES = Object.freeze([['preparing', 'Preparing a copy of the project'], ['setup', 'Running setup'], ['working', 'Working'], ['checking', 'Checking']]);
export const PHASE_LABEL = Object.freeze(Object.fromEntries(PHASES));
export const PHASE_SUB = Object.freeze({ working: 'The workflow does its work', checking: 'The checks run, then the copy is deleted' });
export const PHASES_TITLE = 'What happens in each try';
/** A version's label inside a sentence (final review M2): "Your draft" reads "your draft" after other words; "v3 draft" stays. */
export const inSentence = (label) => (/^Your\b/.test(String(label ?? '')) ? `y${String(label).slice(1)}` : label);
export const phasesShownFor = (name, label, tryNo) => `Shown for ${name}, ${inSentence(label)}, try ${tryNo}. Up to three tries run at once, each in its own copy of the project.`;   // P29
export const nowText = (now) => `Try ${now.tryNo} · ${PHASE_LABEL[now.phase] || PHASE_LABEL.working}`;
export const forMinutes = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return `for ${m} ${m === 1 ? 'minute' : 'minutes'}`; };
export const RUNNING_LEAD = 'running ';
export const FROM_LEAD = 'From ';
export const DISK_IN_USE = 'Disk in use';
export const diskInUseSub = (need, free) => `of about ${fmtGb(need)} · ${fmtGb(free)} free`;
export const SETUP_STOP_REST = ' The test stopped, and no try counts as failed.';
export const SETUP_STOP_HINT = "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: ";
export const SEE_SETUP_OUTPUT = 'See the setup output';
export const setupWhere = (name, label, tryNo) => `${name}, ${inSentence(label)}, try ${tryNo}`;
export const SETUP_FIX_HINT = 'If something on this computer was missing, fix it and try again. To change the setup or the start point, edit the example and start a new test.';
// Final review: `edited` is true when an example, the draft or a tested version changed, so the hint names none of them.
export const SETUP_EDITED_HINT = 'Something this test uses changed since it started (an example or a version). Start a new test to try it again.';
export const START_NEW_TEST = 'Start a new test';
export const SETUP_NO_OUTPUT = 'The command printed nothing.';
export const EDIT_EXAMPLE = 'Edit the example';
export const TRY_AGAIN = 'Try again';

// ── Boards 36, 37: one example side by side ──────────────────────────────────
export const changesTitle = (label) => `What changed in the project · ${label}`;
export function changeCountText(c) {
  const parts = [];
  if (c && c.added) parts.push(`${c.added} added`);
  if (c && c.changed) parts.push(`${c.changed} changed`);
  if (c && c.removed) parts.push(`${c.removed} removed`);
  return parts.length ? parts.join(', ') : 'Nothing changed';
}
export const FILE_BADGE = Object.freeze({ added: 'Added', changed: 'Changed', renamed: 'Renamed', removed: 'Removed' });
export const READ_ALL_CHANGES = 'Read all the changes';
export const BOTH_STARTED_FROM = ' · both started from ';
export const DEV_SBS_HINT = "Each try worked in Worca's own copy of the project, which was deleted after the checks. The list of changes and the full diff of each try are kept here.";
export const DEV_START_LEAD = 'Start point: ';
export const DEV_SETUP_LEAD = 'Setup: ';
const n1 = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const changesLine = (label, c) => `${label}: ${n1(c.total, 'file', 'files')}, ${n1(c.added, 'line', 'lines')} added, ${c.removed} removed`;
export const notMetFor = (label) => `Not met for ${label}:`;
export const COMMAND_ENDED = ' the command ended with an error.';
// P32 (not drawn; decided 2026-10-30 by the controller): a command its time limit stopped.
export const COMMAND_TIMED_OUT = ' the command ran longer than its time limit and was stopped.';
export const SEE_COMMAND_OUTPUT = 'See the command output';
export const NOTHING_PUSHED_TEXT = "The changes stayed in Worca's own copy of the project: nothing was pushed.";
export const REAL_BLOCKED_TEXT = ' Pushes, pull requests and issues stay blocked in every test, also with Real connectors.';
export const EACH_ANSWERED_TEXT = 'Each one answered "Not sent: this is a test."';
// P32 (not drawn; decided 2026-10-30 by the controller): a Real try the guard stopped; only the stopped ones answered.
export const EACH_STOPPED_ANSWERED_TEXT = 'Each one Worca stopped answered "Not sent: this is a test."';
// P30 (not drawn; decided 2026-10-30 by the controller): the change card's other states.
export const READING_CHANGES = 'Reading the changes…';
export const NO_FILE_DIFF_TEXT = 'No changes to show for this file.';
export const BINARY_FILE_TEXT = 'This file is not text, so its changes are not shown.';
export const CHANGES_UNREAD_TEXT = 'Worca could not read the changes of this try. Read all the changes to try again.';
export const DIFF_SHORTENED_TEXT = 'Shortened here: read all the changes.';
export const moreFilesText = (n) => `And ${n1(n, 'more file', 'more files')}: read all the changes.`;
// P31 (not drawn; decided 2026-10-30 by the controller): Read all the changes.
export const CHANGES_NOT_READ_TITLE = 'Could not read the changes';
export const NO_DIFF_TEXT = 'Worca kept no record of what this try changed.';
export const PATCH_CUT_TEXT = 'The changes are longer than 5 MB: only the first 5 MB are shown.';

// ── Board 38: the Tests list and a past project run ──────────────────────────
export const PICK_FIRST_TEXT = 'Pick a project first';
// P33 (not drawn; decided 2026-10-30 by the controller): an example left out for another reason than "no project yet" (its
// folder is missing, a Folder project, no longer registered): its result columns; the row adds the server's readyText.
export const CANT_TRY_TEXT = "Can't be tried yet";
// P34 (not drawn; decided 2026-10-30 by the controller): first use, when some of the runs found cannot become examples.
export const refusedRunsCount = (n) => ` (${n} can't be used yet)`;
export const NO_PROJECT_YET_TAIL = ' · no project yet, so it is left out of tests';
export const NO_PROJECT_YET_HINT = `Request only${NO_PROJECT_YET_TAIL}`;
export const WITH_CHANGES_HINT = ' · with changes not committed yet';
export const MOVED_BADGE = 'Moved on';
export const LIST_FOOT_HINT = 'Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.';
export const fromRunIntro = (workflow) => `Worca keeps the request and where the run started, so every new version of ${workflow} can be tried on exactly the same thing.`;
export const STARTS_FROM_RUN = 'Starts from where this run started: ';
export const pastRunProjectNote = (name) => `Project: ${name} · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project.`;
export const PAST_RUN_REFUSALS = Object.freeze({
  'folder-run': "This run worked on a Folder project. Folder projects can't be tested yet.",
  'workspace-run': "This run worked on several projects. Workflows on several projects can't be tested yet.",
  'no-start': 'Worca did not record where this run started.',
});

// ── Board 39: empty and refused states ───────────────────────────────────────
export const PICK_PROJECT_TITLE = 'Pick the project this example works on';
export const pickProjectText = (workflow) => `${workflow} changes a project's code, so each example needs one. Each try works in Worca's own copy of the project.`;
export const PICK_THE_FOLDER = 'Pick the folder';
export const firstUseNoneText = (workflow, { needsProject }) => (needsProject
  ? `Worca found no runs of ${workflow} yet. Run the workflow once on a project, or write an example yourself.`
  : `Worca found no runs of ${workflow} yet. Write an example yourself, or run the workflow once and come back.`);
export const pickerNoneText = (workflow, { needsProject }) => (needsProject
  ? `Worca found no runs of ${workflow} yet. Run the workflow once on a project, or write an example yourself.`
  : `Worca found no runs of ${workflow} yet. Run the workflow once, or write an example yourself.`);
