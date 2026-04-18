import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config-loader.js', () => ({ loadIntegrationsConfig: vi.fn() }));
vi.mock('./verify.js', () => ({ verify: vi.fn() }));
vi.mock('./renderers.js', () => ({
  renderEvent: vi.fn(),
  TIER1_EVENTS: ['pipeline.run.completed', 'pipeline.run.failed'],
}));
vi.mock('./chat_context.js', () => ({ createChatContext: vi.fn() }));
vi.mock('./rate_limiter.js', () => ({ createRateLimiter: vi.fn() }));
vi.mock('./allowlist.js', () => ({ createAllowlistGuard: vi.fn() }));
vi.mock('./rest_client.js', () => ({ createRestClient: vi.fn() }));
vi.mock('./commands/parser.js', () => ({ parseCommand: vi.fn() }));
vi.mock('./commands/global.js', () => ({ createGlobalHandlers: vi.fn() }));
vi.mock('./commands/project.js', () => ({ createProjectHandlers: vi.fn() }));
vi.mock('./commands/control.js', () => ({ createControlHandlers: vi.fn() }));
vi.mock('./adapters/telegram.js', () => ({ createTelegramAdapter: vi.fn() }));
vi.mock('./adapters/discord.js', () => ({ createDiscordAdapter: vi.fn() }));
vi.mock('./adapters/slack.js', () => ({ createSlackAdapter: vi.fn() }));
vi.mock('./adapters/webhook_out.js', () => ({
  createWebhookOutAdapter: vi.fn(),
}));

import { createTelegramAdapter } from './adapters/telegram.js';
import { createAllowlistGuard } from './allowlist.js';
import { createChatContext } from './chat_context.js';
import { createControlHandlers } from './commands/control.js';
import { createGlobalHandlers } from './commands/global.js';
import { parseCommand } from './commands/parser.js';
import { createProjectHandlers } from './commands/project.js';
import { loadIntegrationsConfig } from './config-loader.js';
import { createIntegrations, RAW_BODY } from './index.js';
import { createRateLimiter } from './rate_limiter.js';
import { renderEvent } from './renderers.js';
import { createRestClient } from './rest_client.js';
import { verify } from './verify.js';

const BASE_OPTS = {
  port: 3400,
  host: '127.0.0.1',
  prefsDir: '/tmp/prefs',
  configPath: '/tmp/prefs/integrations/config.json',
};

const TELEGRAM_CFG = {
  enabled: true,
  bot_token_env: 'TELEGRAM_BOT_TOKEN',
  chat_id: '123456789',
  rate_limit_per_min: 20,
  events: ['pipeline.run.completed'],
};

const VALID_CFG = {
  schema_version: 1,
  enabled: true,
  webhook_secret_env: 'WORCA_WEBHOOK_SECRET',
  strict_inbox_verification: false,
  telegram: TELEGRAM_CFG,
};

function makeMockTelegramAdapter() {
  let _cb = null;
  const send = vi.fn().mockResolvedValue(undefined);
  const adapter = {
    name: 'telegram',
    supportsInbound: true,
    start: vi.fn().mockResolvedValue(undefined),
    send,
    onInbound(cb) {
      _cb = cb;
    },
  };
  return {
    adapter,
    send,
    triggerInbound(msg) {
      return _cb?.(msg);
    },
  };
}

function makeMockRateLimiter() {
  return {
    send: vi.fn().mockImplementation((_msg, sendFn) => sendFn(_msg)),
    getStats: vi.fn().mockReturnValue({ dropped_messages: 0 }),
    getRing: vi.fn().mockReturnValue([]),
  };
}

function setupDefaultMocks(adapterMock) {
  const mockChatCtx = {
    get: vi.fn().mockReturnValue({
      active_project: null,
      mute_until: null,
      muted_messages: 0,
    }),
    set: vi.fn(),
    isMuted: vi.fn().mockReturnValue(false),
    incrementMuted: vi.fn(),
  };
  const mockRateLimiter = makeMockRateLimiter();
  const mockAllowlist = { isAllowed: vi.fn().mockReturnValue(true) };
  const mockRestClient = { get: vi.fn(), post: vi.fn() };

  createChatContext.mockReturnValue(mockChatCtx);
  createRateLimiter.mockReturnValue(mockRateLimiter);
  createAllowlistGuard.mockReturnValue(mockAllowlist);
  createRestClient.mockReturnValue(mockRestClient);
  createGlobalHandlers.mockReturnValue({});
  createProjectHandlers.mockReturnValue({});
  createControlHandlers.mockReturnValue({});
  if (adapterMock) createTelegramAdapter.mockReturnValue(adapterMock.adapter);

  return { mockChatCtx, mockRateLimiter, mockAllowlist, mockRestClient };
}

