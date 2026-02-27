'use strict'

/**
 * iteration-service.js — Phase 5 Module 9: Iteration Validation Loop
 *
 * Orchestrates multi-round cycles of recompose → test → analyze.
 * Each round generates a new Skill version, tests it, analyzes results,
 * then re-recomposes for the next round. Writes round configs and a final
 * iteration_report.json. Supports pause/stop via in-memory state.
 *
 * Exports: startIteration, pauseIteration, stopIteration, getProgress, getIterationReport
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fileService      = require('./file-service')
const workspaceService = require('./workspace-service')
const logService       = require('./log-service')

// ─── In-memory state ─────────────────────────────────────────────────────────

const _states           = new Map() // iterationId → { paused, stopped }
const _projectToIter    = new Map() // projectId   → iterationId

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _findProjectDir(projectId) {
  for (const { dir, fullPath } of workspaceService.listAllProjectDirs()) {
    const cfg = fileService.readJson(path.join(fullPath, 'config.json'))
    if (cfg && cfg.id === projectId) return { dir, fullPath }
  }
  return null
}

/**
 * Copy a newly-recomposed global Skill into the project's skills/ directory
 * and update config.json so the next round's testService can find it.
 *
 * Strategy:
 *  - Keep all original skills (those in config.original_skill_ids) in config.skills
 *  - Replace any previous iteration candidate (non-original) with the new one
 *  - Name the project-local dir  skill_iter_v<round>/
 *
 * @param {string} projectPath
 * @param {string} skillId      UUID of the newly saved global skill
 * @param {number} round        Round number (used for local dir naming)
 */
function _registerIterationCandidate(projectPath, skillId, round) {
  const skillService = require('./skill-service')
  const found = skillService.findSkillDir(skillId)
  if (!found) throw new Error(`Iteration candidate skill not found: ${skillId}`)

  const meta       = fileService.readJson(path.join(found.fullPath, 'meta.json')) || {}
  const localDir   = `skill_iter_v${round}`
  const destPath   = path.join(projectPath, 'skills', localDir)

  fileService.copyDir(found.fullPath, destPath)

  const configPath = path.join(projectPath, 'config.json')
  const config     = fileService.readJson(configPath)
  const origIds    = new Set(config.original_skill_ids || [])

  // Keep originals, remove any previous iteration candidate, add new one
  const originalSkills = (config.skills || []).filter(s => origIds.has(s.ref_id))
  originalSkills.push({
    ref_id:     skillId,
    name:       meta.name || `迭代Skill-v${round}`,
    purpose:    meta.purpose || 'general',
    provider:   meta.provider || 'iteration',
    version:    meta.version || 'v1',
    local_path: `skills/${localDir}`,
  })

  config.skills = originalSkills
  fileService.writeJson(configPath, config)
}

// ─── Strategy Profiles ───────────────────────────────────────────────────────

const STRATEGIES = ['GREEDY', 'DIMENSION_FOCUS', 'SEGMENT_EXPLORE', 'CROSS_POLLINATE', 'RANDOM_SUBSET']

/**
 * Select strategies for the current round based on beam width and plateau level.
 * Always returns exactly `beamWidth` strategy names.
 */
function _selectStrategies(round, plateauLevel, beamWidth) {
  if (beamWidth <= 1) return ['GREEDY']

  if (plateauLevel === 0) return ['GREEDY',          'DIMENSION_FOCUS']
  if (plateauLevel === 1) return ['GREEDY',          'SEGMENT_EXPLORE']
  if (plateauLevel === 2) return ['CROSS_POLLINATE', 'DIMENSION_FOCUS']
  /*  plateauLevel >= 3 */ return ['RANDOM_SUBSET',  'SEGMENT_EXPLORE']
}

/**
 * Detect plateau level from recent score history.
 * Returns 0 (no plateau), 1 (mild), 2 (moderate), or 3 (severe).
 */
function _detectPlateauLevel(rounds, threshold, consecutiveLimit) {
  if (rounds.length < 2) return 0
  let plateauCount = 0
  for (let i = rounds.length - 1; i >= 1; i--) {
    const delta = rounds[i].score_delta
    if (delta == null || Math.abs(delta) < threshold) plateauCount++
    else break
  }
  if (plateauCount === 0) return 0
  if (plateauCount < consecutiveLimit) return 1
  if (plateauCount < consecutiveLimit * 2) return 2
  return 3
}

