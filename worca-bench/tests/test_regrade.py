"""Regrade subcommand + the in-place row rewrite it depends on.

Uses ``grade.mode == stub`` so nothing shells out to sb-cli / Docker / network:
stub grading resolves on a non-empty diff, which is enough to prove the regrade
reads the saved ``diff.patch``, grades it, and rewrites the matching rows.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import worca_bench.cli as cli
from worca_bench.normalize import append_row, read_rows, rewrite_rows


def _row(instance_id, *, status, profile="demo", rep=1):
    return {
        "schema_version": 1, "profile": profile, "benchmark": "swe-bench-verified",
        "instance_id": instance_id, "rep": rep,
        "run_id": f"{profile}__{instance_id}__rep{rep}",
        "status": status, "resolved": None, "score": None, "error": "harness failed",
        "artifacts_dir": f"runs/{profile}/{instance_id}/rep{rep}",
    }


def _seed(tmp_path, *, diff_text="+added line\n"):
    profiles = tmp_path / "profiles"
    profiles.mkdir()
    (profiles / "demo.yaml").write_text(
        "name: demo\nbenchmark: swe-bench-verified\n"
        "selection:\n  instance_ids: [astropy__astropy-12907]\n"
        "template: builtin:quick-fix\ngrade:\n  mode: stub\n",
        encoding="utf-8",
    )
    append_row(tmp_path, _row("astropy__astropy-12907", status="error"))
    art = tmp_path / "runs" / "demo" / "astropy__astropy-12907" / "rep1"
    art.mkdir(parents=True)
    (art / "diff.patch").write_text(diff_text, encoding="utf-8")
    return profiles


def _args(tmp_path, profiles, **over):
    base = dict(
        target_dir=str(tmp_path), profile="demo", profiles_dir=str(profiles),
        mode="stub", only_errors=False, instance=None,
    )
    base.update(over)
    return argparse.Namespace(**base)


def test_rewrite_rows_mutates_in_place_atomically(tmp_path: Path):
    append_row(tmp_path, _row("a__b-1", status="error"))
    append_row(tmp_path, _row("a__b-2", status="error", rep=2))

    def mutate(row):
        if row["instance_id"] == "a__b-1":
            row["status"] = "graded"
            return True
        return False

    changed = rewrite_rows(tmp_path, mutate)
    assert changed == 1
    rows = {r["instance_id"]: r for r in read_rows(tmp_path)}
    assert rows["a__b-1"]["status"] == "graded"
    assert rows["a__b-2"]["status"] == "error"  # untouched
    assert len(read_rows(tmp_path)) == 2  # no dupes / drops


def test_regrade_stub_updates_error_row_to_graded(tmp_path: Path):
    profiles = _seed(tmp_path)
    rc = cli.cmd_regrade(_args(tmp_path, profiles, only_errors=True))
    assert rc == 0
    row = read_rows(tmp_path)[0]
    assert row["status"] == "graded"
    assert row["resolved"] is True  # stub resolves on a non-empty diff
    assert row["score"] == 1.0
    assert row["error"] is None
    assert row["grade_mode"] == "stub"
    assert "regraded_at" in row


def test_regrade_missing_diff_marks_error(tmp_path: Path):
    profiles = _seed(tmp_path)
    # Remove the saved diff so regrade can't find a patch to grade.
    (tmp_path / "runs" / "demo" / "astropy__astropy-12907" / "rep1" / "diff.patch").unlink()
    rc = cli.cmd_regrade(_args(tmp_path, profiles))
    assert rc == 0
    row = read_rows(tmp_path)[0]
    assert row["status"] == "error"
    assert "no diff.patch" in row["error"]


def test_regrade_instance_filter_limits_scope(tmp_path: Path):
    profiles = _seed(tmp_path)
    append_row(tmp_path, _row("astropy__astropy-99999", status="error"))
    art = tmp_path / "runs" / "demo" / "astropy__astropy-99999" / "rep1"
    art.mkdir(parents=True)
    (art / "diff.patch").write_text("+x\n", encoding="utf-8")

    rc = cli.cmd_regrade(_args(tmp_path, profiles, instance=["astropy__astropy-12907"]))
    assert rc == 0
    rows = {r["instance_id"]: r for r in read_rows(tmp_path)}
    assert rows["astropy__astropy-12907"]["status"] == "graded"
    assert rows["astropy__astropy-99999"]["status"] == "error"  # filtered out


def test_regrade_no_matches_returns_1(tmp_path: Path):
    profiles = _seed(tmp_path)
    rc = cli.cmd_regrade(_args(tmp_path, profiles, instance=["nonexistent__x-1"]))
    assert rc == 1
