# Rankings Feature — 开发任务追踪

> 创建于 2026-02-27。本文件用于跨会话的长期任务追踪。
> 每次开始工作时：先看"当前进度总览"，找到第一个 `[ ]` 任务继续。
> 每完成一个任务立即更新状态为 `[x]`，并在末尾"变更日志"追加一行记录。

---

## 当前进度总览

| 阶段 | 任务数 | 完成 | 状态 |
|------|--------|------|------|
| Phase 0: 测试基础设施 | 2 | 0 | ⬜ |
| Phase A: 服务层 | 7 | 0 | ⬜ |
| Phase B: IPC 层 | 4 | 0 | ⬜ |
| Phase C: 单元测试 | 12 | 0 | ⬜ |
| Phase D: Rankings 页面（前端） | 10 | 0 | ⬜ |
| Phase E: Skill 列表增强（前端） | 5 | 0 | ⬜ |
| Phase F: Test Tab 增强（前端） | 2 | 0 | ⬜ |
| Phase G: E2E 测试 | 3 | 0 | ⬜ |
| Phase H: 收尾 & 文档 | 4 | 0 | ⬜ |
| **合计** | **49** | **0** | ⬜ |

---

## 关键设计参考

- **设计文档**: `rankings-design.md`（决策依据）
- **IPC 契约**: `ipc-api.md §十四.五`
- **数据结构**: `schema.md §8.5`
- **UI 规格**: `提示词 & Skill 对比验证与优势重组平台 - UI设计描述.md §3.5`
- **验收用例**: `spec.md §九 UC11-1 ~ UC11-8`

### 新鲜度四态（所有代码必须用这四个枚举值）
```
'current'           ✅  skill版本和baseline版本均未变
'skill_updated'     ⚠️  skill在测试后有新版本
'baseline_updated'  🔶  baseline用例在测试后被修改（严重）
'both_updated'      ❌  两者均已更新
```

---

## Phase 0：测试基础设施

### TASK-R-001：leaderboard 单元测试 Fixture 辅助函数
- **状态**: `[ ]`
- **文件**: `tests/helpers/leaderboard-fixture.js`（新建）
- **描述**: 提供在 tmpDir 中快速构造 project 数据的辅助函数，供所有 leaderboard 单元测试共用。
- **验收标准**:
  - [ ] `createProjectFixture(tmpDir, opts)` — 在 `tmpDir/projects/project_<8chars>_<ts>/` 下创建完整项目结构：
    - `config.json`（含 `skills[]` 和 `baselines[]` 的 `ref_id`、`version`）
    - `results/summary.json`（含 `ranking[]`，每项有 `skill_id`、`skill_version`、`avg_score`、`score_breakdown`、`generated_at`）
  - [ ] `createSkillFixture(tmpDir, { id, name, version, purpose, provider })` — 创建 `skills/purpose/provider/skill_<8chars>_v1/meta.json`
  - [ ] `createBaselineFixture(tmpDir, { id, name, version, purpose, provider, caseCount })` — 创建 `baselines/purpose/provider/baseline_<8chars>_v1/meta.json`
  - [ ] 导出: `module.exports = { createProjectFixture, createSkillFixture, createBaselineFixture }`
- **日志要求**: 无（test helper）
- **依赖**: 无

---

### TASK-R-002：workspace-factory.js 增强 — 多版本场景 seeding
- **状态**: `[ ]`
- **文件**: `tests/e2e/helpers/workspace-factory.js`（已有，追加函数）
- **描述**: 为 E2E 测试提供"同一 Skill 在不同版本下被测试"的场景构建能力。
- **验收标准**:
  - [ ] `_seedProjectWithSummary(workspaceDir, { projectKey, skillRef, baselineRef, summary })` — 在已有技能/基线基础上写一个项目目录和 `results/summary.json`
  - [ ] `summary` 参数直接作为 `results/summary.json` 的内容写入（同 `_seedProject` 的 summary 字段，但可独立调用）
  - [ ] 函数在 `module.exports` 中导出
- **日志要求**: 无
- **依赖**: 无

---

## Phase A：服务层（leaderboard-service.js）

### TASK-R-003：leaderboard-service.js — 项目扫描器
- **状态**: `[ ]`
- **文件**: `main/services/leaderboard-service.js`（新建）
- **描述**: 实现私有函数 `_scanProject(projectPath)`，读取单个项目的测试结果。
- **验收标准**:
  - [ ] 读取 `<projectPath>/config.json`，提取 `skills[]` 和 `baselines[]`（含 `ref_id`、`version`、`name`）
  - [ ] 读取 `<projectPath>/results/summary.json`，提取 `ranking[]`、`generated_at`、`total_cases`
  - [ ] 若 `config.json` 或 `summary.json` 不存在/格式错误 → 记录 `logService.warn` → 返回 `[]`
  - [ ] 正常情况返回 `RawRecord[]`，每条含：`projectId`、`projectName`、`testedAt`、`skillId`、`skillName`、`skillVersionTested`、`baselineId`（对应 `ref_id`）、`baselineVersionTested`、`baselineName`、`avgScore`、`scoreBreakdown`、`caseCount`、`completedCases`、`failedCases`
  - [ ] 若 summary 中某 skill_id 在 config.skills 中找不到对应 baseline 信息 → `logService.warn` 并跳过该条
