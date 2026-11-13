# Stillhet findings for follow-up runs

Minor findings from the web UI reviews. Each one is left for a follow-up run with its own PR, not fixed in the slice
that found it.

## Tasks (slice 5)

- **404s in the console on a task page.** Each live task page load logs "Failed to load resource" 404 lines, 12 across
  6 pages in the slice 5 web UI recheck (cycle 4). There were no uncaught errors and no failed module loads. The URLs
  were not captured. Likely sources are the page's part reads that answer 404 by design: telemetry with Labs off, a
  run with no history row yet, and a missing setup. Next step: capture the URLs, then either skip a read the page knows
  will 404 or keep the 404 and document it.
