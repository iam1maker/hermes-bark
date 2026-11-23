"""Bark platform adapter: send-only (APNs push), no inbound stream.

Registered through ``PluginContext.register_platform`` so the four delivery
surfaces work without the model in the loop:

* cron ``deliver=bark`` (``cron_deliver_env_var="BARK_HOME_CHANNEL"``)
* ``hermes send --to bark[:device]``
* the in-session ``send_message`` tool (registry routing)
* ``BarkAdapter.send()`` when a gateway is resident

``connect()`` only validates configuration: Bark has no receive side, so there
is no stream to start and no reconnect to schedule.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

try:
    import httpx  # noqa: F401  (dependency probe + push transport)
    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover - httpx ships with Hermes
    HTTPX_AVAILABLE = False

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.send_targets import parse_nonempty
from gateway.platforms._shared import get_scoped_secret, seed_extra_from_env, send_error

try:  # package import (plugin loader)
    from . import events
    from .bark_client import MAX_BODY, build_payload, dedupe_id, looks_like_key, push, validate_image_url
    from .settings import Settings, TargetError, load_settings, secret
except ImportError:  # direct-path import (tests)
    import events  # type: ignore
    from bark_client import MAX_BODY, build_payload, dedupe_id, looks_like_key, push, validate_image_url
    from settings import Settings, TargetError, load_settings, secret

logger = logging.getLogger(__name__)

# ``metadata`` keys a caller may pass through to the Bark payload.
_SEND_META_KEYS = ("title", "subtitle", "level", "sound", "icon", "group", "ttl", "url", "badge", "copy")


def check_requirements() -> bool:
    """PASSIVE probe: dependency importable. Configuration is validate_config's job."""
    return HTTPX_AVAILABLE


def validate_config(config: Any) -> bool:
    return load_settings(getattr(config, "extra", {}) or {}).configured


def is_connected(config: Any) -> bool:
    return load_settings(getattr(config, "extra", {}) or {}).configured


def _media_urls(media_files: Optional[list]) -> tuple[list[str], list[str]]:
    """Split media into (public URLs, local paths Bark cannot fetch)."""
    urls: list[str] = []
    local: list[str] = []
    for item in media_files or []:
        value = str(item or "").strip()
        if not value:
            continue
        if value.lower().startswith(("http://", "https://")):
            urls.append(value)
        else:
            local.append(value)
    return urls, local


class BarkAdapter(BasePlatformAdapter):
    """Send-only adapter: one HTTP POST per notification."""

    MAX_MESSAGE_LENGTH = MAX_BODY

    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform("bark"))
        self._settings: Settings = load_settings(getattr(config, "extra", {}) or {})

    # -- lifecycle ---------------------------------------------------------

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not self._settings.configured:
            logger.error(
                "[bark] no device key: set BARK_TOKEN (or devices.<alias>.key_env) via `hermes config set`")
            return False
        logger.info("[bark] send-only adapter ready: server=%s devices=%s",
                    self._settings.server, ",".join(self._settings.devices))
        return True

    async def disconnect(self) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        try:
            alias, _key = self._settings.resolve(chat_id)
        except TargetError:
            alias = chat_id
        return {"name": alias, "type": "dm"}

    # -- send --------------------------------------------------------------

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[dict[str, Any]] = None) -> SendResult:
        overrides = {k: v for k, v in (metadata or {}).items() if k in _SEND_META_KEYS}
        return await self._deliver(chat_id, body=content, overrides=overrides)

    async def send_image(self, chat_id: str, image_url: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None,
                         metadata: Optional[dict[str, Any]] = None) -> SendResult:
        problem = validate_image_url(image_url, allow_private=self._settings.allow_private_image_urls)
        if problem:
            return SendResult(
                success=False, error_kind="bad_format",
                error=f"{problem} — Bark renders image URLs server-side and takes no uploads")
        overrides = {k: v for k, v in (metadata or {}).items() if k in _SEND_META_KEYS}
        overrides["image"] = image_url
        return await self._deliver(chat_id, body=caption or "", overrides=overrides)

    async def _deliver(self, chat_id: str, *, body: str, overrides: dict) -> SendResult:
        try:
            alias, key = self._settings.resolve(chat_id)
        except TargetError as exc:
            return SendResult(success=False, error=str(exc), error_kind="bad_format")

        fields = dict(self._settings.defaults or {})
        fields.update({k: v for k, v in overrides.items() if v is not None})
        fields["body"] = body
        fields.setdefault("title", self._settings.title)
        if self._settings.dedupe and "id" not in fields:
            fields["id"] = dedupe_id(alias, body or "")

        try:
            payload = build_payload(**fields)
        except ValueError as exc:
            return SendResult(success=False, error=str(exc), error_kind="bad_format")

        result = await push(self._settings.server, key, payload, proxy=self._settings.proxy)
        ok = not result.get("error")
        events.record(
            source="send", ok=ok, alias=alias, body=body,
            title=str(fields.get("title") or payload.get("title") or ""),
            error=str(result.get("error") or ""), status=result.get("status"),
            latency_ms=result.get("latency_ms"), message_id=str(result.get("message_id") or ""),
        )
        if result.get("error"):
            return SendResult(success=False, error=result["error"],
                              error_kind=result.get("error_kind"), retryable=bool(result.get("retryable")))
        return SendResult(success=True, message_id=result.get("message_id") or None,
                          raw_response={**result, "device": alias})


