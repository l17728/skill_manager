'use strict'

/**
 * project-service.test.js
 * TDD Test Cases: UC3-1 through UC3-4
 */

const path = require('path')
const fs = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')
const projectFixture = require('../fixtures/project.fixture')

let workspaceService, skillService, baselineService, projectService

let tmpDir, cleanup, restoreWorkspace
let testSkillId, testBaselineId

beforeAll(async () => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)

  skillService = require('../../main/services/skill-service')
  baselineService = require('../../main/services/baseline-service')
  projectService = require('../../main/services/project-service')

  // Create a skill and baseline for project tests
  testSkillId = skillService.importSkill({
    importType: 'text',
    content: 'Python expert assistant for code generation.',
    meta: { name: 'Python助手', purpose: 'code_generate', provider: 'test_prov' },
  }).skillId

  const baselineResult = await baselineService.importBaseline({
    importType: 'manual',
    meta: { name: 'Python测试集', purpose: 'code_generate_test', provider: 'test_prov' },
    cases: [
      { id: 'case_001', name: '斐波那契', category: 'standard', input: '写一个斐波那契函数', expected_output: '正确的递推实现' },
      { id: 'case_002', name: '边界测试', category: 'boundary', input: '处理n<=0', expected_output: '返回0或报错' },
    ],
  })
  testBaselineId = baselineResult.baselineId
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

// ─── UC3-1: createProject → complete directory structure ─────────────────────

describe('UC3-1: createProject directory structure', () => {
  let projectId, projectPath

  test('creates project and returns projectId and path', async () => {
    const result = await projectService.createProject({
      ...projectFixture.basic,
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    })

    expect(result.projectId).toBeTruthy()
    expect(result.projectPath).toBeTruthy()
    expect(result.totalTasks).toBeGreaterThan(0)

    projectId = result.projectId
    projectPath = result.projectPath
  })

  test('project directory contains skills/ subdirectory', async () => {
    const { config } = projectService.getProject(projectId)
    const pPath = projectService.findProjectDir(projectId).fullPath
    expect(fs.existsSync(path.join(pPath, 'skills'))).toBe(true)
  })

  test('project directory contains baselines/ subdirectory', async () => {
    const pPath = projectService.findProjectDir(projectId).fullPath
    expect(fs.existsSync(path.join(pPath, 'baselines'))).toBe(true)
  })

  test('project directory contains .claude/ session directory', async () => {
    const pPath = projectService.findProjectDir(projectId).fullPath
    expect(fs.existsSync(path.join(pPath, '.claude'))).toBe(true)
  })

  test('project directory contains logs/', async () => {
    const pPath = projectService.findProjectDir(projectId).fullPath
    expect(fs.existsSync(path.join(pPath, 'logs'))).toBe(true)
  })

  test('project directory contains config.json', async () => {
    const pPath = projectService.findProjectDir(projectId).fullPath
    expect(fs.existsSync(path.join(pPath, 'config.json'))).toBe(true)
  })

  test('skill asset is copied into project', async () => {
    const pPath = projectService.findProjectDir(projectId).fullPath
    const skillsDir = path.join(pPath, 'skills')
    const copiedSkills = fs.readdirSync(skillsDir)
    expect(copiedSkills.length).toBeGreaterThan(0)
  })

  test('baseline asset is copied into project', async () => {
    const pPath = projectService.findProjectDir(projectId).fullPath
    const baselinesDir = path.join(pPath, 'baselines')
    const copied = fs.readdirSync(baselinesDir)
    expect(copied.length).toBeGreaterThan(0)
  })

  test('totalTasks = skillCount × caseCount', async () => {
    const result = await projectService.createProject({
      ...projectFixture.basic,
      name: 'TotalTasksTest',
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    })
    // 1 skill × 2 cases = 2 total tasks
    expect(result.totalTasks).toBe(2)
  })
})

// ─── UC3-2: createProject → config.json has skill/baseline/model info ──────

describe('UC3-2: createProject config.json contents', () => {
  let projectId

  beforeAll(async () => {
    const result = await projectService.createProject({
      ...projectFixture.basic,
      name: 'ConfigTest项目',
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    })
    projectId = result.projectId
  })

  test('config.json has correct id and status', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.id).toBe(projectId)
    expect(config.status).toBe('pending')
  })

  test('config.json contains selected skills', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.skills.length).toBe(1)
    expect(config.skills[0].ref_id).toBe(testSkillId)
    expect(config.skills[0].name).toBe('Python助手')
    expect(config.skills[0].version).toBe('v1')
    expect(config.skills[0].local_path).toBeTruthy()
  })

  test('config.json contains selected baselines', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.baselines.length).toBe(1)
    expect(config.baselines[0].ref_id).toBe(testBaselineId)
    expect(config.baselines[0].version).toBe('v1')
  })

  test('config.json has cli_config with model info', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.cli_config.model).toBe('claude-opus-4-6')
    expect(config.cli_config.timeout_seconds).toBeTruthy()
    expect(config.cli_config.retry_count).toBeTruthy()
  })

  test('config.json has context_config', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.context_config.token_threshold).toBeTruthy()
  })

  test('config.json has original_skill_ids matching skillIds', () => {
    const { config } = projectService.getProject(projectId)
    expect(Array.isArray(config.original_skill_ids)).toBe(true)
    expect(config.original_skill_ids).toContain(testSkillId)
  })

  test('config.json has iteration_config with default mode=standard', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.iteration_config).toBeTruthy()
    expect(config.iteration_config.mode).toBe('standard')
    expect(config.iteration_config.beam_width).toBe(1)
  })

  test('config.json has progress tracking', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.progress).toBeTruthy()
    expect(config.progress.total_tasks).toBe(2)
    expect(config.progress.completed_tasks).toBe(0)
    expect(config.progress.last_checkpoint).toBeNull()
  })
})

