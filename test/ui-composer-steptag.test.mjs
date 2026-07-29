import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'), 'utf8');

function ruleBody(selector) {
  const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

test('.col .col-tag is left-anchored to the card edge, not centered', () => {
  const body = ruleBody('.col .col-tag');
  assert.ok(body, '.col .col-tag rule must exist');

  assert.ok(!/left:\s*50%/.test(body), 'col-tag must not use left:50%');
  assert.ok(!/translate\(\s*-50%/.test(body), 'col-tag must not translate X by -50%');

  assert.match(body, /left:\s*10px/, 'col-tag should anchor at left:10px (the .col left padding)');

  assert.match(body, /transform:\s*translateY\(\s*-100%\s*\)/, 'col-tag should keep translateY(-100%)');

  assert.match(body, /position:\s*absolute/);
  assert.match(body, /white-space:\s*nowrap/);
});
