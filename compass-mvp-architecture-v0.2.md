# MVP 技术架构文档 v0.2

**产品代号**：Compass（暂定）
**一句话定位**：让 vibe coder 随时知道 AI 帮自己做到了哪一步的产品记忆中枢
**目标用户**：独立开发者、用 AI 编程的技术型非工程师
**MVP 目标**：3-4 个月内可上线、单人可维护、能验证核心假设

**v0.2 相对 v0.1 的核心变更**：
- 功能模型从扁平表升级为**自引用树**（FeatureNode），引入 `kind` 与 `depth` 约束
- 拆出 **AIRun** 实体显式管理 AI 的执行状态（替代 v0.1 的 `ai_conversation_links`）
- **CodeTodo** 重新定位为 AIRun 的副产品，必须挂在 FeatureNode 上，附带 `file_path/line_number`
- 新增 MCP 工具：`compass_start_ai_run` / `compass_finish_ai_run` / `compass_add_code_todo` / `compass_list_subtree`
- 明确多 AI 工具并发的冲突处理（`active_ai_run_id` 乐观锁）
- 新增 AI 计划意图（`plan`）与原始 prompt 摘要的留痕字段
- 预留 feature dependencies（依赖关系）模型，MVP 不实现

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

### 1.5 信任边界原则（v0.2 强化）

产品里有一条不可逾越的边界：**AI 永远不能宣布"功能可用"**。这条边界在数据模型、API 表面、UI 上都要显式体现。具体到 v0.2：

- AI 只能把 FeatureNode 推进到 `ai_completed`，不能到 `verified`
- AI 只能创建 `kind=task` 的叶子节点，不能创建 `module / feature` 层级
- AI 报告的"完成"只是一次 AIRun 的结果，不等于功能可用
- 父节点状态不从子节点自动 roll-up，必须人类显式确认

这条原则是整个产品的价值根基，比任何具体功能都重要。

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

技术栈整体延续 v0.1，无变化。

### 2.2 关键选型详解

#### MCP Server：TypeScript

官方 TypeScript SDK 是目前最成熟的实现，2026 年 Q1 已发布 v2 稳定版。Node 生态便于打包成 `npx` 一键运行的命令，Dashboard 用 Next.js 时可以共享类型定义。

传输协议：**stdio 优先，Streamable HTTP 备选**。MVP 阶段只实现 stdio。

#### 本地存储：SQLite

MCP Server 与 Web Dashboard 共享同一份 SQLite 文件。WAL 模式保证并发读写安全。数据库默认放在 `~/.compass/db.sqlite`，可通过环境变量覆盖。

v0.2 因为引入了自引用树，对 SQLite 提出新的索引要求（见 §3.4）。

#### Web Dashboard：Next.js

Next.js 15 的 Server Components 让本地 Dashboard 直接访问 SQLite，不需要 API 层。MVP 阶段 Dashboard 以 `localhost:3737` 形式运行。

#### 不选什么

- 不用 LangChain / AI 编排框架——我们是被调用方
- 不用 GraphQL——单客户端单数据库，REST + tRPC 足够
- 不用 NoSQL——产品状态是结构化关系数据
- 不自建认证——MVP 本地无需认证

---

## 3. 数据模型 v0.2

### 3.1 ER 概念图

```
Project (1) ──< (N) FeatureNode ──┐ (自引用，parent_id)
                     │             │
                     ├──< (N) AIRun ──< (N) CodeTodo
                     ├──< (N) TestRun
                     └── feature_dependencies (post-MVP)
```

核心变化：
- `Feature` → `FeatureNode`，自引用形成树
- `ai_conversation_links` 升级为 `AIRun`（含执行状态、意图、计划）
- `todos` → `code_todos`，强制挂在 FeatureNode 上，关联 AIRun

### 3.2 表结构定义

#### `projects` — 项目

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- ULID
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

不变。`root_path` 仍是匹配项目的关键字段。

#### `feature_nodes` — 功能节点（树）

