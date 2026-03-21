"""Token usage extraction, aggregation, and cost estimation utilities.

Provides functions to extract token usage from Claude CLI result events,
aggregate usage across iterations/stages, and estimate costs from pricing tables.
"""

import json
from typing import Optional

from worca.utils.settings import load_settings


def extract_token_usage(raw_envelope: dict) -> dict:
    """Extract a normalized token_usage dict from a Claude CLI result event.

    Pulls token fields from raw_envelope["usage"] and top-level fields
    like total_cost_usd, duration_ms, num_turns.

    Args:
        raw_envelope: The full result event dict from Claude CLI.

    Returns:
        A dict with normalized token usage fields. Missing fields default to 0.
    """
    if not isinstance(raw_envelope, dict):
        return _empty_token_usage()

    usage = raw_envelope.get("usage") or {}

    return {
        "input_tokens": usage.get("input_tokens", 0) or 0,
        "output_tokens": usage.get("output_tokens", 0) or 0,
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens", 0) or 0,
        "cache_read_input_tokens": usage.get("cache_read_input_tokens", 0) or 0,
        "total_cost_usd": raw_envelope.get("total_cost_usd", 0) or 0,
        "duration_ms": raw_envelope.get("duration_ms", 0) or 0,
        "duration_api_ms": raw_envelope.get("duration_api_ms", 0) or 0,
        "num_turns": raw_envelope.get("num_turns", 0) or 0,
        "model": raw_envelope.get("_resolved_model") or raw_envelope.get("model", ""),
    }


def _empty_token_usage() -> dict:
    """Return a token_usage dict with all fields zeroed."""
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "total_cost_usd": 0,
        "duration_ms": 0,
        "duration_api_ms": 0,
        "num_turns": 0,
        "model": "",
    }


_SUMMABLE_FIELDS = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "total_cost_usd",
    "duration_ms",
    "duration_api_ms",
    "num_turns",
]


def aggregate_token_usage(usages: list[dict]) -> dict:
    """Sum a list of token_usage dicts into a single aggregate.

    Args:
        usages: List of token_usage dicts (as returned by extract_token_usage).

    Returns:
        Aggregate dict with summed numeric fields and iteration_count.
    """
    if not usages:
        result = _empty_token_usage()
        result.pop("model", None)
        result["iteration_count"] = 0
        return result

    totals = {field: 0 for field in _SUMMABLE_FIELDS}
    for usage in usages:
        for field in _SUMMABLE_FIELDS:
            totals[field] += usage.get(field, 0) or 0

    totals["iteration_count"] = len(usages)
    return totals


def aggregate_by_model(usages: list[dict]) -> dict:
    """Group and sum token_usage dicts by model name.

    Args:
        usages: List of token_usage dicts with a "model" field.

    Returns:
        Dict keyed by model name, each value containing summed fields.
    """
    by_model: dict[str, dict] = {}

    for usage in usages:
        model = usage.get("model", "") or "unknown"
        if model not in by_model:
            by_model[model] = {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
                "cost_usd": 0,
                "num_turns": 0,
                "invocations": 0,
            }
        entry = by_model[model]
        entry["input_tokens"] += usage.get("input_tokens", 0) or 0
        entry["output_tokens"] += usage.get("output_tokens", 0) or 0
        entry["cache_creation_input_tokens"] += usage.get("cache_creation_input_tokens", 0) or 0
        entry["cache_read_input_tokens"] += usage.get("cache_read_input_tokens", 0) or 0
        entry["cost_usd"] += usage.get("total_cost_usd", 0) or 0
        entry["num_turns"] += usage.get("num_turns", 0) or 0
        entry["invocations"] += 1

    return by_model


def estimate_cost(token_usage: dict, pricing: dict) -> float:
    """Estimate cost from token counts using a pricing table.

    Used as fallback when total_cost_usd is missing (e.g., interrupted runs).

    Args:
        token_usage: Dict with input_tokens, output_tokens, etc.
        pricing: Dict with input_per_mtok, output_per_mtok, etc.

    Returns:
        Estimated cost in USD.
    """
    input_tokens = token_usage.get("input_tokens", 0) or 0
    output_tokens = token_usage.get("output_tokens", 0) or 0
    cache_creation = token_usage.get("cache_creation_input_tokens", 0) or 0
    cache_read = token_usage.get("cache_read_input_tokens", 0) or 0

    cost = (
        input_tokens * pricing.get("input_per_mtok", 0) / 1_000_000
        + output_tokens * pricing.get("output_per_mtok", 0) / 1_000_000
        + cache_creation * pricing.get("cache_write_per_mtok", 0) / 1_000_000
        + cache_read * pricing.get("cache_read_per_mtok", 0) / 1_000_000
    )
    return cost


def load_pricing(settings_path: str = ".claude/settings.json") -> dict:
    """Load pricing config from settings (with .local.json merge support).

    Returns:
        Dict with model-specific pricing. Returns empty dict on error.
    """
    try:
        settings = load_settings(settings_path)
        return settings.get("worca", {}).get("pricing", {}).get("models", {})
    except Exception:
        return {}


def get_model_pricing(model: str, pricing: dict) -> Optional[dict]:
    """Get pricing for a specific model from the pricing table.

    Matches by checking if any pricing key is a substring of the model name
    (e.g., "opus" matches "claude-opus-4-20250514").

    Args:
        model: Full model identifier string.
        pricing: Dict from load_pricing().

    Returns:
        Pricing dict for the model, or None if not found.
    """
    if not model or not pricing:
        return None
    model_lower = model.lower()
    for key, rates in pricing.items():
        if key.lower() in model_lower:
            return rates
    return None
