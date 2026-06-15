# v0.3.1 增补：跨工具显性化设计

**类型**：v0.3 主架构文档的差异化增补，不替代 v0.3
**目的**：把"跨工具产品记忆"从隐性优势变成显性卖点
**编写时间**：2026-05-27

---

## 0. 背景与定位调整

### 0.1 为什么需要这份增补

v0.3 文档评估时识别出一个核心漏洞：**Compass 最强的护城河是"跨工具记忆"，但 v0.3 在数据模型、MCP 工具、Dashboard 三个层面都没有专门强化这一点**。

如果用户全程只用 Claude Code，Compass 相对 TodoWrite 的优势就只剩"数据持久到 commit 之后"——这不构成产品差异化。必须让"跨工具"在产品的每一层都可见、可用。

### 0.2 项目模式从 indie 升级为创业产品

用户已决定项目定位从"indie tool 顺便商业化"调整为"创业产品"。这意味着：

- §1.6（v0.3 中的项目模式声明）需要在下一版（v0.4）重写
- 商业化设计不再是次要项，需要明确付费层价值锚点
- 差异化必须显性，否则没有融资/营销故事
- 接受成本（onboarding 复杂度）需要重新审视

本增补只解决跨工具显性化，不涉及定位重写——但增补的设计会**为创业产品定位预留商业化抓手**。

---

## 1. 跨工具显性化的三个核心场景

设计任何功能前，先锁定三个能被用户清晰描述的场景。所有数据模型与工具新增都服务于这三个场景。

### 1.1 Handoff 场景（最高优先级）

**用户故事**：
> 上午在 Cursor 里跟 AI 写了邮箱登录的后端 API。下午换到 Claude Code 想继续做"忘记密码"功能，但 Claude Code 完全不知道上午的进度——我必须重新解释一遍上下文。

**Compass 解决方式**：
- 用户在 Claude Code 里说"接着上午 Cursor 的工作继续"
- AI 调用 `compass_generate_handoff_brief({feature_node_id: <password_reset>})`
- 返回 markdown：父功能（邮箱登录）当前状态 + 上午 AIRun 的 plan & summary + 改动的 files + 相关 CodeTodo
- AI 把这段作为自己的上下文吸收，无缝继续

**核心价值**：每次切换工具节省 5-10 分钟的上下文重建。每周切换 3-5 次的重度用户，月度时间节省 1-3 小时。

### 1.2 客户端审计场景

**用户故事**：
> 我同时用 Cursor 写代码、Claude Code 跑 shell、Claude Desktop 做架构设计。一周下来不知道哪个工具实际产出最多，也不知道哪些功能是哪个工具做的。

**Compass 解决方式**：
- Dashboard 提供"客户端活动"视图
- 按 client_type × 时间分组，显示每个客户端的 AIRun 数、commit 数、文件改动总数、成功率
- 节点详情页显示"参与过的客户端"图标列表
- 让用户对自己的 AI 工具组合有定量认知

**核心价值**：用户能基于数据决定"下个项目我要用哪个工具组合"。这本身就是一个 vibe coder 群体中目前没有任何工具提供的认知服务。

### 1.3 接力提醒场景

**用户故事**：
> 我在 Claude Code 里想做"用户头像上传"，但其实 Cursor 三天前已经做到一半然后我忘了。Claude Code 不知道这件事，又重新做了一遍，结果代码冲突。

**Compass 解决方式**：
- AI 调 `compass_list_features` 时，每个节点带 `last_touched_by: 'cursor'` + `last_touched_at: '3天前'`
- AI 在 description 里被指示：发现 last_touched_by 不是当前 client 且 active_ai_run_id 非空时，提示用户"这个功能 3 天前 Cursor 还在改，要不要先看看那次进度？"
- 用户确认后调 `compass_generate_handoff_brief` 走 1.1 流程

**核心价值**：防止跨工具重复劳动与代码冲突。这是 Compass 真正能阻止的"具体损失"，比 1.1、1.2 都更硬。

---

## 2. 数据模型补充

### 2.1 `feature_nodes` 表新增字段

```sql
ALTER TABLE feature_nodes ADD COLUMN last_client_touched TEXT;
ALTER TABLE feature_nodes ADD COLUMN last_touched_at INTEGER;
ALTER TABLE feature_nodes ADD COLUMN client_participation TEXT NOT NULL DEFAULT '{}';

CREATE INDEX idx_nodes_last_touched ON feature_nodes(project_id, last_touched_at DESC);
```

字段说明：

| 字段 | 类型 | 含义 |
|---|---|---|
| `last_client_touched` | TEXT | 最近一次操作此节点的客户端类型（'cursor' / 'claude_code' / ...） |
| `last_touched_at` | INTEGER | 最近一次操作时间（Unix ms） |
| `client_participation` | TEXT | JSON 对象 `{"cursor": 3, "claude_code": 1}`，记录每个客户端参与过的 AIRun 数 |

