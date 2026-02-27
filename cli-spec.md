# Claude Code CLI 调用规范文档

本文档定义平台与 Claude Code CLI（`claude` 命令）的全部交互规范，包括调用方式、会话管理、各场景 Prompt 模板及错误处理策略，供模块4、5、6、7、8、9 的开发直接使用。

---

# 一、基础调用规范

## 1.1 核心调用模式

平台所有 CLI 调用均使用**非交互（Print）模式**，通过 Node.js `child_process.spawn` 以子进程方式执行：

```
claude [flags] "<prompt>"
```

| 常用参数 | 说明 |
|---|---|
| `-p` / `--print` | 非交互模式，输出结果后退出 |
| `--model <model>` | 指定模型，如 `claude-opus-4-6` |
| `--output-format json` | 以 JSON 格式返回完整响应（含 session_id、耗时等元数据） |
| `--system-prompt "<prompt>"` | 指定系统提示词（用于测试执行场景） |
| `-c` / `--continue` | 继续最近一次会话（用于上下文压缩场景） |
| `--resume <session_id>` | 恢复指定 session_id 的会话 |

> **注意**：执行前需通过 `cli:checkAvailable` 接口验证 `claude` 命令可用，并记录当前 CLI 版本（`claude --version`）用于结果溯源。

## 1.2 Node.js 子进程调用封装

```javascript
const { spawn } = require('child_process')

// On Windows, npm-global CLIs are installed as .cmd files.
// Node.js spawn without a shell does NOT resolve PATHEXT (.cmd/.bat), so
// 'claude' fails with ENOENT.  shell:true lets cmd.exe resolve it, exactly
// as if the user typed 'claude' at the terminal prompt.
const SPAWN_SHELL = process.platform === 'win32'

/**
 * 执行单次 CLI 调用（Print 模式）
 * @param {string} prompt - 用户消息内容（通过 stdin 传入，非命令行参数）
 * @param {object} options
 * @param {string} [options.model] - 模型版本，默认读取 cli/config.json
 * @param {string} [options.systemPrompt] - 系统提示词
 * @param {string} [options.workingDir] - 工作目录（影响会话隔离）
 * @param {number} [options.timeoutMs] - 超时毫秒数，默认 60000
 * @returns {Promise<CliResult>}
 */
function invokeCli(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const cfg = getCliConfig()
    const model = options.model || cfg.default_model
    const timeoutMs = options.timeoutMs || cfg.default_timeout_seconds * 1000
    const cliPath = cfg.cli_path || 'claude'

    // Prompt is sent via stdin, NOT as a positional arg.
    // This avoids the Windows CreateProcess command-line length limit (~32 KB)
    // and handles all special characters / newlines correctly.
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', model,
      '--dangerously-skip-permissions',  // required: non-TTY Electron spawn cannot respond to permission prompts
    ]
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }

    // Strip CLAUDECODE to allow spawning claude from within a Claude Code session.
    // Claude Code sets CLAUDECODE in its env; child processes that inherit it
    // are refused: "Cannot be launched inside another Claude Code session".
    const spawnEnv = Object.assign({}, process.env)
    delete spawnEnv.CLAUDECODE

    // NOTE: do NOT use spawn's `timeout` option — on Node 18 it does NOT kill
    // the child process when it fires.  Use a manual setTimeout + proc.kill() instead.
    const proc = spawn(cliPath, args, {
      cwd: options.workingDir || process.cwd(),
      env: spawnEnv,
      shell: SPAWN_SHELL,
    })

    // Write prompt to stdin, then close — claude reads until EOF and starts processing
    proc.stdin.on('error', () => {})  // suppress EPIPE if process dies early
    proc.stdin.write(prompt, 'utf8')
    proc.stdin.end()

    let stdout = '', stderr = '', timedOut = false, settled = false
    function settle(fn) {
      if (!settled) { settled = true; clearTimeout(timer); fn() }
    }

    // Manual timeout: fire SIGTERM, then the 'close' event below rejects with CLI_TIMEOUT
    const timer = setTimeout(() => {
      timedOut = true
      try { proc.kill('SIGTERM') } catch (_) {}
    }, timeoutMs)

    proc.stdout.on('data', (chunk) => { stdout += chunk })
    proc.stderr.on('data', (chunk) => { stderr += chunk })

    proc.on('close', (code) => {
      settle(() => {
        if (timedOut) {
          reject({ code: 'CLI_TIMEOUT' })
          return
        }
        if (code !== 0) {
          reject({ code: 'CLI_EXECUTION_ERROR', stderr, exitCode: code })
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          resolve(parsed)
        } catch {
          reject({ code: 'CLI_OUTPUT_PARSE_ERROR', raw: stdout })
        }
      })
    })

    proc.on('error', (err) => {
      settle(() => {
        if (err.code === 'ENOENT') reject({ code: 'CLI_NOT_AVAILABLE' })
        else reject({ code: 'CLI_EXECUTION_ERROR', message: err.message })
      })
    })
  })
}
```

