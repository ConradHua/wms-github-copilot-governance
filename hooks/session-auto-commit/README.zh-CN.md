---
name: 'Session Auto-Commit'
description: 'Automatically commits and pushes changes when a Copilot coding agent session ends'
tags: ['automation', 'git', 'productivity']
---

# 会话自动提交钩子

在 GitHub Copilot coding agent 会话结束时自动提交并推送变更，确保工作始终得到保存和备份。

## 概览

此钩子在每个 Copilot coding agent 会话结束时运行，并自动：
- 检测是否存在未提交的变更
- 暂存所有变更
- 创建带时间戳的提交
- 推送到远程仓库

## 功能

- **自动备份**：避免丢失 Copilot 会话中的工作
- **带时间戳的提交**：每次自动提交都包含会话结束时间
- **安全执行**：仅在确实存在变更时提交
- **错误处理**：优雅处理推送失败

## 工作方式

1. Copilot coding agent 会话结束时，钩子执行
2. 检查当前目录是否位于 Git 仓库中
3. 使用 `git status` 检测未提交的变更
4. 使用 `git add -A` 暂存所有变更
5. 使用格式 `auto-commit: YYYY-MM-DD HH:MM:SS` 创建提交
6. 尝试推送到远程仓库
7. 报告成功或失败

## 自定义

可以通过修改 `auto-commit.sh` 自定义钩子：

- **提交消息格式**：修改时间戳格式或消息前缀
- **选择性暂存**：使用特定的 git add 模式，而不是 `-A`
- **分支选择**：仅推送到指定分支
- **通知**：添加桌面通知或 Slack 消息

## 禁用

临时禁用自动提交：

1. 删除或注释掉 `hooks.json` 中的 `sessionEnd` 钩子
2. 或设置环境变量：`export SKIP_AUTO_COMMIT=true`

## 注意事项

- 钩子使用 `--no-verify`，以避免触发 pre-commit 钩子
- 推送失败不会阻止会话终止
- 需要配置适当的 Git 凭据
- 同时适用于 Copilot coding agent 和 GitHub Copilot CLI
