# E2B kill and egress checks (2026-10-22)

Answers to the two E2B questions in `plans/core-protection-layer-design.md` §9 ("E2B group kill",
"E2B egress API") and relay spike 2's open check 8 ("E2B `envd` kill semantics for descendants").
All of it was measured on the local self-hosted E2B in the Lima VM `e2b`. E2B Cloud was not used.

## Setup

- **Server.** Local Lima VM `e2b`. Firecracker guest kernel `6.1.177+`, envd `0.9.202609130627+59497eb9134`.
  The VM was in the VZ `error` state at the start (every API call got `ECONNRESET`), so it was
  restarted with `limactl stop -f e2b`, `limactl start e2b` and `docker compose up -d --wait`.
- **SDK.** `e2b@2.56.0`, the version `package.json` pins on `claude/e2b-multi-engine-relay-2343bb`.
  It ran from throwaway scripts; copies are in the side-session notes folder under `e2b-kill-egress-scripts/`.
- **Templates.** `base` (2 vCPU / 512 MB) for most runs. The kill checks were repeated on
  `worca-agent` with the same results. Every sandbox was killed in a `finally`. No templates were
  built, and `Sandbox.list()` was empty at the end.
- **Command shape.** Commands started the way `remote-child.mjs` and the model relay start them:
  `sb.commands.run(cmd, { background: true, stdin: true })`. Stop was `handle.kill()`, which the SDK
  sends as signal 9.

The test tree (`/tmp/tree.sh`) has a child shell with a `sleep 600` grandchild, and a child shell
that runs `trap "" TERM` and has a `sleep 601` grandchild. The escape variant adds
`setsid bash -c 'sleep 603' &` and a double fork, `( setsid bash -c 'sleep 604 &' ) &`.

## 1. Process tree on stop

### Where envd puts a command

```
    PID    PPID    PGID     SID USER     CMD
      1       0       1       1 root     /sbin/init
    173       1     173     173 root     /usr/bin/envd
   1256     173     173     173 user     /bin/bash -l -c <cmd>
$ cat /proc/self/cgroup        ->  0::/user
$ cat /proc/173/cgroup         ->  0::/system.slice/envd.service
```

- A command does **not** get its own session or process group. Every command, from every
  `commands.run`, shares envd's pgid and sid (173 on `base`, 262 on `worca-agent`). They also share
  one cgroup, `/user`.
- So `kill -- -<pgid>` on the default group is unusable: it is envd's group, and it holds every
  other command too, the model relay included.
- Commands run as `user` (uid 1000). envd runs as root.

### Results

| Scenario | How it was stopped | Survivors after 2 s |
|---|---|---|
| plain `bash /tmp/tree.sh` | `handle.kill()` (SIGKILL to the pid) | **both child shells and both sleeps**, now children of PID 1 |
| plain | raw `rpc.sendSignal({…, signal: 15})` (SIGTERM) | **all four**, the same as above |
| `setsid -w bash /tmp/tree.sh` | `handle.kill()` only | **all four**, in pgid 1260 = handle pid |
| `setsid -w …` | `handle.kill()`, then a second command `kill -KILL -- -<handle.pid>` | none |
| `setsid -w …` | only the second command `kill -KILL -- -<handle.pid>` | none; `handle.wait()` rejects with `signal: killed` at once |
| `setsid -w …` + a grandchild that runs `setsid` itself | `kill -KILL -- -<handle.pid>` | **`sleep 603` survives** (own session) |
| root wrapper: per-command cgroup + `runuser -u user` | `echo 1 > <cg>/cgroup.kill` (as root) | none, **escapees included** (`sleep 603`, double-forked `sleep 604`) |
| supervisor script (`set -m`, a watcher polls the supervisor pid, kills `-pgid`) | `handle.kill()` | none; detection depends on the poll |
| the same supervisor | `commands.closeStdin(pid)` (it kills the group on stdin EOF) | tree killed, but **`handle.wait()` hung**: see below |

Plain, `handle.kill()`:

```
--- before
   1259     173     173     173 S     \_ bash /tmp/tree.sh
   1261    1259     173     173 S     |   \_ bash -c sleep 600 & wait
   1264    1261     173     173 S     |   |   \_ sleep 600
   1262    1259     173     173 S     |   \_ bash -c trap "" TERM; sleep 601 & wait
   1265    1262     173     173 S     |       \_ sleep 601
kill -> true
wait -> {"err":"signal: killed","exit":-1}
--- after
   1261       1     173     173 S    bash -c sleep 600 & wait
   1264    1261     173     173 S     \_ sleep 600
   1262       1     173     173 S    bash -c trap "" TERM; sleep 601 & wait
   1265    1262     173     173 S     \_ sleep 601
```

