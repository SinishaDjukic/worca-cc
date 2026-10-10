# Architecture (C4): design

Worca learns to read a codebase and keep a LikeC4 model of it, and to draw that model the way the Workflow Composer draws a pipeline: in Worca's own tokens, in the app, on the website, and as an image you can paste anywhere. This document is the design for the feature: what it is, why it is shaped this way, every file it adds, and what it does not do.

Status: proposal, with a working reference implementation of every part (viewer, parser, three script cards, two agents, the workflow) exercised against Worca's own repository.

## 1. What the person gets

- **A pipeline, "Architecture (C4)".** Pick it on New pipeline, point it at a project or a workspace, describe what you want. It finds the project's `.c4` files, asks which one to update (or how to lay out a new one), reads the code, writes the model, checks it, renders every view, and commits the lot on the run's branch like any other run.
- **A viewer, `<worca-c4>`.** One web component that draws any LikeC4 file: in the run's Artifacts tab when you select a `.c4`, in a page of the docs site, or in a blank `c4-viewer.html` you drop a file onto. Same renderer everywhere, so the picture in the app is the picture on the website is the JPEG.
- **A deployment sheet with your layers.** The deployment view is drawn as bands: *You / Worca host / Models*, or whatever the file declares. The person writes, once, what belongs in each band, in plain prose; the architect places elements by those words on every later run; the viewer draws the result the same way every time.
- **Images.** The render step writes SVG and JPEG per view next to the file. The viewer has a download button. Ask Worca can set the render card's parameters from a card ("export the deployment view as JPEG").

## 2. Why this shape

**Architecture as code needs a text source of truth the agent can edit and a human can diff.** LikeC4 is that: a readable DSL with elements, typed relationships, nesting, deployment nodes and views, and an ecosystem (CLI, VS Code, static sites). We write a *subset* of it and never leave the subset, so a Worca file is always a valid LikeC4 file.

**Layout must be deterministic, placement must not be.** A diagram that moves every time the model changes is useless for review. So the viewer's layout is a fixed convention with no choices in it (section 5), and the one judgement call, which element goes in which layer, is made by the architect from criteria the person wrote, and stored in the file where a reviewer can see it. The diff on a run shows exactly which elements moved and why.

**One renderer, three homes.** The viewer is a dependency-free module that renders SVG from the parsed model. SVG is what makes everything else cheap: embedding is an element, export is serialising what is on screen, theming is reading Worca's tokens at render time, and the render card produces the same picture headlessly in Node.

**No build step, no new daemon.** Like the rest of `ui/public`, the viewer is plain ES modules. Its one dependency, dagre, is vendored (the Composer already ships its own geometry; this is the same stance). Parsing happens in the page, so a dropped file renders with no CLI in the loop.

## 3. The pieces

| Piece | File | What it is |
|---|---|---|
| Viewer | `ui/public/c4/c4-view.mjs` | Parser, view resolution, two layouts, SVG renderer, `<worca-c4>`, `renderToSVG()` for Node |
| Layout engine | `ui/public/c4/dagre.min.js` | Vendored dagre 1.x (the only dependency; graph views and `order 'dependencies'`) |
| Artifacts tab | `ui/public/artifact-view-c4.mjs` | Adds the `c4` viewer kind on top of `artifact-view-media.mjs`; two-line wiring change in the run detail view |
| Standalone page | `docs/c4-viewer.html` | Drop zone, view picker, theme switch, SVG/JPEG download; the page the website embeds |
| Discover card | `scripts/c4-discover.mjs` (`c4Discover`) | Lists `.c4` / `.likec4` files in the checkout or every workspace member, with their views and bands |
| Setup agent | `agents/worca-cc-architect-setup.md` (`architectSetup`) | Raises the `c4-setup` Ask form: which file, or a new one, and its bands and criteria |
| Architect agent | `agents/worca-cc-architect.md` (`architect`) | Reads the code, writes or updates the file, checks it, writes the envelope and the report |
| Check card | `scripts/c4-check.mjs` (`c4Check`) | Parses with the viewer's parser; blocks on parse errors, unresolved references, empty bands; loops back to the architect |
| Check CLI | `scripts/c4-check-cli.mjs` | The same check from a shell, for the architect's own loop and for people |
| Render card | `scripts/c4-render.mjs` (`c4Render`) | SVG per view, JPEG/PNG through Playwright when present; wire-settable params |
| Workflow | `workflows/architecture-c4.json` (`wf_architecture_c4`) | Task → Discover → Setup → Architect ⇄ Check → Render → End |

## 4. The file format

The architect writes, and the viewer reads, this subset of LikeC4:

