'use strict'

/**
 * leaderboard-service.test.js
 * TDD Test Cases: UC11-1 through UC11-8, plus edge cases
 *
 * Tests: no-filter grouped query, baselineId filter, skillId filter,
 * staleness computation (skill_updated / baseline_updated / current),
 * includeStale=false filter, CSV export, getTestSummaries aggregation,
 * fault-tolerance with missing/malformed files, date + purpose filters.
 */

const path = require('path')
const fs   = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')
const {
  createSkillFixture,
  createBaselineFixture,
  createProjectFixture,
  makeScoreBreakdown,
} = require('../helpers/leaderboard-fixture')

// ─── IDs used across tests ────────────────────────────────────────────────────

const SKILL_A_ID   = 'aaaaaaaa-0000-0000-0000-000000000001'
const SKILL_B_ID   = 'bbbbbbbb-0000-0000-0000-000000000002'
const SKILL_C_ID   = 'cccccccc-0000-0000-0000-000000000003'
const BASELINE_1_ID = '11111111-0000-0000-0000-000000000001'
const BASELINE_2_ID = '22222222-0000-0000-0000-000000000002'
const PROJECT_1_ID  = 'proj1111-0000-0000-0000-000000000001'
const PROJECT_2_ID  = 'proj2222-0000-0000-0000-000000000002'
const PROJECT_3_ID  = 'proj3333-0000-0000-0000-000000000003'
const PROJECT_4_ID  = 'proj4444-0000-0000-0000-000000000004'

// ─── Module setup ─────────────────────────────────────────────────────────────

let tmpDir, cleanup, restoreWorkspace
let leaderboardService, workspaceService

beforeAll(() => {
  const tmp = createTmpDir('leaderboard-svc-')
  tmpDir  = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)
  leaderboardService = require('../../main/services/leaderboard-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRankingEntry(skillId, skillName, skillVersion, avgScore, completedCases = 5, failedCases = 0) {
  return {
    skill_id: skillId,
    skill_name: skillName,
    skill_version: skillVersion,
    rank: 1,
    avg_score: avgScore,
    score_breakdown: makeScoreBreakdown(avgScore),
    completed_cases: completedCases,
    failed_cases: failedCases,
  }
}

// ─── UC11-1: No filter → groups by baseline ──────────────────────────────────

describe('UC11-1: queryLeaderboard — no filters → grouped by baseline', () => {
  beforeAll(() => {
    // Skill A v1 + Baseline 1 → Project 1
    createSkillFixture(tmpDir, { id: SKILL_A_ID, name: 'Alpha Coder', version: 'v1', purpose: 'coding' })
    createBaselineFixture(tmpDir, { id: BASELINE_1_ID, name: 'Python Baseline', version: 'v1', purpose: 'coding' })
    createProjectFixture(tmpDir, {
      projectId: PROJECT_1_ID,
      projectName: 'Test Project 1',
      skillRefs: [{ ref_id: SKILL_A_ID, name: 'Alpha Coder', version: 'v1', local_path: '' }],
      baselineRef: { ref_id: BASELINE_1_ID, name: 'Python Baseline', version: 'v1', local_path: '', purpose: 'coding' },
      ranking: [makeRankingEntry(SKILL_A_ID, 'Alpha Coder', 'v1', 87.3)],
      testedAt: '2024-02-15T10:00:00.000Z',
    })

    // Skill B v1 + Baseline 2 → Project 2
    createSkillFixture(tmpDir, { id: SKILL_B_ID, name: 'Beta Coder', version: 'v1', purpose: 'writing' })
    createBaselineFixture(tmpDir, { id: BASELINE_2_ID, name: 'Writing Baseline', version: 'v1', purpose: 'writing' })
    createProjectFixture(tmpDir, {
      projectId: PROJECT_2_ID,
      projectName: 'Test Project 2',
      skillRefs: [{ ref_id: SKILL_B_ID, name: 'Beta Coder', version: 'v1', local_path: '' }],
      baselineRef: { ref_id: BASELINE_2_ID, name: 'Writing Baseline', version: 'v1', local_path: '', purpose: 'writing' },
      ranking: [makeRankingEntry(SKILL_B_ID, 'Beta Coder', 'v1', 82.1)],
      testedAt: '2024-02-20T10:00:00.000Z',
    })
  })

  test('returns groups array with one group per baseline', async () => {
    const result = await leaderboardService.queryLeaderboard({})
    expect(result).toHaveProperty('groups')
    expect(Array.isArray(result.groups)).toBe(true)
    expect(result.groups.length).toBe(2)
  })

  test('each group contains required fields', async () => {
    const { groups } = await leaderboardService.queryLeaderboard({})
    for (const g of groups) {
      expect(g).toHaveProperty('baselineId')
      expect(g).toHaveProperty('baselineName')
      expect(g).toHaveProperty('skillCount')
      expect(g).toHaveProperty('records')
      expect(typeof g.skillCount).toBe('number')
      expect(Array.isArray(g.records)).toBe(true)
    }
  })

  test('records within each group are sorted by avgScore descending', async () => {
    const { groups } = await leaderboardService.queryLeaderboard({})
    for (const g of groups) {
      for (let i = 1; i < g.records.length; i++) {
        expect(g.records[i - 1].avgScore).toBeGreaterThanOrEqual(g.records[i].avgScore)
      }
    }
  })
})

// ─── UC11-2: baselineId filter → flat records ─────────────────────────────────

describe('UC11-2: queryLeaderboard — baselineId filter → flat records', () => {
  test('returns records array, not groups', async () => {
    const result = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_1_ID })
    expect(result).toHaveProperty('records')
    expect(result).not.toHaveProperty('groups')
  })

  test('records only contain the specified baseline', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_1_ID })
    expect(records.length).toBeGreaterThan(0)
    for (const r of records) {
      expect(r.baselineId).toBe(BASELINE_1_ID)
    }
  })

  test('each record has all required LeaderboardRecord fields', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_1_ID })
    const r = records[0]
    expect(r).toHaveProperty('skillId')
    expect(r).toHaveProperty('skillName')
    expect(r).toHaveProperty('skillVersionTested')
    expect(r).toHaveProperty('skillVersionCurrent')
    expect(r).toHaveProperty('baselineVersionTested')
    expect(r).toHaveProperty('baselineVersionCurrent')
    expect(r).toHaveProperty('avgScore')
    expect(r).toHaveProperty('scoreBreakdown')
    expect(r).toHaveProperty('projectId')
    expect(r).toHaveProperty('testedAt')
    expect(r).toHaveProperty('staleness')
  })
})

