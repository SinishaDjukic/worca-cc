import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatcherSet } from './watcher-set.js';

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
    worcaDir = join(tmpdir(), `worca-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(worcaDir, { recursive: true });
  });

  afterEach(() => rmSync(worcaDir, { recursive: true, force: true }));

  function makeDeps(overrides = {}) {
    return {
      broadcaster: { broadcast: vi.fn(), broadcastToSubscribers: vi.fn(), broadcastToLogSubscribers: vi.fn(), broadcastPipelineEvent: vi.fn() },
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

    // Should have 4 watcher modules
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
      createStatusWatcher: () => { throw new Error('boom'); },
    });
    ws.create();

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
});
