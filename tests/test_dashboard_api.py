"""Contract tests for ``dashboard/plugin_api.py`` (the desktop settings backend).

Runs the real FastAPI router against a real fake bark-server. Hermes' own
writers (``save_plugin_settings`` / ``save_provider_env_credential``) are replaced
by sandbox implementations that read and write the temporary config, so the test
asserts the *contract* the page depends on: what it posts, what comes back, and
what lands on disk — without touching the developer's profile.

Run:  <hermes venv>/bin/python tests/test_dashboard_api.py -v
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

_SANDBOX = Path(tempfile.mkdtemp(prefix="bark-api-home-"))
_HERMES = _SANDBOX / ".hermes"
_HERMES.mkdir(parents=True, exist_ok=True)
os.environ["HOME"] = str(_SANDBOX)
os.environ["HERMES_HOME"] = str(_HERMES)
for _name in [key for key in os.environ if key.startswith("BARK_")]:
    os.environ.pop(_name, None)

import yaml  # noqa: E402

from fake_bark import FakeBark  # noqa: E402

DEVICE = "AbCdEfGhIjKlMnOpQrStUv"
PLUGIN_ID = "hermes-bark"


# -- sandbox stand-ins for the Hermes modules the router imports lazily -------

_CONFIG = _HERMES / "config.yaml"
_ENV = _HERMES / ".env"
_WRITES: list[tuple] = []


def _load_cfg() -> dict:
    if not _CONFIG.exists():
        return {}
    return yaml.safe_load(_CONFIG.read_text(encoding="utf-8")) or {}


def _dump_cfg(cfg: dict) -> None:
    _CONFIG.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")


def _install_stubs() -> None:
    cli = types.ModuleType("hermes_cli")
    cli.__path__ = []  # type: ignore[attr-defined]

    cfg_mod = types.ModuleType("hermes_cli.config")
    cfg_mod.load_config_readonly = _load_cfg
    cfg_mod.get_config_path = lambda: _CONFIG

    plugins_mod = types.ModuleType("hermes_cli.plugins")
    def _entry(config, plugin_id):
        return (((config.get("plugins") or {}).get("entries") or {}).get(plugin_id) or {})
    plugins_mod._plugin_settings_entry = _entry

    settings_mod = types.ModuleType("hermes_cli.plugins_settings")
    def _schema(plugin_dir):
        manifest = yaml.safe_load((Path(plugin_dir) / "plugin.yaml").read_text(encoding="utf-8"))
        return dict(manifest.get("config_schema") or {})
    def _save(plugin_id, plugin_dir, values):
        _WRITES.append(("settings", plugin_id, dict(values)))
        cfg = _load_cfg()
        entries = cfg.setdefault("plugins", {}).setdefault("entries", {}).setdefault(plugin_id, {})
        entries.setdefault("settings", {}).update(values)
        _dump_cfg(cfg)
        return sorted(values)
    settings_mod._manifest_config_schema = _schema
    settings_mod.save_plugin_settings = _save

    cmd_mod = types.ModuleType("hermes_cli.plugins_cmd")
    cmd_mod._get_enabled_set = lambda: {PLUGIN_ID}

    life_mod = types.ModuleType("hermes_cli.credential_lifecycle")
    def _save_env(env_var, value):
        _WRITES.append(("env", env_var, value))
        lines = _ENV.read_text(encoding="utf-8").splitlines() if _ENV.exists() else []
        lines = [line for line in lines if not line.startswith(f"{env_var}=")]
        lines.append(f"{env_var}={value}")
        _ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
        # Mirror Hermes' _publish_env_value: a credential write is visible to the
        # running process immediately (the plugin reads only through Hermes).
        os.environ[env_var] = value
        return {"env_var": env_var, "written": True}
    def _remove_env(env_var):
        _WRITES.append(("rm", env_var))
        lines = _ENV.read_text(encoding="utf-8").splitlines() if _ENV.exists() else []
        _ENV.write_text("\n".join(l for l in lines if not l.startswith(f"{env_var}=")) + "\n", encoding="utf-8")
        os.environ.pop(env_var, None)
        return {"env_var": env_var, "removed": True}
    life_mod.save_provider_env_credential = _save_env
    life_mod.remove_provider_env_credential = _remove_env

    utils_mod = types.ModuleType("utils")
    utils_mod.fast_safe_load = lambda text: yaml.safe_load(text)

    for name, module in {
        "hermes_cli": cli,
        "hermes_cli.config": cfg_mod,
        "hermes_cli.plugins": plugins_mod,
        "hermes_cli.plugins_settings": settings_mod,
        "hermes_cli.plugins_cmd": cmd_mod,
        "hermes_cli.credential_lifecycle": life_mod,
        "utils": utils_mod,
    }.items():
        sys.modules[name] = module


def _load_router():
    spec = importlib.util.spec_from_file_location("bark_dashboard_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    sys.modules["bark_dashboard_api"] = module
    return module


def _reset_env() -> None:
    """What Hermes' own loader leaves behind for this profile: its keys in the env.

    The plugin never reads ``.env`` itself, so the sandbox has to model the loader
    the same way the real CLI/gateway does.
    """
    for name in [key for key in os.environ if key.startswith("BARK_")]:
        os.environ.pop(name, None)
    os.environ["BARK_TOKEN"] = DEVICE


class DashboardApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        cls.bark = FakeBark().start()
        cls.addClassCleanup(cls.bark.stop)
        _install_stubs()
        _ENV.write_text(f"BARK_TOKEN={DEVICE}\n", encoding="utf-8")
        _reset_env()
        _dump_cfg({
            "plugins": {"entries": {PLUGIN_ID: {"settings": {"group": "FromSettings"}}}},
            "platforms": {"bark": {"extra": {"server": cls.bark.server,
                                             "defaults": {"level": "timeSensitive"}}}},
        })
        cls.api = _load_router()
        app = FastAPI()
        app.include_router(cls.api.router, prefix=f"/api/plugins/{PLUGIN_ID}")
        cls.client = TestClient(app)
        cls.prefix = f"/api/plugins/{PLUGIN_ID}"

    def setUp(self):
        """Every case starts from the same sandbox profile (they share one temp home)."""
        _WRITES.clear()
        _ENV.write_text(f"BARK_TOKEN={DEVICE}\n", encoding="utf-8")
        _reset_env()
        _dump_cfg({
            "plugins": {"entries": {PLUGIN_ID: {"settings": {"group": "FromSettings"}}}},
            "platforms": {"bark": {"extra": {"server": self.bark.server,
                                             "defaults": {"level": "timeSensitive"}}}},
        })

    def test_health(self):
        body = self.client.get(f"{self.prefix}/health").json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["plugin"], PLUGIN_ID)

    def test_status_shape_and_masking(self):
        body = self.client.get(f"{self.prefix}/status?fresh=1").json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["server"]["url"], self.bark.server)
        self.assertTrue(body["server"]["ping"]["ok"])
        self.assertEqual(body["devices"][0]["alias"], "default")
        self.assertEqual(body["devices"][0]["masked"], "••••" + DEVICE[-4:])
        self.assertNotIn(DEVICE, str(body))  # the key never reaches the renderer
        self.assertEqual(body["settings"]["values"]["group"], "FromSettings")
        self.assertEqual(body["settings"]["provenance"]["group"], "settings")
        self.assertEqual(body["settings"]["values"]["level"], "timeSensitive")
        self.assertEqual(body["settings"]["provenance"]["level"], "default")
        self.assertFalse(body["notify"]["turn_end"]["enabled"])
        self.assertEqual(body["plugin"]["secret_source"], "env")  # no scope in this host

    def test_preview_builds_without_sending(self):
        before = len(self.bark.requests)
        body = self.client.post(f"{self.prefix}/preview", json={"body": "preview & ünïcode ✓"}).json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["payload"]["body"], "preview & ünïcode ✓")
        self.assertEqual(body["payload"]["group"], "FromSettings")  # settings win over extra
        self.assertNotIn("device_key", body["payload"])
        self.assertEqual(len(self.bark.requests), before)

    def test_preview_rejects_unknown_device(self):
        resp = self.client.post(f"{self.prefix}/preview", json={"body": "x", "device": "watch"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("unknown Bark device", resp.json()["detail"])

    def test_test_push_hits_server_and_records_event(self):
        before = len(self.bark.requests)
        body = self.client.post(f"{self.prefix}/test", json={"body": "push test & ✓ ok"}).json()
        self.assertTrue(body["ok"], body)
        self.assertEqual(body["status"], 200)
        self.assertGreaterEqual(body["latency_ms"], 0)
        self.assertEqual(len(self.bark.requests), before + 1)
        sent = self.bark.requests[-1]["payload"]
        self.assertEqual(sent["body"], "push test & ✓ ok")
        self.assertEqual(sent["device_key"], DEVICE)
        self.assertEqual(body["events"][0]["ok"], True)
        self.assertEqual(body["events"][0]["source"], "dashboard")

    def test_test_push_dry_run_does_not_send(self):
        before = len(self.bark.requests)
        body = self.client.post(f"{self.prefix}/test", json={"body": "x", "dry_run": True}).json()
        self.assertTrue(body["dry_run"])
        self.assertEqual(len(self.bark.requests), before)

    def test_settings_write_is_schema_typed(self):
        body = self.client.post(f"{self.prefix}/settings",
                                json={"patch": {"notify_turn_end": "true", "ttl": "0",
                                                "group": "NewGroup"}}).json()
        self.assertEqual(sorted(body["written"]), ["group", "notify_turn_end", "ttl"])
        written = [w for w in _WRITES if w[0] == "settings"][-1][2]
        self.assertIs(written["notify_turn_end"], True)   # string → bool
        self.assertEqual(written["ttl"], 0)               # string → int
        self.assertEqual(body["settings"]["provenance"]["notify_turn_end"], "settings")
        self.assertTrue(body["settings"]["values"]["notify_turn_end"])

    def test_settings_rejects_unknown_or_bad_value(self):
        self.assertEqual(self.client.post(f"{self.prefix}/settings",
                                          json={"patch": {"nope": 1}}).status_code, 400)
        self.assertEqual(self.client.post(f"{self.prefix}/settings",
                                          json={"patch": {"level": "loud"}}).status_code, 400)
        self.assertEqual(self.client.post(f"{self.prefix}/settings", json={}).status_code, 400)

    def test_add_and_remove_device(self):
        body = self.client.post(f"{self.prefix}/device",
                                json={"alias": "iphone", "key": "ZzYyXxWwVvUuTtSsRrQq"}).json()
        self.assertIn("BARK_KEY_IPHONE", body["written"])
        self.assertIn("BARK_KEY_IPHONE=ZzYyXxWwVvUuTtSsRrQq", _ENV.read_text(encoding="utf-8"))
        aliases = [d["alias"] for d in body["devices"]]
        self.assertIn("iphone", aliases)
        self.assertNotIn("ZzYyXxWwVvUuTtSsRrQq", str(body))
        after = self.client.delete(f"{self.prefix}/device/iphone").json()
        self.assertNotIn("iphone", [d["alias"] for d in after["devices"]])
        self.assertNotIn("BARK_KEY_IPHONE", _ENV.read_text(encoding="utf-8"))

    def test_dotenv_is_never_read_by_the_plugin(self):
        """Catalog rule 11: a key sitting only in the file (not in Hermes' view) stays invisible."""
        _ENV.write_text(f"BARK_TOKEN={DEVICE}\nBARK_KEY_GHOST=GgHhIiJjKkLlMmNnOoPp\n", encoding="utf-8")
        body = self.client.get(f"{self.prefix}/status?fresh=1").json()
        aliases = [d["alias"] for d in body["devices"]]
        self.assertNotIn("ghost", aliases)
        self.assertNotIn("GgHhIiJjKkLlMmNnOoPp", str(body))

    def test_device_validation(self):
        self.assertEqual(self.client.post(f"{self.prefix}/device", json={"alias": "bad alias", "key": "x"}).status_code, 400)
        self.assertEqual(self.client.post(f"{self.prefix}/device", json={"alias": "ok", "key": ""}).status_code, 400)
        self.assertEqual(self.client.post(f"{self.prefix}/device", json={"alias": "ok", "key": "has space"}).status_code, 400)
        self.assertEqual(self.client.delete(f"{self.prefix}/device/bad%20alias").status_code, 400)

    def test_messages_localise_on_lang_param(self):
        """?lang=en must return English; anything else (including no param) stays Chinese."""
        cjk = re.compile(r"[\u4e00-\u9fff]")
        zh = self.client.get(f"{self.prefix}/status").json()
        en = self.client.get(f"{self.prefix}/status?lang=en").json()
        self.assertTrue(any(cjk.search(w["text"]) for w in zh["warnings"]), zh["warnings"])
        self.assertTrue(en["warnings"], "expected the auto-push-disabled warning")
        self.assertFalse(any(cjk.search(w["text"]) for w in en["warnings"]), en["warnings"])
        self.assertTrue(any("Automatic push" in w["text"] for w in en["warnings"]), en["warnings"])
        # zh* (and no param) stay Chinese; every other language code falls back to English.
        for lang in ("ja", "de", "fr-CA"):
            body = self.client.get(f"{self.prefix}/status?lang={lang}").json()
            self.assertFalse(any(cjk.search(w["text"]) for w in body["warnings"]), (lang, body["warnings"]))
        for lang in ("zh", "zh-hant", "zh-CN"):
            body = self.client.get(f"{self.prefix}/status?lang={lang}").json()
            self.assertTrue(any(cjk.search(w["text"]) for w in body["warnings"]), (lang, body["warnings"]))

    def test_errors_localise_on_lang_param(self):
        resp = self.client.post(f"{self.prefix}/device?lang=en", json={"alias": "ok", "key": "has space"})
        self.assertEqual(resp.status_code, 400)
        detail = resp.json()["detail"]
        self.assertIn("device key", detail)
        self.assertIsNone(re.compile(r"[\u4e00-\u9fff]").search(detail), detail)
        zh_detail = self.client.post(f"{self.prefix}/device", json={"alias": "ok", "key": "has space"}).json()["detail"]
        self.assertIsNotNone(re.compile(r"[\u4e00-\u9fff]").search(zh_detail), zh_detail)

    def test_events_list_and_clear(self):
        body = self.client.get(f"{self.prefix}/events?limit=5").json()
        self.assertIn("stats", body)
        self.assertTrue(self.client.delete(f"{self.prefix}/events").json()["ok"])
        self.assertEqual(self.client.get(f"{self.prefix}/events").json()["events"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
