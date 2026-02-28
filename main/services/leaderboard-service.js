'use strict'

/**
 * leaderboard-service.js
 *
 * Aggregates test results across all projects to build ranked leaderboards.
 *
 * Key design:
 * - Scores are relative to a specific Baseline — never mix baselines in a ranking.
 * - Staleness is computed at query-time by comparing tested-version vs current-version.
 * - No extra storage required: all data comes from existing project files.
 * - Scans workspace/projects/ at read-time (suitable for <200 projects locally).
 */

const fs   = require('fs')
const path = require('path')

const fileService      = require('./file-service')
const workspaceService = require('./workspace-service')
const logService       = require('./log-service')

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Scan a single project directory and return raw leaderboard records.
 * Returns [] if the project has no completed results or files are malformed.
 *
 * @param {string} projectPath - Absolute path to the project directory
 * @returns {RawRecord[]}
 */
function _scanProject(projectPath) {
  const configPath  = path.join(projectPath, 'config.json')
  const summaryPath = path.join(projectPath, 'results', 'summary.json')

  const config = fileService.readJson(configPath)
  if (!config) {
    logService.warn('leaderboard-service', '_scanProject: missing config.json', { projectPath })
    return []
  }

  const summary = fileService.readJson(summaryPath)
  if (!summary) {
    // Not an error — project may still be running
    return []
  }

  if (!Array.isArray(summary.ranking) || summary.ranking.length === 0) {
    return []
  }

  // Build a quick-lookup map for skills in this project's config
  const skillMap = {}
  for (const s of (config.skills || [])) {
    skillMap[s.ref_id] = s
  }

  // There is typically one baseline per project
  const baselineRef = (config.baselines || [])[0]
  if (!baselineRef) {
    logService.warn('leaderboard-service', '_scanProject: no baseline in config', { projectPath })
    return []
  }

  const records = []
  for (const entry of summary.ranking) {
    const skillConfig = skillMap[entry.skill_id]
    if (!skillConfig) {
      logService.warn('leaderboard-service', '_scanProject: skill_id not in config.skills', {
        projectPath, skillId: entry.skill_id,
      })
      continue
    }

    records.push({
      projectId:            config.id,
      projectName:          config.name || '',
      testedAt:             summary.generated_at || config.updated_at || '',
      skillId:              entry.skill_id,
      skillName:            entry.skill_name || skillConfig.name || '',
      skillVersionTested:   entry.skill_version || skillConfig.version || 'v1',
      baselineId:           baselineRef.ref_id,
      baselineName:         baselineRef.name || '',
      baselineVersionTested:baselineRef.version || 'v1',
      baselinePurpose:      baselineRef.purpose || '',
      baselineCaseCount:    summary.total_cases || 0,
      avgScore:             entry.avg_score || 0,
      scoreBreakdown:       entry.score_breakdown || {},
      completedCases:       entry.completed_cases || 0,
      failedCases:          entry.failed_cases   || 0,
    })
  }

  logService.info('leaderboard-service', '_scanProject', { projectPath: path.basename(projectPath), recordCount: records.length })
  return records
}

/**
 * Look up the current version of a Skill in the workspace.
 * Uses the naming convention skill_${id.slice(0,8)}_vN for fast directory matching.
 *
 * @param {string} skillId - Full UUID
 * @returns {string|null} version string or null if not found
 */
function _getCurrentSkillVersion(skillId) {
  const prefix = `skill_${skillId.slice(0, 8)}_`
  const allDirs = workspaceService.listAllSkillDirs()
  for (const { dir, fullPath } of allDirs) {
    if (dir.startsWith(prefix)) {
      const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
      if (meta && meta.id === skillId) {
        return meta.version || null
      }
    }
  }
  // Fallback: full scan without prefix (handles edge cases)
  for (const { fullPath } of allDirs) {
    const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
    if (meta && meta.id === skillId) {
      return meta.version || null
    }
  }
  logService.warn('leaderboard-service', '_getCurrentSkillVersion: not found', { skillId })
  return null
}

/**
 * Look up the current version of a Baseline in the workspace.
 *
 * @param {string} baselineId - Full UUID
 * @returns {string|null}
 */
function _getCurrentBaselineVersion(baselineId) {
  const prefix = `baseline_${baselineId.slice(0, 8)}_`
  const allDirs = workspaceService.listAllBaselineDirs()
  for (const { dir, fullPath } of allDirs) {
    if (dir.startsWith(prefix)) {
      const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
      if (meta && meta.id === baselineId) {
        return meta.version || null
      }
    }
  }
  for (const { fullPath } of allDirs) {
    const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
    if (meta && meta.id === baselineId) {
      return meta.version || null
    }
  }
  logService.warn('leaderboard-service', '_getCurrentBaselineVersion: not found', { baselineId })
  return null
}