```sql
CREATE TABLE feature_nodes (
  id TEXT PRIMARY KEY,                       -- ULID
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES feature_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- 'module' | 'feature' | 'task'
  depth INTEGER NOT NULL,                    -- 0=根, 最大 3
  path TEXT NOT NULL,                        -- 物化路径 "id1.id2.id3"
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,                      -- 见下方枚举
  source TEXT NOT NULL,                      -- 'ai' | 'user'
  test_steps TEXT,                           -- AI 生成的手动测试步骤 markdown
  last_tested_at INTEGER,
  active_ai_run_id TEXT,                     -- 当前正在执行的 AIRun，null 表示空闲
  position INTEGER NOT NULL DEFAULT 0,       -- 同级排序
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  CHECK (depth >= 0 AND depth <= 3),
  CHECK (kind IN ('module', 'feature', 'task')),
  CHECK (status IN ('planned', 'in_progress', 'ai_completed',
                    'verified', 'broken', 'archived'))
);

CREATE INDEX idx_nodes_project_status ON feature_nodes(project_id, status);
CREATE INDEX idx_nodes_parent ON feature_nodes(parent_id);
CREATE INDEX idx_nodes_path ON feature_nodes(path);
```

**`kind` 语义约定**（不强制，但 MCP 工具会按此校验 AI 调用权限）：

| kind | 典型用途 | 谁能创建 |
|---|---|---|
| `module` | 顶层产品域，如 "Auth"、"Billing"、"Analytics" | 仅用户 |
| `feature` | 用户可感知的能力，如 "邮箱登录"、"忘记密码" | 仅用户 |
| `task` | AI 实施粒度的工作单元，如 "实现 /auth/login 端点" | AI 或用户 |

**关键设计**：骨架由人定（module / feature），叶子由 AI 填（task）。这是信任边界原则的具体落地——AI 不能擅自重塑产品蓝图。

**`status` 枚举**沿用 v0.1（不变）：

| 状态 | 含义 | 谁能转入 |
|---|---|---|
| `planned` | 已规划但未开始 | 用户 |
| `in_progress` | AI 正在做 | AI |
| `ai_completed` | AI 报完工，待人测 | AI |
| `verified` | 人测过可用 | 仅用户 |
| `broken` | 测试发现坏了 | 用户（或 AI 在 fix 失败时主动标） |
| `archived` | 已废弃 | 用户 |

**关键设计 · 状态不自动 roll-up**：父节点的 status 独立设置，不从子节点机械推导。Dashboard 会显示子节点的 `{verified: 3, ai_completed: 1, broken: 1}` 摘要供用户参考，但最终的"模块可用"判断由人做。理由：自动 roll-up 会把 AI 的"自报完工"幻觉传染给父级，违反 1.5 信任边界。

**`active_ai_run_id`**：用于解决多 AI 客户端并发冲突。MCP 工具调用 `update_feature_status` 或 `start_ai_run` 时会先检查此字段：若已被其他 session 占用，返回冲突信息，让 AI 提示用户确认接手。乐观锁，不真上锁。

#### `ai_runs` — AI 执行记录（替代 v0.1 的 ai_conversation_links）

```sql
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  feature_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL,                 -- 'cursor' | 'claude_code' | 'claude_desktop' | 'other'
  session_id TEXT,                           -- 客户端提供的 session ID
  intent TEXT NOT NULL,                      -- 'implement' | 'fix' | 'refactor' | 'explore'
  run_status TEXT NOT NULL,                  -- 'running' | 'completed' | 'failed' | 'abandoned'
  user_prompt_summary TEXT,                  -- 用户原始指令的摘要（AI 自填）
  plan TEXT,                                 -- AI 开工前的计划（markdown，可选）
  summary TEXT,                              -- AI 完成后的自报总结
  commit_sha TEXT,
  files_touched TEXT,                        -- JSON 数组，AI 自报改了哪些文件
  started_at INTEGER NOT NULL,
  completed_at INTEGER,                      -- run_status=running 时为 null

  CHECK (intent IN ('implement', 'fix', 'refactor', 'explore')),
  CHECK (run_status IN ('running', 'completed', 'failed', 'abandoned'))
);

CREATE INDEX idx_runs_feature_started ON ai_runs(feature_node_id, started_at DESC);
CREATE INDEX idx_runs_session ON ai_runs(session_id) WHERE session_id IS NOT NULL;
```

**为什么不存完整对话**：太重，且大部分客户端不开放对话历史程序化访问。存 `session_id + plan + summary + commit + files_touched` 五元组，让用户能"回到现场"。

**`run_status` vs `feature_node.status`**：两者正交。`run_status` 描述 AI 这次跑的过程状态；`feature_node.status` 描述功能本身的业务状态。例如：

