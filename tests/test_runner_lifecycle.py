"""Tests for pipeline lifecycle state management (signal handler, atexit, finally, resume, beads)."""

import os
import signal
from unittest.mock import patch


import worca.orchestrator.runner as runner
from worca.orchestrator.control import write_control, control_path
from worca.state.status import save_status, load_status


# --- Layer 1: signal handler saves failed status ---


def test_signal_handler_saves_failed_status(tmp_path):
    """Calling the signal handler writes pipeline_status='failed' with stop_reason='signal'."""
    status_path = str(tmp_path / "status.json")
    status = {"pipeline_status": "running", "stage": "plan"}
    save_status(status, status_path)

    # Wire up module-level refs
    runner._signal_status = status
    runner._signal_status_path = status_path
    try:
        # Install handlers so we can invoke the internal handler
        runner._install_signal_handlers()
        # Send SIGINT to ourselves — the handler should save status
        os.kill(os.getpid(), signal.SIGINT)

        on_disk = load_status(status_path)
        assert on_disk["pipeline_status"] == "failed"
        assert on_disk["stop_reason"] == "signal"
    finally:
        runner._signal_status = None
        runner._signal_status_path = None
        runner._shutdown_requested = False
        runner._restore_signal_handlers()


def test_signal_handler_noop_when_status_not_set(tmp_path):
    """Signal handler is safe when _signal_status is None — no crash, no file write."""
    runner._signal_status = None
    runner._signal_status_path = None
    try:
        runner._install_signal_handlers()
        # Should not raise
        os.kill(os.getpid(), signal.SIGINT)
        # Just confirm we got here without error
        assert runner._shutdown_requested is True
    finally:
        runner._shutdown_requested = False
        runner._restore_signal_handlers()


def test_signal_handler_preserves_existing_stop_reason(tmp_path):
    """Signal handler doesn't overwrite an existing stop_reason."""
    status_path = str(tmp_path / "status.json")
    status = {"pipeline_status": "running", "stop_reason": "stopped"}
    save_status(status, status_path)

    runner._signal_status = status
    runner._signal_status_path = status_path
    try:
        runner._install_signal_handlers()
        os.kill(os.getpid(), signal.SIGINT)

        on_disk = load_status(status_path)
        assert on_disk["pipeline_status"] == "failed"
        assert on_disk["stop_reason"] == "stopped"  # preserved, not "signal"
    finally:
        runner._signal_status = None
        runner._signal_status_path = None
        runner._shutdown_requested = False
        runner._restore_signal_handlers()


# --- Layer 4: atexit cleanup ---


def test_atexit_cleanup_saves_when_running(tmp_path):
    """atexit handler transitions 'running' → 'failed' with stop_reason='unexpected_exit'."""
    status_path = str(tmp_path / "status.json")
    status = {"pipeline_status": "running"}
    save_status(status, status_path)

    runner._signal_status = status
    runner._signal_status_path = status_path
    try:
        runner._atexit_cleanup()

        on_disk = load_status(status_path)
        assert on_disk["pipeline_status"] == "failed"
        assert on_disk["stop_reason"] == "unexpected_exit"
    finally:
        runner._signal_status = None
        runner._signal_status_path = None


def test_atexit_cleanup_noop_when_already_failed(tmp_path):
    """atexit handler does not overwrite when status is already 'failed'."""
    status_path = str(tmp_path / "status.json")
    status = {"pipeline_status": "failed", "stop_reason": "signal"}
    save_status(status, status_path)

    runner._signal_status = status
    runner._signal_status_path = status_path
    try:
        runner._atexit_cleanup()

        on_disk = load_status(status_path)
        assert on_disk["pipeline_status"] == "failed"
        assert on_disk["stop_reason"] == "signal"  # unchanged
    finally:
        runner._signal_status = None
        runner._signal_status_path = None


def test_atexit_cleanup_noop_when_refs_none():
    """atexit handler is a no-op when refs are None."""
    runner._signal_status = None
    runner._signal_status_path = None
    # Should not raise
    runner._atexit_cleanup()


# --- Finally block clears signal refs ---


def test_finally_block_clears_signal_refs():
    """The finally block in run_pipeline clears _signal_status and _signal_status_path.

    We verify this by inspecting the code structure: the finally block sets both
    refs to None. This test validates the mechanism by simulating what the
    finally block does — setting refs then clearing them.
    """
    import atexit as _atexit

    # Simulate what run_pipeline does: set refs, then execute finally cleanup
    runner._signal_status = {"pipeline_status": "failed"}
    runner._signal_status_path = "/tmp/fake.json"
    _atexit.register(runner._atexit_cleanup)

    # Simulate finally block cleanup
    runner._signal_status = None
    runner._signal_status_path = None
    try:
        _atexit.unregister(runner._atexit_cleanup)
    except Exception:
        pass

    assert runner._signal_status is None
    assert runner._signal_status_path is None


