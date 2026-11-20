// test/settings-errors.test.mjs
// POST /api/settings answers (#555): settingsErrorReply maps a src/core validator message, given
// the body key being validated, to { error: <the user's words>, field: <body path> }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsErrorReply, SETTINGS_FIELD_LABELS } from '../src/core/settings-errors.mjs';
import { checkRows } from './helpers/rows.mjs';

const NO_KEY = /\b[a-z]+[A-Z][a-z]\w*\b|\b(?:askWeb|memoryDefrag|workspaceScan|nightMode|actions|sync|schedule|criteria|chat|search)\.\w+/;
// [raw validator message (verbatim from src/core), ctx, field, error]
const cases = [
  ['actions: the low port must not be above the high port', 'actions', 'actions.portRange', 'The low port can’t be higher than the high port.'],
  ['actions.portLow must be a whole number from 1024 to 65535', 'actions', 'actions.portLow', '“Low port” must be a whole number from 1024 to 65535.'],
  ['actions.maxCheckouts must be a whole number from 1 to 100', 'actions', 'actions.maxCheckouts', '“Keep at most” must be a whole number from 1 to 100.'],
  ['The editor command must be text of at most 2000 characters', 'actions', 'actions.editor', 'The editor command must be at most 2000 characters.'],
  ['runLimits.maxConcurrentRuns must be a whole number from 1 to 20', 'runLimits', 'runLimits.maxConcurrentRuns', '“Runs at once” must be a whole number from 1 to 20.'],
  ['askMaxTurns must be an integer between 1 and 500', 'askMaxTurns', 'askMaxTurns', '“Turn limit” must be an integer between 1 and 500.'],
  ['askMaxBudgetUsd must be null (no cap) or a number between 0.1 and 100', 'askMaxBudgetUsd', 'askMaxBudgetUsd', '“Per-turn cost cap” must be a number from 0.1 to 100, or tick No cap.'],
  ['pipelineCostLimitUsd must be a positive number of USD', 'pipelineCostLimitUsd', 'pipelineCostLimitUsd', '“Per-pipeline cost limit” must be a positive number of USD.'],
  ['scheduleMaxFailures must be a whole number from 0 to 100', 'schedule', 'schedule.maxFailures', '“Pause a repeating schedule after failures in a row” must be a whole number from 0 to 100.'],
  ['sync.refreshMinutes must be an integer 0–1440 (0 = never)', 'sync', 'sync.refreshMinutes', '“Check remotes in the background” must be an integer 0–1440 (0 = never).'],
  ['sync.remote must be a remote NAME (e.g. origin), never a URL', 'sync', 'sync.remote', '“Remote” must be a remote NAME (e.g. origin), never a URL.'],
  ['unknown model "x-1" — pick one from the catalog', 'titleModel', 'titleModel', 'The model “x-1” is not in the catalog. Pick another one.'],
  ['path does not exist', 'projectsRoot', 'projectsRoot', 'That folder does not exist.'],
  ['nightMode.maxDecisions: maxDecisions must be an integer 1-500', 'nightMode', 'nightMode.maxDecisions', '“Pause a run after” must be an integer 1-500.'],
  ['askWeb.allowedDomains: "foo bar" is not a host name', 'askWeb', 'askWeb.allowedDomains', '“Allowed domains”: "foo bar" is not a host name.'],
  ['actions must be an object', 'actions', 'actions', '“Actions” got a value Worca can’t read. Reload the page and try again.'],
  ['claude-sonnet-4-5 does not offer effort "max"', 'memoryDefrag', 'memoryDefrag', 'claude-sonnet-4-5 does not offer effort "max".'],
  ['theme must be system, light or dark', 'theme', 'theme', '“Theme” must be system, light or dark.'],
  ['uiLevel must be simple, advanced or expert', 'uiLevel', 'uiLevel', '“Interface mode” must be simple, advanced or expert.'],
  ['resumeAfterUsageLimit must be true or false', 'resumeAfterUsageLimit', 'resumeAfterUsageLimit', '“Resume after a usage limit” must be true or false.'],
  ['autoGeneratePrDescription must be true or false', 'autoGeneratePrDescription', 'autoGeneratePrDescription', '“Draft the PR description automatically” must be true or false.'],
];
test('settingsErrorReply: table of validator messages → {error, field}; no-ctx raw text; never leaks a key; e.g. text is not a key', async () => {
  await checkRows([
    ...cases.map(([raw, ctx, field, error]) => ({
      name: `settingsErrorReply: ${raw}`,
      run: () => {
        assert.deepEqual(settingsErrorReply(new Error(raw), ctx), { error, field });
      },
    })),
    { name: 'settingsErrorReply: no validator context → not a bad value, raw text, no field', run: () => {
      assert.deepEqual(settingsErrorReply(new Error('ENOSPC: no space left on device'), null),
        { error: 'Settings were not saved: ENOSPC: no space left on device.', field: null });
    } },
    { name: 'settingsErrorReply never leaks a camelCase or dotted key (ctx is the top-level body key)', run: () => {
      for (const path of Object.keys(SETTINGS_FIELD_LABELS)) {
        const { error } = settingsErrorReply(new Error(`${path} must be one of a | b`), path.split('.')[0]);
        assert.doesNotMatch(error, NO_KEY, `${path}: ${error}`);
      }
    } },
    { name: 'ordinary dotted text is not mistaken for a key', run: () => {
      assert.match(settingsErrorReply(new Error('sync.remote must be a remote NAME (e.g. origin), never a URL'), 'sync').error, /e\.g\. origin/);
    } },
  ]);
});
