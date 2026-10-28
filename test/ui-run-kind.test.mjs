// test/ui-run-kind.test.mjs — Projects, any way (P1b): how a run worked, and the kind chips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { workModeOf, isGitRun, isFolderRun, isNoProjectRun, projectKind, kindChip, KIND_LABELS, RUN_KIND_CHIP } from '../ui/public/run-kind.mjs';

test('workModeOf: the run, its saved state or its branch record names the mode; anything else is a git run', () => {
  assert.equal(workModeOf({ workMode: 'folder' }), 'folder');
  assert.equal(workModeOf({ workMode: 'none' }), 'none');
  assert.equal(workModeOf({ state: { workMode: 'folder' } }), 'folder', 'a History detail payload');
  assert.equal(workModeOf({ branch: { workMode: 'folder' } }), 'folder', 'a live run model: state.branch mirrors it');
  assert.equal(workModeOf({ workMode: 'git', state: { workMode: 'folder' } }), 'git', 'the record itself wins');
  for (const x of [null, undefined, {}, { workMode: 'svn' }, { branch: 'worca-cc/x-1a2b3c4d' }, { state: null }]) {
    assert.equal(workModeOf(x), 'git', JSON.stringify(x));
  }
  assert.deepEqual([isGitRun({}), isGitRun({ workMode: 'folder' }), isGitRun({ workMode: 'none' })], [true, false, false]);
  assert.deepEqual([isFolderRun({ workMode: 'folder' }), isFolderRun({ workMode: 'none' }), isFolderRun({})], [true, false, false]);
  assert.deepEqual([isNoProjectRun({ workMode: 'none' }), isNoProjectRun({ state: { workMode: 'none' } }), isNoProjectRun({ projectKey: 'no-project-00000000' }), isNoProjectRun({ workMode: 'folder' }), isNoProjectRun({}), isNoProjectRun(null)], [true, true, true, false, false, false]);
});

test('projectKind reads the registry row: vcs none is a Folder project, git a Git one, anything else nothing', () => {
  assert.equal(projectKind({ vcs: 'none' }), 'folder');
  assert.equal(projectKind({ vcs: 'git' }), 'git');
  for (const x of [null, {}, { vcs: null }, { vcs: 'hg' }]) assert.equal(projectKind(x), '');
});

test('kindChip: one chip per kind with the canvas words; nothing for an unknown kind', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  assert.deepEqual(KIND_LABELS, { git: 'Git', folder: 'Folder', none: 'No project', ws: 'Workspace' });
  assert.deepEqual(RUN_KIND_CHIP, { folder: 'folder', none: 'none' });
  const c = kindChip(doc, 'folder');
  assert.equal(c.tagName, 'SPAN');
  assert.equal(c.className, 'kind-chip kind-folder');
  assert.equal(c.dataset.kind, 'folder');
  assert.equal(c.textContent, 'Folder');
  assert.deepEqual(['git', 'none', 'ws'].map((k) => [kindChip(doc, k).className, kindChip(doc, k).textContent]),
    [['kind-chip kind-git', 'Git'], ['kind-chip kind-none', 'No project'], ['kind-chip kind-ws', 'Workspace']]);
  assert.equal(kindChip(doc, ''), null);
  assert.equal(kindChip(doc, 'team'), null);
});

test('kind chip CSS: modifiers scoped to .kind-chip, readable tokens in both themes', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /--teal-ink-strong:light-dark\(#1F6B63,#9FE0D8\)/);
  // Runs redesign (D13): corners and type come from the one grouped chip rule; the own rule sets neither.
  // The design-system feature put the 18px height first in that rule; corners and type still come only from it.
  assert.match(css, /^:is\(\.badge,[^{]*\.kind-chip[^{]*\)\{[^}]*border-radius:var\(--r-xs\);font:500 11px\/1 var\(--sans\);/m);
  assert.doesNotMatch(css, /(^|[^-\w])\.kind-chip\{[^}]*(font|border-radius|letter-spacing):/m);
  assert.match(css, /\.kind-chip\.kind-git\{background:var\(--blue-bg\);color:var\(--blue-ink-strong\);\}/);
  assert.match(css, /\.kind-chip\.kind-folder\{background:var\(--teal-bg\);color:var\(--teal-ink-strong\);\}/);
  assert.match(css, /\.kind-chip\.kind-none\{background:var\(--slate-bg\);color:var\(--slate-ink\);\}/);
  assert.match(css, /\.kind-chip\.kind-ws\{background:var\(--slate-bg\);color:var\(--slate-ink\);\}/);
  assert.doesNotMatch(css, /(^|[^.\w-])\.kind-(git|folder|none|ws)\{/m, 'no bare modifier rule');
});

test('the run page head has no kind chip link rules; the shared chip rules stay', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.rd-title-row a\.kind-chip/);
  assert.match(css, /^\.kind-chip\{display:inline-flex;align-items:center;height:18px;/m);
  assert.match(css, /^\.rd-title-row\{display:flex;align-items:center;gap:8px;min-width:0;\}/m);
});
