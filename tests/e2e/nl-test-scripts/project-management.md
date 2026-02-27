# Project Management — 自然语言测试脚本

> **目标页面**: Projects (project)
> **前置条件**: 工作区预置 1 个 Skill（Proj Skill Alpha: coding/anthropic）+ 1 个 Baseline（Proj Baseline Alpha: coding/internal 2 cases）
> **说明**: 本文档描述期望的用户操作序列和断言，由 Claude agent 参考 action-reference.json 生成对应的 Playwright 测试代码。

---

## TC-P-001: 创建项目并出现在列表中

**目的**: 验证用户通过创建弹窗可以成功创建一个新项目。

**步骤**:
1. 导航到 Projects 页面
2. 点击 "+ Create" 按钮，弹窗打开
3. 填写 Project Name: "E2E Test Project"
4. 在 Skills 多选框中选中所有可用 Skill
5. 在 Baselines 多选框中选中所有可用 Baseline
6. 点击 "Create Project" 确认按钮

**断言**:
- 成功通知出现
- "E2E Test Project" 出现在列表中

---

## TC-P-002: 点击项目显示详情面板

**目的**: 验证点击列表项后右侧详情面板展开并显示正确名称。

**步骤**:
1. 点击列表中的 "E2E Test Project"

**断言**:
- 详情面板可见（不再显示空状态）
- 详情面板标题为 "E2E Test Project"

---

## TC-P-003: 切换所有 5 个标签页

**目的**: 验证项目详情中的 5 个标签页（Overview / Test / Analysis / Recompose / Iteration）均可正常切换。

**前置条件**: "E2E Test Project" 已选中，详情面板可见。

**步骤**:
1. 点击 "Test" 标签
2. 点击 "Analysis" 标签
3. 点击 "Recompose" 标签
4. 点击 "Iteration" 标签
5. 点击 "Overview" 标签（恢复初始状态）

**断言** (每次切换后):
- 对应标签的内容面板可见（`#ptab-<name>` 可见）

---

## TC-P-004: 删除项目后从列表移除

**目的**: 验证删除操作完成后，该 Project 不再出现在列表中。

**前置条件**: "E2E Test Project" 已在列表中（来自 TC-P-001）。

**步骤**:
1. 点击列表中的 "E2E Test Project"
2. 处理 window.confirm 确认对话框（点击确定）
3. 点击 "Delete" 按钮

**断言**:
- "E2E Test Project" 不再出现在列表中

---

## TC-P-005: 启动测试（需要 CLI，跳过）

**目的**: 验证点击 Start 按钮后后台测试任务被触发。

> **状态**: `test.skip` — 需要真实 Claude CLI 和 API Key，不在 CI 中运行。

**步骤**:
1. 选中已创建的项目
2. 切换到 "Test" 标签
3. 点击 "Start" 按钮

**断言**:
- 出现 "Test started" 相关的通知

---

## 测试执行顺序说明

测试按 TC-P-001 到 TC-P-004 顺序执行（`workers: 1`，串行）。
TC-P-001 创建的 "E2E Test Project" 被 TC-P-002、TC-P-003、TC-P-004 共同使用。
TC-P-004 (删除) 必须放在最后，以免影响前三个测试的状态。
