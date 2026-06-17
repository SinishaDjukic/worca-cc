"""Generate a Commit0 instances file from a `commit0 setup` checkout (W-075 §3 / G1).

Commit0 has no HuggingFace-style "just load it" path for worca-bench: each instance
is a *local skeleton* (a cloned repo at its base commit, implementation stripped) plus
the metadata the runner + grader need. This module turns a `commit0 setup <split>`
checkout into the `selection.instances_file` JSON a commit0 profile consumes:

    [
      {
        "instance_id": "wcwidth",          # worca-bench id (path-safe; the lib name)
        "lib": "wcwidth",                  # what `commit0 test` expects
        "local_repo": "/abs/repos/wcwidth",# skeleton to materialize from
        "base_commit": "0d0054…",          # skeleton commit (impl stripped)
        "reference_commit": "36a625…",     # gold impl (for reference grading)
        "gold_test_paths": ["tests/"],     # hidden during the run, graded on pristine
        "spec": "…",                       # the agent prompt (spec text + how-to)
        "commit0": { … }                   # config the grader reconstructs from
      },
      …
    ]

The grader (`Commit0Plugin._grade_on_pristine`) reads the ``commit0`` block to drive
``commit0 test`` against the live setup checkout on a scratch branch.
"""

from __future__ import annotations

import bz2
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

# Keep the assembled prompt bounded — a full spec PDF can be hundreds of KB of text.
_SPEC_TEXT_LIMIT = 16000


def _short_lib(repo: str) -> str:
    """The Commit0 library name `commit0 test` expects (repo path's last segment)."""
    return str(repo).rsplit("/", 1)[-1]


def extract_spec_text(repo_dir: Path) -> str:
    """Best-effort plain text of a repo's ``spec.pdf.bz2`` (empty string on failure).

    Commit0 ships the per-library specification as a bz2-compressed PDF in the repo
    root. We decompress + extract text so the agent prompt carries the real spec;
    any failure (missing file, no PDF reader, parse error) degrades to "" — the
    caller falls back to the spec URL + structural metadata.
    """
    pdf_bz2 = Path(repo_dir) / "spec.pdf.bz2"
    if not pdf_bz2.exists():
        return ""
    try:
        import io

        from pypdf import PdfReader

        raw = bz2.decompress(pdf_bz2.read_bytes())
        reader = PdfReader(io.BytesIO(raw))
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
            if sum(len(p) for p in parts) > _SPEC_TEXT_LIMIT:
                break
        return _sanitize_spec_text("\n".join(parts))[:_SPEC_TEXT_LIMIT]
    except Exception:  # noqa: BLE001 - spec text is best-effort; never fail the gen
        return ""


def _sanitize_spec_text(text: str) -> str:
    """Strip control characters PDF extraction can emit (notably NUL).

    pypdf occasionally yields embedded NUL (``\\x00``) and other C0 control bytes.
    A NUL in the agent prompt makes the runner raise ``ValueError: embedded null
    byte`` the moment it touches a path/syscall — failing the instance before the
    pipeline even starts. Drop all C0 controls except tab/newline/carriage-return.
    """
    return "".join(
        ch for ch in text if ch in "\t\n\r" or ord(ch) >= 0x20
    ).strip()


def assemble_prompt(row: dict[str, Any], lib: str, spec_text: str) -> str:
    """Build the agent work-request for one Commit0 library from dataset metadata.

    Commit0 is greenfield: the package modules exist but their implementations are
    stripped (docstrings/signatures remain). The agent must implement the public API
    so the held-out test suite passes — without seeing those tests (worca-bench hides
    them; worca's own tester writes throwaway tests).
    """
    setup = row.get("setup") or {}
    test = row.get("test") or {}
    src_dir = row.get("src_dir") or "the package directory"
    test_dir = test.get("test_dir") or "tests/"
    spec_url = setup.get("specification") or ""
    install = setup.get("install") or "pip install -e ."
    python = setup.get("python") or ""

    lines = [
        f"# Implement the `{lib}` Python library from scratch (Commit0)",
        "",
        f"This is a greenfield build. The package under `{src_dir}` has its module "
        "structure in place, but the implementations have been removed — function and "
        "class bodies are stubbed while docstrings and signatures remain. Your task is "
        "to implement the full public API so the library behaves per its specification.",
        "",
        "## Rules",
        f"- Implement only library source under `{src_dir}` (and supporting modules it needs).",
        f"- Do NOT add, modify, or depend on anything under `{test_dir}` — the grading "
        "test suite is held out and supplied at evaluation time. Write your own throwaway "
        "tests if you practice TDD, but they will not be graded and must live elsewhere.",
        f"- Environment: install with `{install}`"
        + (f" (Python {python})." if python else "."),
        "",
        "## Specification",
    ]
    if spec_url:
        lines.append(f"- Reference: {spec_url}")
    lines.append("- The full specification also ships as `spec.pdf` in the repo root.")
    if spec_text:
        lines += ["", "### Specification text (extracted from spec.pdf)", "", spec_text]
    return "\n".join(lines)


