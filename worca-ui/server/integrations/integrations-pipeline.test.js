// Integration tests: full pipeline paths through createIntegrations.
//
// Mocked:  loadIntegrationsConfig, all adapter factories, ProcessManager
// Real:    verify.js, renderers.js, chat_context.js, commands/*, rate_limiter.js, allowlist.js

import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config-loader.js', () => ({ loadIntegrationsConfig: vi.fn() }));
vi.mock('./adapters/telegram.js', () => ({ createTelegramAdapter: vi.fn() }));
vi.mock('./adapters/discord.js', () => ({ createDiscordAdapter: vi.fn() }));
vi.mock('./adapters/slack.js', () => ({ createSlackAdapter: vi.fn() }));
vi.mock('./adapters/webhook_out.js', () => ({
  createWebhookOutAdapter: vi.fn(),
}));
vi.mock('../process-manager.js', () => ({
  ProcessManager: vi.fn(function MockPM() {
    this.pausePipeline = vi.fn().mockReturnValue({ paused: true });
    this.resumePipeline = vi.fn().mockReturnValue({ resumed: true });
    this.stopPipeline = vi.fn().mockReturnValue({ stopped: true });
    this.startPipeline = vi.fn().mockResolvedValue({ pid: 123 });
    this.getRunningPid = vi.fn().mockReturnValue(null);
    this.reconcileStatus = vi.fn();
  }),
}));

