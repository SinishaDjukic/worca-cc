// test/workflow-test-project-text.test.mjs — workflow tests 3a: the words for project examples, as boards 32–39 write them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../src/shared/workflow-tests/project-text.mjs';

test('board 32: where it starts', () => {
  assert.equal(t.WHERE_TITLE, 'Where it starts');
  assert.equal(t.WHERE_HINT, "Each try works in Worca's own copy of the project. Your folder and your branches are never touched.");
  assert.equal(t.START_HINT, 'Both versions start from here. It stays the same until you change it, so results can be compared.');
  assert.equal(t.behindText(14, 'main'), 'The project has moved on: 14 newer commits on main since this start point.');
  assert.equal(t.behindText(1, 'main'), 'The project has moved on: 1 newer commit on main since this start point.');
  assert.equal(t.LATEST_BUTTON, 'Start from the latest');
  assert.equal(t.LATEST_HINT, 'Both versions are then tried again from the new point, so their results stay comparable.');
  assert.equal(t.CHANGES_LABEL, 'Include my changes that are not committed yet');
  assert.equal(t.CHANGES_HINT, 'Off: the example starts from the commit only. On: your changes are saved with the example.');
  assert.equal(t.SETUP_LABEL, 'Before each try, run');
  assert.equal(t.SETUP_HINT, "Filled in from the project's setup. If it fails, the test stops and no try counts as failed.");
  assert.equal(t.CARD1_HINT_PROJECT, 'The same request and the same starting point are used every time this example is tried.');
  assert.equal(t.CHECKS_HINT_PROJECT, "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.");
  assert.equal(t.shortSha('abc1234def'), 'abc1234');
  // P26: a Change pick waits for the save; Start from the latest is stored at once.
  assert.equal(t.startWillBeText('release', 'e9f2c47'), 'The start point will be release at e9f2c47 when you save the example.');
  assert.equal(t.startNowText('main', '28 Oct'), 'Saved: the start point is now main · 28 Oct.');
});

test('board 33: the project checks in the dialog', () => {
  assert.equal(t.CHECK_DIALOG_HINT_PROJECT, "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.");
  assert.equal(t.COMMAND_HINT, 'It runs in Worca\'s own copy of the project after the try is done. Worca shows its last summary line, for example "212 passed, 1 failed".');
  assert.deepEqual([t.TIMEOUT_LABEL, t.TIMEOUT_HINT], ['Stop the command after', 'A command that runs longer counts as not met.']);
  assert.deepEqual([t.GROUP_RESULT, t.GROUP_PROJECT], ['The result', 'The project']);
  assert.deepEqual([t.READ_FROM_LEGEND, t.READ_FROM_RESULT, t.READ_FROM_RESULT_SUB, t.READ_FROM_FILE],
    ['Read from', 'The final result', ' · what the workflow says at the end', 'A file in the project']);
  assert.equal(t.timeoutText(1), '1 minute');
  assert.equal(t.timeoutText(10), '10 minutes');
});

test('board 34: test a version', () => {
  assert.equal(t.LOCK_LEAD, 'Tests never push, create pull requests or change your project.');
  assert.equal(t.LOCK_REST, " Each try works in Worca's own copy of the project, which is deleted after the checks.");
  assert.equal(t.REAL_BLOCKED_HINT, ' Pushes, pull requests and issues stay blocked.');
  assert.equal(t.allOnProject(5, 'worca-cc'), 'All 5 · on worca-cc');
  assert.equal(t.aboutDuration(70 * 60000), 'about 1 hour 10 minutes');
  assert.equal(t.aboutDuration(2 * 60000), 'about 2 minutes');
  assert.equal(t.aboutDuration(1 * 60000), 'about 1 minute');
  assert.equal(t.aboutDuration(2 * 3600000), 'about 2 hours');
});