- AI 改 feature 修 bug → `feature.status` 仍是 `broken`，新开一个 `ai_run.run_status='running'`
- AI 改完 → `ai_run.run_status='completed'` + `feature.status='ai_completed'`
- AI 中途异常退出 → `ai_run.run_status='abandoned'`（由下次 start_ai_run 检测旧 running 记录后自动设置）

**`plan` 字段**：AI 在 `compass_start_ai_run` 时填，让用户事后回溯能看到"AI 当时打算怎么做"。这是 v0.1 没有的关键审计能力。

#### `code_todos` — 代码 TODO

```sql
CREATE TABLE code_todos (
  id TEXT PRIMARY KEY,
  feature_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  ai_run_id TEXT REFERENCES ai_runs(id),    -- 哪次 AI 跑出来的，可为 null（用户手动加）
  content TEXT NOT NULL,
  file_path TEXT,                            -- 相对项目 root 的路径
  line_number INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,                  -- 'ai' | 'user'
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_todos_feature_done ON code_todos(feature_node_id, done);
```

**v0.2 的关键定位变化**：todo 不再是松散的项目笔记，而是 AI 写代码时遇到"这里有个 TODO 没做"的留痕。`file_path + line_number` 让 Dashboard 能直接给出"回到代码位置"的入口。

#### `test_runs` — 测试记录

```sql
CREATE TABLE test_runs (
  id TEXT PRIMARY KEY,
  feature_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  ai_run_id TEXT REFERENCES ai_runs(id),    -- 测的是哪次 AI 改动的成果，可为 null
  result TEXT NOT NULL,                      -- 'passed' | 'failed'
  notes TEXT,
  tested_at INTEGER NOT NULL,

  CHECK (result IN ('passed', 'failed'))
);
```

新增 `ai_run_id` 关联——明确这次测试在测哪次 AI 改动的成果。失败的 test_run 把 feature 推到 `broken`。

#### `feature_dependencies` — 依赖关系（预留，MVP 不实现）

```sql
-- Post-MVP，仅在此声明形状，避免未来加字段时大改
CREATE TABLE feature_dependencies (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- 'blocks' | 'related'
  created_at INTEGER NOT NULL,
  UNIQUE(from_node_id, to_node_id, kind)
);
```

MVP 不暴露给 AI 调用，也不在 Dashboard 显示。仅在 schema 中保留位置。

### 3.3 数据流示例

一次典型的功能生命周期（v0.2）：

```
1. 用户在 Dashboard 手动建模块树：
   Auth (module) ─┬─ Email login (feature, planned)
                  └─ Password reset (feature, planned)

2. 用户在 Cursor 说："帮我做邮箱登录"
   Cursor 通过 MCP 调用 compass_start_ai_run({
     feature_node_id: <Email login>,
     intent: 'implement',
     user_prompt_summary: '实现邮箱注册和登录',
     plan: '1. 建 users 表  2. POST /auth/register  3. POST /auth/login  4. JWT 中间件'
   })
   → ai_runs 新增一行，run_status='running'
   → feature_nodes.status='in_progress', active_ai_run_id 设置

3. AI 开发过程中遇到"这里 password hash 用了占位符":
   compass_add_code_todo({
     feature_node_id: <Email login>,
     content: '把 hash 占位符换成真实 bcrypt',
     file_path: 'src/auth/register.ts',
     line_number: 42
   })

4. AI 在树下创建 task 节点细化:
   compass_create_feature_node({
     parent_id: <Email login>,
     kind: 'task',
     title: 'JWT 中间件',
     ...
   })

5. AI 完工调 compass_finish_ai_run({
     ai_run_id, run_status: 'completed',
     summary: '完成邮箱注册/登录 + JWT 中间件',
     commit_sha: 'abc123',
     files_touched: ['src/auth/*.ts', 'migrations/001_users.sql']
   })
   → ai_run.run_status='completed'
   → feature_node.status='ai_completed'
   → active_ai_run_id 清空

6. 用户打开 Dashboard，看到"Email login 待测试"
   按 test_steps 测试，点"通过"
   → test_runs 新增一行，关联到 ai_run_id
   → feature_node.status='verified', last_tested_at 更新

7. 一周后用户发现登录在 Safari 上挂了，Dashboard 点"标记为 broken"
   → feature_node.status='broken'
   → 在 Cursor 说"修一下登录"，AI 又开一个新 ai_run，intent='fix'
```

