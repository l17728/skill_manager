'use strict'

/**
 * recompose-service.test.js
 * TDD Test Cases: UC8-1 through UC8-4
 *
 * Tests: multi-skill merge, complete recomposed skill, provenance tracking,
 * and save-as-new-version functionality.
 */

const path = require('path')
const fs   = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let tmpDir, cleanup, restoreWorkspace
let recomposeService, cliService, fileService

// ─── Module setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  const tmp = createTmpDir('recompose-svc-')
  tmpDir  = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

  fileService      = require('../../main/services/file-service')
  recomposeService = require('../../main/services/recompose-service')
  cliService       = require('../../main/services/cli-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── Test project factory ─────────────────────────────────────────────────

function makeRecomposeProject(key, withReport = true) {
  const projectId  = `rproj-${key}`
  const projectDir = `project_${key}`
  const projectPath = path.join(tmpDir, 'projects', projectDir)

  fileService.ensureDir(path.join(projectPath, '.claude'))
  fileService.ensureDir(path.join(projectPath, 'results'))

  fileService.writeJson(path.join(projectPath, 'config.json'), {
    id: projectId,
    name: 'Recompose Test Project',
    status: 'completed',
    skills: [
      { ref_id: 'skill-a', name: 'Skill A', version: 'v1', local_path: 'skills/skill_a_v1' },
      { ref_id: 'skill-b', name: 'Skill B', version: 'v1', local_path: 'skills/skill_b_v1' },
    ],
    baselines: [{ ref_id: 'bl-a', name: 'Baseline A', version: 'v1', local_path: 'baselines/bl_a_v1' }],
    cli_config: { model: 'claude-opus-4-6', timeout_seconds: 60 },
  })

  fileService.writeJson(path.join(projectPath, 'results', 'summary.json'), {
    project_id: projectId,
    generated_at: new Date().toISOString(),
    total_cases: 2,
    ranking: [
      { rank: 1, skill_id: 'skill-a', skill_name: 'Skill A', skill_version: 'v1', avg_score: 85, completed_cases: 2, failed_cases: 0, score_breakdown: {} },
      { rank: 2, skill_id: 'skill-b', skill_name: 'Skill B', skill_version: 'v1', avg_score: 79, completed_cases: 2, failed_cases: 0, score_breakdown: {} },
    ],
  })

  if (withReport) {
    fileService.writeJson(path.join(projectPath, 'analysis_report.json'), {
      project_id:      projectId,
      generated_at:    new Date().toISOString(),
      best_skill_id:   'skill-a',
      best_skill_name: 'Skill A',
      dimension_leaders: {
        functional_correctness: 'skill-a', robustness: 'skill-b',
        readability: 'skill-a', conciseness: 'skill-a',
        complexity_control: 'skill-a', format_compliance: 'skill-a',
      },
      advantage_segments: [
        {
          id: 'seg_001', skill_id: 'skill-a', skill_name: 'Skill A',
          type: 'role', content: '你是专业Python开发者，遵循PEP8规范。',
          reason: '角色设定清晰', dimension: 'readability',
        },
        {
          id: 'seg_002', skill_id: 'skill-b', skill_name: 'Skill B',
          type: 'constraint', content: '必须包含类型检查和边界值处理。',
          reason: '提升健壮性', dimension: 'robustness',
        },
        {
          id: 'seg_003', skill_id: 'skill-a', skill_name: 'Skill A',
          type: 'format', content: '直接输出完整可运行代码，包含docstring。',
          reason: '格式规范减少无效输出', dimension: 'format_compliance',
        },
      ],
      issues: [],
    })
  }

  return { projectId, projectPath }
}

const MOCK_RECOMPOSED_CONTENT = `你是一个专业的Python开发者，擅长生成高质量、可维护的Python代码。请遵循PEP8规范。
生成代码时必须包含输入参数的类型检查和边界值处理，对所有可能的异常情况进行捕获。
输出格式：直接给出完整可运行的Python代码，包含必要的docstring，不附加额外解释。`

// ─── UC8-1: Generates a fused new Skill ──────────────────────────────────

describe('UC8-1: executeRecompose fuses multiple Skills into a new one', () => {
  test('returns taskId immediately and delivers preview via onComplete', async () => {
    const { projectId } = makeRecomposeProject('uc8-1a')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({
      result: MOCK_RECOMPOSED_CONTENT, duration_ms: 400,
    })

    let preview = null
    const done = new Promise(resolve => {
      recomposeService.executeRecompose(
        projectId,
        { retentionRules: '保留seg_001', selectedSegmentIds: ['seg_001', 'seg_002', 'seg_003'] },
        {
          onComplete: (data) => {
            if (data.status === 'completed') { preview = data.preview; resolve() }
          },
        }
      )
    })

    await done
    expect(preview).toBeTruthy()
    expect(preview.content).toBe(MOCK_RECOMPOSED_CONTENT)
    expect(preview.segmentCount).toBe(3)
    expect(preview.sourceSkillCount).toBe(2)
  })

  test('invokeCli is called with recompose prompt containing skill info', async () => {
    const { projectId } = makeRecomposeProject('uc8-1b')

    const spy = jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({
      result: MOCK_RECOMPOSED_CONTENT, duration_ms: 300,
    })

    await new Promise(resolve => {
      recomposeService.executeRecompose(
        projectId,
        { retentionRules: 'must keep role', selectedSegmentIds: ['seg_001', 'seg_002'] },
        { onComplete: d => d.status === 'completed' && resolve() }
      )
    })

    const [prompt] = spy.mock.calls[0]
    expect(prompt).toContain('Skill A')
    expect(prompt).toContain('must keep role')
  })
})

// ─── UC8-2: Recomposed skill is complete and usable ───────────────────────

describe('UC8-2: recomposed skill content is non-empty and well-formed', () => {
  test('preview.content is a non-empty string', async () => {
    const { projectId } = makeRecomposeProject('uc8-2a')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({
      result: MOCK_RECOMPOSED_CONTENT, duration_ms: 200,
    })

    let content = null
    await new Promise(resolve => {
      recomposeService.executeRecompose(
        projectId, {},
        { onComplete: d => { if (d.status === 'completed') { content = d.preview.content; resolve() } } }
      )
    })

    expect(typeof content).toBe('string')
    expect(content.length).toBeGreaterThan(0)
  })

  test('preview includes segment and source skill counts', async () => {
    const { projectId } = makeRecomposeProject('uc8-2b')

    jest.spyOn(cliService, 'invokeCli').mockResolvedValueOnce({
      result: MOCK_RECOMPOSED_CONTENT, duration_ms: 200,
    })

    let preview = null
    await new Promise(resolve => {
      recomposeService.executeRecompose(
        projectId, { selectedSegmentIds: ['seg_001', 'seg_002'] },
        { onComplete: d => { if (d.status === 'completed') { preview = d.preview; resolve() } } }
      )
    })

    expect(preview.segmentCount).toBe(2)
    expect(preview.sourceSkillCount).toBe(2)
  })
})

// ─── UC8-3: Provenance tracking ───────────────────────────────────────────

describe('UC8-3: saveRecomposedSkill writes provenance.json with source info', () => {
  test('provenance.json contains source project and source skills', async () => {
    const { projectId } = makeRecomposeProject('uc8-3a')

    const result = await recomposeService.saveRecomposedSkill(projectId, {
      content: MOCK_RECOMPOSED_CONTENT,
      meta: { name: '重组Python助手', purpose: 'coding', provider: 'recomposed' },
    })

    expect(result.skillId).toBeTruthy()
    expect(result.version).toBe('v1')

    // Find provenance.json
    const skillService = require('../../main/services/skill-service')
    const skillDir = skillService.findSkillDir(result.skillId)
    expect(skillDir).toBeTruthy()

    const provenance = fileService.readJson(path.join(skillDir.fullPath, 'provenance.json'))
    expect(provenance.type).toBe('recomposed')
    expect(provenance.source_project_id).toBe(projectId)
    expect(provenance.source_project_name).toBe('Recompose Test Project')
    expect(Array.isArray(provenance.source_skills)).toBe(true)
    expect(provenance.source_skills.length).toBeGreaterThan(0)
  })

  test('each source_skills entry has contributed_segments list', async () => {
    const { projectId } = makeRecomposeProject('uc8-3b')

    const result = await recomposeService.saveRecomposedSkill(projectId, {
      content: MOCK_RECOMPOSED_CONTENT,
      meta: { name: '重组Skill v2', purpose: 'coding', provider: 'recomposed' },
    })

    const skillService = require('../../main/services/skill-service')
    const skillDir = skillService.findSkillDir(result.skillId)
    const provenance = fileService.readJson(path.join(skillDir.fullPath, 'provenance.json'))

    for (const src of provenance.source_skills) {
      expect(src.skill_id).toBeTruthy()
      expect(src.skill_name).toBeTruthy()
      expect(Array.isArray(src.contributed_segments)).toBe(true)
      expect(src.contributed_segments.length).toBeGreaterThan(0)
    }
  })
})

// ─── UC8-4: Can be saved as a formal versioned Skill ────────────────────

describe('UC8-4: saveRecomposedSkill creates a retrievable skill with correct content', () => {
  test('saved skill can be retrieved with correct content', async () => {
    const { projectId } = makeRecomposeProject('uc8-4a')

    const result = await recomposeService.saveRecomposedSkill(projectId, {
      content: MOCK_RECOMPOSED_CONTENT,
      meta: { name: '重组助手Final', purpose: 'coding', provider: 'recomposed' },
    })

    const skillService = require('../../main/services/skill-service')
    const skill = skillService.getSkill(result.skillId)

    expect(skill.content).toBe(MOCK_RECOMPOSED_CONTENT)
    expect(skill.meta.name).toBe('重组助手Final')
    expect(skill.meta.purpose).toBe('coding')
    expect(skill.meta.provider).toBe('recomposed')
  })

  test('saved skill starts at version v1', async () => {
    const { projectId } = makeRecomposeProject('uc8-4b')

    const result = await recomposeService.saveRecomposedSkill(projectId, {
      content: MOCK_RECOMPOSED_CONTENT,
      meta: { name: '重组v1测试', purpose: 'test', provider: 'recomposed' },
    })

    expect(result.version).toBe('v1')
  })

  test('throws INVALID_PARAMS when content is missing', async () => {
    const { projectId } = makeRecomposeProject('uc8-4c')

    await expect(
      recomposeService.saveRecomposedSkill(projectId, {
        content: '',
        meta: { name: 'X', purpose: 'y', provider: 'z' },
      })
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })

  test('throws INVALID_PARAMS when meta is incomplete', async () => {
    const { projectId } = makeRecomposeProject('uc8-4d')

    await expect(
      recomposeService.saveRecomposedSkill(projectId, {
        content: 'some content',
        meta: { name: 'only name' },
      })
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })
})

// ─── buildRecomposePrompt (unit test) ────────────────────────────────────

describe('buildRecomposePrompt', () => {
  test('prompt contains selected segment content', () => {
    const { projectId, projectPath } = makeRecomposeProject('uc8-prompt')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))

    const { prompt } = recomposeService.buildRecomposePrompt(
      projectPath, config,
      { retentionRules: 'keep role', selectedSegmentIds: ['seg_001'] }
    )

    expect(prompt).toContain('你是专业Python开发者')
    expect(prompt).toContain('keep role')
  })

  test('uses all segments when selectedSegmentIds is empty', () => {
    const { projectPath } = makeRecomposeProject('uc8-prompt2')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))

    const { selected } = recomposeService.buildRecomposePrompt(
      projectPath, config,
      { retentionRules: '', selectedSegmentIds: [] }
    )

    // All 3 segments from the analysis report
    expect(selected).toHaveLength(3)
  })
})

