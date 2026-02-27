'use strict'

/**
 * iteration-service.test.js
 * TDD Test Cases: UC9-1 through UC9-4
 *
 * Tests: auto-complete ≥2 rounds, round config creation, iteration report
 * schema, and best-version recommendation with threshold-based stopping.
 */

const path = require('path')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let tmpDir, cleanup, restoreWorkspace
let iterationService, testService, analysisService, recomposeService, skillService, fileService

// ─── Module setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  const tmp = createTmpDir('iteration-svc-')
  tmpDir  = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

  fileService      = require('../../main/services/file-service')
  iterationService = require('../../main/services/iteration-service')
  testService      = require('../../main/services/test-service')
  analysisService  = require('../../main/services/analysis-service')
  recomposeService = require('../../main/services/recompose-service')
  skillService     = require('../../main/services/skill-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── Test project factory ─────────────────────────────────────────────────

function makeIterationProject(key) {
  const projectId   = `iproj-${key}`
  const projectDir  = `project_${key}`
  const projectPath = path.join(tmpDir, 'projects', projectDir)

  fileService.ensureDir(path.join(projectPath, '.claude'))
  fileService.ensureDir(path.join(projectPath, 'results'))
  fileService.ensureDir(path.join(projectPath, 'iterations'))

  fileService.writeJson(path.join(projectPath, 'config.json'), {
    id:         projectId,
    name:       'Iteration Test Project',
    status:     'completed',
    skills:     [{ ref_id: 'skill-a', name: 'Skill A', version: 'v1', local_path: 'skills/skill_a_v1' }],
    baselines:  [{ ref_id: 'bl-a',    name: 'Baseline A', version: 'v1', local_path: 'baselines/bl_a_v1' }],
    cli_config: { model: 'claude-opus-4-6', timeout_seconds: 60 },
  })

  // Pre-write summary.json — testService mock just calls onProgress without modifying it
  fileService.writeJson(path.join(projectPath, 'results', 'summary.json'), {
    project_id:   projectId,
    total_cases:  2,
    ranking: [{
      rank: 1, skill_id: 'skill-a', skill_name: 'Skill A', skill_version: 'v1',
      avg_score: 80, completed_cases: 2, failed_cases: 0,
      score_breakdown: {
        functional_correctness: 24, robustness: 16, readability: 12,
        conciseness: 12, complexity_control: 8, format_compliance: 8,
      },
    }],
  })

  // Pre-write analysis_report.json — analysisService mock just calls onComplete
  fileService.writeJson(path.join(projectPath, 'analysis_report.json'), {
    project_id:         projectId,
    generated_at:       new Date().toISOString(),
    best_skill_id:      'skill-a',
    best_skill_name:    'Skill A',
    dimension_leaders:  {
      functional_correctness: 'skill-a', robustness: 'skill-a',
      readability: 'skill-a', conciseness: 'skill-a',
      complexity_control: 'skill-a', format_compliance: 'skill-a',
    },
    advantage_segments: [
      { id: 'seg_001', skill_id: 'skill-a', skill_name: 'Skill A', type: 'role',       content: '你是专业Python开发者', reason: '角色清晰',    dimension: 'readability' },
      { id: 'seg_002', skill_id: 'skill-a', skill_name: 'Skill A', type: 'constraint', content: '必须包含类型检查',   reason: '提升健壮性', dimension: 'robustness'  },
    ],
    issues: [],
  })

  return { projectId, projectPath }
}

// ─── Mock helpers ─────────────────────────────────────────────────────────

/** Create a fake global skill directory so _registerIterationCandidate can copy it. */
function _createMockGlobalSkill(skillId) {
  const shortId  = skillId.slice(0, 8)
  const dir      = `skill_${shortId}_v1`
  const fullPath = path.join(tmpDir, 'skills', 'general', 'iteration', dir)
  fileService.ensureDir(fullPath)
  fileService.writeJson(path.join(fullPath, 'meta.json'), {
    id: skillId, name: `Mock Iter Skill ${shortId}`,
    purpose: 'general', provider: 'iteration', version: 'v1',
  })
  fileService.writeText(path.join(fullPath, 'content.txt'), `Mock content for ${skillId}`)
  return { dir, fullPath }
}

function mockDependencies() {
  jest.spyOn(testService, 'startTest').mockImplementation(async (pid, { onProgress } = {}) => {
    setImmediate(() => onProgress && onProgress({ projectStatus: 'completed' }))
  })

  jest.spyOn(analysisService, 'runAnalysis').mockImplementation(async (pid, { onComplete } = {}) => {
    setImmediate(() => onComplete && onComplete({ status: 'completed' }))
    return { taskId: 'mock-analysis' }
  })

  jest.spyOn(recomposeService, 'executeRecompose').mockImplementation(async (pid, params, { onComplete } = {}) => {
    setImmediate(() => onComplete && onComplete({
      status:  'completed',
      preview: { content: '重组后新提示词', segmentCount: 2, sourceSkillCount: 1 },
    }))
    return { taskId: 'mock-recompose' }
  })

  let skillCounter = 0
  jest.spyOn(recomposeService, 'saveRecomposedSkill').mockImplementation(async () => {
    skillCounter++
    const skillId = `mock-iter-${skillCounter.toString().padStart(6, '0')}`
    const { dir, fullPath } = _createMockGlobalSkill(skillId)
    jest.spyOn(skillService, 'findSkillDir').mockImplementationOnce(() => ({ dir, fullPath }))
    return { skillId, version: 'v1' }
  })
}

/** Run iteration and await full completion (rejects on timeout). */
function runIteration(projectId, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Iteration timed out')), 10000)
    iterationService.startIteration(
      projectId,
      { recomposedSkillId: 'skill-a', maxRounds: 2, ...params },
      {
        onAllComplete: (data) => { clearTimeout(timer); resolve(data) },
      },
    ).catch((err) => { clearTimeout(timer); reject(err) })
  })
}

