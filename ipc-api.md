# IPC API 接口契约文档

本文档定义 Electron 主进程（Node.js）与渲染进程（HTML/JS）之间的全部 IPC 通信接口，供前后端并行开发与集成测试直接使用。

---

# 一、IPC 架构说明

## 1.1 安全模型

```
渲染进程 (HTML/JS)
    │  window.api.xxx()          ← 通过 contextBridge 暴露
    ▼
preload.js (contextIsolation: true)
    │  ipcRenderer.invoke / ipcRenderer.on
    ▼
主进程 (Node.js)
    │  ipcMain.handle / webContents.send
    ▼
文件系统 / child_process (claude CLI)
```

- `contextIsolation: true`，`nodeIntegration: false`
- 渲染进程只能通过 `preload.js` 中 `contextBridge.exposeInMainWorld('api', {...})` 暴露的方法与主进程通信
- 渲染进程不可直接访问 Node.js 模块

## 1.2 通信方式

| 场景 | 方向 | 机制 |
|---|---|---|
| 渲染进程发起请求，等待结果 | 渲染 → 主 | `ipcRenderer.invoke` / `ipcMain.handle` |
| 主进程向渲染进程推送实时进度 | 主 → 渲染 | `webContents.send` / `ipcRenderer.on` |

## 1.3 通道命名规范

格式：`{模块}:{动作}` 或 `{模块}:{子资源}:{动作}`

示例：`skill:import`、`skill:tag:add`、`test:progress:update`

---

# 二、通用数据结构

## 2.1 标准响应封装

所有 `invoke` 调用均返回以下统一格式：

```typescript
// 成功
{ success: true; data: T }

// 失败
{ success: false; error: { code: string; message: string } }
```

## 2.2 通用错误码

| 错误码 | 说明 |
|---|---|
| `NOT_FOUND` | 资源不存在 |
| `INVALID_PARAMS` | 参数校验失败 |
| `FILE_IO_ERROR` | 文件读写失败 |
| `CLI_NOT_AVAILABLE` | Claude CLI 不可用 |
| `CLI_TIMEOUT` | CLI 执行超时 |
| `CLI_EXECUTION_ERROR` | CLI 执行失败（含模型限流） |
| `SESSION_ERROR` | 会话创建或管理失败 |
| `ALREADY_RUNNING` | 任务已在运行中，不可重复启动 |
| `CONTEXT_OVERFLOW` | 上下文溢出 |
| `INTERNAL_ERROR` | 未预期的内部错误 |

## 2.3 分页参数（复用）

```typescript
interface PaginationParams {
  page: number       // 从 1 开始
  pageSize: number   // 可选值：10 | 20 | 50，默认 20
}

interface PaginationResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
```

---

# 三、模块1：Skill / Agent 资产管理

## `skill:import`

**方向**：渲染 → 主

**入参**：
```typescript
{
  importType: 'text' | 'file'   // 导入方式
  content: string               // 文本粘贴时为提示词内容，文件导入时为文件绝对路径
  meta: {
    name: string                // 必填
    purpose: string             // 必填，目的分类（一级目录名）
    provider: string            // 必填，提供方标识（二级目录名）
    description?: string
    author?: string
    source?: string
    type?: 'skill' | 'agent'   // 可选，默认 'skill'
  }
}
```

**返回**：
```typescript
{ success: true; data: { skillId: string; version: string; path: string } }
```

---

## `skill:list`

**方向**：渲染 → 主

**入参**：
```typescript
{
  purpose?: string              // 按目的分类过滤
  provider?: string             // 按提供方过滤
  tags?: string[]               // 按标签过滤（AND 逻辑）
  keyword?: string              // 名称/描述关键词模糊搜索
  sortBy?: 'created_at' | 'updated_at' | 'name'
  sortOrder?: 'asc' | 'desc'
  page: number
  pageSize: number
}
```

**返回**：
```typescript
{
  success: true
  data: PaginationResult<{
    id: string
    name: string
    purpose: string
    provider: string
    type: 'skill' | 'agent'    // 资产类型，默认 'skill'
    version: string
    description: string
    tags: string[]              // 已生效标签（manual + approved auto）
    pendingTagCount: number     // 待审核自动标签数量
    created_at: string
    updated_at: string
    contentPreview: string      // content.txt 前200字符
  }>
}
```

---

## `skill:get`

**方向**：渲染 → 主