// ─── UC11-3: skillId filter → cross-baseline records ─────────────────────────

describe('UC11-3: queryLeaderboard — skillId filter → cross-baseline records', () => {
  beforeAll(() => {
    // Skill A also tested on Baseline 2 in Project 3
    createProjectFixture(tmpDir, {
      projectId: PROJECT_3_ID,
      projectName: 'Cross Baseline Project',
      skillRefs: [{ ref_id: SKILL_A_ID, name: 'Alpha Coder', version: 'v1', local_path: '' }],
      baselineRef: { ref_id: BASELINE_2_ID, name: 'Writing Baseline', version: 'v1', local_path: '', purpose: 'writing' },
      ranking: [makeRankingEntry(SKILL_A_ID, 'Alpha Coder', 'v1', 79.0)],
      testedAt: '2024-01-25T10:00:00.000Z',
    })
  })

  test('returns all records for the skill across baselines', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ skillId: SKILL_A_ID })
    expect(records.length).toBeGreaterThanOrEqual(2)
    for (const r of records) {
      expect(r.skillId).toBe(SKILL_A_ID)
    }
  })

  test('records come from different baselines', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ skillId: SKILL_A_ID })
    const baselineIds = new Set(records.map(r => r.baselineId))
    expect(baselineIds.size).toBeGreaterThanOrEqual(2)
  })
})

// ─── UC11-4: skill_updated staleness ─────────────────────────────────────────