```
specification {
  element module { style { shape rectangle color slate } }
  deploymentNode zone
  relationship loop { color amber line dashed }
  tag gate
  color worcaRed #c8323c
}
model {
  worca = system 'Worca' {
    app = process '@worca/app' {
      engines = module 'Engine adapters' { description '…' technology 'src/core/engines' #gate }
    }
  }
  worca.app.engines -> claudeCode 'one headless process per agent step'
  a -[loop]-> b 'review → fix'
}
deployment {
  you = zone 'You' { metadata { criteria '…' order 'declared' }  webui = instanceOf worca.webui }
  host = machine 'Worca host' { technology 'Dev machine · Server'
    app = runtime '@worca/app' { metadata { order 'dependencies' }  engines = instanceOf worca.app.engines }
  }
}
views {
  view index { title '…' include * }
  view engine of worca.app { include * exclude worca.cli }
  dynamic view run { title '…' developer -> worca.webui 'describes the task' }
  deployment view deployment { include you.*, host.*, host.app.* }
}
```

The parser (`parseC4`) is a hand-written tokenizer and recursive descent over this grammar. It also accepts LikeC4's own JSON export (`fromExport`), so a file produced by the official CLI works unchanged. View resolution (`buildViews`) reproduces LikeC4's rules exactly on Worca's own 14-view model: `*`, `x.*`, `x.**`, include/exclude order, relation collapsing to the nearest included ancestor, the neighbour rule for a scoped `include *` (outside elements are pulled in, collapsed to the scope's sibling level, with only the relations that brought them in), `exclude * -> *`, and ancestor groups in deployment views. The test is `likec4 export json` on the same file: node and edge counts must match on every view.

Three things we deliberately do not support: `extend` beyond adding children, `where` predicates in views, and `global` styles. A file that uses them still parses (blocks are skipped) but the view will differ from LikeC4's.

## 5. The deployment convention

This is the whole of the layout rule, and the viewer applies nothing else.

1. **Every top-level node in `deployment { }` is a band**, a full-width horizontal layer, drawn in declaration order with its title as a small-caps label and a rule.
2. **A node with children is a frame** inside its parent, recursively: a rounded panel with the title and the `technology` badges centred at the top. A top-level node with a `technology` and children that are themselves frames (a host) draws as the dashed boundary with the pill tags, which is the look of the original poster.
3. **A leaf is a tile.** An `instanceOf` inherits the element's title and description; its own `technology` is split on ` · ` into badges. Tags `gate` tint the tile amber; `beta` and `unverified` colour the badges.
4. **Placement inside a container** follows `metadata { order }`: `declared` (the default for bands: one row, equal widths), `alphabetical`, or `dependencies` (the default for a frame whose children relate to each other: a top-to-bottom dependency layout, ranks wider than six wrapped into two rows, every rank centred).
5. **Arrows** are relationships between placed elements, derived from the model: an instance stands for its element and the element's descendants. Down leaves the bottom edge, up leaves the top edge, same-row arcs over the top, with endpoints spread along the edge when several share it. Selecting a tile dims everything unrelated and colours its outgoing arrows indigo and its incoming amber.
6. **Criteria are never interpreted.** `metadata { criteria '…' }` is shown in the info rail and handed to the architect. The viewer does not read it.

What this buys: the same file always draws the same sheet; a reviewer reading a diff of the deployment block knows exactly what the picture will do; and the person's layering decision is written down once, in the file, next to the things it governs.

## 6. The pipeline, step by step

```
Task ──┬──────────────────────────────────────────┐
       ▼                                          ▼
  c4Discover ──found──▶ architectSetup ──answers──▶ architect ──model──▶ c4Check ──checked──▶ c4Render ──▶ End
       └──────────────found───────────────────────▲      ▲ fix (≤2 cycles) ◀── review ┘
```

**Discover** walks the checkout (each member on a workspace run), parses every `.c4` with the viewer's parser and reports views, bands and criteria per file. Deterministic, no model.

**Setup** is a clarifier agent that writes one line of JSON to raise the `c4-setup` form. The form carries the discovery result as a table. The person chooses:
- *Update a found file* (table-select of the files) or *Create a new file* (a path, default `docs/architecture/architecture.c4`);
- *Scope*: whole project, or only what the task names;
- for a new file, *Grouping bands*: a preset (`People · Clients · Host · External`, `You · Host · Services · Data · Models`, or none) or *My own*, a textarea with one band per line, `Name — criteria`, two-space indent for a frame inside the band above;
- free notes for the architect.

When discovery finds nothing, the table is empty and only the "create" branch applies. The CLI and chat get the text projection of the same form; `/answer target="Create a new file"` works.

**Architect** reads the code (sub-agents per top-level directory), writes the file in the subset, runs `c4-check-cli.mjs` until clean, and writes two outputs: the `model` envelope (`{ path, created, bands, views }`) for the cards, and a short report for the person (what changed, bands and counts, unplaced elements with the criteria they would need, docs-vs-code findings, what was not verified). Criteria go into the file verbatim; an element that matches no band is left out and listed, never forced in.

**Check** is the gate. It parses the file, resolves every view and blocks on: parse error, unresolved reference, no views, an empty band, an instance pointing nowhere. Minor findings (a view that omits a band, placed-kind elements left off the sheet) pass with a note. A blocking report routes to the architect's `fix` port, at most twice; on the fix cycle the architect repairs those findings only and does not re-survey.

