# Settings Page Implementation Plan


**Goal:** Add a full-page Settings view to worca-ui that visualizes and allows editing all pipeline configuration from `.claude/settings.json`.

**Architecture:** REST API endpoints (GET/POST /api/settings) on the Express server read/write the worca namespace of settings.json. A new `settings.js` view uses lit-html + Shoelace tabs to render 4 config sections (Agents, Pipeline, Governance, Preferences). Navigation via sidebar gear icon + hash router.

**Tech Stack:** lit-html, Shoelace Web Components, Lucide icons, Express REST API, fetch()

---

### Task 1: Add Settings REST API Endpoints

**Files:**
- Modify: `.claude/worca-ui/server/app.js`
- Modify: `.claude/worca-ui/server/index.js` (pass settingsPath to app)

**Step 1: Add GET/POST /api/settings to server/app.js**

Replace the entire `server/app.js` with:

```javascript
// server/app.js
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

export function createApp(options = {}) {
  const app = express();
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

  app.use(express.json());

  // Settings API
  if (options.settingsPath) {
    app.get('/api/settings', (_req, res) => {
      try {
        const raw = JSON.parse(readFileSync(options.settingsPath, 'utf8'));
        res.json({ ok: true, worca: raw.worca || {} });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.post('/api/settings', (req, res) => {
      try {
        const raw = JSON.parse(readFileSync(options.settingsPath, 'utf8'));
        const incoming = req.body.worca || {};
        // Deep-merge into worca namespace only
        raw.worca = raw.worca || {};
        if (incoming.agents) {
          raw.worca.agents = raw.worca.agents || {};
          for (const [name, cfg] of Object.entries(incoming.agents)) {
            raw.worca.agents[name] = { ...raw.worca.agents[name], ...cfg };
          }
        }
        if (incoming.loops) {
          raw.worca.loops = { ...raw.worca.loops, ...incoming.loops };
        }
        if (incoming.milestones) {
          raw.worca.milestones = { ...raw.worca.milestones, ...incoming.milestones };
        }
        writeFileSync(options.settingsPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
        res.json({ ok: true, worca: raw.worca });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  app.use(express.static(appDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile('index.html', { root: appDir });
  });
  return app;
}
```

**Step 2: Pass settingsPath to createApp in server/index.js**

In `server/index.js`, change line 17 from:
```javascript
const app = createApp();
```
to:
```javascript
const settingsPath = join(cwd, '.claude', 'settings.json');
const app = createApp({ settingsPath });
```

And update the `attachWsServer` call to use the same variable:
```javascript
attachWsServer(server, {
  worcaDir: join(cwd, '.worca'),
  settingsPath,
  prefsPath: join(homedir(), '.worca', 'preferences.json')
});
```

**Step 3: Commit**

```bash
git add .claude/worca-ui/server/app.js .claude/worca-ui/server/index.js
git commit -m "feat(settings): add GET/POST /api/settings REST endpoints"
```

---

### Task 2: Add Icons and Shoelace Imports

**Files:**
- Modify: `.claude/worca-ui/app/utils/icons.js`
- Modify: `.claude/worca-ui/app/main.js` (Shoelace imports only)

**Step 1: Add new Lucide icon imports to icons.js**

Add these imports after line 25 (`import Play ...`):

```javascript
import Settings from 'lucide/dist/esm/icons/settings';
import Shield from 'lucide/dist/esm/icons/shield';
import Workflow from 'lucide/dist/esm/icons/workflow';
import Sliders from 'lucide/dist/esm/icons/sliders-horizontal';
import Users from 'lucide/dist/esm/icons/users';
import Cpu from 'lucide/dist/esm/icons/cpu';
import ChevronRight from 'lucide/dist/esm/icons/chevron-right';
import Save from 'lucide/dist/esm/icons/save';
import Check from 'lucide/dist/esm/icons/check';
```

