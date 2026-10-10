# cloudflare-mcp

Two of Cloudflare's hosted MCP servers for worca's MCP registry (plugin API 5).

| Server | URL | Credentials |
|---|---|---|
| `cloudflare` | `https://mcp.cloudflare.com/mcp` | Cloudflare API token, sent as `Authorization: Bearer …` |
| `cloudflare-docs` | `https://docs.mcp.cloudflare.com/mcp` | none |

`cloudflare` reaches the whole Cloudflare API (Workers, DNS, R2, D1, KV, zones…) through its
code-mode `search` and `execute` tools, so it adds little to an agent's context. Cloudflare's
per-product servers (Observability, Workers Builds, Bindings, Radar…) are not bundled: `cloudflare`
covers their APIs.

## Setup

1. Marketplace → Available → `cloudflare-mcp` → **Install…**.
2. Cloudflare dashboard → My Profile → API Tokens → Create Token. Grant only what your agents need:
   pipeline agents call `cloudflare` without asking, and it can reach every endpoint the token
   allows. User and account tokens both work; give an account token **Account Resources : Read**
   too, so the server can find your account. Tokens with client IP address filtering do not work.
3. Connectors → pick a set → Add server → `cloudflare` → paste the token into
   **Cloudflare API token** → Save and test. `cloudflare-docs` needs nothing.