test('board 35: while the test runs', () => {
  assert.deepEqual(t.PHASES.map(([k, label]) => [k, label]), [['preparing', 'Preparing a copy of the project'], ['setup', 'Running setup'],
    ['working', 'Working'], ['checking', 'Checking']]);
  assert.deepEqual(t.PHASE_SUB, { working: 'The workflow does its work', checking: 'The checks run, then the copy is deleted' });
  assert.equal(t.PHASES_TITLE, 'What happens in each try');
  assert.equal(t.phasesShownFor('Ticket 482', 'v3 draft', 1), 'Shown for Ticket 482, v3 draft, try 1. Up to three tries run at once, each in its own copy of the project.');   // P29
  assert.equal(t.NONE_READY_TEXT, 'Nothing to try yet: every example is left out. Fix them in the Tests list, then test again.');   // P28
  assert.equal(t.leftOutBlockedText(['Ticket 471']), 'Ticket 471 is left out: it cannot be tried yet. See the Tests list.');   // P27
  assert.equal(t.leftOutBlockedText(['Ticket 471', 'Ticket 466']), 'Ticket 471 and Ticket 466 are left out: they cannot be tried yet. See the Tests list.');
  assert.equal(t.nowText({ tryNo: 2, phase: 'checking' }), 'Try 2 · Checking');
  assert.equal(t.DISK_IN_USE, 'Disk in use');
  assert.equal(t.SETUP_STOP_REST, ' The test stopped, and no try counts as failed.');
  assert.equal(t.SETUP_STOP_HINT, "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: ");
  assert.deepEqual([t.SEE_SETUP_OUTPUT, t.SETUP_FIX_HINT, t.EDIT_EXAMPLE, t.TRY_AGAIN],
    ['See the setup output', 'If something on this computer was missing, fix it and try again. To change the setup or the start point, edit the example and start a new test.', 'Edit the example', 'Try again']);
});

test('boards 36 and 37: what changed, what would have been sent', () => {
  assert.equal(t.changesTitle('v2'), 'What changed in the project · v2');
  assert.equal(t.changeCountText({ added: 0, changed: 3, removed: 0 }), '3 changed');
  assert.equal(t.changeCountText({ added: 1, changed: 2, removed: 1 }), '1 added, 2 changed, 1 removed');
  assert.equal(t.changeCountText({ added: 0, changed: 0, removed: 0 }), 'Nothing changed');
  assert.deepEqual(t.FILE_BADGE, { added: 'Added', changed: 'Changed', renamed: 'Renamed', removed: 'Removed' });
  assert.equal(t.READ_ALL_CHANGES, 'Read all the changes');
  assert.equal(t.DEV_SBS_HINT, "Each try worked in Worca's own copy of the project, which was deleted after the checks. The list of changes and the full diff of each try are kept here.");
  assert.equal(t.changesLine('v2', { total: 3, added: 14, removed: 3 }), 'v2: 3 files, 14 lines added, 3 removed');
  assert.equal(t.changesLine('v3 draft', { total: 1, added: 1, removed: 0 }), 'v3 draft: 1 file, 1 line added, 0 removed');
  assert.equal(t.notMetFor('v3 draft'), 'Not met for v3 draft:');
  assert.equal(t.COMMAND_ENDED, ' the command ended with an error.');
  assert.equal(t.COMMAND_TIMED_OUT, ' the command ran longer than its time limit and was stopped.');   // P32
  assert.equal(t.EACH_STOPPED_ANSWERED_TEXT, 'Each one Worca stopped answered "Not sent: this is a test."');   // P32
  assert.equal(t.SEE_COMMAND_OUTPUT, 'See the command output');
  assert.equal(t.NOTHING_PUSHED_TEXT, "The changes stayed in Worca's own copy of the project: nothing was pushed.");
  assert.equal(t.REAL_BLOCKED_TEXT, ' Pushes, pull requests and issues stay blocked in every test, also with Real connectors.');
  assert.equal(t.EACH_ANSWERED_TEXT, 'Each one answered "Not sent: this is a test."');
  // P30, P31 (not drawn; decided 2026-10-30 by the controller): the change card's other states, Read all the changes.
  assert.equal(t.READING_CHANGES, 'Reading the changes…');
  assert.equal(t.NO_FILE_DIFF_TEXT, 'No changes to show for this file.');
  assert.equal(t.BINARY_FILE_TEXT, 'This file is not text, so its changes are not shown.');
  assert.equal(t.CHANGES_UNREAD_TEXT, 'Worca could not read the changes of this try. Read all the changes to try again.');
  assert.equal(t.DIFF_SHORTENED_TEXT, 'Shortened here: read all the changes.');
  assert.equal(t.moreFilesText(1), 'And 1 more file: read all the changes.');
  assert.equal(t.moreFilesText(7), 'And 7 more files: read all the changes.');
  assert.equal(t.CHANGES_NOT_READ_TITLE, 'Could not read the changes');
  assert.equal(t.NO_DIFF_TEXT, 'Worca kept no record of what this try changed.');
  assert.equal(t.PATCH_CUT_TEXT, 'The changes are longer than 5 MB: only the first 5 MB are shown.');
});

