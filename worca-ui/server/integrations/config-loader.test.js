import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { loadIntegrationsConfig } from './config-loader.js';

const VALID_CONFIG = {
  schema_version: 1,
  enabled: true,
  telegram: {
    enabled: true,
    bot_token_env: 'TELEGRAM_BOT_TOKEN',
    chat_id: '123456789',
    events: ['pipeline.run.completed'],
  },
};

describe('loadIntegrationsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when file does not exist', () => {
    readFileSync.mockImplementation(() => {
      const err = new Error('no such file');
      err.code = 'ENOENT';
      throw err;
    });
    const result = loadIntegrationsConfig('/fake/path/config.json');
    expect(result).toBeNull();
  });

  it('returns null and warns on invalid JSON', () => {
    readFileSync.mockReturnValue('not json {{{');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = loadIntegrationsConfig('/fake/path/config.json');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[integrations]'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it('returns null and warns when config fails validation', () => {
    readFileSync.mockReturnValue(
      JSON.stringify({ schema_version: 99, enabled: true }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = loadIntegrationsConfig('/fake/path/config.json');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[integrations]'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it('returns parsed config for valid input', () => {
    readFileSync.mockReturnValue(JSON.stringify(VALID_CONFIG));
    const result = loadIntegrationsConfig('/fake/path/config.json');
    expect(result).toMatchObject({ schema_version: 1, enabled: true });
  });

  it('returns null silently when file is missing (no ENOENT warning)', () => {
    readFileSync.mockImplementation(() => {
      const err = new Error('no such file');
      err.code = 'ENOENT';
      throw err;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadIntegrationsConfig('/fake/path/config.json');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