### 3.4 索引与查询模式

主要查询：
1. **列出当前项目的功能树**：按 `path` 升序排，`O(N)` 一次扫描即可重建树
2. **某模块下所有待测试的功能**：用 `path LIKE 'moduleid.%' AND status='ai_completed'`
3. **某 feature 的所有 AIRun 历史**：用 `idx_runs_feature_started`
4. **某 session 干了什么**：用 `idx_runs_session`

物化路径方案选择理由：树深度硬限 4，路径字符串最长 4×26+3=107 字节，索引开销可控；查子树用 LIKE 前缀匹配，SQLite 能用上索引。比 nested set 简单，比纯 parent_id 递归查询快。

---

## 4. MCP 接口设计 v0.2

设计原则不变：**让 AI 模型能直觉地知道何时调用**。每个工具的 description 比签名本身更重要。

### 4.1 工具列表（MVP）

| 工具名 | 用途 | v0.2 新增 |
|---|---|---|
| `compass_list_features` | 列出当前项目功能（含树形结构摘要） | 改 |
| `compass_list_subtree` | 列出某节点下的子树 | **新** |
| `compass_get_feature` | 获取节点详情 + 最近 AIRun | 改 |
| `compass_create_feature_node` | 创建新节点（AI 仅限 task） | 改名 |
| `compass_update_feature_status` | 改业务状态（限 in_progress/ai_completed/broken） | 改 |
| `compass_start_ai_run` | 开始一次 AI 执行 | **新** |
| `compass_finish_ai_run` | 结束 AI 执行 | **新** |
| `compass_log_test_steps` | 写测试步骤 | 不变 |
| `compass_add_code_todo` | 添加代码 TODO | **新** |
| `compass_list_todos` | 列出未完成 TODO | 改 |

MVP 共 10 个工具（v0.1 是 7 个）。

### 4.2 关键工具签名

#### `compass_list_features`（改）

```typescript
{
  name: "compass_list_features",
  description: `List features in the current project as a hierarchical tree summary.

  USE THIS WHEN:
  - The user asks "what have we built" / "what's done" / "where are we"
  - You're about to start a new feature and need to check what already exists
  - You need to find the right place to add a new task

  Returns a flat list with depth/path info so you can reconstruct the tree.
  For deep dives into one module, use compass_list_subtree instead.`,

  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["planned", "in_progress", "ai_completed", "verified", "broken", "all"],
        default: "all"
      },
      kind: {
        type: "string",
        enum: ["module", "feature", "task", "all"],
        default: "all"
      },
      max_depth: { type: "integer", minimum: 0, maximum: 3, default: 2 }
    },
    additionalProperties: false
  }
}
```

返回示例：

```json
{
  "project": "my-saas",
  "summary": { "total": 12, "verified": 5, "ai_completed": 4, "in_progress": 2, "planned": 1 },
  "nodes": [
    { "id": "01HXY...", "kind": "module", "depth": 0, "path": "01HXY",
      "title": "Auth", "status": "in_progress",
      "children_status_count": { "verified": 1, "ai_completed": 1, "planned": 1 } },
    { "id": "01HZA...", "kind": "feature", "depth": 1, "path": "01HXY.01HZA",
      "title": "Email login", "status": "verified", "last_tested_at": "..." }
  ]
}
```

注意每个父节点带 `children_status_count`，让 AI 不用展开就能判断"这个模块大概什么状态"。

#### `compass_list_subtree`（新）

```typescript
{
  name: "compass_list_subtree",
  description: `Fetch all nodes under a specific feature or module, useful when zooming into one area.

  USE THIS WHEN:
  - You're working inside a known module and need full detail of its sub-features/tasks
  - User asks "show me everything under <module>"
  - You're about to add multiple tasks to an existing feature and need to see what's there`,

  inputSchema: {
    type: "object",
    properties: {
      node_id: { type: "string" },
      include_completed: { type: "boolean", default: true }
    },
    required: ["node_id"],
    additionalProperties: false
  }
}
```

#### `compass_create_feature_node`（改名 + 加约束）

