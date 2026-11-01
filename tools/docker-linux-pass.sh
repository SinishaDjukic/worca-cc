#!/bin/sh
# tools/docker-linux-pass.sh — the trust-boundary checks that need real Linux sockets and users, against a
# built worca image (the #854 review's V3, V10 and V18). Runs on a Docker host (Linux, or a Linux VM):
#
#   npm run docker:build -- --tag worca:linux-pass
#   sh tools/docker-linux-pass.sh worca:linux-pass
#
# It starts the image in the single-volume, agent-isolation layout (docker/compose.isolation.yml: root
# entrypoint, worca-agent + the pool) with WORCA_MOCK=1, then checks:
#   V3   a caller on 127/8 other than 127.0.0.1 (127.0.0.2, 127.1.2.3) is still "this box": as the agent
#        user, without the instance token, HTTP, the /ws upgrade and /api/terminal answer 403 (G1); with
#        the token from ui.json the same peer gets 200.
#   V10  tmp/ask is sticky (3770 worca:worca-share); a relay MCP config claimed for one person's agent
#        (claimFileForAgent) is 0640 in that agent's own group: that agent reads it, another pool user
#        neither reads nor deletes it.
#   V18  Docker's published port arrives from the container's default-route gateway and is let in (G4);
#        another container on the same network, sending `Host: localhost`, gets 403.
# Prints PASS/FAIL lines and exits 1 on any FAIL. Leaves nothing behind (container, network, volume).
img="${1:-ghcr.io/sinishadjukic/worca:dev}"
port="${WORCA_PASS_PORT:-47917}"
tag="worca-linux-pass-$$"
fails=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
want() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: got $2, want $3"; fi; }
cleanup() { docker rm -f "$tag" >/dev/null 2>&1; docker network rm "$tag" >/dev/null 2>&1; docker volume rm "$tag" >/dev/null 2>&1; }
trap cleanup EXIT INT TERM

docker network create "$tag" >/dev/null || exit 1
docker run -d --name "$tag" --network "$tag" -p "127.0.0.1:$port:4317" -v "$tag:/data" \
  --user 0:0 -e WORCA_DATA_DIR=/data -e WORCA_MOCK=1 \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add FSETID \
  --cap-add SETUID --cap-add SETGID --cap-add AUDIT_WRITE --cap-add KILL "$img" >/dev/null || exit 1
i=0
until docker exec "$tag" curl -fsS -o /dev/null -H 'Host: localhost' http://127.0.0.1:4317/api/health 2>/dev/null; do
  i=$((i + 1)); if [ "$i" -gt 90 ]; then fail "the server never answered /api/health"; docker logs "$tag" 2>&1 | tail -20; exit 1; fi
  sleep 1
done
pid=$(docker exec "$tag" pgrep -u worca -o node)
iso=$(docker exec -u worca "$tag" sh -c "tr '\\0' '\\n' < /proc/$pid/environ | grep -c '^WORCA_AGENT_USER=worca-agent$'")
want "the server runs with agent isolation on" "$iso" 1

# Agents run through worca's sudo, which sets each pool user's own group too (`docker exec -u` would not).
as_user() { u="$1"; shift; docker exec -u worca "$tag" sudo -n -u "$u" -- "$@"; }

