"""Tests for token_usage extraction and aggregation (W-035 plan sections 1a, 1b)."""

import json
import os

from worca.utils.token_usage import (
    _SUMMABLE_FIELDS,
    _empty_token_usage,
    aggregate_by_model,
    aggregate_token_usage,
    estimate_cost,
    extract_token_usage,
    get_model_pricing,
)


# ---------------------------------------------------------------------------
# extract_token_usage — existing fields still work
# ---------------------------------------------------------------------------


def test_extract_basic_fields():
    envelope = {
        "usage": {
            "input_tokens": 100,
            "output_tokens": 200,
            "cache_creation_input_tokens": 50,
            "cache_read_input_tokens": 25,
        },
        "total_cost_usd": 0.05,
        "duration_ms": 1000,
        "duration_api_ms": 800,
        "num_turns": 3,
        "model": "claude-sonnet-4-6",
    }
    result = extract_token_usage(envelope)
    assert result["input_tokens"] == 100
    assert result["output_tokens"] == 200
    assert result["cache_creation_input_tokens"] == 50
    assert result["cache_read_input_tokens"] == 25
    assert result["total_cost_usd"] == 0.05
    assert result["duration_ms"] == 1000
    assert result["duration_api_ms"] == 800
    assert result["num_turns"] == 3
    assert result["model"] == "claude-sonnet-4-6"


def test_extract_non_dict_returns_empty():
    assert extract_token_usage(None) == _empty_token_usage()
    assert extract_token_usage("bad") == _empty_token_usage()
    assert extract_token_usage(42) == _empty_token_usage()


# ---------------------------------------------------------------------------
# extract_token_usage — new fields (W-035 section 1a)
# ---------------------------------------------------------------------------


def test_extract_web_search_requests():
    envelope = {
        "usage": {
            "input_tokens": 10,
            "output_tokens": 20,
            "server_tool_use": {
                "web_search_requests": 3,
                "web_fetch_requests": 1,
            },
        }
    }
    result = extract_token_usage(envelope)
    assert result["web_search_requests"] == 3
    assert result["web_fetch_requests"] == 1


def test_extract_web_requests_missing_defaults_to_zero():
    envelope = {"usage": {"input_tokens": 10, "output_tokens": 5}}
    result = extract_token_usage(envelope)
    assert result["web_search_requests"] == 0
    assert result["web_fetch_requests"] == 0


def test_extract_web_requests_null_server_tool_use():
    envelope = {"usage": {"server_tool_use": None}}
    result = extract_token_usage(envelope)
    assert result["web_search_requests"] == 0
    assert result["web_fetch_requests"] == 0


def test_extract_cache_ephemeral_tokens():
    envelope = {
        "usage": {
            "cache_creation": {
                "ephemeral_1h_input_tokens": 56131,
                "ephemeral_5m_input_tokens": 1000,
            }
        }
    }
    result = extract_token_usage(envelope)
    assert result["cache_ephemeral_1h_tokens"] == 56131
    assert result["cache_ephemeral_5m_tokens"] == 1000


def test_extract_cache_ephemeral_missing_defaults_to_zero():
    envelope = {"usage": {}}
    result = extract_token_usage(envelope)
    assert result["cache_ephemeral_1h_tokens"] == 0
    assert result["cache_ephemeral_5m_tokens"] == 0


def test_extract_cache_ephemeral_null_cache_creation():
    envelope = {"usage": {"cache_creation": None}}
    result = extract_token_usage(envelope)
    assert result["cache_ephemeral_1h_tokens"] == 0
    assert result["cache_ephemeral_5m_tokens"] == 0


def test_extract_speed():
    envelope = {"usage": {"speed": "standard"}}
    result = extract_token_usage(envelope)
    assert result["speed"] == "standard"


def test_extract_speed_missing_defaults_to_empty_string():
    envelope = {"usage": {}}
    result = extract_token_usage(envelope)
    assert result["speed"] == ""


