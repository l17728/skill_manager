# Rankings & Leaderboard — 设计文档

> 编写于 2026-02-27。本文档记录成绩排行榜功能的完整设计决策与实现规范，
> 供编码阶段和后续迭代参考。

---

## 一、背景与问题陈述

SkillManager 的核心价值在于"迭代"：用户不断修改 Skill，通过测试验证进步。
但当前系统存在两个信息缺口：

1. **浏览 Skill 时无法感知测试状态**：用户不知道哪些 Skill 已被测试过、表现如何，
   必须进入每个 Project 才能查看结果。

2. **无法横向对比多次测试**：同一 Skill 在不同项目中的历史成绩分散在各 Project
   的 `results/summary.json` 里，没有聚合视图。

---

## 二、核心设计原则

### 原则 1：Score 只有相对于特定 Baseline 才有意义

**不能**把不同 Baseline 的得分放在同一排名里。例如"Python 编程基线"上的 87 分
与"写作助手基线"上的 91 分不可比较。所有排名展示必须**以 Baseline 为分组维度**。

### 原则 2：历史成绩永不删除，只标注新鲜度

当 Skill 或 Baseline 被修改后，旧成绩仍然有价值（用于趋势分析）。
系统不删除任何历史记录，改为在展示时附加**新鲜度状态标签（Staleness）**，
让用户自行判断成绩的参考价值。

### 原则 3：新鲜度在读取时计算，不存储额外状态

`leaderboard:query` 执行时动态比较"测试时版本"与"当前版本"，
无需在 `summary.json` 或 `config.json` 中追加任何字段。

### 原则 4：渐进披露——默认简洁，按需展开

- 排行榜默认：按 Baseline 分组，每组显示 Top 5
- Skill 列表默认：仅展示最优得分 badge，不撑大列表项
- 详情通过点击/展开触发

### 原则 5：双向导航

- Skill 列表 → 排行榜（点击分数 badge，带 skillId 过滤跳转）
- 排行榜 → Project 详情（点击具体测试记录，跳转对应 Project）

---

## 三、Skill 列表 — 测试成绩 Badge

### 3.1 Badge 信息

每个 Skill 列表项在现有 version badge 右侧新增 **test badge**：

| 状态 | 展示内容 | 颜色 |
|------|---------|------|
| 无测试记录 | 不显示 badge | — |
| 有测试，当前版本为最新 | `📊 87.3` | 绿色 |
| 有测试，但 Skill 已更新 | `📊 85.0 *` | 琥珀色（\* 表示成绩对应旧版本） |

若该 Skill 在多个 Baseline 上均有测试，显示最高得分，鼠标 hover 时
tooltip 显示：`在 N 个基线上有测试记录`。

### 3.2 Badge 交互

- **单击 badge** → 导航到 Rankings 页，自动以 `skillId` 过滤
- **单击 Skill 行** → 正常进入 Skill 详情（不变）

### 3.3 Skill 详情面板 — 测试历史小节

在 Skill 详情的 meta 信息下方新增 **Test History** 折叠区：

```
─── Test History ──────────────────────────────────
  Python 编程基线 v1   v1 → 87.3   2024-02-27  Project-005  ✅
  Python 编程基线 v1   v1 → 85.0   2024-02-15  Project-004  ✅
  写作助手基线 v1      v2 → 91.2   2024-02-20  Project-006  ⚠️ Skill updated
  [在排行榜中查看全部 →]
────────────────────────────────────────────────────
```

字段：基线名称 + 版本 | 测试时 Skill 版本 → 得分 | 测试日期 | 项目 | 新鲜度

---

## 四、Rankings 页面设计

### 4.1 导航位置

在顶部导航栏新增第四个 Tab：

```
Skills & Agents  |  Baselines  |  Projects  |  Rankings
```

### 4.2 过滤栏（Filter Bar）

```
[🔍 Search skills...]  [Baseline ▾]  [Purpose ▾]  [Period ▾]  [⚠ 包含过期成绩 ☑]  [× 清除]
```

| 过滤器 | 类型 | 说明 |
|--------|------|------|
| Search | 文本框 | 模糊匹配 Skill 名称 |
| Baseline | 下拉多选 | 按基线名称过滤 |
| Purpose | 下拉多选 | 按用途（coding / writing / analysis）过滤 |
| Period | 下拉单选 | 全部 / 近 30 天 / 近 90 天 |
| 包含过期成绩 | 复选框 | 默认勾选；取消则只显示 `staleness=current` 的记录 |

**默认状态（无过滤）**：所有过滤器空，视图分组展示所有 Baseline。

### 4.3 默认视图（无过滤时）

按 Baseline 分组展示，每组显示 Top 5：

