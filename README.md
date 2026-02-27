# SkillManager — 提示词 & Skill 对比验证与优势重组平台

面向提示词工程师 / Agent 开发者的本地桌面工作台，自动化完成：

**管理 → 测试 → 对比 → 分析 → 重组 → 迭代 → 定稿**

---

## 核心功能

### 资产管理
- **Skill / Agent 管理**：文本粘贴或文件导入（.txt / .md / .json），支持 `type: skill | agent` 区分，彩色 badge 标识
- **测试基线管理**：用例集合的创建、编辑、版本管理
- **版本控制**：每次编辑自动生成 diff 历史，支持一键回滚到任意版本
- **标签系统**：手动标签 + AI 自动打标（`pending → approved | rejected` 审核流）
- **全局搜索**：跨 Skill / Baseline 关键词检索

### 对比测试
- 在同一项目中将多个 Skill 与同一批测试用例对比运行
- 6 维度 100 分制自动评分：功能正确性 (30) · 健壮性 (20) · 可读性 (15) · 简洁性 (15) · 复杂度控制 (10) · 格式规范 (10)
- 支持暂停 / 恢复 / 中止，按检查点断点续跑

### 差异分析
- 自动提取各 Skill 的优势片段（`role / constraint / format / instruction / example`）
- 识别维度领先者、问题片段
- 结果写入 `analysis_report.json`，可导出

### 优势重组（Skill Recomposition）
- 从分析报告中勾选优势片段，设置保留规则
- 调用 Claude CLI 融合生成新提示词，实时预览
- 保存为新 Skill，附带完整溯源信息（`provenance.json`）

### AEIO 迭代优化引擎
三种模式可选：

| 模式 | Beam Width | 说明 |
|------|-----------|------|
| **Standard** | 1 | 线性重组→测试→分析循环 |
| **Explore** | 2 | 每轮并行生成 2 个候选，择优进入下一轮 |
| **Adaptive** | 2 | Explore 基础上加激进平台期逃逸策略 |

策略轮换：`GREEDY → DIMENSION_FOCUS → SEGMENT_EXPLORE → CROSS_POLLINATE → RANDOM_SUBSET`

完成后输出迭代报告（每轮得分、最优版本）与 Beam 探索日志。

---

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Claude Code CLI**（`claude` 命令可在终端调用）
- Windows 10/11（当前构建目标）

### 安装

```bash
git clone https://github.com/l17728/skill_manager.git
cd skill_manager
npm install
```

### 启动

```bash
npm run dev      # 开发模式（含 DevTools）
npm start        # 生产模式
```

### 打包为 .exe

```bash
npm run build    # 输出到 dist/
```

---

## 工作流示例

```
1. 导入 3 个功能相近的 Python 代码生成 Skill
2. 创建测试基线（10 个典型 Python 编程任务）
3. 新建项目，选择 3 个 Skill + 该基线
4. 运行对比测试 → 查看排名与维度得分
5. 运行差异分析 → 识别每个 Skill 的优势片段
6. 重组：保留功能正确性最高 Skill 的角色设定，融合健壮性最强 Skill 的约束条件
7. 启动 Explore 模式迭代 3 轮 → 得到最优重组版本
8. 将迭代冠军版本保存为新 Skill，投入生产
```

---

## 开发

```bash
npm test                                        # 运行全部 269 个单元测试
npx jest tests/unit/iteration-service.test.js  # 运行单个测试文件
npx jest --testNamePattern="UC9-1"             # 按名称过滤
npm run test:e2e                               # Playwright E2E 测试（需端口 9222 空闲）
npm run test:coverage                          # 覆盖率报告
```

所有数据以纯文件形式存储于 `workspace/`（运行时自动创建，不纳入版本控制）。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 28 |
| 主进程 | Node.js |
| 渲染层 | 原生 HTML / CSS / JS（无框架） |
| 模型调用 | Claude Code CLI 子进程（非直接 API） |
| 数据存储 | 纯文件（JSON / 纯文本），无数据库 |
| 单元测试 | Jest 29 |
| E2E 测试 | Playwright + Electron CDP |
| 打包 | electron-builder (NSIS) |

---

## 项目结构

```
main/
  ipc/          # IPC 处理层（每模块一文件）
  services/     # 业务逻辑（纯 Node.js，无 Electron 依赖）
renderer/
  index.html    # 三页布局：Skills & Agents / Baselines / Projects
  css/          # 深色主题
  js/pages/     # skill.js / baseline.js / project.js
tests/
  unit/         # Jest 单元测试（269 个）
  e2e/          # Playwright E2E 测试（27 个）
docs/
  spec.md       # 51 个 TDD 验收用例
  schema.md     # 所有 JSON 文件 schema
  ipc-api.md    # 所有 IPC 通道契约
  cli-spec.md   # CLI 调用规范与提示词模板
```

---

## License

MIT