/**
 * Find the dimension with the lowest avg score across recent rounds.
 * Used by DIMENSION_FOCUS strategy.
 */
function _findWeakestDimension(rounds) {
  if (rounds.length === 0) return 'functional_correctness'
  const latest = rounds[rounds.length - 1].score_breakdown || {}
  const maxValues = {
    functional_correctness: 30, robustness: 20, readability: 15,
    conciseness: 15, complexity_control: 10, format_compliance: 10,
  }
  let weakest = 'functional_correctness'
  let lowestRatio = Infinity
  for (const [dim, max] of Object.entries(maxValues)) {
    const score = latest[dim] != null ? latest[dim] : 0
    const ratio = score / max
    if (ratio < lowestRatio) { lowestRatio = ratio; weakest = dim }
  }
  return weakest
}

// ─── Round Execution ─────────────────────────────────────────────────────────

/**
 * Run test + analysis for the current project config.
 * Returns { avgScore, scoreBreakdown, candidateSkillId }.
 *
 * candidateSkillId = the iteration candidate's ref_id from project config
 * (the non-original skill that was tested this round).
 */
async function _doOneRound(projectId, projectPath, round, currentSkillId, retentionRules) {
  const roundDir = path.join(projectPath, 'iterations', `round_${round}`)
  fileService.ensureDir(roundDir)

  fileService.writeJson(path.join(roundDir, 'config.json'), {
    round,
    skill_id:        currentSkillId,
    skill_name:      `迭代Skill-v${round}`,
    skill_version:   'v1',
    retention_rules: retentionRules || '',
    started_at:      new Date().toISOString(),
    status:          'running',
  })

  // Step 1: Run tests (wait for projectStatus: 'completed')
  const testService = require('./test-service')
  await new Promise((resolve, reject) => {
    testService.startTest(projectId, {
      onProgress: (data) => {
        if (data.projectStatus === 'completed')   resolve(data)
        if (data.projectStatus === 'interrupted') reject(new Error('Test interrupted'))
      },
    }).catch(reject)
  })

  // Step 2: Run analysis (wait for status: 'completed')
  const analysisService = require('./analysis-service')
  await new Promise((resolve, reject) => {
    analysisService.runAnalysis(projectId, {
      onComplete: (data) => {
        if (data.status === 'completed') resolve(data)
        else reject(new Error(data.error || 'Analysis failed'))
      },
    }).catch(reject)
  })

  // Step 3: Read avg_score — prefer the iteration candidate's score
  const summary   = fileService.readJson(path.join(projectPath, 'results', 'summary.json'))
  const ranking   = (summary && summary.ranking) || []
  const config    = fileService.readJson(path.join(projectPath, 'config.json'))
  const origIds   = new Set(config.original_skill_ids || [])

  // Find the iteration candidate entry (non-original with highest score)
  const candidate = ranking.find(r => !origIds.has(r.skill_id)) || ranking[0] || {}
  const avgScore       = candidate.avg_score || 0
  const scoreBreakdown = candidate.score_breakdown || {}

  fileService.writeJson(path.join(roundDir, 'config.json'), {
    round,
    skill_id:        currentSkillId,
    skill_name:      `迭代Skill-v${round}`,
    skill_version:   'v1',
    retention_rules: retentionRules || '',
    avg_score:       avgScore,
    started_at:      new Date().toISOString(),
    completed_at:    new Date().toISOString(),
    status:          'completed',
  })

  return { avgScore, scoreBreakdown }
}

/**
 * Recompose + register + test a single candidate with a given strategy.
 * Returns { skillId, strategy, avgScore, scoreBreakdown } for exploration_log.
 */
