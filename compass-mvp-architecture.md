# MVP 技术架构文档

**产品代号**：Compass（暂定）
**一句话定位**：让 vibe coder 随时知道 AI 帮自己做到了哪一步的产品记忆中枢
**目标用户**：独立开发者、用 AI 编程的技术型非工程师
**MVP 目标**：3 个月内可上线、单人可维护、能验证核心假设

---

## 1. 设计原则

在做任何技术决策前，先明确以下原则。后面所有选型都服从这些原则。

### 1.1 摩擦最小原则

用户已经在用 AI 写代码了，他们不会愿意为了维护"产品记忆"再切换到另一个工具。所有数据写入应该尽可能由 AI 自动完成，用户只在"确认测试通过"这一步做最少的手动操作。

### 1.2 工具中立原则

不绑定任何单一 AI 工具。今天用户用 Cursor，明天可能换 Claude Code，后天可能用 ChatGPT Desktop。产品的价值在于跨工具持久化产品状态，而不是成为某个 AI 工具的附属品。MCP 协议天然解决这个问题。

### 1.3 本地优先原则

数据默认存在用户本地，云同步是可选项。这对独立开发者群体特别重要——他们对"我的产品蓝图被上传到云端"高度敏感。本地优先也降低了运营成本，让免费层有可能持续。

### 1.4 渐进复杂度原则

第一次打开应用，用户看到的应该是空的功能清单加一个"安装 MCP Server"按钮。所有高级功能（多项目、AI 自动测试、跨会话查询）都藏在后面，不打扰首次使用者。

---

## 2. 技术栈选型

### 2.1 选型总览

| 层 | 选型 | 理由 |
|---|---|---|
| MCP Server | TypeScript + 官方 SDK | 生态最成熟，与 Node 工具链一致 |
| 本地数据存储 | SQLite（better-sqlite3） | 零配置、单文件、跨平台 |
| Web Dashboard | Next.js 15 + React 19 | 服务端组件适合本地优先架构 |
| Dashboard UI | Tailwind + shadcn/ui | 单人维护，避免自己写组件 |
| 云同步（付费层） | Supabase（Postgres + Auth） | 减少自建后端工作量 |
| 桌面打包（可选） | Tauri 2 | 比 Electron 轻量，Rust 后端 |
| 部署 | Vercel（Web）+ npm（MCP Server） | 个人开发者零运维 |

### 2.2 关键选型详解

#### MCP Server：TypeScript

官方 TypeScript SDK 是目前最成熟的实现，2026 年 Q1 已发布 v2 稳定版。Python SDK 同样官方支持，但 TypeScript 在两个方面更优：第一，Node.js 生态便于打包成 `npx` 一键运行的命令，符合 MCP Server 的主流分发方式；第二，Dashboard 用 Next.js 时可以共享类型定义，减少前后端类型不一致的问题。

传输协议选择 **stdio 优先，Streamable HTTP 备选**。stdio 是 Claude Desktop、Cursor 等主流 IDE 的默认本地传输方式，零配置；Streamable HTTP 在 2025-11 spec 中正式取代 SSE，用于未来的云端部署。MVP 阶段只实现 stdio，云同步层用独立的 REST API，不混合在 MCP Server 里。

#### 本地存储：SQLite

选 SQLite 而非 JSON 文件或 IndexedDB 的核心原因：MCP Server（Node 进程）和 Web Dashboard（浏览器/Next.js 进程）需要访问同一份数据。SQLite 的单文件锁机制能优雅处理并发读写，而 JSON 文件在并发写入时会丢数据。

数据库文件默认放在 `~/.compass/db.sqlite`（macOS/Linux）或 `%APPDATA%/compass/db.sqlite`（Windows），可通过环境变量覆盖。

#### Web Dashboard：Next.js

Next.js 15 的 Server Components 让本地 Dashboard 也能直接访问 SQLite（不需要写 API 层）。MVP 阶段 Dashboard 以 `localhost:3737` 形式运行（用户启动 MCP Server 时一并启动），未来可以无缝迁移到 Tauri 桌面应用或 Vercel 云部署。

不选 Electron 的理由是体积和资源占用对独立开发者群体不友好。Tauri 是更好的桌面化方案，但 MVP 阶段先用浏览器访问 localhost 足够。

#### 不选什么

