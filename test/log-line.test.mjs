// test/log-line.test.mjs
// Pure, DOM-free unit test of the log-line className helper (mirrors composer-ui).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLineClass } from '../ui/public/log-line.mjs';

test('sub=true adds the sub-agent class', () => {
  assert.equal(logLineClass('info', true), 'log-line lvl-info sub-agent');
});
test('sub=false omits the sub-agent class', () => {
  assert.equal(logLineClass('debug', false), 'log-line lvl-debug');
});
test('missing level defaults to info', () => {
  assert.equal(logLineClass(undefined, false), 'log-line lvl-info');
});
