# firebase-mcp

The Firebase MCP server from `firebase-tools` for worca's MCP registry (plugin API 5):
`npx -y firebase-tools@latest mcp`, over stdio. Firebase has no hosted MCP endpoint.

## Setup

1. Node.js with `npx` on PATH (worca already needs Node).
2. Sign in once: `npx -y firebase-tools@latest login` — or use a service account key file (below).
3. Marketplace → Available → `firebase-mcp` → **Install…**; then Connectors → a set →
   Add server → `firebase` → Save and test. The first Test downloads firebase-tools (about
   30 s, ~290 MB); later starts take about 2.5 s.

## Startup, disk and timeouts

- Each pipeline agent and each Ask message starts its own `firebase` server; it stops when that
  agent or message ends. A warm start takes about 2.5 s.
- npx keeps **one** copy of firebase-tools per OS user (`~/.npm/_npx`), shared by every project and
  session, and updates it in place when a new version ships.
- The first start after a firebase-tools release installs the new version. That normally fits the
  startup limit (60 s in Ask, 2 minutes in pipelines); on a slow connection it can pass it, and the
  server is skipped for that agent. Then click **Test** once (it waits 2 minutes and warms the
  cache), raise `MCP_TIMEOUT` in worca's environment, or skip npx entirely:
  `npm i -g firebase-tools`, then Connectors → Servers → Add MCP server → name
  `firebase-cli`, command `firebase`, arguments `mcp` (add `--dir=<path>` for a project) → add it
  to a set instead of `firebase`. You update it with `npm i -g firebase-tools` when you choose.

## Fields (all optional)

| Field | Becomes | Blank means |
|---|---|---|
| Project directory | `--dir=<path>` — absolute path holding `firebase.json` | the server's working directory; agents can change it with the `firebase_update_environment` tool |
| Feature groups | `--only=<list>`, e.g. `firestore,auth,storage`; names firebase-tools does not know are ignored | the groups firebase-tools picks for the project |
| Service account key file | `GOOGLE_APPLICATION_CREDENTIALS` | your `firebase login` session |

Under agent isolation (the container image, a relay) the server runs as the agent user, which does
not share your `firebase login`: fill in **Service account key file** with a path that user can read.
When the user running the server also has a `firebase login` session, firebase-tools uses that
session, not the key file.

Worca stores the key file path as a secret: it never shows it again and hides it in Test errors
(a mistyped path reads `[redacted]`). Use **Replace** to change it.
