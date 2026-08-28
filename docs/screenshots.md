# Screenshots — how they were made

The images in `docs/screenshots/` are captured from a real Worca instance
running against seeded demo data, so they can be reproduced after UI changes.

## Recipe

1. **Sandbox a Worca home** so the demo never touches your real state:

   ```bash
   export WORCA_HOME=/tmp/worca-shots        # DB + store go here
   ```

   Caveat: the global `~/.worca-cc/settings.json` (root pointer, custom model
   catalog, budgets) is **always** read from your real home — `WORCA_HOME`
   moves only the DB and store. Don't capture the Models view (or anything
   showing your own model names) from a machine with private entries.

2. **Create demo projects** — small, plausible repos with real code, e.g. a
   tiny Express CRM (`nimbus-crm`) and a markdown site generator
   (`atlas-docs`). Each needs at least one commit.

3. **Seed history with mock runs** (offline, free) using realistic prompts:

   ```bash
   worca --project /tmp/demo/nimbus-crm \
     --prompt "Add CSV export for filtered contact lists with streaming output" \
     --title "CSV export for contacts" --mock --yes
   ```

   Two mock-mode blemishes to fix up afterwards, straight in
   `$WORCA_HOME/.worca-cc/worca-cc.db`:

   - mock title generation overwrites `--title` with a `[mock] …` string —
     restore `pipelines.title` by id;
   - mock runs record `$0.00` / `1s` — set plausible `total_cost_usd` /
     `total_active_ms`, spread `started_at` over the past week, and insert
     matching `cost_ledger` rows so Statistics draws real-looking charts.

4. **Run one or two real pipelines** for the money shots — the Running page
   mid-run, real clarify questions, and a run-detail diff. Start them from
   the UI/server (CLI-started runs don't appear on the Running page of a
   separately started server). Budget roughly $10–15 per full run on a small
   task.

5. **Capture** at a 1440×900 viewport (Playwright), light theme, default
   density unless the shot is about density. Crop nothing; the sidebar is
   part of the product.

## Current set

| File | View | Source |
| --- | --- | --- |
| `running.png` | Running, detailed density, real run mid-refine | real run |
| `clarify.png` | Clarify question panel | real run |
| `run-detail.png` | History detail, Diff tab | real run |
| `history.png` | History list, grouped by project | mock + real |
| `composer.png` | Pipeline Composer, default graph | — |
| `stats.png` | Statistics, "This week" | seeded ledger |
| `new-pipeline.png` | New Pipeline form | demo projects |
| `agents.png` | Agents list | — |
| `guardrails.png` | Guardrails sets | — |
| `plugins.png` | Plugins & marketplace | bundled marketplace |

> `composer.png` predates the node-graph composer — re-shoot it before the next release.