- **不用 LangChain 或类似 AI 编排框架**：MVP 不需要自己跑 LLM，所有 AI 调用都由用户的 AI 客户端（Cursor、Claude Code）发起。我们只是被调用的工具
- **不用 GraphQL**：单一客户端、单一数据库，REST + tRPC 足够
- **不用 NoSQL**：产品状态本质是结构化数据（功能、状态、关联），关系型数据库更合适
- **不自建认证系统**：MVP 本地版本不需要认证；付费云同步层直接用 Supabase Auth

---

## 3. 数据模型

数据模型设计的核心约束：**每个实体都必须能被 AI 自动写入并被人类轻易理解**。这意味着字段不能太多、含义不能太抽象。

### 3.1 ER 概念图

```
Project (1) ──< (N) Feature (1) ──< (N) TestRun
                       │
                       └──< (N) AIConversationLink
                       
Project (1) ──< (N) TodoItem
Project (1) ──< (N) Bug (post-MVP)
```

### 3.2 表结构定义

#### `projects` — 项目

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- ULID, 26 字符
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,   -- 项目代码根目录绝对路径
  description TEXT,
  created_at INTEGER NOT NULL,      -- Unix ms
  updated_at INTEGER NOT NULL
);
```

`root_path` 是关键字段。MCP Server 启动时会被 AI 客户端告知当前工作目录，据此匹配项目。**一个目录对应一个项目**，避免歧义。

#### `features` — 功能

```sql
CREATE TABLE features (
  id TEXT PRIMARY KEY,              -- ULID
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,              -- "用户邮箱登录"
  description TEXT,                 -- 自然语言描述功能行为
  status TEXT NOT NULL,             -- 见下方枚举
  source TEXT NOT NULL,             -- 'ai' | 'user'，谁创建的
  test_steps TEXT,                  -- AI 生成的手动测试步骤（markdown）
  last_tested_at INTEGER,           -- 用户最后一次确认测试通过的时间
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_features_project_status ON features(project_id, status);
```

`status` 枚举（**这是产品的核心状态机**）：

| 状态 | 含义 | 谁能转入 |
|---|---|---|
| `planned` | 用户规划但还没开始 | 用户手动创建 |
| `in_progress` | AI 正在开发 | AI 通过 MCP 调用 |
| `ai_completed` | AI 说做完了，待用户测试 | AI 通过 MCP 调用 |
| `verified` | 用户手动测试通过 | 用户在 Dashboard 操作 |
| `broken` | 用户测试发现坏了 | 用户在 Dashboard 操作 |
| `archived` | 已废弃 | 用户手动 |

**关键设计**：AI 永远不能把状态推到 `verified`。这是核心信任边界——只有人类能宣布"这个功能真的能用"。这是整个产品价值的根基。

#### `ai_conversation_links` — AI 会话锚点

```sql
CREATE TABLE ai_conversation_links (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL,        -- 'cursor' | 'claude_code' | 'claude_desktop' | 'other'
  session_id TEXT,                  -- 客户端提供的会话 ID（如有）
  conversation_summary TEXT,        -- AI 自己生成的摘要："实现了邮箱登录的后端 API"
  commit_sha TEXT,                  -- 关联的 git commit（如有）
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_links_feature ON ai_conversation_links(feature_id);
```

为什么不存完整对话内容：太重，且大部分 AI 客户端不开放对话历史的程序化访问。存 **session_id + 摘要 + commit** 三元组，让用户能"回到当时的现场"——能通过 session_id 跳回 Claude Code 的对应会话，能通过 commit 看代码变更，能通过摘要快速回忆。

#### `test_runs` — 测试记录

```sql
CREATE TABLE test_runs (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  result TEXT NOT NULL,             -- 'passed' | 'failed'
  notes TEXT,                       -- 用户自由输入的备注
  tested_at INTEGER NOT NULL
);
```

简单的事件流，记录每次测试。失败的 test_run 会把 feature 推到 `broken` 状态。

#### `todos` — 待办

```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  feature_id TEXT REFERENCES features(id),  -- 可选关联到功能
  content TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,           -- 布尔
  created_by TEXT NOT NULL,                  -- 'ai' | 'user'
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

刻意保持简单。Todo 不是产品的核心，只是为了让 AI 在写代码时遇到"这里有个 TODO 还没做"时有地方记。复杂的优先级、tag、截止日期都不要。

### 3.3 数据流示例

一个典型的功能生命周期：

```
1. 用户在 Cursor 里跟 AI 说："帮我做一个邮箱注册功能"
2. Cursor 通过 MCP 调用 compass.create_feature(...)
   → features 表新增一行，status='in_progress'
   → ai_conversation_links 新增一行，记录 session_id
3. AI 写完代码后通过 MCP 调用 compass.mark_feature_completed(...)
   → status='ai_completed'
   → 同时调用 compass.generate_test_steps(...) 写入 test_steps
4. 用户打开 Dashboard，看到"3 个功能待测试"
5. 按 test_steps 手动测试，点击"通过"
   → test_runs 新增一行，result='passed'
   → features.status='verified', last_tested_at 更新
```

---

## 4. MCP 接口设计

这是整个产品的核心 API 表面。设计原则：**让 AI 模型能直觉地知道何时调用**。每个工具的描述（description）需要写得让 LLM 看到就明白用途，这比签名本身更重要。

### 4.1 工具列表（MVP）

| 工具名 | 用途 | 调用方 |
|---|---|---|
| `compass_list_features` | 列出当前项目的功能和状态 | AI 用于"我现在做到哪了"类提问 |
| `compass_create_feature` | 创建新功能并标记为开发中 | AI 在开始实现新功能前 |
| `compass_update_feature_status` | 更新功能状态（限定为 ai_completed 或 in_progress） | AI 完成开发后 |
| `compass_log_test_steps` | 为功能补充手动测试步骤 | AI 完成开发后顺手生成 |
| `compass_get_feature` | 获取功能详情 | AI 需要回溯上下文 |
| `compass_add_todo` | 添加待办事项 | AI 遇到未完成的子任务 |
| `compass_list_todos` | 列出未完成待办 | AI 主动提醒用户 |

### 4.2 关键工具签名

#### `compass_list_features`

这是被调用最频繁的工具，描述必须写得让 AI 一看就懂。

```typescript
{
  name: "compass_list_features",
  description: `List all features in the current project with their implementation status.
  
  USE THIS WHEN:
  - The user asks "what have we built so far" / "what's done" / "where are we"
  - You're about to start a new feature and need to check what already exists
  - You're unsure if a feature has been tested by the user yet
  
  Returns features grouped by status: planned, in_progress, ai_completed (awaiting user test), verified (user confirmed working), broken.`,
  
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["planned", "in_progress", "ai_completed", "verified", "broken", "all"],
        default: "all"
      }
    },
    additionalProperties: false
  }
}
```

返回示例：

```json
{
  "project": "my-saas",
  "summary": {
    "total": 12,
    "verified": 5,
    "ai_completed": 4,
    "in_progress": 2,
    "planned": 1
  },
  "features": [
    {
      "id": "01HXY...",
      "title": "Email registration",
      "status": "verified",
      "last_tested_at": "2026-05-15T..."
    }
  ]
}
```

#### `compass_create_feature`

```typescript
{
  name: "compass_create_feature",
  description: `Create a new feature record before starting implementation. Call this when the user asks you to build something new — even small features. This helps track what the product actually contains across AI sessions.
  
  DO NOT call this for:
  - Bug fixes on existing features (the feature already exists)
  - Internal refactors with no user-facing change
  - One-off scripts or experiments`,
  
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short user-facing name, e.g. 'Email login'" },
      description: { type: "string", description: "1-3 sentences describing the user-facing behavior" },
      session_id: { type: "string", description: "Your current conversation/session ID if available" }
    },
    required: ["title"],
    additionalProperties: false
  }
}
```

注意 description 里明确写了"不要为什么场景调用"——这比只写正面用法效果好，能减少 AI 过度调用。

#### `compass_update_feature_status`

```typescript
{
  name: "compass_update_feature_status",
  description: `Update a feature's status. You can only set status to 'in_progress' or 'ai_completed'. The user must manually mark features as 'verified' through the dashboard — this is a deliberate safety boundary.
  
  Call with 'ai_completed' when you've finished implementing the feature and committed/saved the code. This will queue it for user testing.`,
  
  inputSchema: {
    type: "object",
    properties: {
      feature_id: { type: "string" },
      status: { type: "string", enum: ["in_progress", "ai_completed"] },
      commit_sha: { type: "string", description: "Optional git commit SHA for this change" }
    },
    required: ["feature_id", "status"],
    additionalProperties: false
  }
}
```

服务端必须强制校验 `status` 只能是 `in_progress` 或 `ai_completed`。这是不可妥协的安全边界。

### 4.3 MCP Resources（可选，post-MVP）

MCP 还支持 Resources（资源），适合让 AI 在对话开始时主动加载项目上下文。可以暴露：

- `compass://project/current/summary` — 当前项目的功能清单 markdown 摘要
- `compass://project/current/pending-tests` — 待测试的功能列表

Resources 由 AI 客户端的 host 决定何时加载，比 tools 更被动，适合作为"开局自动了解项目"的入口。但 MVP 阶段先不做，等观察到用户痛点再加。

### 4.4 安全考虑

MCP 安全最佳实践在 2026 年已经成熟，必须遵守：

- **所有工具输入用 Zod schema 严格校验**，`additionalProperties: false` 防止注入额外字段
- **不接受任何 SQL 片段或文件路径作为参数**，所有路径基于 `root_path` 的相对路径
- **stdio 模式下不写敏感数据**：日志只记录工具名和元数据，不记录参数内容
- **写操作幂等性**：`create_feature` 接受可选的 `idempotency_key`，避免 AI 重试时创建重复记录

---

## 5. 系统架构

### 5.1 进程拓扑（本地版）

```
┌──────────────────┐         ┌──────────────────┐
│  Cursor /        │         │  User's browser  │
│  Claude Code     │         │  localhost:3737  │
└────────┬─────────┘         └────────┬─────────┘
         │ stdio                       │ HTTP
         │ (MCP)                       │
         ▼                             ▼
┌──────────────────┐         ┌──────────────────┐
│  compass-mcp     │         │  compass-web     │
│  (Node process)  │         │  (Next.js)       │
└────────┬─────────┘         └────────┬─────────┘
         │                             │
         └──────────┬──────────────────┘
                    ▼
         ┌──────────────────┐
         │  ~/.compass/     │
         │  db.sqlite       │
         └──────────────────┘
```

两个独立进程都通过 SQLite 文件交换数据。SQLite 的 WAL 模式（Write-Ahead Logging）保证并发读写安全。

### 5.2 启动流程

用户运行 `npx compass start`：

1. 检查 `~/.compass/db.sqlite` 是否存在，不存在则初始化 schema
2. 启动 compass-web（Next.js server）监听 :3737
3. 输出 MCP Server 的配置 JSON，让用户复制到 Cursor/Claude Desktop 的配置文件

MCP Server 本身**不是** `compass start` 启动的——它是被 AI 客户端按需 spawn 的子进程，用 stdio 通信。这是 MCP 的标准模式。

### 5.3 云同步层（付费层，post-MVP）

```
┌──────────────────┐
│  Local SQLite    │
└────────┬─────────┘
         │ 增量同步 (CRDT-style)
         ▼
┌──────────────────┐
│  Supabase        │
│  (Postgres)      │
└──────────────────┘
```

云同步要等本地版有用户、验证了核心假设之后再做。技术上用 last-write-wins + 操作日志足够，不需要真正的 CRDT。

---

## 6. MVP 范围严格定义

### 6.1 第一版必须有

- MCP Server 提供上面 7 个工具
- 本地 SQLite 存储
- Web Dashboard 显示：功能清单（按状态分组）、待测试队列、点击功能查看 AI 会话锚点
- 用户能在 Dashboard 上把功能标记为 `verified` 或 `broken`
- `npx compass start` 一键启动
- 文档：怎么在 Cursor、Claude Code、Claude Desktop 中配置

### 6.2 第一版坚决不做

- 用户认证 / 多用户
- 云同步
- 团队协作 / 分享
- Bug 跟踪模块（todo 可以临时充当）
- 自动化测试运行（只生成测试步骤让用户手动跑）
- 集成 GitHub Issues / Jira / Linear
- 移动端
- AI 模型直连（我们不调用 LLM，只被 LLM 调用）
- 分析报表 / 看板视图
- 任何形式的"AI 自动判断功能是否实现"——这违反核心信任边界

### 6.3 验证假设

MVP 是用来验证以下假设的，不是用来赚钱的：

1. AI 客户端真的会按预期调用 MCP 工具吗？（技术可行性）
2. 用户愿意配置一个 MCP Server 来用吗？（接受成本）
3. 看到"功能清单 + 待测试队列"能减轻用户的"产品状态焦虑"吗？（核心价值）
4. 多少用户会在用了 1 周后还在用？（粘性）

如果假设 3 失败，整个产品方向需要重新考虑。如果只是 1 或 2 失败，可以调整形态（比如改成 CLI 工具）。

---

## 7. 3 个月开发路线图

| 周次 | 里程碑 |
|---|---|
| 第 1-2 周 | MCP Server 骨架：stdio 传输、3 个核心工具（list/create/update），SQLite schema |
| 第 3-4 周 | 补全剩余 4 个工具，写单元测试，能在 Claude Desktop 里跑通完整流程 |
| 第 5-6 周 | Web Dashboard：功能清单页 + 待测试页 |
| 第 7-8 周 | Dashboard：功能详情页 + 测试操作 + 简单 todo 列表 |
| 第 9 周 | npm 打包 + 安装文档 + Cursor/Claude Code/Claude Desktop 配置指南 |
| 第 10 周 | 自己 dogfood：用 Compass 开发 Compass，记录所有摩擦点 |
| 第 11-12 周 | Landing page + 小范围内测（10-20 个独立开发者） |

### 7.1 单人维护的工作时间预估

按全职 40 小时/周计算，约 480 小时总投入。如果是兼职 20 小时/周，约需 6 个月。

### 7.2 最大技术风险

1. **MCP 在不同客户端的实现差异**：Claude Desktop、Cursor、Claude Code 对 stdio 的处理可能有细节差异。MVP 阶段优先支持 Claude Desktop（官方实现最规范），其他作为兼容性测试
2. **AI 客户端会按预期调用吗**：即使工具描述写得好，模型也可能忘记调用。需要在文档里给用户一段"项目初始化 prompt"，让他们粘贴到 AI 客户端的 system prompt 里，强化调用习惯
3. **SQLite 在两个进程并发写入时的性能**：实际上 WAL 模式下足够好，但需要在第 1 周做一次压测验证

---

## 8. 商业模式与成本

### 8.1 定价（暂定）

| 层级 | 价格 | 含 |
|---|---|---|
| Free | $0 | 本地版，1 个项目，所有核心功能 |
| Pro | $9/月 | 云同步、多设备、无限项目、AI 生成测试步骤 |
| Team | 暂不做 | 见 1.1 节，不进入团队市场 |

### 8.2 月度运营成本（前 100 个付费用户阶段）

| 项 | 成本 |
|---|---|
| Vercel（Web Dashboard + landing） | $20 |
| Supabase（云同步，含数据库 + auth） | $25 |
| 域名 + 邮件 | $5 |
| **合计** | **~$50/月** |

100 个 Pro 用户即收支平衡，相对友好的盈亏平衡点。

---

## 9. 未解决的问题（需要进一步决策）

以下问题不在 MVP 范围内解决，但需要提前思考：

1. **AI 会话 ID 在多大程度上能被程序化获取**：Claude Code 有 session 概念但访问受限，Cursor 暂时没有公开 API。可能需要让用户手动粘贴 session 链接
2. **如何处理多个 AI 客户端同时操作同一项目的冲突**：例如用户上午用 Cursor，下午用 Claude Code，两边都在修改同一个 feature。MVP 阶段假设串行使用，post-MVP 需要操作日志
3. **是否开源**：MCP Server 部分倾向于开源（增加信任、便于社区贡献），Dashboard 和云同步保持闭源。需要在第 11 周决定
4. **i18n**：目标用户里有相当比例的中文 vibe coder，但第一版只做英文以保持简单。中文版放到 v0.2

---

## 10. 下一步行动

如果决定推进这个项目，建议的顺序：

1. **本周**：基于这份架构文档，写一个 1 页 landing page，跑一周流量看是否有人留邮箱（验证需求）
2. **如果留邮箱率 >5%**：开始第 1 周的开发任务
3. **如果留邮箱率 <2%**：重新审视定位，或换个切入点（比如做成 CLI 而非完整产品）

不要跳过验证环节直接开发。MVP 的目的是验证假设，而 landing page 的成本比 MVP 低一个数量级。

---

*文档版本：v0.1 · 2026-05-19*
