'use strict'

/**
 * workspace-factory.js
 *
 * Creates isolated test workspaces with schema-correct file structures.
 * Tests use these workspaces instead of the real workspace/, so no production
 * data is read or modified.
 *
 * Usage:
 *   const { createTestWorkspace } = require('./workspace-factory')
 *   const ws = createTestWorkspace({ skills: [...] })
 *   // ws.dir  — absolute path to the temp directory
 *   // ws.cleanup()  — deletes the temp directory after tests
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')

/**
 * Create a fresh isolated workspace in the OS temp directory.
 *
 * @param {object} [opts]
 * @param {SkillSeed[]} [opts.skills]   — Skills to pre-seed into the workspace
 * @returns {{ dir: string, cleanup(): void, skillIds: Record<string,string> }}
 */
function createTestWorkspace(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-'))
  console.log(`[workspace-factory] Creating test workspace: ${dir}`)

  // Minimal required directory structure (mirrors workspace-service.js initWorkspace)
  const subdirs = [
    'skills',
    'baselines',
    'projects',
    path.join('cli', 'temp_session'),
    path.join('cli', 'cache'),
    'logs',
    'versions',
  ]
  subdirs.forEach((d) => fs.mkdirSync(path.join(dir, d), { recursive: true }))

  // CLI config — required by cli-service.js on startup
  fs.writeFileSync(
    path.join(dir, 'cli', 'config.json'),
    JSON.stringify({
      cli_path: 'claude',
      default_model: 'claude-opus-4-6',
      default_timeout_seconds: 60,
      default_retry_count: 2,
      temp_session_ttl_days: 7,
      context: {
        token_threshold: 80000,
        auto_compress: true,
        auto_export: true,
      },
      updated_at: new Date().toISOString(),
    }, null, 2)
  )

  // Seed skills
  const skillIds = {}
  if (opts.skills) {
    for (const skill of opts.skills) {
      const id = _seedSkill(dir, skill)
      if (skill.key) skillIds[skill.key] = id
    }
  }

  // Seed baselines
  const baselineIds = {}
  if (opts.baselines) {
    for (const baseline of opts.baselines) {
      const id = _seedBaseline(dir, baseline)
      if (baseline.key) baselineIds[baseline.key] = id
    }
  }

  // Seed pre-built projects (status, analysis/iteration reports, summary)
  const projectIds = {}
  if (opts.projects) {
    for (const project of opts.projects) {
      const { id } = _seedProject(dir, project)
      if (project.key) projectIds[project.key] = id
    }
  }

  console.log(`[workspace-factory] Workspace ready — skills: ${opts.skills ? opts.skills.length : 0}, baselines: ${opts.baselines ? opts.baselines.length : 0}, projects: ${opts.projects ? opts.projects.length : 0}`)
  return {
    dir,
    skillIds,
    baselineIds,
    projectIds,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
        console.log(`[workspace-factory] Cleaned up: ${dir}`)
      } catch (_) { /* ignore cleanup errors */ }
    },
  }
}

/**
 * Write a skill directory tree into the workspace.
 * Follows schema.md §1.1 (meta.json) and §1.2 (tags.json).
 *
 * @typedef {object} SkillSeed
 * @property {string} [key]         — Map key for looking up the generated ID
 * @property {string} [id]          — Explicit ID (auto-generated if omitted)
 * @property {string} name
 * @property {string} purpose
 * @property {string} provider
 * @property {string} [content]
 * @property {string} [description]
 * @property {string} [author]
 * @property {string[]} [tags]      — Manual tags to pre-seed
 *
 * @param {string} workspaceDir
 * @param {SkillSeed} skill
 * @returns {string} The skill ID used
 */
function _seedSkill(workspaceDir, skill) {
  const id = skill.id || uuidv4()
  const now = new Date().toISOString()

  // skill-service.js uses only the first 8 chars of the UUID for the directory name:
  //   skillDirName(id, version) → `skill_${id.slice(0, 8)}_${version}`
  // findSkillDir searches: d.dir.startsWith(`skill_${skillId.slice(0, 8)}_`)
  // We must match this convention exactly or getSkill will return NOT_FOUND.
  const dirName = `skill_${id.slice(0, 8)}_v1`
  const skillDir = path.join(
    workspaceDir,
    'skills',
    skill.purpose,
    skill.provider,
    dirName
  )

  fs.mkdirSync(skillDir, { recursive: true })
  fs.mkdirSync(path.join(skillDir, 'history'), { recursive: true })
  fs.mkdirSync(path.join(skillDir, 'auto_tag_log'), { recursive: true })

  // content.txt
  fs.writeFileSync(
    path.join(skillDir, 'content.txt'),
    skill.content || `You are a helpful ${skill.purpose} assistant.`
  )

  // meta.json — must match what skill-service.importSkill writes (schema.md §1.1)
  fs.writeFileSync(
    path.join(skillDir, 'meta.json'),
    JSON.stringify({
      id,
      name: skill.name,
      description: skill.description || '',
      author: skill.author || '',
      source: 'manual',
      purpose: skill.purpose,
      provider: skill.provider,
      version: 'v1',
      version_count: 1,
      content_file: 'content.txt',
      status: 'active',
      created_at: now,
      updated_at: now,
    }, null, 2)
  )

  // tags.json — matches schema.md §1.3
  const manualTags = (skill.tags || []).map((v) => ({
    id: uuidv4(),
    value: v,
    created_at: now,
  }))
  fs.writeFileSync(
    path.join(skillDir, 'tags.json'),
    JSON.stringify({ manual: manualTags, auto: [] }, null, 2)
  )

  console.log(`[workspace-factory] Seeded skill "${skill.name}" → ${dirName}`)
  return id
}

