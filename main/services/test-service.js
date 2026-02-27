'use strict'

/**
 * test-service.js — Phase 3: Automated Comparative Testing
 *
 * Provides parallel per-skill test execution (skills run concurrently, cases
 * within each skill run sequentially), pause/resume/stop, per-task result
 * writing, code-quality scoring, and progress callbacks.
 *
 * In-memory state lives in _runState (Map<projectId → RunState>).
 * Checkpoint is persisted to project config.json after each task.
 * Each skill uses an isolated workingDir under .claude/ to avoid session conflicts.
 */

const path = require('path')
const fileService  = require('./file-service')
const workspaceService = require('./workspace-service')
const cliService   = require('./cli-service')
const logService   = require('./log-service')

// In-memory run state per project
const _runState = new Map()

// ─── Scoring Prompt ────────────────────────────────────────────────────────

const SCORE_PROMPT_TEMPLATE = `你是一位专业的代码质量评审专家。请根据以下评判标准，对代码生成结果进行客观评分。

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
}`

// ─── Internal Helpers ──────────────────────────────────────────────────────

function _findProjectDir(projectId) {
  const allDirs = workspaceService.listAllProjectDirs()
  for (const { dir, fullPath } of allDirs) {
    const cfg = fileService.readJson(path.join(fullPath, 'config.json'))
    if (cfg && cfg.id === projectId) return { dir, fullPath }
  }
  return null
}

function _getGlobalConfig() {
  const cfg = fileService.readJson(workspaceService.paths.cliConfig())
  return cfg || { cli_path: 'claude', default_model: 'claude-opus-4-6', default_timeout_seconds: 60 }
}

/**
 * Build the flat task list: skill × case pairs.
 * Returns an array of task objects to be executed serially.
 */
function _buildTaskList(projectPath, config) {
  const tasks = []
  for (const skillRef of (config.skills || [])) {
    const skillDir     = path.basename(skillRef.local_path)
    const skillPath    = path.join(projectPath, skillRef.local_path)
    const skillContent = fileService.readText(path.join(skillPath, 'content.txt')) || ''

    for (const baselineRef of (config.baselines || [])) {
      const baselinePath = path.join(projectPath, baselineRef.local_path)
      const casesData    = fileService.readJson(path.join(baselinePath, 'cases.json'))
      const cases        = (casesData && casesData.cases) || []

      const resultDir = path.join(projectPath, 'results', skillDir)
      fileService.ensureDir(resultDir)

      for (const caseItem of cases) {
        tasks.push({
          skillRef,
          skillDir,
          skillContent,
          baselineRef,
          caseItem,
          resultPath: path.join(resultDir, `${caseItem.case_id}.json`),
        })
      }
    }
  }
  return tasks
}

/**
 * Persist current progress to project config.json.
 */
function _saveCheckpoint(projectPath, state) {
  const configPath = path.join(projectPath, 'config.json')
  const config = fileService.readJson(configPath)
  if (!config) return
  config.progress = {
    total_tasks:      state.tasks.length,
    completed_tasks:  state.completedTasks,
    failed_tasks:     state.failedTasks,
    last_checkpoint:  state.completedTasks + state.failedTasks,
  }
  config.updated_at = new Date().toISOString()
  fileService.writeJson(configPath, config)
}

/**
 * Score a single test result using the 6-dimension rubric.
 * Failure here is non-fatal — caller catches and leaves scores null.
 */
async function _scoreResult(caseItem, actualOutput, workingDir) {
  const globalCfg = _getGlobalConfig()
  const prompt = SCORE_PROMPT_TEMPLATE
    .replace('{test_input}',      caseItem.input || '')
    .replace('{expected_output}', caseItem.expected_output || '')
    .replace('{actual_output}',   actualOutput || '')

  const cliResult = await cliService.invokeCli(prompt, {
    model:     globalCfg.default_model || 'claude-opus-4-6',
    workingDir,
    timeoutMs: 30000,
  })
  return cliService.parseStructuredOutput(cliResult.result || '')
}

/**
 * Execute one task: test execution + result writing + scoring.
 * Never throws — failures are captured as status:'failed' records.
 */
