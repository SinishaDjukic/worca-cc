// test/flags-resolve.test.mjs — resolution (D3): env > settings > default, `-key` forces off, an env
// value locks, retiring is forced, unknown keys are ignored with ONE warning each, requires gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { parseEnvFlags, resolveFlags, flagsAttr, flagGateCss } from '../src/shared/flags/resolve.mjs';

const base = { title: 'T', description: 'D', owner: 'o', since: '1.0.0', added: '2026-10-11', reviewBy: '2026-12-01', requires: [] };
const REG = [
  { ...base, key: 'alphaOne', stage: 'experimental', default: false },
  { ...base, key: 'betaTwo', stage: 'beta', default: true },
  { ...base, key: 'goneSoon', stage: 'retiring', default: true },
  { ...base, key: 'needsAlpha', stage: 'experimental', default: false, requires: ['alphaOne'] },
];
const pick = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.on, v.source, v.locked]]));

test('resolveFlags and parseEnvFlags', async () => {
  await checkRows([
    { name: 'defaults with nothing set', run: () => {
      assert.deepEqual(pick(resolveFlags({ registry: REG })), {
        alphaOne: [false, 'default', false], betaTwo: [true, 'default', false],
        goneSoon: [true, 'default', true], needsAlpha: [false, 'default', false],
      });
    } },
    { name: 'settings beat the default; env beats settings and locks; -key forces off', run: () => {
      const r = resolveFlags({ registry: REG, env: 'alphaOne, -betaTwo', stored: { alphaOne: false, betaTwo: true, needsAlpha: true } });
      assert.deepEqual(pick(r).alphaOne, [true, 'env', true]);
      assert.deepEqual(pick(r).betaTwo, [false, 'env', true]);
      assert.deepEqual(pick(r).needsAlpha, [true, 'settings', false]);
    } },
    { name: 'retiring is forced to its default, env and settings ignored', run: () => {
      assert.deepEqual(pick(resolveFlags({ registry: REG, env: '-goneSoon', stored: { goneSoon: false } })).goneSoon, [true, 'default', true]);
    } },
    { name: 'a flag whose prerequisite is off resolves off (self stays true)', run: () => {
      const r = resolveFlags({ registry: REG, env: '-alphaOne', stored: { needsAlpha: true } });
      assert.equal(r.needsAlpha.self, true);
      assert.equal(r.needsAlpha.on, false);
    } },
    { name: 'unknown keys are ignored and each warned once per call site via warn(key, where)', run: () => {
      const seen = [];
      const r = resolveFlags({ registry: REG, env: 'ghostOne,ghostOne', stored: { ghostTwo: true, alphaOne: 'yes' }, warn: (k, w) => seen.push(`${w}:${k}`) });
      assert.deepEqual(seen, ['WORCA_FLAGS:ghostOne', 'settings.json:ghostTwo']);
      assert.equal('ghostOne' in r, false);
      assert.deepEqual(pick(r).alphaOne, [false, 'default', false], 'a non-boolean stored value is ignored');
    } },
    { name: 'parseEnvFlags: blanks skipped, malformed warned, last mention wins', run: () => {
      const bad = [];
      const m = parseEnvFlags(' alphaOne ,, -alphaOne, 9bad ,betaTwo', { warn: (t) => bad.push(t) });
      assert.deepEqual([...m], [['alphaOne', false], ['betaTwo', true]]);
      assert.deepEqual(bad, ['9bad']);
      assert.equal(parseEnvFlags(undefined).size, 0);
    } },
    { name: 'flagsAttr lists on keys in registry order; flagGateCss has one rule per off flag', run: () => {
      const state = { alphaOne: true, betaTwo: false, goneSoon: true, needsAlpha: false };
      assert.equal(flagsAttr(REG, state), 'alphaOne goneSoon');
      assert.equal(flagGateCss(REG, state), '[data-flag~="betaTwo"]{display:none!important}\n[data-flag~="needsAlpha"]{display:none!important}');
    } },
  ]);
});
