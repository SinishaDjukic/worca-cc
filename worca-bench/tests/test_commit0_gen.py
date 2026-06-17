from __future__ import annotations

import json
from pathlib import Path

from worca_bench.commit0_gen import (
    _short_lib,
    assemble_prompt,
    build_instance_record,
    generate_instances,
)

ROW = {
    "instance_id": "commit-0/wcwidth",
    "repo": "commit-0/wcwidth",
    "base_commit": "0d0054base",
    "reference_commit": "36a625ref",
    "setup": {"install": "pip install -e .", "python": "3.10",
              "specification": "https://wcwidth.example/"},
    "test": {"test_cmd": "pytest", "test_dir": "tests/"},
    "src_dir": "wcwidth/",
}


def test_short_lib_takes_last_path_segment():
    assert _short_lib("commit-0/wcwidth") == "wcwidth"
    assert _short_lib("tinydb") == "tinydb"


def test_assemble_prompt_mentions_src_test_dirs_and_rules():
    p = assemble_prompt(ROW, "wcwidth", spec_text="SPEC BODY")
    assert "wcwidth" in p
    assert "wcwidth/" in p           # src dir
    assert "tests/" in p             # held-out test dir referenced in the rules
    assert "https://wcwidth.example/" in p
    assert "SPEC BODY" in p          # extracted spec text included
    assert "from scratch" in p.lower()


def test_build_instance_record_shape(tmp_path: Path):
    base = tmp_path / "repos"
    rec = build_instance_record(
        ROW, base_dir=base, config_file=tmp_path / ".commit0.yaml",
        base_branch="commit0", dataset_name="ds", dataset_split="test",
        spec_text="",
    )
    assert rec["instance_id"] == "wcwidth"     # path-safe (dataset id has a '/')
    assert rec["lib"] == "wcwidth"
    assert rec["base_commit"] == "0d0054base"
    assert rec["reference_commit"] == "36a625ref"
    assert rec["gold_test_paths"] == ["tests/"]
    assert rec["local_repo"].endswith(f"{Path('repos') / 'wcwidth'}")
    assert rec["commit0"]["base_branch"] == "commit0"
    assert rec["commit0"]["dataset_name"] == "ds"
    assert rec["commit0"]["config_file"].endswith(".commit0.yaml")


def test_generate_instances_only_cloned_filters_and_writes(tmp_path: Path):
    base = tmp_path / "repos"
    (base / "wcwidth").mkdir(parents=True)   # this one is "cloned"
    # 'tinydb' row present in the dataset but not cloned -> filtered out.
    rows = [ROW, {"repo": "commit-0/tinydb", "base_commit": "b", "test": {}}]
    out = tmp_path / "instances.json"

    recs = generate_instances(
        "wcwidth", base_dir=base, out_path=out, run_setup=False,
        only_cloned=True, _rows=rows,
    )
    assert [r["lib"] for r in recs] == ["wcwidth"]
    written = json.loads(out.read_text(encoding="utf-8"))
    assert len(written) == 1
    assert written[0]["instance_id"] == "wcwidth"


def test_generate_instances_without_only_cloned_keeps_all(tmp_path: Path):
    base = tmp_path / "repos"
    base.mkdir(parents=True)
    rows = [ROW, {"repo": "commit-0/tinydb", "base_commit": "b",
                  "test": {"test_dir": "tests/"}}]
    out = tmp_path / "instances.json"
    recs = generate_instances(
        "lite", base_dir=base, out_path=out, run_setup=False,
        only_cloned=False, _rows=rows,
    )
    assert sorted(r["lib"] for r in recs) == ["tinydb", "wcwidth"]