## 1.3 `--output-format json` 响应结构

使用 `--output-format json` 时，CLI 输出为以下 JSON 结构：

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 3840,
  "session_id": "sess_abc123",
  "result": "这里是模型的实际回复文本内容",
  "cost_usd": 0.0042
}
```

| 字段 | 说明 |
|---|---|
| `result` | 模型实际输出内容，所有场景均从此字段取值 |
| `session_id` | 会话 ID，用于 `--resume` 继续会话（上下文压缩场景使用） |
| `is_error` | `true` 时表示模型层错误（如拒绝回答），与进程退出码不同 |
| `duration_ms` | CLI 执行耗时，记录到测试结果的 `duration_ms` |

## 1.4 会话隔离策略

| 场景 | 会话策略 | 工作目录 |
|---|---|---|
| 自动打标签 | 每次调用独立（Print 模式无会话） | `workspace/cli/temp_session/` |
| 测试执行 | 每个 Skill 独立的项目会话 | `workspace/projects/{project}/` |
| 差异分析 / 重组 / 迭代 | 每次独立 Print 调用（无需持续会话） | `workspace/projects/{project}/` |
| 上下文压缩 | 使用 `--resume` 继续已有会话 | 原会话工作目录 |
| 基线生成 | 独立临时会话 | `workspace/cli/temp_session/` |

---

# 二、输出解析规范

## 2.1 结构化输出约定

所有需要结构化数据的场景（打标签、评分、分析、重组），Prompt 末尾统一添加以下约束：

```
【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字、解释或 Markdown 代码块标记
2. 确保 JSON 格式合法，可被直接解析
3. 所有字符串值使用双引号
```

## 2.2 结构化输出解析流程

```javascript
function parseStructuredOutput(rawResult) {
  // 1. 直接尝试 JSON.parse
  try {
    return JSON.parse(rawResult)
  } catch {}

  // 2. 提取 ```json ... ``` 代码块内容（模型偶尔仍会添加）
  const codeBlockMatch = rawResult.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch {}
  }

  // 3. 提取第一个 { 到最后一个 } 之间的内容
  const jsonMatch = rawResult.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]) } catch {}
  }

  // 4. 解析彻底失败：记录原始输出，标记为解析失败
  throw { code: 'OUTPUT_PARSE_FAILED', raw: rawResult }
}
```

## 2.3 解析失败处理策略

| 场景 | 失败处理 |
|---|---|
| 自动打标签 | 将 `raw_output` 保存到 `auto_tag_log`，`parsed_tags` 置为空数组，标记 `status: failed`，支持重试 |
| 测试执行 | 保存原始输出，本条结果标记 `status: failed`，不中断整体任务 |
| 评分 | 重试1次；仍失败则该条结果评分字段置 `null`，标记解析失败 |
| 差异分析 / 重组 | 重试1次；仍失败则通知前端，显示原始输出供人工处理 |

---

# 三、场景1：自动打标签

## 3.1 调用方式

```
模式：--print（无会话）
模型：使用 cli/config.json 中的 default_model
超时：60,000 ms（实际 Claude API 调用通常需要 15-25 秒；10s 超时会大概率失败）
重试：失败后重试1次
```

## 3.2 Skill / Agent 自动打标签 Prompt

```
请分析以下 Skill/Agent 的提示词内容，为其生成用于分类和检索的标签。

【提示词内容】
{skill_content}

【打标签要求】
- 生成 3～8 个标签，每个标签 2～8 个字
- 覆盖以下维度（按适用性选择，不必全覆盖）：
  * 功能类型（如：代码生成、代码审查、文档撰写）
  * 适用场景（如：函数实现、错误修复、性能优化）
  * 编程语言（如：Python、JavaScript、Java，仅在内容明确指定时添加）
  * 代码阶段（如：需求分析、架构设计、单元测试、代码重构）
  * 输出特征（如：含示例、含注释、带类型注解）
