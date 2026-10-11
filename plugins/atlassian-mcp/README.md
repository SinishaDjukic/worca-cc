# atlassian-mcp

Atlassian's hosted Rovo MCP server (Jira, Confluence, Compass) for worca's MCP registry (plugin
API 5): `https://mcp.atlassian.com/v2/mcp`, authenticated with an API token as
`Authorization: Basic <base64(email:api_token)>`.

## Setup

1. An organization admin must allow API token authentication for the Rovo MCP server — see
   Atlassian's [Configure authentication via API token](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-authentication-via-api-token/).
2. Create an API token **with scopes** at <https://id.atlassian.com/manage-profile/security/api-tokens>.
   The v2 server checks its own `agent-interface` scopes: pick at least `read:jira:agent-interface`,
   `search:jira:agent-interface`, `read:confluence:agent-interface`,
   `search:confluence:agent-interface` and `search:rovo:agent-interface`, plus
   `write:jira:agent-interface` and `write:confluence:agent-interface` if agents should create or
   edit. A token without them lists few or no tools. Atlassian's
   [Supported tools](https://support.atlassian.com/atlassian-ai-gateway/docs/supported-tools/) page
   gives the scope of every tool.
3. Encode `email:token` as one line of base64:
   - macOS / Linux: `printf '%s' 'you@example.com:YOUR_TOKEN' | base64 | tr -d '\n'`
   - Windows (PowerShell): `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('you@example.com:YOUR_TOKEN'))`
4. Marketplace → Available → `atlassian-mcp` → **Install…**; then Connectors → a set →
   Add server → `atlassian` → paste the base64 text into **Base64 of email:API token** →
   Save and test.

The server shows agents its most-used tools and lets them find the others on demand, so it adds
little to an agent's context. A few tools accept OAuth only (the Supported tools page marks them);
they never appear with an API token.

The token acts as you: agents can do whatever your Jira and Confluence permissions allow, without
asking. API tokens expire — when the Test starts saying `token rejected`, create a new token and
paste its base64 again. An API-token session is not bound to one site: tools that need a `cloudId`
take it as an argument. A service-account API key uses `Authorization: Bearer <key>` instead — add
it as a manual server (Servers → Add MCP server, **Bearer token** ticked).