/**
 * Write a baseline directory tree into the workspace.
 * Follows schema.md §2.1 (meta.json), §2.2 (cases.json), §2.3 (tags.json).
 *
 * @typedef {object} BaselineSeed
 * @property {string} [key]         — Map key for looking up the generated ID
 * @property {string} [id]          — Explicit ID (auto-generated if omitted)
 * @property {string} name
 * @property {string} purpose
 * @property {string} provider
 * @property {string} [description]
 * @property {string} [seedVersion] — 'v1' (default) or 'v2' — seed at this version so the UI
 *   shows older versions with a Restore button (useful for rollback tests without prompt())
 * @property {Array<{id?,name,category?,input,expected_output?,description?}>} [cases]
 *
 * @param {string} workspaceDir
 * @param {BaselineSeed} baseline
 * @returns {string} The baseline ID used
 */
function _seedBaseline(workspaceDir, baseline) {
  const id = baseline.id || uuidv4()
  const now = new Date().toISOString()
  const seedVersion = baseline.seedVersion || 'v1'

  // baseline-service.js: baselineDirName → `baseline_${id.slice(0, 8)}_v<N>`
  // findBaselineDir: d.dir.startsWith(`baseline_${baselineId.slice(0, 8)}_`)
  const dirName = `baseline_${id.slice(0, 8)}_${seedVersion}`
  const baselineDir = path.join(
    workspaceDir,
    'baselines',
    baseline.purpose,
    baseline.provider,
    dirName
  )

  fs.mkdirSync(baselineDir, { recursive: true })
  fs.mkdirSync(path.join(baselineDir, 'auto_tag_log'), { recursive: true })
  fs.mkdirSync(path.join(baselineDir, 'history'), { recursive: true })

  const cases = (baseline.cases || []).map((c, i) => ({
    id: c.id || `case_${String(i + 1).padStart(3, '0')}`,
    name: c.name || `Case ${i + 1}`,
    category: c.category || 'standard',
    input: c.input || '',
    expected_output: c.expected_output || '',
    description: c.description || '',
    created_at: now,
    updated_at: now,
  }))

  // cases.json
  fs.writeFileSync(
    path.join(baselineDir, 'cases.json'),
    JSON.stringify({ baseline_id: id, version: 'v1', cases }, null, 2)
  )

  const versionNum = parseInt(seedVersion.replace('v', ''), 10)

  // meta.json
  fs.writeFileSync(
    path.join(baselineDir, 'meta.json'),
    JSON.stringify({
      id,
      name: baseline.name,
      description: baseline.description || '',
      author: '',
      source: 'manual',
      purpose: baseline.purpose,
      provider: baseline.provider,
      version: seedVersion,
      version_count: versionNum,
      case_count: cases.length,
      status: 'active',
      created_at: now,
      updated_at: now,
    }, null, 2)
  )

  // tags.json
  fs.writeFileSync(
    path.join(baselineDir, 'tags.json'),
    JSON.stringify({ manual: [], auto: [] }, null, 2)
  )

  // If seeding at v2+, write history entries so the UI shows earlier versions with Restore buttons.
  // getBaseline builds the version list as: [{v1, created_at}, ...historyEntries].
  // We only need history entries for v2..vN — the v1 entry is always synthesised from created_at.
  if (versionNum >= 2) {
    const historyDir = path.join(baselineDir, 'history')
    for (let n = 2; n <= versionNum; n++) {
      const from = `v${n - 1}`
      const to   = `v${n}`
      const ts   = now.replace(/[-:T.Z]/g, '').slice(0, 14)
      fs.writeFileSync(
        path.join(historyDir, `${from}_to_${to}_${ts}${n}.json`),
        JSON.stringify({
          from_version: from,
          to_version: to,
          timestamp: now,
          changed_fields: ['cases'],
          diff: { cases: { before: `${cases.length - 1} cases`, after: `${cases.length} cases` } },
        }, null, 2)
      )
    }
  }

  console.log(`[workspace-factory] Seeded baseline "${baseline.name}" → ${dirName} (${seedVersion})`)
  return id
}

