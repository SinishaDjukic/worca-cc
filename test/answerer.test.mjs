// test/answerer.test.mjs — the answerer profile's words (src/shared/answerer.mjs): code tokens out for a
// plain-register lead, the plain twin first, the fallback, and no change without a lead. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERER_LEADS, isAnswererLead, plainWords, wordsFor } from '../src/shared/answerer.mjs';

test('the leads and their register', () => {
  assert.deepEqual(Object.keys(ANSWERER_LEADS), ['product', 'architect', 'ux', 'qa', 'security', 'devops']);
  assert.equal(isAnswererLead('ux'), true);
  assert.equal(isAnswererLead('boss'), false);
  assert.equal(isAnswererLead('toString'), false);
});

test('plainWords translates scope tokens; drops other backticks, snake_case and name() tokens; keeps times and URLs', () => {
  const out = plainWords('needs project:read and `--force`');
  assert.doesNotMatch(out, /project:read|`/);
  assert.equal(out, 'needs read access and');
  assert.equal(plainWords('meet at 10:30, see https://x.io'), 'meet at 10:30, see https://x.io');
  assert.equal(plainWords('call run_command or exportRuns() now'), 'call or now');
  assert.equal(plainWords('needs project:read/write now'), 'needs read and write access now', '`/` tails go with the token');
  assert.equal(plainWords('grant a:b/c/d here'), 'grant b, c and d access here');
  assert.equal(plainWords('open localhost:4317 or https://x.io/a:b'), 'open localhost:4317 or https://x.io/a:b');
});

test('plainWords translates scope tokens', () => {
  for (const [text, want] of [
    ['project:read', 'read access'],
    ['project:write', 'write access'],
    ['project:read/write', 'read and write access'],
    ['team:admin', 'admin access'],
    ['a:b/c/d', 'b, c and d access'],
    ['project:read_only', 'read only access'],
    ['team:can-edit', 'can edit access'],
    ['Needs project:read, or team:admin.', 'Needs read access, or admin access.'],
    ['`project:read`', 'read access'],
    ['on ` project:read ` now', 'on read access now'],
    ['`project:read/write`', 'read and write access'],
    ['Force with `--force`', 'Force with'],
    ['Only `project:read now`', 'Only'],
    ['Open `localhost:4317`', 'Open'],
    ['localhost:4317', 'localhost:4317'],
    ['https://x.io/a:b', 'https://x.io/a:b'],
    ['10:30', '10:30'],
    ['Who may export: everyone', 'Who may export: everyone'],
  ]) assert.equal(plainWords(text), want, text);
});

const OPTION = { value: 'members', label: 'Require project:read', plain: 'Anyone who can see the project' };
const NO_TWIN = { value: 'read', label: 'project:read' };

test('wordsFor: a decision with no plain twin reads every scope form in words for product, and for no lead with register plain; a known technical lead keeps its words', () => {
  const entry = { text: 'Allow project:read/write for members' };
  assert.equal(wordsFor(entry, 'text', 'product', { strip: true }), 'Allow read and write access for members');
  assert.equal(wordsFor(entry, 'text', null, { strip: true, register: 'plain' }), 'Allow read and write access for members');
  assert.equal(wordsFor(entry, 'text', 'architect', { strip: true, register: 'plain' }), entry.text);
  assert.equal(wordsFor(entry, 'text', null, { strip: true }), entry.text, 'no register: the own words');
});

test('wordsFor with strip: the plain twin for product, the label for architect, a scope token in words', () => {
  assert.equal(wordsFor(OPTION, 'label', 'product', { strip: true, n: 1 }), 'Anyone who can see the project');
  assert.equal(wordsFor(OPTION, 'label', 'architect', { strip: true, n: 1 }), 'Require project:read');
  assert.equal(wordsFor(NO_TWIN, 'label', 'product', { strip: true, n: 2 }), 'Read access');
  assert.equal(wordsFor({ text: '`project:read`?' }, 'text', 'ux', { strip: true }), 'Read access?');
  assert.equal(wordsFor({ text: 'Gate the export on project:read' }, 'text', 'product', { strip: true }), 'Gate the export on read access');
});

test('wordsFor with no lead returns the entry\'s own words, backticks and plain twin alike', () => {
  const entry = { label: 'Use `--force`', plain: 'Force it' };
  assert.equal(wordsFor(entry, 'label', null), 'Use `--force`');
  assert.equal(wordsFor(entry, 'label', undefined, { strip: true }), 'Use `--force`');
  assert.equal(wordsFor(entry, 'label', 'product'), 'Force it', 'no strip: the twin, unstripped');
});

test('wordsFor: the mock decision reads whole', () => {
  const lead = 'product';
  assert.equal(wordsFor({ text: 'Gate the export on project:read or project:write' }, 'text', lead, { strip: true }), 'Gate the export on read access or write access');
  assert.equal(wordsFor({ label: 'project:read' }, 'label', lead, { strip: true, n: 1 }), 'Read access');
  assert.equal(wordsFor({ label: 'project:write' }, 'label', lead, { strip: true, n: 2 }), 'Write access');
  assert.equal(wordsFor({ text: '`project:read`?' }, 'text', lead, { strip: true }), 'Read access?');
  assert.equal(wordsFor({ text: 'project:read is needed' }, 'text', lead, { strip: true }), 'Read access is needed');
  assert.equal(wordsFor({ text: 'owners need project:read' }, 'text', lead, { strip: true }), 'owners need read access', 'other text keeps its case');
  assert.equal(wordsFor({ label: 'x', plain: 'project:read' }, 'label', lead, { strip: true, n: 1 }), 'Read access', 'the twin is the source');
});

test('wordsFor: Option n only when nothing is left', () => {
  const lead = 'product';
  assert.equal(wordsFor({ label: '`--force`' }, 'label', lead, { strip: true, n: 2 }), 'Option 2');
  assert.equal(wordsFor({ text: '`--force`?' }, 'text', lead, { strip: true }), 'This decision');
  assert.equal(wordsFor({ label: 'Owner' }, 'label', lead, { strip: true, n: 2 }), 'Owner');
  assert.equal(wordsFor({ label: 'Use `--force`' }, 'label', lead, { strip: true, n: 2 }), 'Use');
});
