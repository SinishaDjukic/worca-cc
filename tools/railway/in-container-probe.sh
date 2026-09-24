#!/bin/sh
# tools/railway/in-container-probe.sh — checks that only make sense INSIDE a hosted worca
# container (run as root over `railway ssh`; worca-railway.mjs `verify --in-container`
# pipes this file to `sh -s -- <public host>`). Prints facts and PASS/FAIL lines, never a
# secret value: environments are read by the processes that need them, not echoed.
#
#   1. requests that bypass Cloudflare Access are refused by worca itself
#   2. the server runs as worca; agents run as worca-agent and cannot read its secrets
#   3. the GitHub credential mode, and that worca can mint/use it (App: a real mint)
host="${1:-worca.example.com}"
fails=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
want() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: got $2, want $3"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
P=$(pgrep -u worca -o node)
[ -n "$P" ] || { fail "no worca node process"; exit 1; }

# 1. Bypassing Access
want "public Host, no token -> 401" "$(code -H "Host: $host" http://127.0.0.1:4317/api/projects)" 401
want "public Host, forged token -> 401" "$(code -H "Host: $host" -H 'Cf-Access-Jwt-Assertion: eyJhbGciOiJSUzI1NiIsImtpZCI6ImsifQ.eyJhIjoxfQ.c2ln' http://127.0.0.1:4317/api/projects)" 401
want "foreign Host -> 403" "$(code -H 'Host: evil.example' http://127.0.0.1:4317/api/projects)" 403
want "in-container localhost -> 200" "$(code http://127.0.0.1:4317/api/projects)" 200

# 2. Users and the agent boundary
want "node processes run as" "$(ps -C node -o user= | sort -u | tr '\n' ' ' | sed 's/ $//')" worca
if id worca-agent >/dev/null 2>&1; then
  want "sudo worca -> worca-agent" "$(su -s /bin/sh worca -c 'sudo -n -u worca-agent -- id -un' 2>&1)" worca-agent
  if su -s /bin/sh worca -c 'sudo -n -u root -- true' >/dev/null 2>&1; then fail "sudo worca -> root is allowed"; else pass "sudo worca -> root refused"; fi
fi
printf 'info  perms %s\n' "$(stat -c '%a:%G:%n' /data/projects /data/worca/.worca-cc /data/worca/.worca-cc/runs /data/worca/.worca-cc/store 2>/dev/null | tr '\n' ' ')"

cat > /tmp/worca-probe-claude <<'F'
#!/bin/sh
p=$(pgrep -u worca -o node)
r() { if cat "$1" >/dev/null 2>&1; then echo read; else echo denied; fi; }
printf '{"type":"result","subtype":"success","is_error":false,"result":"user=%s environ=%s db=%s home=%s gh=%s app=%s"}\n' "$(id -un)" "$(r /proc/$p/environ)" "$(r /data/worca/.worca-cc/worca-cc.db)" "$(ls /data/home >/dev/null 2>&1 && echo read || echo denied)" "${GH_TOKEN:+set}" "${WORCA_GH_APP_KEY_B64:+set}"
F
cat > /tmp/worca-probe.mjs <<'F'
import { readFileSync } from 'node:fs';
for (const kv of readFileSync(`/proc/${process.argv[2]}/environ`, 'utf8').split('\0')) {
  const i = kv.indexOf('=');
  if (i > 0 && !(kv.slice(0, i) in process.env)) process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
process.env.WORCA_MOCK = '0';
const root = '/usr/local/lib/node_modules/@worca/app/src/core';
const { runClaude } = await import(`${root}/claude-runner.mjs`);
const r = await runClaude({ cwd: '/data/projects', prompt: 'x', bin: '/tmp/worca-probe-claude', asAgent: true });
console.log(`agent ${r.text}`);
const { githubEnv, readGithubCredentials } = await import(`${root}/github-credentials.mjs`);
const mode = readGithubCredentials().mode;
console.log(`github ${mode}`);
if (mode === 'none') process.exit(0);
const { env, error } = await githubEnv('read');
if (error) { console.log(`mint FAILED ${error}`); process.exit(0); }
const url = mode === 'app' ? 'https://api.github.com/installation/repositories?per_page=1' : 'https://api.github.com/user';
const res = await fetch(url, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
console.log(`mint ${res.status}`);
F
chmod 755 /tmp/worca-probe-claude; chmod 644 /tmp/worca-probe.mjs
out=$(su -s /bin/sh worca -c "cd /data/projects && umask 0007 && node --no-warnings /tmp/worca-probe.mjs $P" 2>&1)
rm -f /tmp/worca-probe.mjs /tmp/worca-probe-claude
agent=$(printf '%s\n' "$out" | sed -n 's/^agent //p')
if id worca-agent >/dev/null 2>&1; then
  want "agent sees" "$agent" "user=worca-agent environ=denied db=denied home=denied gh= app="
else
  printf 'info  agent %s (no worca-agent user: isolation is off)\n' "$agent"
fi
mode=$(printf '%s\n' "$out" | sed -n 's/^github //p')
printf 'info  github mode %s\n' "${mode:-unknown}"
mint=$(printf '%s\n' "$out" | sed -n 's/^mint //p')
if [ -n "$mint" ]; then want "GitHub credential works" "$mint" 200; fi

[ "$fails" -eq 0 ] && echo "ALL PASS" || echo "$fails FAILED"
exit "$fails"
