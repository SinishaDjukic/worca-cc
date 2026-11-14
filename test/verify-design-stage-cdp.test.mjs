// test/verify-design-stage-cdp.test.mjs: the Design stage real-browser proof (tools/verify-design-stage-cdp.mjs)
// keeps every check of plan Task 17, its scratch WORCA_HOME, a frame that never gets same-origin, no recorded build,
// and its npm script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('verify:design-stage keeps its checks', () => {
  const src = readFileSync(new URL('../tools/verify-design-stage-cdp.mjs', import.meta.url), 'utf8');
  for (const needle of ['HUD radius is 8px', 'HUD Stop inside the stage at 1280', 'crew colours are the dark arm in a light page', 'cursor count equals the HUD count',
    'overlay within one frame while scrolling', 'the camera fits the crew', 'the box covers the stage during the ease', 'Follow appears after a scroll and brings the camera back', 'ctrl wheel zooms and stops the camera',
    'parked only past 0.45', 'a first round done is fit-width at the top', 'a change round stays on its section when done', 'whole-round Stop keeps the zoom', 'cursors enter and leave at the stage edge', 'the old frame stays until ready', 'a frame that navigates away offers Reload', 'reduced motion: nothing animates', 'dark mode keeps the stage',
    'ghost held, then crisp', 'hide cursors keeps the count', 'frame origin is null', 'a new round shows text the last round already showed',
    'a frame that navigates away after its ready offers Reload', 'a frame that navigates away after its load offers Reload',
    'a frame that fires its own load event, then navigates away, offers Reload', 'WORCA_HOME']) assert.ok(src.includes(needle), needle);
  assert.ok(!src.includes('allow-same-origin'));
  assert.doesNotMatch(src, /recordMockBuild|events\.ndjson/);
  assert.match(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['verify:design-stage'], /tools\/verify-design-stage-cdp\.mjs/);
});
