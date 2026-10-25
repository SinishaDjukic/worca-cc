// test/nav-crumbs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { trailFor, paintTrail, onCrumbs } from '../ui/public/nav/crumbs.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const feature = { view: 'feature', id: 'f-7c21', title: 'Chat sidebar aligned with Runs' };
const savedRun = { view: 'history', projectKey: 'worka-cc', id: 'p1', tab: 'summary' };

test('trail: a grouped run ends at its group; a lone run and a group page at Runs; the page itself is never in it', () => {
  assert.deepEqual(trailFor(savedRun, { parent: feature }), [
    { label: 'Runs', href: '#runs', view: 'runs' },
    { label: 'Chat sidebar aligned with Runs', href: '#feature/f-7c21', view: 'feature' },
  ]);
  assert.deepEqual(trailFor({ view: 'running', id: 'r1', tab: 'diff' }, {}), [{ label: 'Runs', href: '#runs', view: 'runs' }]);
  assert.deepEqual(trailFor({ view: 'feature', id: 'f-7c21', tab: 'runs' }), [{ label: 'Runs', href: '#runs', view: 'runs' }]);
  assert.deepEqual(trailFor({ view: 'runs' }), []);
  assert.deepEqual(trailFor({ view: 'settings' }), []);
});

test('trail: a parent with no title yet never paints "Runs › Runs"', () => {
  assert.deepEqual(trailFor({ view: 'running', id: 'r1', tab: 'summary' }, { parent: { ...feature, title: '' } }),
    [{ label: 'Runs', href: '#runs', view: 'runs' }]);
});

test('paint: a list of links with hidden separators, plus one up link to the parent; idempotent', () => {
  const d = doc();
  const nav = d.createElement('nav');
  const trail = trailFor(savedRun, { parent: feature });
  paintTrail(nav, trail);
  assert.equal(nav.hidden, false);
  assert.deepEqual([...nav.querySelectorAll('.nav-trail a')].map((a) => [a.textContent, a.getAttribute('href'), a.dataset.crumb]),
    [['Runs', '#runs', 'runs'], ['Chat sidebar aligned with Runs', '#feature/f-7c21', 'feature']]);
  assert.equal(nav.querySelectorAll('.nav-crumb-sep[aria-hidden="true"]').length, 1);
  assert.equal(nav.querySelector('[aria-current]'), null);
  const up = nav.querySelector('a.nav-up');
  assert.equal(up.textContent, 'Chat sidebar aligned with Runs');
  assert.equal(up.querySelector('.nav-up-label').textContent, up.textContent, 'the label ellipsizes in its own box');
  assert.equal(up.getAttribute('href'), '#feature/f-7c21');
  assert.equal(up.dataset.crumb, 'feature');
  assert.ok(up.querySelector('svg'));
  const first = nav.firstChild;
  paintTrail(nav, trail);
  assert.equal(nav.firstChild, first);           // same signature: no repaint
  paintTrail(nav, []);
  assert.equal(nav.hidden, true);
});

test('onCrumbs: a plain left click on a crumb whose view has a handler runs it; modified clicks and other views do not', () => {
  const d = doc();
  const nav = d.createElement('nav');
  d.body.append(nav);
  paintTrail(nav, trailFor(savedRun, { parent: feature }));
  const seen = [];
  onCrumbs(nav, { runs: () => seen.push('runs') });
  const W = d.defaultView;
  const click = (a, o = {}) => a.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...o }));
  assert.equal(click(nav.querySelector('.nav-trail a[data-crumb="runs"]')), false);   // handled: default prevented
  click(nav.querySelector('.nav-trail a[data-crumb="runs"]'), { metaKey: true });       // new-tab click keeps the default
  assert.equal(click(nav.querySelector('.nav-trail a[data-crumb="feature"]')), true);  // no handler: a plain push
  click(nav.querySelector('a.nav-up'));                                                 // the up link is a feature crumb too
  assert.deepEqual(seen, ['runs']);
});
