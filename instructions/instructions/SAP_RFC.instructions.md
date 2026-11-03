---
description: "开发或审查 WMS–SAP 的 NCo 调用、BAPI 收货、批次分类、SAP 入站 Registered RFC、字段映射及失败恢复时读取。"
applyTo: "**/*Sap*/**/*.cs,**/*SAP*/**/*.cs,**/*Rfc*.cs,**/*RFC*.cs,**/*GoodsReceipt*.cs"
---

# SAP RFC：按实际调用场景开发

本文件中的 C# 是实现片段，不是可直接运行的完整 Adapter。类名、路由和测试数据为示例；实际函数参数必须来自仓库契约或获授权的 SAP 元数据。glob 只作初始匹配，业务类命名不同仍按全局指引读取本文件。

## 1. 先识别方向，不能把两条链路混在一起

| 场景 | 代码职责 | 本项目依据 |
|---|---|---|
| SAP → Middleware → WMS：入库交货单快照 | 接收入站 RFC、验证快照、可靠派发、同步 ASN、回传结果 | 已有对象说明记录 `Z_WMS_RECEIVE_INB_DELIVERY` / `ReceiveInboundDelivery`；核实实际处理器 |
| WMS → Middleware → SAP：确认收货 | NCo Client 过账、处理 RETURN、提交、保存凭证 | 项目业务目标；具体生产接口与调用方式须以代码为准 |

- 入站 Registered RFC 的成功返回含义，必须从实际契约查清：表示“已受理”还是“WMS 已同步”。不可提前返回“业务成功”。
- `SAP_INBOUND_DELIVERY_TRACK.TIMED_OUT` 只说明等待超时，不能据此判断 WMS 未写入。人工重放前检查原业务结果，并复用业务防重规则。
- 同一交货单可有多次快照更新：不要仅按交货单号永久去重。保持现有消息身份、版本/变更时间和 WMS 进度保护机制；若无版本，不自创字段假装已支持乱序识别。

## 2. 新增收货调用前必须填清的契约

| 项目 | 本文示例 | 实际开发要求 |
|---|---|---|
| 业务 | 普通采购订单 101 收货 | 与“按入库交货单收货”区分；确认是否需更新交货单状态和单据流 |
| 函数 | `BAPI_GOODSMVT_CREATE` | 若项目已用 Z RFC，读取其契约，不自行改用 BAPI |
| 提交方 | Middleware 调 `BAPI_TRANSACTION_COMMIT` | 若 Z RFC 内部已提交，不再套一层提交 |
| 幂等 | WMS 稳定收货事件 ID | 确认 SAP 侧防重/查证能力；普通 BAPI 示例本身不提供防重 |
| 成功证据 | RETURN 无错误、凭证号/年度有效、提交成功 | 真实业务还应核对交货单状态、数量、批次和分类 |
| 批次分类 | 项目历史场景为 plant 层级、class type 022 | 核实本次物料、分类对象键、类和特征；不把测试类 Z_TEST8 写成生产常量 |

“BAPI 返回了物料凭证号”不能替代“入库交货单已正确收货”。禁止为了让示例跑通而把交货单收货偷偷改为采购订单收货。

## 3. C# 字段映射示例：普通 PO 收货

以下是 Adapter 内的片段；`destination` 来自已注册配置，`postingDate` 为 DateOnly，`quantity` 为已校验 decimal。数据为虚构样例。示例只演示普通 PO 101，不涵盖特殊库存、退货、拆批或交货单状态更新。

