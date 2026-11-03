---
description: "实现或审查 WMS/PDA 的 ASP.NET Core API、请求 DTO、身份权限、异步收货、状态查询及幂等接口时读取。"
applyTo: "**/*Controller*.cs,**/*Endpoints*/**/*.cs,**/*Contracts*/**/*.cs,**/*Dto*.cs,**/*Request*.cs,**/*Response*.cs,**/*GoodsReceipt*.cs,**/*.http"
---

# REST API：以 PDA 提交收货为开发示例

下面路由、DTO、限制与响应是**新接口的建议契约**，不是已从项目代码提取的现有 API。已有接口须保持兼容；不得按示例偷偷改名或修改状态语义。Controller/Minimal API 沿用仓库模式。

## 1. 示例业务范围与职责

实现两项操作：

- `POST /api/v1/goods-receipts`：提交一个 WMS 收货事件，可靠受理后返回操作号，后台由 NServiceBus 完成 SAP 过账。
- `GET /api/v1/goods-receipts/operations/{operationId}`：查询当前状态和 SAP 凭证。

一次事件可含多行；同一交货单允许多次部分收货。客户端重复点击、网络重发、消息重投都不能让同一个 WMS 收货事件再过账。

`wmsReceiptId` 必须来自服务端可验证的 WMS 收货事件，不能只是每次点击随机生成的字符串。若现有 WMS 没有稳定事件身份，先补清创建和验证规则，不宣称仅靠 HTTP requestId 就完成业务防重。

## 2. 请求示例与字段约定

```http
POST /api/v1/goods-receipts HTTP/1.1
Host: middleware.example.invalid:8443
Authorization: Bearer <test-token>
Content-Type: application/json

{
  "requestId": "f8fe59a5-94bd-4a8b-b53f-1c1dcce522b3",
  "wmsReceiptId": "RCV-20261103-0001",
  "inboundDelivery": "1800001234",
  "postingDate": "2026-11-03",
  "items": [
    {
      "wmsReceiptLineId": "1",
      "inboundDeliveryItem": "000010",
      "quantity": 12.500000,
      "unit": "EA",
      "batch": "B26110301"
    }
  ]
}
```

所有样例编号均为虚构。认证沿用现有方案；Bearer 仅为示例，不要求迁移已有认证。

| 字段 | C# 类型 / 示例限制 | 从哪里来、怎么验证 |
|---|---|---|
| requestId | Guid，非空 | 客户端首次生成；网络重试复用 |
| wmsReceiptId | string，1–64 字符 | WMS 收货事件身份；服务端校验存在及所属工厂/仓库 |
| inboundDelivery | string，10 位数字 | 服务端与 WMS 事件/ASN 核对，保留前导零 |
| postingDate | DateOnly，非默认值 | 业务日期；是否允许未来/跨期以批准规则为准 |
| items | 1–200 行 | 本示例请求限额；已有项目限额优先 |
| wmsReceiptLineId | string，1–64 字符 | 该收货事件内唯一；允许一交货行按不同批次拆行 |
| inboundDeliveryItem | string，6 位数字 | 属于该交货单，并与 WMS 事件行匹配 |
| quantity | decimal，>0，最多 6 位小数 | 本示例对齐 ASN NUMBER(18,6)；不得超过允许剩余量 |
| unit | string，1–3 字符 | 示例短单位；核对 WMS/SAP 单位映射，不默认转换 |
| batch | string?，示例最长 10 字符 | 按物料批次要求校验；实际 SAP 元数据长度优先 |

工厂、库位、物料、PO 号/行号从服务端可信 ASN/WMS 事件取得或核验，不因为客户端传入就直接用于 SAP。不得接受客户端指定 `status`、`sapDocument`、`createdBy` 或角色权限。

## 3. C# DTO 示例

这是独立的请求契约示例；不得直接用 Oracle 实体或 NCo 类型作为 HTTP DTO。