**为什么用冗余字段而非每次 JOIN ai_runs 计算**：
- 跨节点列表查询时性能差异巨大（一次查 200 节点 vs 200 次子查询）
- 是衍生数据但更新成本低：每次 ai_run 写入时同步更新当前节点的这三个字段即可
- 永远以 ai_runs 为真相源头，这里只是缓存

### 2.2 `ai_runs` 表无变化

`client_type` 字段已存在于 v0.3 模型中，本增补只补全使用方式。

### 2.3 新增视图（SQL view，非物化）

```sql
CREATE VIEW v_client_activity AS
SELECT
  project_id,
  client_type,
  date(started_at / 1000, 'unixepoch') AS day,
  COUNT(*) AS run_count,
  SUM(CASE WHEN run_status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(CASE WHEN run_status = 'failed' THEN 1 ELSE 0 END) AS failed_count
FROM ai_runs
GROUP BY project_id, client_type, day;
```

用于 Dashboard 客户端活动视图。视图查询便宜，不需要物化。

---

## 3. MCP 工具新增

v0.3 是 11 个工具，v0.3.1 新增 2 个，总计 13 个。

### 3.1 `compass_generate_handoff_brief`

```typescript
{
  name: "compass_generate_handoff_brief",
  description: `Generate a context brief for handing off work between AI tools.

  USE THIS WHEN:
  - The user says "I was working on this in <other tool>, continue from there"
  - The user explicitly says "give me a handoff" / "summarize what was done"
  - You see in list_features that a node was last touched by a different client and the user wants to continue

  Returns markdown the user can paste into another AI client (or you can absorb directly as context).

  The brief includes: parent feature status, last 3 AIRuns with plans/summaries, files touched, related code todos, current phase, current status.`,

  inputSchema: {
    type: "object",
    properties: {
      feature_node_id: { type: "string" },
      include_children: { type: "boolean", default: true },
      include_siblings: { type: "boolean", default: false, description: "Include sibling features for broader context" },
      max_runs: { type: "integer", default: 3, minimum: 1, maximum: 10 }
    },
    required: ["feature_node_id"],
    additionalProperties: false
  }
}
```

返回示例（markdown）：

```markdown
# Handoff Brief: Password reset (Auth › Password reset)

**Current status**: in_progress  ·  **Phase**: v1
**Last touched**: cursor, 3 hours ago

## Parent feature: Email login (verified, v1)
Implemented and user-verified on 2026-05-20. Uses bcrypt + JWT.

## Recent AIRuns
### Run #3 (cursor, 3 hours ago, status=completed)
**Intent**: implement
**Plan**:
- Add /auth/forgot endpoint
- Send reset email with one-time token
- Add /auth/reset endpoint accepting token

**Summary**: Implemented forgot endpoint, email sending stubbed (needs SendGrid setup). Reset endpoint not started.

**Files touched**: src/auth/forgot.ts, src/services/email.ts

### Run #2 (cursor, 5 hours ago, status=abandoned)
... (omitted for brevity)

## Pending code TODOs
- [ ] Wire SendGrid API key (src/services/email.ts:18, by cursor)
- [ ] Add rate limit to /auth/forgot (src/auth/forgot.ts:42, by cursor)

## Suggested next step
The email sending stub needs SendGrid API key configured. The /auth/reset endpoint is not implemented.
```

**实现要点**：
- 服务端组装 markdown，不让 AI 自己拼（保证一致性）
- 内容来自 `feature_nodes` + `ai_runs` + `code_todos` + 父/子节点关系
- 字数控制在 800-1500 token，方便直接吸收

### 3.2 `compass_get_client_activity`

```typescript
{
  name: "compass_get_client_activity",
  description: `Query which AI clients have been active on this project, with stats.

  USE THIS WHEN:
  - The user asks "what did Cursor do this week" / "what was Claude Code's contribution"
  - You want to suggest the user switch tools (e.g. "you've been using Cursor a lot, Claude Code might be better for this shell-heavy task")
  - You're generating a project status report

  Returns per-client aggregates: AIRun counts, success/failure rates, files touched count, last active timestamp.`,

  inputSchema: {
    type: "object",
    properties: {
      since: { type: "string", description: "ISO timestamp, default: 7 days ago" },
      until: { type: "string", description: "ISO timestamp, default: now" },
      client_type: { type: "string", description: "Filter to one client; omit for all" }
    },
    additionalProperties: false
  }
}
```

返回示例：