`setsid`, then a group kill from a second command:

```
--- before (handle pid 1260)
   1260     173    1260    1260 Ss    \_ bash /tmp/tree.sh
   1262    1260    1260    1260 S     |   \_ bash -c sleep 600 & wait
   ...
$ kill -KILL -- -1260; echo rc=$?     ->  rc=0
wait -> {"err":"signal: killed","exit":-1}
--- after
(nothing)
```

An escapee survives the group kill:

```
   1276     173    1276    1276 user     Ss    \_ bash /tmp/tree.sh
   1279    1276    1276    1276 user     S     |   \_ bash -c sleep 600 & wait
   1282    1279    1276    1276 user     S     |   |   \_ sleep 600
   1283    1276    1283    1283 user     Ss    |   \_ sleep 603
--- after group kill
   1283       1    1283    1283 user     Ss   sleep 603
```

A per-command cgroup kills everything (on `worca-agent` too):

```
# commands.run(line, { background: true, stdin: true, user: 'root', envs: { FOO: 'bar' } }) with
line = mkdir -p /sys/fs/cgroup/user/worca-step-1 && echo $$ > /sys/fs/cgroup/user/worca-step-1/cgroup.procs \
       && exec runuser -u user -- bash /tmp/tree.sh
[out] tree as user cg=0::/user/worca-step-1 HOME=/home/user FOO=bar
procs in cg: 1264 1269 1272 1273 1274 1276 1277 1278      (includes the setsid'd 1274 and double-forked 1278)
# commands.run('echo 1 > /sys/fs/cgroup/user/worca-step-1/cgroup.kill', { user: 'root' })  -> rc=0
wait -> {"err":"signal: killed"}
procs in cg: []           rmdir -> rc=0
```

### Side findings

- **`setsid` is installed** (`/usr/bin/setsid`) in `base` and `worca-agent`. `runuser` is too.
- **The handle pid becomes the group leader.** envd runs `bash -l -c "<line>"`. A single
  `setsid …` gets exec'd by bash, and since that process is not already a group leader, `setsid`
  calls `setsid()` without forking. So pgid = sid = `handle.pid`, and **no per-spawn pgid file is
  needed**. Write the line as `exec setsid -w …` so this does not depend on bash's exec
  optimisation. The `< stdinFile` redirect that `remote-child.mjs` appends still works.
- **envd accepts SIGTERM.** The proto's `sendSignal` takes 15, and the command ended with
  `signal: terminated`. The public SDK only exposes `kill()` (9), so this goes through the internal
  `commands.rpc`. It reaches one pid only, so a group TERM still needs `kill -TERM -- -<pgid>` from
  a second command.
- **`wait()` hangs on leaked stdout.** `commands.run('sleep 8 & echo parent-done')` returned after
  **8.0 s**. With the child's output redirected to `/dev/null` it returned in 0.0 s. envd waits for
  stdout/stderr EOF, and the exited process stays a zombie until then. A step whose agent leaves a
  background shell child holding the pipe does not "close" until that child exits. The group kill
  fixes this for stop. Normal exit still waits on leaked children. That is a separate concern for
  `remote-child` (the step looks hung, not done).
- **The stdin-EOF supervisor needs more care than it is worth.** The watcher subshell kept the
  stdout pipe open. Its `kill -0 $parent` poll also stays true while the parent is a zombie, and
  the parent stays a zombie because of that open pipe. That deadlocked `wait()`. It can be fixed,
  but setsid plus a group kill does the same job with fewer moving parts.
- **`user` has passwordless sudo** (`sudo -n true` succeeds in `base` and `worca-agent`). The
  agent can leave a cgroup or a process group if it wants to. Both mechanisms stop accidental
  survivors (shell children, daemons, `setsid`), not a hostile agent. A full-sandbox stop
  (`Sandbox.kill`) is the only hard boundary. `user` cannot create cgroups itself
  (`mkdir /sys/fs/cgroup/user/x: Permission denied`), so the cgroup wrapper must start as root.

### Recommendation (design §4 item 2, §9 "E2B group kill")

