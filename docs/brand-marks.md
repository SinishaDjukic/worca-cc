# Brand marks

Worca shows a small mono mark beside the name of a third-party product it works with (`ui/public/brand-marks.mjs`).
Issue #1104 tracks the wider rollout.

## Rules

- Artwork is the owner's, unaltered. Colour comes from the neutral ink token, so a coloured chip never tints a logo.
- A mark stands beside the product's name. A dense PR chip has no room for the name, so its mark carries the name as a
  tooltip and accessible label, and only a cleared mark appears there.
- A mark is never Worca branding and implies no endorsement or partnership.
- Files are self-hosted, with no hotlinking.
- A product without a cleared mark shows the generic icon.
- Model rows show no icon until a model maker (`anthropic` or `openai`) is cleared, because identical icons on every row
  tell them apart from nothing. From then on, a model from any other maker, or a local model, shows the generic icon.

## Status

An owner decides each clearance. Clearing a mark means checking the source below, then adding its artwork to
`BRAND_MARKS` and updating this table and `THIRD_PARTY_NOTICES.md`. No other code changes.

Reviewed 2026-11-06. This is an engineering reading of public pages, not legal advice. No page addresses a 14px mark
beside a product's name in a dashboard, so every verdict applies general rules to that use. Marks are filled with
`currentColor` today, and most owners below forbid recolouring, so most would need their official file drawn unchanged.

Verdicts: **Shipped** is in `BRAND_MARKS`. **Conditional** is allowed with the listed conditions. **Silent** means no
applicable owner rule was found, which is not permission. **Permission** means the owner asks to be asked. **Blocked**
means the owner's text bars this use, though the owner could grant an exception.

### Marks in use

| Brand | Verdict | Notes |
|---|---|---|
| GitHub | Shipped, review | [Logo rules](https://brand.github.com/foundations/logo) limit logos to white, black, or in few cases grey or green. The standalone mark is for places where the brand is clearly established, and the only explicit third-party example is a social button. Must be less prominent than Worca's own name. |
| GitHub Copilot | Shipped, review | Octicons `copilot-24`, MIT. No Copilot-specific logo rule was checked. |
| Goose | Shipped, Silent | Project glyph, Apache-2.0, which grants no trademark rights. No brand page or trademark file found. |
| Slack | In `chat-origin.mjs`, Blocked | [Brand terms](https://slack.com/terms-of-service/slack-brand) bar making logos available and say most uses need a written licence. Text saying an app integrates is fine. Current brand site could not be read. |
| Microsoft Teams | In `chat-origin.mjs`, Permission | [Microsoft's rules](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general) require an express licence for icons. Truthful compatibility text is fine. |
| Discord | In `chat-origin.mjs`, Permission | [Branding page](https://discord.com/branding) requires permission outside listed uses, which don't cover integrations. Its recolour rule and its black and white variants read inconsistently. |
| Telegram | In `chat-origin.mjs`, Conditional | [Logo page](https://telegram.org/tour/screenshots) allows illustrative use if clearly unofficial. Product UI is not clearly covered. |

### Candidates

| Brand | Verdict | Conditions or blocker |
|---|---|---|
| Warp | Silent | [Official glyphs](https://github.com/warpdotdev/brand-assets), black and white, MIT. |
| Ghostty | Silent | Logo in the website repo under MIT; that the licence covers the logo is an inference. |
| llama.cpp | Silent | Icon in the MIT repo. Mark ownership after the Hugging Face acquisition is unconfirmed. |
| Cursor | Silent | [Brand kit](https://cursor.com/brand) has a cube but states no usage rule. |
| Railway | Silent | [Design page](https://railway.com/design) offers logos with no usage text. |
| iTerm2 | Silent | Repo is GPL-2.0 and has no SVG, so copying the art into an MIT repo raises a copyleft question. |
| ElevenLabs | Silent | [Brand page](https://elevenlabs.io/brand) has black and white symbols, but its terms restrict adopting marks without approval. Ask first. |
| Zed | Conditional | [Brand page](https://zed.dev/brand): pure #000 or #FFF only, no implied connection. |
| OpenRouter | Conditional | [Brand page](https://openrouter.ai/brand): official Ink or Cloud glyph, no recolouring. Silent on integrations. |
| OpenCode | Conditional | Brand text in the repo lets integrations say so through a badge or partner lockup. It also bars other words next to the logo, which may catch a mark beside the name. Ask. |
| Gemini CLI | Conditional | Official monotone file, name beside it, plain "works with", attribution line. The Gemini mark itself needs permission. Its brand kit says another CLI replaced Gemini CLI on 2026-06-18, so recheck. |
| Bitbucket | Conditional | Official file, resize only, identify compatibility. Atlassian's neutral variant is brand-approved; a Bitbucket neutral file is unconfirmed. |
| Rust | Conditional | CC-BY credit and disclosed changes; must not look official. |
| Ruby | Conditional | CC BY-SA 2.5, so a recoloured file stays share-alike, not MIT. Keep it as a separate attributed file. |
| vLLM | Conditional | Foundation black or white files under Linux Foundation guidelines. Whether they apply to vLLM is unclear. |
| LM Studio | Conditional | Official variants only. Its misuse list bars separating icon and wordmark, yet icon-only files are offered. |
| Firebase | Conditional, weak | Monochrome and logomark variants exist, but in-product use is barred for the standard lockup. |
| Notion | Conditional, weak | Trademark page requires attribution and no implied endorsement. Its brand guidelines could not be read. |
| JetBrains | Conditional, colour only | Recolouring is barred, so no mono mark. A colour tile needs a link, attribution and no endorsement; 14px is under its minimum. |
| Anthropic, Claude | Permission | [Trademark guidelines](https://www.anthropic.com/legal/trademark-guidelines) require approval. |
| OpenAI, Codex | Permission, provisional | Brand page returned HTTP 403, so this rests on search excerpts only. |
| Azure DevOps | Permission | Microsoft rules above; the Azure icon set is for diagrams, training and documentation. |
| Qwen, Qwen Code | Permission | [Terms](https://qwen.ai/termsservice) require written consent. Coverage of Qwen Code is unconfirmed. |
| Ollama | Permission | [Terms](https://ollama.com/terms) grant no branding rights without permission. |
| Node.js | Permission | [OpenJS policy](https://trademark-policy.openjsf.org/) bars colour variations and logo parts. |
| Python | Permission | [PSF policy](https://www.python.org/psf/trademarks/) allows unaltered logos for compatibility; colour changes need permission. |
| Terraform | Permission | [HashiCorp policy](https://www.hashicorp.com/en/trademark-policy) limits free use to your own website. |
| Cloudflare | Permission | [Trademark page](https://www.cloudflare.com/trademark/) requires written permission outside web badges. |
| Visual Studio Code | Blocked for mono | [Brand page](https://code.visualstudio.com/brand) bars modified versions. "Open in VS Code" as text is fine. |
| Jira | Blocked for mono | Atlassian rules above, and no official mono file was found. |
| Azure Boards | Blocked | Microsoft rules above. Use text. |
| Flutter | Blocked | [Brand page](https://docs.flutter.dev/brand) bars colour variations; another page's in-product line was not fully resolved. |

File types (PDF, DOCX, HTML, MP4) and shell can use plain generic icons with no brand mark.

## Plugins

A plugin names a mark with the optional manifest field `icon`, a brand id from this page. It is an id and never artwork,
because plugins ship no browser code. An id without a cleared mark falls back to the plugin's kind tile. The name and
marketplace stay on the tile, since a manifest can claim any id.
