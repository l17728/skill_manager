# Schema 数据结构定义文档

本文档定义平台所有 JSON 文件的完整字段结构，供 TDD 测试用例编写、开发实现和数据校验直接使用。

---

# 一、通用约定

## 1.1 ID 格式

- 所有实体 ID 使用 **UUID v4**，例如：`"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`
- 文件/目录名中使用 ID 的前8位作为短标识，例如：`skill_a1b2c3d4_v1`

## 1.2 时间戳格式

- 统一使用 **ISO 8601 UTC**，例如：`"2024-01-01T12:00:00Z"`

## 1.3 版本号格式

- 格式为 `v{正整数}`，从 `v1` 开始，每次编辑内容或元数据后递增
- 例如：`"v1"`、`"v2"`、`"v10"`

## 1.4 目录命名规则

| 资产类型 | 目录名格式 | 示例 |
|---|---|---|
| Skill/Agent | `skill_{uuid前8位}_v{n}` | `skill_a1b2c3d4_v1` |
| 测试基线 | `baseline_{uuid前8位}_v{n}` | `baseline_b2c3d4e5_v1` |
| 测试项目 | `project_{名称slug}_{yyyyMMddHHmmss}` | `project_code_gen_20240101120000` |
| 重组Skill | `skill_{uuid前8位}_v{n}`（同普通Skill） | `skill_f1e2d3c4_v1` |

## 1.5 文件编码

所有文件使用 **UTF-8** 编码，JSON 文件格式化缩进为 2 空格。

---

# 二、Skill / Agent 资产文件

## 2.1 `meta.json` — Skill 元数据

**路径**：`workspace/skills/{purpose}/{provider}/skill_{id}_{version}/meta.json`

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Python代码生成助手",
  "description": "专用于生成高质量Python代码的Skill，覆盖函数、类、算法实现等场景",
  "author": "张三",
  "source": "内部研发",
  "purpose": "code_generate",
  "provider": "provider_internal",
  "type": "skill",
  "version": "v1",
  "version_count": 1,
  "content_file": "content.txt",
  "status": "active",
  "created_at": "2024-01-01T12:00:00Z",
  "updated_at": "2024-01-01T12:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | UUID v4，全局唯一 |
| `name` | string | 是 | 展示名称，非空 |
| `description` | string | 否 | 功能描述，默认空字符串 |
| `author` | string | 否 | 作者，默认空字符串 |
| `source` | string | 否 | 来源说明，默认空字符串 |
| `purpose` | string | 是 | 目的分类，对应一级目录名 |
| `provider` | string | 是 | 提供方标识，对应二级目录名 |
| `type` | string | 否 | 枚举：`skill` \| `agent`；默认 `skill` |
| `version` | string | 是 | 当前版本号，格式 `v{n}` |
| `version_count` | number | 是 | 历史版本总数，初始为 1 |
| `content_file` | string | 是 | 固定值 `"content.txt"` |
| `status` | string | 是 | 枚举：`active` \| `archived` |
| `created_at` | string | 是 | 创建时间，ISO 8601 UTC |
| `updated_at` | string | 是 | 最后更新时间，ISO 8601 UTC |

---

## 2.2 `tags.json` — Skill 标签

**路径**：`workspace/skills/{purpose}/{provider}/skill_{id}_{version}/tags.json`

