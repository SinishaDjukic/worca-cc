# W-022: API Duration & Turn Metrics in Pipeline UI

**Status:** Draft
**Area:** cc + ui
**Date:** 2026-03-13

---

## Problem

The pipeline detail page shows cost per stage and iteration but lacks two key performance metrics:

1. **API Duration** — time spent in LLM API calls (available as `duration_api_ms` from the SDK result but not captured or stored)
2. **Turn totals** — turns are stored per iteration but not aggregated at stage or pipeline level in the UI

These metrics help identify bottlenecks (API latency vs tool execution) and gauge agent efficiency (fewer turns = better prompting).

## Current State

### What the SDK result event provides

```json
{
  "duration_ms": 24000,        // Total SDK execution time (wall-clock from SDK perspective)
  "duration_api_ms": 19500,    // Time spent in LLM API calls only
  "num_turns": 5,
  "total_cost_usd": 0.042,
  "usage": { "input_tokens": ..., "output_tokens": ..., ... }
}
```

### What worca-cc currently captures per iteration

| Field | Source | Stored as |
|-------|--------|-----------|
| Wall-clock duration | `time.time()` delta | `iteration.duration_ms` |
| Turns | `raw_envelope["num_turns"]` | `iteration.turns` |
| Cost | `raw_envelope["total_cost_usd"]` | `iteration.cost_usd` |
| SDK duration | `raw_envelope["duration_ms"]` | `iteration.token_usage.duration_ms` (nested, not displayed) |
| API duration | `raw_envelope["duration_api_ms"]` | **NOT CAPTURED** |

### What the UI currently shows

**Pipeline header** (`run-info-section`, run-detail.js:255-263):
```
Started: ...    Finished: ...    Duration: ...
Pipeline Cost: $3.43
```

**Stage header meta strip** (collapsed, run-detail.js:291-315):
```
IMPLEMENT  ↻ 2 iterations  🪙 $1.06  🕐 2026.03.12 14:18  ⏱ 3m 15s  [completed]
```

**Stage totals strip** (expanded, multi-iteration stages, run-detail.js:337-338):
```
Cost: $1.06    Duration: 3m 15s
```

**Single-iteration stage info strip** (expanded, run-detail.js:366-367):
```
Turns: 5    Cost: $0.38
```

**Iteration detail view** (inside tab, run-detail.js:133-135):
```
Turns: 5    Iteration Cost: $0.42    Iteration Duration: 2m 10s
```

---

## Changes

### Part 1: Capture `duration_api_ms` in worca-cc

#### 1a. runner.py — Store on iteration record

**File:** `.claude/worca/orchestrator/runner.py` (line ~827)

In `run_stage()`, after the existing `raw_envelope.get("num_turns")` block, add extraction of `duration_api_ms`:

```python
if isinstance(raw_envelope, dict):
    if raw_envelope.get("duration_api_ms"):
        iter_extras["duration_api_ms"] = raw_envelope["duration_api_ms"]
    if raw_envelope.get("num_turns"):
        iter_extras["turns"] = raw_envelope["num_turns"]
    ...
```

#### 1b. token_usage.py — Add to extracted fields

**File:** `.claude/worca/utils/token_usage.py` (line ~34)

Add `duration_api_ms` to `extract_token_usage()`:

```python
"duration_api_ms": raw_envelope.get("duration_api_ms", 0) or 0,
```

Also add `"duration_api_ms"` to `_SUMMABLE_FIELDS` (line ~60) so `aggregate_token_usage()` sums it.

#### 1c. No changes to status.py

`complete_iteration()` already accepts arbitrary `**kwargs` — no schema change needed.

#### Resulting iteration record in status.json

```json
{
  "number": 1,
  "status": "completed",
  "turns": 5,
  "cost_usd": 0.042,
  "duration_ms": 24000,
  "duration_api_ms": 19500,
  ...
}
```

---

### Part 2: Pipeline header — add API Duration and Total Turns

**File:** `.claude/worca-ui/app/views/run-detail.js` (lines 255-263)

Currently the pipeline header computes `pipelineCost` by reducing all iterations. Extend this IIFE to also compute `pipelineApiDuration` and `pipelineTurns`:

```javascript
const allIters = Object.values(stages).flatMap(s => s.iterations || []);
const pipelineCost = allIters.reduce((sum, it) => sum + (it.cost_usd || 0), 0);
const pipelineApiMs = allIters.reduce((sum, it) => sum + (it.duration_api_ms || 0), 0);
const pipelineTurns = allIters.reduce((sum, it) => sum + (it.turns || 0), 0);
```

Render as a single `pipeline-cost-strip` row with all three metrics:

```
Pipeline Cost: $3.43    API Duration: 8m 22s    Total Turns: 109
```

**Naming:**
- **"Pipeline Cost:"** — existing, unchanged
- **"API Duration:"** — new, uses `meta-label` + `meta-value` classes
- **"Total Turns:"** — new, uses `meta-label` + `meta-value` classes

Only show each metric if its value is > 0.

---

### Part 3: Stage panels — add API Duration and Turns

#### 3a. Stage header meta strip (collapsed view)

**File:** `run-detail.js` (lines 291-315)

The collapsed stage header shows icon+value pills: iterations, cost, timestamp, duration. Add **turns** after iterations (if > 0):

