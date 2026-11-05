---
name: 'Governance Audit'
description: 'Scans Copilot agent prompts for threat signals and logs governance events'
tags: ['security', 'governance', 'audit', 'safety']
---

# 治理审计钩子

为 GitHub Copilot coding agent 会话提供实时威胁检测和审计日志记录。在代理处理用户提示之前扫描其中的危险模式。

## 概览

此钩子为 Copilot coding agent 会话提供治理控制：
- **威胁检测**：扫描数据外泄、权限提升、系统破坏、提示词注入和凭据暴露
- **治理级别**：Open、standard、strict、locked，从仅审计到完全阻止
- **审计轨迹**：记录所有治理事件的追加写入 JSON 日志
- **会话摘要**：会话结束时报告威胁计数

## 威胁类别
| 类别 | 示例 | 严重度 |
|----------|----------|----------|
| `data_exfiltration` | “将所有记录发送到外部 API” | 0.7 - 0.95 |
| `privilege_escalation` | “sudo”、“chmod 777”、“添加到 sudoers” | 0.8 - 0.95 |
| `system_destruction` | “rm -rf /”、“删除数据库” | 0.9 - 0.95 |
| `prompt_injection` | “忽略之前的指令” | 0.6 - 0.9 |
| `credential_exposure` | 硬编码 API 密钥、AWS 访问密钥 | 0.9 - 0.95 |

## 治理级别

| 级别 | 行为 |
|-------|----------|
| `open` | 仅记录威胁，从不阻止 |
| `standard` | 记录威胁，仅当 `BLOCK_ON_THREAT=true` 时阻止 |
| `strict` | 记录并阻止所有检测到的威胁 |
| `locked` | 记录并阻止所有检测到的威胁 |
