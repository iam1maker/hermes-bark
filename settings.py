"""Configuration + secret resolution for the Bark plugin.

Two configuration surfaces, one merged view:

- ``plugins.entries.hermes-bark.settings`` — the knobs declared in ``plugin.yaml``
  ``config_schema``. Written by Settings → Plugins (``plugins.manage``) and by
  this plugin's own dashboard page, always through Hermes' atomic
  ``save_plugin_settings`` writer (validated against the schema, refuses
  secrets). This is the surface the desktop page edits.
- ``platforms.bark.extra`` — the platform-shaped config (``devices``, nested
  ``notify`` rules, ``defaults``). Still honoured so an existing config or a
  platform-only install keeps working; settings win over it key by key.

Secrets never live in either: they come from ``BARK_TOKEN`` / ``BARK_KEY_<ALIAS>``.
Hermes owns credential routing and the plugin never parses ``.env`` itself
(catalog rule 11): a read goes through ``gateway.platforms._shared.get_scoped_secret``,
which returns the *installed profile* secret scope when one is bound — including
keys saved moments ago, because Hermes' ``_publish_env_value`` publishes a
credential write into that same scope — and falls back to ``os.environ`` only
when the process has no scope (CLI, single-profile). A scoped miss is fail-closed:
another profile's value is never borrowed.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Optional

try:  # package import (plugin loader)
    from .bark_client import DEFAULT_SERVER, DEFAULT_TITLE, MAX_BODY, looks_like_key
except ImportError:  # direct-path import (tests)
    from bark_client import DEFAULT_SERVER, DEFAULT_TITLE, MAX_BODY, looks_like_key

PLUGIN_ID = "hermes-bark"

#: Every knob the desktop page and the native Settings → Plugins form can write.
#: Keep in sync with ``config_schema`` in ``plugin.yaml`` (types and defaults).
SETTING_DEFAULTS: dict[str, Any] = {
    "server": DEFAULT_SERVER,
    "proxy": "",
    "title": DEFAULT_TITLE,
    "default_device": "",
    "level": "timeSensitive",
    "group": "Hermes",
    "sound": "",
    "icon": "",
    "ttl": 0,
    "notify_turn_end": False,
    "notify_turn_end_min_duration_s": 90,
    "notify_turn_end_statuses": "failed,interrupted",
    "notify_subagent_stop": False,
    "notify_subagent_stop_min_duration_ms": 30000,
    "notify_quiet_hours": "",
    "dedupe": True,
    "allow_private_image_urls": False,
}

SETTING_KEYS = tuple(SETTING_DEFAULTS)


class TargetError(ValueError):
    """Unresolvable delivery target; the message is shown to the model verbatim."""


# -- secrets -----------------------------------------------------------------


def _profile_home() -> Optional[Path]:
    """The Hermes home that owns this plugin copy (``…/plugins/<id>/settings.py``)."""
    here = Path(__file__).resolve()
    if len(here.parents) >= 3 and here.parents[1].name == "plugins":
        return here.parents[2]
    return None


def secret(name: str, default: str = "") -> str:
    """Profile-scoped credential read — Hermes routes it, the plugin never reads files.

    ``get_scoped_secret`` is authoritative when a scope is bound (a scoped miss
    returns the default rather than borrowing ``os.environ``); ``external_fallback``
    builds this profile's own scope for startup paths that run before one exists.
    Only outside a Hermes runtime (unit tests, a bare host) is ``os.environ`` read
    directly.
    """
    try:
        from gateway.platforms._shared import get_scoped_secret
    except ImportError:  # outside a Hermes runtime
        return (os.environ.get(name) or "").strip() or default
    try:
        value = get_scoped_secret(name, "", external_fallback=True)
    except Exception:  # noqa: BLE001 — a broken scope must not kill a send
        value = ""
    return str(value or "").strip() or default


def secret_names(prefix: str = "BARK_") -> set[str]:
    """Credential names this profile can see, via the scope and the process env."""
    names = {key for key in os.environ if key.startswith(prefix)}
    try:
        from agent.secret_scope import current_secret_scope
    except ImportError:
        return names
    try:
        scope = current_secret_scope()
    except Exception:  # noqa: BLE001
        scope = None
    if isinstance(scope, Mapping):
        names |= {str(key) for key in scope if str(key).startswith(prefix)}
    return names


def secret_source(name: str) -> str:
    """``"scope"`` / ``"env"`` / ``""`` for display only — never the value."""
    try:
        from agent.secret_scope import current_secret_scope

        scope = current_secret_scope()
    except Exception:  # noqa: BLE001
        scope = None
    if isinstance(scope, Mapping) and str(scope.get(name) or "").strip():
        return "scope"
    if (os.environ.get(name) or "").strip():
        return "env"
    return ""


def alias_env(alias: str) -> str:
    """``iphone`` -> ``BARK_KEY_IPHONE``."""
    return "BARK_KEY_" + re.sub(r"[^A-Z0-9]+", "_", str(alias).upper()).strip("_")


def alias_from_env(name: str) -> str:
    """``BARK_KEY_IPAD_PRO`` -> ``ipad-pro`` (round-trips :func:`alias_env`)."""
    return name[len("BARK_KEY_"):].lower().replace("_", "-")


def env_aliases() -> dict[str, str]:
    """Aliases that exist as ``BARK_KEY_<ALIAS>`` in this profile's credential scope."""
    out: dict[str, str] = {}
    for name in sorted(secret_names("BARK_KEY_")):
        alias = alias_from_env(name)
        if alias and alias not in out:
            out[alias] = secret(name)
    return {alias: key for alias, key in out.items() if key}