Add to the export block:
```javascript
export {
  Circle, CircleCheck, CircleAlert, Loader,
  Sun, Moon, Flag, RefreshCw, ArrowDown, Pause,
  Zap, Clock, AlertTriangle,
  Activity, Archive, Search, ArrowLeft,
  Square, Play,
  Settings, Shield, Workflow, Sliders, Users, Cpu,
  ChevronRight, Save, Check
};
```

**Step 2: Add Shoelace component imports to main.js**

After line 24 (`import ... dialog.js`), add:

```javascript
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
```

**Step 3: Commit**

```bash
git add .claude/worca-ui/app/utils/icons.js .claude/worca-ui/app/main.js
git commit -m "feat(settings): add icons and Shoelace component imports"
```

---

### Task 3: Add Router + Sidebar Navigation

**Files:**
- Modify: `.claude/worca-ui/app/views/sidebar.js`
- Modify: `.claude/worca-ui/app/main.js` (routing logic)

**Step 1: Add gear icon to sidebar footer**

In `sidebar.js`, add `Settings` to the icon import on line 3:

```javascript
import { iconSvg, Sun, Moon, Activity, Archive, Settings } from '../utils/icons.js';
```

Add a settings button in the sidebar footer, next to the theme toggle button (inside the `sidebar-footer` div, after the `connection-indicator` div and before the theme toggle button):

```javascript
      <div class="sidebar-footer">
        <div class="connection-indicator ${connClass}">
          <span class="conn-dot"></span>
          <span class="conn-label">${connLabel}</span>
        </div>
        <div class="sidebar-footer-buttons">
          <button
            class="theme-toggle-btn ${route.section === 'settings' ? 'active' : ''}"
            aria-label="Settings"
            @click=${() => onNavigate('settings')}
          >${unsafeHTML(iconSvg(Settings, 18))}</button>
          <button
            class="theme-toggle-btn"
            aria-label="Toggle theme"
            @click=${onThemeToggle}
          >${unsafeHTML(themeIcon)}</button>
        </div>
      </div>
```

**Step 2: Add settings route to main.js**

In `main.js`, add the settings view import at the top (after line 9):
```javascript
import { settingsView } from './views/settings.js';
```

In the `contentHeaderView()` function, add a case for settings after the history check (after line 291):
```javascript
  } else if (route.section === 'settings') {
    title = 'Settings';
    showBack = true;
  }
```

In the `mainContentView()` function, add a case for settings before the dashboard fallback (before line 341):
```javascript
  if (route.section === 'settings') {
    return settingsView({ onSaveSuccess: () => rerender() });
  }
```

**Step 3: Commit**

```bash
git add .claude/worca-ui/app/views/sidebar.js .claude/worca-ui/app/main.js
git commit -m "feat(settings): add sidebar gear icon and settings route"
```

---

### Task 4: Create Settings View — Agents Tab

**Files:**
- Create: `.claude/worca-ui/app/views/settings.js`

**Step 1: Create the settings view file with Agents tab**

Create `.claude/worca-ui/app/views/settings.js`:

