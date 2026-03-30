"""Tests for worca.orchestrator.registry — pipeline instance registry."""

import json
import os
from datetime import datetime
from unittest.mock import patch

import pytest

from worca.orchestrator.registry import (
    _registry_dir,
    register_pipeline,
    update_pipeline,
    deregister_pipeline,
    list_pipelines,
    get_pipeline,
    reconcile_stale,
)


# --- _registry_dir ---


def test_registry_dir_creates_directory(tmp_path):
    base = str(tmp_path / ".worca")
    d = _registry_dir(base)
    assert os.path.isdir(d)
    assert d == os.path.join(base, "multi", "pipelines.d")


def test_registry_dir_idempotent(tmp_path):
    base = str(tmp_path / ".worca")
    d1 = _registry_dir(base)
    d2 = _registry_dir(base)
    assert d1 == d2
    assert os.path.isdir(d1)


# --- register_pipeline ---


def test_register_creates_file(tmp_path):
    base = str(tmp_path / ".worca")
    path = register_pipeline("run-1", "/tmp/wt", "My Task", 12345, base=base)
    assert os.path.exists(path)
    assert path.endswith("run-1.json")


def test_register_correct_fields(tmp_path):
    base = str(tmp_path / ".worca")
    path = register_pipeline("run-abc", "/tmp/wt", "Test Title", 9999, base=base)
    with open(path) as f:
        data = json.load(f)
    assert data["run_id"] == "run-abc"
    assert data["worktree_path"] == "/tmp/wt"
    assert data["title"] == "Test Title"
    assert data["pid"] == 9999
    assert data["status"] == "running"
    assert "started_at" in data
    assert "updated_at" in data
    # Timestamps should be valid ISO format
    datetime.fromisoformat(data["started_at"])
    datetime.fromisoformat(data["updated_at"])


def test_register_atomic_write(tmp_path):
    """Verify register uses temp file + os.replace for atomicity."""
    base = str(tmp_path / ".worca")
    with patch("worca.orchestrator.registry.os.replace", wraps=os.replace) as mock_replace:
        register_pipeline("run-atomic", "/tmp/wt", "Atomic Test", 100, base=base)
        assert mock_replace.call_count == 1
        args = mock_replace.call_args[0]
        # Source should be a temp file
        assert ".tmp_" in args[0]
        # Destination should be the final json
        assert args[1].endswith("run-atomic.json")


def test_register_no_partial_files_on_disk(tmp_path):
    """After registration, only the final .json file exists — no leftover temps."""
    base = str(tmp_path / ".worca")
    register_pipeline("run-clean", "/tmp/wt", "Clean", 1, base=base)
    d = os.path.join(base, "multi", "pipelines.d")
    files = os.listdir(d)
    assert files == ["run-clean.json"]


# --- update_pipeline ---