1. **Per step, use setsid plus a group kill.** It is the smallest change and matches the design
   text. `RemoteChild` runs `exec setsid -w <cmd>`, and pgid is `remotePid`. On stop:
   `commands.run('kill -TERM -- -<pid>')`, then after `sigkillGraceMs()` `kill -KILL -- -<pid>`,
   then `handle.kill()` as a backstop. Drop the per-spawn pgid file from the design. The fake's
   group kill (`e2b-fake.mjs:22-23`) matches this.
2. **To also catch escapees, use a per-step cgroup.** This is optional and stronger. It is the only
   option tested that killed the `setsid` and double-fork escapees (the OpenCode own-session case in
   relay spike 2). It costs more:
   - the command starts as root, then drops privileges with `runuser -u user --` (env and HOME
     survived);
   - stop is `echo 1 > cgroup.kill` as root, then `rmdir`.

   Use it if the conformance suite shows an engine whose children leave their session. Otherwise
   option 1 is enough.
3. **Keep the model relay out of both.** It is a separate `commands.run` with its own pid, group
   and (if used) cgroup. A step's group kill never reaches it. Never signal envd's default group.
4. A whole-run stop keeps `Sandbox.kill`. Nothing inside survives it.

## 2. Egress: `Sandbox.create({ network })` on SDK 2.56.0

The SDK types say `allowOut` accepts "a CIDR block, a bare IP address, or a domain name
(`example.com`, `*.example.com`)", while `denyOut` takes CIDRs and IPs only. The self-hosted build
enforces that.

| Config | Result |
|---|---|
| `{ allowOut: ['github.com'] }` | **create fails**: `400: When specifying allowed domains in allow out, you must include 'ALL_TRAFFIC' in deny out to block all other traffic.` |
| `{ denyOut: ['github.com'] }` | **create fails**: `400: invalid denied CIDR github.com` |
| `{ allowOut: ['github.com'], denyOut: ['0.0.0.0/0'] }` | accepted; `getInfo().network` echoes it |
| `{ allowOut: ['1.1.1.1'], denyOut: ['0.0.0.0/0'] }` | accepted |
| `{ allowOut: ['1.1.1.0/24', 'registry.npmjs.org'], denyOut: ['0.0.0.0/0'] }` | accepted (mixed works) |
| `{ denyOut: ['0.0.0.0/0'] }` / `allowInternetAccess: false` | accepted, and both behave the same |

`0.0.0.0/0` is exported as `ALL_TRAFFIC`.

Probes (`curl -s -o /dev/null -m 6 -w '%{http_code} ip=%{remote_ip}'`):

| Probe | baseline | allow `github.com` | allow `github.com`, `*.github.com` | allow `1.1.1.1` | deny all |
|---|---|---|---|---|---|
| https://github.com | 200 | **200** | 200 | rc 28 (no DNS) | rc 28 |
| http://github.com (port 80) | — | 301 | 301 | rc 28 | — |
| https://api.github.com | 200 | **rc 35** (exact name only) | 200 | rc 28 | rc 28 |
| https://registry.npmjs.org | 200 | **rc 35** | rc 35 | rc 28 | rc 28 |
| https://1.1.1.1 | 301 | **rc 35** | rc 35 | 301 | rc 35 |
| github.com:22 (ssh banner, raw socket) | — | `b''` (blocked) | `b''` | no DNS | — |
| `curl -k --resolve github.com:443:1.1.1.1 https://github.com` | 403 | **200 (passes)** | 200 | 403 | rc 35 |
| `curl -H 'Host: github.com' http://1.1.1.1` | 409 | **301 (passes)** | — | — | rc 52 |
| in-sandbox `python3 -m http.server --bind 127.0.0.1` then curl it | 200 | 200 | 200 | 200 | **200** |

### What this means

- **Host names work, on two conditions.** `denyOut` must contain `0.0.0.0/0`. And
  `*.example.com` matches subdomains only, not the apex, so worca's `.example.com` (apex and
  subdomains, `compose.egress.yml:10-11`) maps to `['example.com', '*.example.com']`. The default
  `WORCA_EGRESS_ALLOW` list becomes:

  ```
  allowOut: ['api.anthropic.com', 'github.com', '*.github.com', 'githubusercontent.com', '*.githubusercontent.com', 'registry.npmjs.org']
  denyOut:  ['0.0.0.0/0']
  ```

  An empty `allow` list is `denyOut: ['0.0.0.0/0']` alone.
