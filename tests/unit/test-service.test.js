'use strict'

/**
 * test-service.test.js
 * TDD Test Cases: UC6-1 through UC6-5
 *
 * Tests parallel per-skill execution, fault tolerance, structured result
 * storage, pause/resume, and multi-skill workingDir isolation.
 * Uses real filesystem (tmpDir) + mocked cliService.
 */

const path = require('path')
const fs   = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let tmpDir, cleanup, restoreWorkspace
let testService, cliService, fileService

// ─── Shared mock scores ───────────────────────────────────────────────────

const MOCK_SCORES = {
  functional_correctness: 25,
  robustness: 15,
  readability: 12,
  conciseness: 12,
  complexity_control: 8,
  format_compliance: 8,
  total: 80,
}

// ─── Module setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  const tmp = createTmpDir('test-svc-')
  tmpDir  = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

  fileService  = require('../../main/services/file-service')
  testService  = require('../../main/services/test-service')
  cliService   = require('../../main/services/cli-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── Test project factory ─────────────────────────────────────────────────

/**
 * Create a minimal project directory structure for testing.
 * projectKey must be unique per test.
 */
function createTestProject(projectKey, numCases = 2) {
  const projectId  = `proj-${projectKey}`
  const projectDir = `project_${projectKey}`
  const projectPath = path.join(tmpDir, 'projects', projectDir)

  // Skill
  const skillDir = 'skill_test_v1'
  fileService.ensureDir(path.join(projectPath, 'skills', skillDir))
  fileService.writeText(
    path.join(projectPath, 'skills', skillDir, 'content.txt'),
    'You are a helpful coding assistant.',
  )

  // Baseline
  const baselineDir = 'baseline_test_v1'
  fileService.ensureDir(path.join(projectPath, 'baselines', baselineDir))
  const cases = Array.from({ length: numCases }, (_, i) => ({
    case_id:         `case_00${i + 1}`,
    input:           `Write task ${i + 1}`,
    expected_output: `Expected output for task ${i + 1}`,
  }))
  fileService.writeJson(
    path.join(projectPath, 'baselines', baselineDir, 'cases.json'),
    { cases },
  )

  // Project structure
  fileService.ensureDir(path.join(projectPath, 'results'))
  fileService.ensureDir(path.join(projectPath, '.claude'))
  fileService.writeJson(path.join(projectPath, 'config.json'), {
    id:          projectId,
    name:        'Test Project',
    description: '',
    status:      'pending',
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString(),
    skills: [{
      ref_id:    'skill-a',
      name:      'Skill A',
      version:   'v1',
      local_path: `skills/${skillDir}`,
    }],
    baselines: [{
      ref_id:    'baseline-a',
      name:      'Baseline A',
      version:   'v1',
      local_path: `baselines/${baselineDir}`,
    }],
    cli_config: {
      model:            'claude-opus-4-6',
      timeout_seconds:  30,
      retry_count:      1,
      extra_flags:      [],
    },
    progress: {
      total_tasks:    numCases,
      completed_tasks: 0,
      failed_tasks:    0,
      last_checkpoint: null,
    },
  })

  return { projectId, projectPath }
}

/**
 * Set up invokeCli + getCliVersion + parseStructuredOutput mocks.
 * taskOutcomes: array of 'success' | 'fail' — one entry per task.
 */
function setupMocks(taskOutcomes) {
  const spy = jest.spyOn(cliService, 'invokeCli')
  for (const outcome of taskOutcomes) {
    if (outcome === 'fail') {
      spy.mockRejectedValueOnce({ code: 'CLI_EXECUTION_ERROR', message: 'mock failure' })
    } else {
      // exec call
      spy.mockResolvedValueOnce({ result: 'mock output', duration_ms: 100 })
      // scoring call
      spy.mockResolvedValueOnce({ result: JSON.stringify({ scores: MOCK_SCORES, reasoning: 'good job' }) })
    }
  }
  jest.spyOn(cliService, 'getCliVersion').mockResolvedValue('1.2.0')
  jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValue({
    scores: MOCK_SCORES, reasoning: 'good job',
  })
}

/**
 * Wait for a project's test run to reach a terminal projectStatus.
 */
function runAndWait(projectId, opts = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for project ${projectId}`)),
      5000,
    )
    testService.startTest(projectId, {
      onProgress: (data) => {
        if (opts.onProgress) opts.onProgress(data)
        if (data.projectStatus === 'completed' || data.projectStatus === 'interrupted') {
          clearTimeout(timer)
          resolve(data)
        }
      },
    }).catch((err) => { clearTimeout(timer); reject(err) })
  })
}

// ─── UC6-1: Parallel execution (single skill) ─────────────────────────────

describe('UC6-1: startTest executes all skill×case tasks (parallel per skill)', () => {
  test('runs all tasks and writes result files for each case', async () => {
    const { projectId, projectPath } = createTestProject('uc6-1a', 2)
    setupMocks(['success', 'success'])

    const finalData = await runAndWait(projectId)

    expect(finalData.completedTasks).toBe(2)
    expect(finalData.failedTasks).toBe(0)
    expect(finalData.projectStatus).toBe('completed')

    // Each result file must exist
    const skillDir = path.join(projectPath, 'results', 'skill_test_v1')
    expect(fs.existsSync(path.join(skillDir, 'case_001.json'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'case_002.json'))).toBe(true)
  })

  test('writes summary.json after all tasks complete', async () => {
    const { projectId, projectPath } = createTestProject('uc6-1b', 2)
    setupMocks(['success', 'success'])

    await runAndWait(projectId)

    const summaryPath = path.join(projectPath, 'results', 'summary.json')
    expect(fs.existsSync(summaryPath)).toBe(true)
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
    expect(summary.project_id).toBe('proj-uc6-1b')
    expect(summary.ranking).toHaveLength(1)
    expect(summary.ranking[0].completed_cases).toBe(2)
    expect(summary.ranking[0].avg_score).toBe(80)
  })

  test('invokeCli is called once per execution plus once per scoring', async () => {
    const { projectId } = createTestProject('uc6-1c', 2)
    setupMocks(['success', 'success'])

    await runAndWait(projectId)

    // 2 tasks × (1 exec + 1 score) = 4 invokeCli calls
    expect(cliService.invokeCli).toHaveBeenCalledTimes(4)
  })

  test('project config.json status is updated to completed', async () => {
    const { projectId, projectPath } = createTestProject('uc6-1d', 1)
    setupMocks(['success'])

    await runAndWait(projectId)

    const cfg = JSON.parse(fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8'))
    expect(cfg.status).toBe('completed')
    expect(cfg.progress.completed_tasks).toBe(1)
  })
})

// ─── UC6-2: Fault tolerance ───────────────────────────────────────────────

describe('UC6-2: single case failure does not stop the overall test run', () => {
  test('failed case writes status:failed; subsequent tasks still run', async () => {
    const { projectId, projectPath } = createTestProject('uc6-2a', 2)
    // First task fails, second succeeds
    setupMocks(['fail', 'success'])

    const finalData = await runAndWait(projectId)

    expect(finalData.completedTasks).toBe(1)
    expect(finalData.failedTasks).toBe(1)
    expect(finalData.projectStatus).toBe('completed')

    const skillDir = path.join(projectPath, 'results', 'skill_test_v1')

    const failedResult = JSON.parse(fs.readFileSync(path.join(skillDir, 'case_001.json'), 'utf-8'))
    expect(failedResult.status).toBe('failed')
    expect(failedResult.error).toBeTruthy()
    expect(failedResult.scores).toBeNull()

    const successResult = JSON.parse(fs.readFileSync(path.join(skillDir, 'case_002.json'), 'utf-8'))
    expect(successResult.status).toBe('completed')
  })

  test('totalTasks progress reflects both completed and failed', async () => {
    const { projectId } = createTestProject('uc6-2b', 3)
    setupMocks(['success', 'fail', 'success'])

    const progressEvents = []
    const finalData = await runAndWait(projectId, {
      onProgress: (d) => progressEvents.push(d),
    })

    expect(finalData.completedTasks + finalData.failedTasks).toBe(3)
    expect(progressEvents.length).toBeGreaterThanOrEqual(3)
  })
})

// ─── UC6-3: Structured results ────────────────────────────────────────────

describe('UC6-3: results are structured and stored correctly', () => {
  test('result file contains all required schema fields', async () => {
    const { projectId, projectPath } = createTestProject('uc6-3a', 1)
    setupMocks(['success'])

    await runAndWait(projectId)

    const resultPath = path.join(projectPath, 'results', 'skill_test_v1', 'case_001.json')
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'))

    expect(result.case_id).toBe('case_001')
    expect(result.skill_id).toBe('skill-a')
    expect(result.skill_version).toBe('v1')
    expect(result.baseline_id).toBe('baseline-a')
    expect(result.baseline_version).toBe('v1')
    expect(result.status).toBe('completed')
    expect(result.actual_output).toBe('mock output')
    expect(result.cli_version).toBe('1.2.0')
    expect(result.model_version).toBe('claude-opus-4-6')
    expect(result.duration_ms).toBe(100)
    expect(result.error).toBeNull()
    expect(result.executed_at).toBeTruthy()
  })

  test('result file contains 6-dimension scores', async () => {
    const { projectId, projectPath } = createTestProject('uc6-3b', 1)
    setupMocks(['success'])

    await runAndWait(projectId)

    const resultPath = path.join(projectPath, 'results', 'skill_test_v1', 'case_001.json')
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'))

    expect(result.scores).toBeTruthy()
    expect(result.scores.functional_correctness).toBe(25)
    expect(result.scores.robustness).toBe(15)
    expect(result.scores.readability).toBe(12)
    expect(result.scores.conciseness).toBe(12)
    expect(result.scores.complexity_control).toBe(8)
    expect(result.scores.format_compliance).toBe(8)
    expect(result.scores.total).toBe(80)
    expect(result.score_reasoning).toBe('good job')
    expect(result.score_evaluated_at).toBeTruthy()
  })

  test('getResults returns paginated result records', async () => {
    const { projectId } = createTestProject('uc6-3c', 2)
    setupMocks(['success', 'success'])

    await runAndWait(projectId)

    const page = testService.getResults(projectId, { page: 1, pageSize: 10 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(2)
    expect(page.items[0].skill_id).toBe('skill-a')
  })

  test('getResults filters by status', async () => {
    const { projectId } = createTestProject('uc6-3d', 2)
    setupMocks(['fail', 'success'])

    await runAndWait(projectId)

    const failed = testService.getResults(projectId, { status: 'failed', page: 1, pageSize: 10 })
    expect(failed.total).toBe(1)
    expect(failed.items[0].status).toBe('failed')
  })
})

// ─── UC6-4: Pause and resume ──────────────────────────────────────────────

describe('UC6-4: test run can be paused and resumed from checkpoint', () => {
  test('pauseTest stops the loop; resumeTest continues from checkpoint', async () => {
    const { projectId } = createTestProject('uc6-4a', 3)
    // 3 tasks × (exec+score) = 6 invokeCli calls
    setupMocks(['success', 'success', 'success'])

    // Track when first task completes; pause immediately
    let pausedOnce = false
    const pauseReady = new Promise((resolve) => {
      testService.startTest(projectId, {
        onProgress: (data) => {
          if (data.completedTasks === 1 && !pausedOnce) {
            pausedOnce = true
            testService.pauseTest(projectId)
            // Give the loop one tick to see the 'paused' status and exit
            setImmediate(resolve)
          }
        },
      })
    })

    await pauseReady

    const midProgress = testService.getProgress(projectId)
    expect(midProgress.status).toBe('paused')
    expect(midProgress.completedTasks).toBe(1)

    // Resume and wait for completion
    const resumeDone = new Promise((resolve) => {
      testService.resumeTest(projectId, {
        onProgress: (data) => {
          if (data.projectStatus === 'completed') resolve(data)
        },
      })
    })

    const finalData = await resumeDone
    expect(finalData.completedTasks).toBe(3)
    expect(finalData.projectStatus).toBe('completed')
  }, 8000)

  test('pauseTest returns checkpoint index', async () => {
    const { projectId } = createTestProject('uc6-4b', 3)
    setupMocks(['success', 'success', 'success'])

    let checkpointValue = null
    const pauseReady = new Promise((resolve) => {
      testService.startTest(projectId, {
        onProgress: (data) => {
          if (data.completedTasks === 1) {
            const result = testService.pauseTest(projectId)
            checkpointValue = result.checkpoint
            setImmediate(resolve)
          }
        },
      })
    })

    await pauseReady
    expect(checkpointValue).toBe('1')
  }, 8000)

  test('stopTest interrupts execution permanently', async () => {
    const { projectId, projectPath } = createTestProject('uc6-4c', 3)
    setupMocks(['success', 'success', 'success'])

    const stopReady = new Promise((resolve) => {
      testService.startTest(projectId, {
        onProgress: (data) => {
          if (data.completedTasks === 1) {
            testService.stopTest(projectId)
            setImmediate(resolve)
          }
        },
      })
    })

    await stopReady

    const cfg = JSON.parse(fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8'))
    expect(cfg.status).toBe('interrupted')
  }, 8000)

  test('startTest throws ALREADY_RUNNING if project is already running', async () => {
    const { projectId } = createTestProject('uc6-4d', 4)
    setupMocks(['success', 'success', 'success', 'success'])

    // Start and immediately try to start again (before setImmediate fires)
    await testService.startTest(projectId, {
      onProgress: () => {},
    })

    await expect(
      testService.startTest(projectId, {}),
    ).rejects.toMatchObject({ code: 'ALREADY_RUNNING' })

    // Clean up: stop the running test
    testService.stopTest(projectId)
  })
})

// ─── getProgress (disk fallback) ──────────────────────────────────────────

describe('getProgress reads from disk when no in-memory state', () => {
  test('returns status from config.json for completed project', async () => {
    const { projectId } = createTestProject('uc6-prog', 1)
    setupMocks(['success'])

    await runAndWait(projectId)

    const progress = testService.getProgress(projectId)
    expect(progress.status).toBe('completed')
    expect(progress.completedTasks).toBe(1)
  })
})

// ─── exportResults ────────────────────────────────────────────────────────

describe('exportResults writes results to file', () => {
  test('exports JSON file with all result records', async () => {
    const { projectId } = createTestProject('uc6-export', 2)
    setupMocks(['success', 'success'])

    await runAndWait(projectId)

    const destPath = path.join(tmpDir, 'exports', 'results.json')
    const { exportedPath } = testService.exportResults(projectId, { format: 'json', destPath })

    expect(exportedPath).toBe(destPath)
    expect(fs.existsSync(destPath)).toBe(true)
    const data = JSON.parse(fs.readFileSync(destPath, 'utf-8'))
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
  })

  test('exports CSV file with header row', async () => {
    const { projectId } = createTestProject('uc6-csv', 1)
    setupMocks(['success'])

    await runAndWait(projectId)

    const destPath = path.join(tmpDir, 'exports', 'results.csv')
    testService.exportResults(projectId, { format: 'csv', destPath })

    const content = fs.readFileSync(destPath, 'utf-8')
    expect(content).toContain('case_id')
    expect(content).toContain('scores.total')
  })
})

// ─── Two-skill project factory ────────────────────────────────────────────

/**
 * Create a project with two skills sharing one baseline.
 * projectKey must be unique per test.
 */
function createTwoSkillProject(projectKey, numCases = 2) {
  const projectId  = `proj-${projectKey}`
  const projectDir = `project_${projectKey}`
  const projectPath = path.join(tmpDir, 'projects', projectDir)

  // Skill AA
  const skillDirA = 'skill_aa_v1'
  fileService.ensureDir(path.join(projectPath, 'skills', skillDirA))
  fileService.writeText(
    path.join(projectPath, 'skills', skillDirA, 'content.txt'),
    'You are skill A.',
  )

  // Skill BB
  const skillDirB = 'skill_bb_v1'
  fileService.ensureDir(path.join(projectPath, 'skills', skillDirB))
  fileService.writeText(
    path.join(projectPath, 'skills', skillDirB, 'content.txt'),
    'You are skill B.',
  )

  // Shared baseline
  const baselineDir = 'baseline_test_v1'
  fileService.ensureDir(path.join(projectPath, 'baselines', baselineDir))
  const cases = Array.from({ length: numCases }, (_, i) => ({
    case_id:         `case_00${i + 1}`,
    input:           `Write task ${i + 1}`,
    expected_output: `Expected output for task ${i + 1}`,
  }))
  fileService.writeJson(
    path.join(projectPath, 'baselines', baselineDir, 'cases.json'),
    { cases },
  )

  fileService.ensureDir(path.join(projectPath, 'results'))
  fileService.writeJson(path.join(projectPath, 'config.json'), {
    id:          projectId,
    name:        'Two-Skill Project',
    description: '',
    status:      'pending',
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString(),
    skills: [
      { ref_id: 'skill-aa', name: 'Skill AA', version: 'v1', local_path: `skills/${skillDirA}` },
      { ref_id: 'skill-bb', name: 'Skill BB', version: 'v1', local_path: `skills/${skillDirB}` },
    ],
    baselines: [{
      ref_id:    'baseline-a',
      name:      'Baseline A',
      version:   'v1',
      local_path: `baselines/${baselineDir}`,
    }],
    cli_config: {
      model:           'claude-opus-4-6',
      timeout_seconds: 30,
      retry_count:     1,
      extra_flags:     [],
    },
    progress: {
      total_tasks:     numCases * 2,
      completed_tasks: 0,
      failed_tasks:    0,
      last_checkpoint: null,
    },
  })

  return { projectId, projectPath }
}

/**
 * Set up unlimited invokeCli mocks (for parallel tests where call order varies).
 */
function setupGenericMocks() {
  jest.spyOn(cliService, 'invokeCli')
    .mockResolvedValue({ result: 'mock output', duration_ms: 100 })
  jest.spyOn(cliService, 'getCliVersion').mockResolvedValue('1.2.0')
  jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValue({
    scores: MOCK_SCORES, reasoning: 'good job',
  })
}

// ─── UC6-5: Multi-skill parallel execution ────────────────────────────────

describe('UC6-5: multi-skill parallel execution', () => {
  test('all result files are written for each skill × case combination', async () => {
    const { projectId, projectPath } = createTwoSkillProject('uc6-5a', 2)
    setupGenericMocks()

    const finalData = await runAndWait(projectId)

    expect(finalData.completedTasks).toBe(4)
    expect(finalData.failedTasks).toBe(0)
    expect(finalData.projectStatus).toBe('completed')

    // Skill AA results
    expect(fs.existsSync(path.join(projectPath, 'results', 'skill_aa_v1', 'case_001.json'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'results', 'skill_aa_v1', 'case_002.json'))).toBe(true)
    // Skill BB results
    expect(fs.existsSync(path.join(projectPath, 'results', 'skill_bb_v1', 'case_001.json'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'results', 'skill_bb_v1', 'case_002.json'))).toBe(true)
  })

  test('each skill gets an isolated workingDir under .claude/', async () => {
    const { projectId, projectPath } = createTwoSkillProject('uc6-5b', 1)
    setupGenericMocks()

    await runAndWait(projectId)

    // ref_id 'skill-aa'.slice(0,8) = 'skill-aa' → .claude/skill_skill-aa
    expect(fs.existsSync(path.join(projectPath, '.claude', 'skill_skill-aa'))).toBe(true)
    // ref_id 'skill-bb'.slice(0,8) = 'skill-bb' → .claude/skill_skill-bb
    expect(fs.existsSync(path.join(projectPath, '.claude', 'skill_skill-bb'))).toBe(true)
  })

  test('invokeCli called (exec + score) per task: 2 skills × 2 cases = 8 total calls', async () => {
    const { projectId } = createTwoSkillProject('uc6-5c', 2)
    setupGenericMocks()

    await runAndWait(projectId)

    // 2 skills × 2 cases × (1 exec + 1 score) = 8 calls
    expect(cliService.invokeCli).toHaveBeenCalledTimes(8)
  })
})
