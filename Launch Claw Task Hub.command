#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

mkdir -p logs

if [ ! -d node_modules ]; then
  if ! npm ci >> logs/claw-task-hub-launcher.out.log 2>> logs/claw-task-hub-launcher.err.log; then
    npm install >> logs/claw-task-hub-launcher.out.log 2>> logs/claw-task-hub-launcher.err.log
  fi
fi

npm run pilot:start

if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173" >/dev/null 2>&1 &
else
  printf '%s\n' "Claw Task Hub is available at http://localhost:5173"
fi