def test_extract_full_envelope_with_all_new_fields():
    """Mirror the example JSON from the plan doc."""
    envelope = {
        "usage": {
            "input_tokens": 14,
            "cache_creation_input_tokens": 56131,
            "cache_read_input_tokens": 489722,
            "output_tokens": 9229,
            "server_tool_use": {
                "web_search_requests": 5,
                "web_fetch_requests": 2,
            },
            "cache_creation": {
                "ephemeral_1h_input_tokens": 56131,
                "ephemeral_5m_input_tokens": 0,
            },
            "speed": "fast",
        },
        "total_cost_usd": 0.826,
        "duration_ms": 12000,
        "duration_api_ms": 11000,
        "num_turns": 7,
        "_resolved_model": "claude-opus-4-6",
    }
    result = extract_token_usage(envelope)
    assert result["input_tokens"] == 14
    assert result["cache_creation_input_tokens"] == 56131
    assert result["cache_read_input_tokens"] == 489722
    assert result["output_tokens"] == 9229
    assert result["web_search_requests"] == 5
    assert result["web_fetch_requests"] == 2
    assert result["cache_ephemeral_1h_tokens"] == 56131
    assert result["cache_ephemeral_5m_tokens"] == 0
    assert result["speed"] == "fast"
    assert result["model"] == "claude-opus-4-6"


# ---------------------------------------------------------------------------
# _empty_token_usage — new fields present (W-035 section 1a)
# ---------------------------------------------------------------------------


def test_empty_token_usage_has_new_fields():
    empty = _empty_token_usage()
    assert "web_search_requests" in empty
    assert "web_fetch_requests" in empty
    assert "cache_ephemeral_1h_tokens" in empty
    assert "cache_ephemeral_5m_tokens" in empty
    assert "speed" in empty
    assert empty["web_search_requests"] == 0
    assert empty["web_fetch_requests"] == 0
    assert empty["cache_ephemeral_1h_tokens"] == 0
    assert empty["cache_ephemeral_5m_tokens"] == 0
    assert empty["speed"] == ""


# ---------------------------------------------------------------------------
# extract_token_usage — API-throttling/retry fields (W-074 §3)
# ---------------------------------------------------------------------------


def test_token_usage_carries_retry_fields():
    envelope = {
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "duration_ms": 5000,
        "duration_api_ms": 1200,
        "api_retries": 3,
        "api_retry_wait_ms": 1042310,
        "api_error_status": 529,
    }
    result = extract_token_usage(envelope)
    assert result["api_retries"] == 3
    assert result["api_retry_wait_ms"] == 1042310
    # non_api_wait_ms = max(0, duration_ms - duration_api_ms)
    assert result["non_api_wait_ms"] == 3800
    assert result["api_error_status"] == 529


def test_token_usage_retry_fields_default_on_legacy_envelope():
    """Legacy envelopes (no retry fields) default to 0 / None — additive."""
    envelope = {
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "duration_ms": 1000,
        "duration_api_ms": 1000,
    }
    result = extract_token_usage(envelope)
    assert result["api_retries"] == 0
    assert result["api_retry_wait_ms"] == 0
    assert result["non_api_wait_ms"] == 0
    assert result["api_error_status"] is None


def test_token_usage_non_api_wait_ms_never_negative():
    """duration_api_ms > duration_ms (clock skew) clamps non_api_wait_ms to 0."""
    envelope = {"duration_ms": 100, "duration_api_ms": 500}
    result = extract_token_usage(envelope)
    assert result["non_api_wait_ms"] == 0


def test_empty_token_usage_has_retry_fields():
    empty = _empty_token_usage()
    assert empty["api_retries"] == 0
    assert empty["api_retry_wait_ms"] == 0
    assert empty["non_api_wait_ms"] == 0
    assert empty["api_error_status"] is None


# ---------------------------------------------------------------------------
# _SUMMABLE_FIELDS — new summable fields (W-035 section 1b)
# ---------------------------------------------------------------------------


def test_summable_fields_include_new_fields():
    assert "web_search_requests" in _SUMMABLE_FIELDS
    assert "web_fetch_requests" in _SUMMABLE_FIELDS
    assert "cache_ephemeral_1h_tokens" in _SUMMABLE_FIELDS
    assert "cache_ephemeral_5m_tokens" in _SUMMABLE_FIELDS