import { createApp } from '../app.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { loadIntegrationsConfig } from './config-loader.js';
import { createIntegrations, RAW_BODY } from './index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECRET = 'test-webhook-secret-xyz';
const TOKEN = 'fake-telegram-bot-token';
const CHAT_ID = '999888777';
const ENV_SECRET = 'TEST_PIPE_WORCA_SECRET';
const ENV_TOKEN = 'TEST_PIPE_TELEGRAM_TOKEN';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signPayload(rawBody, secret) {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function makeTelegramAdapterMock() {
  let _inboundCb = null;
  const send = vi.fn().mockResolvedValue(undefined);
  const adapter = {
    name: 'telegram',
    supportsInbound: true,
    start: vi.fn().mockResolvedValue(undefined),
    send,
    onInbound(cb) {
      _inboundCb = cb;
    },
  };
  createTelegramAdapter.mockReturnValue(adapter);
  return {
    adapter,
    send,
    triggerInbound(msg) {
      return _inboundCb?.(msg);
    },
  };
}

function makeTempDir() {
  const dir = join(
    tmpdir(),
    `worca-intpipe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function registerProject(prefsDir, name, projectPath, worcaDirPath) {
  const projectsDir = join(prefsDir, 'projects.d');
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(
    join(projectsDir, `${name}.json`),
    JSON.stringify({ name, path: projectPath, worcaDir: worcaDirPath }),
  );
}

function createStatusFile(worcaDir, runId, status) {
  const runDir = join(worcaDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'status.json'), JSON.stringify(status));
}

async function startServer(app) {
  const httpServer = createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  return { httpServer, port: httpServer.address().port };
}

function makeBaseConfig(telegramOverride = {}) {
  return {
    schema_version: 1,
    enabled: true,
    webhook_secret_env: ENV_SECRET,
    strict_inbox_verification: false,
    telegram: {
      enabled: true,
      bot_token_env: ENV_TOKEN,
      chat_id: CHAT_ID,
      rate_limit_per_min: 20,
      events: ['pipeline.run.completed'],
      ...telegramOverride,
    },
  };
}

// Flush microtask queue N levels deep so rate-limiter worker can complete.
async function flushMicrotasks(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Test 1: Signed POST → full pipeline → adapter.send() called
// ---------------------------------------------------------------------------

describe('signed POST → full pipeline → adapter.send() called', () => {
  let httpServer, port, mock, app;

  beforeEach(async () => {
    process.env[ENV_SECRET] = SECRET;
    process.env[ENV_TOKEN] = TOKEN;
    mock = makeTelegramAdapterMock();
    loadIntegrationsConfig.mockReturnValue(makeBaseConfig());
    const prefsDir = makeTempDir();
    app = createApp({ prefsDir });
    ({ httpServer, port } = await startServer(app));
    app.locals.integrations = createIntegrations({
      port,
      host: '127.0.0.1',
      prefsDir,
      configPath: join(prefsDir, 'integrations', 'config.json'),
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    delete process.env[ENV_SECRET];
    delete process.env[ENV_TOKEN];
  });

  it('calls adapter.send() with rendered run.completed message for a signed POST', async () => {
    const envelope = {
      event_type: 'pipeline.run.completed',
      run_id: 'run-001',
      payload: { duration_ms: 5000, total_cost_usd: 0.42 },
    };
    const rawBody = JSON.stringify(envelope);
    const sig = signPayload(rawBody, SECRET);

    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'pipeline.run.completed',
        'x-worca-signature': sig,
      },
      body: rawBody,
    });
    expect(res.status).toBe(200);

    await vi.waitUntil(() => mock.send.mock.calls.length > 0, {
      timeout: 2000,
    });

    const [calledChatId, msg] = mock.send.mock.calls[0];
    expect(calledChatId).toBe(CHAT_ID);
    expect(msg.severity).toBe('success');
    const bodyText = msg.body.map((s) => s.value ?? '').join('');
    expect(bodyText).toContain('run-001');
    expect(bodyText).toContain('5s');
    expect(bodyText).toContain('$0.42');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Unsigned POST → inbox accepts 200 → integrations drops → no send()
// ---------------------------------------------------------------------------

describe('unsigned POST → inbox 200 → integrations drops event → no send()', () => {
  let httpServer, port, mock, app;

  beforeEach(async () => {
    process.env[ENV_SECRET] = SECRET;
    process.env[ENV_TOKEN] = TOKEN;
    mock = makeTelegramAdapterMock();
    loadIntegrationsConfig.mockReturnValue(makeBaseConfig());
    const prefsDir = makeTempDir();
    app = createApp({ prefsDir });
    ({ httpServer, port } = await startServer(app));
    app.locals.integrations = createIntegrations({
      port,
      host: '127.0.0.1',
      prefsDir,
      configPath: join(prefsDir, 'integrations', 'config.json'),
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    delete process.env[ENV_SECRET];
    delete process.env[ENV_TOKEN];
  });

  it('returns 200 for unsigned POST but drops the event without calling send()', async () => {
    const res = await fetch(`http://localhost:${port}/api/webhooks/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worca-event': 'pipeline.run.completed',
      },
      body: JSON.stringify({
        event_type: 'pipeline.run.completed',
        run_id: 'run-unsigned',
        payload: { duration_ms: 1000, total_cost_usd: 0.1 },
      }),
    });

    expect(res.status).toBe(200);
    // Give any async chain time to NOT fire
    await flushMicrotasks(20);
    expect(mock.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests 3 & 4: Inbound command tests with loopback REST
// ---------------------------------------------------------------------------

describe('Telegram inbound commands via loopback REST', () => {
  let httpServer, port, mock, prefsDir, worcaDir;

  beforeEach(async () => {
    process.env[ENV_SECRET] = SECRET;
    process.env[ENV_TOKEN] = TOKEN;

    prefsDir = makeTempDir();
    worcaDir = makeTempDir();
    // Register project so /use and status/pause routes resolve it
    registerProject(prefsDir, 'worca-cc', '/fake/project/path', worcaDir);

    mock = makeTelegramAdapterMock();
    // No outbound events — this describe block tests inbound commands only
    loadIntegrationsConfig.mockReturnValue(makeBaseConfig({ events: [] }));

    const app = createApp({ prefsDir });
    ({ httpServer, port } = await startServer(app));
    app.locals.integrations = createIntegrations({
      port,
      host: '127.0.0.1',
      prefsDir,
      configPath: join(prefsDir, 'integrations', 'config.json'),
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    delete process.env[ENV_SECRET];
    delete process.env[ENV_TOKEN];
    vi.clearAllMocks();
  });

  it('Test 3: /pause run-abc → loopback POST → mocked pausePipeline → "Paused run-abc."', async () => {
    // Set active project first via /use command
    await mock.triggerInbound({
      text: '/use worca-cc',
      chatId: CHAT_ID,
      platform: 'telegram',
    });
    // triggerInbound awaits the full _handleInbound chain including _sendReply
    expect(mock.send).toHaveBeenCalledWith(
      CHAT_ID,
      expect.objectContaining({ body: expect.any(Array) }),
    );
    mock.send.mockClear();

    // Trigger /pause with explicit run ID → loopback REST to Express → pm.pausePipeline
    await mock.triggerInbound({
      text: '/pause run-abc',
      chatId: CHAT_ID,
      platform: 'telegram',
    });

    expect(mock.send).toHaveBeenCalledOnce();
    const [calledChatId, msg] = mock.send.mock.calls[0];
    expect(calledChatId).toBe(CHAT_ID);
    const replyText = msg.body[0].value;
    expect(replyText).toContain('Paused');
    expect(replyText).toContain('run-abc');
  });

  it('Test 4: /use worca-cc then /status run-abc → loopback GET scoped to that project', async () => {
    // Create the status file the route will read
    createStatusFile(worcaDir, 'run-abc', {
      run_id: 'run-abc',
      pipeline_status: 'running',
      stage: 'implementer',
      started_at: '2026-04-18T10:00:00Z',
      work_request: { title: 'Test run' },
      stages: {
        implementer: {
          status: 'in_progress',
          iterations: [{ number: 1 }, { number: 2 }, { number: 3 }],
        },
      },
    });

    // Set active project
    await mock.triggerInbound({
      text: '/use worca-cc',
      chatId: CHAT_ID,
      platform: 'telegram',
    });
    mock.send.mockClear();

    // Query status — loopback GET to /api/projects/worca-cc/runs/run-abc/status
    await mock.triggerInbound({
      text: '/status run-abc',
      chatId: CHAT_ID,
      platform: 'telegram',
    });

    expect(mock.send).toHaveBeenCalledOnce();
    const [, msg] = mock.send.mock.calls[0];
    const replyText = msg.body[0].value;
    expect(replyText).toContain('run-abc');
    expect(replyText).toContain('running');
    expect(replyText).toContain('implementer');
    expect(replyText).toContain('3');
  });
});

// ---------------------------------------------------------------------------
// Test 5: /mute → event dropped → clock advance → event delivered
// ---------------------------------------------------------------------------

describe('/mute → event dropped → clock advance → event delivered', () => {
  let httpServer, port, mock, integrations, prefsDir;

  beforeEach(async () => {
    // Fake only Date so fetch/setTimeout still use real timing (avoids undici issues)
    vi.useFakeTimers({ toFake: ['Date'] });

    process.env[ENV_SECRET] = SECRET;
    process.env[ENV_TOKEN] = TOKEN;

    prefsDir = makeTempDir();
    mock = makeTelegramAdapterMock();
    loadIntegrationsConfig.mockReturnValue(makeBaseConfig());

    const app = createApp({ prefsDir });
    ({ httpServer, port } = await startServer(app));
    integrations = createIntegrations({
      port,
      host: '127.0.0.1',
      prefsDir,
      configPath: join(prefsDir, 'integrations', 'config.json'),
    });
    app.locals.integrations = integrations;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => httpServer.close(resolve));
    delete process.env[ENV_SECRET];
    delete process.env[ENV_TOKEN];
  });

  it('mutes notifications, drops signed events while muted, delivers after clock advance', async () => {
    // 1. Trigger /mute 5m — _handleInbound awaits the full chain including _sendReply
    await mock.triggerInbound({
      text: '/mute 5m',
      chatId: CHAT_ID,
      platform: 'telegram',
    });
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.send.mock.calls[0][1].body[0].value).toMatch(/muted for 5m/);
    mock.send.mockClear();

    // 2. Call onEvent() directly with a properly signed stored event
    const envelope = {
      event_type: 'pipeline.run.completed',
      run_id: 'run-muted',
      payload: { duration_ms: 2000, total_cost_usd: 0.05 },
    };
    const rawBody = Buffer.from(JSON.stringify(envelope));
    const sig = signPayload(rawBody, SECRET);
    const stored = {
      headers: { 'x-worca-signature': sig },
      envelope,
    };
    stored[RAW_BODY] = rawBody;

    integrations.onEvent(stored);
    // Rate-limiter worker runs as microtasks; flush the queue
    await flushMicrotasks(15);
    expect(mock.send).not.toHaveBeenCalled();

    // 3. Advance the fake clock 6 minutes past the 5m mute
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    // 4. Same event now delivered — isMuted() returns false after clock advance
    integrations.onEvent(stored);
    await flushMicrotasks(15);
    expect(mock.send).toHaveBeenCalledOnce();
    const [calledChatId, msg] = mock.send.mock.calls[0];
    expect(calledChatId).toBe(CHAT_ID);
    expect(msg.severity).toBe('success');
  });
});