// ─── UC3-3: reopenProject → status preserved ────────────────────────────────

describe('UC3-3: reopenProject (reopen history project)', () => {
  let projectId

  beforeAll(async () => {
    const result = await projectService.createProject({
      ...projectFixture.basic,
      name: 'ReopenTest项目',
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    })
    projectId = result.projectId

    // Simulate running the project
    projectService.updateProjectStatus(projectId, 'running')
  })

  test('getProject reads current status', () => {
    const { config } = projectService.getProject(projectId)
    expect(config.status).toBe('running')
    expect(config.id).toBe(projectId)
  })

  test('listProjects returns the project', () => {
    const result = projectService.listProjects({ status: 'running' })
    const ids = result.items.map(i => i.id)
    expect(ids).toContain(projectId)
  })

  test('updateProjectStatus to interrupted', () => {
    projectService.updateProjectStatus(projectId, 'interrupted')
    const { config } = projectService.getProject(projectId)
    expect(config.status).toBe('interrupted')
  })

  test('listProjects with status filter excludes non-matching', () => {
    const result = projectService.listProjects({ status: 'completed' })
    const ids = result.items.map(i => i.id)
    expect(ids).not.toContain(projectId)
  })

  test('getProject throws NOT_FOUND for unknown id', () => {
    expect(() => projectService.getProject('00000000-0000-0000-0000-000000000000')).toThrow()
  })
})

// ─── UC3-4: exportProject ────────────────────────────────────────────────────

describe('UC3-4: exportProject', () => {
  let projectId, exportDestDir

  beforeAll(async () => {
    const result = await projectService.createProject({
      ...projectFixture.basic,
      name: 'ExportTest项目',
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    })
    projectId = result.projectId
    exportDestDir = path.join(tmpDir, 'export_dest')
    fs.mkdirSync(exportDestDir, { recursive: true })
  })

  test('exportProject copies all content to destination', () => {
    const result = projectService.exportProject(projectId, exportDestDir)
    expect(result.exportedPath).toBeTruthy()
    expect(fs.existsSync(result.exportedPath)).toBe(true)
  })

  test('exported directory contains config.json', () => {
    const result = projectService.exportProject(projectId, exportDestDir + '_2')
    fs.mkdirSync(exportDestDir + '_2', { recursive: true })
    const result2 = projectService.exportProject(projectId, exportDestDir + '_2')
    expect(fs.existsSync(path.join(result2.exportedPath, 'config.json'))).toBe(true)
  })

  test('exported directory contains skills/ and baselines/', () => {
    const exportDir3 = exportDestDir + '_3'
    fs.mkdirSync(exportDir3, { recursive: true })
    const result = projectService.exportProject(projectId, exportDir3)
    expect(fs.existsSync(path.join(result.exportedPath, 'skills'))).toBe(true)
    expect(fs.existsSync(path.join(result.exportedPath, 'baselines'))).toBe(true)
  })

  test('deleteProject removes project directory', () => {
    // Create a project just for deletion
    return projectService.createProject({
      ...projectFixture.basic,
      name: 'DeleteMe',
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    }).then(({ projectId: delId }) => {
      const found = projectService.findProjectDir(delId)
      expect(fs.existsSync(found.fullPath)).toBe(true)
      projectService.deleteProject(delId)
      expect(fs.existsSync(found.fullPath)).toBe(false)
    })
  })
})

// ─── P3-2: cloneProject ────────────────────────────────────────────────────

describe('cloneProject', () => {
  let sourceProjectId

  beforeAll(async () => {
    const res = await projectService.createProject({
      name: 'OriginalProject',
      skillIds: [testSkillId],
      baselineIds: [testBaselineId],
    })
    sourceProjectId = res.projectId
  })

  test('clone returns new projectId different from source', async () => {
    const res = await projectService.cloneProject(sourceProjectId)
    expect(res.projectId).toBeDefined()
    expect(res.projectId).not.toBe(sourceProjectId)
  })

  test('cloned project has name ending in -副本', async () => {
    const res = await projectService.cloneProject(sourceProjectId)
    const found = projectService.findProjectDir(res.projectId)
    const config = require('fs').readFileSync(require('path').join(found.fullPath, 'config.json'), 'utf-8')
    const cfg = JSON.parse(config)
    expect(cfg.name).toBe('OriginalProject-副本')
  })

  test('cloned project starts with pending status', async () => {
    const res = await projectService.cloneProject(sourceProjectId)
    const cfg = projectService.getProject(res.projectId).config
    expect(cfg.status).toBe('pending')
  })

  test('cloned project has same skill and baseline refs', async () => {
    const res = await projectService.cloneProject(sourceProjectId)
    const cfg = projectService.getProject(res.projectId).config
    expect(cfg.skills[0].ref_id).toBe(testSkillId)
    expect(cfg.baselines[0].ref_id).toBe(testBaselineId)
  })

  test('cloneProject throws NOT_FOUND for unknown projectId', async () => {
    await expect(projectService.cloneProject('nonexistent-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
