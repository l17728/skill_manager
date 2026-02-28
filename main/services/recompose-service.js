'use strict'

/**
 * recompose-service.js — Phase 4 Module 8: Skill Auto-Recomposition
 *
 * Reads the analysis report from a project, builds a recompose prompt from
 * selected advantage segments and user retention rules, calls the CLI to
 * generate a new merged Skill prompt, and saves it as a new Skill with
 * provenance.json for traceability.
 *
 * Exports: executeRecompose, saveRecomposedSkill
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fileService      = require('./file-service')
const workspaceService = require('./workspace-service')
const cliService       = require('./cli-service')
const logService       = require('./log-service')

// ─── Recompose Prompt Template ───────────────────────────────────────────────

const RECOMPOSE_PROMPT = `你是一位专业的 Prompt 工程师。请根据以下多个 Skill 的优势片段和用户指定的保留规则，融合生成一个更优秀的 Skill 提示词。

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

{meta_prompt_tail}【输出要求】
直接输出重组后的完整 Skill 提示词文本，不要包含任何解释、标题或 JSON 包装。`

const DIM_LABELS_CN = {
  functional_correctness: '功能正确性',
  robustness:             '健壮性',
  readability:            '可读性',
  conciseness:            '简洁性',
  complexity_control:     '复杂度控制',
  format_compliance:      '格式规范',
}

/**
 * Build the optional meta-prompt tail injected at the end of the recompose prompt.
 * Contains score history and strategy direction when called from the iteration loop.
 *
 * @param {object[]} scoreHistory  Array of { round, strategy, avg_score, score_breakdown, score_delta }
 * @param {string}   strategy      One of: GREEDY | DIMENSION_FOCUS | SEGMENT_EXPLORE | ...
 * @param {string}   focusDimension  Only relevant for DIMENSION_FOCUS strategy
 * @returns {string}
 */
function buildMetaPromptTail(scoreHistory, strategy, focusDimension) {
  if (!scoreHistory || scoreHistory.length === 0) return ''

  const historyLines = scoreHistory.map(h => {
    const deltaStr = h.score_delta != null
      ? `（${h.score_delta >= 0 ? '+' : ''}${Number(h.score_delta).toFixed(1)}）`
      : ''
    const breakdown = h.score_breakdown
      ? Object.entries(h.score_breakdown)
          .map(([k, v]) => `${DIM_LABELS_CN[k] || k} ${v}`)
          .join(' | ')
      : ''
    return `第${h.round}轮${h.strategy ? `（${h.strategy}）` : ''}：总分 ${Number(h.avg_score).toFixed(1)}${deltaStr}　${breakdown}`
  })

  const stagnantDims = _detectStagnantDimensions(scoreHistory)

  const strategyLines = []
  if (strategy === 'DIMENSION_FOCUS' && focusDimension) {
    strategyLines.push(`本轮策略方向：DIMENSION_FOCUS — 重点改善「${DIM_LABELS_CN[focusDimension] || focusDimension}」维度`)
    strategyLines.push(`请在融合片段时优先强化该维度对应的指令精确性或约束条件，不要以牺牲其他维度为代价。`)
  } else if (strategy === 'SEGMENT_EXPLORE') {
    strategyLines.push(`本轮策略方向：SEGMENT_EXPLORE — 主动引入此前未使用的优势片段`)
    strategyLines.push(`请尝试将新片段与现有内容有机融合，不要简单拼接。`)
  } else if (strategy === 'CROSS_POLLINATE') {
    strategyLines.push(`本轮策略方向：CROSS_POLLINATE — 跨越原始Skill边界，汲取多个来源的最佳结构`)
    strategyLines.push(`请重新审视来源片段，不受上一轮提示词结构限制。`)
  }

  if (stagnantDims.length > 0) {
    strategyLines.push(`停滞维度（连续2轮无改善）：${stagnantDims.map(d => DIM_LABELS_CN[d] || d).join('、')}`)
    strategyLines.push(`请在本轮重点针对这些维度进行优化。`)
  }

  return [
    '【历史得分趋势】',
    ...historyLines,
    '',
    ...(strategyLines.length > 0 ? strategyLines : []),
    '',
  ].join('\n')
}

