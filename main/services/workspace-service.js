'use strict'

const path = require('path')
const fileService = require('./file-service')

// Root workspace directory — overridable at runtime via setWorkspace() for testing
let WORKSPACE = path.join(__dirname, '../../workspace')

/**
 * Override workspace root at runtime.
 * Called from main/index.js when --workspace=<path> CLI arg is present.
 * Must be called before initWorkspace().
 */
function setWorkspace(p) {
  WORKSPACE = p
}

const paths = {
  workspace: () => WORKSPACE,

  skills: (purpose, provider, dir) => {
    if (purpose && provider && dir) return path.join(WORKSPACE, 'skills', purpose, provider, dir)
    if (purpose && provider)       return path.join(WORKSPACE, 'skills', purpose, provider)
    if (purpose)                   return path.join(WORKSPACE, 'skills', purpose)
    return path.join(WORKSPACE, 'skills')
  },

  baselines: (purpose, provider, dir) => {
    if (purpose && provider && dir) return path.join(WORKSPACE, 'baselines', purpose, provider, dir)
    if (purpose && provider)       return path.join(WORKSPACE, 'baselines', purpose, provider)
    if (purpose)                   return path.join(WORKSPACE, 'baselines', purpose)
    return path.join(WORKSPACE, 'baselines')
  },

  projects: (dir) => {
    if (dir) return path.join(WORKSPACE, 'projects', dir)
    return path.join(WORKSPACE, 'projects')
  },

  cliConfig: () => path.join(WORKSPACE, 'cli', 'config.json'),
  cliSessions: () => path.join(WORKSPACE, 'cli', 'sessions.json'),
  cliTempSession: () => path.join(WORKSPACE, 'cli', 'temp_session'),
  cliCache: () => path.join(WORKSPACE, 'cli', 'cache'),
  logs: () => path.join(WORKSPACE, 'logs'),
  versions: () => path.join(WORKSPACE, 'versions'),
}

/**
 * Initialize the workspace directory structure.
 * Called on app startup. Idempotent.
 */
function initWorkspace() {
  fileService.ensureDir(paths.skills())
  fileService.ensureDir(paths.baselines())
  fileService.ensureDir(paths.projects())
  fileService.ensureDir(paths.cliTempSession())
  fileService.ensureDir(paths.cliCache())
  fileService.ensureDir(paths.logs())
  fileService.ensureDir(paths.versions())

  // Ensure CLI config exists
  const cliConfigPath = paths.cliConfig()
  if (!fileService.exists(cliConfigPath)) {
    fileService.writeJson(cliConfigPath, {
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
    })
  }

  return { initialized: true, workspacePath: WORKSPACE }
}
/**
 * Scan all skill assets and return a flat list of their paths.
 * Each entry: { purpose, provider, dir, fullPath }
 */
function listAllSkillDirs() {
  const results = []
  const purposeDirs = fileService.listDirs(paths.skills())
  for (const purpose of purposeDirs) {
    const providerDirs = fileService.listDirs(paths.skills(purpose))
    for (const provider of providerDirs) {
      const skillDirs = fileService.listDirs(paths.skills(purpose, provider))
      for (const dir of skillDirs) {
        if (dir.startsWith('skill_')) {
          results.push({
            purpose,
            provider,
            dir,
            fullPath: paths.skills(purpose, provider, dir),
          })
        }
      }
    }
  }
  return results
}

/**
 * Scan all baseline assets and return a flat list of their paths.
 */
function listAllBaselineDirs() {
  const results = []
  const purposeDirs = fileService.listDirs(paths.baselines())
  for (const purpose of purposeDirs) {
    const providerDirs = fileService.listDirs(paths.baselines(purpose))
    for (const provider of providerDirs) {
      const baselineDirs = fileService.listDirs(paths.baselines(purpose, provider))
      for (const dir of baselineDirs) {
        if (dir.startsWith('baseline_')) {
          results.push({
            purpose,
            provider,
            dir,
            fullPath: paths.baselines(purpose, provider, dir),
          })
        }
      }
    }
  }
  return results
}

/**
 * Scan all project dirs.
 */
function listAllProjectDirs() {
  const results = []
  const projectDirs = fileService.listDirs(paths.projects())
  for (const dir of projectDirs) {
    if (dir.startsWith('project_')) {
      results.push({
        dir,
        fullPath: paths.projects(dir),
      })
    }
  }
  return results
}

/**
 * Return all unique purpose names currently stored in the workspace.
 * @param {'skill'|'baseline'} assetType
 * @returns {string[]}
 */
function getExistingPurposes(assetType = 'skill') {
  const basePath = assetType === 'baseline' ? paths.baselines() : paths.skills()
  return fileService.listDirs(basePath)
}

module.exports = {
  WORKSPACE,
  paths,
  setWorkspace,
  initWorkspace,
  listAllSkillDirs,
  listAllBaselineDirs,
  listAllProjectDirs,
  getExistingPurposes,
}
