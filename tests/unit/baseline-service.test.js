'use strict'

/**
 * baseline-service.test.js
 * TDD Test Cases: UC2-1 through UC2-6
 */

const path = require('path')
const fs = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')
const baselineFixture = require('../fixtures/baseline.fixture')

let workspaceService, baselineService

let tmpDir, cleanup, restoreWorkspace

beforeAll(() => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)

  baselineService = require('../../main/services/baseline-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

// ─── UC2-1: importBaseline (manual) ─────────────────────────────────────────

describe('UC2-1: importBaseline manual — fields complete', () => {
  let baselineId

  test('creates baseline with correct structure', async () => {
    const result = await baselineService.importBaseline(baselineFixture.manual)
    expect(result.baselineId).toBeTruthy()
    expect(result.version).toBe('v1')
    expect(result.caseCount).toBe(2)
    baselineId = result.baselineId
  })

  test('meta.json fields are complete', async () => {
    const { meta } = baselineService.getBaseline(baselineId)
    expect(meta.id).toBeTruthy()
    expect(meta.name).toBe('Python代码生成标准测试集')
    expect(meta.purpose).toBe('code_generate_test')
    expect(meta.provider).toBe('provider_internal')
    expect(meta.version).toBe('v1')
    expect(meta.case_count).toBe(2)
    expect(meta.status).toBe('active')
  })

  test('cases.json is correct', async () => {
    const { cases } = baselineService.getBaseline(baselineId)
    expect(cases.baseline_id).toBe(baselineId)
    expect(cases.cases.length).toBe(2)
    expect(cases.cases[0].id).toBe('case_001')
    expect(cases.cases[0].category).toBe('standard')
    expect(cases.cases[0].input).toBeTruthy()
    expect(cases.cases[0].expected_output).toBeTruthy()
    expect(cases.cases[0].created_at).toBeTruthy()
  })

  test('tags.json has empty arrays', async () => {
    const { tags } = baselineService.getBaseline(baselineId)
    expect(tags.manual).toEqual([])
    expect(tags.auto).toEqual([])
  })
})

// ─── UC2-2: importBaseline (file, with dedup) ────────────────────────────────

describe('UC2-2: importBaseline file with dedup', () => {
  let tmpFilePath, baselineId

  beforeAll(async () => {
    // Write a cases JSON file with duplicates
    const casesData = {
      baseline_id: 'placeholder',
      version: 'v1',
      cases: [
        { id: 'case_001', name: '测试A', category: 'standard', input: '输入A', expected_output: '输出A' },
        { id: 'case_001', name: '测试A重复', category: 'standard', input: '输入A重复', expected_output: '输出A重复' },
        { id: 'case_002', name: '测试B', category: 'boundary', input: '输入B', expected_output: '输出B' },
      ],
    }
    tmpFilePath = path.join(tmpDir, 'test_cases.json')
    fs.writeFileSync(tmpFilePath, JSON.stringify(casesData, null, 2), 'utf-8')

    const result = await baselineService.importBaseline({
      importType: 'file',
      meta: { name: '文件导入测试集', purpose: 'file_import_test', provider: 'test_prov' },
      filePath: tmpFilePath,
    })
    baselineId = result.baselineId
  })

  test('duplicate case_id is automatically skipped', async () => {
    const { cases, meta } = baselineService.getBaseline(baselineId)
    // Only 2 unique IDs: case_001 and case_002
    expect(cases.cases.length).toBe(2)
    expect(meta.case_count).toBe(2)
    const ids = cases.cases.map(c => c.id)
    expect(ids).toContain('case_001')
    expect(ids).toContain('case_002')
    // No duplicate
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(2)
  })

  test('non-duplicate case is included', async () => {
    const { cases } = baselineService.getBaseline(baselineId)
    const c2 = cases.cases.find(c => c.id === 'case_002')
    expect(c2).toBeTruthy()
    expect(c2.input).toBe('输入B')
  })
})

// ─── UC2-3: filterByCaseTags ────────────────────────────────────────────────

describe('UC2-3: filterCasesByTags', () => {
  let baselineId

  beforeAll(async () => {
    const result = await baselineService.importBaseline({
      importType: 'manual',
      meta: { name: '标签筛选测试集', purpose: 'tag_filter_test', provider: 'test_prov' },
      cases: [
        { id: 'case_001', name: '标准用例1', category: 'standard', input: '标准输入1', expected_output: '输出1' },
        { id: 'case_002', name: '边界用例1', category: 'boundary', input: '边界输入1', expected_output: '输出2' },
        { id: 'case_003', name: '异常用例1', category: 'exception', input: '异常输入1', expected_output: '输出3' },
      ],
    })
    baselineId = result.baselineId
  })

  test('filter by category "boundary" returns only boundary cases', () => {
    const { cases } = baselineService.filterCasesByTags(baselineId, ['boundary'])
    expect(cases.length).toBeGreaterThan(0)
    expect(cases.every(c => c.category === 'boundary')).toBe(true)
  })

  test('filter by category "exception" returns only exception cases', () => {
    const { cases } = baselineService.filterCasesByTags(baselineId, ['exception'])
    expect(cases.every(c => c.category === 'exception')).toBe(true)
  })

  test('no filter returns all cases', () => {
    const { cases } = baselineService.filterCasesByTags(baselineId, [])
    expect(cases.length).toBe(3)
  })
})

// ─── UC2-4: updateCase → meta version increments ────────────────────────────

describe('UC2-4: updateCase → version increment', () => {
  let baselineId

  beforeAll(async () => {
    const result = await baselineService.importBaseline({
      importType: 'manual',
      meta: { name: '版本更新测试集', purpose: 'update_test', provider: 'test_prov' },
      cases: [
        { id: 'case_001', name: '原始用例', category: 'standard', input: '原始输入', expected_output: '原始输出' },
      ],
    })
    baselineId = result.baselineId
  })

  test('updateCase creates new version', () => {
    const result = baselineService.updateCase(baselineId, 'v1', 'case_001', {
      input: '更新后输入',
      expected_output: '更新后输出',
    })
    expect(result.newVersion).toBe('v2')
  })

  test('meta version is updated', () => {
    const { meta } = baselineService.getBaseline(baselineId)
    expect(meta.version).toBe('v2')
    expect(meta.version_count).toBe(2)
  })

  test('case content is updated', () => {
    const { cases } = baselineService.getBaseline(baselineId)
    const c = cases.cases.find(c => c.id === 'case_001')
    expect(c.input).toBe('更新后输入')
    expect(c.expected_output).toBe('更新后输出')
  })

  test('history diff exists', () => {
    const found = baselineService.findBaselineDir(baselineId)
    const histDir = path.join(found.fullPath, 'history')
    const files = fs.readdirSync(histDir)
    expect(files.length).toBeGreaterThan(0)
  })
})

// ─── UC2-5: importBaseline (cli_generate) ────────────────────────────────────

describe('UC2-5: importBaseline cli_generate', () => {
  test('generates cases via CLI (mocked)', async () => {
    const cliLite = require('../../main/services/cli-lite-service')
    const originalGenerate = cliLite.generateBaselineCases
    cliLite.generateBaselineCases = jest.fn().mockResolvedValue({
      cases: [
        { name: 'CLI生成用例1', category: 'standard', input: 'CLI输入1', expected_output: 'CLI输出1', description: '' },
        { name: 'CLI生成用例2', category: 'boundary', input: 'CLI输入2', expected_output: 'CLI输出2', description: '' },
      ],
      rawOutput: '{"cases":[...]}',
    })

    const result = await baselineService.importBaseline({
      importType: 'cli_generate',
      meta: { name: 'CLI生成测试集', purpose: 'cli_gen_test', provider: 'test_prov' },
      generatePrompt: 'Python函数测试用例',
    })

    expect(result.caseCount).toBe(2)
    const { cases } = baselineService.getBaseline(result.baselineId)
    expect(cases.cases.length).toBe(2)
    expect(cases.cases[0].name).toBe('CLI生成用例1')

    cliLite.generateBaselineCases = originalGenerate
  })
})

// ─── UC2-6: autoTagTrigger (baseline) ────────────────────────────────────────

describe('UC2-6: triggerAutoTag for baseline', () => {
  let baselineId

  beforeAll(async () => {
    const result = await baselineService.importBaseline({
      importType: 'manual',
      meta: { name: '自动打标签基线测试', purpose: 'autotag_test', provider: 'test_prov' },
      cases: [
        { id: 'case_001', name: '测试用例', category: 'standard', input: '测试输入', expected_output: '测试输出' },
      ],
    })
    baselineId = result.baselineId
  })

  test('triggerAutoTag returns taskId', async () => {
    const cliLite = require('../../main/services/cli-lite-service')
    cliLite.autoTagBaseline = jest.fn().mockResolvedValue({
      logRecord: {
        session_id: 'tmp_sess_baseline123',
        triggered_at: new Date().toISOString(),
        triggered_by: 'user',
        target_type: 'baseline',
        target_id: baselineId,
        status: 'completed',
        duration_ms: 800,
        cli_version: '1.0.0',
        model_version: 'claude-opus-4-6',
        raw_output: '{"tags":["边界测试","基础"]}',
        parsed_tags: [{ value: '边界测试' }, { value: '基础' }],
        error: null,
      },
      parsedTags: ['边界测试', '基础'],
      status: 'completed',
    })

    const { taskId, runTag } = await baselineService.triggerAutoTag(baselineId)
    expect(taskId).toBeTruthy()

    const result = await runTag()
    expect(result.status).toBe('completed')
    expect(Array.isArray(result.parsedTags)).toBe(true)
  })

  test('on parse failure, log is saved with raw_output and parsed_tags is empty', async () => {
    const cliLite = require('../../main/services/cli-lite-service')
    cliLite.autoTagBaseline = jest.fn().mockResolvedValue({
      logRecord: {
        session_id: 'tmp_sess_fail',
        triggered_at: new Date().toISOString(),
        triggered_by: 'user',
        target_type: 'baseline',
        target_id: baselineId,
        status: 'failed',
        duration_ms: 200,
        cli_version: '1.0.0',
        model_version: 'claude-opus-4-6',
        raw_output: 'This is not JSON format response from CLI',
        parsed_tags: [],
        error: 'OUTPUT_PARSE_FAILED',
      },
      parsedTags: [],
      status: 'failed',
    })

    const { taskId, runTag } = await baselineService.triggerAutoTag(baselineId)
    const result = await runTag()
    expect(result.status).toBe('failed')
    expect(result.parsedTags).toEqual([])

    // Check log was saved
    const found = baselineService.findBaselineDir(baselineId)
    const logDir = path.join(found.fullPath, 'auto_tag_log')
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
  })
})

// ─── caseCount:0 logs warn (Problem 5 fix) ───────────────────────────────────

describe('importBaseline with no cases logs warn', () => {
  test('logs warn level when caseCount is 0', async () => {
    const logService = require('../../main/services/log-service')
    const warnSpy = jest.spyOn(logService, 'warn')
    const infoSpy = jest.spyOn(logService, 'info')

    await baselineService.importBaseline({
      importType: 'manual',
      meta: { name: 'Empty Baseline', purpose: 'empty_test', provider: 'test_provider' },
      cases: [],
    })

    // warn should have been called with caseCount:0
    expect(warnSpy).toHaveBeenCalledWith(
      'baseline-service',
      expect.stringMatching(/no cases/i),
      expect.objectContaining({ caseCount: 0 })
    )

    // info 'Baseline imported' should NOT have been called for zero-case import
    const importInfoCall = infoSpy.mock.calls.find(([, msg]) => msg === 'Baseline imported')
    expect(importInfoCall).toBeUndefined()

    warnSpy.mockRestore()
    infoSpy.mockRestore()
  })

  test('logs info (not warn) when caseCount > 0', async () => {
    const logService = require('../../main/services/log-service')
    const warnSpy = jest.spyOn(logService, 'warn')
    const infoSpy = jest.spyOn(logService, 'info')

    await baselineService.importBaseline({
      importType: 'manual',
      meta: { name: 'Non-empty Baseline', purpose: 'nonempty_test', provider: 'test_provider' },
      cases: [{ name: 'Case 1', input: 'input', expected_output: 'output' }],
    })

    const importInfoCall = infoSpy.mock.calls.find(([, msg]) => msg === 'Baseline imported')
    expect(importInfoCall).toBeDefined()

    const importWarnCall = warnSpy.mock.calls.find(([, msg]) => /no cases/i.test(msg))
    expect(importWarnCall).toBeUndefined()

    warnSpy.mockRestore()
    infoSpy.mockRestore()
  })
})
