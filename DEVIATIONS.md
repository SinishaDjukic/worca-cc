## Implementation Deviations

No deviations were made from the planned implementation. All issues identified in the code review were addressed exactly as specified:

1. **Major: Missing mock flag in `/api/runs` and `/api/history` API endpoints**
   - Updated `/api/runs` endpoint to ensure mock field is present in pipeline objects
   - Verified `/api/history` endpoint already includes mock field via `listAllPipelines()`

2. **Major: Mock pill and dot visibility not adjusted for collapsed sidebar**
   - Updated `setSidebarCollapsed` function to call `updateMockUI()` when sidebar state changes
   - `updateMockUI` function already contained logic to show/hide pill and dot based on sidebar collapsed state

3. **Minor: Missing tooltip text on mock tag**
   - Verified that all mock tag elements already have the required `title="Mock run — no Claude calls were made."` attribute:
     - Run detail header (`ui/public/index.html`)
     - History list items (`ui/public/index.html`)  
     - Running list (handled in `ui/public/app.js` `paintRunCard` function)
     - Schedules view (`ui/public/schedules-view.mjs`)

4. **Minor: Missing mock tag in run detail header**
   - Verified mock tag element already exists in run detail header template (`ui/public/index.html`)

All implementation followed the approved plan exactly with no deviations in approach, file layout, naming, or scope.