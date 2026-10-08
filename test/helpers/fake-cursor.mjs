// test/helpers/fake-cursor.mjs — a POSIX stand-in for the cursor-agent binary: it records its argv, env, cwd and
// the cwd's `.cursor/cli.json` / `.cursor/mcp.json` at spawn time, then prints a canned stream-json run.
// `status` prints `statusText` and exits `statusExit` (the sign-in check), without touching the records.
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The stream-json lines of one successful Cursor run whose reply is `text`. */
export function cursorReplyLines(text, chatId = '00000000-0000-4000-8000-0000000000ca') {
  return [
    { type: 'system', subtype: 'init', session_id: chatId, model: 'Auto' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: chatId },
    { type: 'result', subtype: 'success', is_error: false, result: text, session_id: chatId },
  ];
}

/**
 * @param {string} dir
 * @param {string|null} reply
 * @param {{fail?:string|null, exit?:number, lines?:object[]|null, statusText?:string, statusExit?:number}} [o]
 */
export function fakeCursor(dir, reply, { fail = null, exit = 0, lines: given = null, statusText = 'Logged in as dev@example.com', statusExit = 0 } = {}) {
  const bin = join(dir, 'cursor-agent');
  const rec = join(dir, 'cursor-record.json');
  const out = join(dir, 'cursor-out.jsonl');
  const lines = given || (fail
    ? [{ type: 'system', subtype: 'init', session_id: '00000000-0000-4000-8000-0000000000cb' }, { type: 'result', subtype: 'error', is_error: true, result: fail }]
    : cursorReplyLines(reply));
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const record = `const fs=require("fs"),p=require("path");const r=(f)=>{try{return fs.readFileSync(p.join(process.cwd(),".cursor",f),"utf8")}catch{return null}};` +
    `fs.writeFileSync(${JSON.stringify(rec)},JSON.stringify({args:process.argv.slice(1),env:process.env,cwd:process.cwd(),cli:r("cli.json"),mcp:r("mcp.json")}))`;
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "status" ]; then echo ${JSON.stringify(statusText)}; exit ${statusExit}; fi\n` +
    `node -e '${record}' -- "$@"\ncat ${JSON.stringify(out)}\nexit ${exit}\n`);
  chmodSync(bin, 0o755);
  const read = () => (existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null);
  return { bin, record: read, args: () => read()?.args ?? null, env: () => read()?.env ?? null };
}
