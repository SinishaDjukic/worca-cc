// test/host-guard.test.mjs
// The host-process guard: a PreToolUse hook every spawned agent carries so it
// can never kill the worca server that runs it (the 2026-08-31 incident: an
// implementer's stray-server cleanup `ps aux | grep '[n]ode --disable' | … kill`
// took down its own host mid-run).
//
// Two layers:
//   1. evaluateKillCommand — the pure decision (null = allow, string = deny reason).
//   2. the hook CLI — stdin PreToolUse JSON in, exit 0 (allow) / exit 2 + stderr
//      reason (block), fail-open on garbage input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateKillCommand } from '../src/core/host-guard.mjs';

const HOST = 88275;

const deny = (cmd, why, hostPid = HOST) => {
  const reason = evaluateKillCommand(cmd, hostPid);
  assert.ok(typeof reason === 'string' && reason.length, `${why}: expected deny for ${JSON.stringify(cmd)}, got allow`);
  return reason;
};
const allow = (cmd, why, hostPid = HOST) => {
  const reason = evaluateKillCommand(cmd, hostPid);
  assert.equal(reason, null, `${why}: expected allow for ${JSON.stringify(cmd)}, got: ${reason}`);
};

// ── pattern kills are banned outright ────────────────────────────────────────

test('host-guard denies the verbatim incident loop (piped kill)', () => {
  deny("ps aux | grep '[n]ode --disable' | awk '{print $2}' | while read p; do kill $p; done",
    'the exact command that killed the server');
  deny("ps aux | grep '[n]ode --disable' | awk '{print $2}' | while read p; do kill $p 2>/dev/null; done",
    'the mop-up variant');
});

test('host-guard denies pkill / killall in any position', () => {
  deny('pkill -f node', 'pkill');
  deny('killall node', 'killall');
  deny('sudo pkill node', 'sudo prefix must not hide pkill');
  deny('ls; pkill -f server', 'pkill after ;');
  deny('true && killall -9 node', 'killall after &&');
});

test('host-guard denies kill fed by substitution, variables, or xargs', () => {
  deny('kill $SERVER_PID', 'variable arg');
  deny('kill $(cat server.pid)', 'command substitution');
  deny('kill `cat server.pid`', 'backtick substitution');
  deny("ps aux | grep node | awk '{print $2}' | xargs kill", 'xargs kill');
  deny('for p in $(pgrep node); do kill -9 $p; done', 'loop over pgrep');
  deny('FOO=1 kill $p', 'env-assignment prefix must not hide kill');
  deny('/bin/kill $p', 'absolute path kill');
});

test('host-guard denies kill wrapped in a nested shell', () => {
  deny("sh -c 'kill $p'", 'sh -c payload');
  deny('bash -c "pkill node"', 'bash -c payload');
});

test('host-guard denies group / broadcast targets', () => {
  deny('kill -- -123', 'process-group target');
  deny('kill -9 -1', 'kill everything');
});

// ── the host PID itself ──────────────────────────────────────────────────────

test('host-guard denies literal kill naming the host PID and says which PID', () => {
  const reason = deny('kill 84049 88275 84064', 'the incident\'s literal kill (one PID was the server)');
  assert.match(reason, /88275/, 'reason names the protected PID');
});

test('host-guard denies the host PID under signal flags', () => {
  deny(`kill -9 ${HOST}`, '-9 host');
  deny(`kill -TERM ${HOST}`, '-TERM host');
  deny(`kill -s TERM ${HOST}`, '-s TERM host');
  deny(`kill -- ${HOST}`, '-- host');
});

// ── legitimate kills stay allowed ────────────────────────────────────────────

test('host-guard allows literal kills of other PIDs', () => {
  allow('kill 12345', 'plain literal');
  allow('kill 12345 67890', 'several literals');
  allow('kill -9 12345', 'signal number');
  allow('kill -TERM 12345', 'signal name');
  allow('kill -s TERM 12345', '-s consumes the signal name');
  allow('kill -- 12345', 'after --');
  allow('kill %1', 'own jobspec');
  allow('kill -0 12345', 'liveness probe');
});

