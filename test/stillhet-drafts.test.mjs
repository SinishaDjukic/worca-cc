// test/stillhet-drafts.test.mjs — shell/drafts.js, the one drafts store (Schedules D6, rail.drafts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const mod = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(new URL('../ui/public/stillhet/shell/drafts.js', import.meta.url), 'utf8'), mod);
const { make, KEY } = mod.module.exports;
const plain = (v) => JSON.parse(JSON.stringify(v));   // the vm's objects come from another realm
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const base = { every: 'every day', at: '02:00', overlap: 'skip' };

test('the count rises per changed field, returns to 0 when the fields equal the saved ones, and persists', () => {
  const s = mem(), D = make(s);
  let n = 0; D.onChange(() => { n += 1; });
  D.touch('schedule:sch_1', base, () => ({ every: 'every Monday' }));
  assert.equal(D.changes('schedule:sch_1'), 1);
  D.touch('schedule:sch_1', base, () => ({ at: '09:00' }));
  assert.equal(D.changes('schedule:sch_1'), 2);
  assert.deepEqual(plain(make(s).get('schedule:sch_1').fields), { every: 'every Monday', at: '09:00' }, 'a reload keeps it');
  D.touch('schedule:sch_1', base, () => ({ every: 'every day', at: '02:00' }));
  assert.equal(D.changes('schedule:sch_1'), 0);
  assert.equal(D.get('schedule:sch_1'), null);
  assert.equal(n, 3);
});

test('all(kind) lists only that kind; discard drops one; a corrupt stored value reads as no drafts', () => {
  const D = make(mem());
  D.touch('schedule:a', base, () => ({ at: '09:00' }));
  D.touch('workflow:w', {}, () => ({ model: 'x' }));
  assert.deepEqual(plain(D.all('schedule')), [{ key: 'schedule:a', id: 'a', changes: 1 }]);
  assert.equal(D.discard('schedule:a'), true);
  assert.deepEqual(plain(D.all('schedule')), []);
  for (const bad of ['{nope', '[1,2]', 'null', '"x"']) assert.deepEqual(plain(make(mem({ [KEY]: bad })).all('schedule')), [], bad);
});