async function _executeTask(task, projectPath, config) {
  const { skillRef, skillContent, caseItem, baselineRef, resultPath } = task
  const model      = config.cli_config.model || 'claude-opus-4-6'
  const timeoutMs  = (config.cli_config.timeout_seconds || 60) * 1000
  const workingDir = path.join(projectPath, '.claude', `skill_${skillRef.ref_id.slice(0, 8)}`)
  fileService.ensureDir(workingDir)

  logService.info('test-service', 'task start', { skillId: skillRef.ref_id, caseId: caseItem.case_id, model })

  let actual_output = ''
  let duration_ms   = 0
  let error         = null
  let status        = 'completed'

  try {
    const cliResult = await cliService.invokeCli(caseItem.input, {
      model,
      systemPrompt: skillContent,
      workingDir,
      timeoutMs,
    })
    actual_output = cliResult.result || ''
    duration_ms   = cliResult.duration_ms || 0
  } catch (err) {
    status = 'failed'
    error  = (err && (err.message || err.code)) ? (err.message || err.code) : String(err)
    logService.error('test-service', 'task execution failed', { skillId: skillRef.ref_id, caseId: caseItem.case_id, errCode: err.code, errMsg: error })
  }

  const cliVersion = await cliService.getCliVersion()

  const resultRecord = {
    case_id:          caseItem.case_id,
    skill_id:         skillRef.ref_id,
    skill_version:    skillRef.version,
    baseline_id:      baselineRef.ref_id,
    baseline_version: baselineRef.version,
    executed_at:      new Date().toISOString(),
    status,
    input:            caseItem.input || '',
    expected_output:  caseItem.expected_output || '',
    actual_output,
    duration_ms,
    cli_version:      cliVersion,
    model_version:    model,
    error,
    scores:           null,
    score_reasoning:  '',
    score_evaluated_at: null,
  }

  // Score only successful executions; scoring failure is non-fatal
  if (status === 'completed') {
    try {
      const scored = await _scoreResult(caseItem, actual_output, workingDir)
      resultRecord.scores           = scored.scores || null
      resultRecord.score_reasoning  = scored.reasoning || ''
      resultRecord.score_evaluated_at = new Date().toISOString()
      logService.info('test-service', 'task scored', { skillId: skillRef.ref_id, caseId: caseItem.case_id, total: scored.scores && scored.scores.total })
    } catch (scoreErr) {
      logService.warn('test-service', 'scoring failed (non-fatal)', { skillId: skillRef.ref_id, caseId: caseItem.case_id, errCode: scoreErr.code, errMsg: scoreErr.message || String(scoreErr) })
      // Leave scores as null
    }
  }

  fileService.writeJson(resultPath, resultRecord)
  return resultRecord
}

/**
 * Write summary.json aggregating avg scores and ranking for all skills.
 */
function _writeSummary(projectId, projectPath, config, state) {
  const skillMap = new Map()
  for (const task of state.tasks) {
    const sid = task.skillRef.ref_id
    if (!skillMap.has(sid)) {
      skillMap.set(sid, {
        skill_id:   sid,
        skill_name: task.skillRef.name,
        skill_version: task.skillRef.version,
        completed_cases: 0,
        failed_cases: 0,
        total_score: 0,
        scored_cases: 0,
        score_breakdown: {
          functional_correctness: 0, robustness: 0, readability: 0,
          conciseness: 0, complexity_control: 0, format_compliance: 0,
        },
      })
    }
    const record = fileService.readJson(task.resultPath)
    if (!record) continue
    const entry = skillMap.get(sid)
    if (record.status === 'completed') {
      entry.completed_cases++
      if (record.scores && record.scores.total != null) {
        entry.total_score += record.scores.total
        entry.scored_cases++
        const bd = entry.score_breakdown
        const s  = record.scores
        bd.functional_correctness += (s.functional_correctness || 0)
        bd.robustness             += (s.robustness || 0)
        bd.readability            += (s.readability || 0)
        bd.conciseness            += (s.conciseness || 0)
        bd.complexity_control     += (s.complexity_control || 0)
        bd.format_compliance      += (s.format_compliance || 0)
      }
    } else {
      entry.failed_cases++
    }
  }

  const ranking = []
  for (const [, entry] of skillMap) {
    const d        = entry.scored_cases || 1
    const avg_score = entry.scored_cases > 0
      ? Math.round((entry.total_score / entry.scored_cases) * 10) / 10
      : 0
    const bd = entry.score_breakdown
    ranking.push({
      skill_id:        entry.skill_id,
      skill_name:      entry.skill_name,
      skill_version:   entry.skill_version,
      completed_cases: entry.completed_cases,
      failed_cases:    entry.failed_cases,
      avg_score,
      score_breakdown: {
        functional_correctness: Math.round(bd.functional_correctness / d * 10) / 10,
        robustness:             Math.round(bd.robustness / d * 10) / 10,
        readability:            Math.round(bd.readability / d * 10) / 10,
        conciseness:            Math.round(bd.conciseness / d * 10) / 10,
        complexity_control:     Math.round(bd.complexity_control / d * 10) / 10,
        format_compliance:      Math.round(bd.format_compliance / d * 10) / 10,
      },
    })
  }

  ranking.sort((a, b) => b.avg_score - a.avg_score || b.completed_cases - a.completed_cases)
  ranking.forEach((r, i) => { r.rank = i + 1 })

  // total_cases = cases per skill (from first baseline)
  const firstSkillTasks = state.tasks.filter(t => t.skillRef.ref_id === (ranking[0] && ranking[0].skill_id))
  const summary = {
    project_id:   projectId,
    generated_at: new Date().toISOString(),
    total_cases:  firstSkillTasks.length,
    ranking,
  }
  fileService.writeJson(path.join(projectPath, 'results', 'summary.json'), summary)
}