**入参**：
```typescript
{ skillId: string }
```

**返回**：
```typescript
{
  success: true
  data: {
    meta: SkillMeta             // 完整 meta.json 内容（见 schema.md §2.1）
    content: string             // content.txt 完整内容
    tags: TagsFile              // 完整 tags.json 内容（见 schema.md §2.2）
    versions: {                 // 版本列表摘要
      version: string
      updated_at: string
    }[]
    hasProvenance: boolean      // 是否为重组Skill
  }
}
```

---

## `skill:update`

**方向**：渲染 → 主

**触发时机**：用户保存编辑（内容或元数据变更均触发版本递增）

**入参**：
```typescript
{
  skillId: string
  currentVersion: string        // 乐观锁，防止并发写入
  changes: {
    content?: string
    meta?: Partial<{
      name: string
      description: string
      author: string
      source: string
    }>
  }
}
```

**返回**：
```typescript
{ success: true; data: { newVersion: string; updatedAt: string } }
```

---

## `skill:delete`

**入参**：`{ skillId: string }`

**返回**：`{ success: true; data: { deleted: true } }`

---

## `skill:search`

**方向**：渲染 → 主

**入参**：
```typescript
{
  keyword: string               // 在名称、描述、标签、content.txt 中全文检索
  scope?: ('name' | 'description' | 'tags' | 'content')[]  // 默认全部
  page: number
  pageSize: number
}
```

**返回**：同 `skill:list` 返回结构，`items` 中额外含 `matchedIn: string[]` 字段说明命中位置。

---

## `skill:tag:add`

**入参**：
```typescript
{ skillId: string; value: string }
```

**返回**：`{ success: true; data: { tagId: string } }`

---

## `skill:tag:remove`

**入参**：`{ skillId: string; tagId: string; tagType: 'manual' | 'auto' }`

**返回**：`{ success: true; data: { removed: true } }`

---

## `skill:tag:update`

**入参**：
```typescript
{ skillId: string; tagId: string; tagType: 'manual' | 'auto'; newValue: string }
```

**返回**：`{ success: true; data: { updated: true } }`

---

## `skill:autoTag:trigger`

**方向**：渲染 → 主（异步，主进程后台执行，通过事件推送进度）

**入参**：
```typescript
{ skillId: string }
```

**返回**（立即返回，不等待完成）：
```typescript
{ success: true; data: { taskId: string } }
```

> 完成后通过 `autoTag:progress:update` 事件通知结果（见第五章）

---

## `skill:autoTag:triggerBatch`

**入参**：
```typescript
{ skillIds: string[] }          // 最多20个，串行执行
```

**返回**：`{ success: true; data: { batchId: string; totalCount: number } }`

---

## `skill:autoTag:review`

**入参**：
```typescript
{
  skillId: string
  reviews: {
    tagId: string
    action: 'approve' | 'reject' | 'modify'
    newValue?: string           // action 为 modify 时必填
  }[]
}
```

**返回**：`{ success: true; data: { updated: number } }`

---

## `skill:version:list`

**入参**：`{ skillId: string }`

**返回**：
```typescript
{
  success: true
  data: {
    versions: {
      version: string
      updated_at: string
      changedFields: string[]
    }[]
  }
}
```

---

## `skill:version:diff`

**入参**：`{ skillId: string; fromVersion: string; toVersion: string }`

**返回**：
```typescript
{
  success: true
  data: {
    diff: HistoryRecord         // 完整 history JSON（见 schema.md §2.3）
  }
}
```

---

## `skill:version:rollback`

**入参**：`{ skillId: string; targetVersion: string }`

**返回**：`{ success: true; data: { newVersion: string } }`

> 回滚操作本身也会生成新版本（不覆盖历史）

---

## `skill:purpose:suggest`

**入参**：`{ newPurpose: string }`

**返回**：
```typescript
{
  success: true
  data: {
    shouldMerge: boolean        // true 时建议合并到 suggestedPurpose
    suggestedPurpose: string | null  // 目标 purpose（shouldMerge=false 时为 null）
    reason: string              // 一两句理由（CLI 生成；失败时为空字符串）
  }
}
```

> 调用 CLI 分析新 purpose 是否与工作区中已有 purpose 语义重叠，建议合并。若工作区无已有 purpose 或 CLI 调用失败，均返回 `{ shouldMerge: false, suggestedPurpose: null, reason: '' }`（不抛错）。