```javascript
import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Cpu, Workflow, Shield, Sliders, Save, Check, ChevronRight, Users } from '../utils/icons.js';

// Local state for settings form
let settingsData = null;
let loading = true;
let saveStatus = null; // null | 'saving' | 'success' | 'error'
let saveError = '';
let activeTab = 'agents';

const AGENT_ORDER = ['planner', 'coordinator', 'implementer', 'tester', 'guardian'];
const AGENT_DESCRIPTIONS = {
  planner: 'Creates the implementation plan (MASTER_PLAN.md)',
  coordinator: 'Orchestrates agent dispatch and stage transitions',
  implementer: 'Writes code based on the plan',
  tester: 'Runs tests and validates implementation',
  guardian: 'Final review, holds commit authority'
};

const MODEL_OPTIONS = ['opus', 'sonnet', 'haiku'];

const STAGE_ORDER = ['plan', 'coordinate', 'implement', 'test', 'review', 'pr'];
const STAGE_AGENTS = {
  plan: 'planner',
  coordinate: 'coordinator',
  implement: 'implementer',
  test: 'tester',
  review: 'guardian',
  pr: 'guardian'
};

const DISPATCH_RULES = {
  planner: ['explore'],
  coordinator: [],
  implementer: ['explore'],
  tester: [],
  guardian: ['explore']
};

const GUARD_RULES = [
  { id: 'rm_rf', label: 'Block rm -rf', description: 'Prevent recursive force delete commands' },
  { id: 'env_write', label: 'Block .env writes', description: 'Prevent writing to .env files' },
  { id: 'force_push', label: 'Block force push', description: 'Prevent git push --force' },
  { id: 'commit_lock', label: 'Restrict git commit', description: 'Only guardian agent can commit' }
];

async function fetchSettings() {
  loading = true;
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.ok) {
      settingsData = data.worca;
    } else {
      settingsData = {};
    }
  } catch {
    settingsData = {};
  }
  loading = false;
}

async function saveSettings(partial, onSuccess) {
  saveStatus = 'saving';
  saveError = '';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worca: partial })
    });
    const data = await res.json();
    if (data.ok) {
      settingsData = data.worca;
      saveStatus = 'success';
      if (onSuccess) onSuccess();
      setTimeout(() => { saveStatus = null; if (onSuccess) onSuccess(); }, 2500);
    } else {
      saveStatus = 'error';
      saveError = data.error || 'Failed to save';
    }
  } catch (err) {
    saveStatus = 'error';
    saveError = err.message || 'Network error';
  }
}

function agentTabView(agents, onSave) {
  return html`
    <div class="settings-cards">
      ${AGENT_ORDER.map(name => {
        const agent = (agents || {})[name] || {};
        return html`
          <div class="settings-card">
            <div class="settings-card-header">
              <div class="settings-card-icon">${unsafeHTML(iconSvg(Cpu, 18))}</div>
              <div>
                <div class="settings-card-title">${name}</div>
                <div class="settings-card-desc">${AGENT_DESCRIPTIONS[name]}</div>
              </div>
            </div>
            <div class="settings-card-fields">
              <div class="settings-field">
                <label>Model</label>
                <sl-select
                  value="${agent.model || 'sonnet'}"
                  size="small"
                  @sl-change=${(e) => {
                    settingsData.agents = settingsData.agents || {};
                    settingsData.agents[name] = settingsData.agents[name] || {};
                    settingsData.agents[name].model = e.target.value;
                  }}
                >
                  ${MODEL_OPTIONS.map(m => html`<sl-option value="${m}">${m}</sl-option>`)}
                </sl-select>
              </div>
              <div class="settings-field">
                <label>Max Turns</label>
                <sl-input
                  type="number"
                  size="small"
                  value="${agent.max_turns || 30}"
                  min="1"
                  max="200"
                  @sl-change=${(e) => {
                    settingsData.agents = settingsData.agents || {};
                    settingsData.agents[name] = settingsData.agents[name] || {};
                    settingsData.agents[name].max_turns = parseInt(e.target.value, 10);
                  }}
                ></sl-input>
              </div>
            </div>
          </div>
        `;
      })}
    </div>
    ${saveButtonView(() => onSave({ agents: settingsData.agents }))}
  `;
}

function pipelineTabView(settings, onSave) {
  const loops = settings.loops || {};
  const milestones = settings.milestones || {};

  return html`
    <div class="settings-section">
      <h3 class="settings-section-title">Stage Order</h3>
      <div class="stage-flow">
        ${STAGE_ORDER.map((stage, i) => html`
          <div class="stage-flow-item">
            <div class="stage-flow-node">
              <span class="stage-flow-label">${stage}</span>
              <span class="stage-flow-agent">${STAGE_AGENTS[stage]}</span>
            </div>
            ${i < STAGE_ORDER.length - 1 ? html`
              <div class="stage-flow-arrow">${unsafeHTML(iconSvg(ChevronRight, 16))}</div>
            ` : ''}
          </div>
        `)}
      </div>
    </div>

    <div class="settings-section">
      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${Object.entries({
          implement_test: 'Implement/Test cycles',
          code_review: 'Code review iterations',
          pr_changes: 'PR change rounds',
          restart_planning: 'Planning restarts'
        }).map(([key, label]) => html`
          <div class="settings-field">
            <label>${label}</label>
            <sl-input
              type="number"
              size="small"
              value="${loops[key] || 0}"
              min="1"
              max="50"
              @sl-change=${(e) => {
                settingsData.loops = settingsData.loops || {};
                settingsData.loops[key] = parseInt(e.target.value, 10);
              }}
            ></sl-input>
          </div>
        `)}
      </div>
    </div>

    <div class="settings-section">
      <h3 class="settings-section-title">Milestone Gates</h3>
      <div class="settings-switches">
        ${Object.entries({
          plan_approval: 'Require plan approval before implementation',
          pr_approval: 'Require PR approval before merge',
          deploy_approval: 'Require deploy approval'
        }).map(([key, label]) => html`
          <div class="settings-switch-row">
            <sl-switch
              ?checked=${milestones[key] !== false}
              @sl-change=${(e) => {
                settingsData.milestones = settingsData.milestones || {};
                settingsData.milestones[key] = e.target.checked;
              }}
            >${label}</sl-switch>
          </div>
        `)}
      </div>
    </div>

    ${saveButtonView(() => onSave({
      loops: settingsData.loops,
      milestones: settingsData.milestones
    }))}
  `;
}

function governanceTabView() {
  return html`
    <div class="settings-section">
      <h3 class="settings-section-title">Guard Rules</h3>
      <p class="settings-section-desc">Safety rules enforced by PreToolUse hooks. These are hardcoded in the guard scripts.</p>
      <div class="settings-switches">
        ${GUARD_RULES.map(rule => html`
          <div class="settings-switch-row">
            <sl-switch checked disabled>${rule.label}</sl-switch>
            <span class="settings-switch-desc">${rule.description}</span>
          </div>
        `)}
      </div>
    </div>

    <div class="settings-section">
      <h3 class="settings-section-title">Test Gate</h3>
      <p class="settings-section-desc">Escalating strike system for test failures.</p>
      <div class="settings-info-card">
        <div class="settings-info-row">
          <span class="settings-info-label">1st failure</span>
          <sl-badge variant="warning" pill>Warning</sl-badge>
        </div>
        <div class="settings-info-row">
          <span class="settings-info-label">2nd+ failure</span>
          <sl-badge variant="danger" pill>Blocked</sl-badge>
        </div>
        <div class="settings-info-row">
          <span class="settings-info-label">On success</span>
          <sl-badge variant="success" pill>Resets</sl-badge>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="settings-section-title">Agent Dispatch Rules</h3>
      <p class="settings-section-desc">Which agents can spawn sub-agents.</p>
      <div class="settings-cards settings-cards-compact">
        ${AGENT_ORDER.map(name => html`
          <div class="settings-card settings-card-compact">
            <div class="settings-card-header">
              <div class="settings-card-icon">${unsafeHTML(iconSvg(Users, 16))}</div>
              <span class="settings-card-title">${name}</span>
            </div>
            <div class="settings-card-body">
              ${DISPATCH_RULES[name].length > 0
                ? DISPATCH_RULES[name].map(sub => html`<sl-badge variant="primary" pill>${sub}</sl-badge>`)
                : html`<span class="text-muted">No dispatch allowed</span>`}
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

function preferencesTabView(onThemeChange) {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

  return html`
    <div class="settings-section">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switch-row">
        <sl-switch
          ?checked=${currentTheme === 'dark'}
          @sl-change=${(e) => {
            onThemeChange(e.target.checked ? 'dark' : 'light');
          }}
        >Dark mode</sl-switch>
      </div>
    </div>
  `;
}

function saveButtonView(onSave) {
  return html`
    <div class="settings-save-area">
      <sl-button
        variant="primary"
        size="medium"
        ?loading=${saveStatus === 'saving'}
        @click=${() => onSave()}
      >
        ${saveStatus === 'success'
          ? html`${unsafeHTML(iconSvg(Check, 16))} Saved`
          : html`${unsafeHTML(iconSvg(Save, 16))} Save Changes`}
      </sl-button>
      ${saveStatus === 'error' ? html`
        <sl-alert variant="danger" open>
          <strong>Error:</strong> ${saveError}
        </sl-alert>
      ` : ''}
      ${saveStatus === 'success' ? html`
        <sl-alert variant="success" open>
          Settings saved successfully.
        </sl-alert>
      ` : ''}
    </div>
  `;
}

export function settingsView({ onSaveSuccess, onThemeChange } = {}) {
  // Fetch on first render
  if (settingsData === null && loading) {
    fetchSettings().then(() => { if (onSaveSuccess) onSaveSuccess(); });
    return html`<div class="settings-loading">Loading settings\u2026</div>`;
  }

  if (loading) {
    return html`<div class="settings-loading">Loading settings\u2026</div>`;
  }

  const handleSave = (partial) => saveSettings(partial, onSaveSuccess);

  return html`
    <div class="settings-page">
      <sl-tab-group @sl-tab-show=${(e) => { activeTab = e.detail.name; }}>
        <sl-tab slot="nav" panel="agents" ?active=${activeTab === 'agents'}>
          ${unsafeHTML(iconSvg(Cpu, 14))} Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline" ?active=${activeTab === 'pipeline'}>
          ${unsafeHTML(iconSvg(Workflow, 14))} Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance" ?active=${activeTab === 'governance'}>
          ${unsafeHTML(iconSvg(Shield, 14))} Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences" ?active=${activeTab === 'preferences'}>
          ${unsafeHTML(iconSvg(Sliders, 14))} Preferences
        </sl-tab>

        <sl-tab-panel name="agents">
          ${agentTabView(settingsData.agents, handleSave)}
        </sl-tab-panel>
        <sl-tab-panel name="pipeline">
          ${pipelineTabView(settingsData, handleSave)}
        </sl-tab-panel>
        <sl-tab-panel name="governance">
          ${governanceTabView()}
        </sl-tab-panel>
        <sl-tab-panel name="preferences">
          ${preferencesTabView(onThemeChange)}
        </sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}
```

**Step 2: Commit**

```bash
git add .claude/worca-ui/app/views/settings.js
git commit -m "feat(settings): create settings view with all 4 tabs"
```

---

### Task 5: Add Settings CSS Styles

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

**Step 1: Add section 27 after section 26 (Utility)**

Append to the end of `styles.css`:

```css
/* --- 27. Settings Page --- */
.settings-page {
  padding: 0;
  max-width: 900px;
}

.settings-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--muted);
  font-size: 14px;
}

