'use strict'

/**
 * trace-service.js — Phase 5 Module 10: Version & Environment Traceability
 *
 * Captures the full execution environment for any project (CLI version,
 * model version, skill/baseline versions, CLI config) and provides
 * cross-project comparison for reproducibility analysis.
 *
 * Exports: getProjectEnv, compareEnvs
 */

const path = require('path')
const fileService      = require('./file-service')
const workspaceService = require('./workspace-service')
const logService       = require('./log-service')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _findProjectDir(projectId) {
  for (const { dir, fullPath } of workspaceService.listAllProjectDirs()) {
    const cfg = fileService.readJson(path.join(fullPath, 'config.json'))
    if (cfg && cfg.id === projectId) return { dir, fullPath }
  }
  return null
}

/**
 * Scan result files to extract cli_version and model_version.
 * Returns null for each if not found.
 */
function _extractFromResults(projectPath, skills) {
  let cliVersion   = null
  let modelVersion = null

  for (const skillRef of (skills || [])) {
    const skillDir  = path.basename(skillRef.local_path || '')
    const resultDir = path.join(projectPath, 'results', skillDir)
    const files     = fileService.listFiles(resultDir)

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const rec = fileService.readJson(path.join(resultDir, file))
      if (rec && rec.cli_version   && !cliVersion)   cliVersion   = rec.cli_version
      if (rec && rec.model_version && !modelVersion) modelVersion = rec.model_version
      if (cliVersion && modelVersion) break
    }
    if (cliVersion && modelVersion) break
  }

  return { cliVersion, modelVersion }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the full execution environment snapshot for a project.
 *
 * @param {string} projectId
 * @returns {{ projectId, projectName, createdAt, cliVersion, modelVersion, skills, baselines, cliConfig }}
 */
function getProjectEnv(projectId) {
  const found = _findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const config = fileService.readJson(path.join(found.fullPath, 'config.json'))
  if (!config) throw { code: 'NOT_FOUND', message: 'Project config missing' }

  const { cliVersion, modelVersion } = _extractFromResults(found.fullPath, config.skills)
  logService.info('trace-service', 'getProjectEnv', { projectId, cliVersion, modelVersion, skillCount: (config.skills || []).length })

  return {
    projectId:    config.id,
    projectName:  config.name || '',
    createdAt:    config.created_at || '',
    cliVersion:   cliVersion   || 'unknown',
    modelVersion: modelVersion || (config.cli_config && config.cli_config.model) || 'unknown',
    skills:   (config.skills    || []).map(s => ({ id: s.ref_id, name: s.name, version: s.version })),
    baselines: (config.baselines || []).map(b => ({ id: b.ref_id, name: b.name, version: b.version })),
    cliConfig: config.cli_config || {},
  }
}

/**
 * Compare the environments of two projects and list all differences.
 *
 * @param {string} projectIdA
 * @param {string} projectIdB
 * @returns {{ differences: { field, valueA, valueB }[], identical: boolean }}
 */
function compareEnvs(projectIdA, projectIdB) {
  const envA = getProjectEnv(projectIdA)
  const envB = getProjectEnv(projectIdB)

  const differences = []

  // Top-level scalar fields
  for (const field of ['cliVersion', 'modelVersion']) {
    if (String(envA[field]) !== String(envB[field])) {
      differences.push({ field, valueA: String(envA[field]), valueB: String(envB[field]) })
    }
  }

  // CLI config fields
  const cfgA = envA.cliConfig || {}
  const cfgB = envB.cliConfig || {}
  for (const field of ['model', 'timeout_seconds', 'retry_count']) {
    const a = cfgA[field] != null ? String(cfgA[field]) : 'undefined'
    const b = cfgB[field] != null ? String(cfgB[field]) : 'undefined'
    if (a !== b) {
      differences.push({ field: `cliConfig.${field}`, valueA: a, valueB: b })
    }
  }

  // Skill version comparison
  const maxLen = Math.max(envA.skills.length, envB.skills.length)
  for (let i = 0; i < maxLen; i++) {
    const sA = envA.skills[i]
    const sB = envB.skills[i]
    if (!sA || !sB) {
      differences.push({
        field:  `skills[${i}]`,
        valueA: sA ? sA.id   : 'missing',
        valueB: sB ? sB.id   : 'missing',
      })
    } else if (sA.version !== sB.version) {
      differences.push({
        field:  `skills[${i}].version`,
        valueA: sA.version,
        valueB: sB.version,
      })
    }
  }

  // Baseline version comparison
  const maxBaselines = Math.max(envA.baselines.length, envB.baselines.length)
  for (let i = 0; i < maxBaselines; i++) {
    const bA = envA.baselines[i]
    const bB = envB.baselines[i]
    if (!bA || !bB) {
      differences.push({
        field:  `baselines[${i}]`,
        valueA: bA ? bA.id : 'missing',
        valueB: bB ? bB.id : 'missing',
      })
    } else if (bA.version !== bB.version) {
      differences.push({
        field:  `baselines[${i}].version`,
        valueA: bA.version,
        valueB: bB.version,
      })
    }
  }

  logService.info('trace-service', 'compareEnvs', { projectIdA, projectIdB, identical: differences.length === 0, diffCount: differences.length })
  return { differences, identical: differences.length === 0 }
}

module.exports = { getProjectEnv, compareEnvs }
