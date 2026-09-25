// test/ui-settings-report-links.test.mjs
// Settings ▸ About: the two feedback anchors ("Report a bug" / "Suggest an
// improvement"), static in index.html and repainted from `app.bugsUrl`
// (package.json bugs.url) by about-links.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { paintAboutInto } from '../ui/public/about-links.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));

// The real Settings markup, straight out of index.html — no app.js boot needed.
// Copied verbatim from test/ui-settings-about.test.mjs:43-46. There is no
// #view-settings id; the container is `<section class="view hidden" data-view="settings">`.
const settingsView = () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  return dom.window.document.querySelector('.view[data-view="settings"]');
};

test('About carries a bug link and a suggestion link, both safe new tabs', () => {
  const about = settingsView().querySelector('#about-card');
  for (const [id, label] of [['aboutBugLink', 'Report a bug'],
                             ['aboutIdeaLink', 'Suggest an improvement']]) {
    const link = about.querySelector(`#${id}`);
    assert.ok(link, `${label} row exists`);
    assert.equal(link.tagName, 'A', 'an anchor, never a button (the About card allows no controls)');
    assert.equal(link.getAttribute('target'), '_blank', `${label} opens in a new tab`);
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer', `${label} opens it safely`);
    assert.equal(link.textContent.trim(), label, `${label} is labelled`);
  }
});

test('the existing About invariants still hold with the new rows', () => {
  const view = settingsView();
  const cards = [...view.querySelectorAll('section.card.settings-card')];
  assert.equal(cards.length, 13, 'Appearance, Interface mode, the nine cards (Scheduled runs and Workspaces included), Getting started, then About');
  const about = cards[cards.length - 1];
  assert.equal(about.id, 'about-card', 'About is still last');
  assert.equal(about.querySelector('input, select, textarea, button'), null, 'still no controls');
  assert.equal(about.querySelector('.hint'), null, 'still no status line');
  assert.ok(!/\d+\.\d+\.\d+/.test(about.textContent), 'still no version string in the markup');
  assert.equal(view.querySelectorAll('button.info-tip').length, 18, 'still no new ⓘ icon (18 = 14 + Interface mode + Scheduled runs + Workspaces)');
  for (const hint of view.querySelectorAll('.hint')) {
    assert.equal(hint.textContent.trim(), '', 'every settings hint stays empty-texted');
  }
});

test('paintAboutInto points both links at bugs.url from the settings payload', () => {
  const view = settingsView();
  paintAboutInto(view, { version: '1.2.0', repoUrl: 'https://github.com/x/y',
                         bugsUrl: 'https://github.com/x/y/issues' });
  assert.equal(view.querySelector('#aboutBugLink').getAttribute('href'),
    'https://github.com/x/y/issues/new?labels=bug', 'the bug link targets the bug label');
  assert.equal(view.querySelector('#aboutIdeaLink').getAttribute('href'),
    'https://github.com/x/y/issues/new?labels=enhancement', 'the idea link targets the enhancement label');
});

test('a trailing slash does not produce a doubled slash', () => {
  const view = settingsView();
  paintAboutInto(view, { bugsUrl: 'https://github.com/x/y/issues/' });
  assert.equal(view.querySelector('#aboutBugLink').getAttribute('href'),
    'https://github.com/x/y/issues/new?labels=bug', 'no doubled slash');
});

test('a missing bugsUrl leaves the static markup href alone', () => {
  // A FRESH view per case: reusing the one the previous test repainted would assert
  // against a value paintAboutInto had already written, which proves nothing about
  // the static fallback.
  const view = settingsView();
  const before = view.querySelector('#aboutBugLink').getAttribute('href');
  assert.match(before, /\/issues\/new\?labels=bug$/,
    'the markup ships a usable href before /api/settings lands');
  for (const info of [{}, { bugsUrl: '' }, { bugsUrl: 42 }, undefined]) {
    paintAboutInto(view, info);
    assert.equal(view.querySelector('#aboutBugLink').getAttribute('href'), before,
      `${JSON.stringify(info)} must not blank the link`);
  }
});
