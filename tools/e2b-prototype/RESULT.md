# E2B prototype — result

Run on 2026-10-18 against the self-hosted E2B (API `http://127.0.0.1:3000`, sandbox traffic
`http://127.0.0.1:3002`, through an SSH tunnel), template `worca-agent`, SDK `e2b` 2.56.0,
Node 26 on the host. Command:

```bash
node tools/e2b-prototype/prototype.mjs --out <dir>
```

Exit code 0. Total time 29.7 s. The OAuth token in `~/.config/worca-e2b/model.sh` was replaced after the
run of 2026-10-17, which failed c–e with `401 OAuth access token is invalid`.

## Pass/fail

- a. throwaway repo: **PASS**. 5 files, 1 commit.
- b. sandbox + bundle clone: **PASS**. Sandbox created in 0.3 s; bundle uploaded and cloned in 1.0 s; clone
  HEAD equals the local HEAD. The clone's only remote is the bundle file: no GitHub, no token. The sandbox
  runs as `user`, HOME `/home/user`, Claude Code 2.1.294, git 2.39.5, node 22.23.3.
- c. streamed `claude -p` step: **PASS**. A longer turn: 8 tool calls (4 reads, `node check.mjs`, an edit,
  `node check.mjs` again, a write), 9 turns, 14.9 s. 21 stream-json events arrived through `onStdout` as they
  happened, one about every second; 19 of them came more than 1 s before the command exited. **The first
  event (init, +2.3 s) arrived 12.6 s before the process exited.** The step checks the edit and that
  `step1.txt` holds the `check.mjs` output from before (`Hello, Ada`) and after (`Hi, Ada!`) the edit.
- d1. question written: **PASS**. Step 2 (`--resume` of step 1) wrote a valid `question.json` with id `q1`
  and left `src/greet.js` alone.
- d2. `--resume` uses earlier context: **PASS**. Step 3 resumed step 2, which had itself resumed step 1, so
  the code word crossed two resumes. It added `farewell` with the given answer and wrote the answer and
  the code word from the first prompt (`KITE-1D9195`) to `answer-used.txt`.
- e. download `/home/user/worca-out`: **PASS**. 3 files (`step1.txt`, `question.json`,
  `answer-used.txt`) through tar + `files.read` + local extract in 0.2 s.
- f. commits back as a bundle: **PASS**. This time the agent's own change went back (`src/greet.js`, +5 −1);
  no fallback change was needed. Commit in the sandbox, `git bundle create <base>..main`, download,
  `git bundle verify`, fetch, `merge --ff-only`: fast-forward, local HEAD equals sandbox HEAD, and the sha256
  of `git diff --binary <base> HEAD` matches on both sides.
- g. pause + connect: **PASS**, and the sandbox really paused. `pause()` returned `true` after 0.2 s. Right
  after it, `Sandbox.getInfo` reported state `paused` (it was `running` before), `Sandbox.list` with
  `state: ['paused']` included the sandbox, and a command on the old handle failed with
  `SandboxNotRunningError`. `Sandbox.connect` took 0.8 s; the state then read `running`. A file written
  before the pause read back `alive`, the commit was still HEAD, the kernel boot id was unchanged and a
  `sleep` process started before the pause was still alive: a full memory snapshot, not a reboot from disk.
  The fast pause is real on this stack (a small, mostly idle sandbox).
- h. cleanup: **PASS**. The sandbox was removed in the `finally` block; a list by
  `{purpose: "worca-e2b-prototype"}` found no leftovers.

## Not tested

- Worca's own orchestrator on E2B: the prototype drives the SDK directly, not a worca run.
- Large repos and large downloads; a dropped tunnel in the middle of a step.
- A pause long enough for E2B to evict the snapshot to storage, a paused sandbox past its timeout, and the
  `mode: 'filesystem'` pause.
- Rate limits and long agent turns (each `rate_limit_event` above was informational; no step was throttled).
- The API-key credential (`ANTHROPIC_API_KEY`); only the OAuth token was used.

