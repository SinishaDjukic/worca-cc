// test/flags-registry.test.mjs — the flag registry (docs/feature-flags.md, D1/D10): every entry is
// well formed, inside its review window and not past it, and `requires` is acyclic. The fixture rows
// pin each rule of registryProblems, so the real-registry row passing means something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRows } from './helpers/rows.mjs';
import { FLAGS, FLAG_KEY_RE, FLAG_REVIEW_DAYS, flagByKey, registryProblems } from '../src/shared/flags/registry.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const ok = { key: 'someFlag', title: 'T', description: 'D', stage: 'experimental', default: false,
  owner: 'e-angelov', since: '1.11.0', added: '2026-10-11', reviewBy: '2027-01-09', requires: [] };
const probs = (list, o = { today: '2026-10-11' }) => registryProblems(list, o).join('\n');

test('the real registry has no problems today, is frozen and every docs page exists', () => {
  assert.deepEqual(registryProblems(FLAGS, { today: today() }), []);
  assert.equal(FLAG_REVIEW_DAYS, 90);
  assert.ok(Object.isFrozen(FLAGS) && FLAGS.every((f) => Object.isFrozen(f) && Object.isFrozen(f.requires)));
  for (const f of FLAGS) {
    assert.match(f.key, FLAG_KEY_RE);
    assert.equal(flagByKey(f.key), f);
    if (f.docs) assert.ok(existsSync(fileURLToPath(new URL(`../${f.docs}`, import.meta.url))), `${f.key}: ${f.docs} exists`);
  }
  assert.equal(flagByKey('nope'), null);
  // UI/UX review F: Keep awake is beta and on by default (a switch in Settings › Runs too).
  const ka = flagByKey('keepAwake');
  assert.deepEqual([ka.stage, ka.default], ['beta', true]);
});

test('registryProblems flags every rule', async () => {
  await checkRows([
    { name: 'a well-formed entry passes', run: () => assert.equal(probs([ok]), '') },
    { name: 'bad and duplicate keys', run: () => {
      assert.match(probs([{ ...ok, key: 'Bad-key' }]), /camelCase/);
      assert.match(probs([{ ...ok, key: 'ab' }]), /camelCase/);
      assert.match(probs([ok, { ...ok }]), /duplicate key/);
    } },
    { name: 'experimental must default to false; beta may default to true', run: () => {
      assert.match(probs([{ ...ok, default: true }]), /experimental flag defaults to false/);
      assert.equal(probs([{ ...ok, stage: 'beta', default: true }]), '');
      assert.match(probs([{ ...ok, stage: 'gamma' }]), /stage must be one of/);
    } },
    { name: 'reviewBy at most 90 days after added, never before it', run: () => {
      assert.match(probs([{ ...ok, reviewBy: '2027-01-10' }]), /more than 90 days after added/);
      assert.match(probs([{ ...ok, reviewBy: '2026-10-10' }]), /before added/);
      assert.match(probs([{ ...ok, added: '2026-13-01' }]), /added must be a YYYY-MM-DD date/);
    } },
    { name: 'past its review date fails; an extension needs a reason and restarts the window', run: () => {
      assert.match(probs([ok], { today: '2027-01-10' }), /past its review date 2027-01-09/);
      const ext = { ...ok, extendedOn: '2027-01-05', reviewBy: '2027-04-05' };
      assert.match(probs([ext], { today: '2027-01-05' }), /extendedOn needs an extendReason/);
      assert.equal(probs([{ ...ext, extendReason: 'waiting on #700' }], { today: '2027-01-05' }), '');
    } },
    { name: 'requires: known, not self, not retiring, no cycles', run: () => {
      assert.match(probs([{ ...ok, requires: ['ghostFlag'] }]), /requires unknown flag "ghostFlag"/);
      assert.match(probs([{ ...ok, requires: ['someFlag'] }]), /requires itself/);
      const a = { ...ok, key: 'aaaFlag', requires: ['bbbFlag'] };
      const b = { ...ok, key: 'bbbFlag', requires: ['aaaFlag'] };
      assert.match(probs([a, b]), /requires cycle: aaaFlag → bbbFlag → aaaFlag/);
      assert.match(probs([a, { ...ok, key: 'bbbFlag', stage: 'retiring' }]), /requires retiring flag "bbbFlag"/);
    } },
    { name: 'docs must be a docs/*.md path', run: () => assert.match(probs([{ ...ok, docs: 'http://x' }]), /docs must be a docs\/\*\.md path/) },
  ]);
});