// ─── UC9-1: Auto-complete at least 2 rounds ───────────────────────────────

describe('UC9-1: startIteration completes at least 2 rounds', () => {
  test('iteration report has total_rounds equal to maxRounds', async () => {
    const { projectId } = makeIterationProject('uc9-1a')
    mockDependencies()

    const result = await runIteration(projectId, { maxRounds: 2 })

    expect(result.status).toBe('completed')
    expect(result.report.total_rounds).toBe(2)
  })

  test('returns iterationId immediately without blocking', async () => {
    const { projectId } = makeIterationProject('uc9-1b')
    mockDependencies()

    const result = await iterationService.startIteration(
      projectId,
      { recomposedSkillId: 'skill-a', maxRounds: 1 },
      { onAllComplete: () => {} },
    )

    expect(result.iterationId).toBeTruthy()
    expect(typeof result.iterationId).toBe('string')

    // Wait for background task to finish cleanly
    await new Promise(r => setTimeout(r, 300))
  })
})

// ─── UC9-2: Each round creates round config and runs test + analysis ───────

describe('UC9-2: each round creates round_N/config.json and invokes test+analysis', () => {
  test('round_N/config.json is written for each round with status=completed', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-2a')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    for (let r = 1; r <= 2; r++) {
      const cfg = fileService.readJson(
        path.join(projectPath, 'iterations', `round_${r}`, 'config.json'),
      )
      expect(cfg).toBeTruthy()
      expect(cfg.round).toBe(r)
      expect(cfg.status).toBe('completed')
    }
  })

  test('testService.startTest called for each round plus each beam candidate', async () => {
    // maxRounds=2, beamWidth=1 (default):
    //   Round 1 main test + 1 beam candidate between rounds + Round 2 main test = 3
    const { projectId } = makeIterationProject('uc9-2b')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    // formula: maxRounds + (maxRounds - 1) * beamWidth = 2 + 1*1 = 3
    expect(testService.startTest).toHaveBeenCalledTimes(3)
  })

  test('analysisService.runAnalysis is called once per round', async () => {
    const { projectId } = makeIterationProject('uc9-2c')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    expect(analysisService.runAnalysis).toHaveBeenCalledTimes(2)
  })

  test('recomposeService is called between rounds (maxRounds-1 times)', async () => {
    const { projectId } = makeIterationProject('uc9-2d')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 3 })

    // 3 rounds → 2 recompose calls (between round 1→2 and 2→3)
    expect(recomposeService.executeRecompose).toHaveBeenCalledTimes(2)
    expect(recomposeService.saveRecomposedSkill).toHaveBeenCalledTimes(2)
  })

  test('recomposed skill is registered in project config.json for subsequent rounds', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-2e')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    // After 2 rounds, config.skills should contain an iteration candidate (local_path has 'iter')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))
    const iterSkills = (config.skills || []).filter(s => s.local_path.includes('iter'))
    expect(iterSkills.length).toBeGreaterThanOrEqual(1)

    // The project skills/ dir should have the iter directory
    const iterDirs = fileService.listDirs(path.join(projectPath, 'skills'))
      .filter(d => d.includes('iter'))
    expect(iterDirs.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── UC9-3: Outputs iteration evolution report ────────────────────────────

describe('UC9-3: iteration_report.json is written with complete schema', () => {
  test('iteration_report.json exists after completion', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-3a')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const report = fileService.readJson(
      path.join(projectPath, 'iterations', 'iteration_report.json'),
    )
    expect(report).toBeTruthy()
    expect(report.project_id).toBe(projectId)
    expect(report.total_rounds).toBe(2)
    expect(Array.isArray(report.rounds)).toBe(true)
    expect(report.rounds).toHaveLength(2)
    expect(report.stop_reason).toBeTruthy()
    expect(report.generated_at).toBeTruthy()
  })

  test('round entries have avg_score; first round has null score_delta', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-3b')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const report = fileService.readJson(
      path.join(projectPath, 'iterations', 'iteration_report.json'),
    )
    expect(report.rounds[0].avg_score).toBeGreaterThanOrEqual(0)
    expect(report.rounds[0].score_delta).toBeNull()
    expect(report.rounds[1].score_delta).not.toBeUndefined()
  })

  test('getIterationReport returns the stored report', async () => {
    const { projectId } = makeIterationProject('uc9-3c')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const report = iterationService.getIterationReport(projectId)
    expect(report.project_id).toBe(projectId)
    expect(report.total_rounds).toBe(2)
  })
})

