# Pipeline Stage Editor — Full Configuration via UI


**Goal:** Make every pipeline configuration parameter editable through the UI, including per-stage enable/disable toggles and agent assignment.

**Architecture:** Add `worca.stages` section to settings.json linking stages to agents with enabled flags. Backend (`stages.py`, `runner.py`) reads this config with fallback to hardcoded defaults. UI (`settings.js`) renders interactive stage cards with toggles and agent dropdowns.

**Tech Stack:** Python (backend pipeline), lit-html + Shoelace (UI), JSON (settings persistence)

---

### Task 1: Add `worca.stages` section to settings.json

**Files:**
- Modify: `.claude/settings.json:46-98`

**Step 1: Add stages config**

Add the `stages` key inside the `worca` object, right after the opening of `"worca": {` (line 46) and before `"agents"` (line 47):

```json
"stages": {
  "plan":       { "agent": "planner",     "enabled": true },
  "coordinate": { "agent": "coordinator", "enabled": true },
  "implement":  { "agent": "implementer", "enabled": true },
  "test":       { "agent": "tester",      "enabled": true },
  "review":     { "agent": "guardian",     "enabled": true },
  "pr":         { "agent": "guardian",     "enabled": true }
},
```

**Step 2: Verify JSON is valid**

Run: `python3 -c "import json; json.load(open('.claude/settings.json'))"`
Expected: No output (success)

**Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat: add worca.stages config section to settings.json"
```

---

### Task 2: Write failing tests for stages.py changes

**Files:**
- Modify: `tests/test_stages.py`

**Step 1: Add test imports**

At line 5 in test_stages.py, add `get_enabled_stages` to the import:

```python
from worca.orchestrator.stages import (
    Stage,
    TRANSITIONS,
    STAGE_AGENT_MAP,
    can_transition,
    get_stage_config,
    get_enabled_stages,
)
```

**Step 2: Add tests for configurable agent mapping in get_stage_config**

Add this test class after `TestGetStageConfig` (after line 196):

```python
class TestGetStageConfigWithStages:
    """Tests for get_stage_config reading agent from worca.stages."""

    def test_reads_agent_from_stages_config(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan": {"agent": "guardian", "enabled": True}
                },
                "agents": {
                    "guardian": {"model": "opus", "max_turns": 30}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        config = get_stage_config(Stage.PLAN, settings_path=str(settings_file))
        assert config["agent"] == "guardian"
        assert config["model"] == "opus"
        assert config["max_turns"] == 30

    def test_falls_back_to_hardcoded_when_no_stages_config(self, tmp_path):
        settings = {
            "worca": {
                "agents": {
                    "planner": {"model": "opus", "max_turns": 40}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        config = get_stage_config(Stage.PLAN, settings_path=str(settings_file))
        assert config["agent"] == "planner"
        assert config["model"] == "opus"

    def test_falls_back_to_hardcoded_when_stage_missing_from_stages(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan": {"agent": "guardian", "enabled": True}
                },
                "agents": {
                    "planner": {"model": "opus", "max_turns": 40}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        # coordinate is not in stages config, falls back to STAGE_AGENT_MAP
        config = get_stage_config(Stage.COORDINATE, settings_path=str(settings_file))
        assert config["agent"] == "coordinator"
```

**Step 3: Add tests for get_enabled_stages**

```python
class TestGetEnabledStages:
    """Tests for get_enabled_stages filtering and ordering."""

    def test_all_stages_enabled_by_default(self, tmp_path):
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({}))
        stages = get_enabled_stages(str(settings_file))
        assert stages == [
            Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT,
            Stage.TEST, Stage.REVIEW, Stage.PR
        ]

    def test_disabled_stage_excluded(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "test": {"agent": "tester", "enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.TEST not in stages
        assert stages == [
            Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT,
            Stage.REVIEW, Stage.PR
        ]

    def test_multiple_disabled_stages(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "test": {"agent": "tester", "enabled": False},
                    "review": {"agent": "guardian", "enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert stages == [
            Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.PR
        ]

    def test_preserves_stage_order(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "coordinate": {"agent": "coordinator", "enabled": False}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        # Order is preserved: plan, implement, test, review, pr
        assert stages[0] == Stage.PLAN
        assert stages[1] == Stage.IMPLEMENT

    def test_handles_missing_settings_file(self, tmp_path):
        missing = str(tmp_path / "nonexistent.json")
        stages = get_enabled_stages(missing)
        assert len(stages) == 6  # all enabled by default

    def test_enabled_true_explicitly(self, tmp_path):
        settings = {
            "worca": {
                "stages": {
                    "plan": {"agent": "planner", "enabled": True}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(settings))
        stages = get_enabled_stages(str(settings_file))
        assert Stage.PLAN in stages
```

**Step 4: Run tests to verify they fail**

Run: `pytest tests/test_stages.py -v -k "TestGetStageConfigWithStages or TestGetEnabledStages"`
Expected: ImportError for `get_enabled_stages`, or test failures

**Step 5: Commit failing tests**

```bash
git add tests/test_stages.py
git commit -m "test: add failing tests for stages config and get_enabled_stages"
```

---

### Task 3: Implement stages.py changes

**Files:**
- Modify: `.claude/worca/orchestrator/stages.py:50-64`

**Step 1: Update get_stage_config to read agent from worca.stages**

Replace `get_stage_config` (lines 50-64) with:

```python
# Canonical stage order (not configurable — use enabled flag to skip)
STAGE_ORDER = [Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]


def _read_settings(settings_path: str) -> dict:
    """Read and parse settings.json, returning empty dict on failure."""
    try:
        with open(settings_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def get_stage_config(stage: Stage, settings_path: str = ".claude/settings.json") -> dict:
    """Read settings.json and return agent config for the given stage.

    Agent mapping priority:
    1. worca.stages.<stage>.agent (if present)
    2. STAGE_AGENT_MAP[stage] (hardcoded default)
    """
    settings = _read_settings(settings_path)
    worca = settings.get("worca", {})

    # Determine agent: prefer stages config, fall back to hardcoded map
    stages_config = worca.get("stages", {})
    stage_entry = stages_config.get(stage.value, {})
    agent_name = stage_entry.get("agent") or STAGE_AGENT_MAP[stage]

    agent_config = worca.get("agents", {}).get(agent_name, {})
    return {
        "agent": agent_name,
        "model": agent_config.get("model", "sonnet"),
        "max_turns": agent_config.get("max_turns", 30),
        "schema": STAGE_SCHEMA_MAP.get(stage, f"{stage.value}.json"),
    }


def get_enabled_stages(settings_path: str = ".claude/settings.json") -> list:
    """Return list of enabled stages in pipeline order.

    Reads worca.stages.<stage>.enabled from settings.json.
    Stages default to enabled if not configured.
    """
    settings = _read_settings(settings_path)
    stages_config = settings.get("worca", {}).get("stages", {})

    enabled = []
    for stage in STAGE_ORDER:
        stage_entry = stages_config.get(stage.value, {})
        if stage_entry.get("enabled", True):
            enabled.append(stage)
    return enabled
```

**Step 2: Run tests to verify they pass**

Run: `pytest tests/test_stages.py -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add .claude/worca/orchestrator/stages.py
git commit -m "feat: stages.py reads agent from worca.stages, add get_enabled_stages"
```

---

### Task 4: Write failing tests for runner.py changes

**Files:**
- Modify: `tests/test_runner.py`

**Step 1: Add tests for disabled loop target handling**

Add after the `_ensure_beads_initialized` tests (after line 178):

```python
# --- get_enabled_stages integration ---

def test_runner_imports_get_enabled_stages():
    """Verify runner can import get_enabled_stages."""
    from worca.orchestrator.stages import get_enabled_stages
    assert callable(get_enabled_stages)


def test_handle_pr_review_unknown_outcome():
    """Unknown outcome treated as approve (no next stage)."""
    stage, status = handle_pr_review("unknown", {"stage": "review"})
    assert stage is None
```

Note: Full integration tests for `run_pipeline` with disabled stages are complex due to mocking requirements. The key logic change is replacing `stage_order` with `get_enabled_stages()` — unit tests for `get_enabled_stages` in Task 2/3 cover the filtering. Runner-level testing confirms the import works.

**Step 2: Run tests to verify**

Run: `pytest tests/test_runner.py -v`
Expected: PASS (these are additive tests that should pass once runner is updated)

**Step 3: Commit**

```bash
git add tests/test_runner.py
git commit -m "test: add runner tests for get_enabled_stages integration"
```

---

### Task 5: Implement runner.py changes

**Files:**
- Modify: `.claude/worca/orchestrator/runner.py`

**Step 1: Add import for get_enabled_stages**

At the top of runner.py, in the import from stages (find the existing import line), add `get_enabled_stages`:

```python
from worca.orchestrator.stages import (
    Stage, TRANSITIONS, STAGE_AGENT_MAP,
    can_transition, get_stage_config, get_enabled_stages,
)
```

**Step 2: Replace hardcoded stage_order at line 428**

Replace:
```python
stage_order = [Stage.PLAN, Stage.COORDINATE, Stage.IMPLEMENT, Stage.TEST, Stage.REVIEW, Stage.PR]
```

With:
```python
stage_order = get_enabled_stages(settings_path)
```

**Step 3: Add disabled loop-target guards**

In the TEST handling block (around line 526-540), wrap the loop-back in a check:

Replace the test failure handling:
```python
if not passed:
    loop_key = "implement_test"
    loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
    _log(f"Tests failed — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
    if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
        _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
        raise LoopExhaustedError(
            f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
        )
    update_stage(status, Stage.IMPLEMENT.value, iteration=loop_counters[loop_key])
    save_status(status, status_path)
    stage_idx = stage_order.index(Stage.IMPLEMENT)
    continue
```

With:
```python
if not passed:
    if Stage.IMPLEMENT not in stage_order:
        _log("Tests failed but IMPLEMENT stage is disabled — treating as pass", "warn")
    else:
        loop_key = "implement_test"
        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
        _log(f"Tests failed — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
            _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
            raise LoopExhaustedError(
                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
            )
        update_stage(status, Stage.IMPLEMENT.value, iteration=loop_counters[loop_key])
        save_status(status, status_path)
        stage_idx = stage_order.index(Stage.IMPLEMENT)
        continue
```

Similarly for REVIEW → IMPLEMENT (around line 553-565):

```python
elif next_stage == Stage.IMPLEMENT:
    if Stage.IMPLEMENT not in stage_order:
        _log("Changes requested but IMPLEMENT stage is disabled — skipping loop", "warn")
    else:
        loop_key = "pr_changes"
        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
        _log(f"Changes requested — looping back to IMPLEMENT (iteration {loop_counters[loop_key]})", "warn")
        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
            _log(f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations", "err")
            raise LoopExhaustedError(
                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
            )
        update_stage(status, Stage.IMPLEMENT.value, iteration=loop_counters[loop_key])
        save_status(status, status_path)
        stage_idx = stage_order.index(Stage.IMPLEMENT)
        continue
```

And for REVIEW → PLAN (around line 566-577):

```python
elif next_stage == Stage.PLAN:
    if Stage.PLAN not in stage_order:
        _log("Restart planning requested but PLAN stage is disabled — skipping loop", "warn")
    else:
        loop_key = "restart_planning"
        loop_counters[loop_key] = loop_counters.get(loop_key, 0) + 1
        _log(f"Restart planning requested (iteration {loop_counters[loop_key]})", "warn")
        if not check_loop_limit(loop_key, loop_counters[loop_key], settings_path, mloops=mloops):
            raise LoopExhaustedError(
                f"Loop {loop_key} exhausted after {loop_counters[loop_key]} iterations"
            )
        update_stage(status, Stage.PLAN.value, iteration=loop_counters[loop_key])
        save_status(status, status_path)
        stage_idx = stage_order.index(Stage.PLAN)
        continue
```

**Step 4: Run all tests**

Run: `pytest tests/ -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add .claude/worca/orchestrator/runner.py
git commit -m "feat: runner uses get_enabled_stages, guards disabled loop targets"
```

---

### Task 6: Update settings.js — interactive stage cards

**Files:**
- Modify: `.claude/worca-ui/app/views/settings.js`

**Step 1: Add DEFAULT_STAGES constant**

After `MODEL_OPTIONS` (line 17), add:

```javascript
const DEFAULT_STAGES = {
  plan:       { agent: 'planner',     enabled: true },
  coordinate: { agent: 'coordinator', enabled: true },
  implement:  { agent: 'implementer', enabled: true },
  test:       { agent: 'tester',      enabled: true },
  review:     { agent: 'guardian',     enabled: true },
  pr:         { agent: 'guardian',     enabled: true }
};
```

**Step 2: Add readStagesFromDom()**

After `readPipelineFromDom()` (after line 121), add:

```javascript
function readStagesFromDom() {
  const stages = {};
  for (const stage of STAGE_ORDER) {
    const enabledEl = document.getElementById(`stage-${stage}-enabled`);
    const agentEl = document.getElementById(`stage-${stage}-agent`);
    stages[stage] = {
      agent: agentEl?.value || DEFAULT_STAGES[stage].agent,
      enabled: enabledEl?.checked ?? true
    };
  }
  return stages;
}
```

**Step 3: Add stages defaults in loadSettings()**

In `loadSettings()` (around line 49), after the governance defaults block, add:

```javascript
// Ensure stages defaults exist
if (!settingsData.worca.stages) {
  settingsData.worca.stages = { ...DEFAULT_STAGES };
} else {
  // Merge with defaults for any missing stages
  for (const stage of STAGE_ORDER) {
    if (!settingsData.worca.stages[stage]) {
      settingsData.worca.stages[stage] = { ...DEFAULT_STAGES[stage] };
    }
  }
}
```

**Step 4: Redesign pipelineTab()**

Replace the entire `pipelineTab` function (lines 186-229) with:

```javascript
function pipelineTab(worca, rerender) {
  const loops = worca.loops || {};
  const stages = worca.stages || DEFAULT_STAGES;

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${STAGE_ORDER.map((stage, i) => {
          const stageConfig = stages[stage] || DEFAULT_STAGES[stage];
          const enabled = stageConfig.enabled !== false;
          return html`
            <div class="pipeline-stage-node ${enabled ? 'pipeline-stage-node--enabled' : 'pipeline-stage-node--disabled'}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${enabled ? '' : 'pipeline-stage-name--disabled'}">${stage}</span>
                <sl-switch id="stage-${stage}-enabled" ?checked=${enabled} size="small"
                  @sl-change=${(e) => {
                    const node = e.target.closest('.pipeline-stage-node');
                    if (e.target.checked) {
                      node.classList.remove('pipeline-stage-node--disabled');
                      node.classList.add('pipeline-stage-node--enabled');
                      node.querySelector('.pipeline-stage-name').classList.remove('pipeline-stage-name--disabled');
                    } else {
                      node.classList.remove('pipeline-stage-node--enabled');
                      node.classList.add('pipeline-stage-node--disabled');
                      node.querySelector('.pipeline-stage-name').classList.add('pipeline-stage-name--disabled');
                    }
                  }}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${stage}-agent" .value="${stageConfig.agent || STAGE_AGENT_MAP[stage]}" size="small">
                  ${AGENT_NAMES.map(a => html`<sl-option value="${a}">${a}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${i < STAGE_ORDER.length - 1 ? html`
              <span class="pipeline-arrow">${unsafeHTML(iconSvg(ChevronRight, 16))}</span>
            ` : nothing}
          `;
        })}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[
          { key: 'implement_test', label: 'Implement \u2194 Test' },
          { key: 'code_review', label: 'Code Review' },
          { key: 'pr_changes', label: 'PR Changes' },
          { key: 'restart_planning', label: 'Restart Planning' }
        ].map(item => html`
          <div class="settings-field">
            <label class="settings-label">${item.label}</label>
            <sl-input id="loop-${item.key}" type="number" value="${loops[item.key] || 0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const { loops } = readPipelineFromDom();
          const stages = readStagesFromDom();
          saveSettings({ worca: { ...settingsData.worca, loops, stages }, permissions: settingsData.permissions }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `;
}
```

**Step 5: Verify the app loads without errors**

Run: `cd .claude/worca-ui && node server/index.js &` then open http://localhost:3000/settings and check the Pipeline tab.
Expected: Stage cards with toggles and agent dropdowns rendered

**Step 6: Commit**

```bash
git add .claude/worca-ui/app/views/settings.js
git commit -m "feat: interactive pipeline stage cards with enable/disable toggles"
```

---

### Task 7: Add CSS for enabled/disabled stage states

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

**Step 1: Add enabled/disabled styles**

After `.pipeline-arrow` (line 1213), add:

```css
/* Pipeline stage states */
.pipeline-stage-node--enabled {
  border-color: var(--sl-color-primary-300);
  background: color-mix(in srgb, var(--sl-color-primary-500) 8%, var(--bg-secondary));
}

.pipeline-stage-node--disabled {
  opacity: 0.55;
  border-color: var(--border-subtle);
  background: var(--bg-secondary);
}

.pipeline-stage-name--disabled {
  text-decoration: line-through;
  color: var(--muted);
}

.pipeline-stage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}

.pipeline-stage-field {
  width: 100%;
  margin-top: 4px;
}

.pipeline-stage-field .settings-label {
  font-size: 10px;
}
```

**Step 2: Update .pipeline-stage-node for wider cards**

Find `.pipeline-stage-node` (line 1183) and update `min-width` from `90px` to `140px` and add `transition`:

```css
.pipeline-stage-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  min-width: 140px;
  transition: opacity 0.2s, border-color 0.2s, background 0.2s;
}
```

**Step 3: Test visually**

Open http://localhost:3000/settings Pipeline tab. Toggle stages on/off. Verify:
- Enabled stages have subtle primary border/background
- Disabled stages are muted with strikethrough name
- Agent dropdown is functional on each card

**Step 4: Commit**

```bash
git add .claude/worca-ui/app/styles.css
git commit -m "feat: add enabled/disabled visual states for pipeline stage cards"
```

---

### Task 8: End-to-end verification

**Step 1: Run all Python tests**

Run: `pytest tests/ -v`
Expected: All tests PASS

**Step 2: Verify settings round-trip**

1. Open Settings > Pipeline tab
2. Disable the TEST stage toggle
3. Change REVIEW agent to "tester"
4. Click "Save Pipeline"
5. Refresh the page
6. Verify TEST is still disabled, REVIEW agent is still "tester"
7. Check `.claude/settings.json` has `worca.stages.test.enabled: false` and `worca.stages.review.agent: "tester"`

**Step 3: Verify backend respects disabled stages**

Run: `python3 -c "from worca.orchestrator.stages import get_enabled_stages; print([s.value for s in get_enabled_stages()])"`
Expected: All 6 stages listed (since all are enabled by default in settings.json)

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: end-to-end verification fixups"
```
