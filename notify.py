"""Event-driven Bark notifications: turn end, subagent stop.

Disabled by default: a chatty assistant would otherwise push on every turn.
Rules live under ``platforms.bark.extra.notify``.

Caveat the design cannot hide: ``on_session_end`` carries no duration, so
"notify me after long turns" is a heuristic — the elapsed wall clock since the
first LLM call of the turn, tracked from ``pre_llm_call``. Hooks are
observer-only; a missed pre_llm_call degrades the duration, never the turn.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime
from typing import Any, Optional

try:  # package import
    from . import events
    from .bark_client import build_payload, push
    from .settings import Settings, TargetError, load_from_config
except ImportError:  # direct-path import (tests)
    import events  # type: ignore
    from bark_client import build_payload, push
    from settings import Settings, TargetError, load_from_config

logger = logging.getLogger(__name__)

_TURN_START: dict[str, float] = {}
_LAST_SENT: dict[str, float] = {}
_DEBOUNCE_SECONDS = 60.0


def _now() -> float:
    return time.monotonic()


def _minutes(hhmm: str) -> Optional[int]:
    try:
        hour, minute = str(hhmm).split(":")
        return int(hour) * 60 + int(minute)
    except (ValueError, AttributeError):
        return None


def in_quiet_hours(spec: Any, now: Optional[datetime] = None) -> bool:
    """``"23:30-08:00"`` (wraps midnight) or a list of windows."""
    windows = spec if isinstance(spec, (list, tuple)) else [spec] if spec else []
    current = now or datetime.now()
    minute_now = current.hour * 60 + current.minute
    for window in windows:
        if not isinstance(window, str) or "-" not in window:
            continue
        start_s, end_s = window.split("-", 1)
        start, end = _minutes(start_s), _minutes(end_s)
        if start is None or end is None:
            continue
        if start <= end:
            if start <= minute_now < end:
                return True
        elif minute_now >= start or minute_now < end:  # wraps midnight
            return True
    return False


def _schedule(coro) -> None:
    """Run a coroutine without ever blocking or raising into the agent loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        threading.Thread(target=lambda: asyncio.run(_guard(coro)), daemon=True).start()
    else:
        loop.create_task(_guard(coro))


async def _guard(coro) -> None:
    try:
        await coro
    except Exception:  # noqa: BLE001 — a notification must never break a turn
        logger.debug("[bark] notification failed", exc_info=True)


async def _send(settings: Settings, body: str, *, title: str = "",
                level: str = "", group: str = "", device: Optional[str] = None) -> None:
    if not settings.configured:
        return
    if in_quiet_hours((settings.notify or {}).get("quiet_hours")):
        logger.debug("[bark] suppressed by quiet_hours")
        return
    try:
        alias, key = settings.resolve(device)
    except TargetError as exc:
        logger.debug("[bark] %s", exc)
        return
    fields = dict(settings.defaults or {})
    fields.update({"body": body, "title": title or settings.title})
    if level:
        fields["level"] = level
    if group:
        fields["group"] = group
    try:
        payload = build_payload(**fields)
    except ValueError as exc:
        logger.debug("[bark] bad payload: %s", exc)
        return
    result = await push(settings.server, key, payload, timeout=5.0, attempts=1, proxy=settings.proxy)
    ok = bool(result.get("success"))
    events.record(
        source="notify", ok=ok, alias=alias, body=body,
        title=str(fields.get("title") or ""), error=str(result.get("error") or ""),
        status=result.get("status"), latency_ms=result.get("latency_ms"),
        message_id=str(result.get("message_id") or ""),
    )
    if not ok:
        logger.warning("[bark] notify to %s failed: %s", alias, result.get("error"))


_STATUS_KEYS = ("statuses", "only_status", "on")


def _status_filter(rule: dict) -> list:
    """Accept ``statuses`` (canonical), ``only_status``, and ``on``.

    ``on:`` in YAML 1.1 parses to the boolean ``True`` (``off``/``yes``/``no`` too),
    so a rule written as ``on: [completed]`` silently loses its filter. ``statuses``
    is the documented key; the others are tolerated for hand-written configs.
    """
    for key in _STATUS_KEYS:
        value = rule.get(key)
        if isinstance(value, str):
            return [value]
        if isinstance(value, (list, tuple, set)):
            return [str(v) for v in value]
    return []


def _debounced(session_id: str) -> bool:
    now = _now()
    last = _LAST_SENT.get(session_id, 0.0)
    if now - last < _DEBOUNCE_SECONDS:
        return True
    _LAST_SENT[session_id] = now
    return False


# -- hooks -----------------------------------------------------------------


def on_pre_llm_call(**kwargs: Any) -> None:
    """Mark the start of a turn (first LLM call after the previous session end)."""
    session = str(kwargs.get("session_id") or "")
    if session and session not in _TURN_START:
        _TURN_START[session] = _now()


def on_session_end(**kwargs: Any) -> None:
    settings = load_from_config()
    rule = settings.rule("turn_end")
    if not rule.get("enabled"):
        return
    session = str(kwargs.get("session_id") or "")
    status = "failed" if kwargs.get("failed") else "interrupted" if kwargs.get("interrupted") else "completed"
    wanted = _status_filter(rule) or ["failed", "interrupted"]
    if status not in wanted:
        return
    elapsed = _now() - _TURN_START.pop(session, _now())
    if status == "completed" and elapsed < float(rule.get("min_duration_s") or 0):
        return
    if _debounced(session):
        return
    reason = str(kwargs.get("turn_exit_reason") or "")
    detail = "" if reason == status else reason
    body = (f"{status} · {elapsed:.1f}s · {kwargs.get('platform') or 'cli'}\n"
            f"{detail}").strip()
    _schedule(_send(settings, body, title=str(rule.get("title") or ""),
                    level=str(rule.get("level") or ""),
                    group=str(rule.get("group") or ""),
                    device=rule.get("device")))


def on_subagent_stop(**kwargs: Any) -> None:
    settings = load_from_config()
    rule = settings.rule("subagent_stop")
    if not rule.get("enabled"):
        return
    status = str(kwargs.get("child_status") or "completed")
    only = rule.get("only_status")
    if only and status not in only:
        return
    duration_ms = float(kwargs.get("duration_ms") or 0)
    if duration_ms < float(rule.get("min_duration_ms") or 0):
        return
    parent = str(kwargs.get("parent_session_id") or "")
    if parent and _debounced(parent):
        return
    summary = str(kwargs.get("child_summary") or "")[:200]
    body = f"subagent {status} · {duration_ms / 1000:.0f}s\n{summary}".strip()
    _schedule(_send(settings, body, title=str(rule.get("title") or ""),
                    level=str(rule.get("level") or ""),
                    group=str(rule.get("group") or ""),
                    device=rule.get("device")))


def register_hooks(ctx) -> None:
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_hook("subagent_stop", on_subagent_stop)
