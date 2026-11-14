// test/rail-default.test.mjs — a feature with no design lands on Rail's default (docs/rail/build.md › build.default):
// what it is picks the pattern (build.md's Which pattern table, the catalog's featureKinds, kept equal here), "A place"
// is a pattern of catalog parts and real rules, and a thing's page starts with a PlaceHead while a task's keeps its line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const cat = JSON.parse(read('docs/design-system-catalog.json'));
const pattern = (name) => cat.patterns.find((p) => p.name === name);
const ruleIds = readdirSync(join(ROOT, 'docs/rail')).filter((f) => f.endsWith('.md'))
  .flatMap((f) => [...read(`docs/rail/${f}`).matchAll(/^\| `([a-z-]+\.[a-z-]+)` \| (.+?) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({ id: m[1], what: m[2] })));
const build = read('docs/rail/build.md');

test('featureKinds has the six rows and each names a real pattern', () => {
  const k = cat.featureKinds; const names = new Set(cat.patterns.map((p) => p.name));
  assert.equal(k.length, 6);
  assert.deepEqual(k.map((r) => r.pattern), ['A place', 'A list', 'A settings tab', 'A conversation', 'A form', null]);
  for (const r of k) {
    assert.ok(r.is && Array.isArray(r.examples) && (r.examples.length || r.pattern === null), `${r.pattern}: is and examples`);
    for (const p of [r.pattern, r.opens]) if (p) assert.ok(names.has(p), `${p} is not a pattern`);
  }
  assert.match(k[5].then, /build\.teach/);
  assert.equal(k[1].where, 'the bar'); assert.equal(k[1].opens, "A thing's page"); assert.match(k[1].except, /A task's page/);
  assert.ok(['schedules', 'features'].every((x) => k[1].examples.includes(x)), 'A list: schedules and features');
  assert.match(k[3].where, /Chat's composer/); assert.match(k[3].where, /IntentChip/); assert.match(k[3].where, /never a new page/);
});

test("build.md's table and featureKinds list the same rows", () => {
  const at = build.indexOf('| The feature is… | Pattern |'); assert.ok(at >= 0, 'the Which pattern table');
  const rows = build.slice(at).split('\n').slice(2).filter((l) => l.startsWith('|')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.equal(rows.length, cat.featureKinds.length);
  cat.featureKinds.forEach((k, i) => {
    assert.ok(rows[i][0].startsWith(k.is), `row ${i + 1}: "${rows[i][0]}" does not start with "${k.is}"`);
    assert.ok(rows[i][1].includes(k.pattern ?? 'a question for a person'), `row ${i + 1}: "${rows[i][1]}" does not name ${k.pattern}`);
  });
});

test('build.default is a rule and howToBuild step 1 points at the table', () => {
  const r = ruleIds.find((x) => x.id === 'build.default'); assert.ok(r, 'build.default is a rule');
  assert.match(r.what, /the table below/); assert.match(r.what, /comp\.one-per-need/);
  assert.match(cat.howToBuild[0], /featureKinds/); assert.match(cat.howToBuild[0], /build\.default/);
  assert.match(cat.howToBuild[1], /question for a person/); assert.match(cat.howToBuild[1], /build\.teach/);
});

test('A place has its bar, home, way page, item page and states, from catalog parts and real rules', () => {
  const p = pattern('A place'); assert.ok(p, 'the pattern A place');
  assert.ok(existsSync(join(ROOT, p.example)), `${p.example} is missing`);
  for (const part of ['bar:', 'home:', 'way page:', 'item page:', 'states:']) assert.ok(p.slots.some((s) => s.startsWith(part)), `no ${part} slot`);
  const known = new Set([...cat.components, ...cat.logic].map((e) => e.name));
  for (const u of p.uses) assert.ok(known.has(u), `${u} is not a component or logic`);
  for (const u of ['PlaceHead', 'PluginCard', 'CenterShelf', 'SettingsSection', 'SettingsRow', 'EmptyState', 'NotFound', 'SentencePicker', "A list page's behaviour"]) assert.ok(p.uses.includes(u), `A place uses ${u}`);
  const ids = new Set(ruleIds.map((r) => r.id));
  for (const id of p.rules) assert.ok(ids.has(id), `${id} is not a rule`);
  for (const id of ['panel.place-head', 'nav.center-home', 'list.bar-model', 'list.ways-in', 'panel.plugin-card']) assert.ok(p.rules.includes(id), `A place follows ${id}`);
  const states = p.slots.find((s) => s.startsWith('states:'));
  for (const s of ['empty', 'loading', 'could not load', 'not found', '375px']) assert.ok(states.includes(s), `states: ${s}`);
});

test("A thing's page starts with a PlaceHead; only A task's page keeps StatusLine, Figures and Tabs", () => {
  const thing = pattern("A thing's page"); const task = pattern("A task's page");
  assert.match(thing.slots[1], /PlaceHead/);
  for (const s of thing.slots) assert.doesNotMatch(s, /StatusLine|Tabs/);
  assert.doesNotMatch(thing.for, /\brun\b/);
  for (const part of ['StatusLine', 'Figures', 'Tabs']) assert.ok(task.slots.some((s) => s.includes(part)), `A task's page holds ${part}`);
  assert.match(task.for, /\brun\b/); assert.match(task.for, /\bgroup\b/);
  const doc = read('docs/rail/thing-page.md');
  assert.match(doc, /A task's page/); assert.match(doc, /panel\.place-head/);
  assert.match(ruleIds.find((r) => r.id === 'thing.slots').what, /^A task's page:/);
});
