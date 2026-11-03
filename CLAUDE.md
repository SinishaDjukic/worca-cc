# Worca — working in this repo

## Where code goes (after the #919 split)

- **API routes** go in `ui/routes/<feature>/<area>.mjs`, registered by that feature's `index.mjs`. Never add routes to
  `ui/server.mjs`: it holds only sign-in, guards, body limits and wiring, and its size is capped.
- **CSS and markup** go in `ui/public/<feature>/` parts, listed in `ui/public/parts.json`. There is no
  `ui/public/style.css` or `ui/public/index.html` to edit any more.
- **Feature names** come from `tools/split-by-feature/feature-map.json`. A new area or CSS section gets one line there.
- **A red split guard means "move it", never "add an exception".** Do not add entries to
  `tools/parity/route-classes.json`, `tools/split-by-feature/pinned.json` or `tools/split-by-feature/central-routes.json`,
  and do not delete lines elsewhere, to make it pass.
- **An old branch from before the split** catches up with `npm run split:catch-up -- <branch> --parity none`.

`node tools/split-by-feature.mjs --check` enforces this (docs/split-by-feature.md, After the split).