- 不要生成过于宽泛的标签（如"AI助手"、"编程"）

【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字、解释或 Markdown 代码块标记
2. 确保 JSON 格式合法，可被直接解析

【返回格式】
{"tags": ["标签1", "标签2", "标签3"]}
```

**变量替换**：`{skill_content}` → `content.txt` 的完整内容

## 3.3 测试基线自动打标签 Prompt

```
请分析以下测试基线的用例内容，为其生成用于分类和检索的标签。

【基线名称】
{baseline_name}

【测试用例摘要（前5条）】
{cases_summary}

【打标签要求】
- 生成 3～6 个标签
- 覆盖以下维度（按适用性选择）：
  * 测试场景（如：边界测试、异常测试、性能测试）
  * 代码难度（如：基础、进阶、复杂）
  * 测试目标功能（如：排序算法、文件IO、网络请求）
  * 适配语言（如：Python专项、多语言通用）

【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字、解释或 Markdown 代码块标记

【返回格式】
{"tags": ["标签1", "标签2"]}
```

**变量替换**：
- `{baseline_name}` → `meta.json` 中的 `name`
- `{cases_summary}` → `cases.json` 中前5条用例的 `name + input`（各不超过100字）

---

# 四、场景2：测试执行

## 4.1 调用方式

```
模式：--print + --system-prompt（每条用例独立调用，无需会话连续性）
模型：project/config.json 中的 cli_config.model
超时：project/config.json 中的 cli_config.timeout_seconds × 1000 ms
重试：失败后按 cli_config.retry_count 重试
工作目录：workspace/projects/{project_dir}/
```

## 4.2 调用命令构造

```javascript
// 测试执行的调用参数构造
const args = [
  '--print',
  '--output-format', 'json',
  '--model', project.cli_config.model,
  '--system-prompt', skillContent,   // Skill 提示词作为系统提示词
  testCase.input,                    // 测试用例输入作为用户消息
  ...project.cli_config.extra_flags,
]
```

> 若 `--system-prompt` 参数在当前 CLI 版本不可用，改用以下用户消息格式：

```
【角色设定与任务要求】
{skill_content}

---

【当前任务】
{test_input}
```

## 4.3 执行结果记录

CLI 调用完成后，将以下字段写入 `results/{skill_short_id}_v{n}/{case_id}.json`：

```javascript
{
  actual_output: cliResponse.result,          // CLI 返回的 result 字段
  duration_ms:   cliResponse.duration_ms,     // CLI 自带耗时
  cli_version:   await getCliVersion(),       // claude --version 的结果
  model_version: project.cli_config.model,
  status:        'completed',
  error:         null,
}
```

---

# 五、场景3：结果评分

## 5.1 调用方式

```
模式：--print（无会话，每条测试结果独立评分）
模型：使用 cli/config.json 中的 default_model（与测试执行解耦）
超时：30,000 ms
重试：解析失败后重试1次
```

## 5.2 评分 Prompt 模板

```
你是一位专业的代码质量评审专家。请根据以下评判标准，对代码生成结果进行客观评分。

【测试输入】
{test_input}

【期望输出描述】
{expected_output}

【实际输出】
{actual_output}

【评判标准（满分100分）】
请严格按照以下6个维度逐一评分：

1. 功能正确性（0-30分）
   - 代码是否准确实现了测试输入中的需求
   - 核心算法逻辑是否正确
   - 是否满足期望输出中的关键要求

2. 健壮性（0-20分）
   - 异常情况是否有捕获和处理
   - 边界条件（空值、极大值、非法输入等）是否覆盖
   - 是否有防止程序崩溃的保护机制

3. 代码可读性（0-15分）
   - 变量名、函数名是否语义清晰
   - 代码结构是否层次分明，逻辑易于理解
   - 是否有必要的注释（不要求过度注释）

4. 代码简洁性（0-15分）
   - 是否存在冗余代码、重复逻辑
   - 实现是否精炼，表达是否高效

5. 复杂度控制（0-10分）
   - 是否避免了不必要的嵌套和复杂度
   - 函数/模块是否有合理拆分