/**
 * Parallel execution loop: skills run concurrently; cases within each skill
 * run sequentially. Each skill uses an isolated .claude/ subdirectory.
 * Runs in the background via setImmediate.
 */
async function _runLoop(projectId, projectPath, config, state, onProgress) {
  // Group tasks by skill for parallel execution
  const skillGroups = new Map()
  for (const task of state.tasks) {
    const sid = task.skillRef.ref_id
    if (!skillGroups.has(sid)) skillGroups.set(sid, [])
    skillGroups.get(sid).push(task)
  }

  logService.info('test-service', 'Parallel run started', {
    projectId, skillCount: skillGroups.size, totalTasks: state.tasks.length,
  })

  // Each skill runs its cases sequentially; skills run in parallel
  await Promise.all([...skillGroups.entries()].map(async ([skillId, skillTasks]) => {
    logService.info('test-service', 'Skill stream started', {
      projectId, skillId, taskCount: skillTasks.length,
    })

    for (const task of skillTasks) {
      if (state.status === 'paused' || state.status === 'interrupted') break

      // Skip already-processed tasks — enables idempotent resume
      if (fileService.readJson(task.resultPath)) continue

      const resultRecord = await _executeTask(task, projectPath, config)

      if (resultRecord.status === 'completed') state.completedTasks++
      else state.failedTasks++

      _saveCheckpoint(projectPath, state)

      if (onProgress) {
        onProgress({
          projectId,
          completedTasks: state.completedTasks,
          totalTasks:     state.tasks.length,
          failedTasks:    state.failedTasks,
          lastResult: {
            skillId: task.skillRef.ref_id,
            caseId:  task.caseItem.case_id,
            status:  resultRecord.status,
            score:   resultRecord.scores ? resultRecord.scores.total : undefined,
          },
          projectStatus: 'running',
        })
      }
    }

    logService.info('test-service', 'Skill stream completed', { projectId, skillId })
  }))

  // All skill streams finished — either all done, or paused/stopped
  if (state.status !== 'paused' && state.status !== 'interrupted') {
    state.status = 'completed'

    const configPath = path.join(projectPath, 'config.json')
    const cfg = fileService.readJson(configPath)
    if (cfg) {
      cfg.status   = 'completed'
      cfg.progress = {
        total_tasks:     state.tasks.length,
        completed_tasks: state.completedTasks,
        failed_tasks:    state.failedTasks,
        last_checkpoint: state.completedTasks + state.failedTasks,
      }
      cfg.updated_at = new Date().toISOString()
      fileService.writeJson(configPath, cfg)
    }

    _writeSummary(projectId, projectPath, config, state)
    _runState.delete(projectId)

    if (onProgress) {
      onProgress({
        projectId,
        completedTasks: state.completedTasks,
        totalTasks:     state.tasks.length,
        failedTasks:    state.failedTasks,
        projectStatus:  'completed',
      })
    }

    logService.info('test-service', 'Test run completed', {
      projectId, completed: state.completedTasks, failed: state.failedTasks,
    })
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Start test execution. Returns immediately; loop runs via setImmediate.
 * Progress is delivered via onProgress callback.
 */
async function startTest(projectId, { onProgress } = {}) {
  const existing = _runState.get(projectId)
  if (existing && existing.status === 'running') {
    throw { code: 'ALREADY_RUNNING' }
  }

  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }
  const { fullPath: projectPath } = found

  const config = fileService.readJson(path.join(projectPath, 'config.json'))
  if (!config) throw { code: 'NOT_FOUND', message: 'Project config missing' }

  const tasks = _buildTaskList(projectPath, config)
  const state = {
    status:         'running',
    tasks,
    completedTasks: 0,
    failedTasks:    0,
  }
  _runState.set(projectId, state)

  const configPath = path.join(projectPath, 'config.json')
  config.status     = 'running'
  config.updated_at = new Date().toISOString()
  fileService.writeJson(configPath, config)

  logService.info('test-service', 'Test run started', { projectId, totalTasks: tasks.length })

  // Run loop in background — non-blocking return
  setImmediate(() => _runLoop(projectId, projectPath, config, state, onProgress))

  return { started: true }
}

/**
 * Pause a running test. Sets status to 'paused'; loop will break on next iteration.
 */
function pauseTest(projectId) {
  const state = _runState.get(projectId)
  if (!state || state.status !== 'running') {
    throw { code: 'NOT_RUNNING', message: 'No running test for this project' }
  }
  state.status = 'paused'
  logService.info('test-service', 'Test paused', { projectId, completedTasks: state.completedTasks, totalTasks: state.tasks.length })

  const found = _findProjectDir(projectId)
  if (found) {
    const configPath = path.join(found.fullPath, 'config.json')
    const cfg = fileService.readJson(configPath)
    if (cfg) {
      cfg.status     = 'paused'
      cfg.progress   = {
        total_tasks:     state.tasks.length,
        completed_tasks: state.completedTasks,
        failed_tasks:    state.failedTasks,
        last_checkpoint: state.completedTasks + state.failedTasks,
      }
      cfg.updated_at = new Date().toISOString()
      fileService.writeJson(configPath, cfg)
    }
  }

  return { paused: true, checkpoint: String(state.completedTasks + state.failedTasks) }
}

/**
 * Resume a paused test. Restarts the loop from the current checkpoint.
 */
async function resumeTest(projectId, { onProgress } = {}) {
  const state = _runState.get(projectId)
  if (!state || state.status !== 'paused') {
    throw { code: 'NOT_PAUSED', message: 'No paused test for this project' }
  }
  state.status = 'running'
  const remaining = state.tasks.length - state.completedTasks - state.failedTasks
  logService.info('test-service', 'Test resumed', { projectId, remainingTasks: remaining })

  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }
  const { fullPath: projectPath } = found

  const config = fileService.readJson(path.join(projectPath, 'config.json'))

  const configPath = path.join(projectPath, 'config.json')
  config.status     = 'running'
  config.updated_at = new Date().toISOString()
  fileService.writeJson(configPath, config)

  setImmediate(() => _runLoop(projectId, projectPath, config, state, onProgress))

  return { resumed: true, remainingTasks: remaining }
}