- **日志**:
  - `logService.info('leaderboard-service', '_scanProject', { projectPath, recordCount })`（成功）
  - `logService.warn('leaderboard-service', '_scanProject: missing file', { projectPath, reason })`（跳过）
- **依赖**: TASK-R-001

---

### TASK-R-004：leaderboard-service.js — 当前版本查询
- **状态**: `[ ]`
- **文件**: `main/services/leaderboard-service.js`（追加）
- **描述**: 实现 `_getCurrentSkillVersion(skillId)` 和 `_getCurrentBaselineVersion(baselineId)`，在 workspace 中查找当前版本号。
- **验收标准**:
  - [ ] `_getCurrentSkillVersion(skillId)` — 扫描 `workspace/skills/**/**/meta.json`，找到 `id === skillId` 的 meta，返回 `meta.version`；找不到返回 `null`（不抛错）
  - [ ] `_getCurrentBaselineVersion(baselineId)` — 同上，扫描 `workspace/baselines/`
  - [ ] 使用 `fileService.listDirs()` 递归扫描，命名约定：`skill_${id.slice(0,8)}_` 开头的目录 → 优先前缀匹配以加速
  - [ ] 找不到时记录 `logService.warn('leaderboard-service', 'version lookup not found', { id })`
- **日志**: 见上
- **依赖**: TASK-R-003

---

### TASK-R-005：leaderboard-service.js — 新鲜度计算
- **状态**: `[ ]`
- **文件**: `main/services/leaderboard-service.js`（追加）
- **描述**: 实现 `_computeStaleness(skillVersionTested, currentSkillVersion, baselineVersionTested, currentBaselineVersion)` 纯函数。
- **验收标准**:
  - [ ] 两者均一致 → `'current'`
  - [ ] 只有 skill 版本不一致 → `'skill_updated'`
  - [ ] 只有 baseline 版本不一致 → `'baseline_updated'`
  - [ ] 两者均不一致 → `'both_updated'`
  - [ ] currentSkillVersion 或 currentBaselineVersion 为 `null`（Skill/Baseline 已删除）→ 返回 `'both_updated'`（保守策略）
  - [ ] 纯函数，无 I/O，无日志
- **依赖**: 无（纯计算）

---

### TASK-R-006：leaderboard-service.js — queryLeaderboard 聚合
- **状态**: `[ ]`
- **文件**: `main/services/leaderboard-service.js`（追加）
- **描述**: 实现 `async function queryLeaderboard(opts)` 主查询函数。
- **验收标准**:
  - [ ] 扫描 `workspace/projects/` 下所有目录，调用 `_scanProject` 收集 RawRecord[]
  - [ ] 对每条 RawRecord 调用 TASK-R-004 查当前版本，调用 TASK-R-005 计算 staleness，组装为 `LeaderboardRecord`
  - [ ] 过滤：`baselineId`、`skillId`、`purpose`（匹配 skill 或 baseline 的 purpose 字段）、`dateFrom/dateTo`（与 `testedAt` 比对）
  - [ ] `includeStale=false` 时过滤掉 `staleness !== 'current'` 的记录
  - [ ] `groupByBaseline=true`（默认，当未指定 `baselineId` 时）→ 返回 `{ groups: LeaderboardGroup[] }`；每组内 records 按 `avgScore` 降序
  - [ ] `groupByBaseline=false` 或 `baselineId` 已指定 → 返回 `{ records: LeaderboardRecord[] }` 按 `avgScore` 降序
  - [ ] 记录开始/结束日志含参数和结果数量
- **日志**:
  - `logService.info('leaderboard-service', 'queryLeaderboard start', { opts })`
  - `logService.info('leaderboard-service', 'queryLeaderboard done', { projectsScanned, recordsReturned, groupsReturned })`
- **依赖**: TASK-R-003, TASK-R-004, TASK-R-005

---

### TASK-R-007：leaderboard-service.js — exportLeaderboard
- **状态**: `[ ]`
- **文件**: `main/services/leaderboard-service.js`（追加）
- **描述**: 实现 `async function exportLeaderboard({ baselineId, skillId, format })` 导出函数。
- **验收标准**:
  - [ ] 内部调用 `queryLeaderboard` 获取 records（`groupByBaseline: false`）
  - [ ] `format='csv'`：生成 CSV 字符串，列顺序：`skill_name, skill_version_tested, skill_version_current, baseline_name, baseline_version_tested, baseline_version_current, avg_score, functional_correctness, robustness, readability, conciseness, complexity_control, format_compliance, project_id, tested_at, staleness`
  - [ ] `format='json'`：JSON.stringify 整个 records 数组
  - [ ] 写入 `workspace/leaderboard_export_<YYYYMMDDHHmmss>.<ext>`，使用 `fileService.writeFile`
  - [ ] 返回 `{ filePath: <绝对路径> }`
  - [ ] 文件写入成功/失败均有日志
- **日志**:
  - `logService.info('leaderboard-service', 'exportLeaderboard', { format, filePath, recordCount })`
  - `logService.error('leaderboard-service', 'exportLeaderboard failed', { error: e.message })`
- **依赖**: TASK-R-006

---

