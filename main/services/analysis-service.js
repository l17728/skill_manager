'use strict'

/**
 * analysis-service.js — Phase 4 Module 7: Auto Difference Analysis
 *
 * Reads test results from a completed project, builds a structured analysis
 * prompt, calls the CLI, parses the structured JSON output, and writes
 * analysis_report.json to the project directory.
 *
 * Exports: runAnalysis, getReport, exportReport
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fileService      = require('./file-service')
const workspaceService = require('./workspace-service')
const cliService       = require('./cli-service')
const logService       = require('./log-service')

// ─── Analysis Prompt Template ───────────────────────────────────────────────

const ANALYSIS_PROMPT = `你是一位专业的代码生成 Prompt 工程师。请对以下多个 Skill 的测试结果进行横向对比分析，识别各 Skill 的优势片段与不足，生成结构化分析报告。

【测试基线描述】
基线名称：{baseline_name}
用例数量：{case_count}条

{iteration_context}【各 Skill 提示词原文】
{skills_content}

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
仅输出 JSON，不要包含任何 JSON 以外的文字或 Markdown 代码块标记

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
}`

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

const DIMS = [
  'functional_correctness', 'robustness', 'readability',
  'conciseness', 'complexity_control', 'format_compliance',
]
const DIM_LABELS = {
  functional_correctness: '功能正确性(30)',
  robustness:             '健壮性(20)',
  readability:            '可读性(15)',
  conciseness:            '简洁性(15)',
  complexity_control:     '复杂度控制(10)',
  format_compliance:      '格式规范(10)',
}

/**
 * Build the analysis prompt string from project test data.
 */
function buildAnalysisPrompt(projectPath, config) {
  const summary = fileService.readJson(path.join(projectPath, 'results', 'summary.json'))
  if (!summary) throw { code: 'NO_RESULTS', message: 'Test summary not found. Run tests first.' }

  const baselineName = (config.baselines && config.baselines[0]) ? config.baselines[0].name : 'unknown'
  const totalCases   = summary.total_cases || 0
  const ranking      = summary.ranking || []

  // Build iteration context block (only injected when original_skill_ids is set)
  const originalIds = new Set(config.original_skill_ids || [])
  const hasIterationCandidate = originalIds.size > 0 &&
    (config.skills || []).some(s => !originalIds.has(s.ref_id))

  let iterationContext = ''
  if (hasIterationCandidate) {
    const origNames  = (config.skills || []).filter(s =>  originalIds.has(s.ref_id)).map(s => s.name)
    const candNames  = (config.skills || []).filter(s => !originalIds.has(s.ref_id)).map(s => s.name)
    iterationContext = [
      '【迭代背景】',
      `本次分析包含原始参照Skill（${origNames.join('、')}）和当前迭代候选Skill（${candNames.join('、')}）。`,
      '在提取优势片段时，请优先考虑迭代候选Skill相较原始Skill的改进之处；',
      '若迭代候选Skill在某维度仍不如原始Skill，请在issues中明确指出。',
      '',
    ].join('\n')
  }

  // Skill content section
  const skillContents = (config.skills || []).map(skillRef => {
    const content  = fileService.readText(path.join(projectPath, skillRef.local_path, 'content.txt')) || ''
    const roleTag  = originalIds.size > 0
      ? (originalIds.has(skillRef.ref_id) ? '【原始参照】' : '【迭代候选】')
      : ''
    return `Skill: ${skillRef.name}${roleTag}（ID: ${skillRef.ref_id}）\n${content}`
  })

  // Score summary
  const scoreSummary = ranking.map(r => {
    const roleTag = originalIds.size > 0
      ? (originalIds.has(r.skill_id) ? '（原始）' : '（迭代候选）')
      : ''
    return `- ${r.skill_name}${roleTag}（ID: ${r.skill_id}）：平均总分 ${r.avg_score}，` +
      `完成 ${r.completed_cases}/${totalCases} 条` +
      (r.failed_cases > 0 ? `（${r.failed_cases}条失败）` : '')
  }).join('\n')

  // Dimension table
  const header = `维度\t${ranking.map(r => r.skill_name).join('\t')}`
  const rows = DIMS.map(dim => {
    const vals = ranking.map(r =>
      (r.score_breakdown && r.score_breakdown[dim] != null)
        ? r.score_breakdown[dim].toFixed(1)
        : '0.0'
    )
    return `${DIM_LABELS[dim]}\t${vals.join('\t')}`
  })
  const dimTable = [header, ...rows].join('\n')

  // Top diff cases (greatest score spread across skills)
  const caseScores = {} // case_id → { skillId → total }
  for (const skillRef of (config.skills || [])) {
    const skillDir = path.basename(skillRef.local_path)
    const resultDir = path.join(projectPath, 'results', skillDir)
    for (const file of fileService.listFiles(resultDir)) {
      if (!file.endsWith('.json')) continue
      const rec = fileService.readJson(path.join(resultDir, file))
      if (!rec || !rec.scores) continue
      if (!caseScores[rec.case_id]) caseScores[rec.case_id] = {}
      caseScores[rec.case_id][skillRef.ref_id] = rec.scores.total
    }
  }

  const topDiff = Object.entries(caseScores)
    .filter(([, sc]) => Object.keys(sc).length > 1)
    .map(([caseId, sc]) => {
      const vals = Object.values(sc).filter(v => v != null)
      return { caseId, sc, diff: vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0 }
    })
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3)

  const topDiffText = topDiff.length > 0
    ? topDiff.map(({ caseId, sc }) => {
        const lines = [`用例 ${caseId}：`]
        for (const skillRef of (config.skills || [])) {
          lines.push(`  ${skillRef.name}（总分${sc[skillRef.ref_id] ?? 'N/A'}）`)
        }
        return lines.join('\n')
      }).join('\n\n')
    : '无足够数据对比'

  return ANALYSIS_PROMPT
    .replace('{baseline_name}',          baselineName)
    .replace('{case_count}',             String(totalCases))
    .replace('{iteration_context}',      iterationContext)
    .replace('{skills_content}',         skillContents.join('\n\n---\n\n'))
    .replace('{skills_score_summary}',   scoreSummary)
    .replace('{dimension_scores_table}', dimTable)
    .replace('{top_diff_cases}',         topDiffText)
}

