# Codeberg

**Codeberg** (`codeberg.org`) is a public code host run by a non-profit, on Forgejo. Worca treats it
as its own forge with a fixed host, so it needs no host list, only a token. Everything else is
[Gitea and Forgejo](gitea.md), in the Forgejo flavour: what works, what does not, the repository
URLs and how Watch PR reads a pull request.

## Setup

1. Create a token: your avatar → **Settings → Applications → Generate New Token**, with
   **repository: Read and Write** (reads only need **Read**).
2. Set it where Worca runs, and restart Worca:

   | Variable | Meaning |
   | --- | --- |
   | `WORCA_CODEBERG_TOKEN` | one token for clone, fetch, push and pull requests |
   | `WORCA_CODEBERG_READ_TOKEN`, `WORCA_CODEBERG_WRITE_TOKEN` | a read/write pair; either one switches to split mode |

   Git gets the token through a credential helper scoped to `https://codeberg.org`; REST calls send
   it only to `https://codeberg.org/api/v1`. Container: [docker.md](docker.md#gitea-and-forgejo).

Without a token, a call that needs one fails with *no Codeberg credential: set WORCA_CODEBERG_TOKEN
where worca runs*; clone works for public repositories only.

**Actions on Codeberg** run only on runners you register yourself or that Codeberg grants on
request. Until a runner picks a job up, Watch PR sees its status as pending.
