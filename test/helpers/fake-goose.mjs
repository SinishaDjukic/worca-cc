// test/helpers/fake-goose.mjs — a POSIX stand-in for the goose binary: it records its argv, env, cwd, stdin and the
// MCP wrapper scripts its `--with-extension` values name (and the env file beside each) at spawn time, then prints canned
// stream-json lines.
// `--version` prints a version and exits `versionExit`, without touching the records. `db` records one model reply in
// goose's session database first, as goose does per reply (its `usage_ledger` row, the session row made if missing);
// `hold` waits to be stopped after the lines.
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
 * @param {{lines?:object[]|null, exit?:number, stderr?:string, versionExit?:number, hold?:boolean,
 *   db?:{file:string, input?:number, output?:number, cost?:number|null}}} [o]
 */
export function fakeGoose(dir, reply, { lines: given = null, exit = 0, stderr = '', versionExit = 0, hold = false, db = null } = {}) {
  const bin = join(dir, 'goose');
  const rec = join(dir, 'goose-record.json');
  const out = join(dir, 'goose-out.jsonl');
  const lines = given || gooseReplyLines(reply);
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  // No single quote inside: the script rides a single-quoted sh word. The wrapper path is shell-quoted (shWord).
  const record = 'const fs=require("fs");const a=process.argv.slice(1);const w={};const e={};const q=String.fromCharCode(39);' +
    'for(let i=0;i<a.length;i++)if(a[i]==="--with-extension"){const f=a[i+1].split(q).join("");try{w[f]=fs.readFileSync(f,"utf8")}catch{w[f]=null}' +
    'try{e[f]={text:fs.readFileSync(f+".env","utf8"),mode:fs.statSync(f+".env").mode&511}}catch{}}' +
    `fs.writeFileSync(${JSON.stringify(rec)},JSON.stringify({args:a,env:process.env,cwd:process.cwd(),stdin:fs.readFileSync(0,"utf8"),wrappers:w,envFiles:e}))`;
  let dbLine = '';
  if (db) {
    const script = join(dir, 'goose-db.mjs');
    writeFileSync(script, [
      "import { createRequire } from 'node:module'; import { mkdirSync } from 'node:fs'; import { dirname } from 'node:path';",
      `const o = ${JSON.stringify({ input: 0, output: 0, cost: null, ...db })};`,
      "const a = process.argv.slice(2); const name = a[a.indexOf('--name') + 1];",
      "mkdirSync(dirname(o.file), { recursive: true });",
      "const d = new (createRequire(import.meta.url)('node:sqlite').DatabaseSync)(o.file);",
      "d.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, created_timestamp INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, cost REAL)');",
      "let id = d.prepare('SELECT id FROM sessions WHERE name = ?').get(name)?.id;",
      "if (!id) { id = `20261024_${Date.now()}`; d.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(id, name); }",
      "d.prepare('INSERT INTO usage_ledger (session_id, created_timestamp, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, 1, ?, ?, 0, 0, ?)').run(id, o.input, o.output, o.cost);",
      'd.close();',
    ].join('\n'));
    dbLine = `node ${JSON.stringify(script)} "$@"\n`;
  }
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo " 1.54.0"; exit ${versionExit}; fi\n` +
    `node -e '${record}' -- "$@"\n${dbLine}cat ${JSON.stringify(out)}\n${stderr ? `echo ${JSON.stringify(stderr)} >&2\n` : ''}` +
    `${hold ? 'exec sleep 600\n' : ''}exit ${exit}\n`);
  chmodSync(bin, 0o755);
  const read = () => (existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null);
  return { bin, record: read, args: () => read()?.args ?? null, env: () => read()?.env ?? null };
}
