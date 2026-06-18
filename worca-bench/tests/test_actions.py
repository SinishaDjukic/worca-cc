"""CLI-side actions ledger (Activity dock)."""

from __future__ import annotations

import json
import os
from pathlib import Path

from worca_bench import actions


def _read(target: Path) -> list[dict]:
    path = target / "actions.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_start_writes_running_record(tmp_path: Path):
    aid = actions.start(
        tmp_path, kind="run", profile="demo", source_dir=tmp_path,
        params={"reps": 2}, started_at="2026-06-18T10:00:00+00:00",
    )
    assert aid.startswith(f"run-demo-{os.getpid()}-")
    [rec] = _read(tmp_path)
    assert rec["id"] == aid
    assert rec["type"] == "run"
    assert rec["profile"] == "demo"
    assert rec["status"] == "running"
    assert rec["pid"] == os.getpid()
    assert rec["params"]["reps"] == 2
    # source_dir is recorded (absolute) so the server can backfill src.
    assert rec["source_dir"] == str(tmp_path.resolve())
    assert rec["src"] is None


def test_progress_then_finish_collapses_to_completed(tmp_path: Path):
    aid = actions.start(tmp_path, kind="run", profile="p", source_dir=tmp_path)
    actions.progress(tmp_path, aid, done=3, total=9, errors=1)
    actions.finish(
        tmp_path, aid, status="completed",
        progress={"unit": "instances", "done": 9, "total": 9, "errors": 1},
    )
    recs = _read(tmp_path)
    # one create + one progress + one finish, all sharing the id (latest wins)
    assert all(r["id"] == aid for r in recs)
    assert recs[1]["progress"] == {"unit": "instances", "done": 3, "total": 9, "errors": 1}
    assert recs[-1]["status"] == "completed"
    assert recs[-1]["ended_at"]
    assert recs[-1]["progress"]["done"] == 9


def test_finish_failed_records_error(tmp_path: Path):
    aid = actions.start(tmp_path, kind="regrade", profile="p", source_dir=tmp_path)
    actions.finish(tmp_path, aid, status="failed", error="boom")
    rec = _read(tmp_path)[-1]
    assert rec["status"] == "failed"
    assert rec["error"] == "boom"


def test_writes_are_best_effort_no_action_id(tmp_path: Path):
    # A falsy action_id is a no-op (never raises) for progress/finish.
    actions.progress(tmp_path, "", done=1)
    actions.finish(tmp_path, None, status="completed")
    assert not (tmp_path / "actions.jsonl").exists()
