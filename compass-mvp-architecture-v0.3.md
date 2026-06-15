# MVP 技术架构文档 v0.3

**产品代号**：Compass（暂定）
**一句话定位**：让 vibe coder 随时知道 AI 帮自己做到了哪一步的产品记忆中枢
**目标用户**：独立开发者、用 AI 编程的技术型非工程师
**MVP 目标**：4-5 个月内可上线、单人可维护、能验证核心假设

**v0.3 相对 v0.2 的核心变更**：
- 新增 §1.6 **项目模式声明**：indie tool，先自用 + 服务个人开发者，商业回报是可选项
- **数据捕获改为三路并行**：git post-commit hook + 文件系统 watcher + MCP 工具调用，三路汇入 `activity_events` 表
- **MCP 调用从必要条件降级为增强信号**：AI 忘记调用也不会让数据闭环瘫痪
- 新增 `activity_events` 表 + 后台 `reconciler` 归并逻辑
- 新增**产品版本（phase）**概念：feature_nodes 加 `phase` 字段，projects 加 `active_phase` 设置；AI 可推迟到下一版，不可拉到当前版
- 新增状态 **`needs_user_action`**：AI 完成开发但需要用户做配置/外部操作/手动迁移等才能测试，新增 `user_action_required` 字段描述操作内容
- 新增 MCP 工具 `compass_defer_feature`，更新 `list_features` 加 phase 过滤、`finish_ai_run` 支持 needs_user_action
- §6 MVP 范围加入 hook 安装器 + fs watcher 为 P0
- §7 路线图从 16 周扩到 18 周
- §9 风险表更新：调用率风险降级，归并准确率成为新核心风险

---

## 1. 设计原则

### 1.1 摩擦最小原则

用户已经在用 AI 写代码了，他们不会愿意为了维护"产品记忆"再切换到另一个工具。所有数据写入应该尽可能由 AI 自动完成或后台自动捕获，用户只在"确认测试通过"这一步做最少的手动操作。

### 1.2 工具中立原则

不绑定任何单一 AI 工具。今天用户用 Cursor，明天可能换 Claude Code，后天可能用 ChatGPT Desktop。产品的价值在于跨工具持久化产品状态。MCP 协议天然解决这个问题。

### 1.3 本地优先原则

数据默认存在用户本地，云同步是可选项。本地优先也降低了运营成本，让免费层有可能持续。

### 1.4 渐进复杂度原则

第一次打开应用，用户看到的应该是空的功能清单加一个"安装 MCP Server"按钮。所有高级功能藏在后面。

### 1.5 信任边界原则

产品里有一条不可逾越的边界：**AI 永远不能宣布"功能可用"**，更宽泛的原则是**AI 可以收缩范围，不可以扩张范围**。具体到 v0.3：

- AI 只能把 FeatureNode 推进到 `ai_completed` 或 `needs_user_action`，不能到 `verified`
- AI 只能创建 `kind=task` 的叶子节点，不能创建 `module / feature` 层级
- AI 只能把 feature 推迟到非当前 phase（如 v1 → v2），不能把 deferred feature 拉到当前 phase
- AI 不能创建新的 phase（如发明一个 `v3`），phase 命名属于产品规划，仅人能建
- 三路捕获的原始事件可以由 AI 间接触发，但归并到 AIRun 后业务状态的变更仍受边界保护
- 父节点状态不从子节点自动 roll-up，必须人类显式确认

### 1.6 项目模式声明（v0.3 新增）

Compass 的项目模式定位于"业余开源工具"与"创业产品"之间：

- 主要目标是做一个好用的工具，先自用 + 服务个人开发者群体
- 商业回报是可选项而非首要目标，保留付费层（云同步）的可能性
- 不追求规模化增长，也不进入团队市场（不违背 1.1）
- 取舍优先级：**可靠性 > 易用性 > 美观度 > 商业化设计**

这条原则约束的具体决策：

- 不投入精力做用户分析、营销页 A/B 测试、增长 hack
- 不预先做多语言、多平台适配（i18n 拖到 v1.0 后）
- 数据模型可以做"对个人开发者最优"的取舍（牺牲多人协作能力）
- 工具的"好用"优先于"看起来高级"，能用 CLI 解决的不强求 UI
- 不为护城河焦虑——免费 + 本地 + 工具中立的位置，模型厂商和 IDE 厂商缺乏下场动机

---

## 2. 技术栈选型

### 2.1 选型总览

| 层 | 选型 | 理由 |
|---|---|---|
| MCP Server | TypeScript + 官方 SDK | 生态最成熟 |
| 本地数据存储 | SQLite（better-sqlite3） | 零配置、单文件、跨平台 |
| 文件系统监听 | chokidar | Node 生态事实标准 |
| Web Dashboard | Next.js 15 + React 19 | Server Components 适合本地架构 |
| Dashboard UI | Tailwind + shadcn/ui | 单人维护 |
| 云同步（付费层） | Supabase（Postgres + Auth） | 减少自建后端 |
| 桌面打包（可选） | Tauri 2 | 比 Electron 轻量 |
| 部署 | Vercel（Web）+ npm（MCP/CLI） | 零运维 |