async function _doBeamCandidate(projectId, projectPath, round, candidateNum,
  strategy, focusDimension, params, scoreHistory) {
  const recomposeService = require('./recompose-service')

  const recompResult = await new Promise((resolve, reject) => {
    recomposeService.executeRecompose(
      projectId,
      { ...params, strategy, focusDimension, scoreHistory },
      {
        onComplete: (data) => {
          if (data.status === 'completed') resolve(data)
          else reject(new Error(data.error || 'Recompose failed'))
        },
      },
    ).catch(reject)
  })

  const nextRoundNum = round + 1
  const savedSkill   = await recomposeService.saveRecomposedSkill(projectId, {
    content: recompResult.preview.content,
    meta: {
      name:     `迭代Skill-v${nextRoundNum}-c${candidateNum}`,
      purpose:  'general',
      provider: 'iteration',
    },
  })

  // Register candidate and test it
  _registerIterationCandidate(projectPath, savedSkill.skillId, nextRoundNum)

  const testService = require('./test-service')
  await new Promise((resolve, reject) => {
    testService.startTest(projectId, {
      onProgress: (data) => {
        if (data.projectStatus === 'completed')   resolve(data)
        if (data.projectStatus === 'interrupted') reject(new Error('Test interrupted'))
      },
    }).catch(reject)
  })

  const summary   = fileService.readJson(path.join(projectPath, 'results', 'summary.json'))
  const config    = fileService.readJson(path.join(projectPath, 'config.json'))
  const origIds   = new Set(config.original_skill_ids || [])
  const ranking   = (summary && summary.ranking) || []
  const candEntry = ranking.find(r => r.skill_id === savedSkill.skillId)
    || ranking.find(r => !origIds.has(r.skill_id))
    || {}

  return {
    strategy,
    skill_id:        savedSkill.skillId,
    avg_score:       candEntry.avg_score || 0,
    score_breakdown: candEntry.score_breakdown || {},
    won:             false,
  }
}

/**
 * Main iteration loop — runs in the background via setImmediate.
 */
