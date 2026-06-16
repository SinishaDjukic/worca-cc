"""Spawn a worca pipeline run in a prepared tree (W-075 §2 step 4).

Two launch modes share one code path:
  * **real**  — uses the host ``claude`` CLI (costs money). Secrets flow via env.
  * **mock**  — points ``WORCA_CLAUDE_BIN`` at the worca-cc repo's
    ``tests/mock_claude/mock_claude.py`` and ``MOCK_CLAUDE_SCENARIO`` at a scripted
    scenario. This is free + deterministic — it powers the e2e tests and the
    user-facing ``--mock`` dry-run.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import MockConfig, Profile
from .worca_install import LEAKY_ENV, collect_secret_env
from .venvs import WorcaEnv

# A minimal all-succeed scenario that drives planner→coordinator→implementer→tester
# →reviewer→guardian to completion AND produces a real (non-empty) diff via the
# implementer's run_command. Mirrors the shape worca's integration suite uses.
DEFAULT_MOCK_SCENARIO: dict[str, Any] = {
    "agents": {
        "planner": {
            "action": "succeed", "delay_s": 0.02, "result_text": "Plan ready",
            "structured_output": {"summary": "mock plan", "files": ["WORCA_BENCH_MOCK.txt"]},
        },
        "coordinator": {
            "action": "succeed", "delay_s": 0.02, "result_text": "Beads assigned",
            "structured_output": {"beads": [{"id": "bead-1", "title": "mock fix", "effort": "low"}]},
        },
        "implementer": {
            "action": "succeed", "delay_s": 0.02,
            "run_command": "printf 'worca-bench mock change\\n' >> WORCA_BENCH_MOCK.txt",
            "result_text": "Applied change",
            "structured_output": {"changes": "added WORCA_BENCH_MOCK.txt"},
        },
        "tester": {
            "action": "succeed", "delay_s": 0.02, "result_text": "Tests pass",
            "structured_output": {"passed": True, "test_summary": "mock tests passed"},
        },
        "reviewer": {
            "action": "succeed", "delay_s": 0.02, "result_text": "Approved",
            "structured_output": {"outcome": "approve", "feedback": "lgtm"},
        },
        "guardian": {
            "action": "succeed", "delay_s": 0.02, "result_text": "Ready",
            "structured_output": {"pr_number": 1, "pr_url": "https://example.invalid/pr/1"},
        },
    },
    "default": {"action": "succeed", "delay_s": 0.02, "result_text": "ok"},
}


@dataclass
class RunOutcome:
    run_id: str
    returncode: int
    run_dir: Path | None
    status: dict[str, Any] | None
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and self.status is not None


def _mock_bin_path(mock: MockConfig, wenv: WorcaEnv) -> Path:
    if mock.mock_bin:
        return Path(mock.mock_bin)
    if wenv.repo is None:
        raise FileNotFoundError(
            "mock mode needs the worca-cc repo to locate mock_claude.py; "
            "set mock.mock_bin or WORCA_BENCH_WORCA_REPO"
        )
    return wenv.repo / "tests" / "mock_claude" / "mock_claude.py"


def build_launch_env(
    profile: Profile,
    wenv: WorcaEnv,
    *,
    run_scratch: Path,
) -> dict[str, str]:
    """Assemble the subprocess environment for ``run_pipeline``."""
    env = wenv.base_env()
    for k in LEAKY_ENV:
        env.pop(k, None)
    env["WORCA_SKIP_BEADS"] = "1"

    # Defer PR creation via the ENV signal, not just the settings.json seed.
    # worca.stages is a *template-driven* key: when a template is in play (always,
    # in worca-bench) the project's stages.pr.defer seed is stripped and the
    # template's own stages win — so a template with the PR stage enabled (feature,
    # bugfix, ...) would create a PR despite the seed. WORCA_DEFER_PR=1 is read
    # directly by the guardian (compute_defer_pr) and composes monotonically, so it
    # holds regardless of what the template sets. See docs: PR defer is monotonic.
    if profile.pr_defer:
        env["WORCA_DEFER_PR"] = "1"

    if profile.mock is not None:
        mock = profile.mock
        scenario: dict[str, Any]
        if mock.scenario:
            scenario = json.loads(Path(mock.scenario).read_text(encoding="utf-8"))
        else:
            scenario = DEFAULT_MOCK_SCENARIO
        scenario_path = run_scratch / "mock_scenario.json"
        scenario_path.write_text(json.dumps(scenario), encoding="utf-8")
        mock_bin = _mock_bin_path(mock, wenv)
        env["WORCA_CLAUDE_BIN"] = f"{wenv.python} {mock_bin}"
        env["MOCK_CLAUDE_SCENARIO"] = str(scenario_path)
    else:
        # Real mode: ensure secrets reach the subprocess (also seeded to
        # settings.local.json, but env is the primary path for the claude CLI).
        env.update(collect_secret_env())
    return env


def _as_text(s) -> str:
    """Coerce subprocess output (str | bytes | None) to str."""
    if s is None:
        return ""
    if isinstance(s, bytes):
        return s.decode("utf-8", "replace")
    return s


def launch(
    profile: Profile,
    wenv: WorcaEnv,
    tree: Path,
    *,
    prompt: str,
    template: str,
    run_id: str,
    run_scratch: Path,
    timeout: int = 1800,
) -> RunOutcome:
    """Run the pipeline in ``tree`` and return its outcome + parsed status.json."""
    run_scratch.mkdir(parents=True, exist_ok=True)
    env = build_launch_env(profile, wenv, run_scratch=run_scratch)

    args = [
        wenv.python, "-m", "worca.scripts.run_pipeline",
        "--prompt", prompt,
        "--template", template,
        "--claude-md-mode", profile.claude_md_mode,
        "--run-id", run_id,
    ]
    if profile.skip_preflight:
        args.append("--skip-preflight")

    try:
        proc = subprocess.run(
            args, cwd=str(tree), env=env,
            capture_output=True, text=True, timeout=timeout,
        )
        rc, out, err = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        # On timeout the partial stdout/stderr can come back as bytes even under
        # text=True — decode defensively so the timeout path never crashes.
        out = _as_text(e.stdout)
        err = _as_text(e.stderr) + "\n[worca-bench] run timed out"
        rc = 124

    run_dir = tree / ".worca" / "runs" / run_id
    status_path = run_dir / "status.json"
    status: dict[str, Any] | None = None
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            status = None
    return RunOutcome(run_id=run_id, returncode=rc, run_dir=run_dir, status=status,
                      stdout=out, stderr=err)


def canary(profile: Profile, wenv: WorcaEnv, tree: Path, *, template: str,
           run_scratch: Path, timeout: int = 300) -> tuple[bool, str]:
    """Cheap pre-sweep check that ``(version, template)`` produces a valid status.json.

    Returns ``(ok, reason)``. A canary that never reaches a valid status.json means
    the config is rejected by this worca version — skip/flag the combo (W-075 §5).
    """
    outcome = launch(
        profile, wenv, tree,
        prompt="worca-bench canary: validate config loads",
        template=template, run_id=f"canary-{template.replace(':', '_')}",
        run_scratch=run_scratch, timeout=timeout,
    )
    if outcome.status is None:
        tail = (outcome.stderr or outcome.stdout or "").strip()[-400:]
        return False, f"no valid status.json (rc={outcome.returncode}): {tail}"
    return True, "ok"
