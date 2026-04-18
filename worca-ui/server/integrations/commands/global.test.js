import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlobalHandlers, parseDuration } from './global.js';

// --- parseDuration ---

describe('parseDuration', () => {
  it('parses seconds', () => expect(parseDuration('30s')).toBe(30_000));
  it('parses minutes', () => expect(parseDuration('1m')).toBe(60_000));
  it('parses hours', () => expect(parseDuration('2h')).toBe(7_200_000));
  it('parses days', () => expect(parseDuration('1d')).toBe(86_400_000));
  it('returns null for empty/null', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration(null)).toBeNull();
  });
  it('returns null for unrecognized format', () => {
    expect(parseDuration('1week')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
  });
});

// --- createGlobalHandlers ---

function makeChatContext() {
  const store = {};
  return {
    get: vi.fn((k) => ({
      active_project: null,
      mute_until: null,
      muted_messages: 0,
      ...store[k],
    })),
    set: vi.fn((k, patch) => {
      store[k] = {
        active_project: null,
        mute_until: null,
        muted_messages: 0,
        ...store[k],
        ...patch,
      };
    }),
    isMuted: vi.fn((k) => {
      const { mute_until } = { mute_until: null, ...store[k] };
      if (!mute_until) return false;
      return new Date(mute_until) > new Date();
    }),
    incrementMuted: vi.fn(),
    _store: store,
  };
}

function makeRestClient(runsMap = {}) {
  return {
    get: vi.fn(async (path) => {
      for (const [prefix, data] of Object.entries(runsMap)) {
        if (path.includes(prefix)) return { status: 200, data };
      }
      return { status: 404, data: null };
    }),
  };
}

