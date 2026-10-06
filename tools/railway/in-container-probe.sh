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
printf '{"type":"result","subtype":"success","is_error":false,"result":"user=%s environ=%s db=%s home=%s gh=%s app=%s broker=%s ado=%s"}\n' "$(id -un)" "$(r /proc/$p/environ)" "$(r /data/worca/.worca-cc/worca-cc.db)" "$(ls /data/home >/dev/null 2>&1 && echo read || echo denied)" "${GH_TOKEN:+set}" "${WORCA_GH_APP_KEY_B64:+set}" "${WORCA_BROKER_SECRET:+set}" "${WORCA_ADO_TOKEN:+set}${WORCA_ADO_READ_TOKEN:+set}${WORCA_ADO_WRITE_TOKEN:+set}${AZURE_DEVOPS_EXT_PAT:+set}"
F
cat > /tmp/worca-probe.mjs <<'F'
import { readFileSync } from 'node:fs';
for (const kv of readFileSync(`/proc/${process.argv[2]}/environ`, 'utf8').split('\0')) {
  const i = kv.indexOf('=');
  if (i > 0 && !(kv.slice(0, i) in process.env)) process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
process.env.WORCA_MOCK = '0';
// This checks the OS boundary between worca and its agents, not the broker (section 4 does
// that): with a broker in multi mode a spawn needs a signed-in person to bill, and a probe has
// none. The broker's secret stays in the environment, so the agent's view proves the runner
// drops it.
delete process.env.WORCA_BROKER_URL;
const root = '/usr/local/lib/node_modules/@worca/app/src/core';
const { runClaude } = await import(`${root}/claude-runner.mjs`);
const r = await runClaude({ cwd: '/data/projects', prompt: 'x', bin: '/tmp/worca-probe-claude', asAgent: true });
console.log(`agent ${r.text}`);
// Azure DevOps (review minor 13): nothing here may stop the GitHub check below. A rejected fetch (DNS, egress
// proxy) or a missing module is caught and printed. In split mode with only a write token, the read header is
// null, so fall back to the write token rather than send an unauthenticated request that reads as a bad PAT.
try {
  const { readAzureCredentials, azureAuthHeader } = await import(`${root}/azure-credentials.mjs`);
  const adoMode = readAzureCredentials().mode;
  console.log(`azure ${adoMode}`);
  if (adoMode !== 'none' && process.env.WORCA_ADO_PROBE_ORG) {
    const auth = azureAuthHeader('read') || azureAuthHeader('write');
    const a = await fetch(`https://dev.azure.com/${encodeURIComponent(process.env.WORCA_ADO_PROBE_ORG)}/_apis/connectionData`,
      { headers: { ...auth, 'X-TFS-FedAuthRedirect': 'Suppress' }, signal: AbortSignal.timeout(20_000) });
    console.log(`ado ${a.status}`);
  }
} catch (e) {
  console.log(`ado FAILED ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 200)}`);
}
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
  want "agent sees" "$agent" "user=worca-agent environ=denied db=denied home=denied gh= app= broker= ado="
  [ -n "$agent" ] || printf 'info  runner said: %s\n' "$(printf '%s\n' "$out" | tail -3 | tr '\n' ' ' | cut -c1-300)"
else
  printf 'info  agent %s (no worca-agent user: isolation is off)\n' "$agent"
fi
mode=$(printf '%s\n' "$out" | sed -n 's/^github //p')
printf 'info  github mode %s\n' "${mode:-unknown}"
mint=$(printf '%s\n' "$out" | sed -n 's/^mint //p')
if [ -n "$mint" ]; then want "GitHub credential works" "$mint" 200; fi
ado_mode=$(printf '%s\n' "$out" | sed -n 's/^azure //p')
printf 'info  azure devops mode %s\n' "${ado_mode:-unknown}"
ado=$(printf '%s\n' "$out" | sed -n 's/^ado //p')
if [ -n "$ado" ]; then want "Azure DevOps credential works" "$ado" 200   # "FAILED …" fails the check with the reason
elif [ "${ado_mode:-none}" != none ]; then printf 'info  set WORCA_ADO_PROBE_ORG to test the Azure DevOps token\n'; fi

# 4. The credential broker (docs/credential-broker.md), when worca runs with one: no model key
#    anywhere an agent runs, and the broker's ports refuse an agent that has no token.
# Read as worca, which owns the process: Railway's container does not let root read it.
envof() { su -s /bin/sh worca -c "cat /proc/$1/environ" 2>/dev/null | tr '\0' '\n'; }
B=$(envof "$P" | sed -n 's/^WORCA_BROKER_URL=//p')
if [ -n "$B" ]; then
  keys=$(envof "$P" | grep -E '^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|OPENROUTER_API_KEY)=.' | cut -d= -f1 | tr '\n' ' ' | sed 's/ $//')
  want "no model key in worca's environment" "${keys:-none}" none
  if id worca-agent >/dev/null 2>&1; then
    want "broker proxy refuses an agent without a token" "$(su -s /bin/sh worca-agent -c "curl -s -o /dev/null -w '%{http_code}' $B/p/anthropic/v1/models")" 403
    want "broker internal API refuses an agent" "$(su -s /bin/sh worca-agent -c "curl -s -o /dev/null -w '%{http_code}' $B/internal/info")" 401
  fi
else
  printf 'info  no credential broker (WORCA_BROKER_URL unset)\n'
fi

# 5. One agent user per person (the pool): one person's agents can't read another's processes.
if [ -n "$(envof "$P" | sed -n 's/^WORCA_AGENT_POOL=//p')" ] && id worca-agent-01 >/dev/null 2>&1; then
  su -s /bin/sh worca -c 'sudo -n -u worca-agent-02 -- sleep 15' >/dev/null 2>&1 &
  sleep 1
  other=$(pgrep -u worca-agent-02 -n sleep)
  if [ -n "$other" ]; then
    r=$(su -s /bin/sh worca -c "sudo -n -u worca-agent-01 -- sh -c 'cat /proc/$other/environ >/dev/null 2>&1 && echo read || echo denied'")
    want "a pool user reading another pool user's process" "$r" denied
    kill "$other" 2>/dev/null
  else
    fail "could not start a process as worca-agent-02"
  fi
else
  printf 'info  no agent pool (one shared agent user)\n'
fi

[ "$fails" -eq 0 ] && echo "ALL PASS" || echo "$fails FAILED"
exit "$fails"
