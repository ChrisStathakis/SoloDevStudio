"""Resolve opencode model references for headless `opencode run`.

`opencode run --model` requires `provider/model`, but presets and automation
forms historically accepted bare slugs ("muse-spark-1.3-...") or even display
labels ("Hy3 Free"). Passing those through verbatim makes the CLI die in ~2s
with `Error: Invalid model reference` — which the old runner then disguised
as a 15-minute timeout. This module maps bare slugs to `provider/model` via
`opencode models` (cached; the command takes ~0.3s) and produces actionable
errors for anything unresolvable, so the runner can fail fast with the real
reason instead of polling a dead process.
"""
from __future__ import annotations

import subprocess
import threading
import time

CACHE_TTL_SECONDS = 600

_lock = threading.Lock()
_items: list[str] = []
_at: float = 0.0


def _load_from_cli() -> list[str]:
    # NOTE: `opencode` on Windows is an npm `.cmd` shim, which CreateProcess
    # cannot launch directly (FileNotFoundError) — go through cmd.exe.
    # The command string is fully fixed (no user input), so shell=True is safe.
    proc = subprocess.run(
        'opencode models',
        capture_output=True, text=True, timeout=15, shell=True,
    )
    out = (proc.stdout or '').strip()
    if proc.returncode != 0 or not out:
        return []
    seen: dict[str, None] = {}
    for line in out.splitlines():
        slug = line.strip()
        # Real entries look like `provider/model`; skip headers/blank lines.
        if not slug or '/' not in slug:
            continue
        if all(ch.isalnum() or ch in '/._-:' for ch in slug):
            seen.setdefault(slug, None)
    return sorted(seen)


def list_models(force_refresh: bool = False) -> list[str]:
    """Cached `opencode models` output. Never raises: [] means unavailable."""
    global _items, _at
    with _lock:
        if not force_refresh and _items and (time.time() - _at) < CACHE_TTL_SECONDS:
            return list(_items)
    try:
        fresh = _load_from_cli()
    except Exception:
        fresh = []
    with _lock:
        if fresh:
            _items = fresh
            _at = time.time()
            return list(_items)
        # Keep serving stale data rather than failing callers outright.
        return list(_items)


def resolve_from_items(raw: str, items: list[str]) -> tuple[str, str | None]:
    """Map a user-typed value to `provider/model`.

    Returns (resolved, error). Empty/default resolves to '' (flag omitted).
    Fully-qualified `provider/model` values pass through untouched so custom
    providers keep working even when absent from the cached list.
    """
    value = (raw or '').strip()
    if not value or value.lower() == 'default':
        return '', None
    lowered = value.lower()
    for item in items:
        if item.lower() == lowered:
            return item, None  # canonical casing
    if '/' in value:
        return value, None
    slug = lowered
    candidates = [item for item in items if item.split('/')[-1].lower() == slug]
    if len(candidates) == 1:
        return candidates[0], None
    if len(candidates) > 1:
        shown = ', '.join(candidates[:5])
        return '', (
            f"Ambiguous model '{value}': matches {shown}. "
            'Use the full provider/model reference.'
        )
    return '', (
        f"Unknown opencode model '{value}'. The command needs provider/model, "
        'e.g. opencode/muse-spark-1.3-contributor-free — pick one from the model list.'
    )


def resolve_model(raw: str, items: list[str] | None = None) -> tuple[str, str | None]:
    """Resolve, loading the cached model list unless items are supplied.

    When the list is unavailable (binary missing), passes the raw value
    through so offline/test environments never hard-fail on validation.
    """
    available = list(items) if items is not None else list_models()
    if not available and items is None:
        return (raw or '').strip(), None
    return resolve_from_items(raw, available)
