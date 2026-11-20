# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately, by email to
**[security@worca.dev](mailto:security@worca.dev)**.

Do not open a public issue, pull request or discussion for a vulnerability,
and do not mention it in one. A public report shows the problem to everyone
before a fix is available.

A useful report includes:

- the Worca version (`worca --version`) and how it runs: npm install, Docker,
  or a hosted deployment such as Railway
- your operating system and Node.js version
- what an attacker can do, and what they need first (local access, a
  teammate account, a crafted repository, a malicious MCP server or plugin)
- steps to reproduce, or a proof of concept
- any logs or screenshots, with your own secrets removed

## What to expect

| Step | Target |
| --- | --- |
| Acknowledgement of your report | within 3 business days |
| First assessment: confirmed or not, and how severe | within 10 business days |
| Fix released for a confirmed critical or high issue | within 30 days |
| Fix released for a confirmed medium or low issue | in a following release |

We keep you updated while we work on it, and we may ask you for more
details. If we decide the report is not a vulnerability, we say why.

## Disclosure

We follow coordinated disclosure:

1. We confirm the issue and prepare a fix in private.
2. We release the fixed version to npm.
3. We publish a GitHub security advisory that describes the issue, the
   affected and fixed versions, and what users should do. We request a CVE
   when the issue warrants one.

Please keep the details private until the advisory is published, or for
90 days after your report, whichever comes first. If you need a different
timeline, tell us and we will agree on one. With your permission, we credit
you in the advisory.

## Supported versions

Security fixes go into the latest release of `@worca/app` on npm (the
`latest` tag). We do not backport fixes to older versions, so upgrade to get
them:

```bash
npm install -g @worca/app@latest
```

| Version | Supported |
| --- | --- |
| Latest stable release | Yes |
| Release candidates (`rc` tag) | Fixed in the next release candidate |
| Older releases | No |

## Scope

In scope: problems in the code of this repository, for example:

- Worca's UI server or API reachable, or usable, without the access it is
  configured to require, including [remote access](docs/remote-access.md)
- secrets leaving where Worca keeps them: MCP secrets, model keys, plugin
  secrets, or the tokens the [credential broker](docs/credential-broker.md)
  issues
- a run or a pipeline agent getting around its [guardrails](docs/guardrails.md),
  its MCP set's permission rules, or a team policy
- an untrusted repository, task, plugin or MCP server making Worca run
  commands or write files that the person running it did not allow
- cross-site scripting, request forgery or path traversal in the web UI
- a problem in a dependency that Worca uses in an exploitable way

Out of scope:

- vulnerabilities in Claude Code, the Claude API or other third-party
  software itself; report those to their maintainers (for Claude Code, see
  [Anthropic's disclosure policy](https://www.anthropic.com/responsible-disclosure-policy))
- behaviour the documentation describes as expected, such as agents in a run
  being able to read the secrets of the MCP set that run uses, or a plugin
  reading another plugin's secrets on an install where both run as the same
  user (every native install; see [docker.md](docs/docker.md) for the
  container's plugin user)
- attacks that need an attacker who already controls your machine, your
  Worca home directory or your Claude login
- reports from automated scanners with no demonstrated impact
- denial of service through sheer request volume

If you are not sure whether something is in scope, report it anyway.

## Safe harbor

We will not take legal action against anyone who researches and reports a
vulnerability in good faith under this policy. Good faith means: test only
against installations you own or are allowed to test, do not access or
change other people's data, do not degrade service for others, and give us
reasonable time to fix the issue before you disclose it.