/** Detect dimensions that showed no improvement over the last 2 rounds. */
function _detectStagnantDimensions(scoreHistory) {
  if (scoreHistory.length < 2) return []
  const last2 = scoreHistory.slice(-2)
  const dims = Object.keys(DIM_LABELS_CN)
  return dims.filter(dim => {
    const scores = last2.map(h => h.score_breakdown && h.score_breakdown[dim])
    return scores.every(s => s != null) && scores[1] <= scores[0]
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _findProjectDir(projectId) {
  for (const { dir, fullPath } of workspaceService.listAllProjectDirs()) {
    const cfg = fileService.readJson(path.join(fullPath, 'config.json'))
    if (cfg && cfg.id === projectId) return { dir, fullPath }
  }
  return null
}

function _getGlobalConfig() {
  return fileService.readJson(workspaceService.paths.cliConfig())
    || { cli_path: 'claude', default_model: 'claude-opus-4-6', default_timeout_seconds: 60 }
}

/**
 * Build the recompose prompt string.
 * @param {string} projectPath
 * @param {object} config
 * @param {object} opts
 * @param {string}   [opts.retentionRules]
 * @param {string[]} [opts.selectedSegmentIds]
 * @param {string}   [opts.strategy]          AEIO strategy name (GREEDY | DIMENSION_FOCUS | ...)
 * @param {string}   [opts.focusDimension]    For DIMENSION_FOCUS only
 * @param {object[]} [opts.scoreHistory]      Array of past round scores
 */
function buildRecomposePrompt(projectPath, config, { retentionRules, selectedSegmentIds, strategy, focusDimension, scoreHistory } = {}) {
  const report  = fileService.readJson(path.join(projectPath, 'analysis_report.json'))
  if (!report) throw { code: 'NO_ANALYSIS', message: 'Analysis report not found. Run analysis first.' }

  const summary = fileService.readJson(path.join(projectPath, 'results', 'summary.json')) || {}
  const allSegments = report.advantage_segments || []

  // Filter to selected segments (or use all if none specified)
  const selected = (selectedSegmentIds && selectedSegmentIds.length > 0)
    ? allSegments.filter(s => selectedSegmentIds.includes(s.id))
    : allSegments

  // Build source skills info (unique skills referenced in selected segments)
  const skillSeen = new Set()
  const skillLines = []
  for (const seg of selected) {
    if (!skillSeen.has(seg.skill_id)) {
      skillSeen.add(seg.skill_id)
      const rankEntry = (summary.ranking || []).find(r => r.skill_id === seg.skill_id)
      const avgScore = rankEntry ? rankEntry.avg_score : 0
      skillLines.push(`- ${seg.skill_name}（综合评分${avgScore}）`)
    }
  }

  const sourceSkillsInfo = skillLines.join('\n') || '无来源信息'

  // Format selected segments
  const segmentsText = selected.map((s, i) =>
    `片段${i + 1}（来自 ${s.skill_name}，类型：${s.type}）：\n${s.content}`
  ).join('\n\n')

  const metaTail = buildMetaPromptTail(scoreHistory, strategy, focusDimension)

  return {
    prompt: RECOMPOSE_PROMPT
      .replace('{source_skills_info}',   sourceSkillsInfo)
      .replace('{selected_segments}',    segmentsText || '无选定片段')
      .replace('{user_retention_rules}', retentionRules || '无特殊要求')
      .replace('{meta_prompt_tail}',     metaTail ? metaTail + '\n' : ''),
    selected,
    strategy: strategy || 'GREEDY',
  }
}

/**
 * Background recompose task.
 */
async function _doRecompose(projectId, projectPath, config, params, taskId, onComplete) {
  try {
    const globalCfg = _getGlobalConfig()
    const { prompt, selected } = buildRecomposePrompt(projectPath, config, params)

    const cliResult = await cliService.invokeCli(prompt, {
      model:     globalCfg.default_model || 'claude-opus-4-6',
      workingDir: path.join(projectPath, '.claude'),
      timeoutMs: 60000,
    })

    const recomposedContent = cliResult.result || ''
    const uniqueSourceSkills = [...new Set(selected.map(s => s.skill_id))]

    logService.info('recompose-service', 'Recomposition completed', {
      projectId,
      strategy: params.strategy || 'GREEDY',
      segmentCount: selected.length,
    })

    if (onComplete) {
      onComplete({
        projectId,
        taskId,
        status: 'completed',
        preview: {
          content:          recomposedContent,
          segmentCount:     selected.length,
          sourceSkillCount: uniqueSourceSkills.length,
        },
      })
    }
  } catch (err) {
    const errCode   = (err && err.code)    || 'UNKNOWN'
    const errMsg    = (err && err.message) || ''
    const errDetail = [errCode, errMsg].filter(Boolean).join(': ') || String(err)
    logService.error('recompose-service', 'Recomposition failed', { projectId, errCode, errMsg, errDetail })
    if (onComplete) {
      onComplete({ projectId, taskId, status: 'failed', error: errDetail })
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute recomposition for a project.
 * Returns { taskId } immediately; result delivered via onComplete callback.
 *
 * @param {string} projectId
 * @param {{ retentionRules, selectedSegmentIds, strategy, focusDimension, scoreHistory }} params
 * @param {{ onComplete }} options
 */
async function executeRecompose(projectId, params, { onComplete } = {}) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const config = fileService.readJson(path.join(found.fullPath, 'config.json'))
  const taskId = uuidv4()

  setImmediate(() => _doRecompose(projectId, found.fullPath, config, params, taskId, onComplete))

  return { taskId }
}

/**
 * Save a recomposed Skill as a new Skill asset with provenance tracking.
 *
 * @param {string} projectId
 * @param {{ content, meta: { name, purpose, provider, description? } }} params
 * @returns {{ skillId, version }}
 */
async function saveRecomposedSkill(projectId, { content, meta }) {
  if (!content) throw { code: 'INVALID_PARAMS', message: 'content is required' }
  if (!meta || !meta.name || !meta.purpose || !meta.provider) {
    throw { code: 'INVALID_PARAMS', message: 'meta.name, meta.purpose, meta.provider are required' }
  }

  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const projectPath = found.fullPath
  const config = fileService.readJson(path.join(projectPath, 'config.json'))
  const report = fileService.readJson(path.join(projectPath, 'analysis_report.json'))

  // Import as a new Skill via skill-service
  const skillService = require('./skill-service')
  const importResult = skillService.importSkill({
    importType: 'text',
    content,
    meta: {
      name:        meta.name,
      purpose:     meta.purpose,
      provider:    meta.provider,
      description: meta.description || '',
      source:      'recomposed',
    },
  })

  // Build provenance.json
  const allSegments = report ? (report.advantage_segments || []) : []
  const sourceSkillMap = new Map()
  for (const seg of allSegments) {
    if (!sourceSkillMap.has(seg.skill_id)) {
      // Find version from project config skills list
      const skillRef = (config && config.skills || []).find(s => s.ref_id === seg.skill_id)
      sourceSkillMap.set(seg.skill_id, {
        skill_id:             seg.skill_id,
        skill_name:           seg.skill_name,
        skill_version:        skillRef ? skillRef.version : 'v1',
        contributed_segments: [],
      })
    }
    sourceSkillMap.get(seg.skill_id).contributed_segments.push(seg.id)
  }

  const provenance = {
    type:                  'recomposed',
    source_project_id:     projectId,
    source_project_name:   config ? config.name : '',
    recomposition_strategy: '保留功能正确性最高Skill的角色设定和输出格式，融合健壮性最高Skill的约束条件',
    user_retention_rules:  '',
    source_skills:         [...sourceSkillMap.values()],
    created_at:            new Date().toISOString(),
  }

  fileService.writeJson(path.join(importResult.path, 'provenance.json'), provenance)

  logService.info('recompose-service', 'Recomposed skill saved', {
    projectId, skillId: importResult.skillId,
  })

  return { skillId: importResult.skillId, version: importResult.version }
}

module.exports = {
  executeRecompose,
  saveRecomposedSkill,
  buildRecomposePrompt,   // exported for testing
  buildMetaPromptTail,    // exported for testing
}