---

# 四、模块2：测试基线管理

## `baseline:import`

**入参**：
```typescript
{
  importType: 'manual' | 'file' | 'cli_generate'
  meta: {
    name: string
    purpose: string
    provider: string
    description?: string
    author?: string
  }
  // importType === 'manual' 时
  cases?: {
    name: string
    category: 'standard' | 'boundary' | 'exception'
    input: string
    expected_output: string
    description?: string
  }[]
  // importType === 'file' 时
  filePath?: string             // .json 文件绝对路径，结构需符合 cases.json schema
  // importType === 'cli_generate' 时
  generatePrompt?: string       // 发给 CLI 的生成指令
  cliConfig?: { model?: string; timeout_seconds?: number }
}
```

**返回**：`{ success: true; data: { baselineId: string; version: string; caseCount: number } }`

---

## `baseline:list`

入参、返回结构与 `skill:list` 一致，`items` 中以 `caseCount` 替换 `contentPreview`。

---

## `baseline:get`

**入参**：`{ baselineId: string }`

**返回**：
```typescript
{
  success: true
  data: {
    meta: BaselineMeta
    cases: CasesFile            // 完整 cases.json（见 schema.md §3.2）
    tags: TagsFile
    versions: { version: string; updated_at: string }[]
  }
}
```

---

## `baseline:case:add`

**入参**：
```typescript
{
  baselineId: string
  currentVersion: string
  cases: {
    name: string
    category: 'standard' | 'boundary' | 'exception'
    input: string
    expected_output: string
    description?: string
  }[]
}
```

**返回**：`{ success: true; data: { newVersion: string; addedIds: string[] } }`

---

## `baseline:case:update`

**入参**：
```typescript
{
  baselineId: string
  currentVersion: string
  caseId: string
  changes: Partial<{ name; category; input; expected_output; description }>
}
```

**返回**：`{ success: true; data: { newVersion: string } }`

---

## `baseline:case:delete`

**入参**：`{ baselineId: string; currentVersion: string; caseId: string }`

**返回**：`{ success: true; data: { newVersion: string } }`

---

## `baseline:autoTag:trigger` / `baseline:autoTag:triggerBatch` / `baseline:autoTag:review` / `baseline:version:list` / `baseline:version:diff` / `baseline:version:rollback`

结构与 Skill 对应接口完全一致，将 `skillId` 替换为 `baselineId`，`target_type` 改为 `"baseline"`。

---

# 五、模块3：测试项目管理

## `project:create`

**入参**：
```typescript
{
  name: string
  description?: string
  skillIds: string[]            // 1-10 个 Skill ID
  baselineIds: string[]         // 1-5 个基线 ID
  cliConfig: {
    model: string
    timeout_seconds: number
    retry_count: number
    extra_flags?: string[]
  }
  contextConfig?: {
    token_threshold?: number
    auto_compress?: boolean
    auto_export?: boolean
  }
}
```

**返回**：
```typescript
{
  success: true
  data: {
    projectId: string
    projectPath: string         // 项目目录绝对路径
    totalTasks: number          // skillIds.length × 总用例数
  }
}
```

---

## `project:list`

**入参**：
```typescript
{
  status?: 'pending' | 'running' | 'completed' | 'interrupted'
  page: number
  pageSize: number
}
```

**返回**：
```typescript
{
  success: true
  data: PaginationResult<{
    id: string
    name: string
    status: string
    skillCount: number
    baselineCount: number
    totalTasks: number
    completedTasks: number
    created_at: string
  }>
}
```

---

## `project:get`

**入参**：`{ projectId: string }`

**返回**：
```typescript
{
  success: true
  data: {
    config: ProjectConfig       // 完整 config.json（见 schema.md §4.1）
    hasResults: boolean
    hasAnalysis: boolean
    hasIterations: boolean
  }
}
```

---

## `project:export`

**入参**：`{ projectId: string; destPath: string }`（destPath 为用户选择的导出目标目录）

**返回**：`{ success: true; data: { exportedPath: string } }`

---

## `project:delete`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: { deleted: true } }`

---

# 六、模块4：Claude CLI 执行引擎

## `cli:checkAvailable`

**入参**：无（`{}`）

**返回**：
```typescript
{
  success: true
  data: {
    available: boolean
    cliVersion?: string         // 可用时返回版本号
    errorReason?: string        // 不可用时返回原因
  }
}
```

---