def test_summable_fields_speed_not_included():
    assert "speed" not in _SUMMABLE_FIELDS


# ---------------------------------------------------------------------------
# aggregate_token_usage — sums new fields
# ---------------------------------------------------------------------------


def test_aggregate_sums_web_search_requests():
    usages = [
        {**_empty_token_usage(), "web_search_requests": 3, "web_fetch_requests": 1},
        {**_empty_token_usage(), "web_search_requests": 2, "web_fetch_requests": 4},
    ]
    result = aggregate_token_usage(usages)
    assert result["web_search_requests"] == 5
    assert result["web_fetch_requests"] == 5


def test_aggregate_sums_cache_ephemeral_tokens():
    usages = [
        {**_empty_token_usage(), "cache_ephemeral_1h_tokens": 1000, "cache_ephemeral_5m_tokens": 500},
        {**_empty_token_usage(), "cache_ephemeral_1h_tokens": 2000, "cache_ephemeral_5m_tokens": 300},
    ]
    result = aggregate_token_usage(usages)
    assert result["cache_ephemeral_1h_tokens"] == 3000
    assert result["cache_ephemeral_5m_tokens"] == 800


def test_aggregate_missing_new_fields_treated_as_zero():
    """Old-format usages without the new fields should still aggregate correctly."""
    usages = [
        {"input_tokens": 100, "output_tokens": 50, "cache_creation_input_tokens": 0,
         "cache_read_input_tokens": 0, "total_cost_usd": 0.1, "duration_ms": 500,
         "duration_api_ms": 400, "num_turns": 1},
        {"input_tokens": 200, "output_tokens": 80, "cache_creation_input_tokens": 0,
         "cache_read_input_tokens": 0, "total_cost_usd": 0.2, "duration_ms": 600,
         "duration_api_ms": 500, "num_turns": 2},
    ]
    result = aggregate_token_usage(usages)
    assert result["web_search_requests"] == 0
    assert result["web_fetch_requests"] == 0
    assert result["cache_ephemeral_1h_tokens"] == 0
    assert result["cache_ephemeral_5m_tokens"] == 0


def test_aggregate_empty_list_has_new_fields():
    result = aggregate_token_usage([])
    assert result["web_search_requests"] == 0
    assert result["web_fetch_requests"] == 0
    assert result["cache_ephemeral_1h_tokens"] == 0
    assert result["cache_ephemeral_5m_tokens"] == 0


# ---------------------------------------------------------------------------
# aggregate_by_model — new fields
# ---------------------------------------------------------------------------


def test_aggregate_by_model_includes_web_requests():
    usages = [
        {**_empty_token_usage(), "model": "claude-opus-4-6",
         "web_search_requests": 3, "web_fetch_requests": 1},
        {**_empty_token_usage(), "model": "claude-opus-4-6",
         "web_search_requests": 2, "web_fetch_requests": 0},
    ]
    result = aggregate_by_model(usages)
    opus = result["claude-opus-4-6"]
    assert opus["web_search_requests"] == 5
    assert opus["web_fetch_requests"] == 1


def test_aggregate_by_model_web_requests_missing_treated_as_zero():
    usages = [
        {"model": "claude-sonnet-4-6", "input_tokens": 100, "output_tokens": 50,
         "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
         "total_cost_usd": 0.01, "num_turns": 1},
    ]
    result = aggregate_by_model(usages)
    sonnet = result["claude-sonnet-4-6"]
    assert sonnet["web_search_requests"] == 0
    assert sonnet["web_fetch_requests"] == 0


# ---------------------------------------------------------------------------
# estimate_cost — tiered cache pricing (W-035 section 2b)
# ---------------------------------------------------------------------------



_SONNET_PRICING = {
    "input_per_mtok": 3.00,
    "output_per_mtok": 15.00,
    "cache_write_per_mtok": 3.75,
    "cache_write_1h_per_mtok": 6.00,
    "cache_read_per_mtok": 0.30,
}

_OPUS_PRICING = {
    "input_per_mtok": 5.00,
    "output_per_mtok": 25.00,
    "cache_write_per_mtok": 6.25,
    "cache_write_1h_per_mtok": 10.00,
    "cache_read_per_mtok": 0.50,
}

