/**
 * Browser notification manager for worca-ui pipeline events.
 * Detects state changes from WebSocket run updates and fires
 * Web Notifications API alerts based on user preferences.
 */

import { html, nothing } from 'lit-html';
import { navigate } from './router.js';

// --- Event definitions ---

export const NOTIFICATION_EVENTS = [
  'run_completed',
  'run_failed',
  'approval_needed',
  'test_failures',
  'loop_limit_warning'
];

const EVENT_CONFIG = {
  run_completed: {
    severity: 'info',
    title: 'Pipeline Complete',
    requireInteraction: false,
  },
  run_failed: {
    severity: 'critical',
    title: 'Pipeline Failed',
    requireInteraction: false,
  },
  approval_needed: {
    severity: 'critical',
    title: 'Approval Required',
    requireInteraction: true,
  },
  test_failures: {
    severity: 'warning',
    title: 'Tests Failed',
    requireInteraction: false,
  },
  loop_limit_warning: {
    severity: 'warning',
    title: 'Loop Limit Warning',
    requireInteraction: false,
  },
};

// --- Detector functions (exported for testing) ---

export function detectRunCompleted(runId, newRun, prevRun) {
  if (!prevRun || !newRun) return null;
  const wasActive = prevRun.active === true;
  const nowInactive = newRun.active === false;
  if (!wasActive || !nowInactive) return null;

  const stages = newRun.stages || {};
  const hasError = Object.values(stages).some(s => s.status === 'error');
  if (hasError) return null;

  const runTitle = getRunTitle(newRun);
  return {
    event: 'run_completed',
    title: EVENT_CONFIG.run_completed.title,
    body: `"${runTitle}" finished successfully`,
    tag: `worca-complete-${runId}`,
    requireInteraction: false,
    runId,
  };
}

export function detectRunFailed(runId, newRun, prevRun) {
  if (!prevRun || !newRun) return null;
  const wasActive = prevRun.active === true;
  const nowInactive = newRun.active === false;
  if (!wasActive || !nowInactive) return null;

  const stages = newRun.stages || {};
  const failedStage = Object.entries(stages).find(([, s]) => s.status === 'error');
  if (!failedStage) return null;

  const runTitle = getRunTitle(newRun);
  return {
    event: 'run_failed',
    title: EVENT_CONFIG.run_failed.title,
    body: `"${runTitle}" failed at ${failedStage[0]} stage`,
    tag: `worca-failed-${runId}`,
    requireInteraction: false,
    runId,
  };
}

export function detectApprovalNeeded(runId, newRun, prevRun) {
  if (!newRun) return null;
  const newStages = newRun.stages || {};
  const prevStages = (prevRun && prevRun.stages) || {};

  for (const [key, stage] of Object.entries(newStages)) {
    if (stage.status === 'waiting_approval') {
      const prevStatus = prevStages[key]?.status;
      if (prevStatus !== 'waiting_approval') {
        const runTitle = getRunTitle(newRun);
        const label = key === 'pr' ? 'PR' : key;
        return {
          event: 'approval_needed',
          title: EVENT_CONFIG.approval_needed.title,
          body: `"${runTitle}" is waiting for ${label} approval`,
          tag: `worca-approval-${runId}-${key}`,
          requireInteraction: true,
          runId,
        };
      }
    }
  }
  return null;
}

export function detectTestFailures(runId, newRun, prevRun) {
  if (!newRun) return null;
  const testStage = newRun.stages?.test;
  if (!testStage) return null;

  const newIters = testStage.iterations || [];
  const prevIters = (prevRun?.stages?.test?.iterations) || [];

  if (newIters.length > prevIters.length) {
    const latest = newIters[newIters.length - 1];
    if (latest && latest.result === 'failed') {
      const runTitle = getRunTitle(newRun);
      return {
        event: 'test_failures',
        title: EVENT_CONFIG.test_failures.title,
        body: `"${runTitle}" test iteration ${newIters.length} failed`,
        tag: `worca-test-${runId}-iter${newIters.length}`,
        requireInteraction: false,
        runId,
      };
    }
  }
  return null;
}