async function _doIteration(projectId, projectPath, config, params, iterationId, onRoundComplete, onAllComplete) {
  const {
    recomposedSkillId,
    maxRounds               = 3,
    stopThreshold           = null,
    retentionRules          = '',
    selectedSegmentIds      = [],
    beamWidth               = 1,
    plateauThreshold        = 1.0,
    plateauRoundsBeforeEscape = 2,
  } = params

  const rounds        = []        // summary entries written to iteration_report
  const explorationLog = {        // full candidate history
    project_id:               projectId,
    started_at:               new Date().toISOString(),
    params:                   { maxRounds, beamWidth, plateauThreshold, stopThreshold },
    original_skill_ids:       config.original_skill_ids || [],
    rounds:                   [],
    best_ever:                null,
  }

  let currentSkillId  = recomposedSkillId
  let stopReason      = 'max_rounds'
  const state         = _states.get(iterationId) || {}

  for (let round = 1; round <= maxRounds; round++) {
    if (state.stopped) { stopReason = 'manual'; break }
    if (state.paused)  { stopReason = 'paused';  break }

    try {
      const { avgScore, scoreBreakdown } = await _doOneRound(
        projectId, projectPath, round, currentSkillId, retentionRules,
      )

      const scoreDelta    = rounds.length > 0 ? avgScore - rounds[rounds.length - 1].avg_score : null
      const plateauLevel  = _detectPlateauLevel(
        [...rounds, { avg_score: avgScore, score_delta: scoreDelta, score_breakdown: scoreBreakdown }],
        plateauThreshold, plateauRoundsBeforeEscape,
      )

      rounds.push({
        round,
        strategy:        'GREEDY',
        skill_id:        currentSkillId,
        skill_name:      `迭代Skill-v${round}`,
        avg_score:       avgScore,
        score_delta:     scoreDelta,
        score_breakdown: scoreBreakdown,
      })

      logService.info('iteration-service', `Round ${round} completed`, {
        projectId, avgScore, plateauLevel,
      })

      if (onRoundComplete) {
        onRoundComplete({ projectId, round, skillId: currentSkillId, avgScore, scoreDelta, stopped: false })
      }

      if (stopThreshold != null && avgScore >= stopThreshold) {
        stopReason = 'threshold_reached'
        break
      }

      // Between rounds: beam recompose
      if (round < maxRounds && !state.stopped && !state.paused) {
        const strategies     = _selectStrategies(round, plateauLevel, beamWidth)
        const focusDimension = _findWeakestDimension(rounds)
        const scoreHistory   = rounds.map(r => ({
          round:           r.round,
          strategy:        r.strategy || 'GREEDY',
          avg_score:       r.avg_score,
          score_delta:     r.score_delta,
          score_breakdown: r.score_breakdown,
        }))

        const logRound = {
          round,
          plateau_level:  plateauLevel,
          strategies_tried: strategies,
          candidates:     [],
          winner_skill_id: null,
        }

        let winnerSkillId  = null
        let winnerScore    = -Infinity

        for (let ci = 0; ci < strategies.length; ci++) {
          if (state.stopped || state.paused) break
          const strategy = strategies[ci]

          try {
            const candResult = await _doBeamCandidate(
              projectId, projectPath, round, ci + 1,
              strategy, focusDimension,
              { retentionRules, selectedSegmentIds },
              scoreHistory,
            )

            logRound.candidates.push(candResult)

            if (candResult.avg_score > winnerScore) {
              winnerScore   = candResult.avg_score
              winnerSkillId = candResult.skill_id
            }

            logService.info('iteration-service', `Beam candidate ${ci + 1}/${strategies.length} (${strategy})`, {
              projectId, skillId: candResult.skill_id, avgScore: candResult.avg_score,
            })
          } catch (err) {
            logService.warn('iteration-service', `Beam candidate ${strategy} failed`, {
              projectId, err: String(err),
            })
            logRound.candidates.push({ strategy, skill_id: null, avg_score: null, won: false, error: String(err) })
          }
        }

        // Mark winner
        if (winnerSkillId) {
          logRound.candidates.forEach(c => { c.won = c.skill_id === winnerSkillId })
          logRound.winner_skill_id = winnerSkillId
          currentSkillId = winnerSkillId

          // Register the winner as the candidate for the next round (it's already in project config
          // from its own _doBeamCandidate call — just need to ensure it's the only non-original)
          _registerIterationCandidate(projectPath, winnerSkillId, round + 1)
          logService.info('iteration-service', `Beam winner selected for round ${round + 1}`, {
            projectId, skillId: winnerSkillId, score: winnerScore,
          })
        } else {
          // Fallback: no candidate succeeded — keep currentSkillId unchanged
          logService.warn('iteration-service', `All beam candidates failed at round ${round}`, { projectId })
        }

        explorationLog.rounds.push(logRound)
      }
    } catch (err) {
      logService.warn('iteration-service', `Round ${round} failed`, { projectId, err: String(err) })
      stopReason = 'error'
      break
    }
  }

  // Update best_ever
  const best = rounds.length > 0
    ? rounds.reduce((a, b) => b.avg_score > a.avg_score ? b : a)
    : { round: 1, skill_id: recomposedSkillId, skill_name: '迭代Skill-v1', avg_score: 0, strategy: 'GREEDY' }

  explorationLog.best_ever = {
    round:    best.round,
    strategy: best.strategy || 'GREEDY',
    skill_id: best.skill_id,
    avg_score: best.avg_score,
  }
  explorationLog.completed_at = new Date().toISOString()

  const iterDir = path.join(projectPath, 'iterations')
  fileService.ensureDir(iterDir)
  fileService.writeJson(path.join(iterDir, 'exploration_log.json'), explorationLog)

  const report = {
    project_id:      projectId,
    generated_at:    new Date().toISOString(),
    total_rounds:    rounds.length,
    stop_reason:     stopReason,
    stop_threshold:  stopThreshold,
    best_round:      best.round,
    best_skill_id:   best.skill_id,
    best_skill_name: best.skill_name || `迭代Skill-v${best.round}`,
    best_avg_score:  best.avg_score,
    rounds,
  }

  fileService.writeJson(path.join(iterDir, 'iteration_report.json'), report)
  logService.info('iteration-service', 'Iteration completed', {
    projectId, totalRounds: rounds.length, stopReason,
    bestScore: best.avg_score, bestRound: best.round,
  })

  if (onAllComplete) onAllComplete({ projectId, iterationId, status: 'completed', report })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start an iteration loop for a project.
 * Returns { iterationId } immediately; rounds run in background.
 *
 * @param {string} projectId
 * @param {{ recomposedSkillId, maxRounds, stopThreshold, retentionRules, selectedSegmentIds,
 *           beamWidth, plateauThreshold, plateauRoundsBeforeEscape }} params
 * @param {{ onRoundComplete, onAllComplete }} options
 */
async function startIteration(projectId, params, { onRoundComplete, onAllComplete } = {}) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const config      = fileService.readJson(path.join(found.fullPath, 'config.json'))
  const iterationId = uuidv4()

  _states.set(iterationId, { paused: false, stopped: false, projectId })
  _projectToIter.set(projectId, iterationId)
  logService.info('iteration-service', 'Iteration started', {
    projectId, iterationId,
    recomposedSkillId: params.recomposedSkillId,
    maxRounds:         params.maxRounds,
    stopThreshold:     params.stopThreshold,
    beamWidth:         params.beamWidth || 1,
  })

  setImmediate(() => _doIteration(
    projectId, found.fullPath, config, params,
    iterationId, onRoundComplete, onAllComplete,
  ))

  return { iterationId }
}

