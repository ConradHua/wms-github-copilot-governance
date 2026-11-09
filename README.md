# WMS AI Coding Guidelines & Governance (`wms-github-copilot-governance`)

> **English** | [简体中文](./README.zh-CN.md)

## 1. Overview

### Purpose
Standard AI coding assistants do not automatically understand the specific architecture, business boundaries, or security rules of our **WMS–SAP Integration** system. Without proper guidance, AI may generate code that violates layer boundaries, causes duplicate SAP postings, leaks sensitive credentials, or introduces non-compliant third-party dependencies.

This repository provides a complete **AI Coding Governance Package** designed to:
1. **Standardize AI Code Generation**: Teach AI our exact tech stack, architectural boundaries, and domain rules before it writes a single line of code.
2. **Enforce Quality & Security Reviews**: Provide specialized AI reviewer personas to inspect code before merging.
3. **Automate Safety & Compliance Guardrails**: Run background hooks to mask secrets, block destructive commands, verify open-source licenses, and auto-backup work.

### Cross-Platform Compatibility (AI Harnesses)
Although this repository uses **GitHub Copilot** as its primary reference implementation, the rules, prompts, skills, and hook scripts are **platform-agnostic** and can be directly applied to other mainstream AI coding harnesses and IDEs, including:
- **GitHub Copilot** (VS Code / JetBrains / CLI)
- **Cursor** (`.cursor/rules` / Project Rules)
- **OpenAI Codex / Claude Code / Windsurf** and other agentic coding tools

### Core Modules Included
| Module | Directory | Role in One Sentence |
| :--- | :--- | :--- |
| **1. Instructions** | [`instructions/`](./instructions/) | The **"Onboarding Manual"** that tells AI how to write code for our WMS tech stack and domain. |
| **2. Agents** | [`agents/`](./agents/) | On-demand **"Virtual Experts"** (Code Reviewer & Security Auditor) for pre-merge inspections. |
| **3. Skills** | [`skills/`](./skills/) | Step-by-step **"Security Playbooks"** with checklists and code patterns for sensitive features. |
| **4. Hooks** | [`hooks/`](./hooks/) | Automated **"Background Guards"** for secret masking, threat blocking, license checking, and Git backup. |

---

## 2. Detailed Breakdown of Each Module

### 2.1 Instructions — *The "Onboarding Manual" for AI*
Located in [`instructions/`](./instructions/), these files establish the ground rules for our tech stack (**.NET 10 / ASP.NET Core Web API, NServiceBus, RabbitMQ, Oracle, SAP NCo 3.1**):

- **General Instructions ([`copilot-instructions.md`](./instructions/copilot-instructions.md))**
  - Defines strict **layer boundaries** (Controller vs. Service vs. Message Handler vs. SAP Adapter vs. Oracle Repository).
  - Enforces **delivery baselines**: idempotency via stable `wmsReceiptId` / `OperationId`, transactional consistency before returning HTTP `202`, crash-safe execution markers before calling SAP, and strict handling of `UNKNOWN` SAP states to prevent duplicate postings.
  - Prohibits hardcoding credentials, bypassing validation, or making unrequested sweeping refactorings.
- **Oracle Database Rules ([`Oracle.instructions.md`](./instructions/instructions/Oracle.instructions.md))**
  - Governs parameterized SQL queries, schema configuration (`WMSNCO` / `WMSFESSAP`), transaction boundaries, and conditional state updates.
- **REST API Rules ([`Rest-API.instructions.md`](./instructions/instructions/Rest-API.instructions.md))**
  - Standardizes PDA/WMS HTTP endpoints, DTO validation, authentication/authorization checks, and proper HTTP status code usage.
- **SAP RFC Rules ([`SAP_RFC.instructions.md`](./instructions/instructions/SAP_RFC.instructions.md))**
  - Regulates SAP NCo 3.1 calls, BAPI invocation, data type formatting (preserving leading zeros on strings and exact `decimal` quantities), and lock/timeout recovery strategies.

---

### 2.2 Agents — *On-Demand "Virtual Experts"*
Located in [`agents/`](./agents/), these are specialized AI personas that developers can invoke during development or before submitting a Pull Request:

- **Senior Code Reviewer ([`code-reviewer.md`](./agents/code-reviewer.md) | [中文](./agents/code-reviewer.zh-CN.md))**
  - Evaluates proposed code changes across **5 key dimensions**:
    1. **Correctness**: Edge cases, null handling, race conditions, and test coverage.
    2. **Readability**: Naming conventions, control flow clarity, and code organization.
    3. **Architecture**: Module boundaries, dependency direction, and alignment with existing patterns.
    4. **Security**: Input sanitization, secret exclusion, and parameterized queries.
    5. **Performance**: Prevention of N+1 queries, unbounded loops, and blocking synchronous I/O.