### TASK-R-008：leaderboard-service.js — getTestSummaries
- **状态**: `[ ]`
- **文件**: `main/services/leaderboard-service.js`（追加）
- **描述**: 实现 `async function getTestSummaries()` — 一次性扫描所有项目，返回 `Map<skillId, SkillTestSummary>` 供前端 Skill 列表 badge 使用。
- **验收标准**:
  - [ ] 内部调用 `queryLeaderboard({ groupByBaseline: false })` 获取全部记录
  - [ ] 按 `skillId` 分组，为每个 Skill 计算：
    - `has_tests: true`
    - `best_score`: 所有记录中最高的 `avgScore`
    - `best_baseline_name`: best_score 所在记录的 `baselineName`
    - `test_count`: 记录总数
    - `staleness`: 聚合新鲜度——若有任何 `current` 则为 `current`；否则取最"轻"的非 current 状态
  - [ ] 返回普通对象 `{ [skillId]: SkillTestSummary }`（前端友好，避免 Map 序列化问题）
  - [ ] 无测试记录的 skill 不出现在返回值中（由前端判断 key 是否存在）
- **日志**:
  - `logService.info('leaderboard-service', 'getTestSummaries', { skillCount })`
- **依赖**: TASK-R-006

---

## Phase B：IPC 层

### TASK-R-009：main/ipc/leaderboard.js — 创建文件 + leaderboard:query
- **状态**: `[ ]`
- **文件**: `main/ipc/leaderboard.js`（新建）
- **描述**: 注册 `leaderboard:query` IPC handler。
- **验收标准**:
  - [ ] 文件头：`'use strict'`，遵循现有 IPC 文件结构
  - [ ] `registerLeaderboardHandlers(mainWindow)` 函数
  - [ ] `ipcMain.handle('leaderboard:query', wrapHandler(async (args) => { ... }))` — 调用 `leaderboardService.queryLeaderboard(args)`
  - [ ] `ipcMain.handle('leaderboard:getTestSummaries', wrapHandler(async () => { ... }))` — 调用 `leaderboardService.getTestSummaries()`
  - [ ] 遵循 `wrapHandler` 模式（来自 `helpers.js`）
  - [ ] `module.exports = { registerLeaderboardHandlers }`
- **依赖**: TASK-R-006, TASK-R-008

---

### TASK-R-010：main/ipc/leaderboard.js — leaderboard:export
- **状态**: `[ ]`
- **文件**: `main/ipc/leaderboard.js`（追加）
- **描述**: 注册 `leaderboard:export` handler。
- **验收标准**:
  - [ ] `ipcMain.handle('leaderboard:export', wrapHandler(async ({ baselineId, skillId, format }) => { ... }))`
  - [ ] 调用 `leaderboardService.exportLeaderboard(...)` 并返回 `{ filePath }`
- **依赖**: TASK-R-007, TASK-R-009

---

### TASK-R-011：main/ipc/index.js — 注册 leaderboard 模块
- **状态**: `[ ]`
- **文件**: `main/ipc/index.js`（修改）
- **描述**: 将 leaderboard IPC 模块加入注册列表。
- **验收标准**:
  - [ ] 顶部 `require` 加入 `const registerLeaderboardHandlers = require('./leaderboard')`
  - [ ] `registerAllHandlers` 函数末尾调用 `registerLeaderboardHandlers(mainWindow)`
- **依赖**: TASK-R-009

---

### TASK-R-012：main/preload.js — 暴露 leaderboard API
- **状态**: `[ ]`
- **文件**: `main/preload.js`（修改）
- **描述**: 通过 contextBridge 暴露 leaderboard 相关方法。
- **验收标准**:
  - [ ] `INVOKE_CHANNELS` 数组中加入：`'leaderboard:query'`、`'leaderboard:getTestSummaries'`、`'leaderboard:export'`
  - [ ] `contextBridge` 对象中加入（在 trace 模块后）：
    ```js
    leaderboard: {
      query:            (args) => ipcRenderer.invoke('leaderboard:query', args),
      getTestSummaries: ()     => ipcRenderer.invoke('leaderboard:getTestSummaries'),
      export:           (args) => ipcRenderer.invoke('leaderboard:export', args),
    },
    ```
- **依赖**: TASK-R-011

---

## Phase C：单元测试（TDD）

> 所有测试文件遵循现有 `createTmpDir()` + `overrideWorkspace()` + `jest.resetModules()` 隔离模式。

### TASK-R-013：leaderboard-service.test.js — 测试骨架 + UC11-1（无过滤，分组）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（新建）
- **描述**: 创建测试文件骨架，实现 UC11-1。
- **验收标准**:
  - [ ] 文件头注释：`TDD Test Cases: UC11-1 through UC11-8`
  - [ ] `beforeAll`：`createTmpDir`、`overrideWorkspace`、`require leaderboard-service`
  - [ ] 使用 TASK-R-001 的 fixture 在 tmpDir 创建 2 个项目（不同 Baseline）
  - [ ] UC11-1: `queryLeaderboard({})` → 返回 `{ groups }`，groups 数组长度 = 2（每个 Baseline 一组）
  - [ ] 每个 group 含 `baseline_id`、`baseline_name`、`skill_count`、`records`
  - [ ] 每个 group 内 records 按 `avgScore` 降序排列
- **依赖**: TASK-R-006, TASK-R-001

---

### TASK-R-014：leaderboard-service.test.js — UC11-2（baselineId 过滤，平铺）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-2 测试用例。
- **验收标准**:
  - [ ] `queryLeaderboard({ baselineId: 'xxx' })` → 返回 `{ records }` 而非 groups
  - [ ] `records` 只含该 Baseline 的测试记录
  - [ ] 每条 record 含 `skill_id`、`skill_version_tested`、`skill_version_current`、`baseline_version_tested`、`baseline_version_current`、`staleness`、`avg_score`、`score_breakdown`、`project_id`、`tested_at`
