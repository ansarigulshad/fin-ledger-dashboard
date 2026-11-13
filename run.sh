#!/bin/zsh
# Start the Family Kite Dashboard.  Usage:  ./run.sh        (real accounts)
#                                            DEMO=1 ./run.sh (fake data preview)
cd "$(dirname "$0")"
source .venv/bin/activate
PORT="${PORT:-8765}"
echo "Dashboard -> http://127.0.0.1:$PORT  ${DEMO:+(demo mode)}"
if [ "${RELOAD:-1}" = "0" ]; then
  exec uvicorn server.app:app --host 127.0.0.1 --port "$PORT"
else
  exec uvicorn server.app:app --host 127.0.0.1 --port "$PORT" --reload --reload-dir server --reload-dir web
fi
