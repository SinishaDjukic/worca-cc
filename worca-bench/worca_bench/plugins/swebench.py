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
    grade_env,
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
    # Grade-backend registry: ``grade.mode`` → bound-method name. Adding a backend
    # is a one-liner here plus a ``_grade_<x>(prediction, target_dir, grade,
    # secret_env)`` method — the dispatch in ``grade()`` stays closed. ``stub`` is
    # handled before the registry (it needs no prediction); ``local-docker`` and
    # ``modal`` share the harness grader (``modal`` only flips ``--modal true``).
    GRADERS = {
        "sb-cli": "_grade_sb_cli",
        "local-docker": "_grade_harness",
        "modal": "_grade_harness",
    }

    def grade(self, instance, diff, tree, target_dir, grade, *, prepared,
              secret_env=None) -> GradeResult:
        if grade.mode == "stub":
            return stub_grade(diff, instance)
        prediction = {
            "instance_id": instance.id,
            "model_name_or_path": MODEL_NAME,
            "model_patch": diff,
        }
        method = self.GRADERS.get(grade.mode)
        if method is None:
            return GradeResult(status="error",
                               detail=f"unsupported grade mode {grade.mode}")
        return getattr(self, method)(prediction, target_dir, grade, secret_env)

    # Real graders below are best-effort shell-outs (require sb-cli / Docker / network);
    # they are not exercised by unit tests, which use grade.mode == 'stub'.
    def _grade_sb_cli(self, prediction, target_dir, grade, secret_env=None) -> GradeResult:  # pragma: no cover
        iid = prediction["instance_id"]
        env = grade_env(secret_env)
        preds_dir = target_dir / "predictions"
        preds_dir.mkdir(parents=True, exist_ok=True)
        preds = preds_dir / f"{iid}.jsonl"
        preds.write_text(json.dumps(prediction) + "\n", encoding="utf-8")
        run_id = grade.options.get("run_id", f"wb-{iid}")
        subset = grade.options.get("subset", "swe-bench_verified")
        out_dir = target_dir / "sb-reports" / run_id
        out_dir.mkdir(parents=True, exist_ok=True)
        try:
            submit = subprocess.run(
                ["sb-cli", "submit", subset, "test",
                 "--predictions_path", str(preds), "--run_id", run_id,
                 "-o", str(out_dir)],  # keep sb-cli's report out of the cwd
                capture_output=True, text=True, env=env,
            )
            get = subprocess.run(
                ["sb-cli", "get-report", subset, "test", run_id, "-o", str(out_dir)],
                capture_output=True, text=True, env=env,
            )
        except OSError as e:
            return GradeResult(status="error", detail=f"sb-cli not available: {e}")
        # The report is authoritative; read it regardless of the CLI exit codes
        # (sb-cli can exit non-zero on benign warnings). Classify by the report's
        # explicit id buckets — a remote eval *failure* (failed_ids/error_ids) is
        # an error, NOT a graded-as-unresolved verdict. Only hard-error when no
        # usable report came back at all.
        report = next(out_dir.glob("*.json"), None)
        verdict = _classify_sb_report(report, iid)
        if verdict is not None:
            return verdict
        tail = (get.stderr or get.stdout or submit.stderr or submit.stdout or "").strip()[-1000:]
        return GradeResult(
            status="error",
            detail=f"sb-cli failed (submit rc={submit.returncode}, "
                   f"get rc={get.returncode}): {tail}")

    def _grade_harness(self, prediction, _target_dir, grade, secret_env=None) -> GradeResult:
        env = grade_env(secret_env)
        # Modal runs the harness on hosted x86 workers (the way to grade SWE-bench
        # from an Apple-Silicon host). It authenticates from MODAL_TOKEN_ID/SECRET
        # in the env — fail fast with an actionable message if they're absent
        # rather than letting the harness die deep inside the modal client.
        if grade.mode == "modal" and not (
            env.get("MODAL_TOKEN_ID") and env.get("MODAL_TOKEN_SECRET")
        ):
            return GradeResult(
                status="error",
                detail="modal grading needs MODAL_TOKEN_ID + MODAL_TOKEN_SECRET "
                       "(set them in the dashboard Settings, pass "
                       "--modal-token-id/--modal-token-secret, or export them)")
        with tempfile.TemporaryDirectory() as td:  # pragma: no cover - needs the real harness
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
                proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
            except OSError as e:
                return GradeResult(status="error", detail=f"harness failed: {e}")
            # The harness's per-instance report.json is authoritative and is
            # written even when the process exits non-zero (e.g. image cleanup
            # noise, or other instances in a batch erroring). Read it regardless
            # of the return code; only fall back to a hard error when no report
            # was produced at all (genuine grading failure — image build, etc.).
            inst_report = harness_report_path(run_id, prediction["instance_id"])
            resolved = _resolved_from_instance_report(
                inst_report, prediction["instance_id"])
            if resolved is None:
                summary = Path.cwd() / f"{MODEL_NAME}.{run_id}.json"
                resolved = _resolved_from_report(summary, prediction["instance_id"])
                inst_report = summary if resolved is not None else inst_report
            if resolved is not None:
                detail = grade.mode if proc.returncode == 0 else (
                    f"{grade.mode} (harness rc={proc.returncode})")
                return GradeResult(status="graded", resolved=resolved,
                                   score=1.0 if resolved else 0.0,
                                   report_path=str(inst_report), detail=detail)
            tail = (proc.stderr or proc.stdout or "").strip()[-1000:]
            return GradeResult(
                status="error",
                detail=f"harness failed (rc={proc.returncode}); "
                       f"no report at {inst_report}: {tail}")


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