# -- settings surfaces -------------------------------------------------------


def plugin_settings() -> dict[str, Any]:
    """``plugins.entries.hermes-bark.settings`` (empty on any failure)."""
    try:
        from hermes_cli.config import load_config_readonly
        from hermes_cli.plugins import _plugin_settings_entry

        entry = _plugin_settings_entry(load_config_readonly() or {}, PLUGIN_ID) or {}
        values = entry.get("settings") or {}
        return {str(k): v for k, v in values.items()} if isinstance(values, Mapping) else {}
    except Exception:  # noqa: BLE001 — settings must never break a send
        return {}


def platform_extra() -> dict:
    """``platforms.bark.extra`` from the merged config (read-only; no deepcopy)."""
    try:
        from hermes_cli.config import load_config_readonly

        cfg = load_config_readonly() or {}
    except Exception:  # noqa: BLE001
        return {}
    platform = (cfg.get("platforms") or {}).get("bark") or {}
    return dict(platform.get("extra") or {})


def _device_key(alias: str, spec: Any) -> tuple[str, str]:
    """Resolve one ``devices`` entry -> ``(key, source)``.

    ``source`` is ``"env"`` or ``"inline"``; inline keys live in config.yaml and
    are reported by ``doctor``/the dashboard as a hygiene warning.
    """
    if isinstance(spec, str) and spec.strip():
        value = spec.strip()
        if re.fullmatch(r"[A-Z][A-Z0-9_]*", value):
            return secret(value), "env"
        return value, "inline"  # literal key in YAML
    if isinstance(spec, Mapping):
        env_name = str(spec.get("key_env") or alias_env(alias)).strip()
        key = secret(env_name)
        if key:
            return key, "env"
        return str(spec.get("key") or "").strip(), "inline"
    return secret(alias_env(alias)), "env"


def _statuses(value: Any) -> list[str]:
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,\s]+", value) if part.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(part).strip() for part in value if str(part).strip()]
    return []


@dataclass(frozen=True)
class Settings:
    server: str = DEFAULT_SERVER
    proxy: str = ""                            # "" = env, "direct" = ignore env, else proxy URL
    title: str = DEFAULT_TITLE
    default_device: str = ""
    devices: dict = field(default_factory=dict)   # alias -> device key
    defaults: dict = field(default_factory=dict)  # Bark payload defaults
    notify: dict = field(default_factory=dict)    # hook rules
    allow_private_image_urls: bool = False
    dedupe: bool = False
    inline_keys: tuple = ()                       # aliases whose key came from YAML
    values: dict = field(default_factory=dict)    # merged scalar knobs
    provenance: dict = field(default_factory=dict)  # key -> settings|extra|default

    @property
    def configured(self) -> bool:
        return bool(self.devices)

    def resolve(self, target: Optional[str]) -> tuple[str, str]:
        """``("iphone", "<key>")`` for a target ref; raises :class:`TargetError`."""
        token = (target or "").strip()
        if not token or token in ("home", "default"):
            token = self.default_device
        if not token:
            raise TargetError("no Bark device configured (set BARK_TOKEN or platforms.bark.extra.devices)")
        key = self.devices.get(token)
        if key:
            return token, key
        if looks_like_key(token):
            return f"key:{token[:4]}…", token
        known = ", ".join(sorted(self.devices)) or "(none)"
        raise TargetError(f"unknown Bark device {token!r}; known: {known}")

    def rule(self, name: str) -> dict:
        value = (self.notify or {}).get(name)
        return dict(value) if isinstance(value, Mapping) else {}

    def redacted(self) -> dict:
        """Operator-facing view: never leaks keys."""
        return {
            "server": self.server,
            "title": self.title,
            "default_device": self.default_device,
            "devices": {alias: f"***{key[-4:]}" if len(key) > 4 else "***" for alias, key in self.devices.items()},
            "dedupe": self.dedupe,
            "allow_private_image_urls": self.allow_private_image_urls,
            "notify": dict(self.notify or {}),
            "inline_keys": list(self.inline_keys),
        }


