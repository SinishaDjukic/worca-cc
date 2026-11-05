// test/source-reach.test.mjs — A6-D11's reach sentence, shared by Requirements and Ticket updates (plans/ticket-updates-design.md §5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginOpError } from '../src/core/plugin-shim.mjs';
import { reachReason, reachSentence } from '../src/core/source-reach.mjs';
import * as exportMod from '../src/core/requirements/export.mjs';

test('the reach helpers live in source-reach.mjs; requirements/export.mjs re-exports the same functions', () => {
  assert.equal(exportMod.reachReason, reachReason);
  assert.equal(exportMod.reachSentence, reachSentence);
});

test("the sentences are A6's", () => {
  assert.equal(reachSentence('Jira', new PluginOpError('auth', 'x')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(reachReason(new PluginOpError('timeout', 'plugin "jira-source" op "listProjects" exceeded 60000ms (child killed)')), 'it did not answer within a minute');
  assert.equal(reachReason(new PluginOpError('timeout', 'op exceeded')), 'it did not answer within a minute', 'no limit named: as A6 wrote it');
});

test('a timeout names the real limit: a 30 s call says 30 seconds (decided 2026-10-30)', () => {
  assert.equal(reachReason(new PluginOpError('timeout', 'plugin "jira-source" op "listStatuses" exceeded 30000ms (child killed)')), 'it did not answer within 30 seconds');
  assert.equal(reachSentence('Jira', new PluginOpError('timeout', 'plugin "jira-source" op "legacyMove" exceeded 30000ms (child killed)')),
    'Worca could not reach Jira: it did not answer within 30 seconds.');
});

test('the other sentences are unchanged', () => {
  assert.equal(reachReason(new PluginOpError('network', 'Jira unreachable: fetch failed.')), 'Jira unreachable: fetch failed');
  assert.equal(reachReason(new PluginOpError('protocol', 'non-JSON'), 'Jira'), 'the Jira plugin gave an answer Worca could not read');
  assert.equal(reachReason(new PluginOpError('plugin', 'TypeError: x is not a function'), 'Jira'), 'the Jira plugin stopped unexpectedly');
  assert.equal(reachSentence('', { message: 'it did not name the ticket it made' }), 'Worca could not reach the tracker: it did not name the ticket it made.');
});
