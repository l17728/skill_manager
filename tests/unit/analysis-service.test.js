'use strict'

/**
 * analysis-service.test.js
 * TDD Test Cases: UC7-1 through UC7-4
 *
 * Tests: best skill identification, comparison reasoning output,
 * advantage segment extraction (≥3 types), and structured report storage.
 */

const path = require('path')
const fs   = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let tmpDir, cleanup, restoreWorkspace
let analysisService, cliService, fileService

// ─── Module setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  const tmp = createTmpDir('analysis-svc-')
  tmpDir  = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

  fileService     = require('../../main/services/file-service')
  analysisService = require('../../main/services/analysis-service')
  cliService      = require('../../main/services/cli-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── Test project factory ─────────────────────────────────────────────────

let _counter = 0

function makeAnalysisProject(key) {
  _counter++
  const projectId  = `aproj-${key}`
  const projectDir = `project_${key}`
  const projectPath = path.join(tmpDir, 'projects', projectDir)

  fileService.ensureDir(path.join(projectPath, '.claude'))
  fileService.ensureDir(path.join(projectPath, 'results', 'skill_a_v1'))
  fileService.ensureDir(path.join(projectPath, 'results', 'skill_b_v1'))

  // Skill content
  fileService.ensureDir(path.join(projectPath, 'skills', 'skill_a_v1'))
  fileService.writeText(
    path.join(projectPath, 'skills', 'skill_a_v1', 'content.txt'),
    '你是一个专业Python开发者，请遵循PEP8规范。'
  )
  fileService.ensureDir(path.join(projectPath, 'skills', 'skill_b_v1'))
  fileService.writeText(
    path.join(projectPath, 'skills', 'skill_b_v1', 'content.txt'),
    '生成代码时必须包含输入参数的类型检查和边界值处理。'
  )

  // summary.json (skill A is better)
  fileService.writeJson(path.join(projectPath, 'results', 'summary.json'), {
    project_id: projectId,
    generated_at: new Date().toISOString(),
    total_cases: 2,
    ranking: [
      {
        rank: 1,
        skill_id:   'skill-a',
        skill_name: 'Skill A',
        skill_version: 'v1',
        completed_cases: 2, failed_cases: 0, avg_score: 85,
        score_breakdown: {
          functional_correctness: 27, robustness: 16, readability: 14,
          conciseness: 13, complexity_control: 8, format_compliance: 9,
        },
      },
      {
        rank: 2,
        skill_id:   'skill-b',
        skill_name: 'Skill B',
        skill_version: 'v1',
        completed_cases: 2, failed_cases: 0, avg_score: 79,
        score_breakdown: {
          functional_correctness: 24, robustness: 18, readability: 11,
          conciseness: 11, complexity_control: 8, format_compliance: 7,
        },
      },
    ],
  })

  // result files
  for (const [skillDir, skillId] of [['skill_a_v1', 'skill-a'], ['skill_b_v1', 'skill-b']]) {
    for (let c = 1; c <= 2; c++) {
      fileService.writeJson(
        path.join(projectPath, 'results', skillDir, `case_00${c}.json`),
        {
          case_id: `case_00${c}`, skill_id: skillId, status: 'completed',
          scores: { total: skillId === 'skill-a' ? 85 : 79, functional_correctness: 25, robustness: 15, readability: 12, conciseness: 12, complexity_control: 8, format_compliance: 8 },
        }
      )
    }
  }

  // config
  fileService.writeJson(path.join(projectPath, 'config.json'), {
    id: projectId,
    name: 'Analysis Test Project',
    status: 'completed',
    skills: [
      { ref_id: 'skill-a', name: 'Skill A', version: 'v1', local_path: 'skills/skill_a_v1' },
      { ref_id: 'skill-b', name: 'Skill B', version: 'v1', local_path: 'skills/skill_b_v1' },
    ],
    baselines: [{ ref_id: 'bl-a', name: 'Python Baseline', version: 'v1', local_path: 'baselines/bl_a_v1' }],
    cli_config: { model: 'claude-opus-4-6', timeout_seconds: 60 },
    progress: { total_tasks: 4, completed_tasks: 4, failed_tasks: 0, last_checkpoint: 4 },
  })

  return { projectId, projectPath }
}

// ─── Mock CLI response ────────────────────────────────────────────────────

const MOCK_REPORT_OUTPUT = JSON.stringify({
  best_skill_id:   'skill-a',
  best_skill_name: 'Skill A',
  dimension_leaders: {
    functional_correctness: 'skill-a',
    robustness:             'skill-b',
    readability:            'skill-a',
    conciseness:            'skill-a',
    complexity_control:     'skill-a',
    format_compliance:      'skill-a',
  },
  advantage_segments: [
    {
      id: 'seg_001', skill_id: 'skill-a', skill_name: 'Skill A',
      type: 'role',
      content: '你是一个专业Python开发者，请遵循PEP8规范。',
      reason:  '角色设定明确，有助于生成规范代码',
      dimension: 'readability',
    },
    {
      id: 'seg_002', skill_id: 'skill-b', skill_name: 'Skill B',
      type: 'constraint',
      content: '生成代码时必须包含输入参数的类型检查和边界值处理。',
      reason:  '约束条件提升了健壮性',
      dimension: 'robustness',
    },
    {
      id: 'seg_003', skill_id: 'skill-a', skill_name: 'Skill A',
      type: 'format',
      content: '输出格式：直接给出完整可运行的Python代码，包含必要的docstring。',
      reason:  '格式约定减少无效输出',
      dimension: 'format_compliance',
    },
  ],
  issues: [
    {
      skill_id:    'skill-b',
      skill_name:  'Skill B',
      dimension:   'readability',
      description: '缺少对代码注释和命名规范的明确要求',
    },
  ],
})

// ─── UC7-1: Identifies the best skill ────────────────────────────────────

describe('UC7-1: runAnalysis identifies the best-scoring skill', () => {
  test('analysis_report.json records best_skill_id from CLI response', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-1a')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 500 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, {
        onComplete: (data) => { if (data.status === 'completed') resolve() },
      })
    })

    const report = JSON.parse(fs.readFileSync(path.join(projectPath, 'analysis_report.json'), 'utf-8'))
    expect(report.best_skill_id).toBe('skill-a')
    expect(report.best_skill_name).toBe('Skill A')
  })

  test('returns taskId immediately without blocking', async () => {
    const { projectId } = makeAnalysisProject('uc7-1b')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValue({ result: MOCK_REPORT_OUTPUT, duration_ms: 10 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValue(JSON.parse(MOCK_REPORT_OUTPUT))

    const result = await analysisService.runAnalysis(projectId, { onComplete: () => {} })
    expect(result.taskId).toBeTruthy()
    expect(typeof result.taskId).toBe('string')

    // Let the background task finish
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))
  })
})