/**
 * Background analysis task.
 */
async function _doRunAnalysis(projectId, projectPath, config, taskId, onComplete) {
  try {
    const globalCfg = _getGlobalConfig()
    const prompt    = buildAnalysisPrompt(projectPath, config)

    const cliResult = await cliService.invokeCli(prompt, {
      model:     globalCfg.default_model || 'claude-opus-4-6',
      workingDir: path.join(projectPath, '.claude'),
      timeoutMs: 60000,
    })

    const parsed = cliService.parseStructuredOutput(cliResult.result || '')

    const report = {
      project_id:         projectId,
      generated_at:       new Date().toISOString(),
      best_skill_id:      parsed.best_skill_id   || '',
      best_skill_name:    parsed.best_skill_name  || '',
      dimension_leaders:  parsed.dimension_leaders || {},
      advantage_segments: parsed.advantage_segments || [],
      issues:             parsed.issues || [],
    }

    fileService.writeJson(path.join(projectPath, 'analysis_report.json'), report)
    logService.info('analysis-service', 'Analysis completed', { projectId })

    if (onComplete) onComplete({ projectId, taskId, status: 'completed' })
  } catch (err) {
    const errCode   = (err && err.code)    || 'UNKNOWN'
    const errMsg    = (err && err.message) || ''
    const errDetail = [errCode, errMsg].filter(Boolean).join(': ') || String(err)
    logService.error('analysis-service', 'Analysis failed', { projectId, errCode, errMsg, errDetail })
    if (onComplete) onComplete({ projectId, taskId, status: 'failed', error: errDetail })
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run difference analysis for a completed project.
 * Returns { taskId } immediately; result delivered via onComplete callback.
 */
async function runAnalysis(projectId, { onComplete } = {}) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const config = fileService.readJson(path.join(found.fullPath, 'config.json'))
  if (!config) throw { code: 'NOT_FOUND', message: 'Project config missing' }

  const taskId = uuidv4()
  logService.info('analysis-service', 'Analysis started', { projectId, taskId, skillCount: (config.skills || []).length })
  setImmediate(() => _doRunAnalysis(projectId, found.fullPath, config, taskId, onComplete))

  return { taskId }
}

/**
 * Get the analysis report for a project.
 */
function getReport(projectId) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }

  const report = fileService.readJson(path.join(found.fullPath, 'analysis_report.json'))
  if (!report) throw { code: 'NOT_FOUND', message: 'Analysis report not found. Run analysis first.' }

  return report
}

/**
 * Export the analysis report to a file (json or md).
 */
function exportReport(projectId, { format = 'json', destPath }) {
  const report = getReport(projectId)
  fileService.ensureDir(path.dirname(destPath))

  if (format === 'md') {
    fileService.writeText(destPath, _toMarkdown(report))
  } else {
    fileService.writeJson(destPath, report)
  }

  return { exportedPath: destPath }
}

function _toMarkdown(report) {
  const lines = [
    `# 差异分析报告`,
    ``,
    `**项目 ID**: ${report.project_id}`,
    `**生成时间**: ${report.generated_at}`,
    `**最优 Skill**: ${report.best_skill_name} (${report.best_skill_id})`,
    ``,
    `## 优势片段`,
  ]
  for (const seg of (report.advantage_segments || [])) {
    lines.push(``, `### ${seg.id} — ${seg.type} (来自 ${seg.skill_name})`)
    lines.push(`> ${seg.content}`)
    lines.push(`**维度**: ${seg.dimension}　**理由**: ${seg.reason}`)
  }
  lines.push(``, `## 问题点`)
  for (const issue of (report.issues || [])) {
    lines.push(`- **${issue.skill_name}** (${issue.dimension}): ${issue.description}`)
  }
  return lines.join('\n')
}

module.exports = {
  runAnalysis,
  getReport,
  exportReport,
  buildAnalysisPrompt,   // exported for testing
}
