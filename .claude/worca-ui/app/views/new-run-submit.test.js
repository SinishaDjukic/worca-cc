import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock lit-html since it requires DOM APIs (createTreeWalker)
vi.mock('lit-html', () => ({
  html: () => null,
  nothing: null,
}));
vi.mock('lit-html/directives/unsafe-html.js', () => ({
  unsafeHTML: () => null,
}));
vi.mock('../utils/icons.js', () => ({
  iconSvg: () => '',
  FileText: 'FileText',
}));

// Minimal DOM stub for tests
function createDocStub() {
  const elements = {};
  return {
    getElementById: vi.fn((id) => elements[id] || null),
    _set(id, value) { elements[id] = { value, id }; },
    _clear() { Object.keys(elements).forEach(k => delete elements[k]); },
  };
}

describe('submitNewRun — new format validation and payload', () => {
  let origFetch;
  let submitNewRun, resetNewRunState;
  let docStub;

  beforeEach(async () => {
    origFetch = globalThis.fetch;
    docStub = createDocStub();
    globalThis.document = docStub;

    vi.resetModules();
    // Re-apply mocks after resetModules
    vi.doMock('lit-html', () => ({ html: () => null, nothing: null }));
    vi.doMock('lit-html/directives/unsafe-html.js', () => ({ unsafeHTML: () => null }));
    vi.doMock('../utils/icons.js', () => ({ iconSvg: () => '', FileText: 'FileText' }));

    const mod = await import('./new-run.js');
    submitNewRun = mod.submitNewRun;
    resetNewRunState = mod.resetNewRunState;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  function setupDOM({ sourceValue = '', prompt = '' } = {}) {
    docStub._clear();
    if (sourceValue) docStub._set('new-run-source-value', sourceValue);
    if (prompt) docStub._set('new-run-prompt', prompt);
    docStub._set('new-run-msize', '1');
    docStub._set('new-run-mloops', '1');
  }

  function mockFetch() {
    let capturedBody;
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, pid: 123 }),
      });
    });
    return () => capturedBody;
  }

  it('rejects when no source, plan, or prompt provided', async () => {
    setupDOM();
    resetNewRunState();

    const rerender = vi.fn();
    await submitNewRun({ rerender, onStarted: vi.fn() });

    expect(rerender).toHaveBeenCalled();
    // No fetch call should have been made
    expect(globalThis.fetch).toBe(origFetch);
  });

  it('accepts prompt-only submission', async () => {
    const getBody = mockFetch();
    setupDOM({ prompt: 'Add user auth' });
    resetNewRunState({ sourceType: 'none' });

    const onStarted = vi.fn();
    await submitNewRun({ rerender: vi.fn(), onStarted });

    expect(globalThis.fetch).toHaveBeenCalled();
    const body = getBody();
    expect(body.sourceType).toBe('none');
    expect(body.prompt).toBe('Add user auth');
    expect(onStarted).toHaveBeenCalled();
  });

  it('sends sourceType and sourceValue for GitHub Issue', async () => {
    const getBody = mockFetch();
    setupDOM({ sourceValue: 'https://github.com/org/repo/issues/42' });
    resetNewRunState({ sourceType: 'source' });

    await submitNewRun({ rerender: vi.fn(), onStarted: vi.fn() });

    const body = getBody();
    expect(body.sourceType).toBe('source');
    expect(body.sourceValue).toBe('https://github.com/org/repo/issues/42');
  });

  it('sends sourceType and sourceValue for spec file', async () => {
    const getBody = mockFetch();
    setupDOM({ sourceValue: 'docs/spec.md' });
    resetNewRunState({ sourceType: 'spec' });

    await submitNewRun({ rerender: vi.fn(), onStarted: vi.fn() });

    const body = getBody();
    expect(body.sourceType).toBe('spec');
    expect(body.sourceValue).toBe('docs/spec.md');
  });

  it('sends planFile when selected', async () => {
    const getBody = mockFetch();
    setupDOM();
    resetNewRunState({ sourceType: 'none', selectedPlan: 'docs/plans/my-plan.md' });

    await submitNewRun({ rerender: vi.fn(), onStarted: vi.fn() });

    const body = getBody();
    expect(body.planFile).toBe('docs/plans/my-plan.md');
    expect(body.sourceType).toBe('none');
  });

  it('sends source + prompt together', async () => {
    const getBody = mockFetch();
    setupDOM({ sourceValue: 'gh:issue:42', prompt: 'focus on auth' });
    resetNewRunState({ sourceType: 'source' });

    await submitNewRun({ rerender: vi.fn(), onStarted: vi.fn() });

    const body = getBody();
    expect(body.sourceType).toBe('source');
    expect(body.sourceValue).toBe('gh:issue:42');
    expect(body.prompt).toBe('focus on auth');
  });

  it('rejects sourceType=source with empty sourceValue', async () => {
    setupDOM({ sourceValue: '  ' });
    resetNewRunState({ sourceType: 'source' });

    const rerender = vi.fn();
    await submitNewRun({ rerender, onStarted: vi.fn() });

    expect(rerender).toHaveBeenCalled();
    // No fetch call
    expect(globalThis.fetch).toBe(origFetch);
  });

  it('planFile-only is valid (no source, no prompt)', async () => {
    const getBody = mockFetch();
    setupDOM();
    resetNewRunState({ sourceType: 'none', selectedPlan: 'docs/plans/my-plan.md' });

    const onStarted = vi.fn();
    await submitNewRun({ rerender: vi.fn(), onStarted });

    expect(globalThis.fetch).toHaveBeenCalled();
    const body = getBody();
    expect(body.planFile).toBe('docs/plans/my-plan.md');
    expect(body.sourceValue).toBeUndefined();
    expect(body.prompt).toBeUndefined();
    expect(onStarted).toHaveBeenCalled();
  });

  it('does not include sourceValue in body when sourceType is none', async () => {
    const getBody = mockFetch();
    setupDOM({ prompt: 'test' });
    resetNewRunState({ sourceType: 'none' });

    await submitNewRun({ rerender: vi.fn(), onStarted: vi.fn() });

    const body = getBody();
    expect(body.sourceValue).toBeUndefined();
  });
});

describe('module exports', () => {
  it('exports newRunView, submitNewRun, resetNewRunState, getNewRunSubmitState', async () => {
    const mod = await import('./new-run.js');
    expect(typeof mod.newRunView).toBe('function');
    expect(typeof mod.submitNewRun).toBe('function');
    expect(typeof mod.resetNewRunState).toBe('function');
    expect(typeof mod.getNewRunSubmitState).toBe('function');
  });
});
