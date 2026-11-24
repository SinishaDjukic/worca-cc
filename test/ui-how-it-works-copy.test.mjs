// The "How it works" explainer copy and the area registry (static data, no DOM):
// coverage of every sidebar area, length rules, tour ids, samples, label pins and routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GUIDE_AREA_IDS } from '../src/shared/how-it-works/areas.mjs';
import { GETTING_STARTED_STEPS } from '../ui/public/getting-started.mjs';
import { AREA_GUIDES, guideFor, areaOfRoute } from '../ui/public/how-it-works/area-guides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const GUIDE_FILES = [
  'ui/public/how-it-works/guides/work.mjs',
  'ui/public/how-it-works/guides/build.mjs',
  'ui/public/how-it-works/guides/manage.mjs',
];
const RUNS_SUB_ROUTES = ['running', 'history', 'feature', 'group'];
const EXPECTED_TOURS = {
  chat: 'ask', new: 'run', 'team-metrics': 'teamMetrics', workflows: 'workflows',
  projects: 'project', 'team-policy': 'teamPolicy', workspaces: 'workspace',
};
const newIds = GUIDE_AREA_IDS.filter((id) => id !== 'workspaces');

const screenText = (step) => [
  step.title, ...step.paras,
  ...(step.art && step.art.kind === 'sample' ? [step.art.caption, ...step.art.items] : []),
].join(' ');
const guideText = (g) => g.steps.map(screenText).join(' ');
// A label found only in a comment is not a control: drop HTML comments, block comments, whole-line and trailing // comments.
const withoutComments = (src) => src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

test('every sidebar area (plus new and settings) has a guide', () => {
  const sidebar = read('ui/public/shell/sidebar.html');
  const navIds = [...sidebar.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]);
  const fromPage = new Set([...navIds.filter((id) => !RUNS_SUB_ROUTES.includes(id)), 'new', 'settings']);
  assert.deepEqual([...fromPage].sort(), [...GUIDE_AREA_IDS].sort());
  for (const id of GUIDE_AREA_IDS) assert.ok(guideFor(id), `guide for ${id}`);
  assert.equal(guideFor('nope'), null);
});

test('new guides respect the length rules', () => {
  for (const id of newIds) {
    const g = guideFor(id);
    assert.ok(g.title.length > 0, `${id} title`);
    assert.ok(g.steps.length >= 3 && g.steps.length <= 5, `${id} steps`);
    for (const s of g.steps) {
      assert.ok(s.paras.length >= 1 && s.paras.length <= 3, `${id}/${s.id} paras`);
      assert.ok(words(screenText(s)) <= 100, `${id}/${s.id} has ${words(screenText(s))} words`);
    }
    assert.equal(new Set(g.steps.map((s) => s.id)).size, g.steps.length, `${id} unique step ids`);
  }
});

test('tours are null or a Getting started step, and match the agreed map', () => {
  const stepIds = new Set(GETTING_STARTED_STEPS.map((s) => s.id));
  const actual = {};
  for (const id of GUIDE_AREA_IDS) {
    const { tour } = guideFor(id);
    if (tour === null) continue;
    assert.ok(stepIds.has(tour), `${id} tour ${tour}`);
    actual[id] = tour;
  }
  assert.deepEqual(actual, EXPECTED_TOURS);
});

test('samples are labelled as made up and hold 2 to 5 items', () => {
  for (const id of newIds) {
    for (const s of guideFor(id).steps) {
      if (!s.art) continue;
      assert.equal(s.art.kind, 'sample');
      assert.match(s.art.caption, /made-up/i);
      assert.ok(s.art.items.length >= 2 && s.art.items.length <= 5, `${id}/${s.id} items`);
    }
  }
});

test('guide files import nothing', () => {
  for (const f of GUIDE_FILES) assert.doesNotMatch(read(f), /^\s*import[\s{(]/m, f);
});

test('every named control appears in its source file and in the guide copy', () => {
  for (const id of newIds) {
    const g = guideFor(id);
    const text = guideText(g);
    for (const c of g.controls) {
      const needle = c.find ?? c.label;
      assert.ok(withoutComments(read(c.file)).includes(needle), `${id}: "${needle}" missing from ${c.file} outside comments`);
      assert.ok(text.includes(c.label), `${id}: "${c.label}" missing from the copy`);
    }
  }
});

test('the top-bar button CSS targets stable classes, never the title the controller rewrites', () => {
  const css = read('ui/public/how-it-works/how-it-works.css');
  assert.doesNotMatch(css, /\[title=/);
  assert.match(css, /\.topnav-howto[^{]*\{[^}]*position:relative/);
  assert.match(css, /@media \(max-width:760px\)\s*\{\s*\.topnav-howto\{/);
});

test('copy never names Stillhet-only areas', () => {
  for (const id of newIds) assert.doesNotMatch(guideText(guideFor(id)), /\b(Insights|Tasks)\b/, id);
});

test('workspaces reuses the existing walkthrough', () => {
  const g = guideFor('workspaces');
  assert.equal(g.tour, 'workspace');
  assert.equal(g.title, 'How workspaces work');
  assert.deepEqual(g.controls, []);
  assert.equal(AREA_GUIDES.workspaces, g);
});

test('areaOfRoute maps routes to areas', () => {
  for (const r of RUNS_SUB_ROUTES) assert.equal(areaOfRoute(r), 'runs');
  for (const id of GUIDE_AREA_IDS) assert.equal(areaOfRoute(id), id);
  for (const r of ['getting-started', 'profile', 'workspace-create', 'unknown']) assert.equal(areaOfRoute(r), null);
});

test('the guides are frozen', () => {
  assert.ok(Object.isFrozen(AREA_GUIDES));
  assert.ok(Object.isFrozen(guideFor('chat')));
  assert.ok(Object.isFrozen(guideFor('chat').steps[0].paras));
});