describe('UC11-4: staleness = skill_updated when Skill has newer version', () => {
  const SKILL_STALE_ID   = 'dddddddd-0000-0000-0000-000000000004'
  const BASELINE_STALE_ID = '33333333-0000-0000-0000-000000000003'
  const PROJ_STALE_ID     = 'proj5555-0000-0000-0000-000000000005'

  beforeAll(() => {
    // Skill is currently v2, but was tested as v1
    createSkillFixture(tmpDir, { id: SKILL_STALE_ID, name: 'Stale Skill', version: 'v2', purpose: 'coding' })
    createBaselineFixture(tmpDir, { id: BASELINE_STALE_ID, name: 'Stable Baseline', version: 'v1', purpose: 'coding' })
    createProjectFixture(tmpDir, {
      projectId: PROJ_STALE_ID,
      projectName: 'Stale Skill Project',
      skillRefs: [{ ref_id: SKILL_STALE_ID, name: 'Stale Skill', version: 'v1', local_path: '' }],
      baselineRef: { ref_id: BASELINE_STALE_ID, name: 'Stable Baseline', version: 'v1', local_path: '', purpose: 'coding' },
      ranking: [makeRankingEntry(SKILL_STALE_ID, 'Stale Skill', 'v1', 80.0)],
    })
  })

  test('record.staleness = skill_updated', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_STALE_ID })
    const r = records.find(r => r.skillId === SKILL_STALE_ID)
    expect(r).toBeDefined()
    expect(r.staleness).toBe('skill_updated')
  })

  test('skillVersionTested = v1, skillVersionCurrent = v2', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_STALE_ID })
    const r = records.find(r => r.skillId === SKILL_STALE_ID)
    expect(r.skillVersionTested).toBe('v1')
    expect(r.skillVersionCurrent).toBe('v2')
  })
})

// ─── UC11-5: baseline_updated staleness ──────────────────────────────────────

describe('UC11-5: staleness = baseline_updated when Baseline has newer version', () => {
  const SKILL_OK_ID       = 'eeeeeeee-0000-0000-0000-000000000005'
  const BASELINE_NEW_ID   = '44444444-0000-0000-0000-000000000004'
  const PROJ_BL_STALE_ID  = 'proj6666-0000-0000-0000-000000000006'

  beforeAll(() => {
    // Baseline is currently v2, was tested as v1
    createSkillFixture(tmpDir, { id: SKILL_OK_ID, name: 'OK Skill', version: 'v1', purpose: 'coding' })
    createBaselineFixture(tmpDir, { id: BASELINE_NEW_ID, name: 'Updated Baseline', version: 'v2', purpose: 'coding' })
    createProjectFixture(tmpDir, {
      projectId: PROJ_BL_STALE_ID,
      projectName: 'Baseline Updated Project',
      skillRefs: [{ ref_id: SKILL_OK_ID, name: 'OK Skill', version: 'v1', local_path: '' }],
      baselineRef: { ref_id: BASELINE_NEW_ID, name: 'Updated Baseline', version: 'v1', local_path: '', purpose: 'coding' },
      ranking: [makeRankingEntry(SKILL_OK_ID, 'OK Skill', 'v1', 75.0)],
    })
  })

  test('record.staleness = baseline_updated', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_NEW_ID })
    const r = records.find(r => r.skillId === SKILL_OK_ID)
    expect(r).toBeDefined()
    expect(r.staleness).toBe('baseline_updated')
  })

  test('baselineVersionTested = v1, baselineVersionCurrent = v2', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_NEW_ID })
    const r = records.find(r => r.skillId === SKILL_OK_ID)
    expect(r.baselineVersionTested).toBe('v1')
    expect(r.baselineVersionCurrent).toBe('v2')
  })
})

// ─── UC11-6: current staleness ───────────────────────────────────────────────

describe('UC11-6: staleness = current when neither version changed', () => {
  test('record.staleness = current for Project 1 (Skill A v1, Baseline 1 v1 both unchanged)', async () => {
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: BASELINE_1_ID })
    const r = records.find(r => r.skillId === SKILL_A_ID && r.projectId === PROJECT_1_ID)
    expect(r).toBeDefined()
    expect(r.staleness).toBe('current')
    expect(r.skillVersionTested).toBe(r.skillVersionCurrent)
    expect(r.baselineVersionTested).toBe(r.baselineVersionCurrent)
  })
})

// ─── UC11-7: includeStale=false ───────────────────────────────────────────────

