---
name: 'Governance Audit'
description: 'Scans Copilot agent prompts for threat signals and logs governance events'
tags: ['security', 'governance', 'audit', 'safety']
---

# 治理审计钩子

为 GitHub Copilot 会话提供实时威胁检测、提示词脱敏、工具调用拦截和审计日志。钩子会扫描用户提交的提示词，以及转换后的模型输入内容。

## 概览

此钩子为 Copilot 会话提供以下治理能力：
- **威胁检测**：检查数据外泄、权限提升、破坏性操作、提示词注入和凭据暴露。规则基于启发式模式匹配，并非完整的安全分类器。
- **提示词保护**：默认对模型输入中的可识别凭据和个人数据脱敏。检测到需要拦截的威胁时，会在转换后的提示词中加入保护说明，并拒绝工具调用，直到该请求得到处理。
- **明确处理**：检测到的请求必须由用户另发一条精确消息确认：`确认高危操作 <request-id>`，或取消：`取消高危操作 <request-id>`。普通回复、引用中的文字，以及原请求中预先写入的授权均不算确认。
- **审计记录**：以 JSON Lines 追加写入 `logs/copilot/governance/audit.log`；每会话待处理状态保存在同目录的 `.state/` 中。
- **报告**：安装后运行 `node .github/hooks/governance-audit/report.cjs` 汇总会话记录和近期风险事件。在本仓库的源码目录布局中，请使用 `node hooks/governance-audit/report.cjs`。

## 安装

当前 `hooks.json` 中的命令路径为 `.github/hooks/governance-audit/governance.cjs`。请将本目录放到目标仓库的 `.github/hooks/governance-audit/`，并根据所用环境注册 `hooks.json`。钩子需要 Node.js；Git 用于读取仓库元数据。无法读取 Git 元数据时，审计仍会继续，此时 `repository` 为 `null`。

日志路径相对于钩子的当前工作目录；提供的配置将 `cwd` 设为 `.`。请确保该目录可写，并保护审计日志，因为其中包含脱敏后的提示词和工具参数预览。

## 威胁类别
| 类别 | 示例 | 当前严重度 |
|----------|----------|----------|
| `data_exfiltration` | 向外部发送所有数据、上传凭据、使用带数据的 `curl` 请求 | `0.9` |
| `privilege_escalation` | `sudo`、`chmod 777`、授予管理员或 root 权限 | `0.9` |
| `system_destruction` | 递归删除、`git reset --hard`、`DROP` / `TRUNCATE` / `DELETE FROM` | `0.95` |
| `prompt_injection` | “忽略之前的指令”、试图覆盖规则 | `0.9` |
| `credential_exposure` | 可识别的凭据赋值、令牌、私钥 | `0.95` |

检测由 `governance.cjs` 和 `redact-prompt.cjs` 中的正则规则完成。匹配可能产生误报（例如提示词中引用的示例）；批准前应核对实际请求。未匹配到威胁也不代表请求一定安全。

## 治理级别

| 级别 | 行为 |
|-------|----------|
| `open` | 仅记录威胁，从不阻止 |
| `standard` | 默认记录并阻止检测到的威胁；`BLOCK_ON_THREAT=false` 时仅审计 |
| `strict` | 始终记录并阻止检测到的威胁；`BLOCK_ON_THREAT=false` 不会关闭拦截 |
| `locked` | 始终记录并阻止检测到的威胁；`BLOCK_ON_THREAT=false` 不会关闭拦截 |

提供的 `hooks.json` 为提示词扫描设置了 `GOVERNANCE_LEVEL=standard` 和 `BLOCK_ON_THREAT=true`。`open` 无论 `BLOCK_ON_THREAT` 如何设置都不会拦截；`strict` 和 `locked` 无论该变量如何设置都会拦截。设置 `SKIP_GOVERNANCE_AUDIT=true` 会绕过钩子，仅应作为明确的运维覆盖手段。

## 事件流程

1. `sessionStart` 添加治理上下文，并记录会话和仓库元数据。
2. `userPromptSubmitted` 扫描用户消息，记录脱敏预览和哈希。
3. `userPromptTransformed` 也扫描模型实际接收的内容，对其脱敏；存在待拦截请求时注入保护说明。
4. `preToolUse` 在存在待处理请求时拒绝工具调用。无风险请求交由宿主正常的权限流程处理；此钩子不会主动授予工具权限。
5. `postToolUse`、`postToolUseFailure`、`agentStop` 和 `sessionEnd` 记录工具结果及生命周期事件。回合结束不会清除待确认请求。

发生拦截后，应在普通聊天中说明具体操作、影响范围和风险，再请用户针对显示的请求编号单独发送精确的确认或取消消息。确认仅适用于该请求；取消表示该请求已取消，不代表批准。

## 配置

| 变量 | 取值 | 默认值 / 效果 |
|----------|----------|----------|
| `GOVERNANCE_LEVEL` | `open`、`standard`、`strict`、`locked` | `standard`；无效值会安全失败 |
| `BLOCK_ON_THREAT` | `true`、`false` | `true`；只有 `standard` 配合 `false` 才会改为仅审计 |
| `ENABLE_PROMPT_REDACTION` | `true`、`false` | 除非明确设为 `false`，否则启用；控制转换后提示词的脱敏 |
| `SKIP_GOVERNANCE_AUDIT` | `true` | 设为 `true` 时绕过审计 |

`redact-prompt.cjs` 也可单独作为提示词转换钩子使用。只有内容发生变化时，它才输出 `modifiedTransformedPrompt`。`governance.cjs` 已集成提示词脱敏；除非运行环境要求同时注册两个钩子，否则不要重复配置。

## 日志与报告

- `logs/copilot/governance/audit.log`：追加写入的 JSON Lines，schema 版本为 2；记录包含事件和策略版本、时间戳、会话/请求标识、拦截状态及事件详情。
- `logs/copilot/governance/.state/`：以哈希后的会话标识保存活动请求和待处理请求状态。请求待确认期间不要手动编辑或删除状态文件。
- 安装后，在仓库根目录运行 `node .github/hooks/governance-audit/report.cjs` 查看最近会话摘要。在源码仓库目录布局中请使用 `node hooks/governance-audit/report.cjs`。命令后追加会话 ID 可筛选，例如 `node .github/hooks/governance-audit/report.cjs <session-id>`。

提示词预览最多保留 2,000 个字符。写入提示词预览和工具参数预览前，会尝试遮盖可识别的凭据、私钥、电子邮件地址和中国大陆手机号。脱敏依赖模式匹配，不能保证清除所有敏感信息；请为日志设置适当的访问控制和保留期限。报告只汇总已有记录，不会更改策略状态，也不会判断请求是否安全。
