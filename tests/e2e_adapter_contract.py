"""In-process contract test: platform_registry -> create_adapter -> connect -> send.

This is the piece `hermes send` does NOT exercise (it goes straight to the
standalone sender). It proves the gateway can build and drive a send-only
adapter, which is the R2 risk called out in TD.md.

Run:
    HERMES_HOME=<tmp> /path/to/venv/bin/python tests/e2e_adapter_contract.py
Requires: $TMP/plugins/hermes-bark installed, $TMP/config.yaml platforms.bark,
and a reachable fake Bark server (tests/fake_bark.py).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

def _hermes_src() -> Path:
    """Hermes checkout to import from: $HERMES_SRC, else the running `hermes` package."""
    raw = os.environ.get("HERMES_SRC", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    try:
        import hermes_constants  # noqa: F401  (already importable => use the active install)
    except ImportError:  # pragma: no cover
        pass
    else:
        return Path(hermes_constants.__file__).resolve().parents[1]
    raise SystemExit("set HERMES_SRC to a Hermes Agent checkout (the dir holding hermes_cli/)")


HERMES_SRC = _hermes_src()
sys.path.insert(0, str(HERMES_SRC))


def main() -> int:
    from hermes_cli.plugins import discover_plugins
    from gateway.platform_registry import platform_registry
    from gateway.config import load_gateway_config

    discover_plugins(force=True)

    entry = platform_registry.get("bark")
    if entry is None:
        print(json.dumps({"error": "platform 'bark' not registered"}))
        return 1

    cfg = load_gateway_config()
    print(json.dumps({
        "registry": {
            "name": entry.name,
            "label": entry.label,
            "plugin_name": entry.plugin_name,
            "cron_deliver_env_var": getattr(entry, "cron_deliver_env_var", None),
            "has_standalone_sender": bool(getattr(entry, "standalone_sender_fn", None)),
            "has_target_syntax": bool(getattr(entry, "target_ref_syntax_fn", None)),
            "max_message_length": getattr(entry, "max_message_length", None),
            "required_env": list(getattr(entry, "required_env", []) or []),
        },
        "config_platforms": sorted(str(getattr(k, "value", k)) for k in (cfg.platforms or {})),
        "has_bark_block": any(str(getattr(k, "value", k)) == "bark" for k in (cfg.platforms or {})),
    }, ensure_ascii=False))

    pconfig = next(
        (v for k, v in (cfg.platforms or {}).items() if str(getattr(k, "value", k)) == "bark"),
        None,
    )
    if pconfig is None:
        print(json.dumps({"error": "platforms.bark missing from gateway config"}))
        return 1

    adapter = platform_registry.create_adapter("bark", pconfig)
    if adapter is None:
        print(json.dumps({"error": "create_adapter returned None"}))
        return 1

    async def drive():
        connected = await adapter.connect()
        r1 = await adapter.send("test", "adapter contract 适配器")
        r2 = await adapter.send_image("test", "https://example.com/pic.png")
        r3 = await adapter.send_image("test", "/tmp/does-not-exist.png")
        await adapter.disconnect()
        return connected, r1, r2, r3

    connected, r1, r2, r3 = asyncio.run(drive())

    def dump(r):
        if r is None:
            return None
        return {
            "success": getattr(r, "success", None),
            "message_id": getattr(r, "message_id", None),
            "error": getattr(r, "error", None),
        }

    print(json.dumps({
        "connected": connected,
        "send_text": dump(r1),
        "send_url_image": dump(r2),
        "send_local_file": dump(r3),
        "adapter_class": type(adapter).__name__,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
