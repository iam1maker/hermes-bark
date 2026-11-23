#!/usr/bin/env python3
"""Run the Bark dashboard backend standalone for verification.

Same router the gateway hot-mounts, but in its own process — so Python edits are
live without restarting Hermes. Read-only against the real profile except
``POST /settings``, ``POST/DELETE /device`` and ``POST /test``.

    HERMES_HOME=~/.hermes/profiles/forge python scripts/serve-local.py --port 18123
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def _hermes_repo() -> Path:
    """Hermes checkout to import the host packages from: $HERMES_SRC, else the active install."""
    raw = os.environ.get("HERMES_SRC", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    try:
        import hermes_constants
    except ImportError:
        return Path("")
    return Path(hermes_constants.__file__).resolve().parents[1]


HERMES_REPO = _hermes_repo()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18123)
    parser.add_argument("--plugin-id", default="hermes-bark")
    args = parser.parse_args()

    if HERMES_REPO.name:
        sys.path.insert(0, str(HERMES_REPO))
    from fastapi import FastAPI
    import uvicorn

    spec = importlib.util.spec_from_file_location("bark_dashboard_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    app = FastAPI(title="bark dashboard (standalone)")
    app.include_router(module.router, prefix=f"/api/plugins/{args.plugin_id}")
    print(f"serving {ROOT} on http://127.0.0.1:{args.port}/api/plugins/{args.plugin_id}/", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