test('host-guard allows non-kill commands, including kill-looking text in data', () => {
  allow('', 'empty command');
  allow('npm test', 'ordinary command');
  allow("ps aux | grep '[n]ode --disable' | awk '{print $2}' | head -5", 'listing PIDs is read-only');
  allow("git commit -m 'fix; killall handling'", 'kill words inside a quoted argument');
  allow('echo kill', 'kill as data');
  allow('grep -rn pkill src/', 'kill as a search term');
});

test('host-guard without a host PID still bans pattern kills but allows literals', () => {
  allow('kill 12345', 'literal with no host pid', undefined);
  deny('pkill -f node', 'pkill with no host pid', undefined);
  deny('kill $p', 'non-literal with no host pid', undefined);
});

// ── Windows-native killers (agents on Windows reach taskkill / PowerShell /
// wmic through Git Bash just as easily as `kill`) ────────────────────────────

test('host-guard denies taskkill by image name (the Windows pattern kill)', () => {
  deny('taskkill /IM node.exe /F', 'taskkill /IM');
  deny('taskkill /F /IM node.exe', 'flag order must not matter');
  deny('taskkill.exe /IM node.exe', '.exe suffix');
  deny('cmd /c "taskkill /IM node.exe"', 'nested cmd /c payload');
});

test('host-guard checks literal taskkill /PID targets against the host PID', () => {
  deny(`TASKKILL /PID ${HOST} /F`, 'host PID, case-insensitive command');
  deny('taskkill /PID %SERVER_PID% /F', 'cmd-style variable is non-literal');
  allow('taskkill /PID 12345 /F', 'literal other PID');
  allow('taskkill /PID 12345 /T /F', 'tree+force flags on a literal PID');
});

test('host-guard denies PowerShell Stop-Process by name, bare (pipeline-fed), or nested', () => {
  deny('Stop-Process -Name node', 'Stop-Process -Name');
  deny('spps -Name node', 'spps alias');
  deny('Get-Process node | Stop-Process', 'pipeline-fed Stop-Process');
  deny('Stop-Process -Force', 'bare Stop-Process (input must come from a pipe)');
  deny('powershell -Command "Stop-Process -Name node"', 'nested powershell payload');
  deny('pwsh -c "taskkill /IM node.exe"', 'nested pwsh payload');
});

test('host-guard checks literal Stop-Process -Id targets against the host PID', () => {
  deny(`stop-process -id ${HOST}`, 'host PID, lowercase');
  deny(`Stop-Process -Id 12345,${HOST}`, 'host PID inside a comma list');
  allow('Stop-Process -Id 12345', 'literal other PID');
  allow('Stop-Process -Id 12345,67890', 'comma list of other PIDs');
});

test('host-guard denies wmic process deletion but allows read-only process listing', () => {
  deny('wmic process where "name=\'node.exe\'" delete', 'wmic delete');
  deny('wmic process where "name=\'node.exe\'" call terminate', 'wmic terminate');
  allow('Get-Process node', 'read-only Get-Process');
  allow('tasklist | findstr node', 'read-only tasklist');
});

// ── review fixes (2026-09-01 host-guard review: MAJ-1, MAJ-2, 2 minors) ──────

test('host-guard denies xargs feeding Windows killers (MAJ-1)', () => {
  deny("ps aux | grep node | awk '{print $2}' | xargs taskkill /F /PID", 'the incident transposed to Git Bash on Windows');
  deny('pgrep node | xargs -I% taskkill /F /PID %', 'xargs -I placeholder spelling');
  deny('pgrep node | xargs TASKKILL.EXE /F /PID', 'case + .exe');
});

