#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ -x .venv/bin/python ]; then
  PYTHON=.venv/bin/python
else
  PYTHON=python3
fi
"$PYTHON" server.py