```
IMPLEMENT  ↻ 2 iterations  ⟳ 10 turns  🪙 $1.06  🕐 14:18  ⏱ 3m 15s  [completed]
```

Compute stage turns: `const stageTurns = iterations.reduce((sum, it) => sum + (it.turns || 0), 0);`

Use the existing `RefreshCw` icon (or reuse the pattern) for turns. The value format is `N turns`.

**Note:** Only show if `stageTurns > 0`. Place after the iterations pill and before the cost pill.

#### 3b. Stage totals strip (expanded, multi-iteration stages)

**File:** `run-detail.js` (lines 337-338)

Currently shows:
```
Cost: $1.06    Duration: 3m 15s
```

Add **API Duration** and **Turns**:

```
Cost: $1.06    Duration: 3m 15s    API Duration: 2m 50s    Turns: 10
```

Compute:
```javascript
const stageApiMs = iterations.reduce((sum, it) => sum + (it.duration_api_ms || 0), 0);
const stageTurns = iterations.reduce((sum, it) => sum + (it.turns || 0), 0);
```

**Naming:**
- **"Cost:"** — existing, unchanged
- **"Duration:"** — existing, unchanged
- **"API Duration:"** — new
- **"Turns:"** — new

Only show each if value > 0.

#### 3c. Single-iteration stage info strip (expanded, single-iteration stages)

**File:** `run-detail.js` (lines 366-367)

Currently shows:
```
Turns: 5    Cost: $0.38
```

Add **API Duration** after Turns:

```
Turns: 5    API Duration: 1m 50s    Cost: $0.38
```

Use `iterations[0].duration_api_ms` with `formatDuration()`. Only show if present.

---

### Part 4: Iteration detail — add API Duration

**File:** `run-detail.js` (lines 133-135)

Currently the `_iterationDetailView()` shows:
```
Turns: 5    Iteration Cost: $0.42    Iteration Duration: 2m 10s
```

Add **API Duration** between Turns and Iteration Cost:

```
Turns: 5    API Duration: 1m 50s    Iteration Cost: $0.42    Iteration Duration: 2m 10s
```

**Naming:** "API Duration:" (not "Iteration API Duration" — keep it short since we're already inside an iteration context).

Only show if `iter.duration_api_ms` is truthy. Use `formatDuration(iter.duration_api_ms)`.

---

### Part 5: Token & Cost Dashboard — add columns

**File:** `.claude/worca-ui/app/views/token-costs.js`

#### 5a. Run summary row (lines ~181-200)

Currently shows: timestamp, cost, turns, duration per run. Add **API Duration** after duration.

#### 5b. Expanded iteration table (lines ~229-244)

Currently the table columns are:
```
Stage | Iter | Cost | Turns | Duration | Input | Output | Cache Read | Cache Write
```

Add **API Duration** column after Duration:

```
Stage | Iter | Cost | Turns | Duration | API Duration | Input | Output | Cache Read | Cache Write
```

Value: `iter.duration_api_ms ? formatDuration(iter.duration_api_ms) : '-'`

---

### Part 6: Stage JSON export — add field

**File:** `run-detail.js`, `_stageToJson()` function (line ~70-87)

Add `duration_api_ms` to the iteration map:

```javascript
duration_api_ms: it.duration_api_ms || undefined,
```

---

## Naming Summary

| Location | Label | Example |
|----------|-------|---------|
| Pipeline header | **"API Duration:"** | API Duration: 8m 22s |
| Pipeline header | **"Total Turns:"** | Total Turns: 109 |
| Stage header meta (collapsed) | icon + **"N turns"** | ⟳ 10 turns |
| Stage totals strip (expanded) | **"API Duration:"** | API Duration: 2m 50s |
| Stage totals strip (expanded) | **"Turns:"** | Turns: 10 |
| Single-iteration info strip | **"API Duration:"** | API Duration: 1m 50s |
| Iteration detail | **"API Duration:"** | API Duration: 1m 50s |
| Cost dashboard table header | **"API Duration"** | column header |

All labels use `meta-label` class for consistency. All values use `meta-value` class.

---

## Files to Modify

| File | Changes |
|------|---------|
| `.claude/worca/orchestrator/runner.py` | Capture `duration_api_ms` from raw_envelope into iteration record |
| `.claude/worca/utils/token_usage.py` | Add `duration_api_ms` to extraction and summable fields |
| `.claude/worca-ui/app/views/run-detail.js` | Add pipeline totals, stage totals, iteration detail for API duration and turns |
| `.claude/worca-ui/app/views/token-costs.js` | Add API Duration column to cost table |
| `.claude/worca-ui/app/main.bundle.js` | Rebuild via `npm run build` |

## Verification

1. Run a pipeline (or use an existing completed run)
2. Open the run detail page
3. Verify pipeline header shows: `Pipeline Cost: $X.XX    API Duration: Xm Xs    Total Turns: N`
4. Verify each stage collapsed header shows turns pill
5. Expand a multi-iteration stage — verify totals strip shows API Duration and Turns
6. Check iteration tabs — verify API Duration appears per iteration
7. Check the Costs page — verify API Duration column in the expanded table
8. For runs completed before this change, `duration_api_ms` will be missing — verify graceful fallback (fields hidden, not "0" or errors)
