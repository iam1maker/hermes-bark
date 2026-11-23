"""``hermes bark ...`` subcommands: doctor, devices, test.

Doctor answers the only question that matters when a push did not arrive:
is it DNS/proxy, a wrong key, a non-Bark server, or a rule that filtered it?
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Optional

try:  # package import
    from .bark_client import build_payload, explain_probe, ping, push
    from .settings import load_from_config
except ImportError:  # direct-path import (tests)
    from bark_client import build_payload, explain_probe, ping, push
    from settings import load_from_config


def setup_cli(parser: argparse.ArgumentParser) -> None:
    subs = parser.add_subparsers(dest="bark_command", required=False)
    subs.add_parser("doctor", help="Check server reachability, device keys, and notification rules")
    subs.add_parser("devices", help="List configured device aliases (keys masked)")
    p_test = subs.add_parser("test", help="Send a real test notification")
    p_test.add_argument("--device", default=None, help="Device alias (default: the configured default)")
    p_test.add_argument("--body", default="Hermes Bark test notification", help="Body text")
    p_test.add_argument("--level", default=None,
                        choices=["active", "timeSensitive", "critical", "passive"])
    parser.set_defaults(func=dispatch)


def register(ctx) -> None:
    """Plugin entry point for ``hermes bark ...``."""
    ctx.register_cli_command(
        name="bark",
        help="Bark push notifications (doctor, devices, test)",
        setup_fn=setup_cli,
        handler_fn=dispatch,
        description=("Inspect and test the Bark delivery channel: reachability, device keys "
                     "(masked), notification rules, and a real test push."),
    )


def dispatch(args: argparse.Namespace) -> int:
    command = getattr(args, "bark_command", None)
    if command == "doctor":
        return asyncio.run(_doctor())
    if command == "devices":
        return _devices()
    if command == "test":
        return asyncio.run(_test(args))
    print("usage: hermes bark {doctor|devices|test}")
    return 2


def _settings_or_hint():
    settings = load_from_config()
    if not settings.configured:
        print("Bark is not configured.")
        print("  set BARK_TOKEN=<device key> (hermes config set BARK_TOKEN …, or the plugin page), then re-run.")
        print("  (config reference: platforms.bark.extra in the TD)")
    return settings


def _devices() -> int:
    settings = _settings_or_hint()
    if not settings.configured:
        return 1
    view = settings.redacted()
    default = settings.default_device
    print(f"server: {view['server']}")
    for alias, masked in sorted(view["devices"].items()):
        mark = " (default)" if alias == default else ""
        print(f"  {alias}{mark}: {masked}")
    return 0


async def _doctor() -> int:
    settings = _settings_or_hint()
    ok = True
    print(f"server: {settings.server}")
    if settings.server.startswith("http://"):
        print("  ! plaintext HTTP — the device key and body travel unencrypted")

    probe = await ping(settings.server, proxy=settings.proxy)
    if probe.get("ok"):
        version = probe.get("version") or "unknown"
        print(f"  reachable: pong (server version {version})")
    else:
        ok = False
        detail = probe.get("error") or (f"HTTP {probe['status']}" if probe.get("status") else probe)
        print(f"  ! unreachable: {detail}")
        hint = explain_probe(probe)
        if hint:
            print(f"    {hint}")

    if not settings.configured:
        return 1
    for alias, key in settings.devices.items():
        masked = f"***{key[-4:]}" if len(key) > 4 else "***"
        print(f"device {alias}: {masked} ({len(key)} chars)")
    if settings.inline_keys:
        print(f"  ! keys written inline in config.yaml for: {', '.join(settings.inline_keys)}")
        print("    move them to a BARK_KEY_<ALIAS> credential (config.yaml is backed up in plaintext)")

    rules = settings.rule("turn_end"), settings.rule("subagent_stop")
    print(f"notify.turn_end: {'on' if rules[0].get('enabled') else 'off'}")
    print(f"notify.subagent_stop: {'on' if rules[1].get('enabled') else 'off'}")
    quiet = (settings.notify or {}).get("quiet_hours")
    if quiet:
        print(f"quiet_hours: {quiet}")
    print(f"dedupe id: {'on' if settings.dedupe else 'off'}")
    return 0 if ok else 1


async def _test(args: argparse.Namespace) -> int:
    settings = _settings_or_hint()
    if not settings.configured:
        return 1
    try:
        alias, key = settings.resolve(getattr(args, "device", None))
    except ValueError as exc:
        print(f"error: {exc}")
        return 1
    fields = dict(settings.defaults or {})
    fields["body"] = args.body
    if args.level:
        fields["level"] = args.level
    payload = build_payload(**fields)
    result = await push(settings.server, key, payload, proxy=settings.proxy)
    if result.get("error"):
        print(f"failed ({result.get('error_kind')}): {result['error']}")
        return 1
    print(f"queued to {alias} (message_id={result.get('message_id') or '-'})")
    print("note: queued to APNs ≠ displayed on the device")
    return 0