6. 格式规范性（0-10分）
   - 是否符合该编程语言的通行编码规范（如PEP8/ESLint等）
   - 缩进、换行、空格等格式是否规范

【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字、解释或 Markdown 代码块标记
2. 确保 JSON 格式合法，total 字段必须等于六项之和

【返回格式】
{
  "scores": {
    "functional_correctness": <0-30的整数>,
    "robustness": <0-20的整数>,
    "readability": <0-15的整数>,
    "conciseness": <0-15的整数>,
    "complexity_control": <0-10的整数>,
    "format_compliance": <0-10的整数>,
    "total": <以上六项之和>
  },
  "reasoning": "<各维度评分的简要理由，总计100-200字，格式：维度名(得分/满分)：理由；...>"
}
```

**变量替换**：
- `{test_input}` → `cases.json` 中对应用例的 `input`
- `{expected_output}` → `cases.json` 中对应用例的 `expected_output`
- `{actual_output}` → 上一步测试执行的 `actual_output`

---

# 六、场景4：差异分析与优势片段提取

## 6.1 调用方式

```
模式：--print（单次调用，输入为全部 Skill 的汇总测试结果）
模型：使用 default_model
超时：60,000 ms（输入较长）
重试：失败后重试1次
```

## 6.2 差异分析 Prompt 模板

```
你是一位专业的代码生成 Prompt 工程师。请对以下多个 Skill 的测试结果进行横向对比分析，
识别各 Skill 的优势片段与不足，生成结构化分析报告。

【测试基线描述】
基线名称：{baseline_name}
用例数量：{case_count}条
用例类型分布：标准用例{standard_count}条、边界用例{boundary_count}条、异常用例{exception_count}条

【各 Skill 评分汇总】
{skills_score_summary}

【各维度得分明细】
{dimension_scores_table}

【典型用例对比（得分差异最大的3条用例）】
{top_diff_cases}

【分析要求】
1. 判断综合表现最优的 Skill（best_skill_id）
2. 识别每个评分维度的领先 Skill（dimension_leaders）
3. 从 Skill 提示词中提取至少3个具体的优势片段（advantage_segments），
   每个片段需标注：所属 Skill、片段类型、原文内容、表现突出的维度及理由
   片段类型枚举：instruction（指令结构）| constraint（约束条件）| format（输出格式）| role（角色设定）| example（示例）
4. 列出各 Skill 在某维度上的具体不足（issues）

【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字或 Markdown 代码块标记

【返回格式】
{
  "best_skill_id": "skill的UUID",
  "best_skill_name": "Skill名称",
  "dimension_leaders": {
    "functional_correctness": "skill的UUID",
    "robustness": "skill的UUID",
    "readability": "skill的UUID",
    "conciseness": "skill的UUID",
    "complexity_control": "skill的UUID",
    "format_compliance": "skill的UUID"
  },
  "advantage_segments": [
    {
      "id": "seg_001",
      "skill_id": "skill的UUID",
      "skill_name": "Skill名称",
      "type": "role|instruction|constraint|format|example",
      "content": "从Skill提示词中提取的原文片段",
      "reason": "该片段为何在对应维度表现突出",
      "dimension": "对应的评分维度key"
    }
  ],
  "issues": [
    {
      "skill_id": "skill的UUID",
      "skill_name": "Skill名称",
      "dimension": "评分维度key",
      "description": "具体不足描述"
    }
  ]
}
```

**变量替换说明**：

`{skills_score_summary}` 格式示例：
```
- Skill A（ID: a1b2c3d4）：平均总分 85.3，完成 10/10 条
- Skill B（ID: d4e5f6a7）：平均总分 79.2，完成 9/10 条（1条失败）
```

`{dimension_scores_table}` 格式示例：
```
维度          | Skill A | Skill B
功能正确性(30) | 27.5    | 24.1
健壮性(20)    | 16.8    | 18.3
...
```

`{top_diff_cases}` 格式示例（选取各 Skill 得分差异 ≥10 的用例）：
```
用例 case_002「超长输入边界测试」：
  Skill A 输出：{actual_output_A}（总分82）
  Skill B 输出：{actual_output_B}（总分91）