/**
 * Compute staleness for a single record.
 * Pure function — no I/O.
 *
 * @param {string}      skillVersionTested
 * @param {string|null} currentSkillVersion    - null if Skill has been deleted
 * @param {string}      baselineVersionTested
 * @param {string|null} currentBaselineVersion - null if Baseline has been deleted
 * @returns {'current'|'skill_updated'|'baseline_updated'|'both_updated'}
 */
function _computeStaleness(skillVersionTested, currentSkillVersion, baselineVersionTested, currentBaselineVersion) {
  // Treat deleted asset (null) as "updated" (conservative)
  const skillStale    = currentSkillVersion    === null || skillVersionTested    !== currentSkillVersion
  const baselineStale = currentBaselineVersion === null || baselineVersionTested !== currentBaselineVersion

  if (!skillStale && !baselineStale) return 'current'
  if ( skillStale && !baselineStale) return 'skill_updated'
  if (!skillStale &&  baselineStale) return 'baseline_updated'
  return 'both_updated'
}

// ─── Version lookup cache (per query call, rebuilt on each invocation) ────────

function _buildVersionCache(rawRecords) {
  const skillCache    = {}
  const baselineCache = {}

  for (const r of rawRecords) {
    if (!(r.skillId    in skillCache))    skillCache[r.skillId]       = _getCurrentSkillVersion(r.skillId)
    if (!(r.baselineId in baselineCache)) baselineCache[r.baselineId] = _getCurrentBaselineVersion(r.baselineId)
  }

  return { skillCache, baselineCache }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Query the leaderboard.
 *
 * @param {object} opts
 * @param {string}  [opts.baselineId]       - Filter to a single baseline
 * @param {string}  [opts.skillId]          - Filter to a single skill
 * @param {string}  [opts.purpose]          - Filter by baseline purpose
 * @param {string}  [opts.dateFrom]         - ISO date lower bound (inclusive)
 * @param {string}  [opts.dateTo]           - ISO date upper bound (inclusive)
 * @param {boolean} [opts.includeStale]     - Default true; false = current only
 * @param {boolean} [opts.groupByBaseline]  - Default true when no baselineId filter
 * @returns {{ groups?: LeaderboardGroup[], records?: LeaderboardRecord[] }}
 */
async function queryLeaderboard(opts = {}) {
  const {
    baselineId,
    skillId,
    purpose,
    dateFrom,
    dateTo,
    includeStale    = true,
    groupByBaseline = !baselineId && !skillId,
  } = opts

  logService.info('leaderboard-service', 'queryLeaderboard start', { opts })

  // 1. Scan all projects
  const projectEntries = workspaceService.listAllProjectDirs()
  const rawRecords = []
  for (const { fullPath } of projectEntries) {
    const recs = _scanProject(fullPath)
    rawRecords.push(...recs)
  }

  // 2. Build version cache (one lookup per unique skill/baseline id)
  const { skillCache, baselineCache } = _buildVersionCache(rawRecords)

  // 3. Assemble LeaderboardRecord with staleness
  let records = rawRecords.map(r => ({
    skillId:                  r.skillId,
    skillName:                r.skillName,
    skillVersionTested:       r.skillVersionTested,
    skillVersionCurrent:      skillCache[r.skillId] || null,
    baselineId:               r.baselineId,
    baselineName:             r.baselineName,
    baselinePurpose:          r.baselinePurpose,
    baselineCaseCount:        r.baselineCaseCount,
    baselineVersionTested:    r.baselineVersionTested,
    baselineVersionCurrent:   baselineCache[r.baselineId] || null,
    avgScore:                 r.avgScore,
    scoreBreakdown:           r.scoreBreakdown,
    projectId:                r.projectId,
    projectName:              r.projectName,
    testedAt:                 r.testedAt,
    completedCases:           r.completedCases,
    failedCases:              r.failedCases,
    staleness: _computeStaleness(
      r.skillVersionTested,
      skillCache[r.skillId],
      r.baselineVersionTested,
      baselineCache[r.baselineId]
    ),
  }))

  // 4. Apply filters
  if (baselineId) records = records.filter(r => r.baselineId === baselineId)
  if (skillId)    records = records.filter(r => r.skillId    === skillId)
  if (purpose)    records = records.filter(r => r.baselinePurpose === purpose)
  if (dateFrom)   records = records.filter(r => r.testedAt >= dateFrom)
  if (dateTo)     records = records.filter(r => r.testedAt <= dateTo + 'T23:59:59Z')
  if (!includeStale) records = records.filter(r => r.staleness === 'current')

  // 5. Sort by avgScore descending
  records.sort((a, b) => b.avgScore - a.avgScore)

  let result
  if (groupByBaseline) {
    // Group by baselineId
    const groupMap = new Map()
    for (const rec of records) {
      if (!groupMap.has(rec.baselineId)) {
        groupMap.set(rec.baselineId, {
          baselineId:             rec.baselineId,
          baselineName:           rec.baselineName,
          baselinePurpose:        rec.baselinePurpose,
          baselineCaseCount:      rec.baselineCaseCount,
          baselineVersionCurrent: rec.baselineVersionCurrent,
          skillCount:             0,
          records:                [],
        })
      }
      groupMap.get(rec.baselineId).records.push(rec)
    }
    // Count distinct skill IDs per group
    for (const group of groupMap.values()) {
      group.skillCount = new Set(group.records.map(r => r.skillId)).size
    }
    result = { groups: [...groupMap.values()] }
  } else {
    result = { records }
  }

  const totalReturned = groupByBaseline
    ? result.groups.reduce((s, g) => s + g.records.length, 0)
    : result.records.length

  logService.info('leaderboard-service', 'queryLeaderboard done', {
    projectsScanned: projectEntries.length,
    rawRecords: rawRecords.length,
    returned: totalReturned,
    groupByBaseline,
  })

  return result
}

/**
 * Export leaderboard results to a file.
 *
 * @param {object} opts
 * @param {string}  [opts.baselineId]
 * @param {string}  [opts.skillId]
 * @param {'csv'|'json'} opts.format
 * @returns {{ filePath: string }}
 */
async function exportLeaderboard({ baselineId, skillId, format = 'csv' } = {}) {
  const { records = [] } = await queryLeaderboard({ baselineId, skillId, groupByBaseline: false })

  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const ext = format === 'json' ? 'json' : 'csv'
  const fileName = `leaderboard_export_${ts}.${ext}`
  const filePath = path.join(workspaceService.paths.workspace(), fileName)

  let content
  if (format === 'json') {
    content = JSON.stringify(records, null, 2)
  } else {
    const HEADERS = [
      'skill_name', 'skill_version_tested', 'skill_version_current',
      'baseline_name', 'baseline_version_tested', 'baseline_version_current',
      'avg_score',
      'functional_correctness', 'robustness', 'readability',
      'conciseness', 'complexity_control', 'format_compliance',
      'project_id', 'tested_at', 'staleness',
    ]
    const escape = v => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = [HEADERS.join(',')]
    for (const r of records) {
      const bd = r.scoreBreakdown || {}
      rows.push([
        r.skillName, r.skillVersionTested, r.skillVersionCurrent || '',
        r.baselineName, r.baselineVersionTested, r.baselineVersionCurrent || '',
        r.avgScore,
        bd.functional_correctness, bd.robustness, bd.readability,
        bd.conciseness, bd.complexity_control, bd.format_compliance,
        r.projectId, r.testedAt, r.staleness,
      ].map(escape).join(','))
    }
    content = rows.join('\n')
  }

  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    logService.info('leaderboard-service', 'exportLeaderboard', { format, filePath, recordCount: records.length })
    return { filePath }
  } catch (e) {
    logService.error('leaderboard-service', 'exportLeaderboard failed', { error: e.message })
    throw e
  }
}

