# Changelog

## Unreleased

### Security: worca's trust boundaries

- Worca's own git calls in a project or run checkout never run a hook or config command an agent planted in the shared `.git`, including a filter behind a conditional include on `git worktree add` (runs, terminal branch folders, team metrics and policy). Model-chosen code in the chat (`test_script` with a draft, a `command`/`code` param, or a built-in or plugin script) runs only behind an approval card that shows every value it runs. Under agent isolation, every caller on the box (all of 127.0.0.0/8 included) needs the instance token. `/answer`, `/approve`, `/retry`, `/abort` and `/cancel` follow the `/direct` rule in group chats. The credential broker gives the body budget back at a deadline and books paused readers, large JSON answers and every stream flag. Artifact routes read the file the link check passed. A relayed chat's MCP config is readable only by that person's agent user.
- **Upgrade notes.**
  - Schema v71. Existing installs keep Permissive guardrails through the `store_meta` row; new installs start on Normal. Unmerged branches that add a schema version must renumber.
  - Broker: multi mode without agent users exits 78 unless `WORCA_AGENT_ISOLATION=0` is set. `WORCA_IDENTITY_HEADER` in multi mode needs `WORCA_IDENTITY_TRUSTED_PROXIES`. A Responses call with `background: true` is refused (its cost could not be booked). A request body must keep arriving and be complete within 120 s.
  - UI server: `WORCA_IDENTITY_HEADER` is read only from `WORCA_IDENTITY_TRUSTED_PROXIES` (IPs or CIDRs), and worca does not start with the header set but no trusted proxy.
  - With agents under their own users, worca does not start while `WORCA_BROKER_SECRET_FILE` is readable by its group or by others: make it `0600`, owned by the user worca runs as.
  - Network: on bare metal with `WORCA_HOST=0.0.0.0` in local mode, LAN callers now get 403. A local proxy that rewrites Host while the browser's Origin keeps another port gets 403 too.
  - Isolation: callers of the API from inside the box (curl scripts, the Railway probe) must send `X-Worca-UI-Token` from `ui.json`; the `worca` CLI does.
  - Image: rebuild for the `worca-plugin` user (uid 1002). The entrypoint re-permissions `plugins/` on each boot and makes `tmp/ask` sticky.
  - Chat: in a group chat `/direct` and the answer commands need a sender in `allowedUserIds`, or `directInGroups: anyone`. On Discord every chat is a group (the bot receives no direct messages).

### Projects: New never overrides; Remove deletes worca's own folders

- New by name names what blocks it: a registered project by its stored name, a folder by its path ("<path> is already registered as "<name>""), in the dialog, over the API and on Ask cards; a refusal from Create itself keeps Create off until the name changes.
- Remove project on a Folder project whose folder worca made in its projects folder (`<worcaHome>/projects`) now deletes that folder too, after a red confirm naming it (`DELETE /api/projects?…&deleteFolder=1`; without it such a removal answers 409). Git projects, folders added from elsewhere, custom projects roots and symlinks are only unregistered, as before. Removal is refused (409) while a run of the project is running or paused.

### Implement Run Presets Feature

- Save, pick and manage run presets in New run: The web UI review's blocking findings are fixed with tests: Agents-row edits in preset mode now store concrete booleans (presetNodePick), so Start, Update preset and Save as new no longer get a 400; the hidden-settings note counts only model picks (4 agent picks); preset menu and Settings labels load workspaces and repaint after projects load.
- Save a finished run's setup as a preset, and start from the Chat home: Cycle 2 fixes the web UI review's one major issue: a Chat home chip and Settings › Presets Use now both go through usePresetOnNewRun, which awaits applyPreset and focuses the empty prompt, and each path has a test.
- Presets in schedules, the CLI and Ask Worca: The diff matches plan v5: v62 preset_id columns; the preset is read at fire time as its stored owner; worca run goes only through the probed server; Ask propose_run takes presetId through the shared validator and refuses a Permissive preset; the flag moves to beta.