- **依赖**: TASK-R-013

---

### TASK-R-015：leaderboard-service.test.js — UC11-3（skillId 过滤，跨 Baseline）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-3：同一 Skill 在多个 Baseline 上的记录。
- **验收标准**:
  - [ ] Fixture：Skill A 分别在 Baseline-1 和 Baseline-2 上各测试一次
  - [ ] `queryLeaderboard({ skillId: 'skill-a' })` → records 长度 = 2
  - [ ] 两条 records 的 `baseline_id` 不同
  - [ ] 两条 records 的 `skill_id` 均为 'skill-a'
- **依赖**: TASK-R-013

---

### TASK-R-016：leaderboard-service.test.js — UC11-4（skill_updated 新鲜度）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-4：Skill 版本升级后新鲜度标注。
- **验收标准**:
  - [ ] Fixture：项目测试时 Skill 为 v1；skill meta.json 当前版本为 v2（fixture 直接写 v2）
  - [ ] `queryLeaderboard({ skillId })` → record.staleness = `'skill_updated'`
  - [ ] `skill_version_tested = 'v1'`，`skill_version_current = 'v2'`
- **依赖**: TASK-R-013

---

### TASK-R-017：leaderboard-service.test.js — UC11-5（baseline_updated 新鲜度）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-5：Baseline 版本升级后新鲜度标注。
- **验收标准**:
  - [ ] Fixture：项目测试时 Baseline 版本为 v1；baseline meta.json 当前版本为 v2
  - [ ] record.staleness = `'baseline_updated'`
  - [ ] `baseline_version_tested = 'v1'`，`baseline_version_current = 'v2'`
- **依赖**: TASK-R-013

---

### TASK-R-018：leaderboard-service.test.js — UC11-6（current 新鲜度）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-6：均未更新时新鲜度为 current。
- **验收标准**:
  - [ ] Fixture：skill meta v1，项目测试也用 v1；baseline meta v1，项目测试也用 v1
  - [ ] record.staleness = `'current'`
- **依赖**: TASK-R-013

---

### TASK-R-019：leaderboard-service.test.js — UC11-7（includeStale=false）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-7：过滤非 current 记录。
- **验收标准**:
  - [ ] Fixture：2 条记录——1 current，1 skill_updated
  - [ ] `queryLeaderboard({ baselineId, includeStale: false })` → records 长度 = 1
  - [ ] 返回的唯一记录 staleness = `'current'`
- **依赖**: TASK-R-013

---

### TASK-R-020：leaderboard-service.test.js — UC11-8（export CSV）
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 实现 UC11-8：CSV 导出生成文件。
- **验收标准**:
  - [ ] `exportLeaderboard({ format: 'csv' })` → 返回 `{ filePath }`
  - [ ] `filePath` 文件实际存在于 tmpDir 下
  - [ ] 文件内容包含 CSV 表头（至少含 `skill_name`、`avg_score`、`staleness`、`tested_at`）
  - [ ] 至少包含一行数据（等于 fixture 中的记录数）
- **依赖**: TASK-R-013

---

### TASK-R-021：leaderboard-service.test.js — getTestSummaries
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 测试 getTestSummaries 聚合逻辑。
- **验收标准**:
  - [ ] Fixture：Skill A 被测试 3 次，得分 79/85/87；Skill B 被测试 1 次，得分 82
  - [ ] `getTestSummaries()` 返回对象
  - [ ] Skill A：`has_tests=true`、`best_score=87`、`test_count=3`
  - [ ] Skill B：`has_tests=true`、`best_score=82`、`test_count=1`
  - [ ] 无测试记录的 Skill C：不出现在返回对象中
  - [ ] 新鲜度聚合：若有一条 current，staleness = `'current'`
- **依赖**: TASK-R-013

---

### TASK-R-022：leaderboard-service.test.js — 容错：缺失文件
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 确认容错行为：项目目录存在但文件损坏时不崩溃。
- **验收标准**:
  - [ ] 存在无 `results/summary.json` 的项目目录 → `queryLeaderboard` 正常返回，该项目记录被跳过
  - [ ] 存在 `summary.json` 为空/格式错误的项目 → 同上
  - [ ] 存在正常项目和损坏项目混合时 → 只返回正常项目的记录
- **依赖**: TASK-R-013

---

### TASK-R-023：leaderboard-service.test.js — dateFrom/dateTo 过滤
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 时间范围过滤。
- **验收标准**:
  - [ ] Fixture：3 条记录，`tested_at` 分别为 1 月、2 月、3 月
  - [ ] `queryLeaderboard({ dateFrom: '2024-02-01', dateTo: '2024-02-28' })` → 只返回 2 月的记录
- **依赖**: TASK-R-013

---

### TASK-R-024：leaderboard-service.test.js — purpose 过滤
- **状态**: `[ ]`
- **文件**: `tests/unit/leaderboard-service.test.js`（追加）
- **描述**: 按 purpose 过滤（通过 baseline 的 purpose 字段）。
- **验收标准**:
  - [ ] Fixture：Baseline A（coding）和 Baseline B（writing）各有测试记录
  - [ ] `queryLeaderboard({ purpose: 'coding' })` → 只返回 Baseline A 的记录/分组
