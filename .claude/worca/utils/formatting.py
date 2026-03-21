"""Human-readable formatting utilities."""


def format_bytes(n: int) -> str:
    """Convert byte count to human-readable string (e.g. '1.5 KB', '3.2 MB')."""
    if n < 0:
        raise ValueError(f"format_bytes requires a non-negative integer, got {n}")
    if n < 1024:
        return f"{n} B"
    value = float(n)
    for unit in ("KB", "MB", "GB", "TB", "PB"):
        value /= 1024
        if value < 1024 or unit == "PB":
            return f"{value:.1f} {unit}"
    return f"{value:.1f} PB"