v0.3 新增 chokidar 依赖（fs watcher）。其他不变。

### 2.2 关键选型详解

#### MCP Server：TypeScript

延续 v0.2，stdio 优先。v0.3 中 MCP Server 进程额外承担：

- fs watcher 的宿主（用 chokidar 监听项目目录）
- 后台 reconciler 任务（每分钟扫描未归并事件）
- HTTP endpoint `:3738`（仅 localhost）接收 git hook 的 capture 请求

注意：MCP stdio 子进程本身生命周期由 AI 客户端控制（按需 spawn），无法承载常驻 watcher/reconciler。所以**实际运行时有两个 Node 进程**：

- `compass-mcp`：被 AI 客户端 spawn 的短生命周期进程，只处理 MCP 协议
- `compass-daemon`：`compass start` 启动的常驻进程，承载 watcher、reconciler、HTTP endpoint

#### 本地存储：SQLite

WAL 模式保证多进程并发安全。v0.3 新增 `activity_events` 表，append-only 写入模式对 WAL 友好。

#### fs watcher：chokidar

跨平台稳定性最好。默认忽略：`node_modules/**`、`.git/**`、`dist/**`、`build/**`、`.next/**`、`*.log`、`.DS_Store`，并尊重项目根目录的 `.gitignore`。

性能预算：单项目 10000 文件以内 CPU 占用 <1%。超过时降级为只监听 git tracked 文件（用 `git ls-files` 列表）。

#### 不选什么

延续 v0.2，不再赘述。

---

## 3. 数据模型 v0.3

### 3.1 ER 概念图

```
Project (1) ──< (N) FeatureNode ──┐ (自引用，parent_id)
                     │             │
                     ├──< (N) AIRun ──< (N) CodeTodo
                     └──< (N) TestRun

Project (1) ──< (N) ActivityEvent ──┐ (归并后)
                                     └──> AIRun + FeatureNode
```

核心新增：`ActivityEvent` 是原始事件流，归并后写入 AIRun 与 FeatureNode 的关联字段。

### 3.2 表结构定义

#### `projects` — 项目

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  description TEXT,
  active_phase TEXT NOT NULL DEFAULT 'v1',   -- v0.3 新增
  known_phases TEXT NOT NULL DEFAULT '["v1"]', -- v0.3 新增，JSON 数组
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**v0.3 新增字段**：

- `active_phase`：当前正在开发的版本号，自由文本。Dashboard 默认只显示该 phase 的功能，AI 调 `list_features` 不传 phase 参数时也按此过滤
- `known_phases`：用户已创建过的 phase 列表（JSON 数组）。AI 调 `compass_defer_feature` 时 target_phase 必须在此列表中，防止 AI 凭空发明 phase

#### `feature_nodes` — 功能节点（树）

```sql
CREATE TABLE feature_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES feature_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- 'module' | 'feature' | 'task'
  depth INTEGER NOT NULL,                    -- 0..3
  path TEXT NOT NULL,                        -- 物化路径
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,                      -- 'ai' | 'user'
  phase TEXT NOT NULL DEFAULT 'v1',          -- v0.3 新增
  test_steps TEXT,
  user_action_required TEXT,                 -- v0.3 新增，当 status='needs_user_action' 时填
  last_tested_at INTEGER,
  active_ai_run_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  CHECK (depth >= 0 AND depth <= 3),
  CHECK (kind IN ('module', 'feature', 'task')),
  CHECK (status IN ('planned', 'in_progress', 'ai_completed',
                    'needs_user_action', 'verified', 'broken', 'archived'))
);

CREATE INDEX idx_nodes_project_status ON feature_nodes(project_id, status);
CREATE INDEX idx_nodes_parent ON feature_nodes(parent_id);
CREATE INDEX idx_nodes_path ON feature_nodes(path);
CREATE INDEX idx_nodes_phase ON feature_nodes(project_id, phase, status);  -- v0.3 新增
```

**kind 语义约定**与 v0.2 相同：module/feature 由人建，task 可由 AI 建。

**v0.3 新增 `phase` 字段**：

- 自由文本，默认 `v1`，常见值 `v1` / `v2` / `someday` / `experimental`
- 创建节点时若不指定，继承父节点的 phase（顶层节点继承 `project.active_phase`）
- 同一棵树的不同节点可以处于不同 phase（例如 Auth 模块的"邮箱登录"在 v1，"OAuth"在 v2）
- 不做自动同步：移动父节点的 phase 不级联改子节点（避免误伤）

**status 状态机**与 v0.2 相同结构但 v0.3 新增一个状态，不自动 roll-up。完整状态表：