/**
 * Stop (interrupt) a running or paused test.
 */
function stopTest(projectId) {
  const state = _runState.get(projectId)
  if (!state) {
    throw { code: 'NOT_RUNNING', message: 'No active test for this project' }
  }
  state.status = 'interrupted'
  _runState.delete(projectId)
  logService.info('test-service', 'Test stopped', { projectId })

  const found = _findProjectDir(projectId)
  if (found) {
    const configPath = path.join(found.fullPath, 'config.json')
    const cfg = fileService.readJson(configPath)
    if (cfg) {
      cfg.status     = 'interrupted'
      cfg.progress   = {
        total_tasks:     state.tasks.length,
        completed_tasks: state.completedTasks,
        failed_tasks:    state.failedTasks,
        last_checkpoint: state.completedTasks + state.failedTasks,
      }
      cfg.updated_at = new Date().toISOString()
      fileService.writeJson(configPath, cfg)
    }
  }

  return { stopped: true }
}

/**
 * Get current execution progress for a project.
 */
function getProgress(projectId) {
  const state = _runState.get(projectId)
  if (!state) {
    // Fall back to disk state
    const found = _findProjectDir(projectId)
    if (!found) throw { code: 'NOT_FOUND' }
    const config = fileService.readJson(path.join(found.fullPath, 'config.json'))
    if (!config) throw { code: 'NOT_FOUND' }
    return {
      status:         config.status || 'pending',
      totalTasks:     config.progress ? config.progress.total_tasks : 0,
      completedTasks: config.progress ? config.progress.completed_tasks : 0,
      failedTasks:    config.progress ? config.progress.failed_tasks : 0,
    }
  }

  return {
    status:         state.status,
    totalTasks:     state.tasks.length,
    completedTasks: state.completedTasks,
    failedTasks:    state.failedTasks,
  }
}

