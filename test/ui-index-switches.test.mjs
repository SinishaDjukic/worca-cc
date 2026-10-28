// F-4 / F-6: every input.sw-input announces as a switch; the toast region stays last in DOM order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const doc = new JSDOM(readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8')).window.document;

test('every input.sw-input carries role="switch"', () => {
  const bad = [...doc.querySelectorAll('input.sw-input')].filter((i) => i.getAttribute('role') !== 'switch').map((i) => i.id);
  assert.deepEqual(bad, []);
});

test('#toasts is the last element child of body before scripts', () => {
  const kids = [...doc.body.children].filter((c) => c.tagName !== 'SCRIPT');
  assert.equal(kids[kids.length - 1].id, 'toasts');
});
