# DEPENDENCIES.md — SkillManager 依赖清单

本项目为 Node.js / Electron 桌面应用，所有依赖通过 `npm install` 安装，无 Python 依赖。

---

## 运行时依赖（Runtime Dependencies）

| 包名 | 版本要求 | 用途 |
|------|---------|------|
| `uuid` | ^9.0.0 | 生成唯一标识符（Skill / Baseline / Project ID） |

---

## 开发时依赖（Dev Dependencies）

| 包名 | 版本要求 | 用途 |
|------|---------|------|
| `electron` | ^28.0.0 | Electron 桌面框架（主进程 + 渲染进程） |
| `electron-builder` | ^24.0.0 | 打包为 Windows .exe（NSIS 安装包） |
| `jest` | ^29.0.0 | 单元测试框架（269 个测试） |
| `@playwright/test` | ^1.58.2 | E2E 测试框架（Playwright + Electron CDP） |

---

## 外部系统依赖（External Prerequisites）

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | ≥ 18.0.0 | JavaScript 运行时（推荐 LTS，已验证 v24.13.1） |
| **npm** | ≥ 8.0.0 | 包管理器（随 Node.js 安装） |
| **Claude Code CLI** | 最新版 | `claude` 命令须在终端可用（`claude --version` 可调用） |
| **Windows** | 10 / 11 | 当前构建目标（其他平台未测试） |

### Claude Code CLI 安装

```bash
npm install -g @anthropic-ai/claude-code
```

安装后验证：

```bash
claude --version
```

---

## 锁定版本（package-lock.json）

执行 `npm install` 后，`package-lock.json` 会锁定所有传递依赖的精确版本。请将此文件纳入版本控制以确保跨环境构建的一致性。