def build_instance_record(
    row: dict[str, Any],
    *,
    base_dir: Path,
    config_file: Path,
    base_branch: str,
    dataset_name: str,
    dataset_split: str,
    spec_text: str,
) -> dict[str, Any]:
    """Assemble one instances-file record (pure — no I/O beyond the passed spec_text)."""
    repo = row.get("repo") or row.get("instance_id") or ""
    lib = _short_lib(repo)
    test = row.get("test") or {}
    test_dir = test.get("test_dir") or "tests/"
    local_repo = (Path(base_dir) / lib).resolve()
    return {
        "instance_id": lib,  # path-safe worca-bench id (dataset id has a '/')
        "lib": lib,
        "local_repo": str(local_repo),
        "base_commit": row.get("base_commit"),
        "reference_commit": row.get("reference_commit"),
        "gold_test_paths": [test_dir],
        "spec": assemble_prompt(row, lib, spec_text),
        # Everything the grader needs to drive `commit0 test` against the live setup.
        "commit0": {
            "base_dir": str(Path(base_dir).resolve()),
            "config_file": str(Path(config_file).resolve()),
            "base_branch": base_branch,
            "dataset_name": dataset_name,
            "dataset_split": dataset_split,
        },
    }


def _run_setup(split: str, base_dir: Path, config_file: Path,
               dataset_name: str, dataset_split: str) -> None:  # pragma: no cover - shells out
    cmd = [
        "commit0", "setup", split,
        "--base-dir", str(base_dir),
        "--commit0-config-file", str(config_file),
        "--dataset-name", dataset_name,
        "--dataset-split", dataset_split,
    ]
    subprocess.run(cmd, check=True)


def _load_rows(dataset_name: str, dataset_split: str):  # pragma: no cover - network/HF
    from datasets import load_dataset

    return list(load_dataset(dataset_name, split=dataset_split))


def generate_instances(
    split: str,
    *,
    base_dir: Path,
    out_path: Path,
    config_file: Path | None = None,
    dataset_name: str = "wentingzhao/commit0_combined",
    dataset_split: str = "test",
    base_branch: str = "commit0",
    run_setup: bool = True,
    only_cloned: bool = True,
    _rows: list[dict] | None = None,  # injectable for tests
) -> list[dict[str, Any]]:
    """Set up a Commit0 split (optionally) and write its instances file.

    Returns the records written. ``split`` is a Commit0 split or a single library
    name (e.g. ``wcwidth``). With ``only_cloned`` (default) only repos present under
    ``base_dir`` are emitted — so a single-library setup yields a single instance.
    """
    base_dir = Path(base_dir)
    config_file = Path(config_file) if config_file else (base_dir.parent / ".commit0.yaml")
    if run_setup:
        _run_setup(split, base_dir, config_file, dataset_name, dataset_split)  # pragma: no cover

    rows = _rows if _rows is not None else _load_rows(dataset_name, dataset_split)
    records: list[dict[str, Any]] = []
    for row in rows:
        lib = _short_lib(row.get("repo") or row.get("instance_id") or "")
        if not lib:
            continue
        repo_dir = base_dir / lib
        if only_cloned and not repo_dir.exists():
            continue
        spec_text = extract_spec_text(repo_dir)
        records.append(build_instance_record(
            row, base_dir=base_dir, config_file=config_file, base_branch=base_branch,
            dataset_name=dataset_name, dataset_split=dataset_split, spec_text=spec_text,
        ))

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"wrote {len(records)} commit0 instance(s) to {out_path}", file=sys.stderr)
    return records
