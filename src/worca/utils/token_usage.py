"""Token usage extraction, aggregation, and cost estimation utilities.

Provides functions to extract token usage from Claude CLI result events,
aggregate usage across iterations/stages, and estimate costs from pricing tables.
"""

import sys
from typing import Optional

from worca.utils.settings import load_settings

_warned_aliases: set[str] = set()


def extract_token_usage(
    raw_envelope: dict,
    settings_path: Optional[str] = None,
) -> dict:
    """Extract a normalized token_usage dict from a Claude CLI result event.

    Pulls token fields from raw_envelope["usage"] and top-level fields
    like total_cost_usd, duration_ms, num_turns.

    Args:
        raw_envelope: The full result event dict from Claude CLI.
        settings_path: Optional path to settings.json for alias pricing lookup.

    Returns:
        A dict with normalized token usage fields. Missing fields default to 0.
    """
    if not isinstance(raw_envelope, dict):
        return _empty_token_usage()

    usage = raw_envelope.get("usage") or {}
    server_tool_use = usage.get("server_tool_use") or {}
    cache_creation = usage.get("cache_creation") or {}

    _duration_ms = raw_envelope.get("duration_ms", 0) or 0
    _duration_api_ms = raw_envelope.get("duration_api_ms", 0) or 0

    result = {
        "input_tokens": usage.get("input_tokens", 0) or 0,
        "output_tokens": usage.get("output_tokens", 0) or 0,
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens", 0) or 0,
        "cache_read_input_tokens": usage.get("cache_read_input_tokens", 0) or 0,
        "total_cost_usd": raw_envelope.get("total_cost_usd", 0) or 0,
        "duration_ms": _duration_ms,
        "duration_api_ms": _duration_api_ms,
        "num_turns": raw_envelope.get("num_turns", 0) or 0,
        "model": raw_envelope.get("_resolved_model") or raw_envelope.get("model", ""),
        "web_search_requests": server_tool_use.get("web_search_requests", 0) or 0,
        "web_fetch_requests": server_tool_use.get("web_fetch_requests", 0) or 0,
        "cache_ephemeral_1h_tokens": cache_creation.get("ephemeral_1h_input_tokens", 0) or 0,
        "cache_ephemeral_5m_tokens": cache_creation.get("ephemeral_5m_input_tokens", 0) or 0,
        "speed": usage.get("speed", "") or "",
        "context_final_pct": None,
        # W-074 API-throttling/retry signal. api_retries / api_retry_wait_ms are
        # the precise count and Σ backoff-window wall span (from claude_cli's
        # stderr tee). non_api_wait_ms is the coarse wall-vs-api delta (folds in
        # local tool execution too). api_error_status is the CLI's final API
        # HTTP status (null on success). All additive — 0/null on legacy runs.
        "api_retries": raw_envelope.get("api_retries", 0) or 0,
        "api_retry_wait_ms": raw_envelope.get("api_retry_wait_ms", 0) or 0,
        "non_api_wait_ms": max(0, _duration_ms - _duration_api_ms),
        "api_error_status": raw_envelope.get("api_error_status"),
    }

    model_alias = raw_envelope.get("_model_alias")
    final_context_pct = raw_envelope.get("_final_context_pct")
    if final_context_pct is not None and not model_alias:
        result["context_final_pct"] = final_context_pct

    if model_alias:
        result["model_alias"] = model_alias
        if settings_path:
            pricing_table = load_pricing(settings_path)
            pricing_entry = pricing_table.get(model_alias)
            if pricing_entry is not None:
                settings = load_settings(settings_path)
                server_tools_pricing = (
                    settings.get("worca", {}).get("pricing", {}).get("server_tools")
                )
                result["total_cost_usd"] = estimate_cost(
                    result, pricing_entry, server_tools_pricing
                )
            else:
                result["total_cost_usd"] = 0
                if model_alias not in _warned_aliases:
                    _warned_aliases.add(model_alias)
                    print(
                        f"worca: no pricing entry for alias '{model_alias}' — cost recorded as $0. "
                        f"Add worca.pricing.models.{model_alias} to settings.json.",
                        file=sys.stderr,
                    )
            result["cost_source"] = "alias"

    return result


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
        "web_search_requests": 0,
        "web_fetch_requests": 0,
        "cache_ephemeral_1h_tokens": 0,
        "cache_ephemeral_5m_tokens": 0,
        "speed": "",
        "context_final_pct": None,
        "api_retries": 0,
        "api_retry_wait_ms": 0,
        "non_api_wait_ms": 0,
        "api_error_status": None,
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
    "web_search_requests",
    "web_fetch_requests",
    "cache_ephemeral_1h_tokens",
    "cache_ephemeral_5m_tokens",
    "api_retries",
    "api_retry_wait_ms",
    "non_api_wait_ms",
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
        model = usage.get("model_alias") or usage.get("model", "") or "unknown"
        if model not in by_model:
            by_model[model] = {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
                "cost_usd": 0,
                "num_turns": 0,
                "invocations": 0,
                "web_search_requests": 0,
                "web_fetch_requests": 0,
            }
        entry = by_model[model]
        entry["input_tokens"] += usage.get("input_tokens", 0) or 0
        entry["output_tokens"] += usage.get("output_tokens", 0) or 0
        entry["cache_creation_input_tokens"] += usage.get("cache_creation_input_tokens", 0) or 0
        entry["cache_read_input_tokens"] += usage.get("cache_read_input_tokens", 0) or 0
        entry["cost_usd"] += usage.get("total_cost_usd", 0) or 0
        entry["num_turns"] += usage.get("num_turns", 0) or 0
        entry["invocations"] += 1
        entry["web_search_requests"] += usage.get("web_search_requests", 0) or 0
        entry["web_fetch_requests"] += usage.get("web_fetch_requests", 0) or 0

    return by_model