| 状态 | 含义 | 谁能转入 |
|---|---|---|
| `planned` | 用户规划但未开始 | 用户 |
| `in_progress` | AI 正在做 | AI |
| `ai_completed` | AI 报完工，待人测 | AI |
| `needs_user_action` | **AI 已完成代码，但用户需先做配置/外部操作才能测**（v0.3 新增） | AI |
| `verified` | 人测过可用 | 仅用户 |
| `broken` | 测试发现坏了 | 用户或 AI（fix 失败时主动标） |
| `archived` | 已废弃 | 用户 |

**`needs_user_action` 状态说明**（v0.3 新增）：

这是 AI 完成代码工作但用户测试前必须做某些事的中间态。典型场景：

- 邮箱发送功能完成，但需要用户在 SendGrid 注册账号并填入 API key
- 数据库迁移脚本写好，但需要用户在生产环境手动执行
- OAuth 集成完成，但需要用户在 Google Cloud Console 创建应用并配置回调 URL
- 支付集成完成，但需要用户在 Stripe 后台创建 webhook endpoint

AI 通过 `compass_finish_ai_run` 把 `run_status='completed'` 同时指定 `next_status='needs_user_action'` 进入此状态，必须填 `user_action_required` 字段（markdown，描述用户要做什么）。

用户完成操作后在 Dashboard 点"已完成操作"，状态推到 `ai_completed`，进入正常测试队列。或者用户测试同时完成（操作 + 验证），直接推到 `verified`。

**Dashboard 展示**：`needs_user_action` 的功能在主视图用醒目标记（比如黄色警告条），与 `ai_completed` 的"待测试"分开列，避免用户以为可以直接测试。

#### `ai_runs` — AI 执行记录

```sql
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  feature_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL,
  session_id TEXT,
  intent TEXT NOT NULL,                      -- 'implement' | 'fix' | 'refactor' | 'explore'
  run_status TEXT NOT NULL,                  -- 'running' | 'completed' | 'failed' | 'abandoned'
  origin TEXT NOT NULL,                      -- 'mcp' | 'reconciled' (v0.3 新增)
  user_prompt_summary TEXT,
  plan TEXT,
  summary TEXT,
  commit_sha TEXT,
  files_touched TEXT,                        -- JSON array
  started_at INTEGER NOT NULL,
  completed_at INTEGER,

  CHECK (intent IN ('implement', 'fix', 'refactor', 'explore')),
  CHECK (run_status IN ('running', 'completed', 'failed', 'abandoned')),
  CHECK (origin IN ('mcp', 'reconciled'))
);

CREATE INDEX idx_runs_feature_started ON ai_runs(feature_node_id, started_at DESC);
CREATE INDEX idx_runs_session ON ai_runs(session_id) WHERE session_id IS NOT NULL;
```

**v0.3 新增字段 `origin`**：

- `mcp`：AI 主动通过 MCP 工具创建的 run，含完整 intent/plan/summary
- `reconciled`：reconciler 从 activity_events 推导出的 run，可能字段较稀疏

Dashboard 显示时区分图标，让用户知道这条记录的来源可信度。

#### `code_todos` — 代码 TODO

```sql
CREATE TABLE code_todos (
  id TEXT PRIMARY KEY,
  feature_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  ai_run_id TEXT REFERENCES ai_runs(id),
  content TEXT NOT NULL,
  file_path TEXT,
  line_number INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_todos_feature_done ON code_todos(feature_node_id, done);
```

延续 v0.2，无变化。

#### `test_runs` — 测试记录

```sql
CREATE TABLE test_runs (
  id TEXT PRIMARY KEY,
  feature_node_id TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  ai_run_id TEXT REFERENCES ai_runs(id),
  result TEXT NOT NULL,
  notes TEXT,
  tested_at INTEGER NOT NULL,

  CHECK (result IN ('passed', 'failed'))
);
```

延续 v0.2，无变化。

#### `activity_events` — 原始事件流（v0.3 新增）

```sql
CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source TEXT NOT NULL,                      -- 'commit' | 'fs_watch' | 'mcp_call'
  event_type TEXT NOT NULL,                  -- 'commit' | 'file_changed' | 'tool_call'
  payload TEXT NOT NULL,                     -- JSON
  ai_run_id TEXT REFERENCES ai_runs(id),     -- 归并后填入
  feature_node_id TEXT REFERENCES feature_nodes(id),
  reconciled INTEGER NOT NULL DEFAULT 0,     -- 0=未归并 1=已归并 2=放弃归并
  reconciliation_note TEXT,                  -- 归并失败时记录原因
  occurred_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,

  CHECK (source IN ('commit', 'fs_watch', 'mcp_call')),
  CHECK (reconciled IN (0, 1, 2))
);

CREATE INDEX idx_events_project_time ON activity_events(project_id, occurred_at DESC);
CREATE INDEX idx_events_unreconciled ON activity_events(project_id, reconciled, occurred_at)
  WHERE reconciled = 0;
```

