// test/ui-project-git.test.mjs — Use git / Link remote: which action a project offers, and the dialog's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitActionFor, GIT_DIALOG, gitDoneMessage } from '../ui/public/project-git.mjs';

test('gitActionFor: init for a Folder project, link for a Git project whose loaded block has no remote, else null', () => {
  const folder = { key: 'k1', exists: true, vcs: 'none' };
  const gitp = { key: 'k2', exists: true, vcs: 'git' };
  assert.equal(gitActionFor(folder, undefined, false), 'init');
  assert.equal(gitActionFor(gitp, { remote: null }, true), 'link');
  assert.equal(gitActionFor(gitp, { remote: null }, false), null, 'chips not loaded yet');
  assert.equal(gitActionFor(gitp, undefined, true), null, 'no block (a refresh is in flight)');
  assert.equal(gitActionFor(gitp, { remote: 'origin' }, true), null);
  assert.equal(gitActionFor({ ...folder, exists: false }, undefined, true), null, 'a missing folder');
  assert.equal(gitActionFor({ ...folder, key: '' }, undefined, true), null, 'a keyless row has no page');
});

test('dialog words and the success line', () => {
  assert.equal(GIT_DIALOG.init.button, 'Use git');
  assert.equal(GIT_DIALOG.link.button, 'Link remote');
  assert.equal(GIT_DIALOG.init.optional, true);
  assert.equal(GIT_DIALOG.link.optional, false);
  assert.equal(gitDoneMessage('init', 'notes', null), '“notes” now uses git.');
  assert.equal(gitDoneMessage('init', 'notes', 'git@github.com:me/notes.git'), '“notes” now uses git, linked to git@github.com:me/notes.git.');
  assert.equal(gitDoneMessage('link', 'api', 'https://github.com/me/api'), 'Linked “api” to https://github.com/me/api.');
});
