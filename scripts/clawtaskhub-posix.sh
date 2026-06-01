#!/usr/bin/env sh
set -eu

command_name=${1:-status}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
log_dir=${CLAW_TASK_HUB_LOG_DIR:-"$project_root/logs"}
pid_file=${CLAW_TASK_HUB_PID_FILE:-"$log_dir/claw-task-hub.pid"}
supervisor_log="$log_dir/claw-task-hub-supervisor.log"
ui_url=${CLAW_TASK_HUB_UI_URL:-"http://127.0.0.1:5173/"}
api_url=${CLAW_TASK_HUB_API_URL:-"http://127.0.0.1:4781/api/health"}

mkdir -p "$log_dir"

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$supervisor_log"
}

is_pid_running() {
  pid=${1:-}
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

read_pid() {
  [ -f "$pid_file" ] || return 1
  pid=$(cat "$pid_file" 2>/dev/null || true)
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s\n' "$pid" ;;
  esac
}

http_ok() {
  url=$1
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -T 3 -O /dev/null "$url" >/dev/null 2>&1
    return $?
  fi
  return 2
}

status() {
  if pid=$(read_pid) && is_pid_running "$pid"; then
    ui_ready=false
    api_ready=false
    http_ok "$ui_url" && ui_ready=true
    http_ok "$api_url" && api_ready=true
    printf 'running pid=%s ui=%s api=%s\n' "$pid" "$ui_ready" "$api_ready"
    return 0
  fi
  printf 'stopped\n'
  return 1
}

start() {
  if pid=$(read_pid) && is_pid_running "$pid"; then
    printf 'Claw Task Hub already running pid=%s\n' "$pid"
    return 0
  fi

  stamp=$(date -u '+%Y%m%d-%H%M%S')
  out_log="$log_dir/claw-task-hub-$stamp.out.log"
  err_log="$log_dir/claw-task-hub-$stamp.err.log"

  log "Starting Claw Task Hub from $project_root"
  cd "$project_root"

  if command -v setsid >/dev/null 2>&1; then
    setsid sh -c 'exec npm run dev' >"$out_log" 2>"$err_log" </dev/null &
  else
    nohup sh -c 'exec npm run dev' >"$out_log" 2>"$err_log" </dev/null &
  fi

  pid=$!
  printf '%s\n' "$pid" > "$pid_file"
  log "Started pid=$pid out=$out_log err=$err_log"

  deadline=$(( $(date +%s) + 45 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if ! is_pid_running "$pid"; then
      log "Process exited during readiness wait pid=$pid"
      rm -f "$pid_file"
      printf 'Claw Task Hub exited during startup. See %s and %s\n' "$out_log" "$err_log" >&2
      return 1
    fi
    if http_ok "$ui_url" && http_ok "$api_url"; then
      printf 'Claw Task Hub running pid=%s ui=%s api=%s\n' "$pid" "$ui_url" "$api_url"
      return 0
    fi
    sleep 2
  done

  log "Readiness timed out pid=$pid ui=$ui_url api=$api_url"
  printf 'Claw Task Hub started pid=%s but readiness timed out. See %s and %s\n' "$pid" "$out_log" "$err_log" >&2
  return 1
}

stop() {
  if ! pid=$(read_pid); then
    printf 'Claw Task Hub is not running\n'
    return 0
  fi
  if ! is_pid_running "$pid"; then
    rm -f "$pid_file"
    printf 'Claw Task Hub stale pid file removed\n'
    return 0
  fi

  log "Stopping Claw Task Hub pid=$pid"
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  deadline=$(( $(date +%s) + 20 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if ! is_pid_running "$pid"; then
      rm -f "$pid_file"
      printf 'Claw Task Hub stopped\n'
      return 0
    fi
    sleep 1
  done

  log "Force stopping Claw Task Hub pid=$pid"
  kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  printf 'Claw Task Hub force stopped\n'
}

case "$command_name" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  status)
    status
    ;;
  *)
    printf 'Usage: %s {start|stop|restart|status}\n' "$0" >&2
    exit 2
    ;;
esac