## `cli:getConfig`

**入参**：无

**返回**：`{ success: true; data: CliConfig }` （完整 `cli/config.json`，见 schema.md §8.1）

---

## `cli:updateConfig`

**入参**：
```typescript
{
  changes: Partial<{
    cli_path: string
    default_model: string
    default_timeout_seconds: number
    default_retry_count: number
    temp_session_ttl_days: number
    context: { token_threshold: number; auto_compress: boolean; auto_export: boolean }
  }>
}
```

**返回**：`{ success: true; data: { updated: true } }`

---

## `cli:session:list`

**返回**：
```typescript
{
  success: true
  data: {
    sessions: {
      sessionId: string
      type: 'project' | 'temp'
      purpose: string           // 关联操作说明
      projectId?: string
      createdAt: string
      estimatedTokens: number
      status: 'active' | 'closed' | 'expired'
    }[]
  }
}
```

---

## `cli:session:close`

**入参**：`{ sessionId: string }`

**返回**：`{ success: true; data: { closed: true } }`

---

## `cli:session:export`

**入参**：`{ sessionId: string; destPath: string }`

**返回**：`{ success: true; data: { exportedPath: string } }`

---

# 七、模块5：上下文自动管理

## `context:getStatus`

**返回**：
```typescript
{
  success: true
  data: {
    sessions: {
      sessionId: string
      estimatedTokens: number
      threshold: number
      usagePercent: number      // estimatedTokens / threshold * 100
      riskLevel: 'normal' | 'warning' | 'critical'
    }[]
  }
}
```

---

## `context:compress`

**入参**：`{ sessionId: string }`（手动触发压缩）

**返回**：
```typescript
{
  success: true
  data: {
    tokensBefore: number
    tokensAfter: number
    exportedFilePath: string    // 压缩前上下文导出路径
  }
}
```

---

## `context:updateConfig`

**入参**：
```typescript
{
  projectId?: string            // 不填则更新全局配置
  changes: Partial<{ token_threshold: number; auto_compress: boolean; auto_export: boolean }>
}
```

**返回**：`{ success: true; data: { updated: true } }`

---

# 八、模块6：自动化对比测试

## `test:start`

**方向**：渲染 → 主（异步，进度通过事件推送）

**入参**：`{ projectId: string }`

**返回**（立即返回）：`{ success: true; data: { started: true } }`

> 进度通过 `test:progress:update` 事件实时推送

**错误**：`ALREADY_RUNNING`（项目已在运行中）

---

## `test:pause`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: { paused: true; checkpoint: string } }`

---

## `test:resume`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: { resumed: true; remainingTasks: number } }`

---

## `test:stop`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: { stopped: true } }`

---

## `test:getProgress`

**入参**：`{ projectId: string }`

**返回**：
```typescript
{
  success: true
  data: {
    status: 'pending' | 'running' | 'paused' | 'completed' | 'interrupted'
    totalTasks: number
    completedTasks: number
    failedTasks: number
    currentTask?: {
      skillId: string
      skillName: string
      caseId: string
      caseName: string
    }
    estimatedRemainingMs?: number
  }
}
```

---

## `test:getResults`

**入参**：
```typescript
{
  projectId: string
  skillId?: string              // 不填则返回全部
  caseId?: string
  status?: 'completed' | 'failed' | 'skipped'
  page: number
  pageSize: number
}
```

**返回**：
```typescript
{
  success: true
  data: PaginationResult<TestResult>  // TestResult 见 schema.md §5.1
}
```

---

## `test:retryCase`

**入参**：`{ projectId: string; skillId: string; caseId: string }`

**返回**：`{ success: true; data: { taskId: string } }`（异步，进度通过事件推送）

---

## `test:exportResults`

**入参**：`{ projectId: string; format: 'json' | 'csv'; destPath: string }`

**返回**：`{ success: true; data: { exportedPath: string } }`

---

# 九、模块7：自动差异分析

## `analysis:run`

**方向**：渲染 → 主（异步）

**入参**：`{ projectId: string }`

**前置条件**：项目测试状态为 `completed`

**返回**（立即返回）：`{ success: true; data: { taskId: string } }`

> 完成后通过 `analysis:completed` 事件通知

---

## `analysis:getReport`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: AnalysisReport }` （完整 `analysis_report.json`，见 schema.md §6.1）

---

## `analysis:exportReport`