# V3: other 127/8 peers are this box too.
as_agent() { as_user worca-agent "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
tok=$(docker exec "$tag" sh -c "sed -n 's/.*\"token\"[[:space:]]*:[[:space:]]*\"\\([0-9a-f]*\\)\".*/\\1/p' /data/worca/.worca-cc/ui.json")
[ -n "$tok" ] || fail "no instance token in ui.json"
for src in 127.0.0.2 127.1.2.3; do
  want "V3 HTTP from $src, no token -> 403" "$(as_agent curl -s -o /dev/null -w '%{http_code}' --interface "$src" -H 'Host: localhost' http://127.0.0.1:4317/api/projects)" 403
  want "V3 /api/terminal from $src, no token -> 403" "$(as_agent curl -s -o /dev/null -w '%{http_code}' --interface "$src" -H 'Host: localhost' http://127.0.0.1:4317/api/terminal)" 403
  ws=$(as_agent node --input-type=module -e "
    const { execSync } = await import('node:child_process');
    const { WebSocket } = await import(execSync('npm root -g').toString().trim() + '/@worca/app/node_modules/ws/wrapper.mjs');
    const s = new WebSocket('ws://127.0.0.1:4317/ws', { localAddress: '$src', headers: { host: 'localhost:4317' } });
    s.on('open', () => { console.log('open'); process.exit(0); });
    s.on('unexpected-response', (_q, r) => { console.log(r.statusCode); process.exit(0); });
    s.on('error', (e) => { console.log('error ' + e.message); process.exit(0); });
    setTimeout(() => { console.log('timeout'); process.exit(0); }, 5000);")
  want "V3 /ws upgrade from $src, no token -> 403" "$ws" 403
  want "V3 HTTP from $src with the instance token -> 200" "$(as_agent curl -s -o /dev/null -w '%{http_code}' --interface "$src" -H 'Host: localhost' -H "x-worca-ui-token: $tok" http://127.0.0.1:4317/api/projects)" 200
done

# V10: the Ask scratch dir and a relay MCP config claimed for one person's agent.
want "V10 tmp/ask mode and owner" "$(docker exec "$tag" stat -c '%a %U %G' /data/worca/.worca-cc/tmp/ask)" "3770 worca worca-share"
claimed=$(docker exec -u worca "$tag" sh -c "export \$(tr '\\0' '\\n' < /proc/$pid/environ | grep -E '^(WORCA_AGENT_|WORCA_HOME=|HOME=)' | xargs); cd /tmp && node --input-type=module -e \"
  const { execSync } = await import('node:child_process');
  const root = execSync('npm root -g').toString().trim() + '/@worca/app/src/core';
  const { writeFileSync } = await import('node:fs');
  const { claimFileForAgent } = await import(root + '/agent-user.mjs');
  const { agentIdentityFor } = await import(root + '/agent-pool.mjs');
  const id = agentIdentityFor('ada@acme.dev');
  const f = process.env.WORCA_HOME + '/.worca-cc/tmp/ask/mcp-linux-pass.json';
  writeFileSync(f, '{}', { mode: 0o640 });
  claimFileForAgent(f, id);
  console.log(id.user + ' ' + f);
\"")
owner=${claimed%% *}; file=${claimed#* }
other=$(docker exec "$tag" sh -c "getent passwd | cut -d: -f1 | grep -E '^worca-agent-[0-9]{2}$' | grep -v '^$owner$' | head -1")
if [ -z "$owner" ] || [ -z "$other" ]; then fail "V10 could not claim a file for a pool user ($claimed)"; else
  want "V10 relay MCP config mode and group" "$(docker exec "$tag" stat -c '%a %G' "$file")" "640 $owner"
  want "V10 its agent reads it" "$(as_user "$owner" sh -c "cat '$file' >/dev/null 2>&1 && echo read || echo denied")" read
  want "V10 another person's agent cannot read it" "$(as_user "$other" sh -c "cat '$file' >/dev/null 2>&1 && echo read || echo denied")" denied
  want "V10 another person's agent cannot delete it (sticky)" "$(as_user "$other" sh -c "rm -f '$file' 2>/dev/null; test -e '$file' && echo kept || echo gone")" kept
fi

# V18: the published port and a sidecar on the same network.
printf 'info  default-route gateway in the box: %s\n' "$(docker exec "$tag" sh -c "awk 'NR>1 && \$2==\"00000000\" {print \$3}' /proc/net/route")"
want "V18 the published port (from this host) -> 200" "$(code -H 'Host: localhost' "http://127.0.0.1:$port/api/projects")" 200
want "V18 another container on the network, Host: localhost -> 403" "$(docker run --rm --network "$tag" --entrypoint curl "$img" -s -o /dev/null -w '%{http_code}' -H 'Host: localhost' "http://$tag:4317/api/projects")" 403

[ "$fails" -eq 0 ] && echo "linux pass: all checks passed" || echo "linux pass: $fails check(s) failed"
[ "$fails" -eq 0 ]