def test_update_pipeline_modifies_status(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-u1", "/tmp/wt", "Update Test", 1, base=base)
    result = update_pipeline("run-u1", status="completed", base=base)
    assert result is True
    data = get_pipeline("run-u1", base=base)
    assert data["status"] == "completed"


def test_update_pipeline_modifies_stage(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-u2", "/tmp/wt", "Stage Test", 1, base=base)
    result = update_pipeline("run-u2", stage="implement", base=base)
    assert result is True
    data = get_pipeline("run-u2", base=base)
    assert data["stage"] == "implement"


def test_update_pipeline_modifies_both(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-u3", "/tmp/wt", "Both Test", 1, base=base)
    update_pipeline("run-u3", status="paused", stage="test", base=base)
    data = get_pipeline("run-u3", base=base)
    assert data["status"] == "paused"
    assert data["stage"] == "test"


def test_update_pipeline_updates_timestamp(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-u4", "/tmp/wt", "Timestamp Test", 1, base=base)
    original = get_pipeline("run-u4", base=base)
    original_ts = original["updated_at"]
    update_pipeline("run-u4", status="completed", base=base)
    updated = get_pipeline("run-u4", base=base)
    # updated_at should be at least as recent (may be equal if very fast)
    assert updated["updated_at"] >= original_ts


def test_update_pipeline_returns_false_for_nonexistent(tmp_path):
    base = str(tmp_path / ".worca")
    _registry_dir(base)  # ensure directory exists
    result = update_pipeline("no-such-run", status="done", base=base)
    assert result is False


def test_update_preserves_existing_fields(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-u5", "/tmp/wt", "Preserve Test", 42, base=base)
    update_pipeline("run-u5", status="completed", base=base)
    data = get_pipeline("run-u5", base=base)
    assert data["run_id"] == "run-u5"
    assert data["worktree_path"] == "/tmp/wt"
    assert data["title"] == "Preserve Test"
    assert data["pid"] == 42


# --- deregister_pipeline ---


def test_deregister_removes_file(tmp_path):
    base = str(tmp_path / ".worca")
    path = register_pipeline("run-d1", "/tmp/wt", "Deregister", 1, base=base)
    assert os.path.exists(path)
    result = deregister_pipeline("run-d1", base=base)
    assert result is True
    assert not os.path.exists(path)


def test_deregister_returns_false_for_nonexistent(tmp_path):
    base = str(tmp_path / ".worca")
    _registry_dir(base)  # ensure directory exists
    result = deregister_pipeline("no-such-run", base=base)
    assert result is False


def test_deregister_then_get_returns_none(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-d2", "/tmp/wt", "Gone", 1, base=base)
    deregister_pipeline("run-d2", base=base)
    assert get_pipeline("run-d2", base=base) is None


# --- list_pipelines ---


def test_list_pipelines_returns_all_entries(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-a", "/tmp/a", "A", 1, base=base)
    register_pipeline("run-b", "/tmp/b", "B", 2, base=base)
    register_pipeline("run-c", "/tmp/c", "C", 3, base=base)
    results = list_pipelines(base=base)
    assert len(results) == 3
    ids = {r["run_id"] for r in results}
    assert ids == {"run-a", "run-b", "run-c"}


def test_list_pipelines_empty_directory(tmp_path):
    base = str(tmp_path / ".worca")
    _registry_dir(base)  # create empty directory
    results = list_pipelines(base=base)
    assert results == []


def test_list_pipelines_ignores_malformed_json(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-good", "/tmp/g", "Good", 1, base=base)

    # Write a malformed JSON file
    bad_path = os.path.join(base, "multi", "pipelines.d", "run-bad.json")
    with open(bad_path, "w") as f:
        f.write("{broken json!!!")

    results = list_pipelines(base=base)
    assert len(results) == 1
    assert results[0]["run_id"] == "run-good"


def test_list_pipelines_ignores_non_json_files(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-ok", "/tmp/ok", "OK", 1, base=base)

    # Write a non-json file
    other = os.path.join(base, "multi", "pipelines.d", "readme.txt")
    with open(other, "w") as f:
        f.write("not a pipeline")

    results = list_pipelines(base=base)
    assert len(results) == 1
    assert results[0]["run_id"] == "run-ok"


def test_list_pipelines_sorted_by_filename(tmp_path):
    """Entries are returned sorted by filename (alphabetical by run_id)."""
    base = str(tmp_path / ".worca")
    register_pipeline("run-c", "/tmp/c", "C", 3, base=base)
    register_pipeline("run-a", "/tmp/a", "A", 1, base=base)
    register_pipeline("run-b", "/tmp/b", "B", 2, base=base)
    results = list_pipelines(base=base)
    ids = [r["run_id"] for r in results]
    assert ids == ["run-a", "run-b", "run-c"]


# --- get_pipeline ---


def test_get_pipeline_returns_correct_entry(tmp_path):
    base = str(tmp_path / ".worca")
    register_pipeline("run-g1", "/tmp/wt", "Get Test", 555, base=base)
    data = get_pipeline("run-g1", base=base)
    assert data is not None
    assert data["run_id"] == "run-g1"
    assert data["pid"] == 555
    assert data["title"] == "Get Test"


def test_get_pipeline_returns_none_for_nonexistent(tmp_path):
    base = str(tmp_path / ".worca")
    _registry_dir(base)
    result = get_pipeline("no-such-run", base=base)
    assert result is None


def test_get_pipeline_returns_none_for_malformed(tmp_path):
    base = str(tmp_path / ".worca")
    _registry_dir(base)
    bad_path = os.path.join(base, "multi", "pipelines.d", "run-bad.json")
    with open(bad_path, "w") as f:
        f.write("NOT JSON")
    result = get_pipeline("run-bad", base=base)
    assert result is None


# --- concurrent registration ---


def test_concurrent_register_multiple_pipelines(tmp_path):
    """Multiple pipelines can be registered independently without interference."""
    base = str(tmp_path / ".worca")
    paths = []
    for i in range(5):
        p = register_pipeline(f"run-{i}", f"/tmp/wt-{i}", f"Task {i}", 1000 + i, base=base)
        paths.append(p)

    # All files exist
    for p in paths:
        assert os.path.exists(p)

    # All can be individually retrieved
    for i in range(5):
        data = get_pipeline(f"run-{i}", base=base)
        assert data["run_id"] == f"run-{i}"
        assert data["pid"] == 1000 + i

    # list returns all
    results = list_pipelines(base=base)
    assert len(results) == 5


def test_register_overwrite_existing(tmp_path):
    """Registering the same run_id again overwrites the previous entry."""
    base = str(tmp_path / ".worca")
    register_pipeline("run-dup", "/tmp/wt1", "First", 100, base=base)
    register_pipeline("run-dup", "/tmp/wt2", "Second", 200, base=base)
    data = get_pipeline("run-dup", base=base)
    assert data["title"] == "Second"
    assert data["pid"] == 200
    assert data["worktree_path"] == "/tmp/wt2"


# --- reconcile_stale ---


def test_reconcile_stale_marks_dead_pids_as_failed(tmp_path):
    """Dead PIDs should be marked as failed with a stale note."""
    base = str(tmp_path / ".worca")
    # Use a PID that almost certainly doesn't exist
    register_pipeline("run-dead", "/tmp/wt", "Dead Process", 999999999, base=base)

    stale = reconcile_stale(base=base)

    assert "run-dead" in stale
    data = get_pipeline("run-dead", base=base)
    assert data["status"] == "failed"
    assert data["note"] == "stale - process not running"


def test_reconcile_stale_skips_alive_pids(tmp_path):
    """Alive PIDs should not be marked as stale."""
    base = str(tmp_path / ".worca")
    alive_pid = os.getpid()  # current process is definitely alive
    register_pipeline("run-alive", "/tmp/wt", "Alive Process", alive_pid, base=base)

    # Mock os.kill to avoid any permission issues — simulate alive process
    with patch("worca.orchestrator.registry.os.kill") as mock_kill:
        mock_kill.return_value = None  # no exception = process is alive
        stale = reconcile_stale(base=base)

    assert stale == []
    data = get_pipeline("run-alive", base=base)
    assert data["status"] == "running"
    assert "note" not in data


def test_reconcile_stale_skips_non_running_pipelines(tmp_path):
    """Pipelines that aren't 'running' should be left alone."""
    base = str(tmp_path / ".worca")
    register_pipeline("run-done", "/tmp/wt", "Completed", 999999999, base=base)
    update_pipeline("run-done", status="completed", base=base)
    register_pipeline("run-fail", "/tmp/wt", "Already Failed", 999999999, base=base)
    update_pipeline("run-fail", status="failed", base=base)

    stale = reconcile_stale(base=base)

    assert stale == []
    # Statuses should be unchanged
    assert get_pipeline("run-done", base=base)["status"] == "completed"
    assert get_pipeline("run-fail", base=base)["status"] == "failed"


def test_reconcile_stale_returns_correct_stale_run_ids(tmp_path):
    """reconcile_stale returns exactly the run_ids that were marked stale."""
    base = str(tmp_path / ".worca")
    # Two dead PIDs
    register_pipeline("run-dead1", "/tmp/wt", "Dead 1", 999999998, base=base)
    register_pipeline("run-dead2", "/tmp/wt", "Dead 2", 999999997, base=base)
    # One alive PID (mocked)
    register_pipeline("run-alive", "/tmp/wt", "Alive", 12345, base=base)
    # One completed (should be skipped regardless)
    register_pipeline("run-done", "/tmp/wt", "Done", 999999996, base=base)
    update_pipeline("run-done", status="completed", base=base)

    def fake_kill(pid, sig):
        if pid == 12345:
            return None  # alive
        raise ProcessLookupError(f"No such process: {pid}")

    with patch("worca.orchestrator.registry.os.kill", side_effect=fake_kill):
        stale = reconcile_stale(base=base)

    assert sorted(stale) == ["run-dead1", "run-dead2"]


def test_reconcile_stale_empty_registry(tmp_path):
    """Empty registry should return an empty list."""
    base = str(tmp_path / ".worca")
    _registry_dir(base)  # ensure directory exists but is empty

    stale = reconcile_stale(base=base)

    assert stale == []


def test_reconcile_stale_skips_entries_without_pid(tmp_path):
    """Entries missing the pid field should be silently skipped."""
    base = str(tmp_path / ".worca")
    register_pipeline("run-nopid", "/tmp/wt", "No PID", 12345, base=base)

    # Manually remove the pid field from the registry file
    path = os.path.join(base, "multi", "pipelines.d", "run-nopid.json")
    with open(path) as f:
        data = json.load(f)
    del data["pid"]
    with open(path, "w") as f:
        json.dump(data, f)

    stale = reconcile_stale(base=base)

    assert stale == []
    # Status should remain unchanged
    updated = get_pipeline("run-nopid", base=base)
    assert updated["status"] == "running"


def test_reconcile_stale_skips_eperm(tmp_path):
    """Processes owned by another user (EPERM) should NOT be marked stale."""
    import errno

    base = str(tmp_path / ".worca")
    register_pipeline("run-eperm", "/tmp/wt", "Other User", 12345, base=base)

    def fake_kill(pid, sig):
        raise OSError(errno.EPERM, "Operation not permitted")

    with patch("worca.orchestrator.registry.os.kill", side_effect=fake_kill):
        stale = reconcile_stale(base=base)

    assert stale == []
    data = get_pipeline("run-eperm", base=base)
    assert data["status"] == "running"
    assert "note" not in data