/**
 * Get paginated test results for a project.
 */
function getResults(projectId, { skillId, caseId, status, page = 1, pageSize = 20 } = {}) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }
  const { fullPath: projectPath } = found

  const config = fileService.readJson(path.join(projectPath, 'config.json'))
  if (!config) throw { code: 'NOT_FOUND' }

  const items = []
  for (const skillRef of (config.skills || [])) {
    if (skillId && skillRef.ref_id !== skillId) continue
    const skillDir   = path.basename(skillRef.local_path)
    const resultDir  = path.join(projectPath, 'results', skillDir)
    const files      = fileService.listFiles(resultDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const record = fileService.readJson(path.join(resultDir, file))
      if (!record) continue
      if (caseId && record.case_id !== caseId) continue
      if (status && record.status !== status) continue
      items.push(record)
    }
  }

  const total     = items.length
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
  const summary   = fileService.readJson(path.join(projectPath, 'results', 'summary.json')) || null
  return { items: pageItems, total, page, pageSize, summary }
}

/**
 * Retry a single test case. Returns taskId immediately; progress via onProgress.
 */
async function retryCase(projectId, skillId, caseId, { onProgress } = {}) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }
  const { fullPath: projectPath } = found

  const config = fileService.readJson(path.join(projectPath, 'config.json'))
  if (!config) throw { code: 'NOT_FOUND' }

  const tasks = _buildTaskList(projectPath, config)
  const task  = tasks.find(t => t.skillRef.ref_id === skillId && t.caseItem.case_id === caseId)
  if (!task) throw { code: 'NOT_FOUND', message: 'Task not found' }

  const taskId = `retry_${skillId}_${caseId}_${Date.now()}`
  setImmediate(async () => {
    try {
      const resultRecord = await _executeTask(task, projectPath, config)
      if (onProgress) {
        onProgress({
          projectId, taskId,
          completedTasks: 1, totalTasks: 1,
          failedTasks: resultRecord.status === 'failed' ? 1 : 0,
          lastResult: {
            skillId, caseId,
            status: resultRecord.status,
            score:  resultRecord.scores ? resultRecord.scores.total : undefined,
          },
          projectStatus: 'completed',
        })
      }
    } catch (err) {
      logService.error('test-service', 'retryCase failed', { projectId, taskId, skillId, caseId, errMsg: String(err) })
      if (onProgress) onProgress({ projectId, taskId, projectStatus: 'interrupted' })
    }
  })

  return { taskId }
}

/**
 * Export results to JSON or CSV file.
 */
function exportResults(projectId, { format = 'json', destPath }) {
  const allResults = getResults(projectId, { page: 1, pageSize: 99999 })
  fileService.ensureDir(path.dirname(destPath))

  if (format === 'csv') {
    const headers = [
      'case_id', 'skill_id', 'skill_version', 'status', 'duration_ms',
      'cli_version', 'model_version', 'scores.total',
      'scores.functional_correctness', 'scores.robustness', 'scores.readability',
      'scores.conciseness', 'scores.complexity_control', 'scores.format_compliance', 'error',
    ]
    const rows = allResults.items.map(r => [
      r.case_id, r.skill_id, r.skill_version, r.status, r.duration_ms,
      r.cli_version, r.model_version,
      r.scores ? r.scores.total : '',
      r.scores ? r.scores.functional_correctness : '',
      r.scores ? r.scores.robustness : '',
      r.scores ? r.scores.readability : '',
      r.scores ? r.scores.conciseness : '',
      r.scores ? r.scores.complexity_control : '',
      r.scores ? r.scores.format_compliance : '',
      r.error || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    fileService.writeText(destPath, [headers.join(','), ...rows].join('\n'))
  } else {
    fileService.writeJson(destPath, allResults.items)
  }

  return { exportedPath: destPath }
}

module.exports = {
  startTest,
  pauseTest,
  resumeTest,
  stopTest,
  getProgress,
  getResults,
  retryCase,
  exportResults,
}