**payload 结构示例**：

```json
// source='commit'
{
  "sha": "abc123",
  "message": "feat: add email login",
  "files_changed": ["src/auth/login.ts", "src/auth/register.ts"],
  "lines_added": 142,
  "lines_deleted": 8,
  "author": "user@example.com",
  "branch": "main"
}

// source='fs_watch'
{
  "files": ["src/auth/login.ts", "src/auth/register.ts"],
  "change_types": ["modified", "added"],
  "window_start": 1716800000000,
  "window_end": 1716800030000
}

// source='mcp_call'
{
  "tool_name": "compass_start_ai_run",
  "args": { "feature_node_id": "01HXY...", "intent": "implement", ... },
  "session_id": "sess_abc",
  "client_type": "cursor"
}
```

**Append-only**：activity_events 永不更新（除了 `reconciled` 和 `reconciliation_note` 两个字段）。这保证原始数据的不可变性，便于调试和审计。

### 3.3 三路捕获架构

```
┌─────────────────────────┐
│  git post-commit hook   │──┐
│  → compass-cli capture  │  │
└─────────────────────────┘  │
                              │
┌─────────────────────────┐  │   ┌──────────────────┐
│  chokidar fs watcher    │──┼──>│ activity_events  │
│  (compass-daemon 内)    │  │   │ (append-only)    │
└─────────────────────────┘  │   └────────┬─────────┘
                              │            │
┌─────────────────────────┐  │            ▼
│  MCP tool calls         │──┘   ┌──────────────────┐
│  (AI 主动)              │      │   reconciler     │
└─────────────────────────┘      │   (60s 间隔)     │
                                  └────────┬─────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │  ai_runs +       │
                                  │  feature_nodes   │
                                  │  (业务状态)      │
                                  └──────────────────┘
```

设计要点：

1. **三路完全独立**，任意一路失败不影响其他两路
2. **MCP 调用从必要降级为增强**：即使 AI 一次都不调 MCP，commit + fs_watch 也能拼出大致活动地图
3. **activity_events 是真相源头**，ai_runs 是衍生视图
4. **reconciler 异步运行**，不阻塞 MCP 工具响应

### 3.4 归并算法（reconciler）

每 60 秒扫描一次 `reconciled=0` 的事件，按 30 分钟时间窗口分组，逐组归并。

**归并优先级**（从强到弱）：

| 信号强度 | 条件 | 动作 |
|---|---|---|
| 强 | 窗口内有 MCP `start_ai_run` 调用 | 该窗口所有事件 → 该 ai_run |
| 中 | 窗口起点时有节点 `active_ai_run_id` 非空 | 事件 → 该 active run |
| 中 | commit message 含 `#<node_id>` 或节点 title 关键词 | 事件 → 匹配节点 → 新建 reconciled ai_run |
| 弱 | 窗口内文件变更集与某节点近期 ai_run 的 `files_touched` 重合度 >70% | 事件 → 该节点 → 新建 reconciled ai_run |
| 失败 | 以上都不匹配 | `reconciled=2`，记录到 `reconciliation_note`，等待用户在 Dashboard 手动指派 |

**reconciled ai_run 的填充策略**：

- `origin='reconciled'`
- `intent`：根据 commit message 启发式判断（含 "fix"/"bug" → fix；"refactor" → refactor；否则 implement）
- `summary`：commit message 或文件变更摘要
- `plan`：null
- `user_prompt_summary`：null
- 标记 Dashboard 上显示"未确认"图标

用户在 Dashboard 看到 reconciled ai_run 时，可一键确认或拒绝。拒绝后事件回到未归并状态等待重新指派。

### 3.5 数据流示例（v0.3）

最理想路径（AI 全程配合）：

```
1. 用户："帮我做邮箱登录"
2. Cursor 调 compass_start_ai_run
   → activity_events: mcp_call
   → ai_runs: 新 run, origin='mcp'
   → feature_nodes.status='in_progress'
3. AI 写文件 → fs_watcher 触发
   → activity_events: fs_watch (debounced 30s window)
   → reconciler 归并到 active run（强信号）
4. AI 调 compass_finish_ai_run
   → activity_events: mcp_call
   → ai_run.run_status='completed'
   → feature_nodes.status='ai_completed'
5. 用户 git commit → post-commit hook
   → activity_events: commit
   → reconciler 归并到刚结束的 run（中信号：files_touched 重合）
```

降级路径（AI 一次都没调 MCP）：

