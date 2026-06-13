# Add Project screenshots

Screenshots referenced by `docs-site/src/content/docs/getting-started/add-your-project.md`. Drop the PNGs in this directory; the docs page links them with absolute `/screenshots/add-project/<name>.png` paths.

## Required files

| Filename | Section in docs | Suggested framing |
|---|---|---|
| `01-dialog.png` | After the Steps list | The **Add Project** dialog with a representative path filled in (e.g. `/Users/<you>/Projects/<repo>`) so the **Project Name** field shows its auto-generated slug. **Single project** mode selected — the radios show **Single project / Multiple projects**. Crop tight to the dialog card with a sliver of the dimmed backdrop visible so the reader recognises it as a modal. |
| `02-setup-wizard.png` | Under "The setup wizard" | The **Project Setup** wizard on its first step ("Your Project Environment"), showing the 5-dot step indicator and the preflight checklist (git repository, worca runtime, PR base branch, Graphify, CRG). Same tight-crop + backdrop-sliver framing as the dialog. |

## Conventions

- **Format**: PNG.
- **Width**: target the docs-site reading column width (~500–800 px works for dialog-focused shots).
- **Background**: light mode. Dark-mode variants can land later under `<name>-dark.png`.
- **State hygiene**: dismiss the notification permission banner and hide the help-mode "Docs" edge tab before capturing. Use a path that is *not* a real registered project so the dialog stays in its "new entry" state.