- **Domain rules are matched on TLS SNI or the HTTP `Host` header, not on the destination IP.** A
  client that names an allowed host in SNI or `Host` reaches **any IP**: `--resolve
  github.com:443:1.1.1.1` got 200 from Cloudflare. So an allowed domain does not stop an agent that
  wants to exfiltrate to its own server. It stops tools and agents that do not try to get around
  it. IP/CIDR entries are matched on the IP. compose's forward proxy (CONNECT by name, then a DNS
  lookup it does itself) holds better here, so the docs must not call them equivalent.
- **Only HTTP(S) gets through by name.** ssh to github.com:22 is dropped, because there is no SNI
  or Host header to match. `git@github.com:` remotes fail under `allow`; HTTPS remotes work.
- **The loopback relay still works under deny all** (`127.0.0.1:8787` → 200). That fits the
  design: the model relay rides the command's stdio and loopback, so `allow` with an empty list
  still runs agents.
- **Egress is enforced outside the guest.** The guest's `iptables -S` / `nft list ruleset` are empty
  (default route via `169.254.0.22`), yet filtering applies. So `user`'s sudo cannot lift it.

## 3. DNS and raw sockets under `denyOut`

| Probe | allow `github.com` (name rule) | allow `1.1.1.1` (IP only) | allow `1.1.1.0/24` + name | deny all |
|---|---|---|---|---|
| UDP DNS to the configured resolver 8.8.8.8 (arbitrary name `exfil-test-123.example.com`) | **reply, rcode 0** | timeout | reply | timeout |
| UDP DNS to 1.1.1.1 | timeout | reply (IP allowed) | reply | timeout |
| UDP DNS to 9.9.9.9 | timeout | timeout | timeout | timeout |
| `getent hosts registry.npmjs.org` | resolves | timeout | resolves | timeout |
| raw TCP `connect(1.1.1.1:443)` | — | — | — | **"connected"**, no data afterwards (curl rc 35/52, `recv` → `b''`) |
| ICMP `ping 1.1.1.1` | 100 % loss | — | — | 100 % loss |
| IPv6 | none in any mode (`curl -6` rc 7 at baseline) | | | |

- **Deny all blocks DNS too.** `getent` times out, and UDP/53 to any resolver times out.
- **Any name rule opens DNS to the sandbox's resolver (8.8.8.8) for every name**, not only the
  allowed ones. That is a DNS-tunnel exfil channel whenever `allow` lists a host. An IP-only list
  does not open it.
- **Raw sockets do not get around the rules.** A TCP `connect()` to a denied IP "succeeds" because
  the host-side proxy accepts it, but no byte comes back and the connection closes. UDP to anything
  except the allowed resolver, ICMP and IPv6 all fail. The real bypasses are the SNI/Host spoof
  and DNS tunnelling above, not raw sockets.

### Recommendation (design §4.6 "Sandbox egress allowlist", §9 "E2B egress API")

- Keep the design's `egress: 'open' | 'allow'`. With `allow`, `backends/e2b.mjs` passes
  `network: { allowOut: toE2bAllow(list), denyOut: [ALL_TRAFFIC] }`. `toE2bAllow` maps `.x` to
  `x` + `*.x` and keeps IPs/CIDRs as they are. An empty list sends `denyOut` only.
- Validate at create. E2B returns a 400 for a name in `denyOut`, or for a name in `allowOut`
  without `0.0.0.0/0`. Make that a `config` error, not a lost sandbox.
- In the UI and docs, describe E2B `allow` as **stopping casual egress, not a determined agent**.
  Name the two gaps: SNI/Host spoofing to any IP, and DNS to the resolver once any host name is
  listed. Also say that ssh git remotes fail.
- The relay needs nothing: loopback works under deny all.
- Not tested (outside scope): `Sandbox.updateNetwork` at runtime (`PUT /sandboxes/{id}/network`
  exists in the API types), and E2B Cloud's behaviour. The SDK notes say the SOCKS `egressProxy` is
  Cloud/BYOC only.

## Relay spike 2, check 8

Closed. envd's SIGKILL reaches only the command's own pid, so descendants reparent to PID 1 and
keep running. Its SIGTERM does the same. This matches what spike 2 saw for Gemini, Qwen, Goose and
OpenCode. Fix as recommended in §1: `exec setsid -w` plus a group TERM→KILL from a second command,
or a per-step cgroup for engines whose children leave their session.
