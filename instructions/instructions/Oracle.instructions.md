---
description: "修改 WMS–SAP 的 Oracle SQL、ASN 同步、物料可用量作业、EF Core/ODP.NET、幂等与事务代码时读取。"
applyTo: "**/*.sql,**/*Oracle*/**/*.cs,**/*Repository*.cs,**/*DbContext*.cs,**/*Persistence*/**/*.cs,**/*GoodsReceipt*.cs"
---

# Oracle：使用已有业务对象，不猜表结构

下面的已知对象来自 `oracle-wms-sap-database.md`；本文没有现场核对数据库和源码。执行前用仓库 SQL、正式 DDL 或只读数据字典确认。示例片段不是可直接部署的迁移脚本。

## 1. 选对 Schema 和所有者

| 对象 | 文档中的默认 Schema | 允许的开发方式 |
|---|---|---|
| `WMS_SAP_OD`、`WMS_RT_OD`、`WMS_BG_OD` | WMSNCO | NServiceBus 管理；业务代码不直接 INSERT/DELETE |
| `SAP_INBOUND_DELIVERY_TRACK` | WMSNCO | Adapter 入站接收/派发/完成追踪，保留既有状态集合 |
| `SAPWMS_ASN_H` / `SAPWMS_ASN_L` | WMSFESSAP | 在同一个 WMS Oracle 事务中同步抬头与行 |
| `SAPWMS_ASN_LOT` | WMSFESSAP | 当前同步器只检查是否已有批次，不写入 |
| `SAPWMS_ASN_PUTAWAY` / `SAPWMS_ASN_RFC_TXN` | WMSFESSAP | 已知对象存在于校验清单，但完整列定义未知；先核实 |
| `SAPWMS_MAT_AVAIL_JOB` / `SAPWMS_MAT_AVAIL` | WMSFESSAP | 复用既有领取作业、保存快照和完成状态逻辑 |

- WMS 业务 Schema 从 `Wms:Oracle:Schema` 读取，服务用户从 `Wms:Oracle:ServiceUser` 读取；不要把 WMSNCO 拼到所有表前。
- Schema 名只能来自经过验证的服务端配置/允许列表。参数不能绑定对象名，HTTP 请求不得决定 Schema、表名或列名。
- 独立连接不自动共享事务；即使在同一数据库实例、同一 CDB 也不行。跨 PDB 不能当成本地事务。
- 若已有 ODP.NET SQL，不为一条查询新引 EF Core；若已有 EF Core，则复用 DbContext 和映射。不要新增通用 Repository 框架。

## 2. 实际任务示例 A：查询 ASN 抬头

先核实 `INB_DELIVERY_NO` 长度和字段类型。以下按项目文档中的十位交货单示例，返回投影 DTO，不向 API 暴露整行实体。

```csharp
using Oracle.ManagedDataAccess.Client;

// connection 在当前作用域打开；approvedSchema 已由现有配置验证器校验，绝非请求输入。
using var command = connection.CreateCommand();
command.BindByName = true;
command.CommandText = $"""
    SELECT INB_DELIVERY_NO, WMS_JOB_ID, PROCESS_STATUS, SAP_GR_STATUS
      FROM {approvedSchema}.SAPWMS_ASN_H
     WHERE INB_DELIVERY_NO = :deliveryNo
    """;
command.Parameters.Add("deliveryNo", OracleDbType.Varchar2, 10).Value = deliveryNo;
using var reader = command.ExecuteReader();
if (!reader.Read())
    return null; // 查询方法返回未找到；由 API 决定 404

var jobId = reader.IsDBNull(1) ? null : reader.GetString(1);
// 映射已查明类型的字段到现有 DTO；不得因为示例而猜 ASN_ID 的 .NET 类型。
```

这是同步 ODP.NET 片段；项目若使用经验证的异步 API，保持原有 async 风格，不用 Task.Run 包一层数据库调用。连接/Command/Reader 在本次调用释放，不做全局单例。

禁止写成：

```csharp
// 错误：客户端值直接拼接到 SQL。
command.CommandText = $"SELECT * FROM SAPWMS_ASN_H WHERE INB_DELIVERY_NO = '{deliveryNo}'";
```

排序字段同样不能直接拼接；例如只接受 `deliveryDate` / `deliveryNo` 并映射到服务器常量列名，排序补唯一键。pageSize 的初始建议为默认 50、最大 200，实际项目已有值则沿用。

## 3. 实际任务示例 B：同步 SAP 入库交货单快照

按以下顺序实现，使用一条连接和一个显式事务；复用现有同步器。