```
1. 用户："帮我做邮箱登录"
2. AI 直接改文件，没调 MCP
   → activity_events: fs_watch
3. AI 不报告完工
4. 用户 git commit
   → activity_events: commit (含 "feat: email login")
5. reconciler 跑：
   - 找不到 active ai_run（强中信号都失败）
   - commit message 含 "email login" → 模糊匹配到 feature_nodes 表
   - 若有 title 含 "email login" 或 "邮箱登录" 的节点 → 中信号命中
   - 否则归并失败 → reconciled=2
6. 用户打开 Dashboard "未归类活动" 视图
   - 看到一组 fs_watch 事件 + 一个 commit
   - 选中 → 指派给 "Email login" 节点
   - 系统创建 reconciled ai_run，状态推到 ai_completed
```

降级路径仍能产出有用的产品记忆，只是用户多一步手动归类。

### 3.6 索引与查询性能

主要查询场景与 v0.2 相同，新增：

- **未归并事件列表**：`idx_events_unreconciled` 部分索引保证扫描成本极低
- **某节点的活动时间线**：跨 ai_runs / activity_events / test_runs 三表 UNION，按时间排序——MVP 阶段直接在 Dashboard 应用层合并，不做物化视图

### 3.7 feature_dependencies（预留）

不变，仍 post-MVP 不实现。

---

## 4. MCP 接口设计

v0.3 工具列表：在 v0.2 的 10 个基础上**新增 1 个**（`compass_defer_feature`），共 11 个。另外 2 个工具的签名扩展（`compass_list_features` 加 phase 过滤、`compass_finish_ai_run` 加 next_status）。

**关键定位变化**：MCP 工具不再是数据写入的唯一入口，而是"增强信号源"。具体含义：

- AI 调了工具 → 强信号，归并准确率 ~100%
- AI 没调工具 → 降级到 commit + fs_watch，归并准确率 ~60-80%

服务端实现要点：

1. 每次工具调用同时写入 `activity_events` 表（`source='mcp_call'`），保证三路数据一致性
2. `compass_start_ai_run` 在创建 ai_run 后立即设置 `feature_node.active_ai_run_id`，给 reconciler 提供强信号
3. `compass_finish_ai_run` 清空 `active_ai_run_id` 后，触发一次同步 reconcile（不等下次 60s tick）

### 4.1 v0.3 变更的工具签名

#### `compass_list_features`（扩展）

新增 `phase` 过滤参数，默认值为项目的 `active_phase`（不传 = 只看当前版本，AI 默认行为）：

```typescript
{
  name: "compass_list_features",
  description: `List features in the current project as a hierarchical tree.

  By default returns only features in the current active phase (e.g. v1).
  Pass phase='all' to see deferred features (v2, someday, etc.).

  USE THIS WHEN:
  - User asks "what have we built" / "what's done"
  - You're about to start a new feature and need to check what already exists
  - You need to find the right place to add a new task`,

  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: [/* ...同 v0.2... */, "needs_user_action", "all"], default: "all" },
      kind: { type: "string", enum: ["module", "feature", "task", "all"], default: "all" },
      phase: { type: "string", description: "Filter by phase (e.g. 'v1', 'v2', 'all'). Defaults to the project's active_phase." },
      max_depth: { type: "integer", minimum: 0, maximum: 3, default: 2 }
    },
    additionalProperties: false
  }
}
```

#### `compass_finish_ai_run`（扩展）

新增 `next_status` 参数，允许 AI 显式选择转入 `ai_completed` 或 `needs_user_action`：

```typescript
{
  name: "compass_finish_ai_run",
  description: `Mark an AI work session as complete.

  Use next_status='needs_user_action' when you finished coding BUT the user must do something before they can test it (e.g. set up an API key, run a migration manually, configure an external service). Always provide user_action_required when using this status.

  Use next_status='ai_completed' (default) when the user can test immediately.`,

  inputSchema: {
    type: "object",
    properties: {
      ai_run_id: { type: "string" },
      run_status: { type: "string", enum: ["completed", "failed", "abandoned"] },
      next_status: { type: "string", enum: ["ai_completed", "needs_user_action"], default: "ai_completed" },
      user_action_required: { type: "string", description: "Required when next_status='needs_user_action'. Markdown list of what the user must do." },
      summary: { type: "string" },
      commit_sha: { type: "string" },
      files_touched: { type: "array", items: { type: "string" } }
    },
    required: ["ai_run_id", "run_status", "summary"],
    additionalProperties: false
  }
}
```

服务端校验：`next_status='needs_user_action'` 时 `user_action_required` 必填且非空。

### 4.2 v0.3 新增工具：`compass_defer_feature`

```typescript
{
  name: "compass_defer_feature",
  description: `Defer a feature to a later phase (e.g. v1 → v2). Use this when you realize during implementation that something is out of scope for the current phase and the user agrees to push it back.

  RULES:
  - You can only defer FROM the current active phase TO another phase (typically a later one)
  - You CANNOT pull a feature from a later phase into the current one — that's a product priority decision only the user can make
  - You CANNOT invent new phase names. Use one of the known phases the user has created.

  Before calling this, confirm with the user. Do not silently defer.`,

  inputSchema: {
    type: "object",
    properties: {
      feature_node_id: { type: "string" },
      target_phase: { type: "string", description: "Must be in the project's known_phases list" },
      reason: { type: "string", description: "Brief reason for deferral" }
    },
    required: ["feature_node_id", "target_phase", "reason"],
    additionalProperties: false
  }
}
```