**Render** writes `<name>.renders/<view>.svg` for every view (or the `views` param's list) and, when Playwright resolves on the host, `.jpg` or `.png` at the `scale` param through a headless page showing the same SVG. Without a browser it writes SVG and says so. Params are wire-settable, so a card from Ask Worca can set `formats`, `views` and `theme`.

The run ends with the file and the renders on the run branch, the report under Artifacts, and the `.c4` openable in the viewer from the Artifacts tab.

## 7. Embedding

```html
<script src="/c4/dagre.min.js"></script>
<script type="module" src="/c4/c4-view.mjs"></script>

<worca-c4 src="/docs/architecture/architecture.c4" view="deployment" info toolbar></worca-c4>
```

- `src` fetches a `.c4` or a JSON export; `el.load(text | json)` does the same from memory.
- `view` picks the view by id; `el.views` lists them; `el.view = 'id'` switches.
- `info` shows the rail (view description and criteria; on selection, the element's description, id and its incoming and outgoing relationships). `toolbar` adds the view picker, the counts and the JPEG button. Omit both for a bare embed.
- `el.selected = 'id'` and the `c4-select` event bridge to a host page; `c4-ready` and `c4-error` report loading.
- `await el.export({ format: 'jpeg' | 'png', scale: 2, view?: 'id' })` returns a Blob; `el.toSVG()` returns the markup.
- Theme is read from the host's tokens (`--panel`, `--ink`, `--line-2`, the colour families) at render time, with Worca's light and dark values as fallback, so the component follows the app's `data-theme` and the OS setting. Fonts are the page's: Poppins and JetBrains Mono when the host loads them, system fonts otherwise. A JPEG uses the fonts the browser has; pass `font: { family, dataUrl }` to `export()` to embed one.

In the app, `artifact-view-c4.mjs` adds the `c4` viewer kind so a `.c4` artifact opens in the component inside the existing Artifacts dialog; the docs site uses `docs/c4-viewer.html`, which also serves as the drop-anything playground.

## 8. Style

The viewer uses Worca's tokens and nothing else: `--panel` cards with `--line-2` borders, `--field` tiles, the colour families for element kinds (a LikeC4 colour name maps to the family of the same name; a custom hex is tinted over the panel), `--amber-wash` for gates, `--indigo` arrows, `--seq` for element-view relations, the `.gv-canvas` dot grid behind the sheet, the Composer's zoom cluster at the bottom right, and the inspector rail's typography for the info rail. Bands and the host boundary reproduce `docs/architecture.html`: small-caps band labels with a rule, the dashed boundary with the ink pill and peach tags, the stacked-card look for the ×N frame.

## 9. Security and limits

- The architect runs with the same tools as the implementer and writes only inside the checkout. The cards read the checkout and write beside the file; `c4Render` launches a browser only to screenshot HTML it generated itself from the SVG.
- The parser runs on untrusted text in the browser. It builds no HTML from the file; every string goes through one escaper into SVG text nodes and attributes. `link` URLs are shown as text in the rail, not followed.
- Sizes: the sheet is 1120 px wide; a band wider than that wraps. Element views are capped by dagre, not by us; a view with hundreds of elements is slow and should be split in the file.
- Export is client-side canvas; a very large sheet at `scale: 3` can exceed a browser's canvas limit and comes back empty. The card's Playwright path has no such limit.

## 10. What it does not do

- It is not a LikeC4 editor. Edits happen in the file, by the architect or by hand.
- It does not draw LikeC4's `where`-filtered views, `global` styles or manual layouts. It does not import other `.c4` files (`import` is skipped).
- It does not place elements. Placement is the architect's job, judged by the person's criteria and reviewed in the diff; the viewer only draws what is placed and leaves out what is not.
- It is not a dependency scanner. The architect reads imports and call sites with its own tools; the model is as good as that reading, which is why the report has a "Not verified" section and the check has an "Unplaced" list.

## 11. Open questions

- **Where should criteria live long term:** `metadata { criteria }` on each node (current), or one `metadata` block on the deployment view? Per node keeps the rule next to the thing it governs and survives views being added; the view-level form is shorter. Current choice: per node.
- **Should Check be stricter?** It could compare the model to the previous run's and flag elements that vanished. Useful once a project has history; premature now.
- **Workspace runs:** discovery and the architect handle members, but a workspace-wide model wants one file in a chosen member (the metrics home is the obvious candidate). Not decided.
- **The website:** `docs/c4-viewer.html` embeds Worca's tokens inline. The docs site should instead load its own stylesheet and keep the viewer's token reads; that is a site change, not a viewer change.

## 12. Verification done

- The parser and view resolution were checked against `likec4 export json` on Worca's own `architecture.c4` (94 elements, 118 relationships, 14 views): identical node and edge sets on every view.
- The three cards ran headlessly in the engine's calling convention against a checkout containing that file: discover found and described it, check passed it with one minor finding, render wrote SVG and JPEG for the requested views.
- The viewer was screenshotted in light and dark, with selection, on the deployment sheet, an element view, a dynamic view and the 35-element module view; `export()` returned a JPEG from the browser.
- Not done: a mock pipeline run end to end in a Worca instance, the Artifacts-tab wiring in a real build, the website embed, and the Ask card that sets the render params.