**入参**：`{ projectId: string; format: 'json' | 'md'; destPath: string }`

**返回**：`{ success: true; data: { exportedPath: string } }`

---

# 十、模块8：Skill 优势自动重组

## `recompose:execute`

**方向**：渲染 → 主（异步）

**入参**：
```typescript
{
  projectId: string
  retentionRules: string        // 用户输入的保留规则文字描述
  selectedSegmentIds: string[]  // 用户勾选的优势片段 ID（来自 analysis_report）
  strategy?: {
    removeDuplicates: boolean   // 剔除冗余，默认 true
    unifyFormat: boolean        // 统一格式，默认 true
    includeProvenance: boolean  // 保留溯源标注，默认 true
  }
}
```

**返回**（立即返回）：`{ success: true; data: { taskId: string } }`

> 完成后通过 `recompose:completed` 事件推送预览内容

---

## `recompose:save`

**入参**：
```typescript
{
  projectId: string
  content: string               // 用户最终确认的内容（可能经过编辑）
  meta: {
    name: string
    purpose: string
    provider: string
    description?: string
  }
}
```

**返回**：`{ success: true; data: { skillId: string; version: string } }`

---

# 十一、模块9：迭代验证闭环

## `iteration:start`

**方向**：渲染 → 主（异步）

**入参**：
```typescript
{
  projectId: string
  recomposedSkillId: string       // 初始重组 Skill ref_id
  maxRounds: number               // 最大迭代轮次，默认 3
  stopThreshold?: number          // 自动停止的平均分阈值（0-100），不设则跑满 maxRounds
  retentionRules?: string         // 保留规则（传给重组提示词）
  selectedSegmentIds?: string[]   // 限定参与重组的优势片段 ID
  // AEIO 探索参数（默认 Standard 模式）
  beamWidth?: number              // 每轮并行候选数量，1=标准，2=Explore/Adaptive
  plateauThreshold?: number       // 分差低于此值视为平台期，默认 1.0
  plateauRoundsBeforeEscape?: number  // 连续平台期轮数后触发逃逸策略，默认 2
}
```

**返回**（立即返回）：`{ success: true; data: { iterationId: string } }`

**说明**：AEIO 模式（beamWidth > 1）下，每两轮之间会生成 `beamWidth` 个候选 Skill，各自测试后选分数最高者进入下一轮。plateau 检测根据近期 score_delta 自动切换探索策略：GREEDY → DIMENSION_FOCUS → SEGMENT_EXPLORE → CROSS_POLLINATE → RANDOM_SUBSET。

---

## `iteration:pause` / `iteration:stop`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: { paused/stopped: true } }`

---

## `iteration:getProgress`

**入参**：`{ projectId: string }`

**返回**：
```typescript
{
  success: true
  data: {
    status: 'running' | 'paused' | 'completed' | 'stopped'
    currentRound: number
    totalRounds: number
    currentPhase: 'recompose' | 'test' | 'analyze' | 'idle'
    rounds: {
      round: number
      status: 'completed' | 'running' | 'pending'
      avgScore?: number
    }[]
  }
}
```

---

## `iteration:getReport`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: IterationReport }` （完整 `iteration_report.json`，见 schema.md §7.2）

---

## `iteration:getExplorationLog`

**入参**：`{ projectId: string }`

**返回**：`{ success: true; data: ExplorationLog }` （完整 `exploration_log.json`，见 schema.md §7.3）

**说明**：仅在迭代完成后可用。记录每轮之间 beam 候选的完整历史（策略、得分、是否胜出），供 UI 展示 "Beam Exploration Log"。

---

# 十二、模块10：版本与环境溯源

## `trace:getProjectEnv`

**入参**：`{ projectId: string }`

**返回**：
```typescript
{
  success: true
  data: {
    projectId: string
    projectName: string
    createdAt: string
    cliVersion: string
    modelVersion: string
    skills: { id: string; name: string; version: string }[]
    baselines: { id: string; name: string; version: string }[]
    cliConfig: CliConfig
  }
}
```

---

## `trace:compareEnvs`

**入参**：`{ projectIdA: string; projectIdB: string }`

**返回**：
```typescript
{
  success: true
  data: {
    differences: {
      field: string             // 例如 "cliVersion"、"modelVersion"、"skills[0].version"
      valueA: string
      valueB: string
    }[]
    identical: boolean
  }
}
```

---

# 十三、系统 / 全局接口

## `workspace:init`