服务端强约束：

- 节点当前 phase 必须等于 `project.active_phase`（不能 defer 已经 deferred 的节点）
- `target_phase` 必须在 `project.known_phases` 数组里
- `target_phase` 不能等于 `active_phase`（无意义操作）
- 子树级联：defer 父节点时所有子节点 phase 同步迁移（这里允许级联，因为是用户授意的范围操作；与"phase 不自动同步"的常规规则不冲突——defer 是显式操作）

记录到 `activity_events` 作为 `tool_call` 事件，方便事后审计 AI 是否过度推迟。

### 4.3 安全考虑

延续 v0.2，新增：

- **commit hook 注入防御**：hook 脚本仅传 sha 不传 message 内容，message 由 `compass-cli` 读取 git 自身，避免 shell 注入
- **fs_watcher 路径越界防御**：watcher 只监听已注册的 project root，且解析符号链接后必须仍在 root 内
- **activity_events 大小限制**：单条 payload 最大 64KB，超出截断并标记
- **phase 强约束**：服务端硬校验 `target_phase ∈ known_phases`，AI 不能凭空创造 phase；defer 方向单向（active → other），不可逆向
- **user_action_required 字段长度限制**：最大 4KB，防止 AI 把整篇文档塞进去

---

## 5. 系统架构

### 5.1 进程拓扑（v0.3）

```
┌──────────────────┐         ┌──────────────────┐
│  Cursor /        │         │  User's browser  │
│  Claude Code     │         │  localhost:3737  │
└────────┬─────────┘         └────────┬─────────┘
         │ stdio                       │ HTTP
         ▼                             ▼
┌──────────────────┐         ┌──────────────────┐
│  compass-mcp     │         │  compass-web     │
│  (短生命周期)    │         │  (Next.js)       │
└────────┬─────────┘         └────────┬─────────┘
         │                             │
         │     ┌──────────────────────┘
         │     │
         ▼     ▼
    ┌─────────────────────────────────┐
    │  compass-daemon (常驻)          │
    │  ├─ fs watcher (chokidar)       │
    │  ├─ reconciler (60s tick)       │
    │  └─ capture endpoint :3738      │◄──── git post-commit hook
    └────────────┬────────────────────┘            (compass-cli)
                 │
                 ▼
    ┌─────────────────────────────────┐
    │  ~/.compass/                    │
    │  ├─ db.sqlite (WAL)             │
    │  ├─ audit.log                   │
    │  └─ projects.json (注册列表)    │
    └─────────────────────────────────┘
```

三个 Node 进程 + 一个 Next.js 进程，通过 SQLite 文件交换数据：

| 进程 | 生命周期 | 职责 |
|---|---|---|
| compass-mcp | 由 AI 客户端 spawn，会话结束退出 | 仅处理 MCP stdio 协议 |
| compass-daemon | `compass start` 启动，常驻 | fs watcher、reconciler、HTTP capture endpoint |
| compass-web | `compass start` 启动，常驻 | Next.js Dashboard |
| compass-cli | 一次性调用（被 git hook 触发） | HTTP POST 到 daemon 的 :3738 |

### 5.2 启动流程

`npx compass start` 在某项目目录下首次运行：

1. 检查 `~/.compass/db.sqlite`，不存在则初始化
2. 把当前目录注册为 project（写 `projects` 表和 `~/.compass/projects.json`）
3. 在当前目录安装 git post-commit hook（写 `.git/hooks/post-commit`，若已存在则提示用户合并）
4. 启动 compass-daemon（含 fs watcher + reconciler + :3738）
5. 启动 compass-web 监听 :3737
6. 输出 MCP Server 配置 JSON
7. 启动时清理：将 `run_status='running'` 且超过 6 小时未更新的 AIRun 标为 `abandoned`

### 5.3 git hook 设计

`.git/hooks/post-commit`：

```bash
#!/usr/bin/env bash
# Installed by Compass. Do not edit manually.
# Original hook (if any) is renamed to post-commit.original
COMPASS_CLI="$(command -v compass-cli 2>/dev/null)"
if [ -n "$COMPASS_CLI" ]; then
  "$COMPASS_CLI" capture-commit \
    --project-root "$(git rev-parse --show-toplevel)" \
    --sha "$(git rev-parse HEAD)" >/dev/null 2>&1 &
fi
# Chain to original hook if exists
[ -x "$(dirname "$0")/post-commit.original" ] && "$(dirname "$0")/post-commit.original"
```

关键设计：

