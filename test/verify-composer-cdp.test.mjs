// The composer proof must never read or write the developer's real settings: HOME and USERPROFILE point at its temp
// home before ui/server.mjs is imported, and Chrome gets the real HOME back (as tools/verify-theme-cdp.mjs does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = () => readFileSync(new URL('../tools/verify-composer-cdp.mjs', import.meta.url), 'utf8');

test('the proof sandboxes HOME and USERPROFILE to its temp home', () => {
  const s = src();
  assert.match(s, /process\.env\.HOME = home/);
  assert.match(s, /process\.env\.USERPROFILE = home/);
});

test('the sandbox is set before the server import', () => {
  const s = src();
  const set = s.search(/process\.env\.HOME = home/);
  const imp = s.indexOf("import(new URL('../ui/server.mjs'");
  assert.ok(imp > 0, 'the server import is there');
  assert.ok(set >= 0 && set < imp, 'HOME is assigned before the server import');
});

test('Chrome gets the real HOME back', () => {
  const s = src();
  assert.match(s, /REAL_ENV/);
  assert.match(s, /env: \{ \.\.\.process\.env, \.\.\.REAL_ENV \}/);
});
