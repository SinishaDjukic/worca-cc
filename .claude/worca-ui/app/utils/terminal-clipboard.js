/**
 * Extract all text from an xterm.js terminal's scrollback buffer.
 * @param {import('@xterm/xterm').Terminal|null} terminal
 * @returns {string}
 */
export function getTerminalText(terminal) {
  if (!terminal) return '';
  const buffer = terminal.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    lines.push(line ? line.translateToString(true) : '');
  }
  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.join('\n');
}

/**
 * Copy full terminal buffer text to clipboard and show visual feedback on the button.
 * @param {import('@xterm/xterm').Terminal|null} terminal
 * @param {HTMLElement} buttonEl
 * @returns {Promise<void>}
 */
export async function copyTerminalToClipboard(terminal, buttonEl) {
  const text = getTerminalText(terminal);
  try {
    await navigator.clipboard.writeText(text);
    buttonEl.classList.add('copy-success');
    setTimeout(() => buttonEl.classList.remove('copy-success'), 1500);
  } catch {
    // Clipboard API unavailable — silently ignore
  }
}