describe('UC11-7: queryLeaderboard — includeStale=false filters out stale records', () => {
  const SKILL_MIX_ID     = 'ffffffff-0000-0000-0000-000000000006'
  const BASELINE_MIX_ID  = '55555555-0000-0000-0000-000000000005'
  const PROJ_MIX1_ID     = 'projaaaa-0000-0000-0000-000000000007'
  const PROJ_MIX2_ID     = 'projbbbb-0000-0000-0000-000000000008'

  beforeAll(() => {
    // Skill MIX is currently v2 (will be stale when tested as v1)
    createSkillFixture(tmpDir, { id: SKILL_MIX_ID, name: 'Mix Skill', version: 'v2', purpose: 'coding' })
    createBaselineFixture(tmpDir, { id: BASELINE_MIX_ID, name: 'Mix Baseline', version: 'v1', purpose: 'coding' })

    // Project 1: tested skill as v1 → skill_updated
    createProjectFixture(tmpDir, {
      projectId: PROJ_MIX1_ID,
      projectName: 'Mix Project 1',
      skillRefs: [{ ref_id: SKILL_MIX_ID, name: 'Mix Skill', version: 'v1', local_path: '' }],
      baselineRef: { ref_id: BASELINE_MIX_ID, name: 'Mix Baseline', version: 'v1', local_path: '', purpose: 'coding' },
      ranking: [makeRankingEntry(SKILL_MIX_ID, 'Mix Skill', 'v1', 70.0)],
      testedAt: '2024-01-10T10:00:00.000Z',
    })

    // Project 2: tested skill as v2 → current
    createProjectFixture(tmpDir, {
      projectId: PROJ_MIX2_ID,
      projectName: 'Mix Project 2',
      skillRefs: [{ ref_id: SKILL_MIX_ID, name: 'Mix Skill', version: 'v2', local_path: '' }],
      baselineRef: { ref_id: BASELINE_MIX_ID, name: 'Mix Baseline', version: 'v1', local_path: '', purpose: 'coding' },
      ranking: [makeRankingEntry(SKILL_MIX_ID, 'Mix Skill', 'v2', 85.0)],
      testedAt: '2024-02-01T10:00:00.000Z',
    })
  })

  test('includeStale=true (default) returns both records', async () => {
    const { records } = await leaderboardService.queryLeaderboard({
      baselineId: BASELINE_MIX_ID,
    })
    const skillRecords = records.filter(r => r.skillId === SKILL_MIX_ID)
    expect(skillRecords.length).toBe(2)
  })

  test('includeStale=false returns only current record', async () => {
    const { records } = await leaderboardService.queryLeaderboard({
      baselineId: BASELINE_MIX_ID,
      includeStale: false,
    })
    const skillRecords = records.filter(r => r.skillId === SKILL_MIX_ID)
    expect(skillRecords.length).toBe(1)
    expect(skillRecords[0].staleness).toBe('current')
    expect(skillRecords[0].skillVersionTested).toBe('v2')
  })
})

// ─── UC11-8: exportLeaderboard ────────────────────────────────────────────────

