// test/helpers/terminal-cli.mjs — run the Worca CLI in a real pseudo-terminal (node-pty), as a person at a terminal
// does: `worca secrets export|reset|ack` run only there, and only when the word they show is typed back. `answer`:
// 'word' types the word shown, 'wrong' types another, 'enter' presses Enter (cancel). stdout and stderr arrive as one
// stream on a terminal, so the result has `output` (ANSI codes and \r stripped), not the two.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
export const CLI = resolve(fileURLToPath(new URL('../..', import.meta.url)), 'src', 'cli', 'worca-cc.mjs');
const WORD_RE = /Type ([A-Z]+-[A-Z2-9]{4}) to confirm/;
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

/** Whether a pseudo-terminal can be made here (node-pty loads and spawns). Tests skip without one. */
export function ptyAvailable() {
  try { require('node-pty'); return process.platform !== 'win32'; } catch { return false; }
}

/** @returns {Promise<{code: number, output: string, word: string|null}>} */
export function runInTerminal(args, { env = process.env, answer = 'word', timeoutMs = 60_000 } = {}) {
  const pty = require('node-pty');
  return new Promise((res, rej) => {
    const t = pty.spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { cols: 200, rows: 40, env });
    let raw = '';
    let word = null;
    const timer = setTimeout(() => { try { t.kill(); } catch { /* gone */ } rej(new Error(`runInTerminal: timed out\n${plain(raw)}`)); }, timeoutMs);
    t.onData((d) => {
      raw += d;
      const m = !word && plain(raw).match(WORD_RE);
      if (m) {
        word = m[1];
        const typed = answer === 'word' ? word : answer === 'wrong' ? `${word.split("-")[0]}-ZZZ1` : '';
        t.write(`${typed}\r`);
      }
    });
    t.onExit(({ exitCode }) => { clearTimeout(timer); res({ code: exitCode, output: plain(raw), word }); });
  });
}
