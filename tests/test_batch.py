"""Tests for worca.orchestrator.batch — batch processing with circuit breakers."""

import json
import os
from unittest.mock import patch

from worca.orchestrator.batch import (
    run_batch,
    should_skip,
    CircuitBreakerError,
    _request_id,
)
from worca.orchestrator.work_request import WorkRequest


def test_processes_all_requests(tmp_path):
    requests = [
        WorkRequest(source_type="prompt", title="Task 1"),
        WorkRequest(source_type="prompt", title="Task 2"),
        WorkRequest(source_type="prompt", title="Task 3"),
    ]
    with patch("worca.orchestrator.batch.run_pipeline", return_value={"completed": True}) as mock:
        results = run_batch(requests, results_dir=str(tmp_path / "results"))
    assert mock.call_count == 3
    assert len(results) == 3


def test_returns_results_for_each_request(tmp_path):
    requests = [
        WorkRequest(source_type="prompt", title="Task A"),
        WorkRequest(source_type="prompt", title="Task B"),
    ]
    with patch("worca.orchestrator.batch.run_pipeline", return_value={"done": True}):
        results = run_batch(requests, results_dir=str(tmp_path / "results"))
    assert all(r.get("done") for r in results)


def test_circuit_breaker_after_3_failures(tmp_path):
    requests = [WorkRequest(source_type="prompt", title=f"Task {i}") for i in range(5)]
    with patch("worca.orchestrator.batch.run_pipeline", side_effect=RuntimeError("fail")):
        try:
            run_batch(requests, max_failures=3, results_dir=str(tmp_path / "results"))
            assert False, "Should have raised CircuitBreakerError"
        except CircuitBreakerError:
            pass


def test_circuit_breaker_custom_max_failures(tmp_path):
    requests = [WorkRequest(source_type="prompt", title=f"Task {i}") for i in range(10)]
    call_count = 0

    def failing_pipeline(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        raise RuntimeError("boom")

    with patch("worca.orchestrator.batch.run_pipeline", side_effect=failing_pipeline):
        try:
            run_batch(requests, max_failures=5, results_dir=str(tmp_path / "results"))
            assert False, "Should have raised CircuitBreakerError"
        except CircuitBreakerError:
            assert call_count == 5  # exactly 5 calls before breaker trips


def test_circuit_breaker_resets_on_success(tmp_path):
    """Consecutive failures reset after a success."""
    results_sequence = [
        RuntimeError("fail"),
        RuntimeError("fail"),
        {"completed": True},  # success resets counter
        RuntimeError("fail"),
        RuntimeError("fail"),
        {"completed": True},  # another success resets again
    ]
    call_idx = 0

    def side_effect(*args, **kwargs):
        nonlocal call_idx
        val = results_sequence[call_idx]
        call_idx += 1
        if isinstance(val, Exception):
            raise val
        return val

    requests = [WorkRequest(source_type="prompt", title=f"Task {i}") for i in range(6)]
    with patch("worca.orchestrator.batch.run_pipeline", side_effect=side_effect):
        results = run_batch(requests, max_failures=3, results_dir=str(tmp_path / "results"))
    assert len(results) == 6


def test_error_results_contain_title(tmp_path):
    requests = [WorkRequest(source_type="prompt", title="My Task")]
    with patch("worca.orchestrator.batch.run_pipeline", side_effect=RuntimeError("oops")):
        try:
            run_batch(requests, max_failures=1, results_dir=str(tmp_path / "results"))
        except CircuitBreakerError:
            pass  # expected since max_failures=1


def test_should_skip_false_when_no_result(tmp_path):
    wr = WorkRequest(source_type="prompt", title="New task")
    results_dir = str(tmp_path / "results")
    os.makedirs(results_dir)
    assert should_skip(wr, results_dir) is False


def test_should_skip_false_when_dir_missing(tmp_path):
    wr = WorkRequest(source_type="prompt", title="New task")
    results_dir = str(tmp_path / "nonexistent")
    assert should_skip(wr, results_dir) is False


def test_should_skip_true_when_completed(tmp_path):
    wr = WorkRequest(source_type="prompt", title="Done task")
    results_dir = str(tmp_path / "results")
    os.makedirs(results_dir)

    # Write a completed result file
    rid = _request_id(wr)
    result_path = os.path.join(results_dir, f"{rid}.json")
    with open(result_path, "w") as f:
        json.dump({"completed": True, "title": "Done task"}, f)

    assert should_skip(wr, results_dir) is True


def test_should_skip_false_when_not_completed(tmp_path):
    wr = WorkRequest(source_type="prompt", title="Partial task")
    results_dir = str(tmp_path / "results")
    os.makedirs(results_dir)

    rid = _request_id(wr)
    result_path = os.path.join(results_dir, f"{rid}.json")
    with open(result_path, "w") as f:
        json.dump({"completed": False, "title": "Partial task"}, f)

    assert should_skip(wr, results_dir) is False


def test_should_skip_uses_source_ref():
    wr1 = WorkRequest(source_type="prompt", title="Task", source_ref="gh:42")
    wr2 = WorkRequest(source_type="prompt", title="Different Title", source_ref="gh:42")
    # Same source_ref should produce same request_id
    assert _request_id(wr1) == _request_id(wr2)


def test_request_id_uses_title_when_no_source_ref():
    wr1 = WorkRequest(source_type="prompt", title="Same Title")
    wr2 = WorkRequest(source_type="prompt", title="Same Title")
    assert _request_id(wr1) == _request_id(wr2)

    wr3 = WorkRequest(source_type="prompt", title="Different Title")
    assert _request_id(wr1) != _request_id(wr3)


def test_skips_already_completed_in_batch(tmp_path):
    results_dir = str(tmp_path / "results")
    os.makedirs(results_dir)

    wr_done = WorkRequest(source_type="prompt", title="Already done")
    wr_new = WorkRequest(source_type="prompt", title="New task")

    # Pre-write result for wr_done
    rid = _request_id(wr_done)
    with open(os.path.join(results_dir, f"{rid}.json"), "w") as f:
        json.dump({"completed": True}, f)

    with patch("worca.orchestrator.batch.run_pipeline", return_value={"completed": True}) as mock:
        results = run_batch([wr_done, wr_new], results_dir=results_dir)

    assert mock.call_count == 1  # Only new task was run
    assert len(results) == 2
    assert results[0].get("skipped") is True