- **依赖**: TASK-R-013

---

## Phase D：Rankings 页面（前端）

### TASK-R-025：renderer/index.html — Rankings Tab + 页面骨架
- **状态**: `[ ]`
- **文件**: `renderer/index.html`（修改）
- **描述**: 在顶部导航栏增加第四个 Tab，并创建 Rankings 页面 HTML 骨架。
- **验收标准**:
  - [ ] 顶导 `nav-tabs` 区域加入：`<button class="nav-tab" data-page="rankings">Rankings</button>`
  - [ ] `#content` 区域加入 `<section id="rankings-page" class="page hidden">` 包含：
    - 过滤栏容器 `#rankings-filter-bar`（含 `#rankings-search`、`#rankings-baseline-select`、`#rankings-purpose-select`、`#rankings-period-select`、`#rankings-include-stale`、`#rankings-clear-btn`、`#rankings-export-btn`）
    - 视图切换按钮 `#rankings-view-rank-btn`、`#rankings-view-timeline-btn`
    - 排名列表容器 `#rankings-list-body`
    - 时间线容器 `#rankings-timeline-body`（默认 hidden）
    - 空状态提示 `#rankings-empty`
  - [ ] 不使用 `onclick=` — 所有按钮用 `data-*` 属性
  - [ ] 引入 `<script src="js/pages/rankings.js"></script>`
- **依赖**: 无

---

### TASK-R-026：renderer/js/pages/rankings.js — 页面 IIFE 骨架 + init
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（新建）
- **描述**: 创建 Rankings 页面 IIFE 模块。
- **验收标准**:
  - [ ] 标准 IIFE 格式：`window.RankingsPage = (function() { 'use strict'; ... })()`
  - [ ] `init()` 函数：绑定所有按钮事件监听（search input、filter selects、clear btn、export btn、view toggle）
  - [ ] `openPage()` 函数：进入 Rankings 页时调用，触发数据加载
  - [ ] `filterBySkill(skillId)` 公开函数：供 Skill 列表 badge 跳转时调用，预填 skill 过滤条件并加载数据
  - [ ] `_loadData()` 私有函数：组装 opts 调用 `window.api.leaderboard.query(opts)`，处理 success/error，调用渲染函数
  - [ ] 全部 DOM 操作后检查 `window.escHtml()` 用于外部数据
  - [ ] 导出：`return { init, openPage, filterBySkill }`
- **依赖**: TASK-R-025, TASK-R-012

---

### TASK-R-027：rankings.js — 过滤栏逻辑
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 实现过滤器状态管理和联动。
- **验收标准**:
  - [ ] `_state = { search, baselineId, purpose, period, includeStale: true }` 过滤状态对象
  - [ ] search input debounce 350ms 后触发 `_loadData()`
  - [ ] Baseline select change → 更新 state → `_loadData()`
  - [ ] Purpose select change → 同上
  - [ ] Period select change → 转换为 `dateFrom` → `_loadData()`
  - [ ] "包含过期成绩" checkbox → 更新 `includeStale` → `_loadData()`
  - [ ] 清除按钮 → 重置所有 state → 清空所有控件值 → `_loadData()`
  - [ ] `_populateFilterOptions(groups)` — 首次加载后从数据中填充 Baseline 和 Purpose 下拉选项（去重排序）
- **依赖**: TASK-R-026

---

### TASK-R-028：rankings.js — 默认分组视图渲染
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 实现 `_renderGroups(groups)` — 按 Baseline 分组的默认视图。
- **验收标准**:
  - [ ] 每个 group 渲染为一个 `.rankings-group` 区块，含：`.rankings-group-header`（基线名 + 用例数 + 版本 + "[查看全部 N]"）
  - [ ] 默认显示前 5 条 records，超出的 hidden；"查看全部"按钮切换展示全部
  - [ ] 每行 `.rank-row` 含：排名序号、Skill 名（当前版本）、最优 avg_score 条形进度、trend 箭头（↑/↓/→/—）、新鲜度 badge、测试次数、最后测试日期
  - [ ] **所有外部数据必须经过 `window.escHtml()` 处理后再插入 innerHTML**
  - [ ] 无数据时显示 `#rankings-empty`
- **依赖**: TASK-R-026

---

### TASK-R-029：rankings.js — 过滤后平铺视图渲染
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 实现 `_renderRecords(records)` — 选定 Baseline 后的平铺排名。
- **验收标准**:
  - [ ] 相同 `skill_id` 的多条记录合并为一组，组头显示最优分数和排名
  - [ ] 组头有 `▶/▼` 展开箭头；默认折叠（只显示组头行），点击展开子行
  - [ ] 子行 `.rank-row-child` 显示：测试时版本 → 当前版本、得分、项目名、测试日期、新鲜度 badge
  - [ ] 子行末尾 `[展开维度]` 按钮调用 `_renderDimensionPanel(record, container)`
  - [ ] 相同 `skill_id` 内子行按 `tested_at` 倒序（最新在前）
- **依赖**: TASK-R-028

---