```json
{
  "period": "2026-05-20 to 2026-05-27",
  "clients": [
    {
      "client_type": "cursor",
      "run_count": 18,
      "completed": 14,
      "failed": 2,
      "abandoned": 2,
      "files_touched_count": 47,
      "last_active": "2026-05-27T08:42:00Z",
      "top_features": ["Email login", "Password reset"]
    },
    {
      "client_type": "claude_code",
      "run_count": 9,
      "completed": 7,
      "failed": 0,
      "abandoned": 2,
      "files_touched_count": 23,
      "last_active": "2026-05-26T19:15:00Z",
      "top_features": ["Database migrations", "Deploy scripts"]
    }
  ]
}
```

---

## 4. 现有工具的描述更新

### 4.1 `compass_list_features` 返回字段扩展

每个节点 JSON 增加：

```json
{
  "id": "...",
  "title": "...",
  "status": "...",
  // ... 已有字段
  "last_client_touched": "cursor",        // 新
  "last_touched_at": "2026-05-27T08:42:00Z", // 新
  "client_participation": { "cursor": 3, "claude_code": 1 } // 新
}
```

无 schema 变化，只是 payload 更丰富。AI 可以基于此判断"这个节点上次是别的工具改的"。

### 4.2 `compass_list_features` description 微调

在 USE THIS WHEN 段落末尾加一句：

> If a feature's `last_client_touched` differs from your current client and the user wants to continue working on it, suggest calling compass_generate_handoff_brief to get the context first.

引导 AI 主动发现接力机会。

### 4.3 `compass_start_ai_run` 服务端逻辑增强

调用时除了创建 ai_run，额外更新对应 feature_node：

```sql
UPDATE feature_nodes
SET last_client_touched = ?,
    last_touched_at = ?,
    client_participation = json_set(
      client_participation,
      '$.' || ?,
      COALESCE(json_extract(client_participation, '$.' || ?), 0) + 1
    )
WHERE id = ?;
```

reconciler 在创建 `origin='reconciled'` 的 ai_run 时同样维护这些字段。

---

## 5. Dashboard 新增

### 5.1 客户端活动视图（新页面）

URL: `/clients`

布局：
```
┌─────────────────────────────────────────────────┐
│ Project: my-saas  |  Time: Last 7 days [↓]      │
├─────────────────────────────────────────────────┤
│                                                 │
│   Cursor          ████████████████  18 runs    │
│                   ✓14  ✗2  ⊘2  47 files        │
│   Top: Email login, Password reset              │
│                                                 │
│   Claude Code     ████████  9 runs              │
│                   ✓7   ✗0  ⊘2  23 files        │
│   Top: DB migrations, Deploy scripts            │
│                                                 │
│   Claude Desktop  ██  3 runs                    │
│   ...                                           │
└─────────────────────────────────────────────────┘
```

下面叠加每日时间线图，显示每天哪个客户端最活跃。

### 5.2 节点详情页加"客户端参与"区块

在 AIRun 时间线上方加一行：

```
Participated by:  [Cursor 3]  [Claude Code 1]   Last: Cursor (3h ago)  [Handoff brief →]
```

点 `Handoff brief →` 按钮弹出当前节点的 handoff brief markdown，可一键复制。

### 5.3 节点列表的"上次接触"列

树形视图右侧加一列显示 `last_client_touched` 图标 + 相对时间。让用户一眼看到"哪些节点最近被另一个工具碰过"。

---

## 6. 与现有信任边界的兼容性

跨工具显性化不引入新的信任边界，但要确认现有边界仍然成立：

- `compass_generate_handoff_brief` 是只读操作，不改任何状态——安全
- `compass_get_client_activity` 也是只读——安全
- `last_client_touched` 等字段由服务端自动维护，AI 不能直接写——安全
- AI 在 handoff brief 里看到 "上次 Cursor 做到 X"，可能错误地把"X 已经完成"作为前提继续。**风险点：服务端组装 brief 时必须明确标注每个 run 的 `run_status`，不能让 AI 误读 abandoned/failed 的 run 为 completed**

---

## 7. MVP 范围影响

### 7.1 v0.3.1 加入 MVP 必须做的内容

| 项 | 位置 | 工程量预估 |
|---|---|---|
| 2 个新字段 + 1 个 view | 数据迁移 | 0.5 天 |
| `compass_generate_handoff_brief` | MCP Server | 2 天（含 markdown 组装逻辑） |
| `compass_get_client_activity` | MCP Server | 1 天 |
| `list_features` payload 扩展 | MCP Server | 0.5 天 |
| `start_ai_run` 服务端字段维护 | MCP Server | 0.5 天 |
| reconciler 同步维护字段 | daemon | 0.5 天 |
| 客户端活动视图（/clients 页） | Dashboard | 2 天 |
| 节点详情页客户端区块 + Handoff 按钮 | Dashboard | 1.5 天 |
| 节点列表"上次接触"列 | Dashboard | 0.5 天 |
| **合计** | | **约 9 天 / 1.8 周** |

