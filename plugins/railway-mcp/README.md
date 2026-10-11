# railway-mcp

Railway's MCP server through the Railway CLI for worca's MCP registry (plugin API 5):
`railway mcp local` over stdio — the CLI's in-process server with the full toolset (projects,
services, environments, deployments, variables, domains, networking, storage, logs).

Railway's hosted server (`https://mcp.railway.com`) accepts OAuth sign-in only, which worca does not run.

## Setup

1. Install the Railway CLI **5.44.0 or later** and put it on PATH: `npm i -g @railway/cli`,
   `brew install railway`, or `scoop install railway` (Windows).
2. `railway login` — or create an account or workspace token (Railway → Account Settings → Tokens)
   and fill in **Railway account token** (passed as `RAILWAY_API_TOKEN`). Project tokens do not work.
3. Marketplace → Available → `railway-mcp` → **Install…**; then Connectors → a set →
   Add server → `railway` → Save and test.

Agents act with the login or token without asking — including deleting services and changing
production variables. `railway login` and an account token reach your whole account; a workspace
token reaches one workspace, so prefer it.

The worca container image (a hosted worca, `worca container`) has no Railway CLI, so `railway` fails
its Test there. Under agent isolation the server runs as the agent user, which does not share your
`railway login`: install the CLI for that user and fill in the token.
