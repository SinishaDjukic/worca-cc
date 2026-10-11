// test/helpers/fake-codex.mjs — a POSIX stand-in for the codex binary: it records its argv and env and
// prints a canned `codex exec --json` stream. fakeCodex(dir, 'Some reply') answers with that
// text; fakeCodex(dir, null, { fail: '401 Unauthorized' }) ends the turn failed.
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The JSONL lines of one successful codex turn whose reply is `text`. */
export function codexReplyLines(text) {
  return [
    { type: 'thread.started', thread_id: '00000000-0000-4000-8000-0000000000aa' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20 } },
  ];
}

/**
 * @param {string} dir where the bin, its argv record and its canned output are written
 * @param {string|null} reply the agent_message text (ignored with `fail`)
 * @param {{fail?: string|null, exit?: number, lines?: object[]|null}} [o] `lines`: the whole stream, verbatim
 * @returns {{bin: string, args: () => (string[]|null), env: () => (Record<string,string>|null)}}
 */
export function fakeCodex(dir, reply, { fail = null, exit = 0, lines: given = null } = {}) {
  const bin = join(dir, 'codex');
  const argsOut = join(dir, 'codex-args.json');
  const envOut = join(dir, 'codex-env.json');
  const out = join(dir, 'codex-out.jsonl');
  const lines = given || (fail
    ? [{ type: 'thread.started', thread_id: '00000000-0000-4000-8000-0000000000ab' }, { type: 'turn.failed', error: { message: fail } }]
    : codexReplyLines(reply));
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(bin, `#!/bin/sh\nnode -e 'require("fs").writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify(process.argv.slice(1))); require("fs").writeFileSync(${JSON.stringify(envOut)}, JSON.stringify(process.env))' -- "$@"\ncat > /dev/null\ncat ${JSON.stringify(out)}\nexit ${exit}\n`);
  chmodSync(bin, 0o755);
  return {
    bin,
    args: () => (existsSync(argsOut) ? JSON.parse(readFileSync(argsOut, 'utf8')) : null),
    env: () => (existsSync(envOut) ? JSON.parse(readFileSync(envOut, 'utf8')) : null),
  };
}