# -- plugin registration ---------------------------------------------------


def _env_enablement() -> Optional[dict]:
    """Seed ``platforms.bark.extra`` from env so env-only setups show in ``gateway status``."""
    if not secret("BARK_TOKEN"):
        return None
    seed = seed_extra_from_env(
        (("BARK_SERVER", "server", lambda v: v.rstrip("/")),),
        home_env="BARK_HOME_CHANNEL", home_default="default",
    )
    return seed or None


async def _standalone_send(pconfig: Any, chat_id: str, message: str, *,
                           thread_id: Optional[str] = None,
                           media_files: Optional[list] = None,
                           force_document: bool = False) -> dict:
    """Out-of-process delivery (cron tick, ``hermes send``) with no live adapter."""
    settings = load_settings(getattr(pconfig, "extra", {}) or {})
    if not settings.configured:
        return send_error("Bark is not configured: set BARK_TOKEN via `hermes config set`",
                          nothing_sent=True)
    try:
        alias, key = settings.resolve(chat_id)
    except TargetError as exc:
        return send_error(str(exc), nothing_sent=True)

    urls, local = _media_urls(media_files)
    fields = dict(settings.defaults or {})
    fields["body"] = message
    fields.setdefault("title", settings.title)
    media_skipped: list[str] = []
    if urls:
        problem = validate_image_url(urls[0], allow_private=settings.allow_private_image_urls)
        if problem:
            media_skipped.append(urls[0])
        else:
            fields["image"] = urls[0]
    if local:
        media_skipped.extend(local)
    if settings.dedupe and "id" not in fields:
        fields["id"] = dedupe_id(alias, message or "")

    try:
        payload = build_payload(**fields)
    except ValueError as exc:
        return send_error(str(exc), nothing_sent=True)

    result = await push(settings.server, key, payload, timeout=10.0, attempts=3, proxy=settings.proxy)
    if result.get("error"):
        return {"error": result["error"], "media_skipped": media_skipped} if media_skipped \
            else send_error(result["error"], nothing_sent=bool(result.get("retryable")))
    out = {"success": True, "platform": "bark", "chat_id": alias,
           "message_id": result.get("message_id") or "", "queued": True}
    if media_skipped:
        out["media_skipped"] = media_skipped
    return out


def register(ctx) -> None:
    """Plugin entry point (``plugin.yaml`` -> ``__init__.py:register``)."""
    ctx.register_platform(
        name="bark",
        label="Bark",
        adapter_factory=lambda cfg: BarkAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=["BARK_TOKEN"],
        install_hint="pip install httpx   # already a Hermes dependency",
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="BARK_HOME_CHANNEL",
        standalone_sender_fn=_standalone_send,
        target_ref_syntax_fn=parse_nonempty,
        max_message_length=MAX_BODY,
        emoji="🔔",
        pii_safe=True,             # device aliases only; keys never reach transcripts
        allow_update_command=False,  # one-way channel: no inbound command surface
        platform_hint=(
            "This session is delivered over Bark as a one-way iOS push. The recipient cannot reply "
            "here; a 200 from the Bark server means the notification was queued to APNs, not that "
            "it was seen."),
        dashboard_label="Bark",
        dashboard_description="Push agent notifications to iPhone/iPad through Bark (bark.day.app or self-hosted).",
        docs_url="https://bark.day.app/#/",
        dashboard_required_env=("BARK_TOKEN",),
    )
    from .tools import register_tools
    from .notify import register_hooks
    from .cli import register as register_cli

    register_tools(ctx)
    register_hooks(ctx)
    register_cli(ctx)
    try:
        from pathlib import Path

        ctx.register_skill(
            "bark-notify",
            Path(__file__).with_name("skills") / "bark-notify" / "SKILL.md",
            description=("Push iOS notifications through Bark: parameters, limits, and when a "
                         "notification is worth sending."),
        )
    except Exception:  # noqa: BLE001 — a missing skill must not disable the channel
        logger.debug("[bark] skill registration failed", exc_info=True)