export function detectLoopLimitWarning(runId, newRun, prevRun, settings, warnedLoops) {
  if (!newRun || !settings) return null;
  const loops = settings?.worca?.loops;
  if (!loops) return null;

  const stages = newRun.stages || {};

  // Map loop config keys to stage names
  const loopStageMap = {
    implement_test: ['implement', 'test'],
    code_review: ['review'],
    pr_changes: ['pr'],
    restart_planning: ['plan'],
  };

  for (const [loopKey, limit] of Object.entries(loops)) {
    if (!limit || limit < 2) continue;
    const stageNames = loopStageMap[loopKey];
    if (!stageNames) continue;

    for (const stageName of stageNames) {
      const stage = stages[stageName];
      if (!stage) continue;
      const iterCount = (stage.iterations || []).length;
      if (iterCount === limit - 1) {
        const warnKey = `${runId}-${stageName}`;
        if (warnedLoops.has(warnKey)) continue;
        warnedLoops.add(warnKey);
        const runTitle = getRunTitle(newRun);
        return {
          event: 'loop_limit_warning',
          title: EVENT_CONFIG.loop_limit_warning.title,
          body: `"${runTitle}" ${stageName} stage approaching loop limit (${iterCount}/${limit})`,
          tag: `worca-loop-${runId}-${stageName}`,
          requireInteraction: false,
          runId,
        };
      }
    }
  }
  return null;
}

function getRunTitle(run) {
  const raw = run?.work_request?.title || run?.id || 'Pipeline';
  const firstLine = raw.split('\n')[0];
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '\u2026' : firstLine;
}

// --- Sound ---

let audioCtx = null;

function playSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch {
    // AudioContext blocked or unavailable
  }
}

// --- Notification Manager Factory ---

const DEFAULT_NOTIFICATION_PREFS = {
  enabled: true,
  sound: false,
  events: {
    run_completed: true,
    run_failed: true,
    approval_needed: true,
    test_failures: true,
    loop_limit_warning: true,
  },
};

export function createNotificationManager({ store, ws, getSettings }) {
  let permissionState = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  const warnedLoops = new Set();
  let bannerDismissed = false;
  let rerender = null;

  function setRerender(fn) {
    rerender = fn;
  }

  function checkPermission() {
    if (typeof Notification !== 'undefined') {
      permissionState = Notification.permission;
    }
    return permissionState;
  }

  async function requestPermission() {
    if (typeof Notification === 'undefined') return 'denied';
    const result = await Notification.requestPermission();
    permissionState = result;
    if (rerender) rerender();
    return result;
  }

  function getPreferences() {
    const prefs = store.getState().preferences.notifications;
    if (!prefs) return { ...DEFAULT_NOTIFICATION_PREFS };
    return {
      enabled: prefs.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled,
      sound: prefs.sound ?? DEFAULT_NOTIFICATION_PREFS.sound,
      events: { ...DEFAULT_NOTIFICATION_PREFS.events, ...(prefs.events || {}) },
    };
  }

  function fireNotification({ event, title, body, tag, requireInteraction, runId }) {
    if (typeof Notification === 'undefined') return;
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      tag,
      requireInteraction,
    });
    n.onclick = () => {
      window.focus();
      navigate('active', runId);
      n.close();
    };

    const prefs = getPreferences();
    const config = EVENT_CONFIG[event];
    if (prefs.sound && config && config.severity === 'critical') {
      playSound();
    }
  }

  function handleRunUpdate(runId, newRun, prevRun) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;

    const prefs = getPreferences();
    if (!prefs.enabled) return;

    const settings = getSettings();

    const detectors = [
      detectRunCompleted,
      detectRunFailed,
      detectApprovalNeeded,
      detectTestFailures,
    ];

    for (const detect of detectors) {
      const descriptor = detect(runId, newRun, prevRun);
      if (descriptor && prefs.events[descriptor.event]) {
        fireNotification(descriptor);
      }
    }

    // Loop limit warning needs settings and warnedLoops set
    const loopDescriptor = detectLoopLimitWarning(runId, newRun, prevRun, settings, warnedLoops);
    if (loopDescriptor && prefs.events[loopDescriptor.event]) {
      fireNotification(loopDescriptor);
    }
  }

  function renderBanner() {
    if (typeof Notification === 'undefined') {
      return nothing;
    }

    checkPermission();

    if (permissionState === 'default') {
      return html`
        <div class="notification-banner notification-banner--info">
          <span class="notification-banner-text">
            Enable browser notifications to stay informed about pipeline events
          </span>
          <sl-button size="small" variant="primary" @click=${() => requestPermission()}>
            Enable Notifications
          </sl-button>
        </div>
      `;
    }

    if (permissionState === 'denied' && !bannerDismissed) {
      return html`
        <div class="notification-banner notification-banner--warning">
          <span class="notification-banner-text">
            Notifications blocked. Enable in browser settings.
          </span>
          <button class="notification-banner-dismiss" @click=${() => {
            bannerDismissed = true;
            if (rerender) rerender();
          }}>&times;</button>
        </div>
      `;
    }

    return nothing;
  }

  function dispose() {
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  return {
    checkPermission,
    requestPermission,
    handleRunUpdate,
    renderBanner,
    getPreferences,
    setRerender,
    dispose,
  };
}