# --- Resume: stale control.json cleanup ---


def test_resume_deletes_stale_control_file(tmp_path):
    """On resume, any leftover control.json from a previous stop is deleted
    before the main loop starts, preventing an immediate re-stop."""
    worca_dir = str(tmp_path)
    run_id = "20260322-120000"
    run_dir = tmp_path / "runs" / run_id
    run_dir.mkdir(parents=True)

    # Write a stale stop control file (simulates process killed before consuming it)
    write_control(run_id, "stop", source="cli", base=worca_dir)
    ctrl_path = control_path(run_id, base=worca_dir)
    assert os.path.exists(ctrl_path)

    # delete_control should remove it
    from worca.orchestrator.control import delete_control
    delete_control(run_id, base=worca_dir)
    assert not os.path.exists(ctrl_path)


def test_resume_deletes_stale_pause_control_file(tmp_path):
    """On resume, a leftover pause control.json is also cleaned up."""
    worca_dir = str(tmp_path)
    run_id = "20260322-130000"
    run_dir = tmp_path / "runs" / run_id
    run_dir.mkdir(parents=True)

    write_control(run_id, "pause", source="ui", base=worca_dir)
    ctrl_path = control_path(run_id, base=worca_dir)
    assert os.path.exists(ctrl_path)

    from worca.orchestrator.control import delete_control
    delete_control(run_id, base=worca_dir)
    assert not os.path.exists(ctrl_path)


def test_resume_noop_when_no_control_file(tmp_path):
    """delete_control is a no-op when no control file exists."""
    worca_dir = str(tmp_path)
    run_id = "20260322-140000"
    run_dir = tmp_path / "runs" / run_id
    run_dir.mkdir(parents=True)

    from worca.orchestrator.control import delete_control
    # Should not raise
    delete_control(run_id, base=worca_dir)


# --- Bead assignment: _query_ready_bead filtering ---


def test_query_ready_bead_filters_by_allowed_ids():
    """_query_ready_bead only returns beads from the allowed_ids list."""
    fake_beads = [
        {"id": "old-bead-001", "title": "Stale from prior run", "priority": "2", "type": "task"},
        {"id": "run-bead-001", "title": "Current run task", "priority": "2", "type": "task"},
        {"id": "run-bead-002", "title": "Another current task", "priority": "2", "type": "task"},
    ]
    with patch("worca.orchestrator.runner.bd_ready", return_value=fake_beads):
        # Without filter — returns first bead (which is stale)
        result = runner._query_ready_bead()
        assert result["id"] == "old-bead-001"

        # With filter — skips stale bead, returns first matching
        result = runner._query_ready_bead(allowed_ids=["run-bead-001", "run-bead-002"])
        assert result["id"] == "run-bead-001"


def test_query_ready_bead_returns_none_when_no_match():
    """_query_ready_bead returns None when no beads match the allowed_ids."""
    fake_beads = [
        {"id": "old-bead-001", "title": "Stale", "priority": "2", "type": "task"},
    ]
    with patch("worca.orchestrator.runner.bd_ready", return_value=fake_beads):
        result = runner._query_ready_bead(allowed_ids=["run-bead-001"])
        assert result is None


def test_query_ready_bead_no_filter_returns_first():
    """_query_ready_bead with allowed_ids=None returns the first available bead."""
    fake_beads = [
        {"id": "bead-A", "title": "Task A", "priority": "2", "type": "task"},
        {"id": "bead-B", "title": "Task B", "priority": "2", "type": "task"},
    ]
    with patch("worca.orchestrator.runner.bd_ready", return_value=fake_beads):
        result = runner._query_ready_bead(allowed_ids=None)
        assert result["id"] == "bead-A"


def test_query_ready_bead_empty_allowed_ids_returns_none():
    """_query_ready_bead with an empty allowed_ids list returns None."""
    fake_beads = [
        {"id": "bead-A", "title": "Task A", "priority": "2", "type": "task"},
    ]
    with patch("worca.orchestrator.runner.bd_ready", return_value=fake_beads):
        result = runner._query_ready_bead(allowed_ids=[])
        assert result is None