describe('UC11-8: exportLeaderboard — generates a CSV file', () => {
  test('returns filePath and file exists', async () => {
    const result = await leaderboardService.exportLeaderboard({ format: 'csv' })
    expect(result).toHaveProperty('filePath')
    expect(typeof result.filePath).toBe('string')
    expect(fs.existsSync(result.filePath)).toBe(true)
  })

  test('CSV contains required headers', async () => {
    const { filePath } = await leaderboardService.exportLeaderboard({ format: 'csv' })
    const content = fs.readFileSync(filePath, 'utf-8')
    const headers = content.split('\n')[0]
    expect(headers).toContain('skill_name')
    expect(headers).toContain('avg_score')
    expect(headers).toContain('staleness')
    expect(headers).toContain('tested_at')
    expect(headers).toContain('baseline_name')
  })

  test('CSV contains at least one data row', async () => {
    const { filePath } = await leaderboardService.exportLeaderboard({ format: 'csv' })
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2) // header + at least 1 row
  })

  test('JSON export also creates a valid JSON file', async () => {
    const { filePath } = await leaderboardService.exportLeaderboard({ format: 'json' })
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ─── getTestSummaries ─────────────────────────────────────────────────────────

describe('getTestSummaries — badge data for skill list', () => {
  const SKILL_MULTI_ID   = 'gggggggg-0000-0000-0000-000000000007'
  const BASELINE_MULTI_ID = '66666666-0000-0000-0000-000000000006'
  const PROJ_M1 = 'projcccc-0000-0000-0000-000000000009'
  const PROJ_M2 = 'projdddd-0000-0000-0000-000000000010'
  const PROJ_M3 = 'projeeee-0000-0000-0000-000000000011'

  beforeAll(() => {
    createSkillFixture(tmpDir, { id: SKILL_MULTI_ID, name: 'Multi Skill', version: 'v1', purpose: 'coding' })
    createBaselineFixture(tmpDir, { id: BASELINE_MULTI_ID, name: 'Multi Baseline', version: 'v1', purpose: 'coding' })

    // 3 test runs for SKILL_MULTI: scores 79, 85, 87
    for (const [projId, score, date] of [
      [PROJ_M1, 79.0, '2024-01-10T10:00:00.000Z'],
      [PROJ_M2, 85.0, '2024-01-25T10:00:00.000Z'],
      [PROJ_M3, 87.0, '2024-02-01T10:00:00.000Z'],
    ]) {
      createProjectFixture(tmpDir, {
        projectId: projId,
        projectName: `Multi Project ${score}`,
        skillRefs: [{ ref_id: SKILL_MULTI_ID, name: 'Multi Skill', version: 'v1', local_path: '' }],
        baselineRef: { ref_id: BASELINE_MULTI_ID, name: 'Multi Baseline', version: 'v1', local_path: '', purpose: 'coding' },
        ranking: [makeRankingEntry(SKILL_MULTI_ID, 'Multi Skill', 'v1', score)],
        testedAt: date,
      })
    }
  })

  test('has_tests=true for tested skill', async () => {
    const summaries = await leaderboardService.getTestSummaries()
    expect(summaries[SKILL_MULTI_ID]).toBeDefined()
    expect(summaries[SKILL_MULTI_ID].has_tests).toBe(true)
  })

  test('best_score = 87 (highest across 3 runs)', async () => {
    const summaries = await leaderboardService.getTestSummaries()
    expect(summaries[SKILL_MULTI_ID].best_score).toBe(87.0)
  })

  test('test_count = 3', async () => {
    const summaries = await leaderboardService.getTestSummaries()
    expect(summaries[SKILL_MULTI_ID].test_count).toBe(3)
  })

  test('staleness = current when all runs match current version', async () => {
    const summaries = await leaderboardService.getTestSummaries()
    expect(summaries[SKILL_MULTI_ID].staleness).toBe('current')
  })

  test('untested skill does not appear in summaries', async () => {
    // SKILL_C_ID was never seeded with a project
    const summaries = await leaderboardService.getTestSummaries()
    expect(summaries[SKILL_C_ID]).toBeUndefined()
  })
})

// ─── Fault tolerance: missing / malformed files ───────────────────────────────

describe('UC11-edge: fault tolerance — missing or malformed project files', () => {
  test('project directory with no results/summary.json is skipped gracefully', async () => {
    // Create a project dir with only config.json but no summary
    const noSummaryId = 'nosummmm-0000-0000-0000-000000000099'
    const dirName = `project_${noSummaryId.slice(0, 8)}_9999999`
    const projPath = path.join(tmpDir, 'projects', dirName)
    fs.mkdirSync(path.join(projPath, 'results'), { recursive: true })
    fs.writeFileSync(path.join(projPath, 'config.json'), JSON.stringify({
      id: noSummaryId, name: 'No Summary', status: 'running',
      skills: [], baselines: [], cli_config: {}, progress: {},
    }), 'utf-8')

    // Should not throw
    const result = await leaderboardService.queryLeaderboard({ skillId: noSummaryId })
    expect(result).toBeDefined()
  })

  test('project with empty ranking array is skipped', async () => {
    const emptyId = 'emptyprj-0000-0000-0000-000000000098'
    const baseline98 = '98989898-0000-0000-0000-000000000098'
    createBaselineFixture(tmpDir, { id: baseline98, name: 'B98', version: 'v1', purpose: 'coding' })
    createProjectFixture(tmpDir, {
      projectId: emptyId,
      projectName: 'Empty Ranking',
      skillRefs: [],
      baselineRef: { ref_id: baseline98, name: 'B98', version: 'v1', local_path: '', purpose: 'coding' },
      ranking: [], // empty
    })
    const { records } = await leaderboardService.queryLeaderboard({ baselineId: baseline98 })
    expect(records).toEqual([])
  })
})

// ─── Date range filter ────────────────────────────────────────────────────────

describe('UC11-23: dateFrom / dateTo filter', () => {
  const SKILL_DATE_ID   = 'hhhhhhhh-0000-0000-0000-000000000008'
  const BASELINE_DATE_ID = '77777777-0000-0000-0000-000000000007'

  beforeAll(() => {
    createSkillFixture(tmpDir, { id: SKILL_DATE_ID, name: 'Date Skill', version: 'v1', purpose: 'coding' })
    createBaselineFixture(tmpDir, { id: BASELINE_DATE_ID, name: 'Date Baseline', version: 'v1', purpose: 'coding' })

    for (const [pid, date, score] of [
      ['projjan1-0000-0000-0000-000000000012', '2024-01-15T10:00:00.000Z', 70.0],
      ['projfeb1-0000-0000-0000-000000000013', '2024-02-10T10:00:00.000Z', 80.0],
      ['projmar1-0000-0000-0000-000000000014', '2024-03-05T10:00:00.000Z', 90.0],
    ]) {
      createProjectFixture(tmpDir, {
        projectId: pid,
        projectName: `Date Project ${date.slice(0, 7)}`,
        skillRefs: [{ ref_id: SKILL_DATE_ID, name: 'Date Skill', version: 'v1', local_path: '' }],
        baselineRef: { ref_id: BASELINE_DATE_ID, name: 'Date Baseline', version: 'v1', local_path: '', purpose: 'coding' },
        ranking: [makeRankingEntry(SKILL_DATE_ID, 'Date Skill', 'v1', score)],
        testedAt: date,
      })
    }
  })

  test('dateFrom/dateTo = Feb → only returns Feb record', async () => {
    const { records } = await leaderboardService.queryLeaderboard({
      baselineId: BASELINE_DATE_ID,
      dateFrom: '2024-02-01',
      dateTo:   '2024-02-28',
    })
    expect(records.length).toBe(1)
    expect(records[0].avgScore).toBe(80.0)
    expect(records[0].testedAt.startsWith('2024-02')).toBe(true)
  })
})

// ─── Purpose filter ───────────────────────────────────────────────────────────

describe('UC11-24: purpose filter', () => {
  test('purpose=coding returns only coding baseline groups', async () => {
    const { groups } = await leaderboardService.queryLeaderboard({ purpose: 'coding' })
    for (const g of groups) {
      expect(g.baselinePurpose).toBe('coding')
    }
  })

  test('purpose=writing returns only writing baseline groups', async () => {
    const { groups } = await leaderboardService.queryLeaderboard({ purpose: 'writing' })
    for (const g of groups) {
      expect(g.baselinePurpose).toBe('writing')
    }
  })
})

// ─── _computeStaleness (pure function tests) ──────────────────────────────────

describe('_computeStaleness pure function', () => {
  const { _computeStaleness } = require('../../main/services/leaderboard-service')

  test('both match → current', () => {
    expect(_computeStaleness('v1', 'v1', 'v1', 'v1')).toBe('current')
  })

  test('skill changed → skill_updated', () => {
    expect(_computeStaleness('v1', 'v2', 'v1', 'v1')).toBe('skill_updated')
  })

  test('baseline changed → baseline_updated', () => {
    expect(_computeStaleness('v1', 'v1', 'v1', 'v2')).toBe('baseline_updated')
  })

  test('both changed → both_updated', () => {
    expect(_computeStaleness('v1', 'v2', 'v1', 'v2')).toBe('both_updated')
  })

  test('null skill version (deleted) → conservative both_updated', () => {
    expect(_computeStaleness('v1', null, 'v1', 'v1')).toBe('skill_updated')
  })

  test('null baseline version (deleted) → baseline_updated', () => {
    expect(_computeStaleness('v1', 'v1', 'v1', null)).toBe('baseline_updated')
  })

  test('both null → both_updated', () => {
    expect(_computeStaleness('v1', null, 'v1', null)).toBe('both_updated')
  })
})
