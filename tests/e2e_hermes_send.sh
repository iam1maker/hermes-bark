#!/usr/bin/env bash
# End-to-end: a temp HERMES_HOME with the plugin installed, a fake Bark server,
# and the real `hermes send` CLI. Proves the out-of-process standalone sender
# (the cron path) works without a running gateway.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="${PORT:-18099}"
LOG="$TMP/bark.jsonl"
SRV_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  wait "$SRV_PID" 2>/dev/null
  echo "--- fake server log ---"
  cat "$TMP/server.log" 2>/dev/null
  echo "--- requests ---"
  cat "$LOG" 2>/dev/null
  echo "--- temp home kept at $TMP ---"
}
trap cleanup EXIT

python3 "$ROOT/tests/fake_bark.py" --port "$PORT" --log "$LOG" > "$TMP/server.log" 2>&1 &
SRV_PID=$!
sleep 1

mkdir -p "$TMP/plugins"
cp -R "$ROOT" "$TMP/plugins/hermes-bark"

cat > "$TMP/config.yaml" <<YAML
plugins:
  enabled: [hermes-bark]
platforms:
  bark:
    extra:
      server: http://127.0.0.1:$PORT
      default_device: test
      devices:
        test: {key: AbCdEfGhIjKlMnOpQrStUv}
      defaults:
        level: timeSensitive
        group: HermesE2E
YAML

echo "=== 1. hermes send --to bark:test ==="
OUT=$(HERMES_HOME="$TMP" hermes send --to bark:test "e2e hello 中文 & symbols" --json 2>&1)
RC=$?
echo "$OUT"
echo "rc=$RC"

echo "=== 2. hermes send --to bark (home channel default) ==="
OUT2=$(HERMES_HOME="$TMP" hermes send --to bark "home channel" 2>&1)
RC2=$?
echo "$OUT2"
echo "rc=$RC2"

echo "=== verdict ==="
python3 - "$LOG" "$RC" "$RC2" <<'PY'
import json, sys
log_path, rc1, rc2 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rows = [json.loads(line) for line in open(log_path, encoding="utf-8")]
print(f"requests received: {len(rows)}")
ok = len(rows) == 2
for i, row in enumerate(rows, 1):
    p = row["payload"]
    print(f"  [{i}] path={row['path']} device_key={p.get('device_key')} level={p.get('level')} "
          f"group={p.get('group')} body={p.get('body')!r}")
    ok = ok and p.get("device_key") == "AbCdEfGhIjKlMnOpQrStUv"
ok = ok and rc1 == 0 and rc2 == 0
ok = ok and rows[0]["payload"].get("body") == "e2e hello 中文 & symbols"
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
PY
exit $?
