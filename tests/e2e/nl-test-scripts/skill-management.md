# Skill Management — 自然语言测试脚本

> **目标页面**: Skills (skill)
> **前置条件**: 工作区预置 2 个 Skill（Seed Skill Alpha: coding/anthropic，Seed Skill Beta: writing/openai）
> **说明**: 本文档描述期望的用户操作序列和断言，由 Claude agent 参考 action-reference.json 生成对应的 Playwright 测试代码。

---

## TC-001: 通过粘贴文本导入新 Skill

**目的**: 验证用户可以通过 Import 弹窗手动填写内容来创建一个新 Skill。

**步骤**:
1. 导航到 Skills 页面
2. 点击 "+ Import" 按钮，弹窗打开
3. 填写 Name: "Imported Test Skill"
4. 填写 Purpose: "testing"
5. 失去焦点（blur）—— 触发 purpose 建议检查
6. 填写 Provider: "test-corp"
7. 确保 "Text" 标签页处于激活状态
8. 填写 Content: "This is the test skill content for automated testing."
9. 点击 "Import" 确认按钮

**断言**:
- 成功通知出现（绿色 toast）
- "Imported Test Skill" 出现在列表中

---

## TC-002: 预置 Skill 显示在列表中

**目的**: 验证工作区预置的 Skill 在页面加载后正确显示。

**步骤**:
1. 导航到 Skills 页面（或已在该页面）

**断言**:
- "Seed Skill Alpha" 出现在列表中
- "Seed Skill Beta" 出现在列表中

---

## TC-003: 点击 Skill 显示详情面板

**目的**: 验证点击列表项后右侧详情面板展开并显示正确名称。

**步骤**:
1. 点击列表中的 "Seed Skill Alpha"

**断言**:
- 详情面板可见（不再显示空状态）
- 详情面板标题为 "Seed Skill Alpha"

---

## TC-004: 编辑 Skill 内容产生新版本

**目的**: 验证编辑 Skill 内容后，版本号递增并显示在历史面板中。

**步骤**:
1. 点击列表中的 "Seed Skill Alpha"（确保已选中）
2. 点击 "Edit" 按钮，编辑弹窗打开
3. 将 Content 修改为: "Updated content after automated edit."
4. 点击 "Save" 确认

**断言**:
- 成功通知出现
- 右侧版本历史面板中出现 "v2" 标记

---

## TC-005: 添加手动标签显示在详情中

**目的**: 验证用户可以为 Skill 添加自定义标签，标签立即显示在详情中。

**步骤**:
1. 点击列表中的 "Seed Skill Alpha"（已选中状态）
2. 点击 "+ Add" 标签按钮，弹窗打开
3. 输入标签值: "my-auto-test-tag"
4. 点击 "Confirm"

**断言**:
- 成功通知出现
- 详情区域中出现带有 "my-auto-test-tag" 文字的标签元素

---

## TC-006: 关键词搜索过滤技能列表

**目的**: 验证搜索框输入关键词后，列表只显示匹配项。

**步骤**:
1. 在搜索框中输入 "Beta"
2. 等待去抖延迟（~450ms）

**断言**:
- "Seed Skill Beta" 出现在列表中
- "Seed Skill Alpha" 不在列表中

**清理**:
- 清空搜索框（输入空字符串）以恢复全量列表

---

## TC-007: 版本回滚产生新版本号

**目的**: 验证在版本历史中点击 "Restore" 按钮，会创建一个新版本（而不是覆盖历史）。

**前置条件**: TC-004 已执行，"Seed Skill Alpha" 已有 v1 和 v2 两个版本。

**步骤**:
1. 点击列表中的 "Seed Skill Alpha"
2. 在右侧版本历史面板中，找到 v1 对应的 "Restore" 按钮，点击

**断言**:
- 成功通知出现（显示恢复相关消息）
- 版本历史中出现新版本（v3）

---

## TC-008: 删除 Skill 后从列表移除

**目的**: 验证删除操作完成后，该 Skill 不再出现在列表中。

**前置条件**: "Imported Test Skill" 已导入（来自 TC-001）。

**步骤**:
1. 点击列表中的 "Imported Test Skill"
2. 处理 window.confirm 确认对话框（点击确定）
3. 点击 "Delete" 按钮

**断言**:
- "Imported Test Skill" 不再出现在列表中

---

## TC-009: 自动打标签（需要 CLI，跳过）

**目的**: 验证点击 Auto-Tag 按钮后触发后台打标签任务。

> **状态**: `test.skip` — 需要真实 Claude CLI 和 API Key，不在 CI 中运行。

**步骤**:
1. 选中任意 Skill
2. 点击 "Auto-Tag" 按钮

**断言**:
- 出现 "Auto-tagging started" 相关的通知

---

## 测试执行顺序说明

测试按 TC-001 到 TC-008 顺序执行（`workers: 1`，串行）。
TC-004、TC-005、TC-007 依赖 TC-003 中选中的 "Seed Skill Alpha"，因此在同一 `beforeAll` 上下文中连续执行。
TC-006 执行搜索后必须清空搜索框，以免影响后续测试的列表状态。
TC-008 依赖 TC-001 导入的 "Imported Test Skill"，放在最后执行以免影响其他测试。
