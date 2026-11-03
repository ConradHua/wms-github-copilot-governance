# WMS–SAP Integration：AI 开发 Instructions

## 1. 项目事实与示例边界

- 技术路线：.NET 10 / ASP.NET Core Web API、NServiceBus、RabbitMQ、Oracle、SAP NCo 3.1；沿用 Windows 服务、8080/8443 的部署方案。
- 修改前读实际 `.csproj`、`Directory.Packages.props`（若存在）、启动配置、相关 Handler/SQL/测试。目标框架不等于所有第三方组件均已官方支持；不要顺手升级依赖。
- 已有数据对象说明记录：`WMSNCO` 用于消息持久化和入站追踪，业务 Schema 默认 `WMSFESSAP`，由 `Wms:Oracle:Schema` 配置；这是文档基线，须与源码和目标环境核对。
- 同一说明记载 `Sap.Adapter.Endpoint`、RealTime、Background 及 SAP 主动调用的 Registered RFC 路径。不要用早期“仅 RFC Client”规划删除现有接收能力；也不要凭此文档新开 RFC Server。
- 本套文件中的 `GoodsReceiptService`、`PostGoodsReceipt`、收货 API 路由和收货状态是**建议示例**，不是已存在的类、接口或表。先找等价实现，再复用；不得因为示例而重构仓库。

## 2. 按任务读取专项文件

| 任务                                       | 必须读取                                                     |
| ------------------------------------------ | ------------------------------------------------------------ |
| NCo、BAPI、SAP 主动推送、收货过账          | [SAP_RFC.instructions.md](instructions/SAP_RFC.instructions.md) |
| ASN 同步、Oracle SQL、数据库事务、状态保存 | [Oracle.instructions.md](instructions/Oracle.instructions.md) |
| PDA/WMS HTTP API、DTO、鉴权、状态查询      | [Rest-API.instructions.md](instructions/Rest-API.instructions.md) |

跨领域任务同时读取。例如“新增 PDA 收货接口”涉及全部三份。专项文件是补充规则，不依赖加载顺序覆盖矛盾。

## 3. 接到需求后的具体动作

以“新增 PDA 确认收货”为例，先给出不超过一屏的实施说明：

```text
需求：PDA 提交一次 WMS 收货事件，后台完成 SAP 过账，可查询结果。
现有入口：<找到的 Controller/路由，或明确尚无>
现有处理：<找到的 Service、消息、Handler、SAP Adapter>
现有存储：<找到的收货事务表及状态列；不得猜测>
准备修改：<真实文件路径 + 每个文件的一句话改动>
验收：正常过账；重复不重过账；同键改数量被拒绝；超时进入核实。
阻塞项：<只列会影响正确性的缺项，例如交货单过账接口与防重能力>
```

- 不只阅读文件名：沿 HTTP → 业务服务 → 消息 → Handler → SAP/Oracle 找到真实调用链。
- 已明确的业务规则直接实现。只对无法安全推断的业务决定提问；可先完成 DTO、纯校验和测试，不造假接口填空。
- 一次实现一个业务切片，不夹带登录重做、全仓格式化、迁移 ORM 或新建通用框架。

## 4. 代码放在哪里、哪些层不能越界

下表是职责映射示例，类名应适配仓库，不要求新建这些项目或目录。

| 职责/示例                 | 写什么                                             | 不写什么                               |
| ------------------------- | -------------------------------------------------- | -------------------------------------- |
| `GoodsReceiptsController` | HTTP 校验、调用身份、状态码                        | SQL、NCo Invoke、轮询等 SAP 完成       |
| `GoodsReceiptService`     | 仓库权限、业务状态、稳定收货事件、受理防重         | 硬编码 SAP Client、数据库密码          |
| `PostGoodsReceipt` 消息   | 操作号、契约版本及已选定的必要业务数据             | `HttpContext`、DbContext、IRfcFunction |
| 消息 Handler              | 读取持久化操作、争用执行权、调用 Adapter、保存结果 | 每收到消息就无条件再次过账             |
| SAP Adapter               | 字段映射、NCo 会话、BAPI 返回、Commit              | HTTP 状态码、直接修改 WMS 作业进度     |
| Oracle 访问类             | 参数化 SQL、事务、状态条件更新                     | 自动补建 DBA 管理的业务表              |

示例消息只有操作号时，必须能读取**已持久化且不可随意修改的请求快照**；不要重读随时变化的 PDA 表单来决定过账数量。

```csharp
// 建议消息契约；沿用仓库的消息声明方式和命名空间。
public sealed class PostGoodsReceipt : NServiceBus.ICommand
{
    public Guid OperationId { get; set; }
}
```

## 5. 本项目的交付底线

- 一次 WMS 收货事件用一个稳定 `wmsReceiptId`；HTTP 重发可以复用 `requestId`，消息重投仍绑定同一个 OperationId。一个交货单允许多次部分收货，不以交货单号单独防重。
- 返回 202 前必须可靠保存受理结果。数据库写入与发送消息之间有断点时，复用已验证的 Transactional Session 或持久化派发方案；禁止 `SaveChanges(); Send();` 后声称具有原子性。
- Handler 的 Outbox 不自动包含外部 SAP 过账，也不自动包含另外打开的 Oracle 连接。不得以 `EnableOutbox()` 代替事务分析。
- 调 SAP 前的执行标记要在崩溃后仍可见。若标记与 Handler 事务一起回滚，SAP 已成功后的消息重试仍可能重过账；必须修正该设计。
- `UNKNOWN` 表示不知道 SAP 是否成功，不是“失败，可再提交”。不能通过删除防重记录、换 MessageId 或重置状态跳过核实。
- 锁冲突由现有消息恢复策略做有界重试；不得叠加 Controller、Service、Adapter 三层重试，不用增加并发解决 SAP 物料锁。
- 标识符用 string，数量用 decimal。不要把 `"000010"` 转成整数后传回 SAP，不静默舍入数量。
- 真实密码/Token 不进源码、对话或日志；只核对配置键是否存在，不枚举环境变量或打印连接字符串。Agent 不使用生产凭证。

## 6. 验证与最终回复

- 从仓库确定 solution 和 test project 后执行相应 `dotnet build <实际路径>`、`dotnet test <实际路径>`；不得直接运行示例占位命令或编造通过结果。
- 修改共享方法时检查所有调用方；复现缺陷后加能捕获该缺陷的测试。纯文案不建测试工程。
- 不用关闭鉴权/证书校验、吞异常或删测试来让验证通过。
- 在已授权范围内完成代码与验证。真实业务写入、迁移执行、发布或权限修改，只有已有明确授权时才执行；不重复请求已有授权。
- 接口文档只写用途、调用方式、字段、正常/失败样例；不要生成空泛的架构介绍。

最终回复使用这四项，短而具体：

```text
已改：真实文件路径及行为变化。
已验证：实际命令、结果；Mock/Oracle/RabbitMQ/SAP 分开说明。
未验证：例如未接入 SAP，未验证真实提交与交货单状态。
待决定：只列确实阻碍上线的事项，不把假设写成已完成。
```