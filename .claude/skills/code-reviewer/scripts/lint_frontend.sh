#!/bin/bash
# lint_frontend.sh — runs available JS/TS linters on a file
# Usage: bash scripts/lint_frontend.sh <filepath>

FILE=$1

if [ -z "$FILE" ]; then
  echo "Usage: lint_frontend.sh <filepath>"
  exit 1
fi

echo "=== Linting: $FILE ==="

# Try ESLint first
if command -v npx &> /dev/null && [ -f ".eslintrc*" -o -f "eslint.config*" ]; then
  echo "--- ESLint ---"
  npx eslint "$FILE" --format=compact 2>&1 || true
else
  echo "ESLint not configured — skipping"
fi

# Try TypeScript compiler check
if command -v npx &> /dev/null && [ -f "tsconfig.json" ]; then
  echo "--- TypeScript Check ---"
  npx tsc --noEmit --skipLibCheck 2>&1 | head -30 || true
else
  echo "TypeScript not configured — skipping"
fi

echo "=== Done ==="