- **静默 + 后台**：`>/dev/null 2>&1 &` 保证不污染用户 git 输出，不阻塞 commit
- **可降级**：compass-cli 不存在时无声跳过，不阻断 git 工作流
- **保留用户原有 hook**：安装前如检测到现存 hook，rename 为 `.original` 并链式调用

### 5.4 云同步层（post-MVP）

不变。v0.3 多一张 `activity_events` 表，同步策略上选择**不同步原始事件**（量大且本地够用），只同步归并后的 `ai_runs / feature_nodes / code_todos / test_runs`。

---

## 6. MVP 范围严格定义

### 6.1 第一版必须有（v0.3 调整）

- MCP Server 提供 §4 的 11 个工具
- 本地 SQLite，含 §3.2 全部表（含 `activity_events`）+ phase / user_action_required 字段
- **compass-daemon**：fs watcher + reconciler + HTTP capture endpoint
- **compass-cli**：`capture-commit` 子命令 + git hook 自动安装
- Web Dashboard 显示：
  - 树形功能视图（**顶部 phase 切换器**，默认显示 active_phase）
  - 待测试队列（`ai_completed` 节点）
  - **待操作队列**（`needs_user_action` 节点，醒目黄色标记，列出 `user_action_required` 内容）
  - 节点详情页（含 AIRun 时间线，区分 `origin='mcp'` 与 `origin='reconciled'`）
  - **未归类活动视图**：列出 `reconciled=2` 的事件组，支持多选批量指派到节点
  - 用户操作：建 module/feature、管理 phase（新建/重命名/切换 active_phase）、改状态到 `verified` / `broken` / `archived`、点"已完成操作"把 `needs_user_action` 推到 `ai_completed`、拖拽功能在 phase 间移动、确认/拒绝 reconciled ai_run
- `npx compass start` 一键启动 + git hook 自动安装
- 文档：Cursor/Claude Code/Claude Desktop 配置 + 解释三路捕获原理 + phase 心智模型
- 随安装文档提供"项目初始化 prompt"（提高 MCP 调用率到 60%+，但不强求 100%）

### 6.2 第一版坚决不做

- 用户认证 / 多用户
- 云同步
- 团队协作 / 分享
- feature_dependencies（schema 保留）
- 自动化测试运行
- 集成 GitHub Issues / Jira / Linear
- 移动端
- AI 模型直连
- 分析报表 / 看板视图
- **状态自动 roll-up**
- **AI 创建 module/feature 层**
- **AI 把 deferred 功能拉回 active phase**
- **AI 创建新 phase 名**
- 任何"AI 自动判断功能是否实现"
- **复杂归并规则**：MVP 只做 §3.4 的简化算法，机器学习/嵌入向量等留给未来
- **phase 之间的依赖关系图**：MVP 阶段 phase 只是标签，不做"v2 依赖 v1 哪些功能"的可视化

### 6.3 验证假设

1. AI 客户端真的会按预期调用 MCP 工具吗？（技术可行性——v0.3 风险已降级）
2. AI 能正确区分 module/feature/task 三层吗？
3. **三路捕获 + 归并能在 AI 调用率仅 30% 时仍产出可用记忆吗？**（v0.3 新增——核心可行性）
4. 用户愿意配置 MCP Server 来用吗？
5. 用户愿意手动维护 module/feature 骨架吗？
6. 看到功能树 + 待测试队列能减轻"产品状态焦虑"吗？
7. **用户愿意定期清理"未归类活动"队列吗？**（v0.3 新增——人工归并的接受度）
8. 多少用户 1 周后还在用？

假设 3、7 是 v0.3 引入的新假设，需要在 dogfood 阶段重点观察。

---

## 7. 18 周开发路线图（v0.3 重估）

| 周次 | 里程碑 |
|---|---|
| 第 1-2 周 | SQLite schema（含 activity_events）+ 基础 CRUD + 树查询工具函数 |
| 第 3 周 | compass-cli + git hook 安装器 + capture-commit 子命令 |
| 第 4 周 | compass-daemon 骨架 + chokidar fs watcher + HTTP :3738 endpoint |
| 第 5 周 | reconciler 后台任务 + §3.4 归并算法 + 单元测试 |
| 第 6-7 周 | MCP Server 骨架 + 核心工具（list/start_ai_run/finish_ai_run/list_subtree） |
| 第 8 周 | 补全剩余 6 个 MCP 工具 + 状态机/并发冲突单元测试 |
| 第 9 周 | Claude Desktop 端到端跑通：理想路径 + 降级路径 |
| 第 10-11 周 | Web Dashboard 树形视图 + 节点详情页 + **phase 切换器与管理** |
| 第 12 周 | Dashboard：待测试队列 + **待操作队列**（needs_user_action）+ 测试/操作确认 |
| 第 13 周 | Dashboard：**未归类活动视图 + 批量指派 UI** + phase 间拖拽迁移 |
| 第 14 周 | npm 打包 + 三客户端配置文档 + "初始化 prompt" |
| 第 15 周 | dogfood：用 Compass 开发 Compass，记录摩擦点 |
| 第 16-17 周 | 小范围内测（10-20 个独立开发者） |
| 第 18 周 | 缓冲 + 上线 |

