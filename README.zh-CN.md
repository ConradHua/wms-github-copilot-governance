# WMS AI 辅助编程规范与治理方案 (`wms-github-copilot-governance`)

> [English](./README.md) | **简体中文**

## 1. 总体概览

### 建设目的
通用的 AI 编程助手并不了解我们 **WMS–SAP 集成系统** 的专有架构、业务边界和安全规范。如果不加约束地直接使用，AI 很容易写出跨层调用、导致 SAP 重复过账、泄露敏感凭据或引入存在法律风险的第三方开源组件的代码。

本项目提供了一套完整的 **AI 编码规范与治理方案（AI Coding Governance Package）**，核心目标包括：
1. **统一 AI 编码标准**：在 AI 写代码前，先教会它我们项目的技术栈、代码分层边界与业务交付底线。
2. **提供专家级代码审查**：预设“高级代码审查员”和“安全审计员”角色，在代码合并前协助开发人员把关。
3. **后台自动化安全兜底**：通过自动化脚本（Hooks）实现敏感信息自动打码、高危操作拦截、开源协议合规检查以及代码自动备份。

### 跨平台通用性（支持主流 AI 编程工具）
虽然本仓库以 **GitHub Copilot** 作为主要示例进行配置说明，但其中的编码规则、角色提示词、技能手册和自动化脚本具有**平台通用性**，可轻松迁移或直接应用于主流的 AI 编程平台（AI Harness）：
- **GitHub Copilot**（VS Code / Visual Studio / JetBrains / CLI）
- **Cursor**（`.cursor/rules` / Project Rules）
- **OpenAI Codex / Claude Code / Windsurf** 等主流 AI 辅助开发工具

### 包含的核心模块（共 4 大类）
| 模块名称 | 所在目录 | 一句话说明作用 |
| :--- | :--- | :--- |
| **1. Instructions（开发指令）** | [`instructions/`](./instructions/) | **AI 的“入职培训手册”**：规定技术栈、分层边界与防重复过账等交付底线。 |
| **2. Agents（专属 AI 角色）** | [`agents/`](./agents/) | **随叫随到的“虚拟审查专家”**：在合并代码前进行代码质量与安全漏洞审查。 |
| **3. Skills（专项技能包）** | [`skills/`](./skills/) | **AI 的“安全加固操作指南”**：在开发敏感功能时提供威胁建模流程与安全检查清单。 |
| **4. Hooks（自动化拦截工具）** | [`hooks/`](./hooks/) | **后台运行的“安全卫士”**：自动完成提示词脱敏、高危拦截、开源协议检查与 Git 备份。 |

---

## 2. 各模块详细说明

### 2.1 Instructions（开发指令）—— *AI 的“入职培训手册”*
位于 [`instructions/`](./instructions/) 目录，用于在 AI 生成代码前明确我们项目的技术路线（**.NET 10 / ASP.NET Core Web API、NServiceBus、RabbitMQ、Oracle、SAP NCo 3.1**）及架构纪律：

- **项目总则（[`copilot-instructions.md`](./instructions/copilot-instructions.md)）**
  - **明确职责边界**：严格区分 Controller、业务 Service、消息 Handler、SAP Adapter 和 Oracle 数据访问层的职责，禁止越界调用（如在 Controller 中直接写 SQL 或调用 SAP）。
  - **严守业务底线**：强制要求使用稳定的 `wmsReceiptId` / `OperationId` 保障幂等防重；返回 HTTP `202` 前必须可靠落库；调用 SAP 前必须记录崩溃可见的执行标记；遇到 `UNKNOWN` 状态必须进入核实流程，严禁直接重发导致 SAP 重复过账。
  - **规范验证流程**：要求修改后执行真实的 `dotnet build` 与 `dotnet test`，严禁硬编码密码/Token 或通过删测试、吞异常来伪造通过结果。
- **Oracle 数据库专项规范（[`Oracle.instructions.md`](./instructions/instructions/Oracle.instructions.md)）**
  - 规范 ASN 同步、参数化 SQL 编写、Schema 配置（`WMSNCO` / `WMSFESSAP`）、数据库事务控制以及状态条件更新。
- **REST API 专项规范（[`Rest-API.instructions.md`](./instructions/instructions/Rest-API.instructions.md)）**
  - 规范 PDA/WMS HTTP 接口路由设计、DTO 参数校验、身份鉴权与标准状态码返回。
- **SAP RFC 专项规范（[`SAP_RFC.instructions.md`](./instructions/instructions/SAP_RFC.instructions.md)）**
  - 规范 SAP NCo 3.1 会话管理、BAPI 调用、字段类型映射（如编号使用 `string` 保留前导零、数量使用 `decimal` 防止精度丢失）及物料锁冲突的有界重试策略。

---

### 2.2 Agents（专属 AI 角色）—— *随叫随到的“虚拟审查专家”*
位于 [`agents/`](./agents/) 目录。开发人员在写完代码或提交合并前，可以直接呼叫这两个角色进行全面体检：

- **高级代码审查员（[`code-reviewer.zh-CN.md`](./agents/code-reviewer.zh-CN.md) | [EN](./agents/code-reviewer.md)）**
  - 以资深工程师视角，从 **5 个维度** 评估代码变更并给出分级改进建议：
    1. **正确性**：边界值处理、空值异常、并发竞态条件及单元测试有效性。
    2. **可读性**：命名规范、逻辑复杂度、代码结构清晰度。
    3. **架构设计**：是否遵循现有模式、模块边界是否清晰、是否存在循环依赖。
    4. **安全性**：输入验证、密钥排除、参数化查询。
    5. **性能表现**：排查 N+1 查询、无界循环、同步阻塞及缺少分页等问题。
