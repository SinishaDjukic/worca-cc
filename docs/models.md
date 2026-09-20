# Models, providers and the bridge

Every model call Worca makes goes through the Claude Code CLI, which speaks
one wire protocol: the Anthropic Messages API. This page covers how a model
gets into the catalog, how it reaches its endpoint, and what Worca's built-in
**bridge** does for endpoints that do not speak that protocol — GitHub Copilot
first, then any OpenAI-compatible endpoint — with no LiteLLM and no second
daemon.

Settings › Models is the one place for all of it. It is an **Expert**-level tab
(see [ui-levels.md](ui-levels.md)); anything that blocks a run shows at every
level.

## Three ways a model connects

| Connection | What happens | When to use it |
|---|---|---|
| **Anthropic API / CLI default** | The `claude` CLI uses its own login or the `ANTHROPIC_*` env it inherits. | A first-party Anthropic account. |
| **Custom endpoint via env** | The entry's routing env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, …) is merged into that model's spawns. | An endpoint that already speaks the Messages API: a LiteLLM you run, Bedrock / Vertex via the CLI's own env, a gateway. |
| **Through a provider** | Worca points the CLI at its own loopback bridge, which forwards to the provider — passing Anthropic-shaped calls through, or translating them to OpenAI chat completions. | GitHub Copilot; OpenAI, Azure, Ollama, vLLM, Groq, an in-house gateway; an Anthropic-compatible gateway that needs a key Worca holds. |

The choice is the **Connection** section at the top of the model editor.

## Providers

The **Providers** card sits above the catalog on Settings › Models. A provider
is account-level state that every model bridged through it shares.

**GitHub Copilot.** *Sign in…* reads you the notice below, then shows an
8-character device code: enter it at github.com/login/device and the card
flips to *connected as @you*. Worca stores the GitHub token in
`~/.worca-cc/settings.json` (or reads it from your shell as `${VAR}`) and
exchanges it for Copilot's short-lived token in memory, refreshed before it
expires. *Import models…* lists what Copilot offers your account; *Refresh
usage* shows the premium-request quota. The account type (Individual /
Business / Enterprise) picks the API host when the sign-in does not name one.

**OpenAI-compatible** and **Anthropic-compatible.** A base URL, an API key
(stored masked, or `${VAR}`), and *Test connection*. A model can override
either under its Connection's *Advanced* disclosure.

**Max concurrent requests** is per provider. Requests over the cap wait; they
never fail. For Copilot it is the one knob that lowers the abuse-detection risk
described below, so it ships at 4.

### The Copilot notice

Worca talks to Copilot through the same API GitHub's editor extensions use,
identifying itself as an editor client. GitHub's terms allow Copilot only
through supported clients, and GitHub has suspended Copilot access for
automated or unsupported use. Pipelines are automated, high-volume use.

- Your GitHub account, not Worca, carries this risk.
- Worca caps concurrent requests and never signs in without you.
- Premium-request quotas apply per your plan; Worca shows usage but cannot
  enforce it.

You acknowledge this once per machine (the date shows on the card, *Re-read
notice* shows it again), and again if the wording changes. `worca models login
copilot --accept-terms` records it non-interactively.

## What the bridge does

- **Claude models on Copilot** use Copilot's native Anthropic endpoint. The
  request and the streamed reply pass through byte for byte, so extended
  thinking and cache accounting arrive intact.
- **Other vendors on Copilot, and OpenAI-compatible endpoints** run through a
  translation layer: system prompt, text, images, tool definitions, tool calls
  and results map to chat completions; the streamed reply maps back to Messages
  events; usage and stop reasons map; a context overflow becomes the
  "prompt is too long" the CLI compacts on. Translated models have **no
  thinking blocks** (Worca's effort maps to `reasoning_effort` where the model
  supports it, else only *medium* is offered), **no WebSearch/WebFetch** (the
  runner withholds them), and lower prompt limits than Anthropic's.
- The bridge listens on `127.0.0.1` on a random port, one per Worca process,
  and accepts only a per-process secret the CLI carries. It never runs as a
  separate service and holds no credentials on disk beyond `settings.json`.

Each card shows a `bridged: <provider>` badge and, for translated models, a
line naming the degradations. A model whose provider is not usable — not
signed in, notice not acknowledged, key unset — shows **needs sign-in** and
leaves every picker until it is; a run that already names it fails at its next
spawn with the fix in the message rather than with an opaque 401.

## Cost and quota

The CLI prices a bridged call by its model *name*, which it does not know, so
it reports **$0**. Copilot bills premium requests, not tokens, so imported
Copilot entries are pinned *Free* and Worca counts the requests a run
initiated instead (the cost pill reads `$0 · N requests`). A generic
OpenAI-compatible entry is flagged *cost not verified* until you pin a
per-million-token price on it.

## Import from Copilot

*Import models…* shows Copilot's chat models with vendor, context window and
capabilities. Anthropic models are imported with the passthrough API, every
other vendor with the translated one; efforts are trimmed to *medium* for
models without reasoning; pricing is *Free*. A second import refreshes
capabilities and never overwrites a label, efforts or price you edited. Models
disabled in your GitHub Copilot settings are listed greyed with the fix.

## CLI

```
worca models list                       # catalog with bridge facts
worca models providers                  # provider state, never a token
worca models login copilot [--accept-terms]
worca models logout copilot
worca models import copilot [--all | --pick id,id] [--yes]
worca models test <copilot|openai|anthropic>
worca models set openai apiKey='${OPENAI_KEY}' baseUrl=https://…/v1
```

A `worca --model copilot-gpt-5 --prompt …` run starts its own bridge.

## Plugins and team policy

A plugin manifest's `models[]` entry may carry the same `upstream` block
(`provider`, `api`, `model`, optional `baseUrl` / `headers` / `capabilities`).
A plugin never ships a credential: a `copilot` entry resolves against each
user's own sign-in, and an `apiKey` must be a `${VAR}` reference. A team policy
may ship `upstream` models under the same rule.

## Troubleshooting

- **401 / "not signed in"** — sign in again on the Providers card; Copilot
  tokens can be revoked on GitHub's side.
- **"prompt is too long" early in a run** — expected on a translated model:
  Copilot's prompt limits are well below Anthropic's, and the run compacts.
- **"model not found"** — the upstream id is not offered to your account; pick
  one from *Import models…*.
- **"requests queued for copilot"** in the run log — the concurrency cap is
  doing its job; raise it on the Providers card if you accept the risk.
- **A server tool error naming WebSearch** — a translated model cannot run
  Anthropic server tools; the runner already withholds them for pipeline
  nodes, so this means an agent definition asked for one explicitly.
