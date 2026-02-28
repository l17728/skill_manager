'use strict'

/**
 * leaderboard-fixture.js
 *
 * Fixture helpers for leaderboard-service unit tests.
 * Creates schema-correct project / skill / baseline directories in a tmpDir
 * without needing real workspace infrastructure.
 */

const fs = require('fs')
const path = require('path')

/**
 * Create a skill directory with meta.json in a tmp workspace.
 *
 * @param {string} tmpDir - Root of the test workspace
 * @param {object} opts
 * @param {string} opts.id        - Skill UUID
 * @param {string} opts.name      - Skill name
 * @param {string} [opts.version] - Current version, e.g. 'v1' (default)
 * @param {string} [opts.purpose] - e.g. 'coding' (default)
 * @param {string} [opts.provider]- e.g. 'anthropic' (default)
 * @param {string} [opts.type]    - 'skill' | 'agent' (default 'skill')
 */
function createSkillFixture(tmpDir, { id, name, version = 'v1', purpose = 'coding', provider = 'anthropic', type = 'skill' }) {
  const dirName = `skill_${id.slice(0, 8)}_${version}`
  const skillPath = path.join(tmpDir, 'skills', purpose, provider, dirName)
  fs.mkdirSync(skillPath, { recursive: true })
  fs.writeFileSync(
    path.join(skillPath, 'meta.json'),
    JSON.stringify({
      id,
      name,
      version,
      purpose,
      provider,
      type,
      description: '',
      author: 'test',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    }, null, 2),
    'utf-8'
  )
  fs.writeFileSync(path.join(skillPath, 'content.txt'), `# ${name}\nTest skill content`, 'utf-8')
  fs.writeFileSync(path.join(skillPath, 'tags.json'), JSON.stringify({ manual: [], auto: [] }, null, 2), 'utf-8')
}

/**
 * Create a baseline directory with meta.json in a tmp workspace.
 *
 * @param {string} tmpDir
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.name
 * @param {string} [opts.version]   - Current version (default 'v1')
 * @param {string} [opts.purpose]
 * @param {string} [opts.provider]
 * @param {number} [opts.caseCount] - Number of placeholder cases (default 5)
 */
function createBaselineFixture(tmpDir, { id, name, version = 'v1', purpose = 'coding', provider = 'anthropic', caseCount = 5 }) {
  const dirName = `baseline_${id.slice(0, 8)}_${version}`
  const baselinePath = path.join(tmpDir, 'baselines', purpose, provider, dirName)
  fs.mkdirSync(baselinePath, { recursive: true })
  fs.writeFileSync(
    path.join(baselinePath, 'meta.json'),
    JSON.stringify({
      id,
      name,
      version,
      purpose,
      provider,
      description: '',
      author: 'test',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    }, null, 2),
    'utf-8'
  )
  const cases = Array.from({ length: caseCount }, (_, i) => ({
    case_id: `case-${String(i + 1).padStart(3, '0')}`,
    name: `Test Case ${i + 1}`,
    input: `Input ${i + 1}`,
    expected_output: `Expected ${i + 1}`,
    description: '',
    category: 'general',
  }))
  fs.writeFileSync(path.join(baselinePath, 'cases.json'), JSON.stringify({ cases }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(baselinePath, 'tags.json'), JSON.stringify({ manual: [], auto: [] }, null, 2), 'utf-8')
}

/**
 * Create a project directory with config.json + results/summary.json.
 *
 * @param {string} tmpDir - Root of the test workspace
 * @param {object} opts
 * @param {string} opts.projectId            - Project UUID (used for dir naming)
 * @param {string} [opts.projectName]        - Project name (default 'Test Project')
 * @param {string} [opts.status]             - 'completed' | 'running' etc (default 'completed')
 * @param {SkillRef[]} opts.skillRefs        - Skills in config.json
 * @param {BaselineRef} opts.baselineRef     - Baseline in config.json
 * @param {RankingEntry[]} opts.ranking      - Ranking entries for summary.json
 * @param {string} [opts.testedAt]           - ISO string for summary.generated_at
 * @returns {string} projectPath
 *
 * @typedef {{ ref_id: string, name: string, version: string, local_path: string }} SkillRef
 * @typedef {{ ref_id: string, name: string, version: string, local_path: string, purpose?: string }} BaselineRef
 * @typedef {{ skill_id: string, skill_name: string, skill_version: string, rank: number, avg_score: number, score_breakdown: object, completed_cases: number, failed_cases: number }} RankingEntry
 */
function createProjectFixture(tmpDir, {
  projectId,
  projectName = 'Test Project',
  status = 'completed',
  skillRefs = [],
  baselineRef,
  ranking = [],
  testedAt = '2024-02-15T10:00:00.000Z',
}) {
  const projectDir = `project_${projectId.slice(0, 8)}_1700000000000`
  const projectPath = path.join(tmpDir, 'projects', projectDir)
  fs.mkdirSync(path.join(projectPath, 'results'), { recursive: true })
  fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })

  const now = '2024-01-01T00:00:00.000Z'
  fs.writeFileSync(
    path.join(projectPath, 'config.json'),
    JSON.stringify({
      id: projectId,
      name: projectName,
      description: '',
      status,
      created_at: now,
      updated_at: now,
      skills: skillRefs,
      baselines: baselineRef ? [baselineRef] : [],
      cli_config: { model: 'claude-opus-4-6', timeout_seconds: 60, retry_count: 2, extra_flags: [] },
      progress: {
        total_tasks: ranking.length,
        completed_tasks: ranking.length,
        failed_tasks: 0,
        last_checkpoint: ranking.length,
      },
    }, null, 2),
    'utf-8'
  )

  const totalCases = ranking.reduce((sum, r) => sum + (r.completed_cases || 0) + (r.failed_cases || 0), 0)
  fs.writeFileSync(
    path.join(projectPath, 'results', 'summary.json'),
    JSON.stringify({
      project_id: projectId,
      baseline_id: baselineRef ? baselineRef.ref_id : '',
      total_cases: totalCases || ranking.length * 5,
      generated_at: testedAt,
      ranking,
    }, null, 2),
    'utf-8'
  )

  return projectPath
}

/**
 * Build a default score_breakdown object summing to approximately avg_score * 1.
 * Distributes score proportionally across 6 dimensions.
 */
function makeScoreBreakdown(avgScore) {
  // Proportional: functional_correctness/30, robustness/20, readability/15,
  //               conciseness/15, complexity_control/10, format_compliance/10
  const ratio = avgScore / 100
  return {
    functional_correctness: parseFloat((30 * ratio).toFixed(1)),
    robustness:             parseFloat((20 * ratio).toFixed(1)),
    readability:            parseFloat((15 * ratio).toFixed(1)),
    conciseness:            parseFloat((15 * ratio).toFixed(1)),
    complexity_control:     parseFloat((10 * ratio).toFixed(1)),
    format_compliance:      parseFloat((10 * ratio).toFixed(1)),
  }
}

module.exports = {
  createSkillFixture,
  createBaselineFixture,
  createProjectFixture,
  makeScoreBreakdown,
}
