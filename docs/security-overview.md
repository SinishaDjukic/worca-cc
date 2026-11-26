# Security overview

This page is for someone reviewing Worca for a company. It says what Worca treats as untrusted, what each setup
protects, what it does not, and how to report a problem. To pick a setup, start with
[Choose a setup](choose-a-setup.md).

To see what your own Worca protects, open **Settings › General › Security** (Advanced level). It shows what Worca's
own server process can tell: where it runs, the credential broker, agent users, the outbound network, the proxy
login and the default execution environment. What only the host can see (a container's networks and mounts) reads
**Unknown** there; `worca container status` checks it on the hardened box.

## What Worca treats as untrusted

Agents, and everything they read. That covers repositories, issues, web pages, tool output and the files an agent
writes. A prompt injection in any of them can steer an agent. So Worca assumes an agent can run any command its user
can run, and it protects what is worth protecting by keeping it out of the agent's reach.

Teammates signed in to a shared instance, and the operator who runs it, are trusted. Worca's own server and broker
code is trusted, and hardened against input an agent controls.

## The three claims

A supported sandboxed setup makes three claims:

1. Agents run in a sandbox.
2. Agents cannot read a model key or a git token.
3. Agents cannot read the corporate proxy login.

It does not claim "no secrets" and it does not claim "fully secure". The accurate sentence is: no model key, no git
token and no proxy login in an agent's reach. Some secrets stay in reach (see [Known limits](#known-limits)).

| Setup | 1. Sandbox | 2. No model key or git token in reach | 3. No proxy login in reach |
| --- | --- | --- | --- |
| Native | No | Git token: yes. Model key: no | No |
| Plain container | Protects the machine, not the mounted project | Git token: yes. Model key: no, unless you add the broker | Yes with the sidecar, which starts by itself when a login is configured. No without it |
| [Local sandbox (Docker)](local-sandbox.md) | Yes, a container per run | Yes | Yes |
| [E2B sandbox](e2b.md) | Yes, a virtual machine per run | Yes | Yes |
| Hardened box | Yes, in containers | Yes | Yes |
| Shared instance | Yes, in containers | Yes | Yes. On Railway there is normally no corporate proxy, so no login |

The plain container is the existing `worca container up`. It is not one of the five setups.

## Credentials by setup

Can an agent read it?

| Setup | Model key | Git token | Corporate proxy login | MCP registry secrets |
| --- | --- | --- | --- | --- |
| Native | **Yes.** In Worca's environment or your Claude sign-in | **No.** Worca removes it from every process it starts. Your own ssh keys and `gh` sign-in are readable | **Yes.** `~/.worca-cc/proxy-login.json` | **Yes**, in a run that uses them |
| Plain container | **Yes**, unless the broker holds it | **No**, as in Native | **No** with the sidecar. **Yes** without it, unless agent users are on | **Yes**, in a run that uses them |
| Hardened box | **No.** In the broker | **No.** Worca holds it | **No.** In the egress sidecar | **Yes**, in a run that uses them |
| Shared instance | **No.** Per person, in the broker | **No.** Per person, in the broker | **No.** A technical user's, supplied as a file, mounted by the sidecar only | **Yes**, in a run that uses them |
| E2B sandbox | **No.** A relay on the Worca server | **No.** With Worca | **No.** With Worca | **Yes**, in a run that uses them |
| Local sandbox (Docker) | **No.** A relay on the Worca server | **No.** With Worca | **No.** With Worca | **Yes**, in a run that uses them |

Notes:

- Bedrock, Vertex and Foundry credentials are not protected in any setup. In a box they stay in the agent's
  environment. The E2B sandbox and the Local sandbox (Docker) refuse those runs.
- The proxy login file holds a domain, a user name and an NT hash, never the password. An NT hash is enough to log in
  to an NTLM proxy, so treat the file like a password.
- A model key in the broker can still be spent. A rogue agent can spend credits within the broker's budgets and
  limits. It never gets the key.

## How the network is limited

| Setup | Limit | How strong |
| --- | --- | --- |
| Native | None | Agents reach whatever your machine reaches |
| Plain container | Open by default. An allow-list is an option (`--with egress`) | Without the option, none |
| Hardened box | An allow-list on a network with no route out. The egress sidecar is the only way out | Strong. Holds by host name: a listed host can receive anything an agent sends it. Keep the list short |
| Shared instance on Compose | The same as the Hardened box | The same |
| Shared instance on Kubernetes | The same, with a NetworkPolicy in place of the internal network | The same, if your network plugin enforces NetworkPolicies. If it does not, there is no limit. This profile ships no manifests |
| Shared instance on Railway | A proxy inside Worca's container | Weak. Railway has no internal-only network. A program that ignores the proxy variables or opens a raw socket goes straight out. DNS is not filtered. It guards against mistakes, not against a hostile task |
| E2B sandbox | Open by default. An allow-list per project, held by E2B by host name | Stops casual egress only. A client that names an allowed host can reach any address, and a listed name opens DNS |
| Local sandbox (Docker) | No network in the container. Every connection is carried to Worca, which applies the policy: Open (public hosts only) or an allow-list | Strong against raw sockets: a tool that ignores `HTTPS_PROXY` gets no network. Worca never connects to your machine or a link-local address, and in Open mode to no private address. In Allow mode it holds by host name, as in the Hardened box |

## What a sandbox isolates

**Per run, not per workflow step.** In the sandbox setups, one run gets one sandbox, and all steps of its workflow
share it. A step can read what an earlier step left there.

**A container shares the host's kernel.** A kernel exploit is out of scope for the Hardened box, the Shared
instance and the Local sandbox (Docker). **An E2B sandbox is a virtual machine**, which is a stronger boundary.
That is why the Local sandbox (Docker) is the weaker of the two sandbox backends.

**In the Hardened box and the Shared instance the boundary is the container, not the run.** All runs share the
box. Agents run under their own users, so they cannot read Worca's settings, database or environment. They share the
projects and run checkouts. Code one run plants in a shared repository can run in a later run.

What the container boundary does isolate:

- Your machine: no host folder is mounted. A writable mount of your checkout would let an agent plant a git hook or a
  config command that your own git or IDE then runs.
- Credentials: see the table above.
- The network, as described above.

What it does not isolate:

- The remote. Agents push branches through Worca. A branch an agent wrote is untrusted code until someone reviews it.
- Secrets you hand a run on purpose, such as an MCP registry secret.
- Teammates from each other on a Shared instance. Every signed-in person is an administrator.

[Guardrails](guardrails.md) are a separate layer. They limit which tools an agent may call. They are not a sandbox.

## Known limits

These hold in every setup:

- **MCP registry secrets** stay readable by the agents of a run that uses them.
- **Bedrock, Vertex and Foundry credentials** are not protected.
- **Tools outside mise and apt**, and internal package mirrors, are not supported in image builds. See
  [Project environment spec](environment-spec.md).
- **Only Docker is supported** as the runtime of the Hardened box and the Compose profile. Podman, rootless Docker, Rancher Desktop
  and other runtimes are refused for now. The plain container also runs on Podman.

More, by setup:

- **Shared instance:** every signed-in person is an administrator, and teammates see each other's runs, chats and
  settings. More than 16 people share agent users. On Railway the network limit is weak.
- **Hardened box:** single user. Do not publish its port on a network. It has not been checked on Docker Desktop's
  port proxy.
- **E2B sandbox:** single git projects, Claude, Codex, Copilot and Cursor only. Workspace runs stay local. E2B
  Cloud receives your source code. See [E2B → Limitations](e2b.md#limitations).
- **Local sandbox (Docker):** single git projects, Claude, Codex, Copilot and Cursor only. Workspace runs stay
  local. A container shares your kernel; a stricter runtime such as gVisor is one setting away. Images are built
  behind a login proxy only with Docker's own proxy setting. See [Local sandbox (Docker) → Limits](local-sandbox.md#limits).
- **Native:** no sandbox, by design.

More on the broker: [Credential broker → Limits and accepted risks](credential-broker.md#limits-and-accepted-risks).

## What has been verified

- The proxy login in the egress sidecar was tested against a simulated NTLM proxy, not a real corporate one. A check
  against a real corporate proxy follows before a release.
- The Shared instance's compose files were checked with `docker compose config`. They have not been started together
  on a real server.
- The Hardened box has not been checked on Docker Desktop for Mac or Windows.
- The Local sandbox (Docker) has not yet run against a real Docker daemon. Its tests use a stand-in for the docker
  CLI.

## Report a vulnerability

Email security@worca.dev. Do not open a public issue or pull request. The full policy, the scope and what to expect
are in [SECURITY.md](../SECURITY.md).
