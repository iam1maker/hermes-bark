"""In-process hook test: fire the real lifecycle dispatcher and count pushes.

Exercises what the agent runtime actually does — ``hermes_cli.lifecycle.invoke_hook``
with the payloads from agent/turn_finalizer.py:883-895 and the subagent path —
rather than calling the callbacks directly.

Run:
    HERMES_HOME=<tmp> /path/to/venv/bin/python tests/e2e_hooks.py
"""
from __future__ import annotations

import json
import os
import sys
import time
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
    from hermes_cli.lifecycle import invoke_hook
    from hermes_cli import plugins as plugins_mod

    discover_plugins(force=True)

    hooks = ["pre_llm_call", "on_session_end", "subagent_stop"]
    registered = {h: bool(plugins_mod.has_hook(h)) if hasattr(plugins_mod, "has_hook") else None
                  for h in hooks}

    # Turn 1: normal completion, duration ~0.2s
    invoke_hook("pre_llm_call", session_id="H1", user_message="hi",
                conversation_history=[], is_first_turn=True, model="m", platform="cli")
    time.sleep(0.2)
    invoke_hook("on_session_end", session_id="H1", task_id="t1", turn_id="1",
                completed=True, failed=False, interrupted=False,
                turn_exit_reason="completed", model="m", platform="cli")
    time.sleep(1.5)

    # Turn 2 on the same session, immediately: must be swallowed by the 60s debounce
    invoke_hook("pre_llm_call", session_id="H1", user_message="again",
                conversation_history=[], is_first_turn=False, model="m", platform="cli")
    time.sleep(0.1)
    invoke_hook("on_session_end", session_id="H1", task_id="t1", turn_id="2",
                completed=True, failed=False, interrupted=False,
                turn_exit_reason="completed", model="m", platform="cli")
    time.sleep(1.0)

    # Subagent stop on a different session: its own debounce bucket
    invoke_hook("subagent_stop", parent_session_id="H2", child_role="researcher",
                child_summary="scanned 40 pages", child_status="completed",
                duration_ms=4200, tool_call_history=[])
    time.sleep(1.5)

    print(json.dumps({"hooks_registered": registered}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