```
┌─ Python 编程基线  · 10 cases · v1  ──────────────── [查看全部 (12)] ─┐
│  #1  Alpha Coder v3    87.3  ↑+4.2  ✅  5次测试   2024-02-27       │
│  #2  Beta Coder v1     82.1   →0.0  ✅  3次测试   2024-02-20       │
│  #3  Gamma Coder v3    76.2   ↓-1.5 ⚠️  2次测试   2024-02-15       │
│  #4  Delta Coder v2    74.8    —    🔶  1次测试   2024-01-30       │
│  #5  Echo Coder v1     71.0   —     ❌  1次测试   2024-01-20       │
└────────────────────────────────────────────────────────────────────┘

┌─ 写作助手基线  · 8 cases · v2  ───────────────────── [查看全部 (6)] ─┐
│  ...                                                               │
└────────────────────────────────────────────────────────────────────┘
```

**Trend 计算**：当前组内该 Skill 最新两条记录的 avg_score 之差。
若只有一条记录，显示 `—`。

### 4.4 过滤后视图（选定 Baseline 时）

平铺显示该 Baseline 下所有 Skill 的所有测试记录（可折叠），
默认按 avg_score 降序：

```
排行  Skill 名称         测试版本  当前版本  得分   维度详情  测试日期   新鲜度
────────────────────────────────────────────────────────────────────────────
 #1   Alpha Coder       v2        v3        87.3  [展开]   02-27  ⚠️ 版本已更新
      └─ Alpha Coder    v1        v3        85.0  [展开]   02-15  ⚠️ 版本已更新
      └─ Alpha Coder    v1        v3        79.2  [展开]   01-25  ⚠️ 版本已更新
 #2   Beta Coder        v1        v1        82.1  [展开]   02-20  ✅
 ...
```

**合并规则**：相同 Skill（按 skill_id）的所有记录合并为一组，
以**最优 avg_score** 决定排名位置，组内记录按测试时间倒序展示。
"合并/展开"切换通过行首三角箭头控制。

### 4.5 维度展开面板

点击 [展开] 后，在行内展开 6 维度得分对比表格：

```
  功能正确性 /30    ██████████████████████░░░░░  26 / 30
  健壮性     /20    █████████████████░░░░░░░░░░  18 / 20
  可读性     /15    ████████████░░░░░░░░░░░░░░░  13 / 15
  简洁性     /15    ████████████░░░░░░░░░░░░░░░  13 / 15
  复杂度控制 /10    █████████░░░░░░░░░░░░░░░░░░   9 / 10
  格式规范   /10    █████████░░░░░░░░░░░░░░░░░░   9 / 10
  ─────────────────────────────────────────────
  总分              ██████████████████████░░░░░  88 / 100  → 87.3 avg
  [进入 Project-005 查看详情]
```

### 4.6 时间线视图（切换按钮）

页面右上角提供 `[排名视图] [时间线视图]` 切换。

时间线视图：X 轴为测试日期，Y 轴为 avg_score，每个 Skill 一条折线：

```
Score
 90 │                              ● Alpha v3
    │                         ●─/
 85 │                    ●───/
    │               ●───/
 80 │          ●───/
    │  ●──────────────────────────● Beta v1（稳定）
 75 │
 70 │
    └──────────────────────────────── Date
   Jan/10  Jan/25  Feb/1  Feb/15  Feb/27
```

版本切换点（如 v1→v2）用竖虚线标注，帮助用户看到哪次修改带来了进步。

---

## 五、得分新鲜度模型（Staleness Model）

### 5.1 四种状态

| 状态 | 标识 | 含义 | 严重程度 |
|------|------|------|---------|
| `current` | ✅ | 测试时的 Skill 版本 = 当前版本，且基线版本也未变 | 无 |
| `skill_updated` | ⚠️ | Skill 在测试后有新版本，成绩反映旧版本能力 | 低——旧成绩仍可横向比较 |
| `baseline_updated` | 🔶 | 基线在测试后被修改（增/删/改用例），评分分母已变 | **高**——成绩与新基线不可比 |
| `both_updated` | ❌ | Skill 和基线都已更新 | 最高 |

### 5.2 为什么 baseline_updated 比 skill_updated 更严重

- Skill 更新后，旧版 v1 和新版 v2 在**同一基线**上的得分是可比较的，可以直接看出进步幅度。
- 基线更新后（例如从 10 题增加到 15 题，或修改了评分难度），新旧成绩的分母不同，
  数值不再具备直接对比意义。100 分制下，难题权重改变会让所有分数产生系统性偏移。

### 5.3 新鲜度计算逻辑（伪代码）

```
function computeStaleness(record, currentSkillVersion, currentBaselineVersion):
  skillStale    = record.skill_version_tested != currentSkillVersion
  baselineStale = record.baseline_version_tested != currentBaselineVersion

  if !skillStale and !baselineStale: return 'current'
  if  skillStale and !baselineStale: return 'skill_updated'
  if !skillStale and  baselineStale: return 'baseline_updated'
  return 'both_updated'
```

`currentSkillVersion` 从 `workspace/skills/.../meta.json` 读取。
`currentBaselineVersion` 从 `workspace/baselines/.../meta.json` 读取。
两者均在 `leaderboard:query` 执行时在内存中完成，**不写磁盘**。

