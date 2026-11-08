// test/desktop-live-check.test.mjs — the pure parts of tools/desktop-live-check.mjs (the macOS live check of the desktop
// window's chrome, drag strip and double-click). The live run itself needs a display and Electron: not part of npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveArgs, clearOfLights } from '../tools/desktop-live-check.mjs';
import { TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_SIZE } from '../desktop/src/title-bar.mjs';

const usage = (argv, flag) => assert.throws(() => parseLiveArgs(argv), (e) => e.code === 'USAGE' && e.message === `unknown flag: ${flag}`, JSON.stringify(argv));

test('parseLiveArgs: flags, --reuse-old and --desktop-dir need a value, unknown flag → USAGE', () => {
  assert.deepEqual(parseLiveArgs([]), { reuseOld: null, desktopDir: null, osClick: false, keep: false });
  assert.deepEqual(parseLiveArgs(['--reuse-old', '0e006ee4d', '--desktop-dir', '/s/desktop', '--os-click', '--keep']), { reuseOld: '0e006ee4d', desktopDir: '/s/desktop', osClick: true, keep: true });
  assert.deepEqual(parseLiveArgs(['--keep', '--reuse-old', 'HEAD~2']), { reuseOld: 'HEAD~2', desktopDir: null, osClick: false, keep: true });
  usage(['--reuse-old'], '--reuse-old');
  usage(['--desktop-dir'], '--desktop-dir');
  usage(['--reuse-old', '--keep'], '--reuse-old');
  usage(['--desktop-dir', ''], '--desktop-dir');
  usage(['--bogus'], '--bogus');
  usage(['--keep', 'stray'], 'stray');
  usage(['--os-click=1'], '--os-click=1');
});

test('clearOfLights: the 84px wordmark clears {18,17}+52; 20px does not', () => {
  const lights = TRAFFIC_LIGHTS.expanded;
  assert.deepEqual(lights, { x: 18, y: 17 });
  assert.equal(clearOfLights({ left: 84 }, lights, TRAFFIC_LIGHTS_SIZE, 8), true);
  assert.equal(clearOfLights({ left: 20 }, lights, TRAFFIC_LIGHTS_SIZE, 8), false);
  assert.equal(clearOfLights({ left: 78 }, lights, TRAFFIC_LIGHTS_SIZE, 8), true, 'exactly at the bound');
  assert.equal(clearOfLights({ left: 77.5 }, lights, TRAFFIC_LIGHTS_SIZE, 8), false);
});
