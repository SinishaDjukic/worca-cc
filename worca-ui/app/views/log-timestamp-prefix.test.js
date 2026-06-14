/**
 * Unit tests for the terminal timestamp column helper `tsPrefix`, defined
 * identically in log-viewer.js (Log History) and live-output.js (Live Output).
 *
 * Contract:
 *  - a real ISO timestamp → dim local HH:MM:SS
 *  - explicit null         → dim "--:--:--" placeholder (legacy line, time unknown)
 *  - undefined / missing    → empty (no column) for synthetic entries
 */

import { describe, expect, it } from 'vitest';
import { tsPrefix as liveTsPrefix } from './live-output.js';
import { tsPrefix as historyTsPrefix } from './log-viewer.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

for (const [name, tsPrefix] of [
  ['log-viewer', historyTsPrefix],
  ['live-output', liveTsPrefix],
]) {
  describe(`tsPrefix (${name})`, () => {
    it('renders "--:--:--" for an explicit null (legacy line)', () => {
      expect(tsPrefix(null)).toBe(`${DIM}--:--:--${RESET} `);
    });

    it('renders an empty column for undefined (synthetic entry)', () => {
      expect(tsPrefix(undefined)).toBe('');
    });

    it('renders a dim local time for a real ISO timestamp', () => {
      const out = tsPrefix('2026-06-14T12:00:00.000+00:00');
      expect(out.startsWith(DIM)).toBe(true);
      expect(out.endsWith(`${RESET} `)).toBe(true);
      // HH:MM:SS, 24-hour — exact value depends on the runtime timezone.
      expect(out).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });
}