/** Pause the running iteration for a project. */
function pauseIteration(projectId) {
  const iterationId = _projectToIter.get(projectId)
  if (iterationId) {
    const s = _states.get(iterationId) || {}
    s.paused = true
    _states.set(iterationId, s)
    logService.info('iteration-service', 'Iteration paused', { projectId, iterationId })
  }
  return { paused: true }
}

/** Stop (abort) the running iteration for a project. */
function stopIteration(projectId) {
  const iterationId = _projectToIter.get(projectId)
  if (iterationId) {
    const s = _states.get(iterationId) || {}
    s.stopped = true
    _states.set(iterationId, s)
    logService.info('iteration-service', 'Iteration stopped', { projectId, iterationId })
  }
  return { stopped: true }
}

/** Get current iteration progress for a project. */
function getProgress(projectId) {
  const iterationId = _projectToIter.get(projectId)
  const state       = iterationId ? (_states.get(iterationId) || {}) : {}

  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }

  const iterDir  = path.join(found.fullPath, 'iterations')
  const roundDirs = fileService.listDirs(iterDir).filter(d => d.startsWith('round_'))

  const rounds = roundDirs.map(d => {
    const cfg = fileService.readJson(path.join(iterDir, d, 'config.json'))
    return {
      round:    cfg ? cfg.round : parseInt(d.replace('round_', ''), 10),
      status:   cfg ? cfg.status : 'unknown',
      avgScore: cfg ? (cfg.avg_score != null ? cfg.avg_score : null) : null,
    }
  }).sort((a, b) => a.round - b.round)

  const completedRounds = rounds.filter(r => r.status === 'completed')
  const runningRound    = rounds.find(r => r.status === 'running')

  let overallStatus = 'running'
  if (state.stopped) overallStatus = 'stopped'
  else if (state.paused) overallStatus = 'paused'
  else if (fileService.exists(path.join(iterDir, 'iteration_report.json'))) overallStatus = 'completed'

  return {
    status:       overallStatus,
    currentRound: runningRound ? runningRound.round : completedRounds.length,
    totalRounds:  rounds.length,
    currentPhase: runningRound ? 'test' : 'idle',
    rounds,
  }
}

/** Get the final iteration report for a project. */
function getIterationReport(projectId) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }

  const report = fileService.readJson(
    path.join(found.fullPath, 'iterations', 'iteration_report.json'),
  )
  if (!report) throw { code: 'NOT_FOUND', message: 'Iteration report not found. Run iteration first.' }

  return report
}

/** Get the exploration log (full candidate history) for a project. */
function getExplorationLog(projectId) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND' }

  const log = fileService.readJson(
    path.join(found.fullPath, 'iterations', 'exploration_log.json'),
  )
  if (!log) throw { code: 'NOT_FOUND', message: 'Exploration log not found. Run iteration first.' }

  return log
}

module.exports = {
  startIteration,
  pauseIteration,
  stopIteration,
  getProgress,
  getIterationReport,
  getExplorationLog,
  // exported for testing
  _selectStrategies,
  _detectPlateauLevel,
  _findWeakestDimension,
}
