import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'),
  'utf8',
);

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchor on a non-word char (or start) before the selector so we don't accidentally
  // match a longer selector that ends with the same suffix.
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

test('the agent row\'s .select-wrap is wide enough to show long model + effort values', () => {
  // The controls moved from the always-open .stage-cfg card into the accordion
  // row body (newpipeline-ux-design.md §4.7); the width guarantee travels with them.
  const body = ruleBody('.agent-row-body .select-wrap');
  assert.ok(body, '.agent-row-body .select-wrap rule must exist');
  assert.match(body, /width:\s*180px/, 'selector wrap should be 180px so long model IDs fit');
});