// ─── buildMetaPromptTail ──────────────────────────────────────────────────

describe('buildMetaPromptTail', () => {
  const scoreHistory = [
    {
      round: 1, strategy: 'GREEDY', avg_score: 78.3, score_delta: null,
      score_breakdown: { functional_correctness: 21, robustness: 15, readability: 12,
        conciseness: 11, complexity_control: 7, format_compliance: 7 },
    },
    {
      round: 2, strategy: 'DIMENSION_FOCUS', avg_score: 80.1, score_delta: 1.8,
      score_breakdown: { functional_correctness: 22, robustness: 16, readability: 12,
        conciseness: 11, complexity_control: 7, format_compliance: 7 },
    },
  ]

  test('returns empty string when scoreHistory is empty', () => {
    const tail = recomposeService.buildMetaPromptTail([], 'GREEDY', null)
    expect(tail).toBe('')
  })

  test('includes 历史得分趋势 header when history provided', () => {
    const tail = recomposeService.buildMetaPromptTail(scoreHistory, 'GREEDY', null)
    expect(tail).toContain('历史得分趋势')
  })

  test('includes score delta for rounds after the first', () => {
    const tail = recomposeService.buildMetaPromptTail(scoreHistory, 'GREEDY', null)
    expect(tail).toContain('+1.8')
  })

  test('DIMENSION_FOCUS strategy injects focus dimension directive', () => {
    const tail = recomposeService.buildMetaPromptTail(scoreHistory, 'DIMENSION_FOCUS', 'robustness')
    expect(tail).toContain('DIMENSION_FOCUS')
    expect(tail).toContain('健壮性')
  })

  test('SEGMENT_EXPLORE strategy injects exploration directive', () => {
    const tail = recomposeService.buildMetaPromptTail(scoreHistory, 'SEGMENT_EXPLORE', null)
    expect(tail).toContain('SEGMENT_EXPLORE')
  })

  test('detects stagnant dimensions from last 2 rounds', () => {
    // readability, conciseness, complexity_control, format_compliance all stayed same
    const tail = recomposeService.buildMetaPromptTail(scoreHistory, 'GREEDY', null)
    expect(tail).toContain('停滞维度')
    expect(tail).toContain('可读性')  // readability: 12 → 12, no change
  })

  test('no meta_prompt_tail placeholder remains in built recompose prompt', () => {
    const { projectPath } = makeRecomposeProject('uc8-metaprompt')
    const config = fileService.readJson(path.join(projectPath, 'config.json'))
    const { prompt } = recomposeService.buildRecomposePrompt(projectPath, config, {
      scoreHistory,
      strategy: 'DIMENSION_FOCUS',
      focusDimension: 'functional_correctness',
    })
    expect(prompt).not.toContain('{meta_prompt_tail}')
    expect(prompt).toContain('历史得分趋势')
    expect(prompt).toContain('DIMENSION_FOCUS')
  })
})
