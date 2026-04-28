#!/bin/bash
# lint_backend.sh — runs Python linters on a file
# Usage: bash scripts/lint_backend.sh <filepath>

FILE=$1

if [ -z "$FILE" ]; then
  echo "Usage: lint_backend.sh <filepath>"
  exit 1
fi

echo "=== Linting: $FILE ==="

# Try ruff (fast modern linter)
if command -v ruff &> /dev/null; then
  echo "--- Ruff ---"
  ruff check "$FILE" 2>&1 || true
else
  echo "Ruff not found — trying flake8"
  # Fallback to flake8
  if command -v flake8 &> /dev/null; then
    echo "--- Flake8 ---"
    flake8 "$FILE" 2>&1 || true
  else
    echo "No Python linter found. Install ruff: pip install ruff"
  fi
fi

# Try mypy for type checking
if command -v mypy &> /dev/null; then
  echo "--- MyPy Type Check ---"
  mypy "$FILE" --ignore-missing-imports 2>&1 | head -20 || true
else
  echo "MyPy not found — skipping type check"
fi

echo "=== Done ==="