```

---

# 七、场景5：Skill 优势重组

## 7.1 调用方式

```
模式：--print（单次调用）
模型：使用 default_model
超时：60,000 ms
重试：失败后重试1次（重组结果允许人工编辑，失败成本低）
```

## 7.2 重组 Prompt 模板

```
你是一位专业的 Prompt 工程师。请根据以下多个 Skill 的优势片段和用户指定的保留规则，
融合生成一个更优秀的 Skill 提示词。

【来源 Skill 信息】
{source_skills_info}

【用户指定保留的优势片段】
{selected_segments}

【用户保留规则】
{user_retention_rules}

【重组策略】
1. 必须完整保留用户指定的所有片段，不得删减或改写其核心含义
2. 融合各 Skill 在健壮性、可读性等维度的最佳约束条件
3. 统一输出格式描述，消除矛盾和冗余
4. 保持指令清晰、简洁，避免过度堆砌要求
5. 最终结果应是一个完整、可直接使用的提示词，不含任何注释或说明

【输出要求】
直接输出重组后的完整 Skill 提示词文本，不要包含任何解释、标题或 JSON 包装。
```

**变量替换说明**：

`{source_skills_info}` 格式示例：
```
- Skill A（综合评分85.3）：擅长功能正确性和可读性
- Skill B（综合评分79.2）：擅长健壮性和边界处理
```

`{selected_segments}` 格式示例：
```
片段1（来自 Skill A，类型：role）：
你是一个专业的Python开发者，擅长生成高质量、可维护的Python代码。请遵循PEP8规范。