```csharp
using System.ComponentModel.DataAnnotations;

public sealed class SubmitGoodsReceiptRequest
{
    public Guid RequestId { get; init; }
    [Required, StringLength(64, MinimumLength = 1)]
    public string WmsReceiptId { get; init; } = "";
    [Required, RegularExpression(@"^[0-9]{10}$")]
    public string InboundDelivery { get; init; } = "";
    public DateOnly PostingDate { get; init; }
    [Required, MinLength(1), MaxLength(200)]
    public List<GoodsReceiptItemRequest> Items { get; init; } = [];
}

public sealed class GoodsReceiptItemRequest
{
    [Required, StringLength(64, MinimumLength = 1)]
    public string WmsReceiptLineId { get; init; } = "";
    [Required, RegularExpression(@"^[0-9]{6}$")]
    public string InboundDeliveryItem { get; init; } = "";
    public decimal Quantity { get; init; }
    [Required, StringLength(3, MinimumLength = 1)]
    public string Unit { get; init; } = "";
    [StringLength(10)]
    public string? Batch { get; init; }
}
```

Controller 使用 `[ApiController]` 时沿用其模型校验；Minimal API 必须核实当前验证配置，不能假设复制这些 Attribute 后就一定执行。

应用/领域校验还必须显式覆盖：

```csharp
// 片段：收集到现有验证结果中；不是靠四舍五入修正输入。
bool invalidQuantity = item.Quantity <= 0m
    || item.Quantity > 999999999999.999999m
    || decimal.Round(item.Quantity, 6) != item.Quantity;
```

- `Guid.Empty`、默认日期、null 行元素、重复 wmsReceiptLineId、空白单位均拒绝。
- 相同交货行的拆批数量需汇总校验，并考虑并发已受理收货量，不能各行各自“没超过剩余量”就放行。
- 不信任客户端 remainingQty；并发配额/数量占用在业务层与 Oracle 事务中处理，不只做一次无锁 SELECT。
- 收货事件是否已完成卸货/上架，由真实业务流程定义；不可自行规定“必须已上架”或“允许未卸货”。
- 消息入口也可能绕过 HTTP，业务不变量放到可复用的业务代码中，Handler 同样验证。

## 4. Controller 的执行顺序

```text
1. 认证；取得调用系统身份和操作者（来自可信 Claims/现有身份服务）。
2. 解析与字段校验。
3. 按 WMS 事件检查工厂/仓库/对象权限；GET 查询也做同样范围检查。
4. 计算规范化请求内容；按调用系统 + requestId 查/争用防重记录。
5. 再按调用系统 + wmsReceiptId 检查业务重复；事务内并发保护。
6. 首次：可靠保存操作与不可变快照，并完成已批准的可靠派发步骤。
7. 按下表返回 202/200/409；绝不在 Controller 中直接等待 SAP 过账。
```

第 6 步必须复用真实可恢复机制。若是持久化待派发方案，数据库里要有可被后台恢复的派发工作，且后台重复发送仍安全。若是 Transactional Session，核实实际版本与 Oracle 事务集成。仅保存操作后直接 `IMessageSession.Send`，不能宣称数据库和消息原子一致。

禁止 `_ = service.PostAsync(...)`、`Task.Run(...)` 或内存队列后立即返回 202。HTTP CancellationToken 只表示本次等待取消；操作已受理后仍需完成/核实，不自动撤销 SAP。

## 5. 幂等返回约定：必须实现，不只写文档

本示例直接使用 body 中 requestId，不另引一个重复的 Idempotency-Key Header。现有接口已用 Header 则沿用，明确两者映射。

| 情况 | HTTP | 返回/行为 |
|---|---:|---|
| 首次可靠受理 | 202 | 新 OperationId，状态 ACCEPTED，Location 查询地址 |
| 同键同内容，ACCEPTED/PROCESSING | 202 | 原 OperationId 和当前状态；不重复派发业务 |
| 同键同内容，SUCCEEDED/REJECTED/UNKNOWN | 200 | 原操作快照；不能把 200 理解为 SAP 成功 |
| 同 requestId 不同内容 | 409 | IDEMPOTENCY_CONFLICT，不执行 |
| 换 requestId，但同 wmsReceiptId、同内容 | 202 或 200 | 按原操作状态返回；不创建第二次收货 |
| 同 wmsReceiptId 不同内容 | 409 | RECEIPT_CONTENT_CONFLICT，需业务更正流程 |

