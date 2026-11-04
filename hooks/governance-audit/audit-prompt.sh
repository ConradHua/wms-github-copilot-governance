#!/bin/bash

# Governance Audit: Scan user prompts for threat signals before agent processing
#
# Environment variables:
#   GOVERNANCE_LEVEL - "open", "standard", "strict", "locked" (default: standard)
#   BLOCK_ON_THREAT  - "true" to exit non-zero on threats (default: false)
#   SKIP_GOVERNANCE_AUDIT - "true" to disable (default: unset)

set -euo pipefail

if [[ "${SKIP_GOVERNANCE_AUDIT:-}" == "true" ]]; then
  exit 0
fi

INPUT=$(cat)

mkdir -p logs/copilot/governance

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LEVEL="${GOVERNANCE_LEVEL:-standard}"
BLOCK="${BLOCK_ON_THREAT:-false}"
LOG_FILE="logs/copilot/governance/audit.log"

PROMPT=""
if command -v jq &>/dev/null; then
  if ! PROMPT=$(printf '%s' "$INPUT" | jq -er '(.prompt // .userMessage) | select(type == "string")' 2>/dev/null); then
    echo "Governance: invalid prompt event; refusing to scan." >&2
    exit 2
  fi
elif command -v node &>/dev/null; then
  if ! PROMPT=$(printf '%s' "$INPUT" | node -e '
    try {
      const event = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const prompt = event.prompt ?? event.userMessage;
      if (typeof prompt !== "string") process.exit(2);
      process.stdout.write(prompt);
    } catch { process.exit(2); }
  ' 2>/dev/null); then
    echo "Governance: invalid prompt event; refusing to scan." >&2
    exit 2
  fi
else
  echo "Governance: jq or Node.js is required; refusing to scan." >&2
  exit 2
fi

case "$LEVEL" in
  open|standard|strict|locked) ;;
  *) echo "Governance: invalid governance level." >&2; exit 2 ;;
esac

# Threat detection patterns organized by category
# Each pattern has: category, description, severity (0.0-1.0)
THREATS_FOUND=()

check_pattern() {
  local pattern="$1"
  local category="$2"
  local severity="$3"
  local description="$4"

  local status=0
  grep -iE -- "$pattern" <<< "$PROMPT" >/dev/null || status=$?
  if [[ "$status" -eq 0 ]]; then
    THREATS_FOUND+=("$category	$severity	$description")
  elif [[ "$status" -ne 1 ]]; then
    echo "Governance: scanner rule failed." >&2
    exit 2
  fi
}

# Data exfiltration signals
check_pattern "send\s+(all|every|entire)\s+\w+\s+to\s+" "data_exfiltration" "0.8" "Bulk data transfer"
check_pattern "export\s+.*\s+to\s+(external|outside|third[_-]?party)" "data_exfiltration" "0.9" "External export"
check_pattern "curl\s+.*\s+-d\s+" "data_exfiltration" "0.7" "HTTP POST with data"
check_pattern "upload\s+.*\s+(credentials|secrets|keys)" "data_exfiltration" "0.95" "Credential upload"

# Privilege escalation signals
check_pattern "(sudo|as\s+root|admin\s+access|runas\s+/user)" "privilege_escalation" "0.8" "Elevated privileges"
check_pattern "chmod\s+777" "privilege_escalation" "0.9" "World-writable permissions"
check_pattern "add\s+.*\s+(sudoers|administrators)" "privilege_escalation" "0.95" "Adding admin access"

# System destruction signals
check_pattern "(rm\s+-rf\s+/|del\s+/[sq]|format\s+c:)" "system_destruction" "0.95" "Destructive command"
check_pattern "(drop\s+database|truncate\s+table|delete\s+from\s+\w+\s*(;|\s*$))" "system_destruction" "0.9" "Database destruction"
check_pattern "wipe\s+(all|entire|every)" "system_destruction" "0.9" "Mass deletion"

# Prompt injection signals
check_pattern "ignore\s+(previous|above|all)\s+(instructions?|rules?|prompts?)" "prompt_injection" "0.9" "Instruction override"
check_pattern "you\s+are\s+now\s+(a|an)\s+(assistant|ai|bot|system|expert|language\s+model)\b" "prompt_injection" "0.7" "Role reassignment"
check_pattern "(^|\n)\s*system\s*:\s*you\s+are" "prompt_injection" "0.6" "System prompt injection"

