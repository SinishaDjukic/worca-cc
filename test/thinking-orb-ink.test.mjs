// test/thinking-orb-ink.test.mjs — the orb's canvas ink is not a constant: it is
// read from the resolved body colour on every start() and on `worca:theme`, so
// the sphere is dark on light and light on dark (spec D16). jsdom has no canvas,
// so only the ink bookkeeping is observable — through the ink() hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createThinkingOrb } from '../ui/public/thinking-orb.mjs';

// jsdom resolves the body colour to 'rgb(0, 0, 0)' even with no stylesheet (and
// 'currentColor' to the same), so the resolved-colour source is STUBBED per test:
// the contract under test is "start()/worca:theme read the resolved body colour".
const boot = (color) => { const dom = new JSDOM('<!doctype html><body></body>'); const win = dom.window;
  win.getComputedStyle = () => ({ color }); return { doc: win.document, win }; };

test('default ink when nothing resolves', () => {
  const { doc, win } = boot('');
  const orb = createThinkingOrb({ doc, win });
  assert.equal(orb.ink(), '25,25,27');
  orb.stop();
});

test('start() re-reads the body colour as an r,g,b triplet', () => {
  const { doc, win } = boot('rgb(236, 236, 232)');
  const orb = createThinkingOrb({ doc, win });
  orb.start();
  assert.equal(orb.ink(), '236,236,232');
  orb.stop();
});

test('a worca:theme event re-reads the ink mid-turn; a keyword keeps the previous ink', () => {
  const ctx = boot('rgb(25, 25, 27)');
  const orb = createThinkingOrb({ doc: ctx.doc, win: ctx.win });
  orb.start();
  assert.equal(orb.ink(), '25,25,27');
  ctx.win.getComputedStyle = () => ({ color: 'rgb(236, 236, 232)' });
  ctx.doc.dispatchEvent(new ctx.win.CustomEvent('worca:theme', { detail: { mode: 'dark' } }));
  assert.equal(orb.ink(), '236,236,232');
  ctx.win.getComputedStyle = () => ({ color: 'currentcolor' });
  ctx.doc.dispatchEvent(new ctx.win.CustomEvent('worca:theme', { detail: { mode: 'light' } }));
  assert.equal(orb.ink(), '236,236,232', 'unparseable → unchanged');
  orb.stop();
});

test('an explicit ink option is the fallback, not an override', () => {
  const ctx = boot('');
  const orb = createThinkingOrb({ doc: ctx.doc, win: ctx.win, ink: '1,2,3' });
  assert.equal(orb.ink(), '1,2,3');
  ctx.win.getComputedStyle = () => ({ color: 'rgb(9, 8, 7)' });
  orb.start();
  assert.equal(orb.ink(), '9,8,7');
  orb.stop();
});