### TASK-R-030：rankings.js — 维度展开面板
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 实现维度得分内联展开面板。
- **验收标准**:
  - [ ] `_renderDimensionPanel(record, rowElement)` — 在 `rowElement` 后面插入 `.dimension-panel` 行
  - [ ] 展示 6 个维度的水平条形图（使用纯 CSS `width: X%` 进度条，不依赖外部图表库）
  - [ ] 每维度显示：维度名、满分、得分、彩色进度条（≥80% 绿，60-79% 黄，<60% 红）
  - [ ] 面板底部显示"进入项目详情 →"链接（`data-project-id`，点击后切换到 Projects 页并打开对应项目）
  - [ ] 再次点击"展开维度"按钮折叠面板
- **依赖**: TASK-R-029

---

### TASK-R-031：rankings.js — 新鲜度 badge 辅助函数
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 统一的新鲜度 badge 渲染辅助，供所有视图复用。
- **验收标准**:
  - [ ] `_staleBadge(staleness)` → HTML string
  - [ ] `current` → `<span class="stale-badge current" title="当前有效">✅</span>`
  - [ ] `skill_updated` → `<span class="stale-badge skill-updated" title="Skill 已更新">⚠️</span>`
  - [ ] `baseline_updated` → `<span class="stale-badge baseline-updated" title="基线已更新（分母已变）">🔶</span>`
  - [ ] `both_updated` → `<span class="stale-badge both-updated" title="Skill 和基线均已更新">❌</span>`
  - [ ] 所有 title 属性为中文说明
- **依赖**: TASK-R-026

---

### TASK-R-032：rankings.js — 时间线 SVG 视图
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 实现简单 SVG 折线图时间线视图。
- **验收标准**:
  - [ ] `_renderTimeline(records)` — 仅在 baselineId 已过滤时才渲染；否则显示提示"请先选择一个基线以查看时间线"
  - [ ] 使用原生 SVG（无外部依赖），宽度自适应容器
  - [ ] X 轴：时间（按 `tested_at` 排序）；Y 轴：avg_score（0-100）
  - [ ] 每个不同 skill_id 绘制一条折线，颜色区分
  - [ ] 版本切换点（`skill_version_tested` 变化处）绘制小圆点并标注版本号
  - [ ] 图例：右侧显示 Skill 名称 + 颜色块
- **依赖**: TASK-R-029

---

### TASK-R-033：rankings.js — 导出按钮逻辑
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/rankings.js`（追加）
- **描述**: 导出按钮调用 `leaderboard:export`。
- **验收标准**:
  - [ ] 点击 `#rankings-export-btn` → 调用 `window.api.leaderboard.export({ format: 'csv', baselineId, skillId })`（透传当前过滤条件）
  - [ ] 成功 → `window.notify('已导出: ' + escHtml(data.filePath), 'success')`
  - [ ] 失败 → `window.notify('导出失败: ' + escHtml(error), 'error')`
- **依赖**: TASK-R-026

---

### TASK-R-034：renderer/css/main.css — Rankings 样式
- **状态**: `[ ]`
- **文件**: `renderer/css/main.css`（追加）
- **描述**: 新增 Rankings 页面所需的全部 CSS 样式。
- **验收标准**:
  - [ ] `.rankings-filter-bar`：flex 行布局，间距均匀，紧凑高度
  - [ ] `.rankings-group`：分组卡片，带左边框色彩区分
  - [ ] `.rankings-group-header`：flex 行，基线名加粗，数量灰色小字
  - [ ] `.rank-row` / `.rank-row-child`：flex 行，rank 序号固定宽，进度条自伸缩，子行缩进
  - [ ] `.score-bar`：彩色进度条（green/yellow/red 三档）
  - [ ] `.stale-badge.current`、`.stale-badge.skill-updated`、`.stale-badge.baseline-updated`、`.stale-badge.both-updated`：对应颜色
  - [ ] `.dimension-panel`：内联展开区，背景色与行有细微区分
  - [ ] `.timeline-placeholder`：灰色斜线纹路提示区
  - [ ] 所有新样式添加在文件末尾的注释块 `/* ─── Rankings (Module 11) ─────────────────── */` 下
- **依赖**: TASK-R-025

---

## Phase E：Skill 列表增强（前端）

### TASK-R-035：skill.js — 加载并缓存 testSummaries
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/skill.js`（修改）
- **描述**: Skill 列表初始化后，异步加载所有 Skill 的 testSummary 数据。
- **验收标准**:
  - [ ] 在 `_loadSkills()` 完成后（或并行），调用 `window.api.leaderboard.getTestSummaries()`
  - [ ] 将结果存入模块级变量 `_testSummaries = {}`（key 为 skillId）
  - [ ] 加载失败时静默处理（`console.warn`），不影响主列表渲染
  - [ ] `getTestSummaries` 结果到达后，对已渲染的列表项补充 badge（调用 TASK-R-036 的函数）
- **依赖**: TASK-R-012, TASK-R-025

---

### TASK-R-036：skill.js — test badge 渲染与插入
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/skill.js`（修改）
- **描述**: 在 Skill 列表项 DOM 中插入测试成绩 badge。
- **验收标准**:
  - [ ] `_renderTestBadge(skillId)` 函数：从 `_testSummaries[skillId]` 读取数据
  - [ ] 有数据时返回 HTML：`<span class="test-badge test-badge--<staleness>" data-skill-id="<id>" title="<tooltip>">📊 <score></span>`
  - [ ] 无数据（`!testSummary || !testSummary.has_tests`）→ 返回空字符串
  - [ ] tooltip 格式：`最优 XX 分 | 基线：XXX | N 次测试`（所有变量经 escHtml）
  - [ ] badge 通过 `data-action="open-rankings"` + `data-skill-id` 绑定（**不用 onclick**）
  - [ ] 统一 `addEventListener` 事件委托处理 `data-action="open-rankings"` 点击