// ─── UC7-2: Comparison reasoning output ──────────────────────────────────

describe('UC7-2: analysis report includes comparison reasoning (issues)', () => {
  test('report contains dimension_leaders mapping all 6 dimensions', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-2a')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 500 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const report = JSON.parse(fs.readFileSync(path.join(projectPath, 'analysis_report.json'), 'utf-8'))
    const dims = ['functional_correctness', 'robustness', 'readability', 'conciseness', 'complexity_control', 'format_compliance']
    for (const dim of dims) {
      expect(report.dimension_leaders[dim]).toBeTruthy()
    }
  })

  test('report contains issues list with skill_id and description', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-2b')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 200 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const report = JSON.parse(fs.readFileSync(path.join(projectPath, 'analysis_report.json'), 'utf-8'))
    expect(report.issues.length).toBeGreaterThan(0)
    expect(report.issues[0].skill_id).toBeTruthy()
    expect(report.issues[0].description).toBeTruthy()
  })
})

// ─── UC7-3: Extracts ≥3 advantage segments of different types ─────────────

describe('UC7-3: advantage_segments contains at least 3 items of valid types', () => {
  test('advantage_segments has ≥3 entries', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-3a')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 300 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const report = JSON.parse(fs.readFileSync(path.join(projectPath, 'analysis_report.json'), 'utf-8'))
    expect(report.advantage_segments.length).toBeGreaterThanOrEqual(3)
  })

  test('each segment has required fields: id, skill_id, type, content, reason, dimension', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-3b')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 300 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const report = JSON.parse(fs.readFileSync(path.join(projectPath, 'analysis_report.json'), 'utf-8'))
    const validTypes = ['instruction', 'constraint', 'format', 'role', 'example']
    for (const seg of report.advantage_segments) {
      expect(seg.id).toBeTruthy()
      expect(seg.skill_id).toBeTruthy()
      expect(validTypes).toContain(seg.type)
      expect(seg.content).toBeTruthy()
      expect(seg.reason).toBeTruthy()
      expect(seg.dimension).toBeTruthy()
    }
  })

  test('segments cover at least 2 distinct types', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-3c')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 200 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const report = JSON.parse(fs.readFileSync(path.join(projectPath, 'analysis_report.json'), 'utf-8'))
    const types = new Set(report.advantage_segments.map(s => s.type))
    expect(types.size).toBeGreaterThanOrEqual(2)
  })
})

