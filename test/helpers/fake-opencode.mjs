// test/helpers/fake-opencode.mjs — a POSIX stand-in for the opencode binary. `run` records its argv, env, cwd and
// stdin, then prints a canned `--format json` run. `--version` prints a version; `providers list` prints
// `providersText`, `auth list --standalone --format json` prints `authText` (2.x, a JSON array);
// `export <id>` / `session export <id>` print `exportDoc` (a sub-session) and record the id.
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The `--format json` lines of one successful OpenCode run whose reply is `text`. */
export function opencodeReplyLines(text, sessionID = 'ses_fake0000000000000000000001', { cost = 0.0123, tokens = null } = {}) {
  const t = tokens || { total: 130, input: 100, output: 20, reasoning: 5, cache: { write: 0, read: 5 } };
  return [
    { type: 'step_start', timestamp: 1, sessionID, part: { id: 'prt_1', messageID: 'msg_1', sessionID, type: 'step-start' } },
    { type: 'text', timestamp: 2, sessionID, part: { id: 'prt_2', messageID: 'msg_1', sessionID, type: 'text', text } },
    { type: 'step_finish', timestamp: 3, sessionID, part: { id: 'prt_3', reason: 'stop', messageID: 'msg_1', sessionID, type: 'step-finish', tokens: t, cost } },
  ];
}

/**
 * @param {string} dir
 * @param {string|null} reply
 * @param {{lines?:object[]|null, exit?:number, stderr?:string, providersText?:string, authText?:string,
 *   modelsText?:string, exportDoc?:object|null, version?:string|null, exportCommand?:string}} [o]
 *   authText: the 2.x `auth list` JSON document; modelsText: what `opencode models` prints (one provider/model per
 *   line); exportCommand: 'export' (1.x) or 'session-export' (2.x) — which subcommand answers a sub-session export.
 */
export function fakeOpencode(dir, reply, { lines: given = null, exit = 0, stderr = '', providersText = '1 credentials\n0 environment variables',
  authText = null, modelsText = null, exportDoc = null, version = '1.18.23', exportCommand = 'export' } = {}) {
  const bin = join(dir, 'opencode');
  const rec = join(dir, 'opencode-record.json');
  const exports = join(dir, 'opencode-exports.txt');
  const out = join(dir, 'opencode-out.jsonl');
  const err = join(dir, 'opencode-err.txt');
  const exp = join(dir, 'opencode-export.json');
  const models = join(dir, 'opencode-models.txt');
  writeFileSync(out, (given || opencodeReplyLines(reply)).map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(err, stderr);
  writeFileSync(exp, exportDoc ? JSON.stringify(exportDoc) : '');
  // Write modelsText VERBATIM (real newlines, not printf-escaped) so the `models` output parses like the CLI's.
  writeFileSync(models, modelsText ?? '');
  const record = `const fs=require("fs");let s="";try{s=fs.readFileSync(0,"utf8")}catch{}` +
    `fs.writeFileSync(${JSON.stringify(rec)},JSON.stringify({args:process.argv.slice(1),env:process.env,cwd:process.cwd(),stdin:s}))`;
  const shell = '#!/bin/sh\n' +
    (version === null ? 'if [ "$1" = "--version" ]; then exit 127; fi\n' : `if [ "$1" = "--version" ]; then echo ${JSON.stringify(version)}; exit 0; fi\n`) +
    `if [ "$1" = "providers" ]; then printf '%s\\n' ${JSON.stringify(providersText)}; exit 0; fi\n` +
    (authText === null ? '' : `if [ "$1" = "auth" ]; then printf '%s\\n' ${JSON.stringify(authText)}; exit 0; fi\n`) +
    (modelsText === null ? '' : `if [ "$1" = "models" ]; then node -e '${record}' -- "$@" </dev/null; cat ${JSON.stringify(models)}; exit 0; fi\n`) +
    `if [ "$1" = "export" ]; then echo "$2" >> ${JSON.stringify(exports)}; cat ${JSON.stringify(exp)}; exit 0; fi\n` +
    (exportCommand !== 'session-export' ? '' : `if [ "$1" = "session" ] && [ "$2" = "export" ]; then echo "$3" >> ${JSON.stringify(exports)}; cat ${JSON.stringify(exp)}; exit 0; fi\n`) +
    `node -e '${record}' -- "$@"\ncat ${JSON.stringify(out)}\ncat ${JSON.stringify(err)} >&2\nexit ${exit}\n`;
  writeFileSync(bin, shell);
  chmodSync(bin, 0o755);
  const read = () => (existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null);
  return {
    bin, record: read, args: () => read()?.args ?? null, env: () => read()?.env ?? null,
    config: () => { const c = read()?.env?.OPENCODE_CONFIG_CONTENT; return c ? JSON.parse(c) : null; },
    exported: () => (existsSync(exports) ? readFileSync(exports, 'utf8').split('\n').filter(Boolean) : []),
  };
}