- **安全审计员（[`security-auditor.zh-CN.md`](./agents/security-auditor.zh-CN.md) | [EN](./agents/security-auditor.md)）**
  - 专注于排查**实际可被利用的安全漏洞**：
    - **输入处理**：防范 SQL 注入、命令注入、XSS 跨站脚本、非法文件上传等。
    - **认证与授权**：检查密码强哈希、会话安全、越权访问（IDOR）及接口限流。
    - **数据保护**：确保密码/密钥不入库、日志脱敏、敏感数据加密传输与存储。
    - **基础设施与外部集成**：安全响应头、CORS 限制、Webhook 签名校验、SSRF 防护及 AI 提示词注入防护。

---

### 2.3 Skills（专项技能包）—— *AI 的“安全加固操作指南”*
位于 [`skills/security-and-hardening/`](./skills/security-and-hardening/) 目录。当开发涉及用户登录、外部输入、第三方接口集成或敏感数据处理时，指导 AI 按标准安全流程编写代码：

- **安全与加固技能（[`SKILL.zh-CN.md`](./skills/security-and-hardening/SKILL.zh-CN.md) | [EN](./skills/security-and-hardening/SKILL.md)）**
  - 引导 AI 在写代码前先进行 **STRIDE 威胁建模**（梳理信任边界与核心资产）。
  - 明确划分“必须执行（无例外）”、“应当执行”和“绝不执行”三层安全底线。
- **配套参考手册与检查清单**
  - **加固代码模式（[`hardening-patterns.zh-CN.md`](./skills/security-and-hardening/references/hardening-patterns.zh-CN.md)）**：提供常见安全漏洞的标准修复代码模板。
  - **安全检查清单（[`security-checklist.zh-CN.md`](./skills/security-and-hardening/references/security-checklist.zh-CN.md)）**：对照 OWASP Top 10 风险，提供上线前的逐项核对清单。

---

### 2.4 Hooks（自动化拦截与备份工具）—— *后台运行的“安全卫士”*
位于 [`hooks/`](./hooks/) 目录。无需开发人员手动触发，在 AI 对话的不同生命周期节点自动在后台执行：

- **治理与安全审计钩子（[`governance-audit/`](./hooks/governance-audit/README.zh-CN.md) | [EN](./hooks/governance-audit/README.md)）**
  - **提示词自动脱敏**：在将内容发送给大模型前，自动把可识别的密码、Token、私钥和个人敏感信息打码。
  - **高危操作实时拦截**：自动检测数据外泄、权限提升、系统破坏（如 `DROP TABLE`、`TRUNCATE`、`git reset --hard`）、提示词注入和凭据暴露。一旦发现高危操作立即拦截，必须由人工输入精确指令（`确认高危操作 <request-id>`）后才允许继续。
  - **审计日志与报表**：将所有风险事件记录到 `logs/copilot/governance/audit.log`，并可通过 `report.cjs` 一键生成安全审计汇总报告。
- **开源协议合规检查钩子（[`dependency-license-checker/`](./hooks/dependency-license-checker/README.md)）**
  - 在 AI 编程会话结束时，自动通过 `git diff` 扫描新增的第三方依赖包（支持 npm、pip、Go、Ruby、Rust）。
  - 自动拦截或警告包含传染性/限制性开源协议（如 **GPL、AGPL、SSPL**）的组件，防止项目产生开源法律合规风险。
- **会话自动提交备份钩子（[`session-auto-commit/`](./hooks/session-auto-commit/README.zh-CN.md) | [EN](./hooks/session-auto-commit/README.md)）**
  - 在每次 AI 编程代理会话结束时，自动检测未提交的代码变更，生成带时间戳的 Commit 并推送到远程 Git 仓库，确保工作成果不会意外丢失。

---

## 3. 目录结构一览

```text
wms-github-copilot-governance/
├── README.md                          # 项目英文说明文档
├── README.zh-CN.md                    # 项目中文说明文档（本文件）
├── instructions/                      # 1. AI 开发指令与编码规范
│   ├── copilot-instructions.md        #    - WMS-SAP 架构总则与交付底线
│   └── instructions/
│       ├── Oracle.instructions.md     #    - Oracle SQL 与事务规范
│       ├── Rest-API.instructions.md   #    - PDA/WMS HTTP 接口规范
│       └── SAP_RFC.instructions.md    #    - SAP NCo / BAPI 集成规范
├── agents/                            # 2. 专属虚拟专家角色
│   ├── code-reviewer(.zh-CN).md       #    - 五维高级代码审查员（中/英）
│   └── security-auditor(.zh-CN).md    #    - 漏洞与威胁安全审计员（中/英）
├── skills/                            # 3. 专项安全技能包与检查清单
│   └── security-and-hardening/        #    - OWASP / STRIDE 安全加固指南与模板
└── hooks/                             # 4. 后台自动化安全与合规钩子
    ├── governance-audit/              #    - 提示词脱敏、高危拦截与审计日志
    ├── dependency-license-checker/    #    - 新增依赖的开源协议合规检查
    └── session-auto-commit/           #    - 会话结束自动 Git 提交与备份
```