```csharp
using System.Globalization;
using SAP.Middleware.Connector;

// 每次业务调用创建独立可变容器；不缓存为单例或跨线程共享。
IRfcFunction function = destination.Repository.CreateFunction("BAPI_GOODSMVT_CREATE");
IRfcStructure header = function.GetStructure("GOODSMVT_HEADER");
header.SetValue("PSTNG_DATE", postingDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
header.SetValue("DOC_DATE", postingDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
function.GetStructure("GOODSMVT_CODE").SetValue("GM_CODE", "01");

IRfcTable items = function.GetTable("GOODSMVT_ITEM");
items.Append();
items.SetValue("PO_NUMBER", "4500001234");
items.SetValue("PO_ITEM", "00010");
items.SetValue("PLANT", "1000");
items.SetValue("STGE_LOC", "0001");
items.SetValue("MOVE_TYPE", "101");
items.SetValue("MVT_IND", "B");
items.SetValue("ENTRY_QNT", quantity);  // 如 12.500m；禁止先 ToString 再让 SAP 猜格式
items.SetValue("ENTRY_UOM", "EA");    // 由已验证的单位映射取得；不假设 EA 在目标系统有效
// 批次必填时再按契约填写 BATCH；禁止自动造批次号或截断。
```

实际映射逐字段核对：

| WMS 字段 | SAP 目标/处理 | 例子与限制 |
|---|---|---|
| `postingDate` | `GOODSMVT_HEADER.PSTNG_DATE` | 业务日，不能先转 UTC 导致跨日 |
| `poNumber` / `poItem` | `PO_NUMBER` / `PO_ITEM` | 字符串，保留 `00010` |
| `quantity` / `unit` | `ENTRY_QNT` / `ENTRY_UOM` | decimal + 经确认的 SAP 单位；单位转换需业务规则 |
| `batch` | `BATCH` | 长度从元数据验证；禁止强行裁剪 |
| `inboundDelivery` / `item` | 由批准的交货单收货契约决定 | 不能只塞进抬头文本就宣称建立了凭证关联 |
| `wmsReceiptId` | 用于可靠防重/查证的批准字段或 SAP 记录 | 普通参考文本不是唯一约束；无此能力就进入受控核实方案 |

不为所有字符串统一 `Trim()` 或 `PadLeft(18,'0')`。例如交货单行 `000010` 与采购订单行 `00010` 长度不同；物料是否用长字段需看目标接口。

## 4. C# 读取业务返回示例

下面的方法可放入现有 Adapter；需要 `System.Collections.Generic` 与 `SAP.Middleware.Connector`。只识别错误，不负责提交或重试。

```csharp
static List<(string Type, string Id, string Number, string Text)> ReadErrors(IRfcTable table)
{
    var errors = new List<(string Type, string Id, string Number, string Text)>();
    for (var index = 0; index < table.RowCount; index++)
    {
        table.CurrentIndex = index;
        var type = table.GetString("TYPE");
        if (type is "E" or "A" or "X")
            errors.Add((type, table.GetString("ID"),
                table.GetString("NUMBER"), table.GetString("MESSAGE")));
    }
    return errors;
}
```

- `Invoke` 未抛异常后仍读取完整 RETURN。不能只看第一行或只识别 `TYPE == "E"`。
- W 消息保留；按业务契约决定是否允许提交，不默认所有 W 都失败。
- 内部保存 ID/NUMBER/TYPE 便于定位；API 返回稳定业务错误码及脱敏信息，不原样透传所有 SAP 消息。

## 5. 会话与提交：按这个执行顺序实现

以下是**流程伪代码**，其中结果保存、核实和日志方法要接到真实实现，不创建空壳返回成功。

```text
前置：持久化过账意图与请求快照；原子取得执行权；确认该状态提交成功。
      如果已有 PROCESSING/UNKNOWN，进入查证，不能直接再 Invoke。
构建并验证函数和字段（尽量在进入会话前完成）。
BeginContext(destination) 成功后：
  try:
    同一线程调用写 BAPI。
    读取所有 RETURN 与凭证号/年度。
    若明确业务拒绝：在同一会话 Rollback；检查返回；保存 REJECTED。
    若返回无错误但凭证缺失：不报告成功；核实接口语义，进入 UNKNOWN/协议异常处理。
    若满足提交条件：调用 BAPI_TRANSACTION_COMMIT，WAIT = "X"。
      检查 Commit 的 RETURN（结构，不能按表读取）。
      提交确认成功后才形成 SUCCEEDED 结果；保存物料凭证号与年度。
  catch:
    若证明尚未开始写调用：交给已批准的安全重试策略。
    若写调用/Commit 已开始而无法确定结果：保存 UNKNOWN，禁止重新过账。
  finally:
    EndContext(destination)；释放异常另记，不能掩盖已确定的提交结果/原始错误。
```