// ─── UC7-4: Structured analysis report is written ────────────────────────

describe('UC7-4: analysis_report.json has complete schema', () => {
  test('report file exists with all required top-level fields', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-4a')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 200 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const reportPath = path.join(projectPath, 'analysis_report.json')
    expect(fs.existsSync(reportPath)).toBe(true)

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
    expect(report.project_id).toBe(projectId)
    expect(report.generated_at).toBeTruthy()
    expect(report.best_skill_id).toBeTruthy()
    expect(report.best_skill_name).toBeTruthy()
    expect(report.dimension_leaders).toBeTruthy()
    expect(Array.isArray(report.advantage_segments)).toBe(true)
    expect(Array.isArray(report.issues)).toBe(true)
  })

  test('getReport returns the stored report', async () => {
    const { projectId } = makeAnalysisProject('uc7-4b')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 200 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const report = analysisService.getReport(projectId)
    expect(report.project_id).toBe(projectId)
    expect(report.best_skill_id).toBe('skill-a')
  })

  test('exportReport writes JSON file', async () => {
    const { projectId } = makeAnalysisProject('uc7-4c')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 200 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const dest = path.join(tmpDir, 'exports', `report_${projectId}.json`)
    const { exportedPath } = analysisService.exportReport(projectId, { format: 'json', destPath: dest })
    expect(exportedPath).toBe(dest)
    expect(fs.existsSync(dest)).toBe(true)
  })

  test('exportReport writes Markdown file', async () => {
    const { projectId } = makeAnalysisProject('uc7-4d')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({ result: MOCK_REPORT_OUTPUT, duration_ms: 200 })
    jest.spyOn(cliService, 'parseStructuredOutput').mockReturnValueOnce(JSON.parse(MOCK_REPORT_OUTPUT))

    await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: d => d.status === 'completed' && resolve() })
    })

    const dest = path.join(tmpDir, 'exports', `report_${projectId}.md`)
    analysisService.exportReport(projectId, { format: 'md', destPath: dest })
    const content = fs.readFileSync(dest, 'utf-8')
    expect(content).toContain('差异分析报告')
    expect(content).toContain('优势片段')
  })
})

// ─── UC7-5: CLI error handling ────────────────────────────────────────────
//
// Verifies that CLI failures (timeout, not-available) are surfaced via the
// onComplete callback with status:'failed' and a structured error field that
// includes the error code, so the renderer can display a meaningful message.