```typescript
{
  name: "compass_create_feature_node",
  description: `Create a new node in the feature tree.

  IMPORTANT RULES:
  - As an AI, you can ONLY create nodes with kind='task'. Modules and features must be created by the user through the dashboard — they represent the human's product blueprint.
  - If you think a new module or feature is needed, ask the user first.
  - Always attach tasks under an existing feature node, not directly under a project or module.

  Call this when you're about to implement a concrete sub-step that's worth tracking separately.`,

  inputSchema: {
    type: "object",
    properties: {
      parent_id: { type: "string", description: "Required. Must be a feature-level node." },
      title: { type: "string" },
      description: { type: "string" }
    },
    required: ["parent_id", "title"],
    additionalProperties: false
  }
}
```

服务端强制：
- `kind` 永远是 `task`（参数不暴露给 AI）
- 拒绝 `parent.kind === 'task'`（task 下不能再嵌 task，深度上限 = 3）
- 拒绝 `parent.kind === 'module'`（task 必须挂在 feature 下，不能直接挂模块）

#### `compass_start_ai_run`（新）

```typescript
{
  name: "compass_start_ai_run",
  description: `Mark the beginning of an AI work session on a feature. Call this BEFORE you start implementing, fixing, or refactoring.

  USE THIS WHEN:
  - User asks you to build/fix/refactor a specific feature
  - You're about to make non-trivial code changes

  This creates an audit trail so the user can later see what you were trying to do and when.

  If another AI session is already active on the same feature, this returns a conflict — surface it to the user and ask before proceeding.`,

  inputSchema: {
    type: "object",
    properties: {
      feature_node_id: { type: "string" },
      intent: { type: "string", enum: ["implement", "fix", "refactor", "explore"] },
      user_prompt_summary: { type: "string", description: "1-2 sentences summarizing what the user asked you to do" },
      plan: { type: "string", description: "Markdown bullets of how you intend to approach this (optional but recommended)" },
      session_id: { type: "string" }
    },
    required: ["feature_node_id", "intent", "user_prompt_summary"],
    additionalProperties: false
  }
}
```

服务端逻辑：
- 检查 `feature_node.active_ai_run_id`，若非空且对应 run 还在 `running`，返回 `{ conflict: true, active_run: {...} }`，由 AI 决定是否提示用户
- 若旧 run 已超过 6 小时未 finish，自动将其标为 `abandoned`，本次允许新建
- 创建新 `ai_run`，设置 `feature_node.status='in_progress'`、`active_ai_run_id`

#### `compass_finish_ai_run`（新）

```typescript
{
  name: "compass_finish_ai_run",
  description: `Mark an AI work session as complete (or failed). Call this when you've finished the code changes and saved/committed them, OR when you've given up because of repeated errors.

  After calling this with run_status='completed', the feature moves to 'ai_completed' status, queued for user testing. The user — not you — decides whether it's truly verified.`,

  inputSchema: {
    type: "object",
    properties: {
      ai_run_id: { type: "string" },
      run_status: { type: "string", enum: ["completed", "failed", "abandoned"] },
      summary: { type: "string" },
      commit_sha: { type: "string" },
      files_touched: { type: "array", items: { type: "string" } }
    },
    required: ["ai_run_id", "run_status", "summary"],
    additionalProperties: false
  }
}
```

服务端：
- `completed` → feature.status = `ai_completed`
- `failed` → feature.status = `broken`
- `abandoned` → feature.status 回退到 run 开始前的状态
- 清空 `active_ai_run_id`

#### `compass_update_feature_status`（改）

仍然限制 AI 只能设 `in_progress` / `ai_completed` / `broken`。`verified` / `archived` 只能人改。

大多数场景下 AI 不应该直接调这个，而是通过 `start_ai_run` / `finish_ai_run` 间接驱动状态。保留这个工具用于例外情况（比如 AI 在测试别的功能时发现某个 verified 功能其实坏了）。

#### `compass_add_code_todo`（新）

```typescript
{
  name: "compass_add_code_todo",
  description: `Record a code-level TODO that you noticed but didn't complete in this session.

  USE THIS WHEN:
  - You wrote a placeholder/stub that needs real implementation later
  - You spotted an obvious follow-up while doing the main task
  - User said "we'll do X later" — capture it so it's not forgotten

  Always attach to the feature node you're currently working on. Include file_path and line_number so the user can jump back to the spot.`,

  inputSchema: {
    type: "object",
    properties: {
      feature_node_id: { type: "string" },
      ai_run_id: { type: "string", description: "The current AI run, if you started one" },
      content: { type: "string" },
      file_path: { type: "string", description: "Relative to project root" },
      line_number: { type: "integer" }
    },
    required: ["feature_node_id", "content"],
    additionalProperties: false
  }
}
```

### 4.3 MCP Resources（post-MVP）

仍然 post-MVP，但 v0.2 时机会更明确：

- `compass://project/current/tree` — 当前项目功能树 markdown
- `compass://project/current/active-runs` — 正在跑的 AIRun 列表
- `compass://project/current/pending-tests` — 待测试队列