def _build_notify(values: dict[str, Any], provenance: dict[str, str], extra: dict) -> dict:
    """Flat settings knobs → the nested rule shape the hooks read.

    ``platforms.bark.extra.notify`` is the base so hand-written nested rules keep
    working; a knob explicitly saved through the settings surface overrides them.
    """
    notify = dict(extra.get("notify") or {}) if isinstance(extra.get("notify"), Mapping) else {}

    def _set(rule_name: str, key: str, value: Any, *, setting: str) -> None:
        if provenance.get(setting) not in ("settings", "default"):
            return  # extra's nested rule wins unless the knob was saved here
        if provenance.get(setting) == "default" and rule_name in notify:
            return  # an existing nested rule beats a schema default
        rule = notify.get(rule_name)
        rule = dict(rule) if isinstance(rule, Mapping) else {}
        rule[key] = value
        notify[rule_name] = rule

    turn_end = notify.get("turn_end")
    turn_end = dict(turn_end) if isinstance(turn_end, Mapping) else {}
    _set("turn_end", "enabled", bool(values.get("notify_turn_end")), setting="notify_turn_end")
    _set("turn_end", "min_duration_s", float(values.get("notify_turn_end_min_duration_s") or 0),
         setting="notify_turn_end_min_duration_s")
    statuses = _statuses(values.get("notify_turn_end_statuses"))
    if statuses:
        _set("turn_end", "statuses", statuses, setting="notify_turn_end_statuses")
    if turn_end:
        notify["turn_end"] = turn_end

    subagent = notify.get("subagent_stop")
    subagent = dict(subagent) if isinstance(subagent, Mapping) else {}
    _set("subagent_stop", "enabled", bool(values.get("notify_subagent_stop")), setting="notify_subagent_stop")
    _set("subagent_stop", "min_duration_ms", float(values.get("notify_subagent_stop_min_duration_ms") or 0),
         setting="notify_subagent_stop_min_duration_ms")
    if subagent:
        notify["subagent_stop"] = subagent

    quiet = values.get("notify_quiet_hours") or ""
    if str(quiet).strip():
        notify["quiet_hours"] = [part.strip() for part in str(quiet).split(",") if part.strip()]
    elif provenance.get("notify_quiet_hours") == "settings":
        notify.pop("quiet_hours", None)
    return notify


def load_settings(extra: Optional[Mapping[str, Any]] = None) -> Settings:
    """Merged view: ``plugins.entries.hermes-bark.settings`` over ``platforms.bark.extra``."""
    extra = dict(platform_extra() if extra is None else extra)
    stored = plugin_settings()

    values: dict[str, Any] = {}
    provenance: dict[str, str] = {}
    for key, default in SETTING_DEFAULTS.items():
        if key in stored and stored[key] is not None:
            values[key] = stored[key]
            provenance[key] = "settings"
        elif key in extra and extra[key] is not None:
            values[key] = extra[key]
            provenance[key] = "extra"
        else:
            values[key] = default
            provenance[key] = "default"

    server = str(values["server"] or "").strip() or secret("BARK_SERVER") or DEFAULT_SERVER
    server = server.rstrip("/")

    devices: dict[str, str] = {}
    inline: list[str] = []
    for alias, spec in (extra.get("devices") or {}).items():
        alias = str(alias).strip()
        if not alias:
            continue
        key, source = _device_key(alias, spec)
        if key:
            devices[alias] = key
            if source == "inline":
                inline.append(alias)

    for alias, key in env_aliases().items():  # env-only aliases, never overwrite explicit extra
        devices.setdefault(alias, key)

    if not devices:  # single-device mode: the original PR's BARK_TOKEN
        token = secret("BARK_TOKEN")
        if token:
            devices["default"] = token

    default_device = str(values.get("default_device") or "").strip()
    if not default_device:
        default_device = "default" if "default" in devices else next(iter(devices), "")

    defaults: dict[str, Any] = dict(extra.get("defaults") or {})
    # Precedence: an explicit plugin setting > platforms.bark.extra.defaults > schema
    # default. ``setdefault`` is what encodes the middle line: a hand-written extra
    # keeps its value unless the user saved that knob from the settings surface.
    for key in ("level", "group", "sound", "icon"):
        value = values.get(key)
        if provenance.get(key) == "default":
            if value not in (None, ""):
                defaults.setdefault(key, value)
        elif value in (None, ""):
            defaults.pop(key, None)
        else:
            defaults[key] = value
    try:
        ttl = int(values.get("ttl") or 0)
    except (TypeError, ValueError):
        ttl = 0
    if provenance.get("ttl") == "default":
        if ttl > 0:
            defaults.setdefault("ttl", ttl)
    elif ttl > 0:
        defaults["ttl"] = ttl
    else:
        defaults.pop("ttl", None)
    title = str(values.get("title") or DEFAULT_TITLE)

    return Settings(
        server=server,
        proxy=str(values.get("proxy") or ""),
        title=title,
        default_device=default_device,
        devices=devices,
        defaults=defaults,
        notify=_build_notify(values, provenance, extra),
        allow_private_image_urls=bool(values.get("allow_private_image_urls")),
        dedupe=bool(values.get("dedupe")),
        inline_keys=tuple(inline),
        values=values,
        provenance=provenance,
    )


def load_from_config() -> Settings:
    return load_settings(platform_extra())
