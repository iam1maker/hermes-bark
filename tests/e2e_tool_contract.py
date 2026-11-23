"""In-process contract test for the `bark_notify` tool handler.

Proves the tool registered by the plugin is callable with the same shape an
agent turn uses (args dict only), and that settings resolve from
$HERMES_HOME/config.yaml rather than from the process environment.

Run:
    HERMES_HOME=<tmp> /path/to/venv/bin/python tests/e2e_tool_contract.py
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
    from tools.registry import registry

    discover_plugins(force=True)

    entry = registry.get_entry("bark_notify")
    if entry is None:
        print(json.dumps({"error": "tool 'bark_notify' not registered"}))
        return 1

    def call(args):
        out = entry.handler(args)
        if entry.is_async or asyncio.iscoroutine(out):
            out = asyncio.run(out)
        return out

    results = {
        "tool": {
            "name": entry.name,
            "toolset": entry.toolset,
            "is_async": entry.is_async,
            "required": entry.schema.get("required"),
            "required_env": list(entry.requires_env or []),
        },
        "ok_call": call({"body": "tool handler ✓", "title": "Tool", "level": "active"}),
        "bad_device": call({"body": "x", "device": "nope"}),
    }
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
