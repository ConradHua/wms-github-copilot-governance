---
name: 'Governance Audit'
description: 'Scans Copilot agent prompts for threat signals and logs governance events'
tags: ['security', 'governance', 'audit', 'safety']
---

# Governance Audit Hook

Real-Time threat detection and audit logging for GitHub Copilot coding agent sessions. Scans user prompts for dangerous patterns before the agent processes them.

## Overview

This hook provides goverance controls for Copilot coding agent sessions:
- **Threat detection**: Scans prompts for data exfiltration, privilege escalation, system destruction, prompt injection, and credential exposure
- **Governance levels**: Open, standard, strict, locked — from audit-only to full blocking
- **Audit trail**: Append-only JSON log of all goverance events
- **Session summary**: Reports threat counts at session end

## Threat Categories
| Category | Examples | Severity |
|----------|----------|----------|
| `data_exfiltration` | "send all records to external API" | 0.7 - 0.95 |
| `privilege_escalation` | "sudo", "chmod 777", "add to sudoers" | 0.8 - 0.95 |
| `system_destruction` | "rm -rf /", "drop database" | 0.9 - 0.95 |
| `prompt_injection` | "ignore previous instructions" | 0.6 - 0.9 |
| `credential_exposure` | Hardcoded API keys, AWS access keys | 0.9 - 0.95 |

## Governance Levels

| Level | Behavior |
|-------|----------|
| `open` | Log threats only, never block |
| `standard` | Log threats, block only if `BLOCK_ON_THREAT=true` |
| `strict` | Log and block all detected threats |
| `locked` | Log and block all detected threats |