/**
 * Write a pre-built project directory into the workspace.
 * Useful for testing tab content that requires existing results,
 * analysis reports, or iteration reports — without running real CLI.
 *
 * @typedef {object} ProjectSeed
 * @property {string} [key]               — Map key for looking up the generated ID
 * @property {string} [id]                — Explicit project ID (auto-generated if omitted)
 * @property {string} name
 * @property {string} [status]            — 'pending' | 'running' | 'completed' | 'interrupted'
 * @property {Array}  [skills]            — Skill refs: { ref_id, name, version, local_path }
 * @property {Array}  [baselines]         — Baseline refs: { ref_id, name, version, local_path }
 * @property {object} [progress]          — { total_tasks, completed_tasks, failed_tasks, last_checkpoint }
 * @property {object} [cliConfig]         — CLI config override
 * @property {object} [summary]           — Pre-built results/summary.json content
 * @property {object} [analysisReport]    — Pre-built analysis_report.json content
 * @property {object} [iterationReport]   — Pre-built iterations/iteration_report.json content
 *
 * @param {string} workspaceDir
 * @param {ProjectSeed} project
 * @returns {{ id: string, projectDir: string, projectPath: string }}
 */
function _seedProject(workspaceDir, project) {
  const {
    id = uuidv4(),
    name,
    status = 'pending',
    skills = [],
    baselines = [],
    progress = null,
    cliConfig = null,
    summary = null,
    analysisReport = null,
    iterationReport = null,
  } = project

  const now = new Date().toISOString()
  const projectDir = `project_${id.slice(0, 8)}_${Date.now()}`
  const projectPath = path.join(workspaceDir, 'projects', projectDir)

  fs.mkdirSync(path.join(projectPath, 'results'), { recursive: true })
  fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })

  const defaultProgress = progress || {
    total_tasks: 0,
    completed_tasks: 0,
    failed_tasks: 0,
    last_checkpoint: null,
  }

  fs.writeFileSync(
    path.join(projectPath, 'config.json'),
    JSON.stringify({
      id,
      name,
      description: '',
      status,
      created_at: now,
      updated_at: now,
      skills,
      baselines,
      cli_config: cliConfig || { model: 'claude-opus-4-6', timeout_seconds: 60, retry_count: 2, extra_flags: [] },
      progress: defaultProgress,
    }, null, 2)
  )

  if (summary) {
    fs.writeFileSync(
      path.join(projectPath, 'results', 'summary.json'),
      JSON.stringify(summary, null, 2)
    )
  }

  if (analysisReport) {
    fs.writeFileSync(
      path.join(projectPath, 'analysis_report.json'),
      JSON.stringify(analysisReport, null, 2)
    )
  }

  if (iterationReport) {
    fs.mkdirSync(path.join(projectPath, 'iterations'), { recursive: true })
    fs.writeFileSync(
      path.join(projectPath, 'iterations', 'iteration_report.json'),
      JSON.stringify(iterationReport, null, 2)
    )
  }

  console.log(`[workspace-factory] Seeded project "${name}" → ${projectDir} (${status})`)
  return { id, projectDir, projectPath }
}

/**
 * Seed a project that already has a completed results/summary.json.
 * This is a convenience wrapper around _seedProject for leaderboard E2E tests.
 *
 * @param {string} workspaceDir
 * @param {object} opts
 * @param {string} opts.projectId   - Explicit project ID
 * @param {string} opts.projectName
 * @param {object[]} opts.skillRefs - [{ref_id, name, version, local_path}]
 * @param {object}   opts.baselineRef - {ref_id, name, version, local_path, purpose}
 * @param {object[]} opts.ranking   - summary.json ranking array
 * @param {string}   [opts.testedAt] - ISO timestamp for summary.generated_at
 * @returns {{ id, projectDir, projectPath }}
 */
function _seedProjectWithSummary(workspaceDir, { projectId, projectName, skillRefs = [], baselineRef, ranking = [], testedAt }) {
  const summary = {
    project_id: projectId,
    baseline_id: baselineRef ? baselineRef.ref_id : '',
    total_cases: ranking.reduce((s, r) => s + (r.completed_cases || 0) + (r.failed_cases || 0), 0),
    generated_at: testedAt || new Date().toISOString(),
    ranking,
  }
  return _seedProject(workspaceDir, {
    id: projectId,
    name: projectName,
    status: 'completed',
    skills: skillRefs,
    baselines: baselineRef ? [baselineRef] : [],
    progress: { total_tasks: ranking.length, completed_tasks: ranking.length, failed_tasks: 0, last_checkpoint: ranking.length },
    summary,
  })
}

module.exports = { createTestWorkspace, _seedSkill, _seedBaseline, _seedProject, _seedProjectWithSummary }
