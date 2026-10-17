# Changelog

## Unreleased

### Implement Run Presets Feature

- Save, pick and manage run presets in New run: The web UI review's blocking findings are fixed with tests: Agents-row edits in preset mode now store concrete booleans (presetNodePick), so Start, Update preset and Save as new no longer get a 400; the hidden-settings note counts only model picks (4 agent picks); preset menu and Settings labels load workspaces and repaint after projects load.
- Save a finished run's setup as a preset, and start from the Chat home: Cycle 2 fixes the web UI review's one major issue: a Chat home chip and Settings › Presets Use now both go through usePresetOnNewRun, which awaits applyPreset and focuses the empty prompt, and each path has a test.
- Presets in schedules, the CLI and Ask Worca: The diff matches plan v5: v62 preset_id columns; the preset is read at fire time as its stored owner; worca run goes only through the probed server; Ask propose_run takes presetId through the shared validator and refuses a Permissive preset; the flag moves to beta.
