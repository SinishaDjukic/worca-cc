import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderReadinessChip, readinessAddedToast } from '../ui/public/readiness-chip.mjs';

describe('renderReadinessChip', () => {
  it('returns null for null/undefined summary', () => {
    assert.strictEqual(renderReadinessChip(null), null);
    assert.strictEqual(renderReadinessChip(undefined), null);
  });

  it('returns null for unknown level', () => {
    const summary = { level: 'unknown', primaryEngine: 'claude', failingCount: 0 };
    assert.strictEqual(renderReadinessChip(summary), null);
  });

  it('renders a chip for ready level', () => {
    const summary = { level: 'ready', primaryEngine: 'claude', failingCount: 0 };
    const dom = new JSDOM();
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(chip);
    assert.strictEqual(chip.tagName, 'SPAN');
    assert.ok(chip.className.includes('pl-rd'));
    assert.ok(chip.className.includes('rd-ready'));
    assert.ok(chip.textContent.includes('Agent-ready'));
  });

  it('renders a chip for partial level with failing count', () => {
    const summary = { level: 'partial', primaryEngine: 'codex', failingCount: 2 };
    const dom = new JSDOM();
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(chip.className.includes('rd-partial'));
    assert.ok(chip.textContent.includes('Partly ready'));
    assert.ok(chip.textContent.includes('2'));
  });

  it('renders a chip for not-ready level', () => {
    const summary = { level: 'not-ready', primaryEngine: 'copilot', failingCount: 5 };
    const dom = new JSDOM();
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(chip.className.includes('rd-not-ready'));
    assert.ok(chip.textContent.includes('Not agent-ready'));
  });

  it('includes a dot element', () => {
    const summary = { level: 'ready', primaryEngine: 'claude', failingCount: 0 };
    const dom = new JSDOM();
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(chip.querySelector('.rd-dot'));
  });

  it('sets title with engine name', () => {
    const summary = { level: 'ready', primaryEngine: 'cursor', failingCount: 0 };
    const dom = new JSDOM();
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(chip.title.includes('cursor'));
  });

  it('uses textContent not innerHTML (XSS safe)', () => {
    const summary = {
      level: 'partial',
      primaryEngine: '<script>alert("xss")</script>',
      failingCount: 1,
    };
    const dom = new JSDOM();
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(!chip.innerHTML.includes('<script>'));
  });

  it('accepts custom doc for testing', () => {
    const dom = new JSDOM();
    const summary = { level: 'ready', primaryEngine: 'claude', failingCount: 0 };
    const chip = renderReadinessChip(summary, { doc: dom.window.document });

    assert.ok(chip instanceof dom.window.HTMLElement);
  });
});

describe('readinessAddedToast', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  const msg = { type: 'readiness-added', projectKey: 'proj-1', name: 'Proj', engine: 'codex' };

  it('builds a warn toast naming the project and engine, with a "See what to add" action', () => {
    const run = () => {};
    const o = readinessAddedToast(msg, { storage: memory(), run });
    assert.strictEqual(o.tone, 'warn');
    assert.strictEqual(o.title, 'Proj is missing agent instructions for codex');
    assert.strictEqual(o.key, 'readiness-proj-1');
    assert.strictEqual(o.action.label, 'See what to add');
    assert.strictEqual(o.action.run, run);
  });

  it('fires once per project: the second frame for the same key is null', () => {
    const storage = memory();
    assert.ok(readinessAddedToast(msg, { storage, run() {} }));
    assert.strictEqual(readinessAddedToast(msg, { storage, run() {} }), null);
    assert.ok(readinessAddedToast({ ...msg, projectKey: 'proj-2' }, { storage, run() {} }));
  });

  it('is null for a frame without a project key and survives a broken storage', () => {
    assert.strictEqual(readinessAddedToast({ type: 'readiness-added' }, { storage: memory(), run() {} }), null);
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.ok(readinessAddedToast(msg, { storage: broken, run() {} }));
  });
});