test('host-guard allows literal kills with spaced redirects and trailing comments (MAJ-2)', () => {
  allow('kill 12345 > /dev/null 2>&1', 'spaced redirect operand is not a target');
  allow('kill 12345 >> kill.log', 'spaced append redirect');
  allow('kill 12345 # stop the dev server', 'trailing comment');
  deny(`kill ${HOST} > /dev/null`, 'host PID still caught in front of a redirect');
  deny('kill $p # cleanup', 'a comment must not launder a variable target');
});

test('host-guard catches wmic delete across parentheses (minor)', () => {
  deny('wmic process where (name="node.exe") delete', 'parenthesized WHERE splits segments');
  allow('wmic process where (name="node.exe") get processid', 'parenthesized read-only query');
  allow('wmic process list brief', 'plain listing');
});

test('host-guard allows running script FILES whose name contains kill words (minor)', () => {
  allow('bash scripts/kill-dev-server.sh', 'bash script-file arg, no -c');
  allow('sh ./killall-strays.sh', 'sh script-file arg');
  deny("bash -c 'kill $p'", 'inline -c payloads stay denied');
  deny('powershell "Stop-Process -Name node"', 'powershell bare argument IS an inline command');
});

// ── review fixes (2026-09-02 PR #408 review: {} placeholder bypass) ──────────
// `{`/`}` are segment separators, so without the __ph__ replacement in
// stripQuotes the braces of `-I{}` / `-exec … {}` vanish before the checks run:
// the xargs segment loses its kill word and the kill segment loses its targets.

test('host-guard denies xargs -I{} kill (the brace placeholder spelling)', () => {
  deny('pgrep node | xargs -I{} kill {}', 'attached -I{}');
  deny('pgrep node | xargs -I {} kill -9 {}', 'spaced -I {}');
  deny("ps aux | grep '[n]ode --disable' | awk '{print $2}' | xargs -I{} kill {}",
    'the incident transposed to -I{}');
});

test('host-guard denies find -exec kill', () => {
  deny('find . -name "*.pid" -exec kill {} \\;', 'find -exec kill');
  deny("find /tmp -name 'server*.pid' -execdir kill -9 '{}' +", 'find -execdir, quoted braces');
  deny('find . -name node.pid -ok kill {} \\;', 'find -ok still fans out');
  allow('find . -name "*.log" -exec rm {} \\;', 'find -exec of a non-killer stays allowed');
  allow('find . -name kill.txt', 'kill-looking find pattern without -exec');
});

test('host-guard treats a bare {} kill target as non-literal', () => {
  deny('kill {}', 'a placeholder is not a literal PID');
});

// ── the hook CLI ─────────────────────────────────────────────────────────────

const SCRIPT = fileURLToPath(new URL('../src/core/host-guard.mjs', import.meta.url));

function runHook(stdin, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [SCRIPT], { env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

test('hook CLI blocks a banned Bash command with exit 2 and a reason on stderr', async () => {
  const { code, stderr } = await runHook(
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pkill -f node' } }),
    { WORCA_HOST_PID: String(HOST) },
  );
  assert.equal(code, 2);
  assert.match(stderr, /pkill/i);
});

test('hook CLI blocks the host PID kill with exit 2', async () => {
  const { code, stderr } = await runHook(
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: `kill ${HOST}` } }),
    { WORCA_HOST_PID: String(HOST) },
  );
  assert.equal(code, 2);
  assert.match(stderr, new RegExp(String(HOST)));
});

test('hook CLI allows a safe kill and other tools', async () => {
  const ok = await runHook(
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'kill 12345' } }),
    { WORCA_HOST_PID: String(HOST) },
  );
  assert.equal(ok.code, 0);
  const read = await runHook(
    JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }),
    { WORCA_HOST_PID: String(HOST) },
  );
  assert.equal(read.code, 0);
});

test('hook CLI fails open on garbage input', async () => {
  const { code } = await runHook('not json at all', { WORCA_HOST_PID: String(HOST) });
  assert.equal(code, 0);
});
