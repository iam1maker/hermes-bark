"""Bark notifications — dashboard backend for the desktop settings page.

The renderer calls this router through ``ctx.rest`` (same origin, plugin-scoped
prefix ``/api/plugins/hermes-bark``), never Bark directly, so:

* the device key never enters the renderer — every response is masked;
* a settings edit goes through Hermes' own writer
  (:func:`hermes_cli.plugins_settings.save_plugin_settings`: schema-validated,
  atomic, cross-process locked, rejects secrets), never through a hand-rolled
  YAML edit of the user's config;
* a key edit goes through the credential lifecycle
  (``save_provider_env_credential``: writes the profile's env file and publishes
  the value into the live secret scope), so ``settings.secret()`` sees it at
  once — the plugin itself never reads a dotenv file.

Routes
    GET    /health             liveness only (no network, no config read)
    GET    /status             masked snapshot: settings, devices, server ping, warnings
    GET    /events?limit=      recent delivery attempts (newest first)
    DELETE /events             clear the delivery log
    POST   /settings           {patch: {key: value}} → validated settings write
    POST   /device             {alias, key} → BARK_KEY_<ALIAS> in .env
    DELETE /device/{alias}     remove that credential
    POST   /preview            exact JSON Bark would receive (no send)
    POST   /test               one real push; returns status, latency, payload
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import re
import sys
import time
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Mapping, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

ROUTER_VERSION = "1.0.0"
PLUGIN_ID = "hermes-bark"
PLUGIN_DIR = Path(__file__).resolve().parent.parent

# -- i18n ---------------------------------------------------------------------
# English is the source language: every message below is written in English and
# the Chinese copy lives in ``locales/zh.json`` (English source -> Chinese). The
# renderer asks for a language with ``?lang=``; the same bundle rides along in
# ``/status.strings`` so the page follows the host language without a second
# request. Any language code that is not Chinese falls back to English.

_LANG = ContextVar("bark_lang", default="zh")
_LOCALES = Path(__file__).with_name("locales")
_BUNDLES: dict[str, tuple[float, dict[str, str]]] = {}


def _bundle(lang: str) -> dict[str, str]:
    """Translation bundle for ``lang``; empty for English (the source language)."""
    if not lang or lang == "en":
        return {}
    path = _LOCALES / f"{lang}.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}
    cached = _BUNDLES.get(lang)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    bundle = {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    _BUNDLES[lang] = (mtime, bundle)
    return bundle


async def _lang_dep(request: Request) -> None:
    """Resolve the language for this call.

    Must be ``async``: sync dependencies run in a threadpool copy of the context,
    so a ``ContextVar.set()`` there never reaches the endpoint and every message
    would silently stay Chinese.
    """
    raw = (request.query_params.get("lang") or "").strip().lower()
    # zh / zh-hant / unset -> Chinese; any other language code -> English
    # (matches isChinese() in the renderer).
    _LANG.set("zh" if not raw or raw.startswith("zh") else "en")


def _t(text: str, **fmt: Any) -> str:
    """Localize one message; ``text`` is the English source (and the key)."""
    out = _bundle(_LANG.get()).get(text, text)
    return out.format(**fmt) if fmt else out


router = APIRouter(dependencies=[Depends(_lang_dep)])


# -- module loading ----------------------------------------------------------

_PACKAGE = "hermes_bark_runtime"


def _package() -> str:
    """Register the plugin directory as a namespace package.

    Loading the siblings as a package (rather than by file under bare names)
    keeps their relative imports working and avoids colliding with generic
    top-level names such as ``settings`` or ``events`` in the gateway process.
    The package ``__init__`` is deliberately NOT executed: it registers the
    platform and imports ``gateway.*``, which the dashboard has no business
    triggering on a page read.
    """
    import types

    if _PACKAGE not in sys.modules:
        package = types.ModuleType(_PACKAGE)
        package.__path__ = [str(PLUGIN_DIR)]  # type: ignore[attr-defined]
        package.__package__ = _PACKAGE
        sys.modules[_PACKAGE] = package
    return _PACKAGE


def _load(name: str, filename: str = ""):
    """Import one sibling module inside the plugin package (single instance)."""
    import importlib

    module_name = f"{_package()}.{name}"
    module = sys.modules.get(module_name)
    if module is not None:
        return module
    return importlib.import_module(module_name)


def _client():
    return _load("bark_client")


def _settings():
    return _load("settings")


def _events():
    return _load("events")


def _manifest() -> dict[str, Any]:
    try:
        from utils import fast_safe_load

        return dict(fast_safe_load((PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8-sig")) or {})
    except Exception:  # noqa: BLE001
        return {}


def _schema() -> dict[str, Mapping[str, Any]]:
    try:
        from hermes_cli.plugins_settings import _manifest_config_schema

        return dict(_manifest_config_schema(PLUGIN_DIR) or {})
    except Exception:  # noqa: BLE001
        raw = _manifest().get("config_schema")
        return {str(k): v for k, v in (raw or {}).items() if isinstance(v, Mapping)}


# -- probes ------------------------------------------------------------------

_PING_TTL = 60.0
_ping_cache: dict[str, Any] = {"at": 0.0, "server": "", "proxy": "", "data": None}


async def _ping(server: str, *, fresh: bool = False, proxy: str = "") -> dict[str, Any]:
    now = time.monotonic()
    cached = _ping_cache.get("data")
    if (not fresh and cached and _ping_cache.get("server") == server
            and _ping_cache.get("proxy") == proxy
            and now - float(_ping_cache.get("at") or 0) < _PING_TTL):
        return {**cached, "cached": True}
    data = await _client().ping(server, timeout=3.0, proxy=proxy)
    _ping_cache.update({"at": now, "server": server, "proxy": proxy, "data": data})
    return {**data, "cached": False}


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 4:
        return "••••"
    return "••••" + key[-4:]


def _env_source(name: str) -> str:
    """Where ``name`` resolves from — Hermes' credential scope or the process env."""
    source = _settings().secret_source(name)
    if source == "scope":
        return _t("profile secret scope")
    if source == "env":
        return _t("process environment")
    return ""