_HAIKU_PRICING = {
    "input_per_mtok": 0.80,
    "output_per_mtok": 4.00,
    "cache_write_per_mtok": 1.00,
    "cache_write_1h_per_mtok": 1.60,
    "cache_read_per_mtok": 0.08,
}


def test_estimate_cost_basic():
    usage = {"input_tokens": 1_000_000, "output_tokens": 0,
             "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
    cost = estimate_cost(usage, _SONNET_PRICING)
    assert abs(cost - 3.00) < 1e-6


def test_estimate_cost_tiered_cache_uses_1h_rate():
    """When ephemeral breakdown present, 1h tokens use cache_write_1h_per_mtok."""
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 1_000_000,
        "cache_read_input_tokens": 0,
        "cache_ephemeral_1h_tokens": 1_000_000,
        "cache_ephemeral_5m_tokens": 0,
    }
    cost = estimate_cost(usage, _SONNET_PRICING)
    # Should use 1h rate (6.00) not default 5m rate (3.75)
    assert abs(cost - 6.00) < 1e-6


def test_estimate_cost_tiered_cache_mixed():
    """Mixed 1h + 5m tokens use correct per-tier rates."""
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 2_000_000,
        "cache_read_input_tokens": 0,
        "cache_ephemeral_1h_tokens": 1_000_000,
        "cache_ephemeral_5m_tokens": 1_000_000,
    }
    # 1M * $6.00 + 1M * $3.75 = $9.75
    cost = estimate_cost(usage, _SONNET_PRICING)
    assert abs(cost - 9.75) < 1e-6


def test_estimate_cost_fallback_no_ephemeral_breakdown():
    """Without ephemeral breakdown, uses default cache_write_per_mtok (5m rate)."""
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 1_000_000,
        "cache_read_input_tokens": 0,
        # No cache_ephemeral_1h_tokens / cache_ephemeral_5m_tokens
    }
    cost = estimate_cost(usage, _SONNET_PRICING)
    assert abs(cost - 3.75) < 1e-6


def test_estimate_cost_with_server_tools():
    """server_tools_pricing adds per-request costs."""
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "web_search_requests": 3,
        "web_fetch_requests": 1,
    }
    server_tools = {"web_search_per_request": 0.01, "web_fetch_per_request": 0.01}
    cost = estimate_cost(usage, _SONNET_PRICING, server_tools_pricing=server_tools)
    assert abs(cost - 0.04) < 1e-6


def test_estimate_cost_no_server_tools_pricing_ignores_requests():
    """Without server_tools_pricing, web requests don't add cost."""
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "web_search_requests": 10,
        "web_fetch_requests": 10,
    }
    cost = estimate_cost(usage, _SONNET_PRICING)
    assert cost == 0.0


# ---------------------------------------------------------------------------
# settings.json pricing values (W-035 section 2a)
# ---------------------------------------------------------------------------



def _load_src_settings():
    """Load src/worca/settings.json directly (bypasses load_settings file search)."""
    here = os.path.dirname(__file__)
    path = os.path.join(here, "..", "src", "worca", "settings.json")
    with open(path) as f:
        return json.load(f)


def test_settings_opus_pricing_updated():
    s = _load_src_settings()
    opus = s["worca"]["pricing"]["models"]["opus"]
    assert opus["input_per_mtok"] == 5.00
    assert opus["output_per_mtok"] == 25.00
    assert opus["cache_write_per_mtok"] == 6.25
    assert opus["cache_read_per_mtok"] == 0.50


def test_settings_opus_has_cache_write_1h():
    s = _load_src_settings()
    opus = s["worca"]["pricing"]["models"]["opus"]
    assert opus["cache_write_1h_per_mtok"] == 10.00


def test_settings_sonnet_has_cache_write_1h():
    s = _load_src_settings()
    sonnet = s["worca"]["pricing"]["models"]["sonnet"]
    assert sonnet["cache_write_1h_per_mtok"] == 6.00


