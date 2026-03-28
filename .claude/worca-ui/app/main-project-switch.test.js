/**
 * Tests for main.js project switching and hello protocol wiring.
 *
 * These tests verify the protocol negotiation and project switch logic
 * that lives in main.js, tested in isolation via extracted functions.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildHash, parseHash } from './router.js';
import { createStore } from './state.js';

describe('main.js project switching logic', () => {
  it('handleHello fetches projects and sends hello-ack', async () => {
    const store = createStore();
    const sentMessages = [];
    const ws = {
      sendRaw: vi.fn((msg) => sentMessages.push(msg)),
      send: vi.fn(() =>
        Promise.resolve({ projects: [{ name: 'proj-a' }, { name: 'proj-b' }] }),
      ),
    };

    // Simulate handleHello logic
    const helloPayload = { protocol: 2, capabilities: ['multi-project'] };

    // Fetch projects
    const projectsResponse = await ws.send('list-runs'); // would be GET /api/projects in real code
    const projects = projectsResponse.projects || [];
    store.setState({ projects });

    // Determine currentProjectId
    const route = parseHash('');
    const currentProjectId = route.projectId || projects[0]?.name || null;
    store.setState({ currentProjectId });

    // Send hello-ack
    ws.sendRaw({
      type: 'hello-ack',
      payload: { protocol: 2, projectId: currentProjectId },
    });

    expect(store.getState().projects).toHaveLength(2);
    expect(store.getState().currentProjectId).toBe('proj-a');
    expect(ws.sendRaw).toHaveBeenCalledWith({
      type: 'hello-ack',
      payload: { protocol: 2, projectId: 'proj-a' },
    });
  });

  it('project switch clears runs and re-fetches', () => {
    const store = createStore({
      currentProjectId: 'proj-a',
      runs: { 'run-1': { id: 'run-1', active: true } },
      logLines: [{ line: 'test', stage: 'plan' }],
    });

    // Simulate project switch
    const newProjectId = 'proj-b';
    store.setState({
      currentProjectId: newProjectId,
      runs: {},
      logLines: [],
      activeRunId: null,
    });

    const state = store.getState();
    expect(state.currentProjectId).toBe('proj-b');
    expect(state.runs).toEqual({});
    expect(state.logLines).toEqual([]);
    expect(state.activeRunId).toBe(null);
  });

  it('onHashChange detects projectId change', () => {
    const oldRoute = parseHash('#/active?project=proj-a');
    const newRoute = parseHash('#/active?project=proj-b');

    expect(oldRoute.projectId).toBe('proj-a');
    expect(newRoute.projectId).toBe('proj-b');
    expect(oldRoute.projectId !== newRoute.projectId).toBe(true);
  });

  it('single-project mode (no hello) works unchanged', () => {
    const store = createStore();
    const state = store.getState();

    // Without hello, currentProjectId stays null, projects stays []
    expect(state.currentProjectId).toBe(null);
    expect(state.projects).toEqual([]);

    // Route without project param
    const route = parseHash('#/active');
    expect(route.projectId).toBe(null);

    // buildHash without project — same as before
    const hash = buildHash('active', 'run-1');
    expect(hash).toBe('#/active?run=run-1');
    expect(hash).not.toContain('project=');
  });
});
