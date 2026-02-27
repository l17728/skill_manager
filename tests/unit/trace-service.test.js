'use strict'

/**
 * trace-service.test.js
 * TDD Test Cases: UC10-1 through UC10-2
 *
 * Tests: complete environment snapshot, result-file version extraction,
 * model version comparison, and identical-project detection.
 */

const path = require('path')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let tmpDir, cleanup, restoreWorkspace
let traceService, fileService

// ─── Module setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  const tmp = createTmpDir('trace-svc-')
  tmpDir  = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

  fileService  = require('../../main/services/file-service')
  traceService = require('../../main/services/trace-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── Test project factory ─────────────────────────────────────────────────

function makeTraceProject(key, { model = 'claude-opus-4-6', withResults = false } = {}) {
  const projectId   = `tproj-${key}`
  const projectDir  = `project_${key}`
  const projectPath = path.join(tmpDir, 'projects', projectDir)

  fileService.ensureDir(path.join(projectPath, '.claude'))

  fileService.writeJson(path.join(projectPath, 'config.json'), {
    id:         projectId,
    name:       `Trace Test Project ${key}`,
    created_at: '2024-01-01T10:00:00Z',
    status:     'completed',
    skills: [
      { ref_id: 'skill-a', name: 'Skill A', version: 'v1', local_path: 'skills/skill_a_v1' },
    ],
    baselines: [
      { ref_id: 'bl-a', name: 'Baseline A', version: 'v1', local_path: 'baselines/bl_a_v1' },
    ],
    cli_config: { model, timeout_seconds: 60, retry_count: 2 },
  })

  if (withResults) {
    fileService.ensureDir(path.join(projectPath, 'results', 'skill_a_v1'))
    fileService.writeJson(path.join(projectPath, 'results', 'skill_a_v1', 'case_001.json'), {
      case_id:       'case_001',
      cli_version:   '1.2.3',
      model_version: model,
      status:        'completed',
    })
  }

  return { projectId, projectPath }
}

// ─── UC10-1: Project environment is fully reproducible ───────────────────

describe('UC10-1: getProjectEnv returns complete environment info', () => {
  test('returns projectId, projectName, createdAt, skills, baselines, cliConfig', () => {
    const { projectId } = makeTraceProject('uc10-1a')
    const env = traceService.getProjectEnv(projectId)

    expect(env.projectId).toBe(projectId)
    expect(env.projectName).toBeTruthy()
    expect(env.createdAt).toBeTruthy()
    expect(Array.isArray(env.skills)).toBe(true)
    expect(env.skills.length).toBeGreaterThan(0)
    expect(env.skills[0].id).toBeTruthy()
    expect(env.skills[0].version).toBe('v1')
    expect(Array.isArray(env.baselines)).toBe(true)
    expect(env.cliConfig).toBeTruthy()
  })

  test('modelVersion falls back to cli_config.model when no result files', () => {
    const { projectId } = makeTraceProject('uc10-1b', { model: 'claude-sonnet-4-6' })
    const env = traceService.getProjectEnv(projectId)

    expect(env.modelVersion).toBe('claude-sonnet-4-6')
  })

  test('cliVersion and modelVersion are extracted from result files when present', () => {
    const { projectId } = makeTraceProject('uc10-1c', {
      model: 'claude-opus-4-6',
      withResults: true,
    })
    const env = traceService.getProjectEnv(projectId)

    expect(env.cliVersion).toBe('1.2.3')
    expect(env.modelVersion).toBe('claude-opus-4-6')
  })

  test('cliVersion is "unknown" when no result files exist', () => {
    const { projectId } = makeTraceProject('uc10-1d')
    const env = traceService.getProjectEnv(projectId)

    expect(env.cliVersion).toBe('unknown')
  })
})

// ─── UC10-2: Compare environments across projects ────────────────────────

describe('UC10-2: compareEnvs detects differences between projects', () => {
  test('detects model version differences', () => {
    const { projectId: pidA } = makeTraceProject('uc10-2a', { model: 'claude-opus-4-6' })
    const { projectId: pidB } = makeTraceProject('uc10-2b', { model: 'claude-sonnet-4-6' })

    const result = traceService.compareEnvs(pidA, pidB)

    expect(result.identical).toBe(false)
    expect(result.differences.length).toBeGreaterThan(0)
    const modelDiff = result.differences.find(d => d.field.includes('model'))
    expect(modelDiff).toBeTruthy()
    expect(modelDiff.valueA).toContain('opus')
    expect(modelDiff.valueB).toContain('sonnet')
  })

  test('returns identical=true when the same project is compared to itself', () => {
    const { projectId } = makeTraceProject('uc10-2c', { model: 'claude-opus-4-6' })

    const result = traceService.compareEnvs(projectId, projectId)

    expect(result.identical).toBe(true)
    expect(result.differences).toHaveLength(0)
  })

  test('each difference entry has field, valueA, valueB', () => {
    const { projectId: pidA } = makeTraceProject('uc10-2d', { model: 'claude-opus-4-6' })
    const { projectId: pidB } = makeTraceProject('uc10-2e', { model: 'claude-haiku-4-5' })

    const result = traceService.compareEnvs(pidA, pidB)

    expect(result.differences.length).toBeGreaterThan(0)
    for (const diff of result.differences) {
      expect(diff.field).toBeTruthy()
      expect(diff.valueA).toBeDefined()
      expect(diff.valueB).toBeDefined()
    }
  })

  test('detects differences in cli_config.timeout_seconds', () => {
    const { projectId: pidA } = makeTraceProject('uc10-2f', { model: 'claude-opus-4-6' })
    const { projectId: pidB } = makeTraceProject('uc10-2g', { model: 'claude-opus-4-6' })

    // Manually override timeout in project B
    const cfgPath = path.join(tmpDir, 'projects', 'project_uc10-2g', 'config.json')
    const cfg = fileService.readJson(cfgPath)
    cfg.cli_config.timeout_seconds = 120
    fileService.writeJson(cfgPath, cfg)

    const result = traceService.compareEnvs(pidA, pidB)

    expect(result.identical).toBe(false)
    const timeoutDiff = result.differences.find(d => d.field === 'cliConfig.timeout_seconds')
    expect(timeoutDiff).toBeTruthy()
    expect(timeoutDiff.valueA).toBe('60')
    expect(timeoutDiff.valueB).toBe('120')
  })
})
