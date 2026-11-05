---
name: 'Governance Audit'
description: 'Scans Copilot agent prompts for threat signals and logs governance events'
tags: ['security', 'governance', 'audit', 'safety']
---

# Governance Audit Hook

Real-time threat detection, prompt redaction, tool gating, and audit logging for GitHub Copilot coding agent sessions. The hook scans both the submitted prompt and the transformed, model-facing prompt.

## Overview

This hook provides governance controls for Copilot sessions:
- **Threat detection**: Checks for data exfiltration, privilege escalation, destructive operations, prompt injection, and credential exposure. Rules are heuristic signals, not a complete security classifier.
- **Prompt protection**: Redacts recognized secrets and personal data in model-facing prompt content by default. When a threat is enforced, a guard instruction is added to the transformed prompt and tool calls are denied until the request is resolved.
- **Explicit resolution**: A detected request requires a separate exact user message, `确认高危操作 <request-id>`, or `取消高危操作 <request-id>`. Generic replies, quoted text, and authorization included in the original request do not count.
- **Audit trail**: Appends JSON Lines events to `logs/copilot/governance/audit.log`; per-session pending state is stored under `.state/` in the same directory.
- **Report**: `node .github/hooks/governance-audit/report.cjs` summarizes recorded sessions and recent risk events after installation. In this repository's source layout, use `node hooks/governance-audit/report.cjs` instead.

## Installation

The checked-in `hooks.json` uses `.github/hooks/governance-audit/governance.cjs` as its command path. Place this directory at `.github/hooks/governance-audit/` in the target repository, and register `hooks.json` with the Copilot hooks configuration for the environment in use. The hook requires Node.js and Git for repository metadata; if Git metadata is unavailable, auditing continues with `repository: null`.

The hook writes logs relative to its current working directory (`cwd` is `.` in the provided configuration). Ensure that directory is writable and protect audit logs because they contain redacted prompt previews and tool argument previews.

## Threat Categories
| Category | Examples | Current severity |
|----------|----------|------------------|
| `data_exfiltration` | Sending all data externally, uploading credentials, `curl` with data | `0.9` |
| `privilege_escalation` | `sudo`, `chmod 777`, granting administrator/root access | `0.9` |
| `system_destruction` | Recursive removal, `git reset --hard`, `DROP` / `TRUNCATE` / `DELETE FROM` | `0.95` |
| `prompt_injection` | “ignore previous instructions”, attempts to override rules | `0.9` |
| `credential_exposure` | Recognized credential assignments, tokens, private keys | `0.95` |

Detection uses regular-expression rules in `governance.cjs` and `redact-prompt.cjs`. A match can be a false positive (for example, quoted examples); review the actual request before approving it. A clean scan does not guarantee that a request is safe.

## Governance Levels

| Level | Behavior |
|-------|----------|
| `open` | Log threats only, never block |
| `standard` | Block detected threats by default; `BLOCK_ON_THREAT=false` makes it audit-only |
| `strict` | Always block detected threats; `BLOCK_ON_THREAT=false` does not disable enforcement |
| `locked` | Always block detected threats; `BLOCK_ON_THREAT=false` does not disable enforcement |

The provided `hooks.json` sets `GOVERNANCE_LEVEL=standard` and `BLOCK_ON_THREAT=true` for prompt scans. `open` disables blocking regardless of `BLOCK_ON_THREAT`; `strict` and `locked` enforce blocking regardless of that flag. `SKIP_GOVERNANCE_AUDIT=true` bypasses the hook and should only be used as an explicit operational override.

## Event Flow

1. `sessionStart` adds governance context and records session/repository metadata.
2. `userPromptSubmitted` scans the user message and records a redacted preview and hash.
3. `userPromptTransformed` scans the model-facing content as well, redacts it, and injects a guard when a blocking request is pending.
4. `preToolUse` denies tool calls while a request is pending. Clean requests are left to normal host permission handling; the hook does not grant tool permission.
5. `postToolUse`, `postToolUseFailure`, `agentStop`, and `sessionEnd` record tool outcomes and lifecycle events. A turn ending does not clear a pending confirmation.

On a block, explain the operation, scope, and risks in ordinary chat, then ask the user to send the exact confirmation or cancellation message with the displayed request ID as a separate message. A confirmation applies only to that request. Cancellation marks that request cancelled; it does not approve it.

## Configuration

| Variable | Values | Default / effect |
|----------|--------|------------------|
| `GOVERNANCE_LEVEL` | `open`, `standard`, `strict`, `locked` | `standard`; invalid values fail closed |
| `BLOCK_ON_THREAT` | `true`, `false` | `true`; only `false` with `standard` makes scans audit-only |
| `ENABLE_PROMPT_REDACTION` | `true`, `false` | Enabled unless explicitly `false`; controls redaction of transformed prompt content |
| `SKIP_GOVERNANCE_AUDIT` | `true` | Bypasses auditing when set to `true` |

The standalone `redact-prompt.cjs` command can be used as a prompt-transformation hook. It emits `modifiedTransformedPrompt` only when content changes. When configured as a separate hook, avoid registering it redundantly alongside the integrated redaction in `governance.cjs` unless the runtime setup requires both.

## Logs and Reporting

- `logs/copilot/governance/audit.log`: append-only JSON Lines, schema version 2; each record includes event and policy versions, timestamps, session/request identifiers, enforcement state, and event-specific details.
- `logs/copilot/governance/.state/`: hashed per-session state used to preserve active and pending requests across hook invocations. Do not edit or delete state while a request is pending.
- From the repository root after installation, run `node .github/hooks/governance-audit/report.cjs` to print summaries for the latest sessions. In the source repository layout, use `node hooks/governance-audit/report.cjs`. Append a session ID to filter the report, for example `node .github/hooks/governance-audit/report.cjs <session-id>`.

Prompt previews are truncated at 2,000 characters. Recognized credentials, private keys, email addresses, and Chinese mobile numbers are redacted before prompt previews and tool argument previews are logged. Redaction is pattern-based and cannot guarantee that all sensitive data is removed; apply appropriate access controls and retention policies to the logs. The report summarizes existing records; it does not change policy state or decide whether a request is safe.