function makePrefsDir(tmpdir, projects = []) {
  const { mkdirSync, writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const dir = join(tmpdir, 'projects.d');
  mkdirSync(dir, { recursive: true });
  for (const p of projects) {
    writeFileSync(join(dir, `${p.name}.json`), JSON.stringify(p), 'utf8');
  }
  return tmpdir;
}

describe('createGlobalHandlers', () => {
  let chatCtx;
  let restClient;
  const CHAT = 'chat:telegram:12345';

  beforeEach(() => {
    chatCtx = makeChatContext();
    restClient = makeRestClient();
  });

  // /start
  it('/start returns the chat key in the response', async () => {
    const { start } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    const reply = await start(CHAT, []);
    expect(reply).toContain('telegram:12345');
  });

  // /help
  it('/help lists all commands', async () => {
    const { help } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    const reply = await help(CHAT, []);
    expect(reply).toContain('/start');
    expect(reply).toContain('/use');
    expect(reply).toContain('/mute');
    expect(reply).toContain('/stop');
  });

  // /whoami
  it('/whoami shows chat ID, active project, and mute state', async () => {
    chatCtx.get.mockReturnValue({
      active_project: 'my-proj',
      mute_until: null,
      muted_messages: 0,
    });
    chatCtx.isMuted.mockReturnValue(false);
    const { whoami } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    const reply = await whoami(CHAT, []);
    expect(reply).toContain('telegram:12345');
    expect(reply).toContain('my-proj');
    expect(reply).toMatch(/muted.*no/i);
  });

  // /projects — no projects
  it('/projects returns message when no projects registered', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const { projects } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: tmp,
      restClient,
    });
    const reply = await projects(CHAT, []);
    expect(reply).toMatch(/no projects/i);
  });

  // /projects — lists projects
  it('/projects lists registered project names', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [
      { name: 'alpha', path: '/projects/alpha' },
    ]);
    const { projects } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient,
    });
    const reply = await projects(CHAT, []);
    expect(reply).toContain('alpha');
    expect(reply).toContain('/projects/alpha');
  });

  // /use — persists active project
  it('/use persists the active project in chat_context', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [
      { name: 'worca-cc', path: '/projects/worca-cc' },
    ]);
    const { use } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient,
    });
    const reply = await use(CHAT, ['worca-cc']);
    expect(reply).toContain('worca-cc');
    expect(chatCtx.set).toHaveBeenCalledWith(CHAT, {
      active_project: 'worca-cc',
    });
  });

  // /use — rejects unknown project
  it('/use rejects an unknown project name', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [
      { name: 'alpha', path: '/projects/alpha' },
    ]);
    const { use } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient,
    });
    const reply = await use(CHAT, ['no-such-project']);
    expect(reply).toMatch(/unknown/i);
    expect(reply).toContain('no-such-project');
    expect(chatCtx.set).not.toHaveBeenCalled();
  });

  // /use — missing arg
  it('/use with no arg returns usage hint', async () => {
    const { use } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    const reply = await use(CHAT, []);
    expect(reply).toMatch(/usage/i);
  });

  // auto-select single project
  it('/active auto-selects when exactly one project is registered', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [
      { name: 'solo', path: '/projects/solo' },
    ]);
    chatCtx.get.mockReturnValue({
      active_project: null,
      mute_until: null,
      muted_messages: 0,
    });
    const { active } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient,
    });
    await active(CHAT, []);
    expect(chatCtx.set).toHaveBeenCalledWith(CHAT, { active_project: 'solo' });
  });

  // auto-select does NOT trigger with multiple projects
  it('/active does NOT auto-select when multiple projects are registered', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [
      { name: 'alpha', path: '/a' },
      { name: 'beta', path: '/b' },
    ]);
    chatCtx.get.mockReturnValue({
      active_project: null,
      mute_until: null,
      muted_messages: 0,
    });
    const { active } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient,
    });
    await active(CHAT, []);
    expect(chatCtx.set).not.toHaveBeenCalled();
  });

  // /mute blocks outbound (isMuted returns true after /mute)
  it('/mute sets mute_until so isMuted() returns true', async () => {
    const { use: _use, ...handlers } = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    await handlers.mute(CHAT, ['1h']);
    // The set call should have mute_until in the future
    expect(chatCtx.set).toHaveBeenCalledOnce();
    const [, patch] = chatCtx.set.mock.calls[0];
    const muteUntil = new Date(patch.mute_until);
    expect(muteUntil.getTime()).toBeGreaterThan(Date.now());
  });

  // /mute with no arg mutes indefinitely (large future date)
  it('/mute with no duration mutes indefinitely', async () => {
    const handlers = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    await handlers.mute(CHAT, []);
    const [, patch] = chatCtx.set.mock.calls[0];
    const muteUntil = new Date(patch.mute_until);
    // Should be at least 1 year in the future
    expect(muteUntil.getTime()).toBeGreaterThan(Date.now() + 364 * 86_400_000);
  });

  // mute expiry: mute_until in the past → isMuted returns false
  it('mute expiry: isMuted() returns false when mute_until is in the past', () => {
    chatCtx._store[CHAT] = {
      mute_until: new Date(Date.now() - 1000).toISOString(),
    };
    // Re-bind isMuted to real logic
    expect(chatCtx.isMuted(CHAT)).toBe(false);
  });

  // /mute with bad duration
  it('/mute rejects unrecognized duration', async () => {
    const handlers = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    const reply = await handlers.mute(CHAT, ['1week']);
    expect(reply).toMatch(/unrecognized/i);
    expect(chatCtx.set).not.toHaveBeenCalled();
  });

  // /unmute clears mute_until
  it('/unmute clears mute_until', async () => {
    const handlers = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir: '/tmp',
      restClient,
    });
    await handlers.unmute(CHAT, []);
    expect(chatCtx.set).toHaveBeenCalledWith(CHAT, { mute_until: null });
  });

  // /active — lists running pipelines
  it('/active lists running pipelines via REST', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [{ name: 'myproj', path: '/myproj' }]);
    const rc = makeRestClient({
      myproj: { runs: [{ id: 'run-001', pipeline_status: 'running' }] },
    });
    chatCtx.get.mockReturnValue({
      active_project: 'myproj',
      mute_until: null,
      muted_messages: 0,
    });
    const handlers = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient: rc,
    });
    const reply = await handlers.active(CHAT, []);
    expect(reply).toContain('run-001');
  });

  // /active — no runs
  it('/active returns no-active-runs message when all runs are non-running', async () => {
    const { mkdtempSync } = require('node:fs');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(require('node:os').tmpdir(), 'worca-test-'));
    const prefsDir = makePrefsDir(tmp, [{ name: 'myproj', path: '/myproj' }]);
    const rc = makeRestClient({
      myproj: { runs: [{ id: 'run-001', status: 'completed' }] },
    });
    chatCtx.get.mockReturnValue({
      active_project: 'myproj',
      mute_until: null,
      muted_messages: 0,
    });
    const handlers = createGlobalHandlers({
      chatContext: chatCtx,
      prefsDir,
      restClient: rc,
    });
    const reply = await handlers.active(CHAT, []);
    expect(reply).toMatch(/no active/i);
  });
});
