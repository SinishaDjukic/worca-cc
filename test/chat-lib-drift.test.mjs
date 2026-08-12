// test/chat-lib-drift.test.mjs — the chat plugins vendor lib/ byte-identically
// (plugins are self-contained; there is no shared package). This test holds
// the copies together mechanically: every examples/plugins/*/lib file that
// exists in more than one chat plugin must hash identically. Edit the canon
// (telegram-chat/lib) and re-copy; never patch one plugin's copy in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGINS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'plugins');

test('vendored lib/ copies are byte-identical across chat plugins', () => {
  const withLib = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PLUGINS_DIR, d.name, 'lib')))
    .map((d) => d.name);
  assert.ok(withLib.includes('telegram-chat'), 'the canon plugin must exist');

  const hashes = new Map(); // file -> Map(hash -> [plugins])
  for (const plugin of withLib) {
    for (const f of readdirSync(join(PLUGINS_DIR, plugin, 'lib')).filter((x) => x.endsWith('.mjs'))) {
      const digest = createHash('sha256').update(readFileSync(join(PLUGINS_DIR, plugin, 'lib', f))).digest('hex');
      if (!hashes.has(f)) hashes.set(f, new Map());
      const byHash = hashes.get(f);
      if (!byHash.has(digest)) byHash.set(digest, []);
      byHash.get(digest).push(plugin);
    }
  }
  const drifted = [...hashes.entries()].filter(([, byHash]) => byHash.size > 1);
  assert.deepEqual(
    drifted.map(([f, byHash]) => `${f}: ${[...byHash.values()].map((p) => p.join('+')).join(' vs ')}`),
    [],
    'lib/ drift detected — recopy from telegram-chat/lib',
  );
});
