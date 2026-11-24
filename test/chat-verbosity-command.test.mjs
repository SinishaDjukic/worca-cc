// test/chat-verbosity-command.test.mjs — the composer's /verbosity command (#1230): pure parsing and the picker label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerbosityCommand, verbosityButtonLabel } from '../ui/public/chat/verbosity-command.mjs';

const ERR = (arg) => ({ kind: 'error', message: `Unknown style "${arg}". Use /verbosity detailed | normal | concise | terse | caveman | default.` });

test('parseVerbosityCommand: levels, case, clear words, show, unknown, extra words, near misses, normal text', () => {
  const rows = [
    ['/verbosity detailed', { kind: 'set', level: 'detailed' }],
    ['/verbosity normal', { kind: 'set', level: 'normal' }],
    ['/verbosity concise', { kind: 'set', level: 'concise' }],
    ['/verbosity terse', { kind: 'set', level: 'terse' }],
    ['/verbosity caveman', { kind: 'set', level: 'caveman' }],
    ['  /Verbosity   TERSE  ', { kind: 'set', level: 'terse' }],
    ['/VERBOSITY Caveman', { kind: 'set', level: 'caveman' }],
    ['/verbosity default', { kind: 'clear' }],
    ['/verbosity Reset', { kind: 'clear' }],
    ['/verbosity auto', { kind: 'clear' }],
    ['/verbosity', { kind: 'show' }],
    ['  /verbosity  ', { kind: 'show' }],
    ['/verbosity loud', ERR('loud')],
    ['/verbosity terse please', ERR('terse please')],
    ['/verbosity\tterse', { kind: 'set', level: 'terse' }],
    ['/verbosityx', null],
    ['/verbosityterse', null],
    ['verbosity terse', null],
    ['please /verbosity terse', null],
    ['/help', null],
    ['', null],
    ['hello there', null],
  ];
  for (const [text, want] of rows) assert.deepEqual(parseVerbosityCommand(text), want, JSON.stringify(text));
  for (const v of [null, undefined, 42]) assert.equal(parseVerbosityCommand(v), null);
});

test('verbosityButtonLabel: Style · Default for no override, else the level\'s label', () => {
  assert.equal(verbosityButtonLabel(null), 'Style · Default');
  assert.equal(verbosityButtonLabel(undefined), 'Style · Default');
  assert.equal(verbosityButtonLabel('caveman'), 'Style · Caveman');
  assert.equal(verbosityButtonLabel('normal'), 'Style · Normal');
  assert.equal(verbosityButtonLabel('junk'), 'Style · Default');
});