/**
 * Build a map of skillId → SkillTestSummary for the Skill list badge.
 * Returns a plain object (JSON-serializable).
 *
 * @returns {Object.<string, SkillTestSummary>}
 *
 * @typedef {{ has_tests: boolean, best_score: number, best_baseline_name: string, test_count: number, staleness: string }} SkillTestSummary
 */
async function getTestSummaries() {
  const { records = [] } = await queryLeaderboard({ groupByBaseline: false })

  // Staleness order: current > skill_updated > baseline_updated > both_updated
  const STALENESS_RANK = { current: 0, skill_updated: 1, baseline_updated: 2, both_updated: 3 }

  const summaryMap = {}
  for (const rec of records) {
    const existing = summaryMap[rec.skillId]
    if (!existing) {
      summaryMap[rec.skillId] = {
        has_tests:          true,
        best_score:         rec.avgScore,
        best_baseline_name: rec.baselineName,
        test_count:         1,
        staleness:          rec.staleness,
      }
    } else {
      existing.test_count++
      if (rec.avgScore > existing.best_score) {
        existing.best_score         = rec.avgScore
        existing.best_baseline_name = rec.baselineName
      }
      // Keep the "best" (lowest rank number) staleness
      if ((STALENESS_RANK[rec.staleness] || 99) < (STALENESS_RANK[existing.staleness] || 99)) {
        existing.staleness = rec.staleness
      }
    }
  }

  logService.info('leaderboard-service', 'getTestSummaries', { skillCount: Object.keys(summaryMap).length })
  return summaryMap
}

module.exports = {
  queryLeaderboard,
  exportLeaderboard,
  getTestSummaries,
  // Exported for unit testing
  _scanProject,
  _getCurrentSkillVersion,
  _getCurrentBaselineVersion,
  _computeStaleness,
}
