#!/bin/zsh
# One-time setup: create a virtualenv and install dependencies.
cd "$(dirname "$0")"
python3 -m venv .venv || { echo "Python 3.11+ is required (python3 -m venv failed)"; exit 1; }
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
mkdir -p data
echo "Done. Start the dashboard with ./run.sh  (or DEMO=1 ./run.sh to try it with fake data)"