### 5.4 Skill 或基线被修改时的用户体验

| 触发操作 | 系统行为 |
|----------|---------|
| 编辑 Skill 内容/元信息 | 下次打开 Rankings 页时，该 Skill 的旧成绩自动标注 ⚠️ |
| 编辑 Baseline（增/删/改用例） | 下次打开 Rankings 页时，涉及该 Baseline 的所有旧成绩标注 🔶 |
| 删除 Skill | 排行榜中该 Skill 的记录附加 "（已删除）" 标注，成绩仍可查看 |
| 删除 Baseline | 排行榜中该 Baseline 分组附加 "（已删除）" 标注，成绩仍可查看 |

**不做**自动删除、自动重测提示（保持简洁，由用户主动决定）。
未来 P2 可以在 Skill 编辑完成后展示一条 Snackbar：
"该 Skill 在 N 个项目中有测试记录，成绩已标注为过期"。

---

## 六、数据架构

### 6.1 数据来源

所有数据来自已有文件，无需新增存储：

```
workspace/projects/project_*/
  config.json              → baselines[].version (测试时基线版本)
  results/summary.json     → ranking[].skill_version (测试时 Skill 版本)
                           → ranking[].avg_score, score_breakdown
workspace/skills/.../meta.json    → 当前 Skill 版本
workspace/baselines/.../meta.json → 当前 Baseline 版本
```

### 6.2 查询策略

**当前规模**（< 50 个项目）：扫描式——`leaderboard:query` 时遍历所有
`workspace/projects/*/results/summary.json` 文件，内存聚合，不维护全局索引。

**预估性能**：50 个项目，每次扫描约 50 次 `readJson`，耗时 < 50ms，
对桌面应用完全可接受，无需 loading 状态。

**未来扩展点**（> 200 个项目时）：
- 维护 `workspace/leaderboard_cache.json`
- 在 `test:progress:update (projectStatus=completed)` 推送事件时增量更新缓存

### 6.3 Skill 列表的 testSummary 字段

`skill:list` 在返回每个 Skill 的基本信息时附加 `testSummary` 字段，
内容通过扫描 `workspace/projects/*/results/summary.json` 计算。

`testSummary` 字段（若无测试记录则为 `null`）：
```json
{
  "has_tests": true,
  "best_score": 87.3,
  "best_baseline_name": "Python 编程基线",
  "test_count": 5,
  "staleness": "skill_updated"
}
```

`staleness` 为所有记录中**最优**（新鲜度最好）的那条的状态，
逻辑：若有任何 `current` 记录，整体显示 `current`；
若全为 `skill_updated`，显示 `skill_updated`；以此类推。

---

## 七、实现路线图

### Phase A（必须，P0）

| 任务 | 说明 |
|------|------|
| `leaderboard-service.js` | 扫描聚合逻辑 + 新鲜度计算 |
| `ipc/leaderboard.js` | `leaderboard:query`、`leaderboard:export` 两个 handler |
| `skill-service.listSkills()` 增强 | 在返回值中附加 `testSummary` 字段 |
| Rankings 页面 HTML + CSS | 导航 Tab + 过滤栏 + 排名列表骨架 |
| Skill 列表 test badge | 渲染 + 点击跳转 |
| Test Tab 维度对比表格 | Layer 2 展开（6 维度横向比较表） |

### Phase B（重要，P1）

| 任务 | 说明 |
|------|------|
| 时间线折线图视图 | Rankings 页 toggle 切换 |
| Test Tab 用例热力图 | Layer 3 展开（per-case 得分矩阵） |
| Skill 详情 Test History 小节 | 折叠区展示历史成绩 |
| 排行榜 CSV 导出 | `leaderboard:export` 前端触发 |

### Phase C（锦上添花，P2）

| 任务 | 说明 |
|------|------|
| 编辑 Skill 后提示"X 个成绩已过期" | Snackbar 通知 |
| 基线修改影响范围预警 | 修改确认弹窗显示影响的 Project 数量 |
| Rankings 内嵌 re-test 入口 | 对过期成绩直接发起新项目测试 |

---

## 八、开放问题记录

| 问题 | 当前决策 | 备注 |
|------|---------|------|
| Skill 被删除后成绩是否保留？ | 保留，标注"已删除" | 避免数据丢失 |
| 排行榜默认展示 Latest 还是 Best？ | 展示 Best，旁标 Latest | Best 代表上限能力；Latest 体现当前状态 |
| testSummary 计算会不会拖慢 skill:list？ | 可接受，< 50 个项目时 < 30ms | 超过 200 个项目后考虑异步加载 |
| 时间线视图是否需要版本切换线？ | 需要，以竖虚线标注 v1→v2 | 帮助理解迭代效果 |

---

*（注：本文档部分内容由设计会话生成，编码实现前需人工审核确认）*