/* Tab styling */
.settings-page sl-tab-group {
  --indicator-color: var(--accent);
}

.settings-page sl-tab::part(base) {
  font-size: 13px;
  font-weight: 500;
  gap: 6px;
  padding: 10px 16px;
  color: var(--muted);
}

.settings-page sl-tab[active]::part(base) {
  color: var(--accent);
}

.settings-page sl-tab svg {
  vertical-align: -2px;
}

.settings-page sl-tab-panel::part(base) {
  padding: 24px 4px;
}

/* Section headers */
.settings-section {
  margin-bottom: 28px;
}

.settings-section-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--fg);
}

.settings-section-desc {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 14px;
}

/* Card grid */
.settings-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.settings-cards-compact {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}

.settings-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 18px;
  background: var(--bg-secondary);
  transition: box-shadow var(--transition-fast);
}

.settings-card:hover {
  box-shadow: var(--shadow-sm);
}

.settings-card-compact {
  padding: 14px;
}

.settings-card-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 14px;
}

.settings-card-compact .settings-card-header {
  align-items: center;
  margin-bottom: 8px;
}

.settings-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  flex-shrink: 0;
}

.settings-card-compact .settings-card-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.settings-card-title {
  font-size: 14px;
  font-weight: 600;
  text-transform: capitalize;
  color: var(--fg);
}

