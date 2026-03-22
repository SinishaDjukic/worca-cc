import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTerminalText, copyTerminalToClipboard } from './terminal-clipboard.js';

function makeMockTerminal(lines) {
  const bufferLines = lines.map(text => ({
    translateToString: () => text,
  }));
  return {
    buffer: {
      active: {
        length: bufferLines.length,
        getLine: (i) => bufferLines[i] || null,
      },
    },
  };
}

function makeBtn() {
  const classes = new Set();
  return {
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls),
    },
  };
}

describe('getTerminalText', () => {
  it('returns joined lines from mock terminal buffer', () => {
    const t = makeMockTerminal(['line one', 'line two', 'line three']);
    expect(getTerminalText(t)).toBe('line one\nline two\nline three');
  });

  it('trims trailing blank lines', () => {
    const t = makeMockTerminal(['hello', '', '  ', '']);
    expect(getTerminalText(t)).toBe('hello');
  });

  it('returns empty string for null terminal', () => {
    expect(getTerminalText(null)).toBe('');
  });

  it('returns empty string for empty buffer', () => {
    const t = makeMockTerminal([]);
    expect(getTerminalText(t)).toBe('');
  });

  it('returns empty string when all lines are blank', () => {
    const t = makeMockTerminal(['', '  ', '']);
    expect(getTerminalText(t)).toBe('');
  });

  it('preserves internal blank lines', () => {
    const t = makeMockTerminal(['first', '', 'third']);
    expect(getTerminalText(t)).toBe('first\n\nthird');
  });
});

describe('copyTerminalToClipboard', () => {
  let writeText;
  const origNavigator = globalThis.navigator;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    globalThis.navigator = { clipboard: { writeText } };
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.navigator = origNavigator;
    vi.useRealTimers();
  });

  it('calls clipboard.writeText with extracted text', async () => {
    const t = makeMockTerminal(['hello world']);
    const btn = makeBtn();
    await copyTerminalToClipboard(t, btn);
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('adds copy-success class to button on success', async () => {
    const t = makeMockTerminal(['content']);
    const btn = makeBtn();
    await copyTerminalToClipboard(t, btn);
    expect(btn.classList.contains('copy-success')).toBe(true);
  });

  it('removes copy-success class after 1500ms', async () => {
    const t = makeMockTerminal(['content']);
    const btn = makeBtn();
    await copyTerminalToClipboard(t, btn);
    vi.advanceTimersByTime(1500);
    expect(btn.classList.contains('copy-success')).toBe(false);
  });

  it('handles null terminal gracefully', async () => {
    const btn = makeBtn();
    await copyTerminalToClipboard(null, btn);
    expect(writeText).toHaveBeenCalledWith('');
  });

  it('handles missing clipboard API gracefully', async () => {
    globalThis.navigator = {};
    const t = makeMockTerminal(['text']);
    const btn = makeBtn();
    await expect(copyTerminalToClipboard(t, btn)).resolves.toBeUndefined();
  });
});
