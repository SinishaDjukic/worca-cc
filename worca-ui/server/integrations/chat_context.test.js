import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatContext } from './chat_context.js';

let tmpDir;
let filePath;
let ctx;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chat_context_test_'));
  filePath = join(tmpDir, 'chat_context.json');
  ctx = createChatContext(filePath);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createChatContext', () => {
  it('returns default state for an unknown key', () => {
    const state = ctx.get('telegram:123');
    expect(state).toEqual({
      active_project: null,
      mute_until: null,
      muted_messages: 0,
    });
  });

  it('creates the file on first set', () => {
    ctx.set('telegram:123', { active_project: 'worca-cc' });
    expect(existsSync(filePath)).toBe(true);
  });

  it('persists state to disk and reads it back', () => {
    ctx.set('telegram:123', { active_project: 'worca-cc' });
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.schema_version).toBe(1);
    expect(raw.chats['telegram:123'].active_project).toBe('worca-cc');
  });

  it('merges patch fields without clobbering existing ones', () => {
    ctx.set('telegram:123', { active_project: 'worca-cc', muted_messages: 3 });
    ctx.set('telegram:123', { mute_until: '2026-12-31T23:59:59Z' });
    const state = ctx.get('telegram:123');
    expect(state.active_project).toBe('worca-cc');
    expect(state.muted_messages).toBe(3);
    expect(state.mute_until).toBe('2026-12-31T23:59:59Z');
  });

  it('namespaces are isolated — telegram:123 and discord:123 are independent', () => {
    ctx.set('telegram:123', { active_project: 'proj-a' });
    ctx.set('discord:123', { active_project: 'proj-b' });
    expect(ctx.get('telegram:123').active_project).toBe('proj-a');
    expect(ctx.get('discord:123').active_project).toBe('proj-b');
  });

  it('different numeric IDs on the same platform are isolated', () => {
    ctx.set('telegram:100', { muted_messages: 1 });
    ctx.set('telegram:200', { muted_messages: 5 });
    expect(ctx.get('telegram:100').muted_messages).toBe(1);
    expect(ctx.get('telegram:200').muted_messages).toBe(5);
  });

  it('rapid sequential writes all commit without loss', () => {
    for (let i = 0; i < 50; i++) {
      ctx.set('telegram:rapid', { muted_messages: i });
    }
    expect(ctx.get('telegram:rapid').muted_messages).toBe(49);
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.chats['telegram:rapid'].muted_messages).toBe(49);
  });

  it('rapid writes across multiple keys all commit without loss', () => {
    const keys = ['telegram:1', 'discord:1', 'slack:1', 'telegram:2'];
    for (let i = 0; i < 20; i++) {
      for (const key of keys) {
        ctx.set(key, { muted_messages: i });
      }
    }
    for (const key of keys) {
      expect(ctx.get(key).muted_messages).toBe(19);
    }
  });

  it('survives a fresh createChatContext on the same file (reload)', () => {
    ctx.set('telegram:999', { active_project: 'proj-x', muted_messages: 42 });
    const ctx2 = createChatContext(filePath);
    const state = ctx2.get('telegram:999');
    expect(state.active_project).toBe('proj-x');
    expect(state.muted_messages).toBe(42);
  });

  it('uses atomic write — no .tmp file remains after set', () => {
    ctx.set('telegram:123', { active_project: 'worca-cc' });
    const tmpFile = `${filePath}.tmp`;
    expect(existsSync(tmpFile)).toBe(false);
  });

  it('isMuted returns false when mute_until is null', () => {
    ctx.set('telegram:123', { mute_until: null });
    expect(ctx.isMuted('telegram:123')).toBe(false);
  });

  it('isMuted returns false for an unknown key', () => {
    expect(ctx.isMuted('telegram:unknown')).toBe(false);
  });

  it('isMuted returns true when mute_until is in the future', () => {
    ctx.set('telegram:123', { mute_until: '9999-12-31T23:59:59Z' });
    expect(ctx.isMuted('telegram:123')).toBe(true);
  });

  it('isMuted returns false when mute_until is in the past', () => {
    ctx.set('telegram:123', { mute_until: '2000-01-01T00:00:00Z' });
    expect(ctx.isMuted('telegram:123')).toBe(false);
  });

  it('isMuted treats the indefinite sentinel as indefinitely muted', () => {
    ctx.set('telegram:123', { mute_until: '9999-12-31T23:59:59Z' });
    expect(ctx.isMuted('telegram:123')).toBe(true);
  });

  it('incrementMuted increments the muted_messages counter', () => {
    ctx.incrementMuted('telegram:123');
    ctx.incrementMuted('telegram:123');
    expect(ctx.get('telegram:123').muted_messages).toBe(2);
  });

  it('incrementMuted starts from existing counter value', () => {
    ctx.set('telegram:123', { muted_messages: 7 });
    ctx.incrementMuted('telegram:123');
    expect(ctx.get('telegram:123').muted_messages).toBe(8);
  });

  it('creates parent directory if it does not exist', () => {
    const nestedPath = join(tmpDir, 'sub', 'dir', 'chat_context.json');
    const ctx2 = createChatContext(nestedPath);
    ctx2.set('telegram:1', { active_project: 'x' });
    expect(existsSync(nestedPath)).toBe(true);
  });

  it('file on disk uses schema_version 1', () => {
    ctx.set('telegram:1', { active_project: 'x' });
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.schema_version).toBe(1);
  });
});
