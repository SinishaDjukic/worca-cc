---
name: worca-railway
description: Operate a hosted worca on Railway behind Cloudflare Access — status, logs, upgrade/rollback to a released image, deploy the current branch as a test image, set or remove service variables (Claude token, mock mode, GitHub App/tokens, clone allowlist) without exposing values, verify an instance end to end (Access, bypass refusal, agent isolation, GitHub credential, optional clone), and ssh into it. Triggers on "worca-railway", "deploy worca to railway", "upgrade the hosted worca", "verify the deployment", "set the Claude token on railway", "turn mock off on railway", or any request to operate, debug, configure or validate a hosted worca instance.
---

# Operate a hosted worca on Railway

Everything runs through one generic tool, `tools/railway/worca-railway.mjs`. It knows
nothing about any particular deployment: every id, hostname and key path comes from a
**target file** on the operator's machine, `~/.config/worca/targets/<name>.env`
(template: `tools/railway/targets.example.env`). The reference for what each step
means is `docs/deploy-railway.md` ("Operate your deployment"); read it when something
here does not fit, and do not restate it to the user.

**Usage:** `/worca-railway [<target>] [<action> …]`. No target named: run `targets`,
and ask which one if there is more than one. No action: run `status`.

## Hard rules

1. **Never read, print or paste a secret.** Do not open target secret files, `*.env`
   files the user keeps secrets in, or any file a `*_FILE` entry points to. Never run
   `railway variable list` without `--json`, `railway variables`, `railway variable
   list --kv`, or anything else that prints values. The tool lists names only.
2. **Values reach Railway only through stdin.** For a secret, ask the user to run the
   command themselves with the value piped in (below), or use `--from-file <path>` with
   a path they give you. Never put a value on a command line, and never type one into
   a file you create.
3. **Every change needs the user's go-ahead in chat, then `--yes`.** Upgrade, rollback,
   deploy-branch, redeploy, set, unset and mock all restart the service; running agents
   pause and must be resumed. Say what will restart before asking.
4. **Always through the tool, never bare `railway` commands:** the tool passes
   `--service/--environment/--project` explicitly, so a folder linked to the cloudflared
   service can never receive the worca service's variables.
5. **Targets belong to their owner.** Do not create or edit a target file for a
   deployment the user has not described, and never commit one. Access to a deployment
   is controlled by Railway and Cloudflare membership, not by this skill.

## Actions

Run from the repository root: `node tools/railway/worca-railway.mjs <command> <target> …`

| Goal | Command |
| --- | --- |
| What is deployed, is it healthy, which variables exist | `status <t>` |
| Recent log lines (redacted) | `logs <t> [--lines 200]` |
| Upgrade to a released version | `upgrade <t> 1.5.0 --yes` (or a full `registry/repo:tag`; `:latest` is refused) |
| Undo the last upgrade | `rollback <t> --yes` (uses `~/.config/worca/targets/<t>.history`) |
| Test the current checkout on the instance | `deploy-branch <t> --tag <tag> --yes` (builds linux/amd64, pushes to `BRANCH_IMAGE_REPO`, deploys; needs `docker login` to that registry) |
| Restart without changes | `redeploy <t> --yes` |
| Mock mode | `mock <t> off --yes` / `mock <t> on --yes` |
| A non-secret variable | `printf %s 'github.com/acme/*' \| node tools/railway/worca-railway.mjs set <t> WORCA_CLONE_ALLOW --yes` |
| Remove a variable | `unset <t> KEY --yes` |
| Several changes, one restart | add `--skip-deploys` to each `set`/`unset`, then `redeploy <t> --yes` |
| Check everything | `verify <t> --in-container` (add `--clone https://github.com/<owner>/<repo>` to test a real clone) |
| A shell or one command in the container | `ssh <t>` prints the command; `ssh <t> -- <command>` runs one |

### Secrets: the user runs these

Give the user the exact command and let them run it in their own terminal (the value
never enters the conversation):

- Claude token (real runs; agents run as `worca-agent` and need it as a variable):
  `claude setup-token`, then paste it into
  `node tools/railway/worca-railway.mjs set <t> CLAUDE_CODE_OAUTH_TOKEN --yes`
  (the tool reads it from stdin). Then `mock <t> off --yes`.
- GitHub App key (new or rotated):
  `base64 < app.private-key.pem | tr -d '\n' | node tools/railway/worca-railway.mjs set <t> WORCA_GH_APP_KEY_B64 --yes`,
  plus `WORCA_GH_APP_ID` / `WORCA_GH_APP_INSTALLATION_ID` the same way.
- Tokens instead of an App: `set <t> GH_TOKEN`, or `WORCA_GH_READ_TOKEN` and
  `WORCA_GH_WRITE_TOKEN`, then `unset` the `WORCA_GH_APP_*` variables.

After any secret: remind them to **seal** it in the Railway dashboard (the CLI has no
seal option), and run `status <t>`: a variable whose value Railway no longer returns shows
`(sealed)`. If a secret the user sealed is not marked, say so and ask them to check it in the
dashboard.

## Procedures

- **Upgrade:** `status` → confirm the version with the user → `upgrade … --yes` →
  `verify <t> --in-container` → tell them to resume paused runs. On a failed deploy:
  `logs`, then offer `rollback`.
- **Test a branch:** `deploy-branch <t> --tag <branch-or-pr>-<n> --yes` →
  `verify <t> --in-container`. Say that the instance now runs an unreleased image and
  that `upgrade <t> <version>` returns it to a release.
- **Debug:** `status`, `logs`, then `verify <t> --in-container`; the probe's FAIL lines
  name the broken layer (Access, bypass refusal, users, agent isolation, GitHub). Match
  the symptom against the troubleshooting table in `docs/deploy-railway.md`.
- **New target:** have the user copy `tools/railway/targets.example.env` to
  `~/.config/worca/targets/<name>.env` (chmod 600) and fill it in; ids come from the
  Railway dashboard URL or `railway status --json`. The Access service token goes in its
  own 0600 file (two lines, `CF_ACCESS_CLIENT_ID=` / `CF_ACCESS_CLIENT_SECRET=`), which
  the user writes. Then `status <name>` and `verify <name> --in-container`.

Report results plainly: what changed, the deployment status, the verify summary, and
anything the user must do by hand (seal a variable, resume runs, add a person in the
Access policy).
