// test/ui-id-consistency.test.mjs — every #id app.js looks up by a literal exists in index.html
// or a <template> (or is created at runtime, listed below with its creator). Replaces
// ui-workspace-selectors' per-feature drift guard (suite reduction 2026-10-04, lanes/L2.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
// getElementById('x'), and a selector that starts with #x in querySelector(All), $(), $$() or closest().
const LOOKUP = /getElementById\(\s*['"]([\w-]+)['"]\s*\)|(?:querySelector(?:All)?|\$\$?|closest)\(\s*['"`]#([\w-]+)/g;
// ...and the ids reached through a name map (`const WIZ_MODEL_IDS = { scanModel: 'wiz-scan-model', … }`,
// then getElementById(map[key])): the dropped ui-workspace-selectors test pinned four of them.
const MAPPED = [...app.matchAll(/const [A-Z_]+_IDS = \{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/:\s*'([\w-]+)'/g)].map((x) => x[1]));
const ids = [...new Set([...[...app.matchAll(LOOKUP)].map((m) => m[1] ?? m[2]), ...MAPPED])].sort();
const { document } = new JSDOM(readIndexHtml()).window;
const roots = [document, ...[...document.querySelectorAll('template')].map((t) => t.content)];
const exists = (id) => roots.some((r) => r.querySelector(`[id="${id}"]`));
// id -> its creator in app.js (the creator's code must still be there).
const RUNTIME = new Map([
  ['pd-tab-team', /btn\.id = `\$\{idPrefix\}-tab-\$\{t\.key\}`/],   // initDetailTabs, idPrefix 'pd' (initPdTabs) + PD_TABS key 'team'
]);

test('every id app.js looks up by literal exists in index.html or a <template> (or is listed as runtime-created)', () => {
  assert.ok(ids.length > 300, `found ${ids.length} literal id lookups in app.js (lookup pattern wrong?)`);
  assert.ok(MAPPED.length >= 8, `found ${MAPPED.length} ids in *_IDS name maps (map pattern wrong?)`);
  assert.deepEqual(ids.filter((id) => !exists(id) && !RUNTIME.has(id)), [], 'looked up, but neither in the page nor created at runtime');
  assert.deepEqual([...RUNTIME].filter(([id, creator]) => exists(id) || !ids.includes(id) || !creator.test(app)).map(([id]) => id), [],
    'a RUNTIME entry that is now in the page, no longer looked up, or whose creator is gone');
});