def test_settings_haiku_pricing_present():
    s = _load_src_settings()
    models = s["worca"]["pricing"]["models"]
    assert "haiku" in models
    haiku = models["haiku"]
    assert haiku["input_per_mtok"] == 0.80
    assert haiku["output_per_mtok"] == 4.00
    assert haiku["cache_write_per_mtok"] == 1.00
    assert haiku["cache_write_1h_per_mtok"] == 1.60
    assert haiku["cache_read_per_mtok"] == 0.08


def test_settings_server_tools_pricing_present():
    s = _load_src_settings()
    st = s["worca"]["pricing"].get("server_tools")
    assert st is not None
    assert st["web_search_per_request"] == 0.01
    assert st["web_fetch_per_request"] == 0.01


def test_get_model_pricing_haiku():
    """get_model_pricing should find haiku pricing by substring match."""
    pricing = {
        "opus": _OPUS_PRICING,
        "sonnet": _SONNET_PRICING,
        "haiku": _HAIKU_PRICING,
    }
    result = get_model_pricing("claude-haiku-4-5-20251001", pricing)
    assert result is not None
    assert result["input_per_mtok"] == 0.80


# ---------------------------------------------------------------------------
# context_final_pct — trust gate (Step 2, W-065)
# ---------------------------------------------------------------------------


def test_extract_context_final_pct_present_when_trusted():
    envelope = {"_final_context_pct": 53.2}
    result = extract_token_usage(envelope)
    assert result["context_final_pct"] == 53.2


def test_extract_context_final_pct_suppressed_for_alt_endpoint():
    envelope = {"_final_context_pct": 53.2, "_model_alias": "glm-ds"}
    result = extract_token_usage(envelope)
    assert "context_final_pct" not in result or result["context_final_pct"] is None


def test_extract_context_final_pct_absent_when_not_in_envelope():
    envelope = {}
    result = extract_token_usage(envelope)
    assert result.get("context_final_pct") is None


def test_empty_token_usage_has_context_final_pct_none():
    assert _empty_token_usage()["context_final_pct"] is None


def test_context_final_pct_not_in_summable_fields():
    assert "context_final_pct" not in _SUMMABLE_FIELDS


def test_aggregate_token_usage_excludes_context_final_pct():
    usages = [
        {**_empty_token_usage(), "context_final_pct": 50.0},
        {**_empty_token_usage(), "context_final_pct": 80.0},
    ]
    result = aggregate_token_usage(usages)
    assert "context_final_pct" not in result or result.get("context_final_pct") is None


# ---------------------------------------------------------------------------
# pricing lookup — tier-prefix regression (W-058 review fix)
# ---------------------------------------------------------------------------


def test_pricing_lookup_bare_alias_hits_table(tmp_path):
    """Bare alias 'glm-ds' as _model_alias resolves pricing correctly."""
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps({
        "worca": {
            "pricing": {
                "models": {
                    "glm-ds": {"input_per_mtok": 3.0, "output_per_mtok": 15.0}
                }
            }
        }
    }))
    envelope = {
        "_model_alias": "glm-ds",
        "usage": {"input_tokens": 1_000_000, "output_tokens": 0},
    }
    result = extract_token_usage(envelope, settings_path=str(settings_file))
    assert result["total_cost_usd"] == 3.0
    assert result.get("cost_source") == "alias"


def test_pricing_lookup_tier_prefixed_alias_misses_table(tmp_path):
    """tier-prefixed alias 'user:glm-ds' does NOT hit the pricing table keyed by 'glm-ds'.

    This test documents the pre-fix behavior: if cost_alias were passed as 'user:glm-ds',
    the lookup would miss and cost would be $0.  After the stages.py fix the prefix is
    stripped before the alias reaches extract_token_usage, so this path no longer occurs
    in production.  The test is kept as a regression guard for the lookup contract.
    """
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps({
        "worca": {
            "pricing": {
                "models": {
                    "glm-ds": {"input_per_mtok": 3.0, "output_per_mtok": 15.0}
                }
            }
        }
    }))
    envelope = {
        "_model_alias": "user:glm-ds",
        "usage": {"input_tokens": 1_000_000, "output_tokens": 0},
    }
    result = extract_token_usage(envelope, settings_path=str(settings_file))
    assert result["total_cost_usd"] == 0
