// test/ui-action-errors.test.mjs — runs redesign §5a.2: one failed-action text (title, detail, next step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionError, httpError, UNREACHABLE_DETAIL } from '../ui/public/action-errors.mjs';

test('a network failure says the server was not reached and what to do', () => {
  assert.deepEqual(actionError('archive the selected runs', new TypeError('Failed to fetch')),
    { tone: 'err', title: 'Could not archive the selected runs', detail: UNREACHABLE_DETAIL });
  assert.equal(UNREACHABLE_DETAIL, "Worca's server could not be reached. Nothing was changed. Try again once the connection is back.");
});
test('HTTP failures keep the server message and add the next step', () => {
  const e = (status, error) => httpError({ status }, { error });
  assert.equal(actionError('stop the run', e(409, 'The run already finished')).detail, 'The run already finished. Reload the list, then try again.');
  assert.equal(actionError('add the run to the group', e(404, 'No such group')).detail, 'No such group. Reload the list to see what is there now.');
  assert.equal(actionError('delete the selected runs', e(403, 'Delete needs the Advanced level')).detail, 'Delete needs the Advanced level. Ask an admin for access.');
  assert.equal(actionError('cancel the waiting run', e(500, '')).detail, 'HTTP 500. Nothing was changed; try again.');
  assert.equal(actionError('pause the run', 'usage limit').detail, 'usage limit. Nothing was changed; try again.');
});
test('the archive Undo names its own next step', () => {
  const next = 'The runs stay archived; restore them from Show = Archived.';
  assert.equal(actionError('undo the archive', httpError({ status: 500 }, { error: 'disk full' }), { next }).detail, `disk full. ${next}`);
  assert.equal(actionError('undo the archive', new TypeError('Failed to fetch'), { next }).detail, `Worca's server could not be reached. ${next}`);
});
test('a message that already ends in a full stop is not doubled', () => {
  assert.equal(actionError('x', httpError({ status: 409 }, { error: 'Busy.' })).detail, 'Busy. Reload the list, then try again.');
});
