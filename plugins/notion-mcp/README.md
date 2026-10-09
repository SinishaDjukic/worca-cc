# notion-mcp

Notion's open-source MCP server for worca's MCP registry (plugin API 5):
`npx -y @notionhq/notion-mcp-server` over stdio, authenticated with an internal integration secret.

Notion's hosted server (`https://mcp.notion.com/mcp`) needs an interactive OAuth sign-in, which
worca does not run. Notion no longer actively maintains the open-source server; it talks to the
public Notion API.

## Setup

1. Create an internal integration at <https://www.notion.so/profile/integrations> and copy its
   secret (`ntn_…`; older integrations show `secret_…`).
2. In Notion, connect the pages and databases agents may use to the integration (page `⋯` →
   Connections).
3. Marketplace → Available → `notion-mcp` → **Install…**; then Connectors → a set →
   Add server → `notion` → paste the secret into **Notion integration secret** → Save and
   test.