test('boards 38 and 39: the list, a past run, the empty and refused states', () => {
  assert.equal(t.PICK_FIRST_TEXT, 'Pick a project first');
  assert.equal(t.CANT_TRY_TEXT, "Can't be tried yet");   // P33
  assert.equal(t.refusedRunsCount(2), " (2 can't be used yet)");   // P34
  assert.equal(t.NO_PROJECT_YET_HINT, 'Request only · no project yet, so it is left out of tests');
  assert.equal(t.WITH_CHANGES_HINT, ' · with changes not committed yet');
  assert.equal(t.LIST_FOOT_HINT, 'Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.');
  assert.equal(t.fromRunIntro('Fix a bug from a ticket'), 'Worca keeps the request and where the run started, so every new version of Fix a bug from a ticket can be tried on exactly the same thing.');
  assert.equal(t.STARTS_FROM_RUN, 'Starts from where this run started: ');
  assert.equal(t.pastRunProjectNote('worca-cc'), "Project: worca-cc · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project.");
  assert.deepEqual(t.PAST_RUN_REFUSALS, {
    'folder-run': "This run worked on a Folder project. Folder projects can't be tested yet.",
    'workspace-run': "This run worked on several projects. Workflows on several projects can't be tested yet.",
    'no-start': 'Worca did not record where this run started.',
  });
  assert.equal(t.PICK_PROJECT_TITLE, 'Pick the project this example works on');
  assert.equal(t.pickProjectText('Fix a bug from a ticket'), "Fix a bug from a ticket changes a project's code, so each example needs one. Each try works in Worca's own copy of the project.");
  assert.equal(t.PICK_PROJECT_OPTION, 'Pick a project');
  assert.equal(t.NO_PROJECT_OPTION, 'No project');
  assert.equal(t.PICK_THE_FOLDER, 'Pick the folder');
  assert.equal(t.firstUseNoneText('Fix a bug from a ticket', { needsProject: true }), 'Worca found no runs of Fix a bug from a ticket yet. Run it once on a project to get a first result, or write an example yourself.');
  assert.equal(t.firstUseNoneText('Brief writer', { needsProject: false }), 'Worca found no runs of Brief writer yet. Run it once to get a first result, or write an example yourself.');
  assert.equal(t.pickerNoneText('Brief writer', { needsProject: false }), 'Worca found no runs of Brief writer yet. Run it once to get a first result, or write an example yourself.');
  assert.equal(t.pickerNoneText('Fix', { needsProject: true }), 'Worca found no runs of Fix yet. Run it once on a project to get a first result, or write an example yourself.');
  assert.equal(t.RUN_IT_ONCE, 'Run it once');
  assert.equal(t.WRITE_YOURSELF, 'Or write an example yourself');
  assert.deepEqual([t.START_DIALOG_TITLE, t.START_DIALOG_HINT, t.START_DIALOG_OK],
    ['Start point', 'Pick the branch this example starts from. Worca takes its newest commit.', 'Use this start point']);
});