**触发时机**：应用首次启动时自动调用

**入参**：无

**返回**：`{ success: true; data: { initialized: boolean; workspacePath: string } }`

---

## `search:global`

**入参**：
```typescript
{
  keyword: string
  scopes?: ('skills' | 'baselines' | 'projects')[]   // 默认全部
  page: number
  pageSize: number
}
```

**返回**：
```typescript
{
  success: true
  data: {
    skills: { id: string; name: string; matchedIn: string[] }[]
    baselines: { id: string; name: string; matchedIn: string[] }[]
    projects: { id: string; name: string; matchedIn: string[] }[]
    total: number
  }
}
```

---

## `log:query`

**入参**：
```typescript
{
  level?: 'info' | 'warn' | 'error'
  module?: string               // 模块名过滤
  startTime?: string            // ISO 8601
  endTime?: string
  keyword?: string
  page: number
  pageSize: number
}
```

**返回**：
```typescript
{
  success: true
  data: PaginationResult<{
    timestamp: string
    level: string
    module: string
    message: string
    detail?: object
  }>
}
```

---

# 十四、主进程推送事件（主 → 渲染）

以下事件由主进程通过 `webContents.send` 推送，渲染进程通过 `window.api.on(event, callback)` 监听。

## `autoTag:progress:update`

```typescript
{
  taskId: string
  batchId?: string
  targetType: 'skill' | 'baseline'
  targetId: string
  status: 'running' | 'completed' | 'failed'
  result?: {
    parsedTags: { value: string }[]
    pendingCount: number
  }
  error?: string
}
```

---

## `test:progress:update`

```typescript
{
  projectId: string
  completedTasks: number
  totalTasks: number
  failedTasks: number
  lastResult?: {
    skillId: string
    caseId: string
    status: 'completed' | 'failed'
    score?: number
  }
  projectStatus: 'running' | 'completed' | 'interrupted'
}
```

---

## `analysis:completed`

```typescript
{
  projectId: string
  taskId: string
  status: 'completed' | 'failed'
  error?: string
}
```

---

## `recompose:completed`

```typescript
{
  projectId: string
  taskId: string
  status: 'completed' | 'failed'
  preview?: {
    content: string             // 重组后内容预览
    segmentCount: number        // 使用的片段数量
    sourceSkillCount: number    // 涉及的来源 Skill 数量
  }
  error?: string
}
```

---

## `iteration:round:completed`

```typescript
{
  projectId: string
  round: number
  skillId: string
  avgScore: number
  scoreDelta: number | null
  stopped: boolean              // 是否因达到阈值自动停止
}
```

---

## `context:warning`

```typescript
{
  sessionId: string
  estimatedTokens: number
  threshold: number
  usagePercent: number
  autoActionTaken: 'compress' | 'export' | null   // 自动处理动作，null 表示仅警告
}
```

---

## `cli:status:change`

```typescript
{
  available: boolean
  cliVersion?: string
  reason?: string               // 不可用时说明原因
}
```

---

# 十五、Preload API 汇总

`preload.js` 通过 `contextBridge.exposeInMainWorld('api', {...})` 暴露以下结构：

```javascript
window.api = {
  // invoke 类（返回 Promise）
  skill: {
    import, list, get, update, delete: del, search,
    tag: { add, remove, update },
    autoTag: { trigger, triggerBatch, review },
    version: { list, diff, rollback },
    purposeSuggest
  },
  baseline: {
    import, list, get,
    case: { add, update, delete: del },
    autoTag: { trigger, triggerBatch, review },
    version: { list, diff, rollback }
  },
  project: { create, list, get, export: exp, delete: del },
  cli: { checkAvailable, getConfig, updateConfig, session: { list, close, export: exp } },
  context: { getStatus, compress, updateConfig },
  test: { start, pause, resume, stop, getProgress, getResults, retryCase, exportResults },
  analysis: { run, getReport, exportReport },
  recompose: { execute, save },
  iteration: { start, pause, stop, getProgress, getReport, getExplorationLog },
  trace: { getProjectEnv, compareEnvs },
  workspace: { init },
  search: { global },
  log: { query },

  // on 类（事件监听，返回 unsubscribe 函数）
  on: (channel: string, callback: (data: any) => void) => () => void
}
```

> 所有 invoke 类方法均返回 `Promise<{ success: boolean; data?: T; error?: { code: string; message: string } }>`