```text
BeginTransaction
  1. 按 INB_DELIVERY_NO 查 SAPWMS_ASN_H，按配置 FOR UPDATE WAIT 锁定。
  2. 存在：检查 PROCESS_STATUS、SAP_GR_STATUS、行状态及是否存在 LOT。
     已开始业务 → 返回业务冲突，不更新快照、不重置进度。
     未开始且内容一致 → 返回 ALREADY_SYNCHRONIZED。
     未开始且内容有变化 → 更新允许同步的 SAP 字段。
  3. 不存在：INSERT 抬头，通过正式 Sequence/Trigger/RETURNING 规则拿主键和作业号。
     不用 MAX(ASN_ID)+1，不自己猜 Sequence 名。
  4. 锁定该 ASN 的行，按 INB_DELIVERY_ITEM 对比新快照。
     新增行 → INSERT；保留行 → UPDATE；消失行 → 标记 CANCELLED，不物理删除。
  5. 任一行失败 → 整个抬头/行事务回滚。
Commit
```

具体状态规则：

- 新抬头：文档记录 `PROCESS_STATUS = READY`、`SAP_GR_STATUS = NOT_SENT`。
- 新行：`PROCESS_STATUS = READY`、`UNLOAD_STATUS = READY`、`PUTAWAY_STATUS = WAITING`。
- 已移除且允许取消的行：上述三个行状态均写 `CANCELLED`。
- 已开始业务的判断沿用现有完整谓词；不能只看抬头 READY 就忽略 LOT、已卸货行或 SAP 收货状态。
- “查无记录”的 SELECT FOR UPDATE 不会锁住不存在的业务键。并发首次插入还需要正式唯一约束及对应冲突处理；先核实 DBA 约束，不猜它已存在。
- WMS 写 LOT/启动作业也必须遵守共同的锁/状态争用规则，否则同步器单独锁抬头不能阻止并发业务启动。发现缺口要指出并修复协作点，不宣称已安全。
- 多 ASN/行锁按稳定顺序获取，避免不同处理者以相反顺序锁相同对象。

## 4. 条件更新示例：先取得状态转换权

下面使用文档中已知的可用量作业列；这**不是** SAP 收货状态机。放在现有领取事务内执行，复用原来的 SKIP LOCKED 队列挑选策略。

```csharp
using var command = connection.CreateCommand();
command.Transaction = transaction;
command.BindByName = true;
command.CommandText = $"""
    UPDATE {approvedSchema}.SAPWMS_MAT_AVAIL_JOB
       SET JOB_STATUS = 'PROCESSING', STARTED_AT = SYSTIMESTAMP,
           UPDATED_BY = :serviceUser
     WHERE REQUEST_ID = :requestId AND JOB_STATUS = 'ACCEPTED'
    """;
command.Parameters.Add("serviceUser", OracleDbType.Varchar2).Value = serviceUser;
command.Parameters.Add("requestId", OracleDbType.Varchar2, 36).Value = requestId;
var changed = command.ExecuteNonQuery();
if (changed != 1)
{
    // 0：状态已变化/不存在；>1：数据约束异常。两者均不能继续调用 SAP。
    transaction.Rollback();
    throw new InvalidOperationException($"Claim expected 1 row, got {changed}.");
}
transaction.Commit(); // 确认领取事务成功后，释放 DB 锁，再开始外部调用。
```

异常类型在业务实现中细分：0 行可作为“未领取”返回，不必无限重试；大于 1 行报警。若 Commit 响应丢失，先查领取结果，不自动再调用 SAP。`serviceUser` 参数长度和时间列类型从真实 DDL 补齐，不能照抄一个猜测长度。

可用量是查询作业，不能把其“过期 PROCESSING 自动重置”策略复制到收货过账。收货 PROCESSING 可能已在 SAP 完成。

## 5. 新收货接口的 Oracle 实现要求

先检查 `SAPWMS_ASN_RFC_TXN` 是否已经承担收货事务记录。未拿到列定义前，不编造 `STATUS`、`PAYLOAD_HASH` 等列并直接发 SQL。

下表为**逻辑需求**，映射到现有列；有缺口才提出最小 DDL 变更，由原所有者管理。

