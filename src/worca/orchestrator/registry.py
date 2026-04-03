"""Pipeline registry -- directory-based tracking of parallel pipeline instances.

Each pipeline writes its own status file to .worca/multi/pipelines.d/{run_id}.json.
Atomic writes via temp+rename. No file locking needed.
"""

import errno
import json
import os
import tempfile
from datetime import datetime, timezone


_DEFAULT_BASE = ".worca"


def _registry_dir(base=_DEFAULT_BASE):
    """Return the path to the pipelines.d directory, creating it if needed."""
    d = os.path.join(base, "multi", "pipelines.d")
    os.makedirs(d, exist_ok=True)
    return d


def _pipeline_path(run_id, base=_DEFAULT_BASE):
    """Return the path to a pipeline's registry file."""
    return os.path.join(_registry_dir(base), run_id + ".json")


def _atomic_write(path, data):
    """Write data dict as JSON using temp file + os.replace for atomicity."""
    parent = os.path.dirname(path)
    os.makedirs(parent, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=parent, prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def register_pipeline(run_id, worktree_path, title, pid, base=_DEFAULT_BASE):
    """Register a new pipeline. Returns the path to the registry file.

    Creates .worca/multi/pipelines.d/{run_id}.json with pipeline metadata.
    Uses atomic writes (temp file + os.replace).
    """
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "run_id": run_id,
        "worktree_path": worktree_path,
        "title": title,
        "pid": pid,
        "status": "running",
        "started_at": now,
        "updated_at": now,
    }
    path = _pipeline_path(run_id, base=base)
    _atomic_write(path, data)
    return path


def update_pipeline(run_id, status=None, stage=None, base=_DEFAULT_BASE):
    """Update fields on an existing pipeline entry. Returns True on success.

    Returns False if the pipeline registry file does not exist.

    Note: The read-modify-write cycle is not atomic across concurrent callers.
    This is safe because each pipeline has its own run_id file, and the
    orchestrator processes completions sequentially via as_completed().
    Do not call concurrently for the same run_id without external locking.
    """
    path = _pipeline_path(run_id, base=base)
    if not os.path.exists(path):
        return False

    with open(path) as f:
        data = json.load(f)

    if status is not None:
        data["status"] = status
    if stage is not None:
        data["stage"] = stage
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    _atomic_write(path, data)
    return True


def deregister_pipeline(run_id, base=_DEFAULT_BASE):
    """Remove a pipeline's registry file. Returns True if file existed."""
    path = _pipeline_path(run_id, base=base)
    try:
        os.unlink(path)
        return True
    except FileNotFoundError:
        return False


def list_pipelines(base=_DEFAULT_BASE):
    """List all registered pipelines by scanning pipelines.d/. Returns list of dicts.

    Silently skips files with malformed JSON.
    """
    d = _registry_dir(base)
    results = []
    for fname in sorted(os.listdir(d)):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(d, fname)
        try:
            with open(fpath) as f:
                data = json.load(f)
            results.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return results


def get_pipeline(run_id, base=_DEFAULT_BASE):
    """Get a single pipeline entry by run_id. Returns None if not found."""
    path = _pipeline_path(run_id, base=base)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def reconcile_stale(base=_DEFAULT_BASE):
    """Check PID liveness for running pipelines and mark dead ones as stale.

    Scans all registered pipelines. For each with status "running", checks
    whether the PID is still alive using os.kill(pid, 0). If the process is
    dead, updates the pipeline status to "failed" with a note field
    "stale - process not running".

    Skips processes that exist but are owned by another user (EPERM).
    Silently skips entries without a pid field.

    Returns a list of run_ids that were marked as stale.
    """
    stale_ids = []
    for entry in list_pipelines(base=base):
        if entry.get("status") != "running":
            continue
        pid = entry.get("pid")
        if pid is None:
            continue
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pass  # Process does not exist — fall through to mark stale
        except OSError as e:
            if e.errno == errno.EPERM:
                continue  # Process exists but owned by another user — skip
            # Other OS errors — fall through to mark stale
        else:
            continue  # Process is alive — skip

        # Process is dead — mark as stale
        run_id = entry["run_id"]
        path = _pipeline_path(run_id, base=base)
        entry["status"] = "failed"
        entry["note"] = "stale - process not running"
        entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        _atomic_write(path, entry)
        stale_ids.append(run_id)
    return stale_ids