.settings-card-desc {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
  line-height: 1.4;
}

.settings-card-body {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.settings-card-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Form fields */
.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

/* Switch rows */
.settings-switches {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-switch-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-switch-desc {
  font-size: 12px;
  color: var(--muted);
  margin-left: 44px;
}

/* Stage flow visualization */
.stage-flow {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 16px 0;
  overflow-x: auto;
}

.stage-flow-item {
  display: flex;
  align-items: center;
  gap: 0;
}

.stage-flow-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  min-width: 90px;
  text-align: center;
}

.stage-flow-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  text-transform: capitalize;
}

.stage-flow-agent {
  font-size: 11px;
  color: var(--muted);
}

.stage-flow-arrow {
  color: var(--muted);
  padding: 0 4px;
  flex-shrink: 0;
}

/* Info card (test gate) */
.settings-info-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 14px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--fg);
}

.settings-info-label {
  font-weight: 500;
}

/* Save area */
.settings-save-area {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid var(--border-subtle);
  margin-top: 20px;
}

.settings-save-area sl-button svg {
  vertical-align: -2px;
  margin-right: 4px;
}

.settings-save-area sl-alert {
  flex: 1;
  font-size: 13px;
}

.settings-save-area sl-alert::part(base) {
  padding: 8px 12px;
  border-radius: var(--radius);
}