def _credential_source(settings: Any) -> str:
    """``scope`` / ``env`` for the config card: where the device keys come from."""
    mod = _settings()
    names = ["BARK_TOKEN"] + [mod.alias_env(alias) for alias in settings.devices]
    found = {mod.secret_source(name) for name in names}
    if "scope" in found:
        return "scope"
    if "env" in found:
        return "env"
    return ""


def _devices(settings: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    extra = _settings().platform_extra()
    declared = extra.get("devices") if isinstance(extra.get("devices"), Mapping) else {}
    misplaced = set(getattr(settings, "misplaced_keys", ()) or ())
    # A refused literal still owns a row: otherwise the key silently vanishes and
    # the user has nothing to point at while fixing config.yaml.
    aliases = list(settings.devices) + sorted(a for a in misplaced if a not in settings.devices)
    for alias in aliases:
        key = settings.devices.get(alias, "")
        env_name = _settings().alias_env(alias)
        rows.append({
            "alias": alias,
            "masked": _mask(key) if key else "",
            "is_default": alias == settings.default_device,
            "env": env_name,
            "misplaced": alias in misplaced,
            "where": _env_source(env_name) if key else "",
            "from_extra": alias in declared,
        })
    rows.sort(key=lambda row: (not row["is_default"], row["alias"]))
    return rows


def _warnings(settings: Any, ping: Optional[dict[str, Any]] = None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    server = settings.server
    if not settings.devices:
        out.append({"level": "error", "text": _t("No device key yet — add a device below, or put BARK_TOKEN into the Gateway settings.")})
    if server.startswith("http://") and not re.match(r"^http://(127\.0\.0\.1|localhost|\[::1\])", server):
        out.append({"level": "warn", "text": _t(
            "Server is plain HTTP ({server}): the device key crosses the network in the clear. Only do this on a LAN you control.", server=server)})
    if settings.misplaced_keys:
        out.append({"level": "warn", "text": _t(
            "Plaintext key in config.yaml for {names}: ignored, not sent anywhere.", names=", ".join(settings.misplaced_keys))})
        out.append({"level": "info", "text": _t(
            "Move it to BARK_KEY_<ALIAS> (or remove devices.<alias>.key and add the device below).")})
    if ping is not None and not ping.get("ok"):
        out.append({"level": "error", "text": _t(
            "Server unreachable: {error}", error=ping.get("error") or ping.get("status") or "no pong")})
        if not (settings.proxy or "").strip() and any(
                hint in str(ping.get("error") or "") for hint in ("ConnectError", "refused", "proxy", "getaddrinfo")):
            out.append({"level": "info", "text": _t(
                "If a proxy or MITM (HTTPS_PROXY) is in play, set Proxy to direct (or the real proxy URL) under Advanced, then retry.")})
    elif ping is not None and not ping.get("version"):
        out.append({"level": "info", "text": _t("Server answers but reports no version; pushes still work — just confirm it really is bark-server.")})
    try:
        from hermes_cli.plugins_cmd import _get_enabled_set

        if PLUGIN_ID not in (_get_enabled_set() or set()):
            out.append({"level": "warn", "text": _t(
                "Plugin is not in this profile's plugins.enabled — the Bark platform, cron delivery and notify hooks stay off (this page still works).")})
    except Exception:  # noqa: BLE001
        pass
    if not settings.notify.get("turn_end", {}).get("enabled") and not settings.notify.get("subagent_stop", {}).get("enabled"):
        out.append({"level": "info", "text": _t("Automatic push is off — cron and hermes send still work; nothing pings you when a turn ends.")})
    return out


def _snapshot(ping: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    settings_mod = _settings()
    settings = settings_mod.load_settings()
    manifest = _manifest()
    cfg_path = ""
    try:
        from hermes_cli.config import get_config_path

        cfg_path = str(get_config_path())
    except Exception:  # noqa: BLE001
        pass
    schema = _schema()
    return {
        "ok": True,
        "strings": _bundle(_LANG.get()),
        "plugin": {
            "id": PLUGIN_ID,
            "label": manifest.get("label") or "Bark",
            "version": str(manifest.get("version") or ""),
            "router_version": ROUTER_VERSION,
            "dir": str(PLUGIN_DIR),
            "config_path": cfg_path,
            "secret_source": _credential_source(settings),
            "config_exists": bool(cfg_path) and Path(cfg_path).exists(),
        },
        "server": {
            "url": settings.server,
            "host": settings.server.split("://", 1)[-1].split("/", 1)[0],
            "proxy": settings.proxy,
            "ping": ping,
        },
        "devices": _devices(settings),
        "default_device": settings.default_device,
        "configured": settings.configured,
        "settings": {
            "values": settings.values,
            "provenance": settings.provenance,
            "schema": {key: dict(spec) for key, spec in schema.items()},
            "defaults": dict(settings_mod.SETTING_DEFAULTS),
        },
        "notify": {
            "turn_end": settings.rule("turn_end"),
            "subagent_stop": settings.rule("subagent_stop"),
            "quiet_hours": settings.notify.get("quiet_hours") or [],
        },
        "stats": _events().stats(),
        "events": _events().recent(8),
        "warnings": _warnings(settings, ping),
    }


# -- helpers -----------------------------------------------------------------


def _status_code(exc: Exception) -> int:
    if isinstance(exc, PermissionError):
        return 403
    if isinstance(exc, ValueError):
        return 400
    return 500


def _coerce(schema: Mapping[str, Mapping[str, Any]], patch: Mapping[str, Any]) -> dict[str, Any]:
    """Turn form input into schema-typed values; raises ValueError with a usable message."""
    out: dict[str, Any] = {}
    for key, raw in patch.items():
        spec = schema.get(str(key))
        if spec is None:
            raise ValueError(_t("{key!r} is not in the plugin's config_schema", key=key))
        kind = str(spec.get("type") or "str").lower()
        if spec.get("choices") or spec.get("enum"):
            value = str(raw)
            allowed = [str(c) for c in (spec.get("choices") or spec.get("enum"))]
            if value not in allowed:
                raise ValueError(_t("{key} must be one of {allowed}", key=key, allowed=", ".join(allowed)))
        elif kind in ("int", "integer"):
            value = int(float(raw))
        elif kind in ("float", "number"):
            value = float(raw)
        elif kind in ("bool", "boolean"):
            if isinstance(raw, bool):
                value = raw
            elif isinstance(raw, (int, float)):
                value = bool(raw)
            else:
                value = str(raw).strip().lower() in ("1", "true", "yes", "on")
        elif kind in ("list", "array", "dict", "object"):
            value = raw if isinstance(raw, (list, dict)) else []
        else:
            value = str(raw)
        out[str(key)] = value
    return out


def _push_fields(payload: Mapping[str, Any], settings: Any) -> dict[str, Any]:
    """Settings defaults ← explicit test overrides (empty strings mean 'unset')."""
    fields: dict[str, Any] = dict(settings.defaults or {})
    fields.setdefault("title", settings.title)
    for key in ("title", "subtitle", "body", "level", "sound", "icon", "group", "url", "image", "badge", "copy"):
        value = payload.get(key)
        if value not in (None, ""):
            fields[key] = value
    if payload.get("ttl") not in (None, ""):
        fields["ttl"] = payload.get("ttl")
    fields["body"] = str(fields.get("body") or "")
    return fields


def _target(payload: Mapping[str, Any], settings: Any) -> tuple[str, str]:
    return settings.resolve(str(payload.get("device") or ""))


# -- routes ------------------------------------------------------------------


@router.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "plugin": PLUGIN_ID, "router_version": ROUTER_VERSION}


@router.get("/status")
async def status(fresh: int = Query(0, ge=0, le=1)) -> dict[str, Any]:
    settings_mod = _settings()
    loaded = settings_mod.load_settings()
    server = loaded.server or ""
    ping = await _ping(server, fresh=bool(fresh), proxy=loaded.proxy) if server else None
    return _snapshot(ping)


@router.post("/ping")
async def ping_server() -> dict[str, Any]:
    loaded = _settings().load_settings()
    return await _ping(loaded.server, fresh=True, proxy=loaded.proxy)


@router.get("/events")
def recent_events(limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    return {"events": _events().recent(limit), "stats": _events().stats()}


@router.delete("/events")
def clear_events() -> dict[str, Any]:
    return {"ok": _events().clear()}


@router.post("/settings")
def save_settings(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    patch = payload.get("patch")
    if not isinstance(patch, Mapping) or not patch:
        raise HTTPException(status_code=400, detail=_t("patch must be a non-empty object"))
    schema = _schema()
    try:
        values = _coerce(schema, patch)
        from hermes_cli.plugins_settings import save_plugin_settings

        written = save_plugin_settings(PLUGIN_ID, PLUGIN_DIR, values)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=_status_code(exc), detail=str(exc)) from None
    snapshot = _snapshot(None)
    snapshot["written"] = written
    return snapshot


_ALIAS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


@router.post("/device")
def add_device(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    alias = str(payload.get("alias") or "").strip()
    key = str(payload.get("key") or "").strip()
    if not _ALIAS_RE.fullmatch(alias):
        raise HTTPException(status_code=400, detail=_t("Alias allows letters, digits, dot, underscore and hyphen only (1–32 chars)"))
    if not key:
        raise HTTPException(status_code=400, detail=_t("Missing device key"))
    if len(key) > 200 or any(ch.isspace() for ch in key):
        raise HTTPException(status_code=400, detail=_t("That does not look like a Bark device key (no whitespace allowed)"))
    env_name = _settings().alias_env(alias)
    try:
        from hermes_cli.credential_lifecycle import save_provider_env_credential

        save_provider_env_credential(env_name, key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=_status_code(exc), detail=str(exc)) from None
    snapshot = _snapshot(None)
    snapshot["written"] = [env_name]
    return snapshot


@router.delete("/device/{alias}")
def remove_device(alias: str) -> dict[str, Any]:
    if not _ALIAS_RE.fullmatch(alias or ""):
        raise HTTPException(status_code=400, detail=_t("Invalid alias"))
    env_name = _settings().alias_env(alias)
    try:
        from hermes_cli.credential_lifecycle import remove_provider_env_credential

        remove_provider_env_credential(env_name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=_status_code(exc), detail=str(exc)) from None
    snapshot = _snapshot(None)
    snapshot["written"] = [env_name]
    return snapshot


@router.post("/preview")
def preview(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    settings = _settings().load_settings()
    try:
        alias, _key = _target(payload, settings)
        fields = _push_fields(payload, settings)
        built = _client().build_payload(**fields)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=_status_code(exc), detail=str(exc)) from None
    return {
        "ok": True,
        "alias": alias,
        "server": settings.server,
        "endpoint": settings.server + "/push",
        "payload": built,
        "note": _t("device_key is hidden; the request body = this JSON + device_key"),
    }


@router.post("/test")
async def test_push(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    settings = _settings().load_settings()
    try:
        alias, key = _target(payload, settings)
        fields = _push_fields(payload, settings)
        built = _client().build_payload(**fields)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=_status_code(exc), detail=str(exc)) from None

    if payload.get("dry_run"):
        return {"ok": True, "dry_run": True, "alias": alias, "payload": built,
                "server": settings.server}

    result = await _client().push(settings.server, key, built, timeout=10.0, attempts=2,
                                  proxy=settings.proxy)
    ok = bool(result.get("success"))
    _events().record(
        source="dashboard", ok=ok, alias=alias, body=str(built.get("body") or ""),
        title=str(built.get("title") or ""), error=str(result.get("error") or ""),
        status=result.get("status"), latency_ms=result.get("latency_ms"),
        message_id=str(result.get("message_id") or ""),
    )
    return {
        "ok": ok,
        "alias": alias,
        "server": settings.server,
        "status": result.get("status"),
        "latency_ms": result.get("latency_ms"),
        "message_id": result.get("message_id") or "",
        "queued": bool(result.get("queued")),
        "proxy_fallback": bool(result.get("proxy_fallback")),
        "error": result.get("error") or "",
        "error_kind": result.get("error_kind") or "",
        "payload": built,
        "events": _events().recent(5),
    }
