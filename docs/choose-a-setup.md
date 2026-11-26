# Choose a setup

Worca runs in five setups. They differ in where agents run, what an agent can read, and how you work day to day.
This page helps you pick one. For the reasoning behind the security claims, see the
[Security overview](security-overview.md).

Two of the five setups arrive in a later release. They are marked below, and have no page of their own yet.

## Which setup is for me

| Setup | For whom | How you work | Agents sandboxed | Status |
| --- | --- | --- | --- | --- |
| [Native](#native) | One person trying Worca | Your own folders, directly | No | Available |
| [Local sandbox (Docker)](#local-sandbox-docker) | A developer on a laptop with Docker | Unchanged: your own folders | Yes, one container per run | Arrives in a later release |
| [E2B sandbox](#e2b-sandbox) | A team with an E2B server | Unchanged: your own folders | Yes, one virtual machine per run | Arrives in a later release |
| [Hardened box](#hardened-box) | One developer who wants the strictest local setup | Pull requests, projects cloned from the remote | Yes, Worca and its agents in containers | Available |
| [Shared instance](#shared-instance) | A team on one server | Pull requests, projects cloned from the remote | Yes, Worca and its agents in containers | Available (reference profile) |

"Sandboxed" has one claim behind it in every row: no model key, no git token and no corporate proxy login in an
agent's reach. It does not mean "no secrets". The [Security overview](security-overview.md) lists what stays in reach.

## Decision questions

Answer in order. Stop at the first answer that settles it.

1. **Do you work alone, or as a team on one shared Worca?** A team that shares one Worca needs the
   [Shared instance](#shared-instance). The Hardened box is for one person.
2. **Do you want to keep working in your own folders?** If yes, your choices are Native, Local sandbox (Docker) and
   E2B sandbox. The Hardened box and the Shared instance mount no host folder: projects are cloned from the remote,
   and results come back as pushed branches and pull requests.
3. **May your code leave your machine?** E2B Cloud receives your source code. A self-run E2B server keeps it where
   you run it. The Hardened box and the Local sandbox (Docker) keep it on your own machine.
4. **Do you have Docker?** The Hardened box, the Local sandbox (Docker) and the Shared instance on Compose need it.
   Native needs none.
5. **Do you have an E2B server?** The E2B sandbox needs one.
6. **Are you behind a proxy that needs a login?** In the Hardened box and the Shared instance, a separate container
   keeps the login and agents cannot read it. In Native, the saved login is a file in your home folder that agents
   can read. See [Where the login lives](network-proxy.md#where-the-login-lives).
7. **Do agents work on code or issues you do not trust?** Then do not use Native. Pick a sandboxed setup.
8. **Are you on Windows?** The Hardened box runs from a WSL2 shell. Native also runs on Windows without WSL2.

## Native

**Who it is for.** One person who wants to try Worca. This is the install from [Install](install.md).

**Your workflow.** The same as always. Worca and its agents work in your own folders, as you.

**Sandboxed.** No. Agents run as your own user and can read what you can read. This setup is for trying Worca.
Worca adds no sandbox to it, and this work changes nothing in it. [Guardrails](guardrails.md) help, but "Guardrails
are not a sandbox".

**Where each credential lives.**

- Model key or Claude sign-in: in Worca's environment or in your home folder. Agents can read it.
- Git host token: Worca holds it and removes it from every process it starts. Agents never get it. Files you keep
  yourself, such as an ssh key or a `gh` sign-in in your home folder, are readable, because agents run as you.
- Corporate proxy login: `~/.worca-cc/proxy-login.json`. Agents can read it.
- MCP registry secrets: agents of a run that uses them can read them.

**Network limit.** None. Agents reach whatever your machine reaches.

**What you need.** Node.js, git and the Claude Code CLI. See [Install](install.md).

**Status.** Available. Unchanged.

### The plain container

`worca container up` runs Worca and its agents in a Linux container and mounts your project folders. It protects
your machine, not the mounted project. An agent can edit the project, and can plant a git hook or a config command
there that your own git or IDE then runs on your machine. The model key stays in reach of agents unless you add the
credential broker. This is the existing option, and it is not one of the five setups. See
[Worca in a container](docker.md).

## Local sandbox (Docker)

<!-- Link this section to docs/local-sandbox.md once the Local sandbox (Docker) lands. -->

Arrives in a later release.

**Who it is for.** A developer on a laptop with Docker who wants agents out of their own session but wants to keep
working in their own folders.

**Your workflow.** Unchanged. Worca stays where it is and you keep your folders. Each run gets one container on your
own Docker. Code goes in as a git bundle plus uncommitted files. Changes come back as a filtered patch.

**Sandboxed.** Yes, one container per run. All steps of a workflow share it. A container shares your machine's
kernel, so this is a weaker boundary than an E2B virtual machine.

**Where each credential lives.** The same model as the E2B sandbox: the model key, the git token and the proxy login
stay with Worca, outside the sandbox. Agents cannot read them.

**Network limit.** Planned: a network with no route out, and a way to reach the proxy. The exact limit is settled
when it ships.

**What you need.** Docker.

**Status.** In progress. It is built on the E2B sandbox work and ships after it.

## E2B sandbox

<!-- Link this section to docs/e2b.md once the E2B sandbox (#826) lands. -->

Arrives in a later release.

**Who it is for.** A team with an E2B server that wants agents in a sandbox and an unchanged workflow.

**Your workflow.** Unchanged. Worca stays where it is, native or hosted. Each run gets one sandbox. Code goes in as
a git bundle plus uncommitted files. Changes come back as a filtered patch.

**Sandboxed.** Yes, one virtual machine per run. All steps of a workflow share it.

**Where each credential lives.** No model key enters the sandbox: agents call a model relay on the Worca server. The
git token and the proxy login stay with Worca. Agents cannot read them.

**Network limit.** An allow-list. It stops casual egress only. Do not count on it against an agent that sets out to
get data out.

**What you need.** An E2B server. E2B Cloud receives your source code.

**Limits.** Single git projects only. Claude, Codex, Copilot and Cursor only: Bedrock, Vertex and Foundry runs are
refused. Workspace runs stay local.

**Status.** A draft pull request, not merged.

## Hardened box

**Who it is for.** One developer, on their own machine, who wants the strictest local setup. Examples are agents on
repositories you do not fully trust, or tasks built from outside issues.

**Your workflow.** Pull requests. No folder from your machine is mounted. Projects are cloned from the remote into
the box, and results leave as pushed branches and pull requests. Git access is by HTTPS token only.

**Sandboxed.** Yes. Worca and its agents run in containers. Agents run under their own users and cannot read Worca's
settings, database or environment. All runs share the box. The containers share your machine's kernel.

**Where each credential lives.**

- Model key: in the credential broker, a container of its own. Agents cannot read it.
- Git token: Worca holds it. Agents never get it.
- Corporate proxy login: in the egress sidecar, a container of its own. Agents cannot read it.
- MCP registry secrets: agents of a run that uses them can read them.

**Network limit.** An allow-list on a network with no route out. The sidecar lets through only the listed hosts. It
holds by host name: a listed host can receive anything an agent sends it.

**What you need.** Docker (Docker Desktop, or Docker Engine on Linux), with Compose 2.24 or newer. On Windows, run it
from WSL2. Podman and rootless Docker are refused.

**Status.** Available. The proxy login was tested against a simulated NTLM proxy, not a real corporate one.

Details: [Hardened box](hardened-box.md).

## Shared instance

**Who it is for.** A team that shares one Worca on a server it runs. One operator sets it up.

**Your workflow.** Pull requests, in a browser behind your sign-in. Projects are cloned into the server's volume.
Each person uses their own model key and GitHub token.

**Sandboxed.** Yes, as in the Hardened box. Each signed-in person's agents run under their own user. All runs share
the server's containers. Every signed-in person is an administrator, and teammates see each other's runs.

**Where each credential lives.**

- Model keys: per person, in the credential broker. Agents cannot read them.
- GitHub tokens: per person, in the broker. Worca asks for one for each push. Agents never get them.
- Corporate proxy login: a technical user's, supplied by the operator as a file. Only the egress sidecar mounts it.
  Agents cannot read it.
- MCP registry secrets: agents of a run that uses them can read them.

**Network limit.** On Compose, an allow-list on a network with no route out, as in the Hardened box. On Kubernetes
the same needs a NetworkPolicy that your network plugin enforces. On Railway the limit is weaker: there is no
internal-only network, so it holds only for tools that respect the proxy settings.

**What you need.** A Linux server or VM with Docker and Compose 2.24 or newer, or a Kubernetes cluster, or a Railway
account. A sign-in in front, such as Cloudflare Access.

**Status.** Available as a reference profile: Compose files and a checklist, not a command. Kubernetes has a mapping
and no manifests. The merged compose files were checked with `docker compose config`. They have not been started
together on a real server yet.

Details: [Shared instance](shared-instance.md), and [Deploy on Railway](deploy-railway.md) for the weaker option.

## Related pages

- [Security overview](security-overview.md): what Worca treats as untrusted, the claims, and the known limits.
- [Credential broker](credential-broker.md): how model keys stay out of agents' reach.
- [Network proxy](network-proxy.md): the corporate proxy login.
- [Project environment spec](environment-spec.md): the tools a container image holds.
- [Remote access](remote-access.md): Cloudflare Access in front of Worca.