def _classify_sb_report(report: Path | None, instance_id: str) -> GradeResult | None:
    """Map an sb-cli summary report's id buckets to a GradeResult for one instance.

    sb-cli reports carry disjoint id lists (``resolved_ids``, ``unresolved_ids``,
    ``failed_ids``, ``error_ids``, ``pending_ids``). A *resolved/unresolved* verdict
    is a real grade; ``failed``/``error`` mean the hosted harness could not
    evaluate the instance (e.g. the patch failed to apply) — that is an error, not
    a "graded as unresolved". Returns None when the report is missing/unparseable
    or the instance appears in no bucket (caller treats as no result).
    """
    if not report or not report.exists():
        return None
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    def _in(bucket: str) -> bool:
        v = data.get(bucket)
        return isinstance(v, list) and instance_id in v

    rp = str(report)
    if _in("resolved_ids"):
        return GradeResult(status="graded", resolved=True, score=1.0,
                           report_path=rp, detail="sb-cli")
    if _in("unresolved_ids"):
        return GradeResult(status="graded", resolved=False, score=0.0,
                           report_path=rp, detail="sb-cli")
    if _in("failed_ids"):
        return GradeResult(status="error", report_path=rp,
                           detail="sb-cli: instance failed to evaluate "
                                  "(patch did not apply / harness error)")
    if _in("error_ids"):
        return GradeResult(status="error", report_path=rp,
                           detail="sb-cli: evaluation error")
    if _in("pending_ids"):
        return GradeResult(status="error", report_path=rp,
                           detail="sb-cli: evaluation still pending")
    return None


def harness_report_path(run_id: str, instance_id: str) -> Path:
    """Where ``run_evaluation`` writes the per-instance report (cwd-relative)."""
    return (Path.cwd() / "logs" / "run_evaluation" / run_id / MODEL_NAME
            / instance_id / "report.json")


def _resolved_from_instance_report(report: Path | None, instance_id: str) -> bool | None:
    """Read ``resolved`` from a per-instance ``report.json``.

    The harness writes ``{<instance_id>: {"resolved": bool, ...}}``. Returns
    None when the report is absent or unparseable (treated as "no result").
    """
    if not report or not report.exists():
        return None
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    entry = data.get(instance_id)
    if isinstance(entry, dict) and "resolved" in entry:
        return bool(entry["resolved"])
    return None


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