## Notes

- Neither the API key nor the OAuth token appears in the output: both are cut to their first 4 characters.
  The log was also checked for the full values before this file was written.
- Local paths are shortened to `<tmp>` and `<out>` below.

## Output (redacted)

```text
[21:47:46.646 +   0.0s] E2B API http://127.0.0.1:3000, sandbox URL http://127.0.0.1:3002, key e2b_…, token sk-a…
[21:47:46.748 +   0.1s] PASS a. local repo - <tmp>/worca-e2b-proto-mypACN/repo at daae00b5 (5 files, 1 commit)
[21:47:47.037 +   0.4s] sandbox ikqi7r7p7swpgdidxq6xy created from worca-agent in 0.3s
[21:47:48.128 +   1.5s] PASS b. sandbox + bundle clone - clone HEAD daae00b5 (local daae00b5) in 1.0s; user /home/user 2.1.294 (Claude Code) git version 2.39.5 node v22.23.3
[21:47:48.177 +   1.5s] sandbox clone's origin is the bundle file: /home/user/repo.bundle
[21:47:48.177 +   1.5s] step1: start
[21:47:50.438 +   3.8s] step1: event system/init session=f638a113-1ab6-446a-9110-541eb5f899d8 model=claude-sonnet-5-5
[21:47:52.116 +   5.5s] step1: event assistant [tool_use:Read]
[21:47:52.143 +   5.5s] step1: event rate_limit_event
[21:47:52.178 +   5.5s] step1: event user [tool_result]
[21:47:53.194 +   6.6s] step1: event assistant [tool_use:Read]
[21:47:53.230 +   6.6s] step1: event user [tool_result]
[21:47:54.210 +   7.6s] step1: event assistant [tool_use:Read]
[21:47:54.239 +   7.6s] step1: event user [tool_result]
[21:47:55.285 +   8.6s] step1: event assistant [tool_use:Read]
[21:47:55.310 +   8.7s] step1: event user [tool_result]
[21:47:56.296 +   9.7s] step1: event assistant [tool_use:Bash]
[21:47:56.634 +  10.0s] step1: event user [tool_result]
[21:47:57.863 +  11.2s] step1: event assistant [text]
[21:47:58.336 +  11.7s] step1: event assistant [tool_use:Edit]
[21:47:58.355 +  11.7s] step1: event user [tool_result]
[21:47:59.412 +  12.8s] step1: event assistant [tool_use:Bash]
[21:47:59.509 +  12.9s] step1: event user [tool_result]
[21:48:00.727 +  14.1s] step1: event assistant [tool_use:Write]
[21:48:00.743 +  14.1s] step1: event user [tool_result]
[21:48:02.474 +  15.8s] step1: event assistant [text]
[21:48:02.495 +  15.9s] step1: event result/success turns=9 is_error=false
[21:48:03.053 +  16.4s] step1: exit 0 after 14.9s; 21 events, 19 of them more than 1 s before exit, first after 2.3s (12.6s before exit), last 0.6s before exit; 8 tool calls (Read, Read, Read, Read, Bash, Edit, Bash, Write)
[21:48:03.171 +  16.5s] PASS c. streamed claude step - exit 0, session f638a113-1ab6-446a-9110-541eb5f899d8, 21 events (19 more than 1 s before exit), 8 tool calls, live=true, first event 12.6s before exit, 14.9s total; greet.js changed=true; check.mjs output before/after=true; step1.txt: "Hello, Ada\nHi, Ada!"
[21:48:03.171 +  16.5s] step2: start (--resume f638a113-1ab6-446a-9110-541eb5f899d8)
[21:48:04.327 +  17.7s] step2: event system/init session=f638a113-1ab6-446a-9110-541eb5f899d8 model=claude-sonnet-5-5
[21:48:06.064 +  19.4s] step2: event assistant [tool_use:Write]
[21:48:06.088 +  19.4s] step2: event rate_limit_event
[21:48:06.119 +  19.5s] step2: event user [tool_result]
[21:48:07.378 +  20.7s] step2: event assistant [text]
[21:48:07.398 +  20.8s] step2: event result/success turns=2 is_error=false
[21:48:08.146 +  21.5s] step2: exit 0 after 5.0s; 6 events, 4 of them more than 1 s before exit, first after 1.2s (3.8s before exit), last 0.7s before exit; 1 tool calls (Write)
[21:48:08.226 +  21.6s] question.json: {"id":"q1","question":"Which word should farewell(name) use?","options":["Goodbye","Farewell","See you"]}
[21:48:08.277 +  21.6s] PASS d1. question written - exit 0, session f638a113-1ab6-446a-9110-541eb5f899d8, parsed=true, greet.js untouched=true
[21:48:08.277 +  21.6s] answering q1 with "See you"
[21:48:08.277 +  21.6s] step3: start (--resume f638a113-1ab6-446a-9110-541eb5f899d8)
[21:48:09.412 +  22.8s] step3: event system/init session=f638a113-1ab6-446a-9110-541eb5f899d8 model=claude-sonnet-5-5
[21:48:11.105 +  24.5s] step3: event assistant [tool_use:Edit]
[21:48:11.148 +  24.5s] step3: event user [tool_result]
[21:48:11.728 +  25.1s] step3: event assistant [tool_use:Write]
[21:48:11.742 +  25.1s] step3: event user [tool_result]
[21:48:11.747 +  25.1s] step3: event rate_limit_event
[21:48:13.233 +  26.6s] step3: event assistant [text]
[21:48:13.280 +  26.6s] step3: event result/success turns=3 is_error=false
[21:48:13.970 +  27.3s] step3: exit 0 after 5.7s; 8 events, 6 of them more than 1 s before exit, first after 1.1s (4.6s before exit), last 0.7s before exit; 2 tool calls (Edit, Write)
[21:48:14.094 +  27.5s] PASS d2. resume used earlier context - exit 0, session f638a113-1ab6-446a-9110-541eb5f899d8 (resumed f638a113-1ab6-446a-9110-541eb5f899d8), answer-used.txt=["See you","KITE-1D9195"], expected code word KITE-1D9195, farewell added=true
[21:48:14.251 +  27.6s] PASS e. download worca-out - 3 files to <out> in 0.2s: step1.txt, question.json, answer-used.txt
[21:48:14.732 +  28.1s] sandbox diff --stat:
src/greet.js | 6 +++++-
 1 file changed, 5 insertions(+), 1 deletion(-)
[21:48:14.733 +  28.1s] local merge: Updating daae00b..ece30d5
[21:48:14.733 +  28.1s] PASS f. bundle back + fast-forward - sandbox HEAD ece30d5e, local HEAD ece30d5e, diff sha256 sandbox e450486ed8db local e450486ed8db, 0.5s
[21:48:15.192 +  28.5s] pause() returned true after 0.2s; state before running, after paused; listed as paused=true; command on the paused sandbox refused (SandboxNotRunningError)
[21:48:16.215 +  29.6s] after connect: state running; boot id kept=true; process 1668 from before the pause alive=true
[21:48:16.215 +  29.6s] PASS g. pause + connect - pause 0.2s, connect 0.8s; really paused=true (state paused, listed=true, command refused (SandboxNotRunningError)); state after connect running; marker=alive, HEAD kept=true; memory kept=true
[21:48:16.262 +  29.6s] removed sandbox ikqi7r7p7swpgdidxq6xy: true
[21:48:16.324 +  29.7s] PASS h. cleanup - leftovers removed: 0; remaining after: 0

Summary
  PASS  a. local repo
  PASS  b. sandbox + bundle clone
  PASS  c. streamed claude step
  PASS  d1. question written
  PASS  d2. resume used earlier context
  PASS  e. download worca-out
  PASS  f. bundle back + fast-forward
  PASS  g. pause + connect
  PASS  h. cleanup
  total 29.7s
```
