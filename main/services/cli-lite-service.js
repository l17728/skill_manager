'use strict'

/**
 * cli-lite-service.js
 *
 * Auto-tagging and baseline-generation wrapper.
 * Delegates core CLI invocation and version detection to cli-service.js.
 */

const fileService = require('./file-service')
const workspaceService = require('./workspace-service')
const cliService = require('./cli-service')
const logService = require('./log-service')

// Re-export helpers from cli-service for backward compatibility
const getCliVersion = cliService.getCliVersion
const parseStructuredOutput = cliService.parseStructuredOutput
const invokeCli = cliService.invokeCli

/**
 * Read CLI global config.
 */
function getCliConfig() {
  const cfg = fileService.readJson(workspaceService.paths.cliConfig())
  return cfg || {
    cli_path: 'claude',
    default_model: 'claude-opus-4-6',
    default_timeout_seconds: 60,
    default_retry_count: 2,
  }
}

/**
 * Trigger auto-tagging for a Skill via CLI.
 * Returns an auto_tag_log record object.
 *
 * @param {string} skillId
 * @param {string} skillContent  - content of content.txt
 * @param {string} triggeredBy   - 'user' | 'batch'
 * @returns {Promise<{ logRecord: object, parsedTags: string[] }>}
 */
async function autoTagSkill(skillId, skillContent, triggeredBy = 'user') {
  const cfg = getCliConfig()
  const sessionId = `tmp_sess_${Date.now()}`
  const triggeredAt = new Date().toISOString()
  const startMs = Date.now()

  const prompt = `请分析以下 Skill/Agent 的提示词内容，为其生成用于分类和检索的标签。

【提示词内容】
${skillContent}

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
{"tags": ["标签1", "标签2", "标签3"]}`

  let status = 'failed'
  let rawOutput = ''
  let parsedTags = []
  let errorMsg = null
  let durationMs = 0

  logService.info('cli-lite-service', 'autoTagSkill start', { skillId, triggeredBy, contentLen: skillContent.length })

  try {
    const result = await invokeCli(prompt, {
      model: cfg.default_model,
      timeoutMs: 60000,
      workingDir: workspaceService.paths.cliTempSession(),
    })
    rawOutput = result.result || ''
    durationMs = result.duration_ms || (Date.now() - startMs)
    const parsed = parseStructuredOutput(rawOutput)
    if (Array.isArray(parsed.tags)) {
      parsedTags = parsed.tags.filter(t => typeof t === 'string' && t.trim())
      status = 'completed'
      logService.info('cli-lite-service', 'autoTagSkill completed', { skillId, tagCount: parsedTags.length, tags: parsedTags, durationMs })
    } else {
      errorMsg = 'tags field missing or not array'
      logService.warn('cli-lite-service', 'autoTagSkill bad output format', { skillId, rawHead: rawOutput.slice(0, 200) })
    }
  } catch (err) {
    durationMs = Date.now() - startMs
    rawOutput = err.raw || err.stderr || err.message || String(err)
    errorMsg = err.code || String(err)
    logService.error('cli-lite-service', 'autoTagSkill failed', { skillId, errCode: err.code, errMsg: errorMsg, durationMs })
  }

  const cliVersion = await getCliVersion()
  const logRecord = {
    session_id: sessionId,
    triggered_at: triggeredAt,
    triggered_by: triggeredBy,
    target_type: 'skill',
    target_id: skillId,
    status,
    duration_ms: durationMs,
    cli_version: cliVersion,
    model_version: cfg.default_model,
    raw_output: rawOutput,
    parsed_tags: parsedTags.map(v => ({ value: v })),
    error: errorMsg,
  }

  return { logRecord, parsedTags, status }
}

/**
 * Trigger auto-tagging for a Baseline via CLI.
 */
async function autoTagBaseline(baselineId, baselineName, casesSummary, triggeredBy = 'user') {
  const cfg = getCliConfig()
  const sessionId = `tmp_sess_${Date.now()}`
  const triggeredAt = new Date().toISOString()
  const startMs = Date.now()

  const prompt = `请分析以下测试基线的用例内容，为其生成用于分类和检索的标签。

【基线名称】
${baselineName}

【测试用例摘要（前5条）】
${casesSummary}

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
{"tags": ["标签1", "标签2"]}`

  let status = 'failed'
  let rawOutput = ''
  let parsedTags = []
  let errorMsg = null
  let durationMs = 0

  logService.info('cli-lite-service', 'autoTagBaseline start', { baselineId, triggeredBy })

  try {
    const result = await invokeCli(prompt, {
      model: cfg.default_model,
      timeoutMs: 60000,
      workingDir: workspaceService.paths.cliTempSession(),
    })
    rawOutput = result.result || ''
    durationMs = result.duration_ms || (Date.now() - startMs)
    const parsed = parseStructuredOutput(rawOutput)
    if (Array.isArray(parsed.tags)) {
      parsedTags = parsed.tags.filter(t => typeof t === 'string' && t.trim())
      status = 'completed'
      logService.info('cli-lite-service', 'autoTagBaseline completed', { baselineId, tagCount: parsedTags.length, tags: parsedTags, durationMs })
    } else {
      errorMsg = 'tags field missing or not array'
      logService.warn('cli-lite-service', 'autoTagBaseline bad output format', { baselineId, rawHead: rawOutput.slice(0, 200) })
    }
  } catch (err) {
    durationMs = Date.now() - startMs
    rawOutput = err.raw || err.stderr || err.message || String(err)
    errorMsg = err.code || String(err)
    logService.error('cli-lite-service', 'autoTagBaseline failed', { baselineId, errCode: err.code, errMsg: errorMsg, durationMs })
  }

  const cliVersion = await getCliVersion()

  const logRecord = {
    session_id: sessionId,
    triggered_at: triggeredAt,
    triggered_by: triggeredBy,
    target_type: 'baseline',
    target_id: baselineId,
    status,
    duration_ms: durationMs,
    cli_version: cliVersion,
    model_version: cfg.default_model,
    raw_output: rawOutput,
    parsed_tags: parsedTags.map(v => ({ value: v })),
    error: errorMsg,
  }

  return { logRecord, parsedTags, status }
}

