// test/plugin-ai-readiness-readme.test.mjs — the plugin README states the facts the code enforces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readme = readFileSync(fileURLToPath(new URL('../plugins/ai-readiness/README.md', import.meta.url)), 'utf8').replace(/\s+/g, ' ');
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../plugins/ai-readiness/worca-cc-plugin.json', import.meta.url)), 'utf8'));

test('the README names the plugin API the manifest requires', () => {
  assert.equal(manifest.engines['worca-cc-api'], '>=5 <6');
  assert.match(readme, /plugin API 5/);
  assert.doesNotMatch(readme, /plugin API 4/);
});

test('a re-landing replaces same-name skills and removes none; skills land only when the plan card sent them and hold no secret', () => {
  assert.match(readme, /A re-run replaces the skills of the same name in that set and never removes the others/);
  assert.match(readme, /only the skills the plan card sent to worca, and only when the skill's folder holds no secret-looking value/);
});

test('the add-time offer depends on not-ready, a used tool and code, never on a missing profile', () => {
  assert.match(readme, /After you add a single project, worca offers to run the check once when a tool the project uses is not ready and the project has code/);
  assert.doesNotMatch(readme, /that has no profile/);
});

test('memory wording is engine-neutral and says who confirms memory commands', () => {
  assert.match(readme, /Every agent in the run can see global and project memory\. Only Map turns project notes into candidates/);
  assert.doesNotMatch(readme, /Global memory is never read/);
  assert.match(readme, /[Cc]ommands that came from worca memory run in the probe only when a person answered card A/);
  assert.match(readme, /skipped-memory/);
});