// ─── UC9-4: Auto-recommend best version + threshold stopping ─────────────

describe('UC9-4: iteration report recommends best_round and supports stopThreshold', () => {
  test('report has best_round, best_skill_id, best_avg_score', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-4a')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const report = fileService.readJson(
      path.join(projectPath, 'iterations', 'iteration_report.json'),
    )
    expect(report.best_round).toBeGreaterThan(0)
    expect(report.best_skill_id).toBeTruthy()
    expect(typeof report.best_avg_score).toBe('number')
  })

  test('stops early when avg_score exceeds stopThreshold', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-4b')
    mockDependencies()
    // summary.json avg_score = 80, threshold = 75 → stops after round 1

    await runIteration(projectId, { maxRounds: 3, stopThreshold: 75 })

    const report = fileService.readJson(
      path.join(projectPath, 'iterations', 'iteration_report.json'),
    )
    expect(report.stop_reason).toBe('threshold_reached')
    expect(report.total_rounds).toBe(1)
  })

  test('stop_reason is max_rounds when threshold is not set', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-4c')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const report = fileService.readJson(
      path.join(projectPath, 'iterations', 'iteration_report.json'),
    )
    expect(report.stop_reason).toBe('max_rounds')
  })
})

// ─── getProgress ─────────────────────────────────────────────────────────

describe('getProgress', () => {
  test('returns status=completed and correct round count after iteration finishes', async () => {
    const { projectId } = makeIterationProject('uc9-progress')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const progress = iterationService.getProgress(projectId)
    expect(progress.status).toBe('completed')
    expect(progress.rounds).toHaveLength(2)
  })
})

// ─── Strategy & Plateau helpers (pure function tests) ────────────────────