### 4.4 安全考虑

延续 v0.1，新增：

- **kind 与 status 的服务端强约束**：AI 调 `create_feature_node` 时服务端硬编码 `kind='task'`；AI 调 `update_feature_status` 时拒绝 `verified` / `archived`
- **active_ai_run_id 的并发处理**：用 SQLite 事务包裹"检查 + 设置"，避免两个 AI 同时拿到同一个节点
- **路径注入防御**：`file_path` 必须是相对路径，禁止 `..` 和绝对路径，服务端 normalize 后校验仍在 root 内
- **审计日志**：每次 `start_ai_run / finish_ai_run` 写入独立的 audit log 文件，方便用户事后调查 AI 行为

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
         │  audit.log       │  ← v0.2 新增
         └──────────────────┘
```

两个独立进程通过 SQLite 文件（WAL 模式）交换数据。v0.2 额外引入 audit.log 记录所有 AI 写操作。

### 5.2 启动流程

`npx compass start`：

1. 检查 `~/.compass/db.sqlite`，不存在则初始化 schema（含 v0.2 全部表）
2. 启动 compass-web 监听 :3737
3. 输出 MCP Server 配置 JSON 供用户复制
4. **v0.2 新增**：检查是否有 `run_status='running'` 但超过 6 小时未更新的 AIRun，自动标 abandoned 并清理 `active_ai_run_id`

### 5.3 云同步层（post-MVP）

不变，仍用 Supabase Postgres + last-write-wins + 操作日志。

v0.2 的树形结构增加了一点同步复杂度——删除一个 module 会级联删除所有子节点，需要在操作日志里展开成多条删除事件，避免另一端漏同步。

---

## 6. MVP 范围严格定义

### 6.1 第一版必须有

- MCP Server 提供 §4.1 的 10 个工具
- 本地 SQLite 存储，含 v0.2 全部表
- Web Dashboard 显示：
  - **树形功能视图**（按 module/feature/task 分层，可折叠）
  - 待测试队列（跨树扁平列表）
  - 节点详情页：当前状态 + 历史 AIRun 时间线 + 关联 TODO + 测试历史
  - 用户能在 Dashboard 里建 module / feature 节点、把任何节点标 `verified` / `broken` / `archived`
- `npx compass start` 一键启动
- 文档：怎么在 Cursor、Claude Code、Claude Desktop 中配置
- **v0.2 新增**：随安装文档提供一段"项目初始化 prompt"，告诉用户粘到 AI 客户端 system prompt 里以提高调用率

### 6.2 第一版坚决不做

- 用户认证 / 多用户
- 云同步
- 团队协作 / 分享
- feature_dependencies（schema 保留，UI 和 MCP 不暴露）
- 自动化测试运行
- 集成 GitHub Issues / Jira / Linear
- 移动端
- AI 模型直连
- 分析报表 / 看板视图
- **状态自动 roll-up**（永远不做，违反 1.5 信任边界）
- **AI 创建 module/feature 层**（永远不做，违反 1.5）
- 任何形式的"AI 自动判断功能是否实现"

### 6.3 验证假设

MVP 验证的假设（v0.2 微调）：

1. AI 客户端真的会按预期调用 MCP 工具吗？（技术可行性）
2. **AI 能正确区分 module/feature/task 三层吗？**（v0.2 新增——树形结构对 AI 是否友好）
3. 用户愿意配置一个 MCP Server 来用吗？（接受成本）
4. **用户愿意手动维护 module/feature 骨架吗？**（v0.2 新增——人机分工是否被接受）
5. 看到功能树 + 待测试队列能减轻"产品状态焦虑"吗？（核心价值）
6. 多少用户 1 周后还在用？（粘性）

如果假设 5 失败，方向需要重新考虑。假设 2、4 失败的话需要调整模型——可能要简化回扁平结构。

---

## 7. 开发路线图（v0.2 重估）

引入树 + AIRun 后开发量增加约 25%，路线图相应调整：

| 周次 | 里程碑 |
|---|---|
| 第 1-2 周 | SQLite schema（含 v0.2 全部表）+ 基础 CRUD + 树查询工具函数 |
| 第 3-4 周 | MCP Server 骨架 + 4 个核心工具（list_features / list_subtree / start_ai_run / finish_ai_run），含 active_ai_run_id 并发处理 |
| 第 5 周 | 补全剩余 6 个工具，单元测试覆盖状态机和并发冲突 |
| 第 6 周 | Claude Desktop 端到端跑通完整流程（create → start_ai_run → add_code_todo → finish → verify） |
| 第 7-8 周 | Web Dashboard 树形视图 + 节点详情页（AIRun 时间线） |
| 第 9-10 周 | Dashboard：待测试队列 + 测试操作 + TODO 列表 + 状态变更 UI |
| 第 11 周 | npm 打包 + 安装文档 + 三个客户端的配置指南 + "项目初始化 prompt" |
| 第 12 周 | 自己 dogfood：用 Compass 开发 Compass，记录摩擦 |
| 第 13-14 周 | 小范围内测 |
| 第 15-16 周 | 缓冲 + 上线 |

全职 40h/week 约 640 小时；兼职 20h/week 约 8 个月。

### 7.1 最大技术风险

1. **AI 是否能正确区分 module/feature/task**：模型可能把所有东西都创建成 task，或者过度调 create。需要在工具 description 里反复强化，并在 dogfood 阶段重点观察
2. **AI 是否记得调 start_ai_run / finish_ai_run**：忘记 finish 会让节点卡在 in_progress。6 小时自动 abandon 是兜底，但用户体验差。需要"项目初始化 prompt"强化习惯
3. **不同客户端的 session_id 可获得性**：仍是 v0.1 的老问题
4. **active_ai_run_id 的乐观锁体验**：两个 AI 同时改同一节点的提示要不打扰主流程

---

## 8. 商业模式与成本

不变（沿用 v0.1）。

| 层级 | 价格 | 含 |
|---|---|---|
| Free | $0 | 本地版，1 个项目，所有核心功能 |
| Pro | $9/月 | 云同步、多设备、无限项目、AI 生成测试步骤 |

月度运营成本前 100 付费用户阶段约 $50。

---

## 9. 未解决的问题

v0.1 中部分问题已在 v0.2 解决，剩余：

1. **AI 会话 ID 在多大程度上能被程序化获取**：仍未解，可能需要让用户手动粘贴 session 链接到 Dashboard
2. **是否开源**：MCP Server 倾向开源，Dashboard 和云同步闭源。第 11 周决定
3. **i18n**：v1 仅英文，中文 v0.2 版本（不是这里的文档 v0.2，是产品 v0.2）再加
4. **AIRun 的 plan 字段格式是否要结构化**：目前是自由 markdown，未来如果要做"AI 计划 vs 实际差异分析"可能需要结构化。MVP 先自由文本
5. **超长树的性能**：物化路径在节点数 >10000 时 LIKE 查询会变慢。MVP 单项目规模不会到，但云同步阶段需要考虑

新增（v0.2 引出）：

6. **跨节点 TODO 是否需要**：目前 TODO 强制挂在节点上，但有些用户级别的备忘（"下周记得改定价页文案"）无处可放。MVP 先不解决，观察用户是否抱怨
7. **abandoned AIRun 的清理策略**：6 小时自动判定是否合理？需要 dogfood 验证

---

## 10. 下一步行动

跳过 landing page 验证，直接进入开发。

具体顺序：

1. **第 0 周（本周）**：基于本文档，先用一天搭出最小骨架——只有 SQLite schema 初始化脚本 + `compass_list_features` 一个工具 + Dashboard 一个树形展示页。目的是把"AI 能调通 + 数据能看见"这条最关键的回路打通
2. **第 1 周开始**：按 §7 路线图正式启动
3. **第 6 周末是第一个 checkpoint**：能在 Claude Desktop 跑完整流程时，对自己做一次诚实评估——AI 的调用率有没有低于 70%？如果低于，停下来调工具 description 而不是继续往前

不要在第 6 周之前花时间做 Dashboard 美化或 landing page。先让核心回路跑起来。

---

*文档版本：v0.2 · 2026-05-27*
*相对 v0.1 主要变更：自引用功能树 / AIRun 显式化 / CodeTodo 重定位 / 并发冲突处理 / AI 计划留痕 / kind 信任边界*
