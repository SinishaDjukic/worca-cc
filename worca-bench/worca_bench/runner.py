"""Per-rep lifecycle orchestrator + sweep driver (W-075 §2, §9).

For each (instance, rep): materialize the base tree → install worca → stash benchmark
tests (Commit0) → launch the pipeline → harvest a source-only diff + telemetry →
leakage guard → grade → normalize into ``results.jsonl``. A serial canary per template
fails fast on configs a worca version rejects, before the parallel sweep.
"""

from __future__ import annotations

import os
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Profile
from .harvest import archive_artifacts, extract_diff, parse_telemetry, touches_paths
from .harvest import Telemetry
from .launcher import canary as run_canary
from .launcher import launch
from .normalize import append_row, build_row
from .plugins import get_plugin
from .plugins.base import BenchmarkPlugin, Instance
from .templates import resolve_for_launch
from .venvs import WorcaEnv, resolve_worca_env
from .worca_install import collect_secret_env, load_overlay, seed_settings, worca_init


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RepResult:
    instance_id: str
    rep: int
    status: str
    resolved: bool | None = None
    score: float | None = None
    error: str | None = None


@dataclass
class RunSummary:
    profile: str
    worca_ref: str
    reps_total: int
    reps_run: int = 0
    reps_skipped: int = 0
    reps_error: int = 0
    incompatible_templates: dict[str, str] = field(default_factory=dict)
    results: list[RepResult] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "profile": self.profile,
            "worca_ref": self.worca_ref,
            "reps_total": self.reps_total,
            "reps_run": self.reps_run,
            "reps_skipped": self.reps_skipped,
            "reps_error": self.reps_error,
            "incompatible_templates": self.incompatible_templates,
        }


def _work_dir(target: Path, profile: str, inst_id: str, rep: int) -> Path:
    return target / "work" / profile / inst_id / f"rep{rep}"


def _artifacts_rel(profile: str, inst_id: str, rep: int) -> str:
    return f"runs/{profile}/{inst_id}/rep{rep}"


def plan_reps(profile: Profile, instances: list[Instance]) -> list[tuple[Instance, int]]:
    return [(inst, rep) for inst in instances for rep in range(1, profile.reps + 1)]


def _apply_cache_env(cache_dir: Path) -> None:
    """Point HuggingFace's dataset cache at the benchmark cache dir so the large
    SWE-bench/Commit0 dataset downloads land there (not the user's ~/.cache). Set
    before any ``datasets.load_dataset`` call (plugin.load_instances). Also flows
    to the run_pipeline subprocess, which inherits os.environ."""
    cache_dir = Path(cache_dir)
    hf = cache_dir / "hf"
    hf.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(hf))
    os.environ["HF_DATASETS_CACHE"] = str(hf / "datasets")
    os.environ["WORCA_BENCH_CACHE"] = str(cache_dir)


def run_profile(
    profile: Profile,
    target_dir: Path,
    *,
    dry_run: bool = False,
    canary_first: bool = True,
    max_instances: int | None = None,
    keep_work: bool = False,
    cache_dir: Path | None = None,
) -> RunSummary:
    target_dir = Path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    if cache_dir is not None:
        _apply_cache_env(cache_dir)
    plugin = get_plugin(profile)
    instances = plugin.load_instances(profile)
    if max_instances is not None:
        instances = instances[:max_instances]
    tasks = plan_reps(profile, instances)

    wenv = resolve_worca_env(profile.worca, target_dir, build=not dry_run)
    summary = RunSummary(
        profile=profile.name, worca_ref=wenv.describe(), reps_total=len(tasks),
    )

    if dry_run:
        return summary

    overlay = load_overlay(wenv.resolved_sha)
    secret_env = collect_secret_env()
    templates = {profile.template_for(i.id) for i in instances}

    if canary_first and instances:
        for tmpl in sorted(templates):
            ok, reason = _canary_template(
                profile, wenv, plugin, instances[0], tmpl, target_dir, overlay, secret_env,
            )
            if not ok:
                summary.incompatible_templates[tmpl] = reason

    def _task(item: tuple[Instance, int]) -> RepResult:
        inst, rep = item
        tmpl = profile.template_for(inst.id)
        if tmpl in summary.incompatible_templates:
            row = _skip_row(profile, inst, rep, wenv, tmpl,
                            summary.incompatible_templates[tmpl])
            append_row(target_dir, row)
            return RepResult(inst.id, rep, "skipped", error=row["error"])
        return _run_one_rep(
            profile, wenv, plugin, inst, rep, target_dir, overlay, secret_env, keep_work,
        )

    workers = max(1, profile.concurrency.worca)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_task, t): t for t in tasks}
        for fut in as_completed(futs):
            res = fut.result()
            summary.results.append(res)
            if res.status == "skipped":
                summary.reps_skipped += 1
            elif res.status == "error":
                summary.reps_error += 1
            else:
                summary.reps_run += 1
    return summary