describe('createIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // No-op stub path
  // ---------------------------------------------------------------------------

  describe('no-op stub', () => {
    it('returns no-op stub when config is null', () => {
      loadIntegrationsConfig.mockReturnValue(null);
      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.strictInboxVerification).toBe(false);
      expect(integrations.secrets).toEqual([]);
      expect(integrations.status()).toMatchObject({ enabled: false });
      expect(() => integrations.onEvent({})).not.toThrow();
    });

    it('returns no-op stub when enabled is false', () => {
      loadIntegrationsConfig.mockReturnValue({
        schema_version: 1,
        enabled: false,
      });
      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.strictInboxVerification).toBe(false);
      expect(integrations.status()).toMatchObject({ enabled: false });
    });

    it('no-op stub onEvent does not throw with RAW_BODY symbol on stored', () => {
      loadIntegrationsConfig.mockReturnValue(null);
      const integrations = createIntegrations(BASE_OPTS);
      const stored = { headers: {}, envelope: {} };
      stored[RAW_BODY] = Buffer.from('{}');
      expect(() => integrations.onEvent(stored)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Configuration exposure
  // ---------------------------------------------------------------------------

  describe('configuration', () => {
    it('exposes strictInboxVerification: true when config has strict_inbox_verification: true', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue({
        ...VALID_CFG,
        strict_inbox_verification: true,
      });
      setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.strictInboxVerification).toBe(true);
    });

    it('exposes strictInboxVerification: false when not set', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue({
        ...VALID_CFG,
        strict_inbox_verification: false,
      });
      setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.strictInboxVerification).toBe(false);
    });

    it('loads secret from webhook_secret_env', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.secrets).toContain('mysecret');
    });

    it('loads multiple secrets from webhook_secrets_env (comma-separated)', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue({
        ...VALID_CFG,
        webhook_secrets_env: 'WORCA_WEBHOOK_SECRETS',
      });
      setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'secret1');
      vi.stubEnv('WORCA_WEBHOOK_SECRETS', 'secret2,secret3');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.secrets).toEqual(
        expect.arrayContaining(['secret1', 'secret2', 'secret3']),
      );
      expect(integrations.secrets).toHaveLength(3);
    });

    it('returns empty secrets array when env vars not set', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      // WORCA_WEBHOOK_SECRET not set

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.secrets).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // onEvent pipeline
  // ---------------------------------------------------------------------------

  describe('onEvent', () => {
    it('drops event and increments counter when signature is invalid', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      verify.mockReturnValue(false);

      const integrations = createIntegrations(BASE_OPTS);
      const stored = {
        headers: { 'x-worca-signature': 'sha256=bad' },
        envelope: { event_type: 'pipeline.run.completed' },
      };
      stored[RAW_BODY] = Buffer.from('{}');

      integrations.onEvent(stored);
      expect(mockRateLimiter.send).not.toHaveBeenCalled();
      expect(integrations.status().adapters[0].invalid_signature_events).toBe(
        1,
      );
    });

    it('renders and queues event for valid signature', async () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      verify.mockReturnValue(true);
      renderEvent.mockReturnValue({
        title: null,
        body: [{ kind: 'text', value: 'done' }],
        severity: 'success',
      });

      const integrations = createIntegrations(BASE_OPTS);
      const stored = {
        headers: { 'x-worca-signature': 'sha256=valid' },
        envelope: { event_type: 'pipeline.run.completed' },
      };
      stored[RAW_BODY] = Buffer.from('{}');

      integrations.onEvent(stored);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(renderEvent).toHaveBeenCalledWith(stored.envelope);
      expect(mockRateLimiter.send).toHaveBeenCalled();
    });

    it('skips event not in adapter events list', () => {
      const adapterMock = makeMockTelegramAdapter();
      // TELEGRAM_CFG.events = ['pipeline.run.completed'], not 'pipeline.run.failed'
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      verify.mockReturnValue(true);

      const integrations = createIntegrations(BASE_OPTS);
      const stored = {
        headers: { 'x-worca-signature': 'sha256=valid' },
        envelope: { event_type: 'pipeline.run.failed' },
      };
      stored[RAW_BODY] = Buffer.from('{}');

      integrations.onEvent(stored);
      expect(mockRateLimiter.send).not.toHaveBeenCalled();
    });

    it('skips send and increments muted_messages when chat is muted', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockChatCtx, mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      verify.mockReturnValue(true);
      mockChatCtx.isMuted.mockReturnValue(true);

      const integrations = createIntegrations(BASE_OPTS);
      const stored = {
        headers: { 'x-worca-signature': 'sha256=valid' },
        envelope: { event_type: 'pipeline.run.completed' },
      };
      stored[RAW_BODY] = Buffer.from('{}');

      integrations.onEvent(stored);
      expect(mockRateLimiter.send).not.toHaveBeenCalled();
      expect(mockChatCtx.incrementMuted).toHaveBeenCalledWith(
        'telegram:123456789',
      );
    });

    it('passes event without signature check when no secrets configured', async () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue({
        ...VALID_CFG,
        webhook_secret_env: undefined,
      });
      const { mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      // No WORCA_WEBHOOK_SECRET set
      renderEvent.mockReturnValue({
        title: null,
        body: [{ kind: 'text', value: 'done' }],
        severity: 'success',
      });

      const integrations = createIntegrations(BASE_OPTS);
      const stored = {
        headers: {},
        envelope: { event_type: 'pipeline.run.completed' },
      };
      stored[RAW_BODY] = Buffer.from('{}');

      integrations.onEvent(stored);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(renderEvent).toHaveBeenCalled();
      expect(mockRateLimiter.send).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // onInbound pipeline (via telegram long-poll)
  // ---------------------------------------------------------------------------

  describe('onInbound', () => {
    it('drops message from non-allowlisted chat', async () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockAllowlist } = setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      mockAllowlist.isAllowed.mockReturnValue(false);

      createIntegrations(BASE_OPTS);
      await adapterMock.triggerInbound({
        platform: 'telegram',
        chatId: '999',
        userId: '999',
        text: '/help',
      });
      expect(adapterMock.send).not.toHaveBeenCalled();
    });

    it('dispatches recognized command to handler and sends reply', async () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockAllowlist, mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      mockAllowlist.isAllowed.mockReturnValue(true);
      parseCommand.mockReturnValue({ command: 'help', args: [] });
      createGlobalHandlers.mockReturnValue({
        help: vi.fn().mockResolvedValue('Help text here'),
      });

      createIntegrations(BASE_OPTS);
      await adapterMock.triggerInbound({
        platform: 'telegram',
        chatId: '123456789',
        userId: '123',
        text: '/help',
      });
      expect(mockRateLimiter.send).toHaveBeenCalled();
    });

    it('sends "unknown command" reply for unrecognized commands', async () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockAllowlist, mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      mockAllowlist.isAllowed.mockReturnValue(true);
      parseCommand.mockReturnValue({ command: 'bogus', args: [] });

      createIntegrations(BASE_OPTS);
      await adapterMock.triggerInbound({
        platform: 'telegram',
        chatId: '123456789',
        userId: '123',
        text: '/bogus',
      });
      expect(mockRateLimiter.send).toHaveBeenCalled();
    });

    it('ignores message when parseCommand returns null', async () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const { mockAllowlist, mockRateLimiter } = setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      mockAllowlist.isAllowed.mockReturnValue(true);
      parseCommand.mockReturnValue(null);

      createIntegrations(BASE_OPTS);
      await adapterMock.triggerInbound({
        platform: 'telegram',
        chatId: '123456789',
        userId: '123',
        text: 'hello world',
      });
      expect(mockRateLimiter.send).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Adapter startup
  // ---------------------------------------------------------------------------

  describe('adapter startup', () => {
    it('calls adapter.start() when booting', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      createIntegrations(BASE_OPTS);
      expect(adapterMock.adapter.start).toHaveBeenCalled();
    });

    it('skips telegram and warns when bot_token_env is unset', () => {
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      const adapterMock = makeMockTelegramAdapter();
      setupDefaultMocks(adapterMock);
      // TELEGRAM_BOT_TOKEN not stubbed
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.status().adapters).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('telegram token not configured'),
      );
      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // status()
  // ---------------------------------------------------------------------------

  describe('status()', () => {
    it('returns enabled:true with adapters array', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      setupDefaultMocks(adapterMock);
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      const integrations = createIntegrations(BASE_OPTS);
      const s = integrations.status();
      expect(s.enabled).toBe(true);
      expect(Array.isArray(s.adapters)).toBe(true);
      expect(s.adapters[0]).toMatchObject({ name: 'telegram', enabled: true });
    });

    it('tracks invalid_signature_events across multiple bad events', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
      verify.mockReturnValue(false);

      const integrations = createIntegrations(BASE_OPTS);
      const stored = {
        headers: { 'x-worca-signature': 'sha256=bad' },
        envelope: { event_type: 'pipeline.run.completed' },
      };
      stored[RAW_BODY] = Buffer.from('{}');
      integrations.onEvent(stored);
      integrations.onEvent(stored);

      expect(integrations.status().adapters[0].invalid_signature_events).toBe(
        2,
      );
    });

    it('includes secrets_configured count', () => {
      const adapterMock = makeMockTelegramAdapter();
      loadIntegrationsConfig.mockReturnValue(VALID_CFG);
      setupDefaultMocks(adapterMock);
      vi.stubEnv('WORCA_WEBHOOK_SECRET', 'mysecret');
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');

      const integrations = createIntegrations(BASE_OPTS);
      expect(integrations.status().secrets_configured).toBe(1);
    });
  });
});