片段2（来自 Skill B，类型：constraint）：
生成代码时必须包含输入参数的类型检查和边界值处理，对所有可能的异常情况进行捕获。
```

---

# 八、场景6：上下文压缩

## 8.1 触发条件

当估算 token 数超过 `context_config.token_threshold` 时自动触发。

**Token 估算公式**（简单估算，无需精确）：
```javascript
function estimateTokens(text) {
  // 中文：约1.5字符/token；英文：约4字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}
```

## 8.2 压缩流程

```
1. 导出当前完整会话上下文到 .md 文件（永久保存）
   路径：workspace/projects/{project}/logs/context_export_{timestamp}.md

2. 调用 CLI 压缩（使用 --resume 继续原会话）：
   claude --resume {session_id} --print --output-format json "{压缩Prompt}"

3. 用压缩后的摘要替换当前会话上下文（通过新会话载入摘要）

4. 更新 temp_session 记录的 context_exports 列表
```

## 8.3 上下文压缩 Prompt

```
请对我们之前的对话历史进行摘要压缩，以便继续后续的测试工作。

【压缩要求】
1. 保留所有已完成的测试结果（Skill名称、用例ID、得分、关键输出）
2. 保留当前测试进度（已完成第几条，下一条是什么）
3. 保留重要的错误记录和失败原因
4. 删除冗余的中间过程、重复信息和不影响后续测试的内容
5. 压缩后字数控制在原文的30%以内

请直接输出压缩后的摘要文本，格式清晰，便于在新会话中作为上下文使用。
```

---

# 九、场景7：测试基线 CLI 辅助生成

## 9.1 调用方式

```
模式：--print（单次调用）
模型：用户选择的模型（来自项目配置）
超时：60,000 ms
工作目录：workspace/cli/temp_session/
```

## 9.2 基线生成 Prompt 模板

```
你是一位专业的软件测试工程师。请为以下代码生成任务设计完整的测试用例集。

【任务描述】
{task_description}

【生成要求】
- 共生成 {case_count} 个测试用例
- 包含三种类型，比例建议：标准用例60%、边界用例25%、异常用例15%
- 每个测试用例的输入（input）必须是可以直接发给代码生成模型的完整指令
- 期望输出（expected_output）描述该指令对应的代码应满足的关键特征（不需要是完整代码）
- 测试用例之间不要重复，覆盖不同的功能点和场景

【用例类型说明】
- standard：典型正常输入，测试基础功能
- boundary：边界值、极端情况、最大最小值等
- exception：非法输入、缺失参数、格式错误等异常场景

【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字或 Markdown 代码块标记

【返回格式】
{
  "cases": [
    {
      "name": "用例名称（10字以内）",
      "category": "standard|boundary|exception",
      "input": "发给代码生成模型的完整测试指令",
      "expected_output": "期望代码应满足的关键特征描述",
      "description": "该用例的测试目的说明"
    }
  ]
}
```

**变量替换**：
- `{task_description}` → 用户在导入弹窗中输入的任务描述
- `{case_count}` → 用户配置的生成数量（默认10）

---

# 十、Token 估算规范

## 10.1 各场景输入 Token 估算参考

| 场景 | 主要输入来源 | 估算方式 |
|---|---|---|
| 自动打标签 | `content.txt` | `estimateTokens(skillContent)` |
| 测试执行 | Skill内容 + 用例输入 | `estimateTokens(skillContent + testInput)` |
| 评分 | 测试输入 + 期望 + 实际输出 | `estimateTokens(input + expected + actual)` |
| 差异分析 | 所有Skill评分汇总 + 典型用例对比 | 预估：Skill数 × 用例数 × 200 tokens |
| 重组 | 选中优势片段 + 规则 | `estimateTokens(segments + rules)` |
| 上下文压缩 | 当前会话全文 | 超过阈值时触发，阈值见 `context_config.token_threshold` |

## 10.2 安全水位线策略

```
token_threshold（默认 80,000）
    │
    ├── < 60% → 正常执行
    ├── 60%-80% → 右侧面板显示 warning 标识（context:warning 事件，riskLevel: 'warning'）
    ├── 80%-100% → 红色预警，自动触发压缩（riskLevel: 'critical'）
    └── > 100% → 强制重置会话，从压缩摘要重新开始
```

---

# 十一、错误处理规范

## 11.1 错误类型与处理策略

| 错误类型 | 判断条件 | 处理策略 |
|---|---|---|
| CLI 不存在 | `spawn` 抛出 `ENOENT` | 更新 CLI 状态为离线，推送 `cli:status:change` 事件，阻止后续所有 CLI 调用 |
| 执行超时 | `setTimeout` 触发 `proc.kill('SIGTERM')`，进程关闭后 `close` 事件置 `timedOut` 标志 | 标记当前任务失败（`status: failed`，`error: CLI_TIMEOUT`），继续下一任务 |
| 非零退出码 | `proc.on('close', code !== 0)` | 记录 `stderr`，标记失败，按 `retry_count` 重试 |
| 输出解析失败 | `JSON.parse` 全部方案均失败 | 保存 `raw_output`，重试1次；仍失败则标记 `parse_error`，保留原始输出供人工处理 |
| 模型限流 | `stderr` 含 `rate limit` / `429` | 等待 30s 后重试，最多重试3次；仍失败则暂停整体任务，推送告警 |
| 模型拒绝回答 | `is_error: true` | 记录原因，标记该任务失败，不重试，继续下一任务 |

## 11.2 重试策略

```javascript
async function invokeWithRetry(prompt, options, maxRetries) {
  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await invokeCli(prompt, options)
    } catch (err) {
      lastError = err
      // 限流错误：等待后重试
      if (err.code === 'RATE_LIMITED' && attempt < maxRetries) {
        await sleep(30_000)
        continue
      }
      // 其他错误：立即重试（不等待）
      if (attempt < maxRetries) continue
    }
  }
  throw lastError
}
```

## 11.3 日志记录规范

每次 CLI 调用，无论成功或失败，均写入系统日志：

```javascript
{
  timestamp: new Date().toISOString(),
  level: success ? 'info' : 'error',
  module: 'cli-engine',
  message: `CLI调用${success ? '成功' : '失败'}：${scenario}`,
  detail: {
    scenario,           // 场景名：auto_tag | test_exec | scoring | analysis | recompose | compress
    targetId,           // 关联资产或项目ID
    model,
    durationMs,
    cliVersion,
    exitCode,
    error: errorInfo,   // 失败时记录
  }
}
```

---

# 十二、各场景调用参数速查表

| 场景 | 模式 | System Prompt | 超时 | 重试 | 输出格式 |
|---|---|---|---|---|---|
| 自动打标签（Skill） | print | 无 | 60s | 1次 | JSON |
| 自动打标签（基线） | print | 无 | 60s | 1次 | JSON |
| 测试执行 | print | Skill内容 | 项目配置 | 项目配置 | text |
| 结果评分 | print | 无 | 30s | 1次 | JSON |
| 差异分析 | print | 无 | 60s | 1次 | JSON |
| Skill重组 | print | 无 | 60s | 1次 | text |
| 上下文压缩 | resume | 无 | 60s | 0次 | text |
| 基线生成 | print | 无 | 60s | 1次 | JSON |