```json
{
  "manual": [
    {
      "id": "t1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "value": "Python",
      "created_at": "2024-01-01T12:00:00Z"
    },
    {
      "id": "t2b3c4d5-e6f7-8901-bcde-f12345678901",
      "value": "代码生成",
      "created_at": "2024-01-01T12:05:00Z"
    }
  ],
  "auto": [
    {
      "id": "t3c4d5e6-f7a8-9012-cdef-123456789012",
      "value": "函数生成",
      "status": "approved",
      "generated_at": "2024-01-01T12:10:00Z",
      "approved_at": "2024-01-01T12:30:00Z",
      "rejected_at": null,
      "log_ref": "auto_tag_log/session_20240101121000.json"
    },
    {
      "id": "t4d5e6f7-a8b9-0123-defa-234567890123",
      "value": "算法实现",
      "status": "pending",
      "generated_at": "2024-01-01T12:10:00Z",
      "approved_at": null,
      "rejected_at": null,
      "log_ref": "auto_tag_log/session_20240101121000.json"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `manual` | array | 是 | 人工标签列表，可为空数组 |
| `manual[].id` | string | 是 | UUID v4 |
| `manual[].value` | string | 是 | 标签内容，非空 |
| `manual[].created_at` | string | 是 | ISO 8601 UTC |
| `auto` | array | 是 | 自动生成标签列表，可为空数组 |
| `auto[].id` | string | 是 | UUID v4 |
| `auto[].value` | string | 是 | 标签内容 |
| `auto[].status` | string | 是 | 枚举：`pending` \| `approved` \| `rejected` |
| `auto[].generated_at` | string | 是 | 生成时间 |
| `auto[].approved_at` | string | 否 | 审核通过时间，未审核时为 `null` |
| `auto[].rejected_at` | string | 否 | 拒绝时间，未拒绝时为 `null` |
| `auto[].log_ref` | string | 是 | 关联自动打标签日志的相对路径 |

---

## 2.3 `history/{record}.json` — 版本变更记录

**路径**：`workspace/skills/{purpose}/{provider}/skill_{id}_{version}/history/{from}_to_{to}_{timestamp}.json`

**文件名示例**：`v1_to_v2_20240101130000.json`

```json
{
  "from_version": "v1",
  "to_version": "v2",
  "timestamp": "2024-01-01T13:00:00Z",
  "changed_fields": ["content", "meta.description"],
  "diff": {
    "content": {
      "before": "你是一个代码助手，帮助用户生成代码。",
      "after": "你是一个专业的Python开发者，擅长生成高质量、可维护的Python代码。请遵循PEP8规范。"
    },
    "meta": {
      "description": {
        "before": "代码生成助手",
        "after": "专用于生成高质量Python代码的Skill，覆盖函数、类、算法实现等场景"
      }
    }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `from_version` | string | 是 | 编辑前版本号 |
| `to_version` | string | 是 | 编辑后版本号 |
| `timestamp` | string | 是 | 编辑时间，ISO 8601 UTC |
| `changed_fields` | array | 是 | 变更字段列表，如 `["content", "meta.name"]` |
| `diff` | object | 是 | 各字段变更前后内容，仅包含实际变更的字段 |
| `diff.content` | object | 否 | `{ before, after }`，内容变更时存在 |
| `diff.meta` | object | 否 | 元数据字段变更时存在，key 为字段名 |

---

## 2.4 `auto_tag_log/{session}.json` — 自动打标签执行日志

**路径**：`workspace/skills/{purpose}/{provider}/skill_{id}_{version}/auto_tag_log/session_{yyyyMMddHHmmss}.json`

```json
{
  "session_id": "tmp_sess_20240101121000",
  "triggered_at": "2024-01-01T12:10:00Z",
  "triggered_by": "user",
  "target_type": "skill",
  "target_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "duration_ms": 4320,
  "cli_version": "1.2.0",
  "model_version": "claude-opus-4-6",
  "raw_output": "以下是为该Skill生成的标签：\n1. 函数生成\n2. 算法实现\n3. PEP8规范",
  "parsed_tags": [
    { "value": "函数生成" },
    { "value": "算法实现" },
    { "value": "PEP8规范" }
  ],
  "error": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | string | 是 | 临时会话标识 |
| `triggered_by` | string | 是 | 枚举：`user`（手动触发）\| `batch`（批量触发） |
| `target_type` | string | 是 | 枚举：`skill` \| `baseline` |
| `target_id` | string | 是 | 目标资产 UUID |
| `status` | string | 是 | 枚举：`running` \| `completed` \| `failed` |
| `duration_ms` | number | 是 | 执行耗时（毫秒） |
| `cli_version` | string | 是 | 执行时 Claude CLI 版本 |
| `model_version` | string | 是 | 执行时模型版本 |
| `raw_output` | string | 是 | CLI 原始输出，失败时为错误信息 |
| `parsed_tags` | array | 是 | 解析出的标签列表，失败时为空数组 |
| `error` | string\|null | 是 | 错误信息，成功时为 `null` |

---

# 三、测试基线文件

## 3.1 `meta.json` — 基线元数据

**路径**：`workspace/baselines/{purpose}/{provider}/baseline_{id}_{version}/meta.json`

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "name": "Python代码生成标准测试集",
  "description": "覆盖函数生成、类实现、算法题等标准测试用例",
  "author": "李四",
  "source": "内部编写",
  "purpose": "code_generate_test",
  "provider": "provider_internal",
  "version": "v1",
  "version_count": 1,
  "case_count": 10,
  "status": "active",
  "created_at": "2024-01-01T10:00:00Z",
  "updated_at": "2024-01-01T10:00:00Z"
}
```

与 Skill `meta.json` 结构一致，新增字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `case_count` | number | 是 | 当前 cases.json 中的用例数量 |

---

## 3.2 `cases.json` — 测试用例集

**路径**：`workspace/baselines/{purpose}/{provider}/baseline_{id}_{version}/cases.json`

```json
{
  "baseline_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "version": "v1",
  "cases": [
    {
      "id": "case_001",
      "name": "基础斐波那契函数生成",
      "category": "standard",
      "input": "用Python写一个计算斐波那契数列第n项的函数，需要处理n为0和负数的情况",
      "expected_output": "函数需包含：正确的递推逻辑、对n<=0的边界处理、必要的注释",
      "description": "测试基础算法实现能力及边界处理",
      "created_at": "2024-01-01T10:00:00Z",
      "updated_at": "2024-01-01T10:00:00Z"
    },
    {
      "id": "case_002",
      "name": "超长输入边界测试",
      "category": "boundary",
      "input": "用Python实现一个排序函数，输入列表可能包含None值、重复值、极大/极小整数",
      "expected_output": "函数需能处理None值过滤、稳定排序、不抛出未捕获异常",
      "description": "测试边界条件处理能力",
      "created_at": "2024-01-01T10:05:00Z",
      "updated_at": "2024-01-01T10:05:00Z"
    },
    {
      "id": "case_003",
      "name": "异常输入处理测试",
      "category": "exception",
      "input": "写一个读取JSON文件的Python函数，文件可能不存在或格式错误",
      "expected_output": "函数需包含FileNotFoundError和JSONDecodeError的捕获与友好提示",
      "description": "测试异常处理代码的生成能力",
      "created_at": "2024-01-01T10:10:00Z",
      "updated_at": "2024-01-01T10:10:00Z"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `baseline_id` | string | 是 | 关联的基线 UUID |
| `version` | string | 是 | 当前版本号 |
| `cases` | array | 是 | 用例列表，可为空数组 |
| `cases[].id` | string | 是 | 用例ID，格式 `case_{三位数字}`，同一基线内唯一 |
| `cases[].name` | string | 是 | 用例名称 |
| `cases[].category` | string | 是 | 枚举：`standard`（标准）\| `boundary`（边界）\| `exception`（异常） |
| `cases[].input` | string | 是 | 发送给 Skill 的测试输入 |
| `cases[].expected_output` | string | 是 | 期望输出的描述或示例（供评分参考） |
| `cases[].description` | string | 否 | 用例说明，默认空字符串 |
| `cases[].created_at` | string | 是 | ISO 8601 UTC |
| `cases[].updated_at` | string | 是 | ISO 8601 UTC |

> `tags.json`、`history/`、`auto_tag_log/` 与 Skill 对应文件结构完全一致，`target_type` 改为 `"baseline"`。

---

# 四、测试项目文件

## 4.1 `config.json` — 项目配置

**路径**：`workspace/projects/project_{name}_{timestamp}/config.json`

```json
{
  "id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "name": "Python代码生成Skill对比实验",
  "description": "对比三个不同来源的Python代码生成Skill",
  "status": "pending",
  "created_at": "2024-01-01T14:00:00Z",
  "updated_at": "2024-01-01T14:00:00Z",
  "skills": [
    {
      "ref_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Python代码生成助手",
      "purpose": "code_generate",
      "provider": "provider_internal",
      "version": "v1",
      "local_path": "skills/skill_a1b2c3d4_v1"
    }
  ],
  "baselines": [
    {
      "ref_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "name": "Python代码生成标准测试集",
      "version": "v1",
      "local_path": "baselines/baseline_b2c3d4e5_v1"
    }
  ],
  "cli_config": {
    "model": "claude-opus-4-6",
    "timeout_seconds": 60,
    "retry_count": 2,
    "extra_flags": []
  },
  "context_config": {
    "token_threshold": 80000,
    "auto_compress": true,
    "auto_export": true
  },
  "progress": {
    "total_tasks": 10,
    "completed_tasks": 0,
    "failed_tasks": 0,
    "last_checkpoint": null
  },
  "original_skill_ids": ["skill-a-uuid", "skill-b-uuid"],
  "iteration_config": {
    "mode": "standard",
    "beam_width": 1,
    "plateau_threshold": 1.0,
    "plateau_rounds_before_escape": 2
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | UUID v4 |
| `status` | string | 是 | 枚举：`pending` \| `running` \| `completed` \| `interrupted` |
| `skills` | array | 是 | 引用的 Skill 列表，至少1条 |
| `skills[].ref_id` | string | 是 | 原始库中 Skill 的 UUID |
| `skills[].local_path` | string | 是 | 项目目录内副本的相对路径 |
| `baselines` | array | 是 | 引用的基线列表，至少1条 |
| `cli_config.model` | string | 是 | 使用的模型版本 |
| `cli_config.timeout_seconds` | number | 是 | 单次 CLI 调用超时秒数 |
| `cli_config.retry_count` | number | 是 | 失败后最大重试次数 |
| `cli_config.extra_flags` | array | 否 | 附加 CLI 参数，默认空数组 |
| `context_config.token_threshold` | number | 是 | 触发压缩的 token 估算阈值 |
| `progress.total_tasks` | number | 是 | 总任务数 = skills数 × cases数 |
| `progress.last_checkpoint` | number\|null | 是 | 已完成任务数（completed_tasks + failed_tasks），用于断点续跑进度显示 |
| `original_skill_ids` | string[] | 否 | 项目创建时选择的 Skill UUID 列表，迭代期间保持不变用于参照分析 |
| `iteration_config` | object | 否 | AEIO 迭代默认参数；实际运行参数由 `iteration:start` 覆盖 |

---

# 五、测试结果文件

## 5.1 单条测试结果

**路径**：`workspace/projects/project_{name}_{timestamp}/results/{skill_short_id}_v{n}/{case_id}.json`

```json
{
  "case_id": "case_001",
  "skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "skill_version": "v1",
  "baseline_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "baseline_version": "v1",
  "executed_at": "2024-01-01T15:00:00Z",
  "status": "completed",
  "input": "用Python写一个计算斐波那契数列第n项的函数，需要处理n为0和负数的情况",
  "expected_output": "函数需包含：正确的递推逻辑、对n<=0的边界处理、必要的注释",
  "actual_output": "def fibonacci(n):\n    \"\"\"\n    计算斐波那契数列第n项\n    \"\"\"\n    if n <= 0:\n        return 0\n    if n == 1:\n        return 1\n    return fibonacci(n-1) + fibonacci(n-2)",
  "duration_ms": 3840,
  "cli_version": "1.2.0",
  "model_version": "claude-opus-4-6",
  "error": null,
  "scores": {
    "functional_correctness": 28,
    "robustness": 16,
    "readability": 14,
    "conciseness": 13,
    "complexity_control": 8,
    "format_compliance": 9,
    "total": 88
  },
  "score_reasoning": "功能正确性(28/30)：递推逻辑正确，边界处理到位，但未处理超大n导致的递归栈溢出；健壮性(16/20)：处理了n<=0，但缺少类型检查；可读性(14/15)：含docstring，命名清晰；简洁性(13/15)：实现简洁；复杂度控制(8/10)：递归实现对大n性能差；格式规范性(9/10)：符合PEP8。",
  "score_evaluated_at": "2024-01-01T15:00:12Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | string | 是 | 枚举：`completed` \| `failed` \| `skipped` |
| `error` | string\|null | 是 | CLI执行失败时的错误信息，成功时为 `null` |
| `scores` | object | 是 | 六维评分，`status` 为 `failed` 时所有分值为 `null` |
| `scores.functional_correctness` | number | 是 | 0-30 |
| `scores.robustness` | number | 是 | 0-20 |
| `scores.readability` | number | 是 | 0-15 |
| `scores.conciseness` | number | 是 | 0-15 |
| `scores.complexity_control` | number | 是 | 0-10 |
| `scores.format_compliance` | number | 是 | 0-10 |
| `scores.total` | number | 是 | 0-100，六项之和 |
| `score_reasoning` | string | 是 | 各维度评分依据文字说明，失败时为空字符串 |
| `score_evaluated_at` | string | 是 | 评分完成时间，失败时为 `null` |

---

## 5.2 `results/summary.json` — 项目测试汇总

**路径**：`workspace/projects/project_{name}_{timestamp}/results/summary.json`

```json
{
  "project_id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "generated_at": "2024-01-01T16:00:00Z",
  "total_cases": 10,
  "ranking": [
    {
      "rank": 1,
      "skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "skill_name": "Python代码生成助手",
      "skill_version": "v1",
      "completed_cases": 10,
      "failed_cases": 0,
      "avg_score": 85.3,
      "score_breakdown": {
        "functional_correctness": 27.5,
        "robustness": 16.8,
        "readability": 13.2,
        "conciseness": 12.1,
        "complexity_control": 8.9,
        "format_compliance": 8.8
      }
    },
    {
      "rank": 2,
      "skill_id": "d4e5f6a7-b8c9-0123-defa-345678901234",
      "skill_name": "通用代码助手B",
      "skill_version": "v2",
      "completed_cases": 9,
      "failed_cases": 1,
      "avg_score": 79.2,
      "score_breakdown": {
        "functional_correctness": 24.1,
        "robustness": 18.3,
        "readability": 11.0,
        "conciseness": 10.5,
        "complexity_control": 8.1,
        "format_compliance": 7.2
      }
    }
  ]
}
```

---

# 六、差异分析与重组文件

## 6.1 `analysis_report.json` — 差异分析报告

**路径**：`workspace/projects/project_{name}_{timestamp}/analysis_report.json`

```json
{
  "project_id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "generated_at": "2024-01-01T16:30:00Z",
  "best_skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "best_skill_name": "Python代码生成助手",
  "dimension_leaders": {
    "functional_correctness": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "robustness": "d4e5f6a7-b8c9-0123-defa-345678901234",
    "readability": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "conciseness": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "complexity_control": "d4e5f6a7-b8c9-0123-defa-345678901234",
    "format_compliance": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  },
  "advantage_segments": [
    {
      "id": "seg_001",
      "skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "skill_name": "Python代码生成助手",
      "type": "role",
      "content": "你是一个专业的Python开发者，擅长生成高质量、可维护的Python代码。请遵循PEP8规范。",
      "reason": "角色设定明确，引导模型输出更规范的代码结构",
      "dimension": "readability"
    },
    {
      "id": "seg_002",
      "skill_id": "d4e5f6a7-b8c9-0123-defa-345678901234",
      "skill_name": "通用代码助手B",
      "type": "constraint",
      "content": "生成代码时必须包含输入参数的类型检查和边界值处理，对所有可能的异常情况进行捕获。",
      "reason": "约束条件完善了健壮性要求，在异常处理用例中表现最佳",
      "dimension": "robustness"
    },
    {
      "id": "seg_003",
      "skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "skill_name": "Python代码生成助手",
      "type": "format",
      "content": "输出格式：直接给出完整可运行的Python代码，包含必要的docstring，不附加额外解释。",
      "reason": "输出格式约定减少了无效输出，提升了代码的直接可用性",
      "dimension": "format_compliance"
    }
  ],
  "issues": [
    {
      "skill_id": "d4e5f6a7-b8c9-0123-defa-345678901234",
      "skill_name": "通用代码助手B",
      "dimension": "readability",
      "description": "缺少对代码注释和命名规范的明确要求，导致生成代码可读性较低"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `advantage_segments[].type` | string | 是 | 枚举：`instruction`（指令结构）\| `constraint`（约束条件）\| `format`（输出格式）\| `role`（角色设定）\| `example`（示例） |
| `advantage_segments[].dimension` | string | 是 | 该片段在哪个评分维度上表现突出 |

---

## 6.2 `provenance.json` — 重组Skill溯源

**路径**：`workspace/skills/{purpose}/{provider}/skill_{id}_{version}/provenance.json`

> 仅重组生成的 Skill 目录下存在此文件，普通导入的 Skill 无此文件。

```json
{
  "type": "recomposed",
  "source_project_id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "source_project_name": "Python代码生成Skill对比实验",
  "recomposition_strategy": "保留功能正确性最高Skill的角色设定和输出格式，融合健壮性最高Skill的约束条件",
  "user_retention_rules": "必须保留seg_001（角色设定）和seg_002（约束条件）",
  "source_skills": [
    {
      "skill_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "skill_name": "Python代码生成助手",
      "skill_version": "v1",
      "contributed_segments": ["seg_001", "seg_003"]
    },
    {
      "skill_id": "d4e5f6a7-b8c9-0123-defa-345678901234",
      "skill_name": "通用代码助手B",
      "skill_version": "v2",
      "contributed_segments": ["seg_002"]
    }
  ],
  "created_at": "2024-01-01T17:00:00Z"
}
```

---

# 七、迭代验证文件

## 7.1 `iterations/round_{n}/config.json` — 单轮迭代配置

**路径**：`workspace/projects/project_{name}_{timestamp}/iterations/round_{n}/config.json`

```json
{
  "round": 1,
  "skill_id": "e5f6a7b8-c9d0-1234-efab-456789012345",
  "skill_name": "重组Skill-v1",
  "skill_version": "v1",
  "baseline_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "retention_rules": "必须保留seg_001（角色设定）和seg_002（约束条件）",
  "started_at": "2024-01-02T09:00:00Z",
  "completed_at": "2024-01-02T09:30:00Z",
  "status": "completed"
}
```

---

## 7.2 `iterations/iteration_report.json` — 迭代总报告

**路径**：`workspace/projects/project_{name}_{timestamp}/iterations/iteration_report.json`

```json
{
  "project_id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "generated_at": "2024-01-02T12:00:00Z",
  "total_rounds": 3,
  "stop_reason": "threshold_reached",
  "stop_threshold": 90.0,
  "best_round": 3,
  "best_skill_id": "g7h8i9j0-k1l2-3456-mnop-678901234567",
  "best_skill_name": "重组Skill-v3",
  "best_avg_score": 92.4,
  "rounds": [
    {
      "round": 1,
      "strategy": "GREEDY",
      "skill_id": "e5f6a7b8-c9d0-1234-efab-456789012345",
      "skill_name": "重组Skill-v1",
      "avg_score": 85.3,
      "score_delta": null,
      "score_breakdown": {
        "functional_correctness": 27.0,
        "robustness": 18.5,
        "readability": 13.5,
        "conciseness": 13.0,
        "complexity_control": 8.5,
        "format_compliance": 9.8
      }
    },
    {
      "round": 2,
      "skill_id": "f6a7b8c9-d0e1-2345-fabc-567890123456",
      "skill_name": "重组Skill-v2",
      "avg_score": 89.1,
      "score_delta": 3.8,
      "score_breakdown": {
        "functional_correctness": 28.5,
        "robustness": 19.0,
        "readability": 14.0,
        "conciseness": 13.5,
        "complexity_control": 9.0,
        "format_compliance": 9.5
      }
    },
    {
      "round": 3,
      "skill_id": "g7h8i9j0-k1l2-3456-mnop-678901234567",
      "skill_name": "重组Skill-v3",
      "avg_score": 92.4,
      "score_delta": 3.3,
      "score_breakdown": {
        "functional_correctness": 29.0,
        "robustness": 19.5,
        "readability": 14.5,
        "conciseness": 14.0,
        "complexity_control": 9.0,
        "format_compliance": 9.4
      }
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `stop_reason` | string | 是 | 枚举：`threshold_reached`（达到阈值）\| `max_rounds`（达到最大轮次）\| `manual`（手动终止） |
| `stop_threshold` | number | 否 | 设置的停止阈值分数，未设置时为 `null` |
| `rounds[].strategy` | string | 是 | 枚举：`GREEDY` \| `DIMENSION_FOCUS` \| `SEGMENT_EXPLORE` \| `CROSS_POLLINATE` \| `RANDOM_SUBSET` |
| `rounds[].score_delta` | number\|null | 是 | 与上一轮的分差，第一轮为 `null` |

---

## 7.3 `iterations/exploration_log.json` — Beam 探索日志

**路径**：`workspace/projects/project_{name}_{timestamp}/iterations/exploration_log.json`

**说明**：仅 beamWidth > 1 时才有意义；记录每两轮之间所有 beam 候选的测试结果，供 UI 可视化探索过程。

```json
{
  "project_id": "c3d4e5f6-a7b8-9012-cdef-234567890123",
  "started_at": "2024-01-02T09:00:00Z",
  "completed_at": "2024-01-02T12:00:00Z",
  "params": {
    "maxRounds": 3,
    "beamWidth": 2,
    "plateauThreshold": 1.0,
    "stopThreshold": null
  },
  "original_skill_ids": ["skill-a", "skill-b"],
  "rounds": [
    {
      "round": 1,
      "plateau_level": 0,
      "strategies_tried": ["GREEDY", "DIMENSION_FOCUS"],
      "candidates": [
        {
          "strategy": "GREEDY",
          "skill_id": "mock-iter-000001",
          "avg_score": 82.1,
          "score_breakdown": { "functional_correctness": 25, "robustness": 17 },
          "won": true,
          "error": null
        },
        {
          "strategy": "DIMENSION_FOCUS",
          "skill_id": "mock-iter-000002",
          "avg_score": 80.5,
          "score_breakdown": { "functional_correctness": 24, "robustness": 18 },
          "won": false,
          "error": null
        }
      ],
      "winner_skill_id": "mock-iter-000001"
    }
  ],
  "best_ever": {
    "round": 2,
    "strategy": "GREEDY",
    "skill_id": "mock-iter-000001",
    "avg_score": 85.3
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `rounds[].plateau_level` | number | 0=无平台期，1=轻度，2=中度，3=严重 |
| `rounds[].strategies_tried` | string[] | 本轮 beam 使用的策略列表 |
| `rounds[].candidates[].won` | boolean | 是否为本轮 beam 胜出者 |
| `rounds[].candidates[].error` | string\|null | 候选失败时的错误信息 |
| `best_ever` | object | 所有轮次中得分最高的候选 |

---

# 八、系统配置文件

## 8.1 `workspace/cli/config.json` — CLI 全局配置

```json
{
  "cli_path": "claude",
  "default_model": "claude-opus-4-6",
  "default_timeout_seconds": 60,
  "default_retry_count": 2,
  "temp_session_ttl_days": 7,
  "context": {
    "token_threshold": 80000,
    "auto_compress": true,
    "auto_export": true
  },
  "updated_at": "2024-01-01T00:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cli_path` | string | 是 | CLI 可执行文件路径，通常为 `"claude"`（在 PATH 中） |
| `default_model` | string | 是 | 默认模型版本 |
| `default_timeout_seconds` | number | 是 | 默认超时，建议 60-120 |
| `default_retry_count` | number | 是 | 默认重试次数，建议 2 |
| `temp_session_ttl_days` | number | 是 | 自动打标签临时会话保留天数，默认 7 |
| `context.token_threshold` | number | 是 | token 估算阈值，超过后触发压缩/导出 |

---

## 8.2 `workspace/cli/temp_session/{session_id}.json` — 临时会话记录

```json
{
  "session_id": "tmp_sess_20240101121000",
  "created_at": "2024-01-01T12:10:00Z",
  "expires_at": "2024-01-08T12:10:00Z",
  "purpose": "auto_tag",
  "related_target_type": "skill",
  "related_target_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "closed",
  "context_exports": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `expires_at` | string | 是 | 创建时间 + `temp_session_ttl_days` |
| `purpose` | string | 是 | 枚举：`auto_tag`（自动打标签）\| `baseline_gen`（基线生成） |
| `status` | string | 是 | 枚举：`active` \| `closed` \| `expired` |
| `context_exports` | array | 是 | 上下文导出文件路径列表，发生溢出压缩时记录 |

---

# 八.五、Rankings 虚拟数据结构（由 leaderboard:query 返回，不存储到磁盘）

## 8.5.1 LeaderboardRecord

**说明**：表示单次测试的成绩记录，由 `leaderboard-service` 在内存中组装，
源数据来自 `results/summary.json`（分数）和 `workspace/skills|baselines/.../meta.json`（当前版本）。

```json
{
  "skill_id":                  "3f9a1b2c-...",
  "skill_name":                "Alpha Coder",
  "skill_version_tested":      "v1",
  "skill_version_current":     "v3",
  "baseline_id":               "7e2d4f5a-...",
  "baseline_name":             "Python 编程基线",
  "baseline_version_tested":   "v1",
  "baseline_version_current":  "v2",
  "avg_score":                 87.3,
  "score_breakdown": {
    "functional_correctness":  26,
    "robustness":              18,
    "readability":             13,
    "conciseness":             13,
    "complexity_control":       9,
    "format_compliance":        8.3
  },
  "project_id":        "a1b2c3d4-...",
  "project_name":      "Python 对比测试 #3",
  "tested_at":         "2024-02-27T10:30:00.000Z",
  "case_count":        10,
  "completed_cases":   10,
  "failed_cases":       0,
  "staleness":         "skill_updated"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `skill_version_tested` | string | 是 | 来自 `summary.json ranking[].skill_version` |
| `skill_version_current` | string | 是 | 来自当前 Skill `meta.json version` |
| `baseline_version_tested` | string | 是 | 来自项目 `config.json baselines[].version` |
| `baseline_version_current` | string | 是 | 来自当前 Baseline `meta.json version` |
| `staleness` | string | 是 | 枚举：`current` \| `skill_updated` \| `baseline_updated` \| `both_updated` |
| `tested_at` | string | 是 | 来自 `summary.json generated_at` |

## 8.5.2 LeaderboardGroup

**说明**：`leaderboard:query` 在 `groupByBaseline=true`（默认）时的返回单元。

```json
{
  "baseline_id":              "7e2d4f5a-...",
  "baseline_name":            "Python 编程基线",
  "baseline_purpose":         "coding",
  "baseline_case_count":      10,
  "baseline_version_current": "v2",
  "skill_count":               3,
  "records": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `skill_count` | number | 是 | 该 Baseline 下参与排名的不同 skill_id 数量 |
| `records` | LeaderboardRecord[] | 是 | 按 `avg_score` 降序，相同 Skill 多条记录全部包含 |

## 8.5.3 SkillTestSummary

**说明**：`skill:list` 和 `skill:get` 返回值中的 `testSummary` 聚合字段，
驱动 Skill 列表中的成绩 badge。为 `null` 时表示该 Skill 无任何测试记录。

```json
{
  "has_tests":          true,
  "best_score":         87.3,
  "best_baseline_name": "Python 编程基线",
  "test_count":         5,
  "staleness":          "skill_updated"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `has_tests` | boolean | 是 | 是否存在任意测试记录 |
| `best_score` | number\|null | 是 | 跨所有 Baseline 的最高 avg_score |
| `best_baseline_name` | string\|null | 是 | best_score 所在 Baseline 名称 |
| `test_count` | number | 是 | 所有项目中该 Skill 参与测试的总次数 |
| `staleness` | string\|null | 是 | 所有记录中新鲜度最好的那条状态；若有任何 `current` 则整体为 `current` |

---

# 九、Schema 校验规则速查

| 文件 | 关键必填字段 | 关键枚举字段 |
|---|---|---|
| Skill `meta.json` | `id`, `name`, `purpose`, `provider`, `version`, `status` | `status`: active\|archived; `type`: skill\|agent |
| `tags.json` | `manual`, `auto` | `auto[].status`: pending\|approved\|rejected |
| `cases.json` | `baseline_id`, `cases[].id`, `cases[].input`, `cases[].expected_output` | `category`: standard\|boundary\|exception |
| 项目 `config.json` | `id`, `skills`(≥1), `baselines`(≥1), `status` | `status`: pending\|running\|completed\|interrupted |
| 测试结果 | `case_id`, `skill_id`, `status`, `scores.total` | `status`: completed\|failed\|skipped |
| `analysis_report.json` | `advantage_segments[].type` | `type`: instruction\|constraint\|format\|role\|example |
| `iteration_report.json` | `stop_reason`, `best_round` | `stop_reason`: threshold_reached\|max_rounds\|manual |
