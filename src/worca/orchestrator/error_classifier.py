"""Error classification and circuit breaker state management."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import traceback
from typing import Optional

from worca.utils.claude_cli import _ARG_INLINE_LIMIT
from worca.utils.settings import load_settings

CATEGORY_TRANSIENT = "infra_transient"
CATEGORY_PERMANENT = "infra_permanent"
CATEGORY_LOGIC_STUCK = "logic_stuck"
CATEGORY_ENV_MISSING = "env_missing"
CATEGORY_UNKNOWN = "unknown"

_FALLBACK = {"category": CATEGORY_UNKNOWN, "retriable": False, "classifier_error": True}

_DEFAULT_MODEL = "haiku"
_DEFAULT_MODEL_IDS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-6",
}
_DEFAULT_MAX_CONSECUTIVE = 3
_DEFAULT_BACKOFF = [10, 30, 90]
_HISTORY_CAP = 20
_CACHE_TTL = 300  # 5 minutes

_cache = {}  # key -> (result_dict, timestamp)

_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": [
                CATEGORY_TRANSIENT,
                CATEGORY_PERMANENT,
                CATEGORY_LOGIC_STUCK,
                CATEGORY_ENV_MISSING,
                CATEGORY_UNKNOWN,
            ],
        },
        "retriable": {"type": "boolean"},
        "remediation": {"type": "string"},
        "similar_to_previous": {"type": "boolean"},
        "confidence": {"type": "number"},
    },
    "required": ["category", "retriable", "remediation", "similar_to_previous"],
}


def _read_settings(settings_path: str) -> dict:
    return load_settings(settings_path)


def _get_cb_settings(settings_path: str) -> dict:
    return _read_settings(settings_path).get("worca", {}).get("circuit_breaker", {})


def _resolve_model(shorthand: str) -> str:
    return _DEFAULT_MODEL_IDS.get(shorthand, shorthand)


def _cache_key(error_message: str, stage_name: str) -> str:
    h = hashlib.sha256(f"{stage_name}:{error_message}".encode()).hexdigest()[:16]
    return h


def clear_cache() -> None:
    """Clear the classification cache. Useful for testing."""
    _cache.clear()


def classify_error(
    error_message: str,
    stage_name: str,
    failure_history: list,
    settings_path: str,
) -> dict:
    """Classify an error using Claude haiku.

    Returns a classification dict. On any failure, returns a fallback dict
    with category=unknown and classifier_error=True.
    Results are cached by (stage_name, error_message) for _CACHE_TTL seconds.
    """
    key = _cache_key(error_message, stage_name)
    if key in _cache:
        cached_result, cached_at = _cache[key]
        if time.time() - cached_at < _CACHE_TTL:
            result = dict(cached_result)
            result["from_cache"] = True
            return result
        del _cache[key]

    cb = _get_cb_settings(settings_path)
    model_shorthand = cb.get("classifier_model", _DEFAULT_MODEL)
    model_id = _resolve_model(model_shorthand)

    recent_history = failure_history[-5:] if failure_history else []
    history_str = json.dumps(recent_history, indent=2) if recent_history else "[]"

    prompt = (
        f"Classify this pipeline error for stage '{stage_name}'.\n\n"
        f"Error: {error_message}\n\n"
        f"Recent failure history (last {len(recent_history)} entries):\n{history_str}\n\n"
        "Categories:\n"
        f"- {CATEGORY_TRANSIENT}: temporary infra issue (API rate limit, network timeout)\n"
        f"- {CATEGORY_PERMANENT}: permanent infra issue (auth failure, invalid model ID)\n"
        f"- {CATEGORY_LOGIC_STUCK}: agent logic loop or repeated identical failure\n"
        f"- {CATEGORY_ENV_MISSING}: missing tool/env (no claude CLI, no venv)\n"
        f"- {CATEGORY_UNKNOWN}: cannot determine\n\n"
        "Respond with JSON matching the schema."
    )

    schema_str = json.dumps(_SCHEMA)

    # Offload large prompts to a temp file to avoid E2BIG (ARG_MAX).
    prompt_file = None
    if len(prompt.encode("utf-8", errors="replace")) > _ARG_INLINE_LIMIT:
        fd, prompt_file = tempfile.mkstemp(prefix="worca_classify_", suffix=".md")
        with os.fdopen(fd, "w") as f:
            f.write(prompt)
        cli_prompt = (
            f"Read the file at {prompt_file} and follow ALL instructions in it. "
            f"That file IS your full prompt — process it exactly as written."
        )
    else:
        cli_prompt = prompt

    cmd = [
        "claude",
        "-p", cli_prompt,
        "--model", model_id,
        "--output-format", "json",
        "--json-schema", schema_str,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(f"[circuit-breaker] claude exited {result.returncode}: {result.stderr[:200]}", file=sys.stderr)
            fallback = dict(_FALLBACK)
            fallback["classifier_error_detail"] = result.stderr[:500]
            return fallback
        classified = json.loads(result.stdout)
        _cache[key] = (dict(classified), time.time())
        return classified
    except (subprocess.TimeoutExpired, Exception) as exc:
        print(f"[circuit-breaker] classify_error failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        fallback = dict(_FALLBACK)
        fallback["classifier_error_detail"] = str(exc)
        return fallback
    finally:
        if prompt_file:
            try:
                os.unlink(prompt_file)
            except OSError:
                pass


def init_circuit_breaker_state() -> dict:
    """Return a fresh circuit breaker state dict."""
    return {
        "consecutive_failures": 0,
        "failure_history": [],
        "tripped": False,
    }


def get_circuit_breaker_state(status: dict) -> dict:
    """Get or initialize circuit breaker state from the status dict."""
    if "circuit_breaker" not in status:
        status["circuit_breaker"] = init_circuit_breaker_state()
    return status["circuit_breaker"]


def record_failure(
    status: dict,
    stage: str,
    error: str,
    classification: dict,
) -> None:
    """Record a stage failure into the circuit breaker state."""
    cb = get_circuit_breaker_state(status)
    cb["consecutive_failures"] += 1
    entry = {"stage": stage, "error": error, "classification": classification}
    cb["failure_history"].append(entry)
    if len(cb["failure_history"]) > _HISTORY_CAP:
        cb["failure_history"] = cb["failure_history"][-_HISTORY_CAP:]


def record_success(status: dict) -> None:
    """Reset consecutive failure counter on a successful stage."""
    cb = get_circuit_breaker_state(status)
    cb["consecutive_failures"] = 0


def should_halt(
    status: dict,
    classification: dict,
    settings_path: str,
) -> tuple:
    """Determine whether the circuit breaker should halt the pipeline.

    Returns (halt: bool, reason: str).
    """
    cb = get_circuit_breaker_state(status)
    category = classification.get("category", CATEGORY_UNKNOWN)

    if category in (CATEGORY_PERMANENT, CATEGORY_ENV_MISSING, CATEGORY_LOGIC_STUCK):
        reason = f"Immediate halt: error category is '{category}'"
        return True, reason

    cb_settings = _get_cb_settings(settings_path)
    threshold = cb_settings.get("max_consecutive_failures", _DEFAULT_MAX_CONSECUTIVE)
    consecutive = cb["consecutive_failures"]

    if consecutive >= threshold:
        reason = (
            f"{consecutive} consecutive failures (threshold: {threshold})"
        )
        return True, reason

    return False, ""


def get_retry_delay(attempt: int, settings_path: str) -> Optional[float]:
    """Return backoff delay in seconds for the given retry attempt, or None if exhausted."""
    cb_settings = _get_cb_settings(settings_path)
    backoff = cb_settings.get("transient_retry_backoff_seconds", _DEFAULT_BACKOFF)
    if attempt >= len(backoff):
        return None
    return backoff[attempt]
