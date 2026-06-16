"""SWE-bench Verified plugin (W-075 §3).

Clean by construction: the gold ``FAIL_TO_PASS`` tests arrive via ``test_patch`` only
at grade time, never in the agent's tree — so no test-hiding is needed. The prompt is
the issue ``problem_statement`` (``hints_text`` is intentionally excluded).
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from ..config import Profile
from .base import (
    BenchmarkPlugin,
    GradeResult,
    Instance,
    _git,
    init_repo_from_local,
    stub_grade,
)

HF_DATASET = "princeton-nlp/SWE-bench_Verified"
MODEL_NAME = "worca-bench"


def _load_dataset_with_retry(load_dataset, name, *, split="test", attempts=4):
    """Load an HF dataset, retrying transient network failures with backoff."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return load_dataset(name, split=split)
        except Exception as e:  # noqa: BLE001 - retry any transient fetch failure
            last = e
            if i < attempts - 1:
                time.sleep(3 * (i + 1))
    raise RuntimeError(
        f"failed to load HF dataset {name!r} after {attempts} attempts: {last}"
    ) from last


class SwebenchPlugin(BenchmarkPlugin):
    name = "swe-bench-verified"

    # ---- instance loading ----------------------------------------------- #
    def load_instances(self, profile: Profile) -> list[Instance]:
        sel = profile.selection
        if sel.instances_file:
            return self._load_from_file(Path(sel.instances_file), sel.instance_ids)
        return self._load_from_hf(profile)

    def _load_from_file(self, path: Path, ids: list[str]) -> list[Instance]:
        raw = path.read_text(encoding="utf-8")
        records = (
            [json.loads(line) for line in raw.splitlines() if line.strip()]
            if path.suffix == ".jsonl"
            else json.loads(raw)
        )
        want = set(ids)
        out: list[Instance] = []
        for r in records:
            iid = r["instance_id"]
            if want and iid not in want:
                continue
            out.append(self._to_instance(r))
        return out

    def _load_from_hf(self, profile: Profile) -> list[Instance]:
        # The Verified dataset is hundreds of MB over a CDN that can be slow/flaky.
        # HF's default 10s download timeout is too aggressive — bump it before the
        # (lazy) datasets import so huggingface_hub reads the larger value, then
        # retry transient network failures with backoff.
        os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
        try:
            from datasets import load_dataset
        except ImportError as e:  # pragma: no cover - optional dep
            raise RuntimeError(
                "SWE-bench needs the 'datasets' package (pip install worca-bench[swebench]) "
                "or a local selection.instances_file"
            ) from e
        ds = _load_dataset_with_retry(load_dataset, HF_DATASET)
        ids = set(profile.selection.instance_ids)
        records = [r for r in ds if not ids or r["instance_id"] in ids]
        if profile.selection.sample:  # pragma: no cover - exercised via integration
            records = _sample(records, profile.selection.sample)
        return [self._to_instance(r) for r in records]

    @staticmethod
    def _to_instance(r: dict) -> Instance:
        return Instance(
            id=r["instance_id"],
            prompt=r.get("problem_statement", ""),
            repo=r.get("repo"),
            base_commit=r.get("base_commit"),
            local_repo=r.get("local_repo"),
            extra={k: r[k] for k in ("expect_resolved", "version", "environment_setup_commit")
                   if k in r},
        )

    # ---- materialize ----------------------------------------------------- #
    def materialize(self, instance: Instance, dest: Path) -> str:
        if instance.local_repo:
            return init_repo_from_local(instance.local_repo, dest, instance.base_commit)
        if not instance.repo or not instance.base_commit:
            raise ValueError(f"instance {instance.id} lacks repo/base_commit for cloning")
        dest.mkdir(parents=True, exist_ok=True)
        url = f"https://github.com/{instance.repo}.git"
        subprocess.run(["git", "clone", url, str(dest)], check=True,
                       capture_output=True, text=True)
        _git(["checkout", instance.base_commit], dest)
        return _git(["rev-parse", "HEAD"], dest)

    # ---- grade ----------------------------------------------------------- #
    def grade(self, instance, diff, tree, target_dir, grade, *, prepared) -> GradeResult:
        if grade.mode == "stub":
            return stub_grade(diff, instance)
        prediction = {
            "instance_id": instance.id,
            "model_name_or_path": MODEL_NAME,
            "model_patch": diff,
        }
        if grade.mode == "sb-cli":
            return self._grade_sb_cli(prediction, target_dir, grade)
        if grade.mode in ("local-docker", "modal"):
            return self._grade_harness(prediction, grade)
        return GradeResult(status="error", detail=f"unsupported grade mode {grade.mode}")

    # Real graders below are best-effort shell-outs (require sb-cli / Docker / network);
    # they are not exercised by unit tests, which use grade.mode == 'stub'.
    def _grade_sb_cli(self, prediction, target_dir, grade) -> GradeResult:  # pragma: no cover
        preds_dir = target_dir / "predictions"
        preds_dir.mkdir(parents=True, exist_ok=True)
        preds = preds_dir / f"{prediction['instance_id']}.jsonl"
        preds.write_text(json.dumps(prediction) + "\n", encoding="utf-8")
        run_id = grade.options.get("run_id", f"wb-{prediction['instance_id']}")
        subset = grade.options.get("subset", "swe-bench_verified")
        try:
            subprocess.run(
                ["sb-cli", "submit", subset, "test",
                 "--predictions_path", str(preds), "--run_id", run_id],
                check=True, capture_output=True, text=True,
            )
            out_dir = target_dir / "sb-reports" / run_id
            out_dir.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["sb-cli", "get-report", subset, "test", run_id, "-o", str(out_dir)],
                check=True, capture_output=True, text=True,
            )
            report = next(out_dir.glob("*.json"), None)
            resolved = _resolved_from_report(report, prediction["instance_id"]) if report else None
            return GradeResult(status="graded", resolved=resolved,
                               score=1.0 if resolved else 0.0,
                               report_path=str(report) if report else None,
                               detail="sb-cli")
        except (subprocess.CalledProcessError, OSError) as e:
            return GradeResult(status="error", detail=f"sb-cli failed: {e}")

    def _grade_harness(self, prediction, grade) -> GradeResult:  # pragma: no cover
        with tempfile.TemporaryDirectory() as td:
            preds = Path(td) / "predictions.jsonl"
            preds.write_text(json.dumps(prediction) + "\n", encoding="utf-8")
            run_id = grade.options.get("run_id", f"wb-{prediction['instance_id']}")
            cmd = ["python", "-m", "swebench.harness.run_evaluation",
                   "--dataset_name", HF_DATASET,
                   "--predictions_path", str(preds),
                   "--run_id", run_id, "--max_workers", "1",
                   "--instance_ids", prediction["instance_id"]]
            if grade.mode == "modal":
                cmd += ["--modal", "true"]
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                report = Path.cwd() / f"{MODEL_NAME}.{run_id}.json"
                resolved = _resolved_from_report(report, prediction["instance_id"])
                return GradeResult(status="graded", resolved=resolved,
                                   score=1.0 if resolved else 0.0,
                                   report_path=str(report), detail=grade.mode)
            except (subprocess.CalledProcessError, OSError) as e:
                return GradeResult(status="error", detail=f"harness failed: {e}")


def _sample(records, sample):  # pragma: no cover - integration-only
    import random

    rng = random.Random(sample.seed)
    if sample.stratify_by:
        buckets: dict = {}
        for r in records:
            buckets.setdefault(r.get(sample.stratify_by), []).append(r)
        out = []
        per = max(1, sample.n // max(1, len(buckets)))
        for items in buckets.values():
            rng.shuffle(items)
            out.extend(items[:per])
        return out[: sample.n]
    pool = list(records)
    rng.shuffle(pool)
    return pool[: sample.n]


def _resolved_from_report(report: Path | None, instance_id: str) -> bool | None:  # pragma: no cover
    if not report or not report.exists():
        return None
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    resolved_ids = data.get("resolved_ids") or data.get("resolved_instances") or []
    if isinstance(resolved_ids, list):
        return instance_id in resolved_ids
    return None
