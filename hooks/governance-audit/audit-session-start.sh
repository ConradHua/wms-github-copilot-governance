#!/bin/bash

# Governance Audit: Log session start with governance context

set -euo pipefail

if [[ "${SKIP_GOVERNANCE_AUDIT:-}" == "true" ]]; then
  exit 0
fi

INPUT=$(cat)

mkdir -p logs/copilot/governance

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
CWD=$(pwd)
LEVEL="${GOVERNANCE_LEVEL:-standard}"

if command -v jq &>/dev/null; then
  jq -Rn \
    --arg timestamp "$TIMESTAMP" \
    --arg cwd "$CWD" \
    --arg level "$LEVEL" \
    '{"timestamp":$timestamp,"event":"session_start","governance_level":$level,"cwd":$cwd}' \
    >> logs/copilot/governance/audit.log
else
  CWD_ESCAPED=$(printf '%s' "$CWD" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"timestamp":"%s","event":"session_start","governance_level":"%s","cwd":"%s"}\n' \
    "$TIMESTAMP" "$LEVEL" "$CWD_ESCAPED" >> logs/copilot/governance/audit.log
fi

echo "🛡️ Governance audit active (level: $LEVEL)"
exit 0
