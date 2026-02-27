# Baseline Management — 自然语言测试脚本

> **目标页面**: Baselines (baseline)
> **前置条件**: 工作区预置 2 个 Baseline（Seed Baseline Alpha: coding/internal 3 cases，Seed Baseline Beta: writing/external 2 cases）
> **说明**: 本文档描述期望的用户操作序列和断言，由 Claude agent 参考 action-reference.json 生成对应的 Playwright 测试代码。

---

## TC-B-001: 预置 Baseline 显示在列表中

**目的**: 验证工作区预置的 Baseline 在页面加载后正确显示。

**步骤**:
1. 导航到 Baselines 页面（或已在该页面）

**断言**:
- "Seed Baseline Alpha" 出现在列表中
- "Seed Baseline Beta" 出现在列表中

---

## TC-B-002: 点击 Baseline 显示详情面板

**目的**: 验证点击列表项后右侧详情面板展开并显示正确名称。

**步骤**:
1. 点击列表中的 "Seed Baseline Alpha"

**断言**:
- 详情面板可见（不再显示空状态）
- 详情面板标题为 "Seed Baseline Alpha"

---

## TC-B-003: 通过 Manual 标签导入 Baseline

**目的**: 验证用户可以通过 Import 弹窗的 Manual 标签手动创建一个新 Baseline（无用例）。

**步骤**:
1. 点击 "+ Import" 按钮，弹窗打开
2. 确保 "Manual" 标签页处于激活状态
3. 填写 Name: "Imported Test Baseline"
4. 填写 Purpose: "testing"
5. 填写 Provider: "test-corp"
6. 点击 "Import" 确认按钮

**断言**:
- 成功通知出现（提示 "0 cases"）
- "Imported Test Baseline" 出现在列表中

---

## TC-B-004: 关键词搜索过滤 Baseline 列表

**目的**: 验证搜索框输入关键词后，列表只显示匹配项。

**步骤**:
1. 在搜索框中输入 "Beta"
2. 等待去抖延迟（~450ms）

**断言**:
- "Seed Baseline Beta" 出现在列表中
- "Seed Baseline Alpha" 不在列表中

**清理**:
- 清空搜索框（输入空字符串）以恢复全量列表

---

## TC-B-005: 版本回滚产生新版本号

**目的**: 验证在版本历史中点击 "Restore" 按钮，会创建一个新版本。

**步骤**:
1. 点击列表中的 "Seed Baseline Beta"
2. 点击 "+ Add Case" 按钮 — 弹出 3 个 prompt 对话框
   - 输入 Case name: "Rollback Test Case"
   - 输入 Category: "standard"
   - 输入 Input: "rollback test input"
3. 等待成功通知（v2 已创建）

**断言** (中间状态):
- 版本历史中出现 "v2"

**步骤** (继续):
4. 在右侧版本历史面板中，找到 v1 对应的 "Restore" 按钮，点击

**断言**:
- 成功通知出现
- 版本历史中出现 "v3"

---

## TC-B-006: 删除用例后用例数量减少

**目的**: 验证删除单个 Test Case 后详情面板中的用例计数立即更新。

**前置条件**: "Seed Baseline Alpha" 已预置 3 个用例。

**步骤**:
1. 点击列表中的 "Seed Baseline Alpha"
2. 确认详情面板显示 "Test Cases (3)"
3. 处理 window.confirm 确认对话框（点击确定）
4. 点击用例表格中第一行的 "Del" 按钮

**断言**:
- 成功通知出现
- 详情面板显示 "Test Cases (2)"

---

## TC-B-007: 自动打标签（需要 CLI，跳过）

**目的**: 验证点击 Auto-Tag 按钮后触发后台打标签任务。

> **状态**: `test.skip` — 需要真实 Claude CLI 和 API Key，不在 CI 中运行。

**步骤**:
1. 选中任意 Baseline
2. 点击 "Auto-Tag" 按钮

**断言**:
- 出现 "Auto-tagging" 相关的通知

---

## 测试执行顺序说明

测试按 TC-B-001 到 TC-B-006 顺序执行（`workers: 1`，串行）。
TC-B-005 在同一测试内先添加用例（创建 v2）再回滚（创建 v3），完全自包含。
TC-B-006 依赖预置的 3 个用例，放在 TC-B-005 之后执行（避免 Beta 的对话框干扰）。
TC-B-003 导入的 "Imported Test Baseline" 不被后续测试引用，无依赖问题。