- **依赖**: TASK-R-035

---

### TASK-R-037：skill.js — badge 点击跳转 Rankings
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/skill.js`（修改）
- **描述**: badge 点击导航到 Rankings 页并预填 skillId 过滤。
- **验收标准**:
  - [ ] 委托事件中：`e.target.closest('[data-action="open-rankings"]')` 取到按钮
  - [ ] 调用 `window.App.navigateTo('rankings')`（或对应导航函数）切换到 Rankings Tab
  - [ ] 切换后调用 `window.RankingsPage.filterBySkill(skillId)`
  - [ ] 点击 badge 时阻止事件冒泡，不触发行点击（进入 Skill 详情）
- **依赖**: TASK-R-036, TASK-R-026

---

### TASK-R-038：skill.js — 编辑前确认对话框（tested skill）
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/skill.js`（修改）
- **描述**: 编辑有测试记录的 Skill 时，弹出确认提示。
- **验收标准**:
  - [ ] `_openEditModal(skillId)` 函数开头：检查 `_testSummaries[skillId]?.has_tests`
  - [ ] 若为 true，使用自定义 modal（**不用 `window.confirm`**，Electron 在某些模式下行为不稳定）弹出确认弹窗
  - [ ] 弹窗内容：技能名、测试次数、最高分、"继续编辑将生成新版本 vX，历史成绩不受影响" 说明
  - [ ] "取消" 关闭弹窗；"继续编辑" 关闭确认弹窗并打开编辑 modal
  - [ ] 若 `_testSummaries[skillId]` 为空（无测试记录），直接打开编辑 modal，无确认步骤
- **依赖**: TASK-R-035

---

### TASK-R-039：main.css — test badge 样式
- **状态**: `[ ]`
- **文件**: `renderer/css/main.css`（追加，与 TASK-R-034 合并在同一注释块下）
- **描述**: test badge 和 skill 详情测试历史区的 CSS 样式。
- **验收标准**:
  - [ ] `.test-badge`：小尺寸行内块，`cursor: pointer`，hover 轻微亮化
  - [ ] `.test-badge--current`：绿色系
  - [ ] `.test-badge--skill_updated`：琥珀/橙色系，末尾显示 `*`
  - [ ] `.test-badge--baseline_updated` / `.test-badge--both_updated`：灰色系（成绩参考性低）
- **依赖**: TASK-R-034

---

## Phase F：Test Tab 增强

### TASK-R-040：project.js — Test Tab Layer 2（6 维度对比表格）
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/project.js`（修改）
- **描述**: 测试完成后，Test Tab 支持展开 6 维度横向对比表格。
- **验收标准**:
  - [ ] `_renderTestResults(summary)` 函数末尾：若 `summary.ranking.length >= 2`，渲染 `[展开维度对比 ▾]` 按钮
  - [ ] 点击展开按钮：渲染 `.dimension-compare-table`，行 = 6 维度，列 = 每个 Skill
  - [ ] 每格：score 数值 + 彩色 badge（≥80% 绿，60-79% 黄，<60% 红）
  - [ ] 每列末尾显示该 Skill 的总分
  - [ ] **所有数据经 `window.escHtml()` 处理**
- **依赖**: TASK-R-034（借用维度样式）

---

### TASK-R-041：project.js — Test Tab Layer 3（用例热力图）
- **状态**: `[ ]`
- **文件**: `renderer/js/pages/project.js`（修改）
- **描述**: 在 Layer 2 展开后，进一步可展开用例级得分矩阵。
- **验收标准**:
  - [ ] Layer 2 底部显示 `[展开用例详情 ▾]` 按钮
  - [ ] 点击：调用 `window.api.test.getResults({ projectId })` 获取逐条用例结果
  - [ ] 渲染 `.case-heatmap`：行 = 测试用例（显示 case name），列 = Skill
  - [ ] 每格背景色：以该格得分在 0-100 映射为红→绿渐变色
  - [ ] 行末尾显示该用例在所有 Skill 上的平均分（颜色越红说明该用例普遍困难）
  - [ ] 加载中显示 spinner，失败显示 inline 错误提示
- **依赖**: TASK-R-040

---

## Phase G：E2E 测试

### TASK-R-042：rankings-page.js — E2E POM
- **状态**: `[ ]`
- **文件**: `tests/e2e/pages/rankings-page.js`（新建）
- **描述**: Rankings 页面的 Playwright Page Object Model。
- **验收标准**:
  - [ ] `constructor(page)` 定义所有关键 locator：
    - `rankingsTab = page.locator('[data-page="rankings"]')`
    - `searchInput = page.locator('#rankings-search')`
    - `baselineSelect = page.locator('#rankings-baseline-select')`
    - `periodSelect = page.locator('#rankings-period-select')`
    - `includeStaleCheckbox = page.locator('#rankings-include-stale')`
    - `clearBtn = page.locator('#rankings-clear-btn')`
    - `exportBtn = page.locator('#rankings-export-btn')`
    - `listBody = page.locator('#rankings-list-body')`
    - `timelineBody = page.locator('#rankings-timeline-body')`
    - `emptyState = page.locator('#rankings-empty')`
  - [ ] `navigateTo()` 方法：点击 rankingsTab 并等待 listBody 可见
  - [ ] `filterByBaseline(name)` 方法
  - [ ] `expectGroupVisible(baselineName)` 断言方法
  - [ ] `expectRecordVisible(skillName)` 断言方法
  - [ ] `expandFirstRecord()` 方法：点击第一个可展开的 `▶` 箭头
- **依赖**: TASK-R-025

---

### TASK-R-043：rankings.spec.js — TC-R-001 到 TC-R-006
- **状态**: `[ ]`
- **文件**: `tests/e2e/specs/rankings.spec.js`（新建）
- **描述**: Rankings 页面核心 E2E 测试用例。
- **验收标准**:
  - [ ] **TC-R-001**：点击 Rankings Tab → `#rankings-list-body` 可见，无 JS 错误
  - [ ] **TC-R-002**：Workspace 预置 2 个不同 Baseline 的已完成项目 → 默认视图显示 2 个分组
  - [ ] **TC-R-003**：选择 Baseline 过滤 → 显示平铺记录列表（非分组）
  - [ ] **TC-R-004**：staleness badge 可见（⚠️ 或 ✅）
  - [ ] **TC-R-005**：展开子行 → 维度展开面板可见，包含 `functional_correctness` 等维度名
  - [ ] **TC-R-006**：Skill 列表中已测试的 Skill 显示 `.test-badge`
