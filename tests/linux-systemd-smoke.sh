#!/bin/sh
# Run only in a disposable Linux user session; never replace an installation.
set -eu
cd "$(dirname "$0")/.."
repo=$(pwd -P)
config=${XDG_CONFIG_HOME:-$HOME/.config}
data=${XDG_DATA_HOME:-$HOME/.local/share}
unit=claw-task-hub.service
for file in "$config/systemd/user/$unit" "$data/applications/claw-task-hub.desktop" "$config/claw-task-hub/desktop.json"; do
  if [ -e "$file" ]; then echo "Refusing existing integration: $file" >&2; exit 1; fi
done
if systemctl --user cat "$unit" >/dev/null 2>&1; then
  echo 'Refusing an existing systemd unit' >&2; exit 1
fi
scratch=$(mktemp -d)
installed=false
occupier=
cleanup() {
  status=$?
  trap - EXIT
  if [ -f "$scratch/runtime.json" ]; then cp "$scratch/runtime.json" "$repo/dist/cth-runtime.json" || status=1; fi
  [ -z "$occupier" ] || kill "$occupier" 2>/dev/null || true
  if [ "$installed" = true ]; then npm run linux:uninstall || status=1; fi
  rm -rf "$scratch" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
mkdir "$scratch/bin"
printf '#!/bin/sh\nprintf "%%s\\n" "$1" >> "%s/opened"\n' "$scratch" > "$scratch/bin/xdg-open"
chmod +x "$scratch/bin/xdg-open"
export PATH="$scratch/bin:$PATH"
export CLAW_TASK_HUB_DB="$scratch/test.sqlite"
installed=true
npm run linux:install
desktop-file-validate "$data/applications/claw-task-hub.desktop"
if systemctl --user is-enabled --quiet "$unit"; then echo 'Unexpected autostart' >&2; exit 1; fi
# A later incompatible build must not be approved by the menu launcher.
cp dist/cth-runtime.json "$scratch/runtime.json"
printf '%s' '{"apiBase":"http://127.0.0.1:9999/api"}' > dist/cth-runtime.json
if npm run linux:open; then echo 'Unexpected launch with incompatible build' >&2; exit 1; fi
cp "$scratch/runtime.json" dist/cth-runtime.json
npm run linux:open
first=$(systemctl --user show "$unit" -p MainPID --value)
npm run linux:open
test "$first" = "$(systemctl --user show "$unit" -p MainPID --value)"
test "$(wc -l < "$scratch/opened")" -eq 2
curl -fsS http://127.0.0.1:4781/api/health
npm run hub -- tools/call list_projects '{}'

# A killed API child must recover as one service, not leave a stale UI parent.
group=$(systemctl --user show "$unit" -p ControlGroup --value)
api=
for pid in $(cat "/sys/fs/cgroup$group/cgroup.procs"); do
  if tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q 'server/index.ts'; then api=$pid; fi
done
test -n "$api"
kill -KILL "$api"
recovered=false
for attempt in $(seq 1 30); do
  if systemctl --user is-active --quiet "$unit" &&
    curl -fsS --max-time 1 http://127.0.0.1:4781/api/health >/dev/null 2>&1 &&
    curl -fsS --max-time 1 http://127.0.0.1:5173 >/dev/null 2>&1 &&
    [ "$first" != "$(systemctl --user show "$unit" -p MainPID --value)" ]; then
    recovered=true; break
  fi
  sleep 1
done
test "$recovered" = true
test "$first" != "$(systemctl --user show "$unit" -p MainPID --value)"

systemctl --user stop "$unit"
if curl -fsS --max-time 2 http://127.0.0.1:4781/api/health >/dev/null 2>&1; then exit 1; fi
if curl -fsS --max-time 2 http://127.0.0.1:5173 >/dev/null 2>&1; then exit 1; fi

# An occupied port is not another instance to kill or silently bypass.
node -e 'require("node:http").createServer((q,s)=>s.end("other app")).listen(5173,"127.0.0.1")' &
occupier=$!
sleep 1
if npm run linux:open; then echo 'Unexpected launch with occupied port' >&2; exit 1; fi
kill -0 "$occupier"
kill "$occupier"
wait "$occupier" || true
occupier=
npm run linux:install -- --autostart
systemctl --user is-enabled --quiet "$unit"
npm run linux:uninstall
installed=false
test -f "$scratch/test.sqlite"
test ! -e "$config/systemd/user/$unit"
test ! -e "$data/applications/claw-task-hub.desktop"
echo 'Linux systemd lifecycle smoke passed; database preserved.'
