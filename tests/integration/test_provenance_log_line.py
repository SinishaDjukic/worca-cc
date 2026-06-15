"""Integration test: orchestrator.log contains a Runtime: worca ... line."""
import pytest

from tests.integration.helpers import read_run_dir

pytestmark = pytest.mark.timeout(90)


def test_orchestrator_log_contains_runtime_line(pipeline_env):
    """orchestrator.log must emit a source-qualified 'Runtime: worca' line.

    The pipeline_env fixture runs `worca init`, which writes
    .claude/worca/provenance.json.  After W-074 the runner reads that
    manifest and formats a source-qualified line — either:
      'Runtime: worca X.Y.Z (pip)'
      'Runtime: worca X.Y.Z (src <repo>@<commit> [<branch>])'
    The bare degraded form 'Runtime: worca X.Y.Z' (no parenthesis suffix)
    would mean the manifest was not found — i.e. the reader/writer path
    mismatch is still present.
    """
    result = pipeline_env.run(
        {"default": {"action": "succeed", "delay_s": 0.05}},
        prompt="provenance log test",
        timeout=60,
    )
    assert result.returncode == 0, f"pipeline failed: {result.stderr[-500:]}"
    run_dir = read_run_dir(pipeline_env.worca_dir)
    log_path = run_dir / "logs" / "orchestrator.log"
    assert log_path.exists(), "orchestrator.log not found"
    log_text = log_path.read_text(encoding="utf-8")
    runtime_lines = [ln for ln in log_text.splitlines() if "Runtime: worca " in ln]
    assert runtime_lines, (
        f"No 'Runtime: worca ' line found in orchestrator.log. "
        f"First 500 chars:\n{log_text[:500]}"
    )
    runtime_line = runtime_lines[0]
    assert "(pip)" in runtime_line or "(src " in runtime_line, (
        f"Runtime line is degraded (manifest not loaded from .claude/worca/): "
        f"{runtime_line!r}"
    )
