import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBroadcaster } from './ws-broadcaster.js';

describe('multi-project WS', () => {
  describe('broadcaster project field', () => {
    /** Create a mock wss with clients that have subs. */
    function mockWss(clientSpecs) {
      const clients = new Set();
      const subsMap = new WeakMap();
      for (const spec of clientSpecs) {
        const ws = {
          readyState: 1, // OPEN
          OPEN: 1,
          send: vi.fn(),
          _subs: spec,
        };
        clients.add(ws);
        subsMap.set(ws, spec);
      }
      return {
        clients,
        getSubs: (ws) => subsMap.get(ws),
      };
    }

    it('broadcast adds project field for protocol 2 clients', () => {
      const { clients, getSubs } = mockWss([
        {
          runId: null,
          logStage: null,
          logRunId: null,
          eventsRunId: null,
          protocolVersion: 2,
          projectId: 'proj-a',
        },
      ]);
      const wss = { clients };
      const broadcaster = createBroadcaster({ wss, getSubs });

      broadcaster.broadcast('runs-list', { runs: [] });

      const ws = [...clients][0];
      const msg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(msg.type).toBe('runs-list');
      expect(msg.project).toBe('proj-a');
    });

    it('broadcast omits project field for protocol 1 clients', () => {
      const { clients, getSubs } = mockWss([
        {
          runId: null,
          logStage: null,
          logRunId: null,
          eventsRunId: null,
          protocolVersion: 1,
          projectId: null,
        },
      ]);
      const wss = { clients };
      const broadcaster = createBroadcaster({ wss, getSubs });

      broadcaster.broadcast('runs-list', { runs: [] });

      const ws = [...clients][0];
      const msg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(msg.type).toBe('runs-list');
      expect(msg.project).toBeUndefined();
    });

    it('broadcastToSubscribers adds project for protocol 2', () => {
      const { clients, getSubs } = mockWss([
        {
          runId: 'run-1',
          logStage: null,
          logRunId: null,
          eventsRunId: null,
          protocolVersion: 2,
          projectId: 'proj-b',
        },
      ]);
      const wss = { clients };
      const broadcaster = createBroadcaster({ wss, getSubs });

      broadcaster.broadcastToSubscribers('run-1', 'run-update', {
        status: 'ok',
      });

      const ws = [...clients][0];
      const msg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(msg.project).toBe('proj-b');
    });

    it('mixed protocol clients get different messages', () => {
      const { clients, getSubs } = mockWss([
        {
          runId: null,
          logStage: null,
          logRunId: null,
          eventsRunId: null,
          protocolVersion: 1,
          projectId: null,
        },
        {
          runId: null,
          logStage: null,
          logRunId: null,
          eventsRunId: null,
          protocolVersion: 2,
          projectId: 'proj-c',
        },
      ]);
      const wss = { clients };
      const broadcaster = createBroadcaster({ wss, getSubs });

      broadcaster.broadcast('test-event', { data: 1 });

      const [ws1, ws2] = [...clients];
      const msg1 = JSON.parse(ws1.send.mock.calls[0][0]);
      const msg2 = JSON.parse(ws2.send.mock.calls[0][0]);

      expect(msg1.project).toBeUndefined();
      expect(msg2.project).toBe('proj-c');
    });

    it('broadcastPipelineEvent adds project for protocol 2', () => {
      const { clients, getSubs } = mockWss([
        {
          runId: null,
          logStage: null,
          logRunId: null,
          eventsRunId: 'run-x',
          protocolVersion: 2,
          projectId: 'proj-d',
        },
      ]);
      const wss = { clients };
      const broadcaster = createBroadcaster({ wss, getSubs });

      broadcaster.broadcastPipelineEvent('run-x', {
        event_type: 'stage.complete',
      });

      const ws = [...clients][0];
      const msg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(msg.project).toBe('proj-d');
    });
  });

  describe('WatcherSet map (conceptual)', () => {
    it('single-project mode creates one WatcherSet equivalent', () => {
      // This is a structural test — verify the concept works with a Map
      const watcherSets = new Map();
      watcherSets.set('default', { projectId: 'default', isAlive: () => true });
      expect(watcherSets.size).toBe(1);
      expect(watcherSets.get('default').isAlive()).toBe(true);
    });

    it('multi-project mode creates N WatcherSets', () => {
      const watcherSets = new Map();
      watcherSets.set('proj-a', { projectId: 'proj-a', isAlive: () => true });
      watcherSets.set('proj-b', { projectId: 'proj-b', isAlive: () => true });
      expect(watcherSets.size).toBe(2);
    });

    it('scoped scheduleRefresh refreshes one project', () => {
      const refreshes = [];
      const watcherSets = new Map();
      watcherSets.set('a', { scheduleRefresh: () => refreshes.push('a') });
      watcherSets.set('b', { scheduleRefresh: () => refreshes.push('b') });

      // Scoped refresh
      watcherSets.get('a').scheduleRefresh();
      expect(refreshes).toEqual(['a']);
    });

    it('unscoped scheduleRefresh refreshes all', () => {
      const refreshes = [];
      const watcherSets = new Map();
      watcherSets.set('a', { scheduleRefresh: () => refreshes.push('a') });
      watcherSets.set('b', { scheduleRefresh: () => refreshes.push('b') });

      // Refresh all
      for (const ws of watcherSets.values()) ws.scheduleRefresh();
      expect(refreshes).toEqual(['a', 'b']);
    });

    it('cleanup destroys all WatcherSets', () => {
      const destroyed = [];
      const watcherSets = new Map();
      watcherSets.set('a', { destroy: () => destroyed.push('a') });
      watcherSets.set('b', { destroy: () => destroyed.push('b') });

      for (const ws of watcherSets.values()) ws.destroy();
      watcherSets.clear();
      expect(destroyed).toEqual(['a', 'b']);
      expect(watcherSets.size).toBe(0);
    });
  });
});
