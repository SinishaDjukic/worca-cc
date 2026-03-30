import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIER_FULL, TIER_POLLING, WatcherSet } from './watcher-set.js';

/** Minimal mock watcher factory returning an object with destroy(). */
function mockWatcherFactory(name) {
  return () => ({
    name,
    destroy: vi.fn(),
    scheduleRefresh: vi.fn(),
    resolveActiveRunDir: vi.fn(() => '/mock'),
    currentActiveRunId: vi.fn(() => null),
    getBeadsDbPath: vi.fn(() => '/mock/beads.db'),
    readEventsFromFile: vi.fn(() => []),
    subscribeEvents: vi.fn(),
    maybeCloseEventWatcher: vi.fn(),
    clearLogWatchers: vi.fn(),
    watchLogFile: vi.fn(),
    watchAllLogFiles: vi.fn(),
    sendArchivedLogs: vi.fn(),
    resolveLogsBaseDir: vi.fn(() => '/mock'),
    lastPipelineStatus: new Map(),
    getWatchedRunDir: vi.fn(() => null),
  });
}

describe('WatcherSet', () => {
  let worcaDir;

  beforeEach(() => {
    worcaDir = join(
      tmpdir(),
      `worca-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(worcaDir, { recursive: true });
  });

  afterEach(() => rmSync(worcaDir, { recursive: true, force: true }));

  function makeDeps(overrides = {}) {
    return {
      broadcaster: {
        broadcast: vi.fn(),
        broadcastToSubscribers: vi.fn(),
        broadcastToLogSubscribers: vi.fn(),
        broadcastPipelineEvent: vi.fn(),
      },
      getSubs: vi.fn(),
      wss: { clients: new Set() },
      settingsPath: '/mock/settings.json',
      projectRoot: '/mock/project',
      webhookInbox: null,
      ...overrides,
    };
  }

  it('creates watchers on create()', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    ws.setTier(TIER_FULL);

    expect(ws.statusWatcher).toBeTruthy();
    expect(ws.logWatcher).toBeTruthy();
    expect(ws.beadsWatcher).toBeTruthy();
    expect(ws.eventWatcher).toBeTruthy();
    expect(ws.isAlive()).toBe(true);

    ws.destroy();
  });

  it('destroy() calls destroy on all children', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    ws.setTier(TIER_FULL);

    const statusDestroy = vi.spyOn(ws.statusWatcher, 'destroy');
    const logDestroy = vi.spyOn(ws.logWatcher, 'destroy');
    const beadsDestroy = vi.spyOn(ws.beadsWatcher, 'destroy');
    const eventDestroy = vi.spyOn(ws.eventWatcher, 'destroy');

    ws.destroy();

    expect(statusDestroy).toHaveBeenCalled();
    expect(logDestroy).toHaveBeenCalled();
    expect(beadsDestroy).toHaveBeenCalled();
    expect(eventDestroy).toHaveBeenCalled();
  });

  it('destroy() is idempotent', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();

    ws.destroy();
    expect(() => ws.destroy()).not.toThrow();
    expect(ws.isAlive()).toBe(false);
  });

  it('isAlive() returns false after destroy', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    expect(ws.isAlive()).toBe(true);

    ws.destroy();
    expect(ws.isAlive()).toBe(false);
  });

  it('isAlive() returns false when worcaDir is removed', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    expect(ws.isAlive()).toBe(true);

    rmSync(worcaDir, { recursive: true, force: true });
    expect(ws.isAlive()).toBe(false);

    // Re-create for cleanup
    mkdirSync(worcaDir, { recursive: true });
    ws.destroy();
  });

  it('getWatcherCount() returns approximate count', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    ws.setTier(TIER_FULL);

    // Should have 4 watcher modules when in full tier
    expect(ws.getWatcherCount()).toBe(4);

    ws.destroy();
  });

  it('scheduleRefresh delegates to status watcher', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();

    const spy = vi.spyOn(ws.statusWatcher, 'scheduleRefresh');
    ws.scheduleRefresh();
    expect(spy).toHaveBeenCalled();

    ws.destroy();
  });

  it('create() isolates errors - one factory failure does not prevent others', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps, {
      createStatusWatcher: () => {
        throw new Error('boom');
      },
    });
    ws.create();
    ws.setTier(TIER_FULL);

    // Status watcher failed, but others should still be created
    expect(ws.statusWatcher).toBe(null);
    expect(ws.logWatcher).toBeTruthy();
    expect(ws.beadsWatcher).toBeTruthy();
    expect(ws.eventWatcher).toBeTruthy();

    ws.destroy();
  });

  it('exposes projectId', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('my-proj', worcaDir, deps);
    expect(ws.projectId).toBe('my-proj');
    ws.destroy();
  });

  it('worcaDir getter returns construction-time value', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    expect(ws.worcaDir).toBe(worcaDir);
    ws.destroy();
  });

  it('settingsPath getter returns deps.settingsPath', () => {
    const deps = makeDeps({ settingsPath: '/custom/settings.json' });
    const ws = new WatcherSet('test-project', worcaDir, deps);
    expect(ws.settingsPath).toBe('/custom/settings.json');
    ws.destroy();
  });

  it('projectRoot getter returns deps.projectRoot', () => {
    const deps = makeDeps({ projectRoot: '/custom/project' });
    const ws = new WatcherSet('test-project', worcaDir, deps);
    expect(ws.projectRoot).toBe('/custom/project');
    ws.destroy();
  });

  // --- Tiering tests ---

  it('default tier is polling', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    expect(ws.getTier()).toBe(TIER_POLLING);
    ws.destroy();
  });

  it('create() in polling tier creates only statusWatcher', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();

    expect(ws.statusWatcher).toBeTruthy();
    expect(ws.logWatcher).toBe(null);
    expect(ws.beadsWatcher).toBe(null);
    expect(ws.eventWatcher).toBe(null);

    ws.destroy();
  });

  it('setTier("full") creates log, beads, and event watchers', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();

    expect(ws.logWatcher).toBe(null);
    expect(ws.beadsWatcher).toBe(null);
    expect(ws.eventWatcher).toBe(null);

    ws.setTier(TIER_FULL);

    expect(ws.getTier()).toBe(TIER_FULL);
    expect(ws.statusWatcher).toBeTruthy();
    expect(ws.logWatcher).toBeTruthy();
    expect(ws.beadsWatcher).toBeTruthy();
    expect(ws.eventWatcher).toBeTruthy();

    ws.destroy();
  });

  it('setTier("polling") from full destroys log, beads, event but keeps status', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    ws.setTier(TIER_FULL);

    // Capture destroy spies before demotion
    const logDestroy = vi.spyOn(ws.logWatcher, 'destroy');
    const beadsDestroy = vi.spyOn(ws.beadsWatcher, 'destroy');
    const eventDestroy = vi.spyOn(ws.eventWatcher, 'destroy');
    const statusRef = ws.statusWatcher;

    ws.setTier(TIER_POLLING);

    expect(ws.getTier()).toBe(TIER_POLLING);
    expect(logDestroy).toHaveBeenCalled();
    expect(beadsDestroy).toHaveBeenCalled();
    expect(eventDestroy).toHaveBeenCalled();
    expect(ws.logWatcher).toBe(null);
    expect(ws.beadsWatcher).toBe(null);
    expect(ws.eventWatcher).toBe(null);
    // Status watcher must survive demotion
    expect(ws.statusWatcher).toBe(statusRef);

    ws.destroy();
  });

  it('setTier with same tier is a no-op', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();

    // Polling -> polling should not change anything
    const statusRef = ws.statusWatcher;
    ws.setTier(TIER_POLLING);
    expect(ws.statusWatcher).toBe(statusRef);
    expect(ws.logWatcher).toBe(null);

    // Promote, then full -> full should not recreate
    ws.setTier(TIER_FULL);
    const logRef = ws.logWatcher;
    const beadsRef = ws.beadsWatcher;
    const eventRef = ws.eventWatcher;
    ws.setTier(TIER_FULL);
    expect(ws.logWatcher).toBe(logRef);
    expect(ws.beadsWatcher).toBe(beadsRef);
    expect(ws.eventWatcher).toBe(eventRef);

    ws.destroy();
  });

  it('setTier after destroy is a no-op', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();
    ws.destroy();

    // Should not throw or create watchers
    expect(() => ws.setTier(TIER_FULL)).not.toThrow();
    expect(ws.getTier()).toBe(TIER_POLLING); // tier unchanged
    expect(ws.logWatcher).toBe(null);
    expect(ws.beadsWatcher).toBe(null);
    expect(ws.eventWatcher).toBe(null);
  });

  it('getWatcherCount() reflects tier changes', () => {
    const deps = makeDeps();
    const ws = new WatcherSet('test-project', worcaDir, deps);
    ws.create();

    // Polling tier: only status watcher
    expect(ws.getWatcherCount()).toBe(1);

    // Promote to full: all 4 watchers
    ws.setTier(TIER_FULL);
    expect(ws.getWatcherCount()).toBe(4);

    // Demote back to polling: only status watcher
    ws.setTier(TIER_POLLING);
    expect(ws.getWatcherCount()).toBe(1);

    ws.destroy();
  });
});