describe('UC7-5: CLI failures delivered through onComplete with structured error', () => {
  test('CLI_TIMEOUT → onComplete status:failed, error contains CLI_TIMEOUT', async () => {
    const { projectId } = makeAnalysisProject('uc7-5a')
    jest.spyOn(cliService, 'invokeCli').mockRejectedValue({ code: 'CLI_TIMEOUT' })

    const result = await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: resolve })
        .catch(resolve) // should not throw — errors go through onComplete
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('CLI_TIMEOUT')
  })

  test('CLI_NOT_AVAILABLE → onComplete status:failed, error contains CLI_NOT_AVAILABLE', async () => {
    const { projectId } = makeAnalysisProject('uc7-5b')
    jest.spyOn(cliService, 'invokeCli').mockRejectedValue({ code: 'CLI_NOT_AVAILABLE', message: 'Claude not found' })

    const result = await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: resolve }).catch(resolve)
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('CLI_NOT_AVAILABLE')
    expect(result.error).toContain('Claude not found')
  })

  test('CLI_EXECUTION_ERROR → onComplete status:failed, no report file written', async () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-5c')
    jest.spyOn(cliService, 'invokeCli').mockRejectedValue({ code: 'CLI_EXECUTION_ERROR', stderr: 'bad exit' })

    const result = await new Promise(resolve => {
      analysisService.runAnalysis(projectId, { onComplete: resolve }).catch(resolve)
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('CLI_EXECUTION_ERROR')
    // No report file should have been written
    expect(fs.existsSync(path.join(projectPath, 'analysis_report.json'))).toBe(false)
  })
})

// ─── buildAnalysisPrompt (unit test) ────────────────────────────────────

describe('buildAnalysisPrompt', () => {
  test('includes baseline name and case count', () => {
    const { projectId, projectPath } = makeAnalysisProject('uc7-prompt')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))

    const prompt = analysisService.buildAnalysisPrompt(projectPath, config)
    expect(prompt).toContain('Python Baseline')
    expect(prompt).toContain('2条')
  })

  test('includes skill content for both skills', () => {
    const { projectPath } = makeAnalysisProject('uc7-prompt2')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))

    const prompt = analysisService.buildAnalysisPrompt(projectPath, config)
    expect(prompt).toContain('PEP8规范')
    expect(prompt).toContain('类型检查')
  })

  test('no iteration_context placeholder remains when no original_skill_ids', () => {
    const { projectPath } = makeAnalysisProject('uc7-noiter')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))
    // config has no original_skill_ids → iterationContext is ''
    const prompt = analysisService.buildAnalysisPrompt(projectPath, config)
    expect(prompt).not.toContain('{iteration_context}')
    expect(prompt).not.toContain('迭代背景')
  })

  test('injects iteration context block when original_skill_ids present with candidate', () => {
    const { projectPath } = makeAnalysisProject('uc7-iterctx')
    // Manually set original_skill_ids = ['skill-a'] and add an iteration candidate
    const config = fileService.readJson(path.join(projectPath, 'config.json'))
    config.original_skill_ids = ['skill-a']
    // skill-b is NOT in original_skill_ids → treated as iteration candidate
    const prompt = analysisService.buildAnalysisPrompt(projectPath, config)
    expect(prompt).toContain('迭代背景')
    expect(prompt).toContain('原始参照')
    expect(prompt).toContain('迭代候选')
  })

  test('tags original skills with 【原始参照】 and candidates with 【迭代候选】', () => {
    const { projectPath } = makeAnalysisProject('uc7-tags')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))
    config.original_skill_ids = ['skill-a']
    const prompt = analysisService.buildAnalysisPrompt(projectPath, config)
    expect(prompt).toContain('Skill A【原始参照】')
    expect(prompt).toContain('Skill B【迭代候选】')
  })
})