- 默认 NCo 会话与线程有关。这一段内不 `await`、不跨 `Task.Run`、不 `Task.WhenAll`；Oracle 异步读写放在会话外。若已有自定义 SessionProvider，先理解其实现。
- BeginContext 抛错时不要调用 EndContext；EndContext 放 finally，但 Commit 绝不能放 finally。
- 一个查询 RFC 不需要跟随 Commit。Rollback 不能撤销已提交的 SAP 凭证。
- 调用方断线/超时不代表同步 NCo Invoke 已取消；禁止另起第二次过账来“补救”。
- NCo Destination/配置按进程启动管理。不要每个请求重新注册配置，或缓存一个可变 IRfcFunction 让所有请求复用。

## 6. 重试决策表：Handler 必须据此分支

| 情况 | 记录/行为 | 是否再调用写 RFC |
|---|---|---|
| 字段映射阶段失败，尚未 Invoke | 本地校验/配置错误 | 修正后才允许 |
| 函数明确拒绝且确认无提交 | REJECTED；保存错误码 | 普通业务拒绝不自动重试 |
| 已识别的 SAP 锁错误，确认本次无副作用 | 有界延迟重试；记次数 | 按现有恢复策略允许 |
| 写 Invoke 或 Commit 通信中断 | UNKNOWN；查证或人工处理 | 禁止盲重试 |
| Commit 成功但 Oracle 保存失败 | 保留持久化执行标记；重投先查证 SAP | 禁止直接再次过账 |
| 重投时发现 SUCCEEDED | 复用已存凭证 | 否 |
| 发现遗留 PROCESSING | 查询是否存在仍在执行的调用，并核实 SAP | 超时不是允许重过账的证据 |

只有可靠证明原调用不会再产生提交、且确实未成功，或 SAP 侧幂等接口保证重复安全时，才允许恢复写调用。查询暂时“没找到”不构成这种证明。

若 UNKNOWN 写入 Oracle 也失败，让技术异常进入现有告警/恢复流程；下次必须从事先提交的执行标记进入查证。不得 `catch { return; }` 让消息静默成功。

## 7. 批次、分类与并发的具体限制

- 对“创建批次 → 分类 → 收货”列出每一步是否内部 Commit。不能因为调用在一个方法里就承诺全部原子完成。
- 收货成功而分类失败时保留已生成凭证；恢复分类步骤，不能重新收货。需要冲销时走独立授权业务。
- 一个批次拆成两行时，分别保存原始收货行身份与数量；不要以物料号去重，导致合法拆批被吃掉。
- 同物料并发出现 valuation lock 时，先明确工厂/估价范围等真实锁粒度；遵守全体 Endpoint/实例的 RFC 并发预算。单机 SemaphoreSlim 不能限制全部实例。
- 不自行改 Fast Serialization、池大小、超时或线程数；先测量并给出具体瓶颈。

## 8. 本领域验收用例

| 用例 | 必须断言 |
|---|---|
| 同一 `wmsReceiptId` 连续/并发提交 2 次 | 最多一次业务过账，返回同一操作/凭证 |
| RETURN 先 S 后 E | 不 Commit，不报告成功 |
| Commit 返回错误或响应丢失 | 不报告成功、不盲重试；进入核实 |
| SAP 成功后进程崩溃，消息重投 | 先核实，最终仍只有一张凭证 |
| WMS 已开始处理后收到更新 ASN | 不覆盖 WMS 卸货/上架/批次进度 |
| 收货带批次与分类 | SAP 数量、批次、分类及交货单状态均核对 |

Mock 只验证分支与映射；真实 SAP LUW、锁、权限、提交与单据流必须另做 SAP 测试。未执行就明确写未执行。