# Credential exposure signals
check_pattern '(bearer|basic)[[:space:]]+[[:alnum:]_./+~=-]{4,}' "credential_exposure" "0.95" "Authorization credential"
check_pattern "(authorization|proxy[_-]?authorization|x[_-]?api[_-]?key|api[ _-]?key|apikey|secret([ _-]?key)?|client[ _-]?secret|password|passwd|pwd|access[ _-]?token|refresh[ _-]?token|id[ _-]?token|token|aws[ _-]?access[ _-]?key[ _-]?id|aws[ _-]?secret[ _-]?access[ _-]?key|accountkey|sharedaccesskey|sig|密钥|密码|令牌)['\"]?[[:space:]]*[:=][[:space:]]*['\"]?[^[:space:]\"',;{}<>]{4,}" "credential_exposure" "0.9" "Sensitive field assignment"
check_pattern '(^|[^[:alnum:]_])(sk-[[:alnum:]_-]{16,}|AIza[[:alnum:]_-]{30,}|gh[pousr]_[[:alnum:]]{20,}|github_pat_[[:alnum:]_]{20,}|xox[baprs]-[[:alnum:]-]{10,}|(AKIA|ASIA)[A-Z0-9]{16}|(sk|rk)_(live|test)_[[:alnum:]]{12,}|npm_[[:alnum:]]{20,}|glpat-[[:alnum:]_-]{16,})' "credential_exposure" "0.95" "Known API token format"
check_pattern 'eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}' "credential_exposure" "0.95" "JWT credential"
check_pattern '-----BEGIN ([A-Z0-9]+[[:space:]])*PRIVATE KEY-----' "credential_exposure" "1.0" "Private key material"
check_pattern '[[:alpha:]][[:alnum:]+.-]*://[^[:space:]/:@]+:[^[:space:]/@]+@' "credential_exposure" "0.95" "URL embedded credentials"
check_pattern '(AccountKey|SharedAccessKey|SharedAccessSignature|Password)[[:space:]]*=[[:space:]]*[^;[:space:]]{4,}' "credential_exposure" "0.95" "Connection string credential"
check_pattern '(api[ _-]?key|secret[ _-]?key|access[ _-]?token|client[ _-]?secret)[[:space:]]+(is[[:space:]]+)?[[:alnum:]_./+~-]{16,}' "credential_exposure" "0.85" "Credential in prose"

# Log the prompt event
if [[ ${#THREATS_FOUND[@]} -gt 0 ]]; then
  # Build threats JSON array
  THREATS_JSON="["
  FIRST=true
  MAX_SEVERITY="0.0"
  for threat in "${THREATS_FOUND[@]}"; do
    IFS=$'\t' read -r category severity description <<< "$threat"
    evidence="[redacted]"

    if [[ "$FIRST" != "true" ]]; then
      THREATS_JSON+=","
    fi
    FIRST=false

    if command -v jq &>/dev/null; then
      THREATS_JSON+=$(jq -Rn \
        --arg cat "$category" \
        --arg sev "$severity" \
        --arg desc "$description" \
        --arg ev "$evidence" \
        '{"category":$cat,"severity":($sev|tonumber),"description":$desc,"evidence":$ev}')
    else
      ev_escaped=$(printf '%s' "$evidence" | sed 's/\\/\\\\/g; s/"/\\"/g')
      THREATS_JSON+=$(printf '{"category":"%s","severity":%s,"description":"%s","evidence":"%s"}' \
        "$category" "$severity" "$description" "$ev_escaped")
    fi

    # Track max severity (works with or without bc)
    if awk "BEGIN {exit !($severity > $MAX_SEVERITY)}" 2>/dev/null; then
      MAX_SEVERITY="$severity"
    fi
  done
  THREATS_JSON+="]"

  if command -v jq &>/dev/null; then
    jq -Rn \
      --arg timestamp "$TIMESTAMP" \
      --arg level "$LEVEL" \
      --arg max_severity "$MAX_SEVERITY" \
      --argjson threats "$THREATS_JSON" \
      --argjson count "${#THREATS_FOUND[@]}" \
      '{"timestamp":$timestamp,"event":"threat_detected","governance_level":$level,"threat_count":$count,"max_severity":($max_severity|tonumber),"threats":$threats}' \
      >> "$LOG_FILE"
  else
    printf '{"timestamp":"%s","event":"threat_detected","governance_level":"%s","threat_count":%d,"max_severity":%s,"threats":%s}\n' \
      "$TIMESTAMP" "$LEVEL" "${#THREATS_FOUND[@]}" "$MAX_SEVERITY" "$THREATS_JSON" >> "$LOG_FILE"
  fi

  echo "⚠️ Governance: ${#THREATS_FOUND[@]} threat signal(s) detected (max severity: $MAX_SEVERITY)" >&2
  for threat in "${THREATS_FOUND[@]}"; do
    IFS=$'\t' read -r category severity description <<< "$threat"
    echo "  🔴 [$category] $description (severity: $severity)" >&2
  done

  # In strict/locked mode or when BLOCK_ON_THREAT is true, exit non-zero to block
  if [[ "$LEVEL" != "open" ]] && { [[ "$BLOCK" == "true" ]] || [[ "$LEVEL" == "strict" ]] || [[ "$LEVEL" == "locked" ]]; }; then
    echo "Governance: blocking requested (level: $LEVEL); enforcement depends on the hook runtime." >&2
    exit 2
  fi
else
  if command -v jq &>/dev/null; then
    jq -Rn \
      --arg timestamp "$TIMESTAMP" \
      --arg level "$LEVEL" \
      '{"timestamp":$timestamp,"event":"prompt_scanned","governance_level":$level,"status":"clean"}' \
      >> "$LOG_FILE"
  else
    printf '{"timestamp":"%s","event":"prompt_scanned","governance_level":"%s","status":"clean"}\n' \
      "$TIMESTAMP" "$LEVEL" >> "$LOG_FILE"
  fi
fi

exit 0