- **依赖**: TASK-R-042, TASK-R-002

---

### TASK-R-044：rankings.spec.js — TC-R-007 到 TC-R-010
- **状态**: `[ ]`
- **文件**: `tests/e2e/specs/rankings.spec.js`（追加）
- **描述**: Rankings 补充测试用例。
- **验收标准**:
  - [ ] **TC-R-007**：点击 Skill 列表 test badge → Rankings Tab 激活，搜索框预填 Skill 名称
  - [ ] **TC-R-008**：Rankings 导出按钮 → 成功通知出现（含文件路径）
  - [ ] **TC-R-009**：编辑已有测试成绩的 Skill → 确认弹窗出现（含"生成新版本"提示）
  - [ ] **TC-R-010**：取消过滤（点击"清除"）→ 恢复默认分组视图
- **依赖**: TASK-R-043

---

## Phase H：收尾 & 文档

### TASK-R-045：运行 npm test — 修复所有单元测试
- **状态**: `[ ]`
- **描述**: 执行全部单元测试，确保新增测试全部通过，原有 269 个无回归。
- **验收标准**:
  - [ ] `npm test` 全部 PASS，无 fail/error
  - [ ] 新测试数量 = 269 + 新增数（预计 +20~24，目标 289~293 通过）
  - [ ] 覆盖率无明显下降

---

### TASK-R-046：运行 npm run test:e2e — 修复所有 E2E 测试
- **状态**: `[ ]`
- **描述**: 执行全部 E2E 测试，确保新增 10 个 TC-R 测试通过，原有 27 个无回归。
- **验收标准**:
  - [ ] `npm run test:e2e` 全部 PASS（跳过的除外）
  - [ ] TC-R-001~TC-R-010 均通过

---

### TASK-R-047：更新 CLAUDE.md 与 MEMORY.md
- **状态**: `[ ]`
- **描述**: 更新项目文档中的测试计数、文件列表、模块说明。
- **验收标准**:
  - [ ] CLAUDE.md：单元测试数量更新，新增 `leaderboard-service.js`、`ipc/leaderboard.js`、`rankings.js` 到对应目录列表，Module Map 添加 Module 11 行，IPC Special Cases 添加 leaderboard 注意事项
  - [ ] MEMORY.md：测试数量更新，排行榜功能摘要

---

### TASK-R-048：更新 rankings-design.md — 实现差异记录
- **状态**: `[ ]`
- **描述**: 记录实现过程中与原设计的差异。
- **验收标准**:
  - [ ] 在 `rankings-design.md` 末尾追加"实现备注"节
  - [ ] 记录：实际 IPC 通道名、任何与设计文档不一致的地方、已知限制

---

## 变更日志

| 日期 | 任务 | 操作 | 备注 |
|------|------|------|------|
| 2026-02-27 | — | 文件创建 | 初始 49 个任务 |

---

## 常见问题速查

**leaderboard-service 如何找到 Skill 的当前版本？**
扫描 `workspace/skills/` 下所有子目录，找到 meta.json 中 `id === skillId` 的条目。
使用命名约定 `skill_${id.slice(0,8)}_` 可以快速定位目录，无需遍历所有文件。

**为什么 getTestSummaries 是独立 IPC 通道而不是附在 skill:list 里？**
避免 skill:list 每次都扫描所有 project。Skill 列表首屏快速渲染，badge 数据异步后补。

**新鲜度聚合规则（getTestSummaries 中的 staleness 字段）？**
取所有记录中"最好"的新鲜度：`current > skill_updated > baseline_updated > both_updated`。
若有任何一条 `current`，整体显示 `current`（表示"至少有一次测试是当前有效的"）。

**E2E 测试如何构造多版本场景？**
使用 `_seedProject(workspaceDir, { ... })` 写入带有 `skills[].version: 'v1'` 的 config.json，
但同时 `_seedSkill(workspaceDir, { ..., id: '...' })` 写入版本为 `v2` 的 meta.json。
`leaderboard-service` 读取 config（v1）vs meta（v2），自动计算 `skill_updated`。