/* Text helpers */
.text-muted {
  color: var(--muted);
  font-size: 12px;
  font-style: italic;
}

/* Sidebar footer buttons container */
.sidebar-footer-buttons {
  display: flex;
  gap: 4px;
}

.theme-toggle-btn.active {
  color: var(--accent);
}
```

**Step 2: Commit**

```bash
git add .claude/worca-ui/app/styles.css
git commit -m "feat(settings): add CSS styles for settings page"
```

---

### Task 6: Wire Up Theme Toggle in Settings

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**Step 1: Pass onThemeChange to settingsView**

In `mainContentView()`, update the settings case to pass the theme handler:

```javascript
  if (route.section === 'settings') {
    return settingsView({
      onSaveSuccess: () => rerender(),
      onThemeChange: (theme) => {
        ws.send('set-preferences', { theme }).catch(() => {});
        store.setState({ preferences: { theme } });
        applyTheme(theme);
      }
    });
  }
```

**Step 2: Commit**

```bash
git add .claude/worca-ui/app/main.js
git commit -m "feat(settings): wire theme toggle in preferences tab"
```

---

### Task 7: Build Bundle and Manual Test

**Step 1: Run the esbuild bundler**

```bash
cd .claude/worca-ui && npx esbuild app/main.js --bundle --outfile=app/main.bundle.js --sourcemap --format=esm --platform=browser
```

Expected: Build succeeds with no errors.

**Step 2: Start the dev server and test manually**

```bash
cd .claude/worca-ui && node server/index.js --port 3400
```

Then visit http://localhost:3400/#/settings and verify:
- Gear icon appears in sidebar footer
- Clicking it navigates to settings page
- All 4 tabs render
- Agent cards show correct values from settings.json
- Pipeline tab shows stage flow + loop limits + milestone switches
- Governance tab shows guard rules + dispatch rules
- Preferences tab has theme toggle
- Save button works (changes persist in settings.json)

**Step 3: Fix any issues found during testing**

**Step 4: Commit final bundle**

```bash
git add .claude/worca-ui/app/main.bundle.js .claude/worca-ui/app/main.bundle.js.map
git commit -m "build: rebuild bundle with settings page"
```

---

### Task 8: Final Integration Commit

**Step 1: Verify all files are committed**

```bash
git status
```

**Step 2: Squash or final commit if needed**

All changes should already be committed. Run a final check that the app loads and settings page works correctly.
