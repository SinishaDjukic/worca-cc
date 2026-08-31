// test/projects-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appjs = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');

test('the free-text project path field is gone', () => {
  assert.ok(!html.includes('id="projectDir"'), 'old #projectDir input still in markup');
  assert.ok(!appjs.includes("$('#projectDir')"), 'app.js still wires #projectDir');
});

test('the project selector and add-form exist in markup', () => {
  assert.ok(html.includes('id="projectSelect"'), 'missing #projectSelect');
  assert.ok(html.includes('id="add-project"'), 'missing #add-project form');
});

// Removing a project is rare and destructive, so it belongs in the Projects
// view (with the app's confirmModal) rather than one tab-stop from a picker
// used on every run — which is exactly where removing a WORKSPACE has always
// lived. Both target panes now link to their manager instead.
test('New Pipeline has no inline project-delete; it links to the Projects view', () => {
  assert.ok(!html.includes('id="project-delete"'), 'the inline delete button must be gone');
  assert.ok(!appjs.includes('projectDelete'), 'app.js must not wire an inline delete');
  assert.match(html, /id="projectHint"[^>]*>[^<]*<a href="#projects" data-nav="projects">Manage projects<\/a>/,
    'the project hint must link to the Projects view');
  // ...and the workspace pane keeps the pattern it already had.
  assert.match(html, /<a href="#workspaces" data-nav="workspaces">Manage workspaces<\/a>/);
});

test('the Projects view still owns project removal', () => {
  assert.ok(appjs.includes('async function deleteProject('), 'the Projects-view delete must survive');
  assert.ok(appjs.includes('confirmLabel: \'Remove project\''), 'it must keep the app confirm dialog');
});

test('app.js loads and uses the project registry', () => {
  assert.ok(appjs.includes("fetch('/api/projects')"), 'app.js does not GET /api/projects');
  assert.ok(appjs.includes('selectedProjectPath'), 'missing selectedProjectPath helper');
  assert.ok(appjs.includes('loadProjects'), 'missing loadProjects');
});

test('the add-project folder selector exists in markup and is wired', () => {
  assert.ok(html.includes('id="newProjectBrowse"'), 'missing #newProjectBrowse button');
  assert.ok(html.includes('id="folder-browser"'), 'missing #folder-browser modal');
  assert.ok(html.includes('id="folderList"'), 'missing #folderList');
  assert.ok(html.includes('id="folderSelect"'), 'missing #folderSelect button');
  assert.ok(appjs.includes("fetch('/api/fs/pick-folder'"), 'app.js does not call the native picker');
  assert.ok(appjs.includes('/api/fs/dirs'), 'app.js does not call the directory listing');
});

test('the Projects management view + modals exist in markup and are wired', () => {
  // nav (both sidebar + topnav reference data-nav="projects")
  assert.ok(html.includes('data-nav="projects"'), 'missing Projects nav link');
  assert.ok(html.includes('data-view="projects"'), 'missing Projects view section');
  assert.ok(html.includes('id="projects-list"'), 'missing #projects-list host');
  assert.ok(html.includes('id="project-add-btn"'), 'missing #project-add-btn');
  // reusable + add modals
  assert.ok(html.includes('id="confirm-modal"'), 'missing reusable #confirm-modal');
  assert.ok(html.includes('id="confirm-ok"'), 'missing #confirm-ok');
  assert.ok(html.includes('id="project-add-modal"'), 'missing #project-add-modal');
  assert.ok(html.includes('id="proj-add-name"'), 'missing #proj-add-name');
  // wiring in app.js
  assert.ok(appjs.includes('loadProjectsView'), 'missing loadProjectsView');
  assert.ok(appjs.includes('function confirmModal'), 'missing confirmModal helper');
  assert.ok(appjs.includes("'projects'"), 'projects not registered in VIEW_NAMES');
});

test('the projects delete button uses a bin icon and no red token', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  // isolate the .proj-del rules and assert none reference a red color token
  const proj = css.split('.proj-del').slice(1).join('.proj-del');
  assert.ok(!/--red/.test(proj.slice(0, 400)), '.proj-del must not use any --red* token');
});

// Regression: P5 (13275b47) retired the v1 composer and took the shared, unscoped
// .saved-card/.pl-item/.pl-row/.pl-main/.pl-name rules with it (re-scoped under
// .gv-saved). The Projects card reuses those class names, so it silently lost its
// layout: the bin button dropped under the path and the head no longer shared the
// rows' left edge. The view must own these rules under its own scope.
test('the projects card owns its row layout (bin button on the right, head aligned with rows)', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  // Every declaration block whose selector list is exactly `#projects-list <cls>`,
  // joined — a rule scoped elsewhere (.gv-saved .pl-row) must not satisfy this.
  const rules = (cls) => {
    const sel = `#projects-list ${cls}`.replace(/[.#]/g, '\\$&').replace(/\s+/g, '\\s+');
    return [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${sel}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
  };
  assert.match(rules('.saved-card'), /padding:\s*0\b/, 'card padding must be 0 so the head and rows share one left edge');
  assert.match(rules('.pl-row'), /display:\s*flex/, 'row must be a flex row so the bin button sits on the right');
  assert.match(rules('.pl-row'), /align-items:\s*center/, 'bin button centred on the row');
  assert.match(rules('.pl-main'), /flex:\s*1/, '.pl-main must grow to push the bin button to the right edge');
  assert.match(rules('.pl-item'), /border-bottom/, 'rows must be separated by a rule');
  assert.match(rules('.pl-name'), /font-weight:\s*600/, 'project name keeps its weight');
});
