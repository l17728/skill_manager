# INSTALL.md — SkillManager 安装手册

## 目录

1. [环境要求](#1-环境要求)
2. [安装 Node.js](#2-安装-nodejs)
3. [安装 Claude Code CLI](#3-安装-claude-code-cli)
4. [获取代码并安装依赖](#4-获取代码并安装依赖)
5. [启动应用](#5-启动应用)
6. [打包为独立安装包](#6-打包为独立安装包)
7. [运行测试](#7-运行测试)
8. [故障排查](#8-故障排查)

---

## 1. 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 / Windows 11（64 位） |
| Node.js | ≥ 18.0.0（推荐最新 LTS） |
| npm | ≥ 8.0.0（随 Node.js 附带） |
| Claude Code CLI | 最新版，`claude` 命令须在 PATH 中可调用 |
| 磁盘空间 | ≥ 500 MB（含 node_modules） |

---

## 2. 安装 Node.js

### 方式 A：官网安装包（推荐）

1. 访问 [https://nodejs.org](https://nodejs.org)，下载 **LTS** 版本（.msi）
2. 运行安装包，保持默认选项（勾选 "Add to PATH"）
3. 打开新终端，验证安装：

```bash
node --version   # 应输出 v18.x.x 或更高
npm --version    # 应输出 8.x.x 或更高
```

### 方式 B：winget

```powershell
winget install OpenJS.NodeJS.LTS
```

---

## 3. 安装 Claude Code CLI

SkillManager 通过 `claude` 子进程调用 Claude 模型，**必须**在系统中安装 Claude Code CLI。

```bash
npm install -g @anthropic-ai/claude-code
```

安装后验证：

```bash
claude --version
```

> **注意**：首次使用 Claude Code CLI 需要完成 Anthropic 账户授权（`claude auth login`）。
> SkillManager 的对比测试、自动打标、差异分析等功能依赖 CLI 调用，未授权时这些功能无法执行，
> 但资产管理（导入/编辑 Skill 和 Baseline）功能可正常使用。

---

## 4. 获取代码并安装依赖

```bash
# 克隆仓库
git clone https://github.com/l17728/skill_manager.git
cd skill_manager

# 安装 npm 依赖
npm install
```

`npm install` 会安装以下依赖：

- **运行时**：`uuid`（唯一 ID 生成）
- **框架**：`electron`（桌面框架）、`electron-builder`（打包工具）
- **测试**：`jest`（单元测试）、`@playwright/test`（E2E 测试）

安装完成后 `node_modules/` 约 300–400 MB。

---

## 5. 启动应用

### 开发模式（含 DevTools）

```bash
npm run dev
```

DevTools 会随应用自动打开，可在控制台查看日志。

### 生产模式

```bash
npm start
```

### 首次启动说明

- 应用启动时自动在项目根目录下创建 `workspace/` 目录（无需手动创建）
- `workspace/` 存储所有 Skill / Baseline / Project 数据，不纳入版本控制
- 所有数据以纯文件（JSON / 纯文本）形式存储，无需数据库

---

## 6. 打包为独立安装包

```bash
npm run build
```

输出目录：`dist/`

| 产物 | 说明 |
|------|------|
| `dist/SkillManager Setup x.x.x.exe` | NSIS 安装包（可分发给最终用户） |
| `dist/win-unpacked/` | 解压版本（无需安装直接运行） |

> **要求**：打包机器须已完成 `npm install`。打包后的 .exe 不需要目标机器安装 Node.js，
> 但**仍需要** Claude Code CLI（`claude` 命令）可用。

---

## 7. 运行测试

```bash
# 运行全部 269 个单元测试
npm test

# 运行单个测试文件
npx jest tests/unit/skill-service.test.js

# 按测试名称过滤
npx jest --testNamePattern="UC1-1"

# 覆盖率报告（输出到 coverage/）
npm run test:coverage

# E2E 测试（需端口 9222 空闲，应用不得已在运行）
npm run test:e2e
```

### E2E 测试前置条件

- 端口 **9222** 未被占用
- 应用未在运行（E2E 测试会自己启动独立 Electron 实例）
- `npm install` 已完成（包含 Playwright 和 Electron）

首次运行 E2E 测试前，Playwright 可能需要下载浏览器驱动：

```bash
npx playwright install chromium
```

---

## 8. 故障排查

### 启动时报 `Cannot find module 'electron'`

依赖未安装，执行：

```bash
npm install
```

### `claude` 命令不存在（ENOENT）

Claude Code CLI 未安装或不在 PATH：

```bash
npm install -g @anthropic-ai/claude-code
```

安装后重新打开终端再启动应用。

### `claude` 命令存在但测试失败（timeout / API error）

1. 确认已完成 Claude Code 授权：`claude auth login`
2. 确认网络可访问 Anthropic API
3. 检查 `workspace/logs/` 下最新的 `.jsonl` 日志文件

### E2E 测试报错 `connect ECONNREFUSED localhost:9222`

端口 9222 未就绪，通常是 Electron 启动过慢。可在 `tests/e2e/helpers/app-launcher.js` 中适当增加等待超时。

### Windows 上 `electron-builder` 打包失败

确保以**管理员身份**运行终端，或检查是否有防病毒软件拦截打包过程。

### `workspace/` 数据损坏或需要重置

直接删除 `workspace/` 目录，下次启动时应用会自动重新初始化：

```bash
rm -rf workspace/
```

> **警告**：此操作会删除所有 Skill / Baseline / Project 数据，请先备份。