describe('_selectStrategies', () => {
  test('beamWidth=1 always returns [GREEDY]', () => {
    expect(iterationService._selectStrategies(1, 0, 1)).toEqual(['GREEDY'])
    expect(iterationService._selectStrategies(3, 3, 1)).toEqual(['GREEDY'])
  })

  test('beamWidth=2, plateauLevel=0 → GREEDY + DIMENSION_FOCUS', () => {
    expect(iterationService._selectStrategies(1, 0, 2)).toEqual(['GREEDY', 'DIMENSION_FOCUS'])
  })

  test('beamWidth=2, plateauLevel=1 → GREEDY + SEGMENT_EXPLORE', () => {
    expect(iterationService._selectStrategies(2, 1, 2)).toEqual(['GREEDY', 'SEGMENT_EXPLORE'])
  })

  test('beamWidth=2, plateauLevel=2 → CROSS_POLLINATE + DIMENSION_FOCUS', () => {
    expect(iterationService._selectStrategies(3, 2, 2)).toEqual(['CROSS_POLLINATE', 'DIMENSION_FOCUS'])
  })

  test('beamWidth=2, plateauLevel=3 → RANDOM_SUBSET + SEGMENT_EXPLORE', () => {
    expect(iterationService._selectStrategies(4, 3, 2)).toEqual(['RANDOM_SUBSET', 'SEGMENT_EXPLORE'])
  })
})

describe('_detectPlateauLevel', () => {
  const threshold = 1.0
  const limit     = 2

  test('returns 0 when fewer than 2 rounds', () => {
    expect(iterationService._detectPlateauLevel([], threshold, limit)).toBe(0)
    expect(iterationService._detectPlateauLevel([{ avg_score: 80, score_delta: null }], threshold, limit)).toBe(0)
  })

  test('returns 0 when last delta exceeds threshold', () => {
    const rounds = [
      { avg_score: 75, score_delta: null },
      { avg_score: 80, score_delta: 5.0 },
    ]
    expect(iterationService._detectPlateauLevel(rounds, threshold, limit)).toBe(0)
  })

  test('returns 1 when 1 round below threshold (below consecutiveLimit)', () => {
    const rounds = [
      { avg_score: 80, score_delta: 5.0 },
      { avg_score: 80.5, score_delta: 0.5 },
    ]
    expect(iterationService._detectPlateauLevel(rounds, threshold, limit)).toBe(1)
  })

  test('returns 2 when consecutiveLimit rounds below threshold', () => {
    const rounds = [
      { avg_score: 78, score_delta: 5.0 },
      { avg_score: 78.4, score_delta: 0.4 },
      { avg_score: 78.8, score_delta: 0.4 },
    ]
    expect(iterationService._detectPlateauLevel(rounds, threshold, limit)).toBe(2)
  })
})

describe('_findWeakestDimension', () => {
  test('returns functional_correctness as default when no rounds', () => {
    expect(iterationService._findWeakestDimension([])).toBe('functional_correctness')
  })

  test('finds the dimension with lowest score-to-max ratio', () => {
    const rounds = [{
      avg_score: 80,
      score_breakdown: {
        functional_correctness: 28,  // 28/30 = 93%
        robustness:              8,  // 8/20  = 40% ← weakest
        readability:            14,  // 14/15 = 93%
        conciseness:            13,
        complexity_control:      9,
        format_compliance:       9,
      },
    }]
    expect(iterationService._findWeakestDimension(rounds)).toBe('robustness')
  })
})

// ─── exploration_log.json ────────────────────────────────────────────────

describe('exploration_log.json written after iteration', () => {
  test('exploration_log.json exists with correct top-level fields', async () => {
    const { projectId, projectPath } = makeIterationProject('uc9-explog')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const log = fileService.readJson(
      path.join(projectPath, 'iterations', 'exploration_log.json'),
    )
    expect(log).toBeTruthy()
    expect(log.project_id).toBe(projectId)
    expect(Array.isArray(log.original_skill_ids)).toBe(true)
    expect(log.params).toBeTruthy()
    expect(log.completed_at).toBeTruthy()
  })

  test('getExplorationLog returns the log', async () => {
    const { projectId } = makeIterationProject('uc9-explog2')
    mockDependencies()

    await runIteration(projectId, { maxRounds: 2 })

    const log = iterationService.getExplorationLog(projectId)
    expect(log.project_id).toBe(projectId)
  })
})
