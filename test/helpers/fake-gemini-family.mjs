// test/helpers/fake-gemini-family.mjs — POSIX stand-ins for the `gemini` and `qwen` binaries. Each records its argv,
// env, cwd, stdin, the cwd's `.gemini/settings.json`, the `--admin-policy` file and the `QWEN_CODE_SYSTEM_SETTINGS_PATH`
// file at spawn time, then prints a canned stream-json run. `--version` prints a version without touching the records.
// `resumeError` (with `resumeExit`) answers a `--resume` the way the real CLI answers an unknown session: stderr only.
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The stream-json lines of one successful Gemini CLI run whose reply is `text`. */
export function geminiReplyLines(text, sessionId = '00000000-0000-4000-8000-0000000000e1') {
  return [
    { type: 'init', timestamp: 't', session_id: sessionId, model: 'auto' },
    { type: 'message', timestamp: 't', role: 'assistant', content: text, delta: true },
    { type: 'result', timestamp: 't', status: 'success', stats: { total_tokens: 12, input_tokens: 10, output_tokens: 2, cached: 4, input: 6, duration_ms: 1, tool_calls: 0 } },
  ];
}

/** The stream-json lines of one successful Qwen Code run whose reply is `text`. */
export function qwenReplyLines(text, sessionId = '00000000-0000-4000-8000-0000000000a1') {
  return [
    { type: 'system', subtype: 'init', uuid: sessionId, session_id: sessionId, cwd: '/x', tools: [], mcp_servers: [], model: 'qwen3-coder', permission_mode: 'yolo' },
    { type: 'assistant', uuid: 'u1', session_id: sessionId, parent_tool_use_id: null, message: { id: 'm1', type: 'message', role: 'assistant', model: 'qwen3-coder', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 2 } } },
    { type: 'result', subtype: 'success', uuid: 'r1', session_id: sessionId, is_error: false, num_turns: 1, result: text, usage: { input_tokens: 10, output_tokens: 2 }, permission_denials: [] },
  ];
}

/**
 * @param {string} dir
 * @param {'gemini'|'qwen'} name
 * @param {{lines?:object[], exit?:number, stderr?:string, resumeError?:string|null, resumeExit?:number}} [o]
 */
function fakeBin(dir, name, { lines, exit = 0, stderr = '', resumeError = null, resumeExit = 1 } = {}) {
  const bin = join(dir, name);
  const rec = join(dir, `${name}-record.json`);
  const out = join(dir, `${name}-out.jsonl`);
  const err = join(dir, `${name}-err.txt`);
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(err, stderr);
  const record = 'const fs=require("fs"),p=require("path");const r=(f)=>{try{return f?fs.readFileSync(f,"utf8"):null}catch{return null}};' +
    'const a=process.argv.slice(1);const i=a.indexOf("--admin-policy");' +
    `fs.writeFileSync(${JSON.stringify(rec)},JSON.stringify({args:a,env:process.env,cwd:process.cwd(),stdin:fs.readFileSync(0,"utf8"),` +
    'gemini:r(p.join(process.cwd(),".gemini","settings.json")),policy:i>=0?r(a[i+1]):null,system:r(process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH)}))';
  const resume = resumeError
    ? `for a in "$@"; do if [ "$a" = "--resume" ]; then cat > /dev/null; echo ${JSON.stringify(resumeError)} >&2; exit ${resumeExit}; fi; done\n` : '';
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.0.1; exit 0; fi\n${resume}` +
    `node -e '${record}' -- "$@"\ncat ${JSON.stringify(err)} >&2\ncat ${JSON.stringify(out)}\nexit ${exit}\n`);
  chmodSync(bin, 0o755);
  const read = () => (existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null);
  return { bin, record: read, args: () => read()?.args ?? null, env: () => read()?.env ?? null };
}

export const fakeGemini = (dir, reply, o = {}) => fakeBin(dir, 'gemini', { lines: o.lines || geminiReplyLines(reply ?? ''), ...o });
export const fakeQwen = (dir, reply, o = {}) => fakeBin(dir, 'qwen', { lines: o.lines || qwenReplyLines(reply ?? ''), ...o });