### 7.2 v0.3 路线图调整

v0.3 是 18 周。加入 v0.3.1 后变为 19-20 周。具体插入点：

- 第 5-6 周末尾：reconciler 完成后顺手加客户端字段维护（+0.5 天）
- 第 7 周 MCP 工具补全时，把 `generate_handoff_brief` 和 `get_client_activity` 一并做（+3 天）
- 第 11-12 周 Dashboard 节点详情页时，加客户端参与区块和 handoff 按钮（+1.5 天）
- 第 13 周末新增：客户端活动视图开发（+2 天）

工程量分散到既有阶段，不需要单独的 v0.3.1 集中开发周。

### 7.3 v0.3.1 不做的事

- 客户端能力声明（"Claude Code 能跑 bash，Cursor 不能"等）——post-MVP
- 客户端推荐引擎（"这个任务适合用 X 工具"）——post-MVP
- 跨设备同步（云同步层的事）——post-MVP
- handoff brief 的多语言模板——v1.0 后
- 客户端切换的自动检测（不依赖用户主动说"切换工具"）——技术上做不到，跳过

---

## 8. 对商业化的贡献

按"创业产品"定位，每个新功能都应该问：这能成为付费理由吗？

| 功能 | Free 层 | Pro 层独占 |
|---|---|---|
| Handoff brief 生成 | ✅ 基础版（当前节点） | ✅ 高级版（跨项目、跨设备） |
| 客户端活动视图 | ✅ 7 天数据 | ✅ 无限历史 + 导出 |
| 节点参与客户端 | ✅ 全部 | - |
| `get_client_activity` MCP | ✅ 当前项目 | ✅ 跨项目聚合 |

**商业故事**：
- Free 层让用户体验跨工具的甜头
- Pro 层把跨设备 / 跨项目 / 历史数据作为升级动机
- 这比"云同步"作为唯一 Pro 卖点更有说服力——"云同步"是基础设施，"跨设备 + 跨项目 handoff"是工作流升级

新的 Pro 价值锚点：
- **$9/月 = 让你的多设备 + 多 AI 工具协同工作流像一个工具一样顺**

这是 v0.3 主文档欠缺的、v0.3.1 补上的商业化抓手。

---

## 9. 验证假设（补充到 v0.3 §6.3）

v0.3.1 引入的新假设：

9. **用户真的会跨工具工作吗？** 如果 80% 用户只用一个 AI 客户端，整个 v0.3.1 投入是浪费
10. **handoff brief 的格式真的能被另一个 AI 客户端有效吸收吗？** 不同模型对 markdown 上下文的吸收效率不同
11. **客户端活动视图是真的有用还是 vanity metric？** 数据可视化常常变成"看了一次再也不看"

**dogfood 阶段必须验证假设 9、10**。如果假设 9 成立率 <40%，需要考虑把跨工具角度淡化、转向其他差异化（比如更深的代码审计能力）。

---

## 10. 与 v0.3 主文档的关系

| 维度 | v0.3 主文档 | v0.3.1 增补 |
|---|---|---|
| 数据模型 | 6 张表 + 7 个状态 + phase | + 3 个字段 + 1 个 view |
| MCP 工具 | 11 个 | + 2 个，共 13 个 |
| Dashboard | 树形 / 待测试 / 待操作 / 未归类 | + 客户端活动 / handoff 按钮 |
| 项目模式 | indie | **创业产品**（v0.4 重写） |
| 路线图 | 18 周 | 19-20 周（增量分散插入） |

v0.4 文档（未来）需要做的事：
- 重写 §1.6 反映创业产品定位
- 整合 v0.3.1 内容进主结构（不再作为增补）
- 重新评估 §8 商业模式
- 增加增长机制设计（landing page、邀请机制、内容营销策略——这些 indie 模式下被刻意排除的）

---

## 11. 下一步

按用户决定，跳过 landing page 验证、直接进入开发。v0.3.1 不需要单独的开发周期，并入 v0.3 的 18 周计划即可。

具体动作建议：

1. **本周**：第 0 周骨架开发时，把 `feature_nodes` 的 3 个新字段一并加入初始 schema（避免后续 migration）
2. **第 7 周 MCP 工具补全时**：优先做 `generate_handoff_brief`——这是最强的差异化展示点，越早自己 dogfood 越好
3. **第 15 周 dogfood**：刻意制造跨工具场景（上午 Cursor、下午 Claude Code），实测假设 9、10
4. **v0.4 文档**：dogfood 完成后再写，反映真实使用反馈而非纯纸面设计

---

*文档版本：v0.3.1 · 2026-05-27*
*类型：差异化增补*
*主题：跨工具显性化*
*相对 v0.3：+3 字段 / +2 MCP 工具 / +1 Dashboard 页 / +商业化抓手*