def _canary_template(
    profile, wenv: WorcaEnv, plugin: BenchmarkPlugin, inst: Instance, template: str,
    target_dir: Path, overlay, secret_env,
) -> tuple[bool, str]:
    work = _work_dir(target_dir, profile.name, "__canary__", 0) / template.replace(":", "_")
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    try:
        plugin.materialize(inst, work)
        worca_init(work, wenv)
        seed_settings(work, overlay=overlay, extra_settings=profile.settings,
                      pr_defer=profile.pr_defer, secret_env=secret_env)
        bare = resolve_for_launch(template, tree=work, templates=profile.templates)
        ok, reason = run_canary(
            profile, wenv, work, template=bare,
            run_scratch=work / ".wb_scratch",
        )
        return ok, reason
    except Exception as e:  # noqa: BLE001 - canary must never crash the sweep
        return False, f"canary error: {e}"
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _run_one_rep(
    profile, wenv: WorcaEnv, plugin: BenchmarkPlugin, inst: Instance, rep: int,
    target_dir: Path, overlay, secret_env, keep_work: bool,
) -> RepResult:
    run_id = f"{profile.name}__{inst.id}__rep{rep}"
    template = profile.template_for(inst.id)
    work = _work_dir(target_dir, profile.name, inst.id, rep)
    artifacts = target_dir / _artifacts_rel(profile.name, inst.id, rep)
    started = _now()
    prepared = None
    try:
        if work.exists():
            shutil.rmtree(work, ignore_errors=True)
        plugin.materialize(inst, work)
        worca_init(work, wenv)
        seed_settings(work, overlay=overlay, extra_settings=profile.settings,
                      pr_defer=profile.pr_defer, secret_env=secret_env)
        prepared = plugin.prepare(inst, work)

        bare_template = resolve_for_launch(template, tree=work, templates=profile.templates)
        outcome = launch(
            profile, wenv, work,
            prompt=plugin.prompt_for(inst), template=bare_template,
            run_id=run_id, run_scratch=work / ".wb_scratch",
        )
        diff = extract_diff(work, prepared.base_commit,
                            extra_excludes=prepared.extra_excludes)
        telemetry = parse_telemetry(outcome.status) if outcome.status else Telemetry()

        # Leakage guard: a diff touching gold-test paths is contamination (Commit0).
        leaked_paths = touches_paths(diff, prepared.gold_test_paths)
        leaked = bool(leaked_paths)

        if outcome.status is None:
            status, resolved, score, error = "error", None, None, (
                outcome.stderr or outcome.stdout or "no status.json"
            ).strip()[-400:]
            grade = None
        elif leaked:
            status, resolved, score, error = "error", False, 0.0, (
                f"leakage guard: diff touched gold-test paths {leaked_paths}"
            )
            grade = None
        else:
            grade = plugin.grade(inst, diff, work, target_dir, profile.grade,
                                 prepared=prepared)
            status = grade.status
            resolved, score, error = grade.resolved, grade.score, (
                grade.detail if grade.status == "error" else None
            )

        archive_artifacts(outcome.run_dir, diff, artifacts)
        row = build_row(
            profile_name=profile.name, benchmark=profile.benchmark,
            instance_id=inst.id, worca_ref=wenv.describe(), template=template,
            worca_version=wenv.version, grade_mode=profile.grade.mode,
            rep=rep, run_id=run_id, status=status, resolved=resolved, score=score,
            telemetry=telemetry, diff=diff, leaked=leaked, error=error,
            started_at=started, completed_at=_now(),
            artifacts_dir=_artifacts_rel(profile.name, inst.id, rep),
        )
        append_row(target_dir, row)
        return RepResult(inst.id, rep, status, resolved, score, error)
    except Exception as e:  # noqa: BLE001 - one rep failing must not kill the sweep
        row = _error_row(profile, inst, rep, wenv, template, str(e), started)
        append_row(target_dir, row)
        return RepResult(inst.id, rep, "error", error=str(e))
    finally:
        if prepared and prepared.restore:
            try:
                prepared.restore()
            except Exception:  # noqa: BLE001
                pass
        if not keep_work:
            shutil.rmtree(work, ignore_errors=True)


def _skip_row(profile, inst, rep, wenv, template, reason) -> dict[str, Any]:
    return build_row(
        profile_name=profile.name, benchmark=profile.benchmark, instance_id=inst.id,
        worca_ref=wenv.describe(), template=template,
        worca_version=wenv.version, grade_mode=profile.grade.mode, rep=rep,
        run_id=f"{profile.name}__{inst.id}__rep{rep}", status="skipped",
        resolved=None, score=None, telemetry=Telemetry(), diff="", leaked=False,
        error=f"template incompatible: {reason}", started_at=_now(), completed_at=_now(),
        artifacts_dir=_artifacts_rel(profile.name, inst.id, rep),
    )


def _error_row(profile, inst, rep, wenv, template, err, started) -> dict[str, Any]:
    return build_row(
        profile_name=profile.name, benchmark=profile.benchmark, instance_id=inst.id,
        worca_ref=wenv.describe(), template=template,
        worca_version=wenv.version, grade_mode=profile.grade.mode, rep=rep,
        run_id=f"{profile.name}__{inst.id}__rep{rep}", status="error",
        resolved=None, score=None, telemetry=Telemetry(), diff="", leaked=False,
        error=err, started_at=started, completed_at=_now(),
        artifacts_dir=_artifacts_rel(profile.name, inst.id, rep),
    )
