// test/helpers/fake-goose.mjs — a POSIX stand-in for the goose binary: it records its argv, env, cwd, stdin and the
// MCP wrapper scripts its `--with-extension` values name at spawn time, then prints canned stream-json lines.
// `--version` prints a version and exits `versionExit`, without touching the records.
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The stream-json lines of one successful goose run whose reply is `text`. */
export function gooseReplyLines(text, { costUsd = 0.0012 } = {}) {
  return [
    { type: 'message', message: { id: 'm-1', role: 'assistant', created: 1, content: [{ type: 'text', text }] } },
    { type: 'complete', total_tokens: 120, input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_write_input_tokens: 0,
      ...(costUsd != null ? { cost_usd: costUsd } : {}) },
  ];
}

/**
 * @param {string} dir
 * @param {string|null} reply
 * @param {{lines?:object[]|null, exit?:number, stderr?:string, versionExit?:number}} [o]
 */
export function fakeGoose(dir, reply, { lines: given = null, exit = 0, stderr = '', versionExit = 0 } = {}) {
  const bin = join(dir, 'goose');
  const rec = join(dir, 'goose-record.json');
  const out = join(dir, 'goose-out.jsonl');
  const lines = given || gooseReplyLines(reply);
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  // No single quote inside: the script rides a single-quoted sh word. The wrapper path is shell-quoted (shWord).
  const record = 'const fs=require("fs");const a=process.argv.slice(1);const w={};const q=String.fromCharCode(39);' +
    'for(let i=0;i<a.length;i++)if(a[i]==="--with-extension"){const f=a[i+1].split(q).join("");try{w[f]=fs.readFileSync(f,"utf8")}catch{w[f]=null}}' +
    `fs.writeFileSync(${JSON.stringify(rec)},JSON.stringify({args:a,env:process.env,cwd:process.cwd(),stdin:fs.readFileSync(0,"utf8"),wrappers:w}))`;
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo " 1.54.0"; exit ${versionExit}; fi\n` +
    `node -e '${record}' -- "$@"\ncat ${JSON.stringify(out)}\n${stderr ? `echo ${JSON.stringify(stderr)} >&2\n` : ''}exit ${exit}\n`);
  chmodSync(bin, 0o755);
  const read = () => (existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null);
  return { bin, record: read, args: () => read()?.args ?? null, env: () => read()?.env ?? null };
}
