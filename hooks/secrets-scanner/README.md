---
name: 'Secrets Scanner'
description: 'Scans files modified during a Copilot coding agent session for leaked secrets, credentials, and sensitive data'
tags: ['security', 'secrets', 'scanning', 'session-end']
---

# Secrets Scanner Hook

Scans files modified during a GitHub Copilot coding agent session for accidentally leaked secrets, credentials, API keys, and other sensitive data before they are committed.

## Overview

AI coding agents generate and modify code rapidly, which increases the risk of hardcoded secrets slipping into the codebase. This hook acts as a safety net by scanning all modified files at session end for 20+ categories of secret patterns, including:

- **Cloud credentials**: AWS access keys, GCP service account keys, Azure client secrets
- **Platform tokens**: GitHub PATs, npm tokens, Slack tokens, Stripe keys
- **Private keys**: RSA, EC, OpenSSH, PGP, DSA private key blocks
- **Connection strings**: Database URIs (PostgreSQL, MongoDB, MySQL, Redis, MSSQL)
- **Generic secrets**: API keys, passwords, bearer tokens, JWTs
- **Internal infrastructure**: Private IP addresses with ports

## Features

- **Two scan modes**: `warn` (log only) or `block` (exit non-zero to prevent commit)
- **Two scan scopes**: `diff` (modified files vs HEAD) or `staged` (git-staged files only)
- **Smart filtering**: Skips binary files, lock files, and placeholder/example values
- **Allowlist support**: Exclude known false positives via `SECRETS_ALLOWLIST`
- **Structured logging**: JSON Lines output for integration with monitoring tools
- **Redacted output**: Findings are truncated in logs to avoid re-exposing secrets
- **Zero dependencies**: Uses only standard Unix tools (`grep`, `file`, `git`)