内容比较排除 requestId、traceId 和身份审计时间，保留交货单、业务日期及每行身份/数量/单位/批次。类型化规范化后再比较；不能直接比较原始 JSON 字节。

同键 REJECTED 后改数量，仍应冲突；修正原事件或新建更正事件遵循 WMS 业务规则，不能自动换键绕过防重。

## 6. 正常响应与查询结果

首次受理示例：

```http
HTTP/1.1 202 Accepted
Location: /api/v1/goods-receipts/operations/5d094855-81c3-4ce9-8b62-241bd2184395
Content-Type: application/json

{
  "operationId": "5d094855-81c3-4ce9-8b62-241bd2184395",
  "wmsReceiptId": "RCV-20261103-0001",
  "status": "ACCEPTED"
}
```

GET 成功查询已完成业务，HTTP 200：

```json
{
  "operationId": "5d094855-81c3-4ce9-8b62-241bd2184395",
  "wmsReceiptId": "RCV-20261103-0001",
  "status": "SUCCEEDED",
  "sapDocument": { "materialDocument": "5000000123", "documentYear": "2026" },
  "error": null
}
```

GET 成功查询到未知业务结果，同样 HTTP 200：

```json
{
  "operationId": "5d094855-81c3-4ce9-8b62-241bd2184395",
  "wmsReceiptId": "RCV-20261103-0001",
  "status": "UNKNOWN",
  "sapDocument": null,
  "error": {
    "code": "SAP_RESULT_UNKNOWN",
    "message": "SAP 处理结果待核实，请查询本操作，不要重新提交收货。"
  }
}
```

`UNKNOWN` 不是成功或确定失败；前端显示“待核实”，不提供无保护的“重新过账”按钮。人工核实入口另做权限、审计和恢复规则，不因本示例自动新增。

## 7. 错误响应示例

新接口使用现有 ProblemDetails 约定；项目尚无约定时采用以下格式。不要 HTTP 200 + `success:false` 掩盖本次请求错误。

同 requestId 把 quantity 改成 13 后提交：

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "请求内容与已受理请求不一致",
  "status": 409,
  "code": "IDEMPOTENCY_CONFLICT",
  "traceId": "example-trace-001"
}
```

quantity 改成 0 的校验失败示例：

```json
{
  "type": "about:blank",
  "title": "请求参数无效",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "errors": { "items[0].quantity": ["数量必须大于 0，且最多保留 6 位小数。"] },
  "traceId": "example-trace-002"
}
```

映射要求：未认证 401；无业务权限 403（隐藏对象存在性时按现有策略 404）；对象不存在 404；业务状态/内容冲突 409；超请求体限制 413；暂不能可靠受理可返回 503；意外错误 500。503/500 或响应丢失后提示客户端**复用原 requestId 查询/重试**，不能保证“没有执行过”。

不返回 SQL、堆栈、连接字符串或完整 SAP 原始消息。结构化日志记录 operationId、业务事件 ID、阶段与错误码；不记录 Authorization 和完整载荷。

## 8. 必须交付的验收用例与文档

| 请求/故障 | 断言 |
|---|---|
| 有权限、合法收货 | 202 + Location；后台最终结果可查 |
| 未登录 / 其他仓库用户 | 401 / 403 或既定 404；无新操作、无消息 |
| quantity=0 / 超精度 / items 为空 | 400；业务层也拒绝 |
| 相同请求并发 10 次 | 一个业务操作、一次业务过账；响应关联同一 OperationId |
| 同键不同数量 | 409；原快照不被修改 |
| 换 requestId 重发同一 WMS 事件 | 仍只有一个操作 |
| 同交货单的不同合法部分收货事件 | 不被错误去重；总量并发校验有效 |
| 返回 202 后重启进程/消息派发中断 | 已受理操作可恢复，不永久滞留 |
| SAP 提交响应丢失 | 状态 UNKNOWN，查询不会触发再次过账 |

交付可运行的 API/业务测试，以及与实现一致的 `.http` 或 Postman 调用样例。文档限于用途、认证、字段、请求/响应、失败与重复行为；不要把本文件的虚构结果冒充真实接口调用记录。