| 逻辑信息 | 用途与约束 |
|---|---|
| operationId | 操作主键；API 查询与消息关联 |
| 调用系统 + requestId | HTTP 重试唯一性；调用系统从认证得到 |
| 调用系统 + wmsReceiptId | 业务收货事件唯一性；换 requestId 也不能重过账 |
| 不可变请求快照与内容摘要 | 同键不同数量/批次拒绝，恢复时还原原意图 |
| 状态与执行尝试标识 | 防止旧执行者覆盖新的核实结果 |
| SAP 凭证号 + 年度 | 确认成功的证据 |
| 错误类别、阶段、更新时间 | 区分拒绝、未执行、结果未知与恢复 |

建议新收货状态为 `ACCEPTED / PROCESSING / SUCCEEDED / REJECTED / UNKNOWN`；若已有状态，明确映射并沿用。**不要给 SAP_INBOUND_DELIVERY_TRACK 写这些新状态**，其 Check Constraint 使用另一套枚举。

实现规则：

1. 使用真实唯一约束解决并发争用。“先 SELECT 没有再 INSERT”不够；MERGE 也不等于无条件并发防重。
2. 捕获 ORA-00001 后核实是目标业务键冲突，重新读该键记录并比较内容。其他约束冲突继续报错，不全部返回“成功”。
3. 摘要按类型化字段、固定顺序、固定文化小数格式生成；同义 `12.5` 与 `12.500`、JSON 字段顺序变化不应冲突。行按稳定行身份排序；数量不同必须冲突。摘要不代替权限检查。
4. 业务防重保留期覆盖历史消息重放；不凭消息 Outbox 的短期清理时间删除收货业务身份。
5. `PROCESSING` 执行标记需在外部 SAP 调用前**独立且确定地提交**，不能随稍后失败的 Handler 事务一起消失。多写入者使用条件更新/执行标识，零行更新不得覆盖继续。
6. SAP 返回成功后更新本地结果失败，保留原执行标记并进入核实。Oracle Rollback 不会撤销 SAP Commit。
7. 受理记录与可靠派发必须配套。复用已验证的机制；若确需新方案，先说明 Transactional Session 的版本/Oracle 事务支持，或持久化待派发记录及补发规则，再写代码。
8. 不把单独打开的 `Wms:Oracle` 连接假定加入 NServiceBus Persistence 事务；需要明确展示连接、事务对象及 enlist 方式。

## 6. Oracle 类型、查询与更新细节

- ASN 数量按文档 `NUMBER(18,6)` 校验：最多 12 位整数、6 位小数。`0.0000001m` 应拒绝，不能靠驱动 Scale 静默变成 0。实际列 DDL 不同则按实际调整。
- 参数明确 OracleDbType，字符串按元数据设置 Size，decimal 按需要设置 Precision/Scale；数据库空值用 `DBNull.Value`。
- Oracle 空串通常当 NULL。对可空 `STGE_LOC`、`CHARG` 做快照 MERGE 时必须检查现有 NULL 相等处理；不能用 `a = b` 期待 NULL 匹配。
- `SAPWMS_MAT_AVAIL` 的匹配维度为 `(PLANT, STGE_LOC, MATNR, CHARG, UNIT, CHECK_RULE)`。保留 `SOURCE_REQUESTED_AT` 新旧保护，旧作业不得覆盖新快照；相同时间的先后规则需明确。
- Oracle DATE 含时间但无时区；不要把读到的值自动标为 UTC。TIMESTAMP WITH TIME ZONE 按驱动类型映射，禁止用当前机器文化 Parse 日期/数量字符串。
- 查列表只取需要列并限制条数；避免循环每行查库/每行提交。批量优化先检查现有 SQL 与驱动能力，不顺手引入新包。
- DDL 可能隐式提交；业务事务中不执行建表/改表。启动程序不对共享环境自动 EnsureCreated/Migrate。

## 7. 验收时必须给出具体证据

| 改动场景 | 验证数据/断言 |
|---|---|
| ASN 首次同步 | 一张抬头、正确行数、主外键正确 |
| 同一快照重放 | 无重复抬头/行，业务状态不变 |
| 新快照移除一行 | 仅允许取消的行变 CANCELLED，无物理删除 |
| 已有 LOT 或 WMS 已开始 | 拒绝覆盖，原数量与进度完整 |
| 第二行写入故障 | 抬头及第一行修改同时回滚 |
| 两个 Worker 争同作业 | 仅一个成功领取；另一个不调用 SAP |
| 数量边界 | 12.500000 保持精度；超出 6 位小数/范围拒绝 |
| 可空快照键/乱序作业 | 不重复插行；旧结果不覆盖新结果 |

用真正 Oracle 测试验证 SQL、约束、NULL、锁和事务；SQLite/InMemory 不提供这部分证据。只读环境可验证元数据/SELECT，不能宣称写事务测试通过。