/**
 * Generate baseline cases via CLI.
 * @param {string} taskDescription
 * @param {number} caseCount
 * @param {string} model
 * @returns {Promise<{ cases: object[], rawOutput: string }>}
 */
async function generateBaselineCases(taskDescription, caseCount = 10, model) {
  const cfg = getCliConfig()
  const useModel = model || cfg.default_model

  const prompt = `你是一位专业的软件测试工程师。请为以下代码生成任务设计完整的测试用例集。

【任务描述】
${taskDescription}

【生成要求】
- 共生成 ${caseCount} 个测试用例
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
}`

  logService.info('cli-lite-service', 'generateBaselineCases start', { caseCount, model: useModel, descLen: taskDescription.length })

  const result = await invokeCli(prompt, {
    model: useModel,
    timeoutMs: 60000,
    workingDir: workspaceService.paths.cliTempSession(),
  })

  const rawOutput = result.result || ''
  const parsed = parseStructuredOutput(rawOutput)

  if (!Array.isArray(parsed.cases)) {
    logService.error('cli-lite-service', 'generateBaselineCases output parse failed', { rawHead: rawOutput.slice(0, 300) })
    throw { code: 'OUTPUT_PARSE_FAILED', raw: rawOutput }
  }

  logService.info('cli-lite-service', 'generateBaselineCases completed', { caseCount: parsed.cases.length, model: useModel })
  return { cases: parsed.cases, rawOutput }
}

/**
 * Suggest whether a new purpose should be merged with an existing one.
 *
 * @param {string}   newPurpose        - The purpose the user just typed
 * @param {string[]} existingPurposes  - All purposes already present in the workspace
 * @returns {Promise<{ shouldMerge: boolean, suggestedPurpose: string|null, reason: string }>}
 */
async function suggestPurposeMerge(newPurpose, existingPurposes) {
  if (!existingPurposes || existingPurposes.length === 0) {
    return { shouldMerge: false, suggestedPurpose: null, reason: '' }
  }

  const cfg = getCliConfig()
  const startMs = Date.now()

  const prompt = `你是一个资产分类专家。请分析以下新增的 purpose（用途分类）是否应该合并到某个已有的 purpose 中。

【新增 Purpose】
${newPurpose}

【已有 Purpose 列表】
${existingPurposes.map((p, i) => `${i + 1}. ${p}`).join('\n')}

【判断标准】
- 如果新增 purpose 与某个已有 purpose 在语义上高度重合（相似度超过 80%），建议合并
- 如果新增 purpose 有独特含义或专注于不同领域，不建议合并
- 建议合并时只选最接近的一个已有 purpose

【严格要求】
1. 仅输出 JSON，不要包含任何 JSON 以外的文字、解释或 Markdown 代码块标记
2. 确保 JSON 格式合法，可被直接解析

【返回格式】
{"should_merge": true/false, "suggested_purpose": "最匹配的已有purpose或null", "reason": "一两句理由"}`

  logService.info('cli-lite-service', 'suggestPurposeMerge start', { newPurpose, existingCount: existingPurposes.length })

  try {
    const result = await invokeCli(prompt, {
      model: cfg.default_model,
      timeoutMs: 15000,
      workingDir: workspaceService.paths.cliTempSession(),
    })
    const rawOutput = result.result || ''
    const durationMs = result.duration_ms || (Date.now() - startMs)
    const parsed = parseStructuredOutput(rawOutput)

    if (typeof parsed.should_merge !== 'boolean') {
      logService.warn('cli-lite-service', 'suggestPurposeMerge bad output', { newPurpose, rawHead: rawOutput.slice(0, 200) })
      return { shouldMerge: false, suggestedPurpose: null, reason: '' }
    }

    logService.info('cli-lite-service', 'suggestPurposeMerge completed', {
      newPurpose, shouldMerge: parsed.should_merge,
      suggestedPurpose: parsed.suggested_purpose, durationMs,
    })
    return {
      shouldMerge: parsed.should_merge,
      suggestedPurpose: parsed.suggested_purpose || null,
      reason: parsed.reason || '',
    }
  } catch (err) {
    logService.error('cli-lite-service', 'suggestPurposeMerge failed', { newPurpose, errMsg: String(err) })
    return { shouldMerge: false, suggestedPurpose: null, reason: '' }
  }
}

module.exports = {
  getCliVersion,
  invokeCli,
  autoTagSkill,
  autoTagBaseline,
  generateBaselineCases,
  suggestPurposeMerge,
  parseStructuredOutput,
}
