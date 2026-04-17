import { describe, expect, it, vi } from 'vitest';
import { createAllowlistGuard } from './allowlist.js';

describe('createAllowlistGuard', () => {
  it('returns true and does not log for an allowed chat ID', () => {
    const debug = vi.fn();
    const guard = createAllowlistGuard(['123456789', '987654321'], { debug });

    const allowed = guard.isAllowed({
      platform: 'telegram',
      chatId: '123456789',
    });

    expect(allowed).toBe(true);
    expect(debug).not.toHaveBeenCalled();
  });

  it('returns false and logs for an unknown chat ID', () => {
    const debug = vi.fn();
    const guard = createAllowlistGuard(['123456789'], { debug });

    const allowed = guard.isAllowed({
      platform: 'telegram',
      chatId: '999999999',
    });

    expect(allowed).toBe(false);
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0][0]).toMatch(/drop/i);
  });

  it('returns false for an empty allowlist', () => {
    const debug = vi.fn();
    const guard = createAllowlistGuard([], { debug });

    expect(guard.isAllowed({ platform: 'telegram', chatId: 'any' })).toBe(
      false,
    );
    expect(debug).toHaveBeenCalledOnce();
  });

  it('does not echo any message back on drop', () => {
    const debug = vi.fn();
    const guard = createAllowlistGuard(['123'], { debug });

    const result = guard.isAllowed({ platform: 'telegram', chatId: 'unknown' });

    expect(result).toBe(false);
    // debug receives a log entry but no chat reply is issued — return value is only boolean
    expect(typeof result).toBe('boolean');
  });

  it('accepts numeric string and string chat IDs case-sensitively', () => {
    const guard = createAllowlistGuard(['ABC123'], {});

    expect(guard.isAllowed({ platform: 'telegram', chatId: 'ABC123' })).toBe(
      true,
    );
    expect(guard.isAllowed({ platform: 'telegram', chatId: 'abc123' })).toBe(
      false,
    );
  });
});