全职 40h/week 约 720 小时；兼职 20h/week 约 9 个月。

### 7.1 最大技术风险

1. **归并算法准确率（v0.3 核心风险）**：如果归并错误率高，用户在 Dashboard 看到一堆错配的 ai_run 反而比没有更糟。第 5 周完成基础算法后必须做一次准确率压测：人造 50 个混合场景（AI 调 MCP / 不调 / 部分调），实测归并正确率，目标 >75%
2. **AI 是否区分 module/feature/task 正确**：延续 v0.2 风险
3. **fs watcher 在大项目下的性能**：node_modules 万一被监听会爆 CPU。第 4 周必须实测 100k 文件项目的 CPU 和内存
4. **git hook 跨平台兼容**：Windows 下 bash hook 在 Git Bash 才能跑，需测试 PowerShell + cmd 场景
5. **三进程并发写 SQLite**：WAL 模式理论支持但 better-sqlite3 的实现细节要验证，第 2 周做并发压测

调用率风险（v0.2 的最大风险）**已降级**：因为不再是单点故障。

---

## 8. 商业模式与成本

### 8.1 定价（v0.3 微调）

延续 v0.2，但要响应 §1.6 项目模式：

| 层级 | 价格 | 含 |
|---|---|---|
| Free | $0 | 本地版，所有核心功能，无项目数限制（v0.2 是 1 个，v0.3 放开） |
| Pro | $9/月 | 云同步、多设备、AI 生成测试步骤、Dashboard 高级搜索 |

**v0.3 放开 Free 层项目数限制的理由**：根据 §1.6，"做一个好用的工具"优先于商业化。强制单项目对真实独立开发者太苛刻（他们经常有 3-5 个并行项目），制造摩擦得不偿失。Pro 层的价值由云同步和便利功能体现，不靠人为限制免费层。

### 8.2 月度运营成本

| 项 | 成本 |
|---|---|
| Vercel（Web + landing） | $20 |
| Supabase（云同步） | $25 |
| 域名 + 邮件 | $5 |
| **合计** | **~$50/月** |

100 个 Pro 用户即收支平衡。考虑 §1.6 不追求增长，前 30 个付费用户阶段成本压在 $20/月（仅 Vercel）也可行——Supabase 在没有付费用户时免费层够用。

---

## 9. 未解决的问题

延续 v0.2：

1. **AI 会话 ID 程序化获取**：仍未解
2. **是否开源 MCP Server**：倾向开源（信任 + 社区贡献），第 14 周决定
3. **i18n**：v1 仅英文，中文版 v1.1
4. **AIRun plan 字段格式**：MVP 保持自由文本
5. **超长树的性能**：MVP 不优化

v0.3 新增：

6. **归并算法的演进路径**：MVP 用启发式规则，未来是否引入嵌入向量做语义匹配？取决于规则版本在 dogfood 中的实际表现
7. **未归类活动的留存压力**：如果用户三天不归类，队列会积压。是否需要"自动归到最近活跃节点"的兜底策略？需在 dogfood 中观察
8. **Windows 下 git hook 的稳定性**：bash 脚本在 Windows 子系统外的兼容性需要专门测试
9. **多 git 仓库的 monorepo**：一个 project_root 下有多个 .git？v0.3 暂只支持单仓库根目录

---

## 10. 下一步行动

按 §1.6 项目模式定位，跳过 landing page 验证，直接进入开发。

具体顺序：

1. **第 0 周（本周）**：搭最小骨架——SQLite schema 初始化脚本 + `activity_events` 表 + chokidar 监听一个目录 + 把事件存进表。一天能跑通这条最关键的回路
2. **第 1 周开始**：按 §7 路线图正式启动，**优先做三路捕获基建（1-5 周），再做 MCP 工具（6-8 周）**——这个顺序是 v0.3 相对 v0.2 的关键调整
3. **第 5 周末第一个 checkpoint**：归并算法准确率压测，必须 >75% 才进入 MCP 工具开发，否则停下来调算法
4. **第 9 周末第二个 checkpoint**：Claude Desktop 端到端能跑通理想路径 + 降级路径
5. **第 15 周 dogfood checkpoint**：实测自己用 Compass 一周，归并正确率、AI 调用率、用户体验摩擦点

不要在第 13 周之前花时间做 Dashboard 美化或 landing page。先让三路捕获 + 归并 + MCP 形成的核心数据闭环跑稳。

---

*文档版本：v0.3 · 2026-05-27*
*v0.3 主要变更：项目模式声明 / 三路捕获架构 / activity_events 表 / reconciler 归并 / MCP 调用降级为增强信号 / **产品版本 phase 概念** / **needs_user_action 状态** / 路线图扩至 18 周*
