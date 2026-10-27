# Keep awake

While a run has agents working, Worca stops the computer sleeping on its idle timer. The display
may still turn off.

It is on by default. Turn it off or back on with **Keep awake** in the account menu (the profile
corner). The choice is saved as `keepAwake` in `settings.json` (only `false` is stored) and can also
be set with `POST /api/settings { "keepAwake": false }`. It takes effect at once.

- A run waiting on a question, paused or ended does not count.
- Nothing is held on a container or hosted worca.
- The UI server holds one child tied to its pid: `caffeinate -i -w <pid>` on macOS,
  `systemd-inhibit --what=idle` wrapping `tail --pid <pid>` on Linux, a PowerShell child holding
  `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` on Windows. A missing tool logs one
  warning and never affects a run.

Keep awake used to be the feature flag `keepAwake`. On first start, an install that had turned
the flag off gets `keepAwake: false`.