- **Security Auditor ([`security-auditor.md`](./agents/security-auditor.md) | [中文](./agents/security-auditor.zh-CN.md))**
  - Acts as a dedicated security engineer focusing on **exploitable vulnerabilities**:
    - Input handling & injection prevention (SQL, OS command, XSS, SSRF).
    - Authentication, session management, and access control (IDOR prevention).
    - Data protection (secrets management, PII handling, encryption in transit/at rest).
    - Infrastructure headers, third-party webhook verification, and LLM prompt-injection defenses.

---

### 2.3 Skills — *The "Security Playbook"*
Located in [`skills/security-and-hardening/`](./skills/security-and-hardening/), this module equips the AI with structured workflows when building security-sensitive features (such as login flows, file uploads, external API integrations, or handling sensitive data):

- **Security & Hardening Skill ([`SKILL.md`](./skills/security-and-hardening/SKILL.md) | [中文](./skills/security-and-hardening/SKILL.zh-CN.md))**
  - Guides AI to perform quick **STRIDE threat modeling** (identifying trust boundaries and assets) before writing code.
  - Enforces a three-tier boundary system (*Must Do*, *Should Do*, *Never Do*).
- **Reference Checklists & Patterns**
  - **Hardening Patterns ([`hardening-patterns.md`](./skills/security-and-hardening/references/hardening-patterns.md) | [中文](./skills/security-and-hardening/references/hardening-patterns.zh-CN.md))**: Concrete secure coding patterns and remediations.
  - **Security Checklist ([`security-checklist.md`](./skills/security-and-hardening/references/security-checklist.md) | [中文](./skills/security-and-hardening/references/security-checklist.zh-CN.md))**: Pre-release verification checklist mapped to OWASP Top 10 risks.

---

### 2.4 Hooks — *Automated "Background Guards"*
Located in [`hooks/`](./hooks/), these automated scripts run at key lifecycle events (such as session start, prompt submission, tool execution, and session end) without requiring manual effort from developers:

- **Governance Audit Hook ([`governance-audit/`](./hooks/governance-audit/README.md) | [中文](./hooks/governance-audit/README.zh-CN.md))**
  - **Prompt Redaction**: Automatically masks passwords, API keys, tokens, and personal data before they are sent to the AI model.
  - **Real-Time Threat Detection & Blocking**: Scans for high-risk actions (`data_exfiltration`, `privilege_escalation`, `system_destruction` like `DROP TABLE` or `git reset --hard`, `prompt_injection`, and `credential_exposure`). Blocks tool execution until a human explicitly confirms with a verification phrase.
  - **Audit Logging & Reporting**: Appends structured JSON Lines records to `logs/copilot/governance/audit.log` and includes a summary report generator (`report.cjs`).
- **Dependency License Checker ([`dependency-license-checker/`](./hooks/dependency-license-checker/README.md))**
  - Automatically scans newly added dependencies (`git diff`) at the end of an AI coding session across multiple ecosystems (npm, pip, Go, Ruby, Rust).
  - Flags or blocks restrictive/copyleft open-source licenses (such as **GPL, AGPL, SSPL**) before code is committed, protecting the project from legal compliance risks.
- **Session Auto-Commit ([`session-auto-commit/`](./hooks/session-auto-commit/README.md) | [中文](./hooks/session-auto-commit/README.zh-CN.md))**
  - Automatically stages, commits (with a timestamp), and pushes uncommitted changes when an AI coding agent session ends, ensuring no work is accidentally lost.

---

## 3. Repository Structure

```text
wms-github-copilot-governance/
├── README.md                          # English project overview (this file)
├── README.zh-CN.md                    # Chinese project overview
├── instructions/                      # 1. AI Coding Rules & Domain Instructions
│   ├── copilot-instructions.md        #    - Master WMS-SAP architecture & delivery rules
│   └── instructions/
│       ├── Oracle.instructions.md     #    - Oracle SQL & transaction rules
│       ├── Rest-API.instructions.md   #    - PDA/WMS HTTP API rules
│       └── SAP_RFC.instructions.md    #    - SAP NCo / BAPI integration rules
├── agents/                            # 2. On-Demand Virtual Expert Personas
│   ├── code-reviewer.md               #    - 5-dimension Senior Code Reviewer (EN/ZH)
│   └── security-auditor.md            #    - Vulnerability & threat Security Auditor (EN/ZH)
├── skills/                            # 3. Domain Playbooks & Reference Checklists
│   └── security-and-hardening/        #    - OWASP / STRIDE security hardening skill & checklists
└── hooks/                             # 4. Automated Lifecycle Safety Hooks
    ├── governance-audit/              #    - Prompt redaction, threat blocking & audit logs
    ├── dependency-license-checker/    #    - Open-source license compliance scanner
    └── session-auto-commit/           #    - Automated Git commit & backup at session end
```