def estimate_cost(
    token_usage: dict,
    pricing: dict,
    server_tools_pricing: Optional[dict] = None,
) -> float:
    """Estimate cost from token counts using a pricing table.

    Used as fallback when total_cost_usd is missing (e.g., interrupted runs).

    Args:
        token_usage: Dict with input_tokens, output_tokens, etc.
        pricing: Dict with input_per_mtok, output_per_mtok, etc.
        server_tools_pricing: Optional dict with web_search_per_request, etc.

    Returns:
        Estimated cost in USD.
    """
    input_tokens = token_usage.get("input_tokens", 0) or 0
    output_tokens = token_usage.get("output_tokens", 0) or 0
    cache_read = token_usage.get("cache_read_input_tokens", 0) or 0

    cache_1h = token_usage.get("cache_ephemeral_1h_tokens", 0) or 0
    cache_5m = token_usage.get("cache_ephemeral_5m_tokens", 0) or 0
    cache_creation_total = token_usage.get("cache_creation_input_tokens", 0) or 0

    if cache_1h or cache_5m:
        cache_write_cost = (
            cache_5m * pricing.get("cache_write_per_mtok", 0) / 1_000_000
            + cache_1h * pricing.get("cache_write_1h_per_mtok", pricing.get("cache_write_per_mtok", 0)) / 1_000_000
        )
    else:
        cache_write_cost = cache_creation_total * pricing.get("cache_write_per_mtok", 0) / 1_000_000

    cost = (
        input_tokens * pricing.get("input_per_mtok", 0) / 1_000_000
        + output_tokens * pricing.get("output_per_mtok", 0) / 1_000_000
        + cache_write_cost
        + cache_read * pricing.get("cache_read_per_mtok", 0) / 1_000_000
    )

    if server_tools_pricing:
        web_search = token_usage.get("web_search_requests", 0) or 0
        web_fetch = token_usage.get("web_fetch_requests", 0) or 0
        cost += web_search * server_tools_pricing.get("web_search_per_request", 0)
        cost += web_fetch * server_tools_pricing.get("web_fetch_per_request", 0)

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
