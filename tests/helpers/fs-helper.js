'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * Create a temporary directory for a test suite.
 * Returns { tmpDir, cleanup }
 */
function createTmpDir(prefix = 'skillmgr-test-') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    tmpDir,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch (_) {}
    },
  }
}

/**
 * Override workspace paths for testing.
 * Returns a restore function.
 */
function overrideWorkspace(workspaceService, tmpDir) {
  const origWorkspace = workspaceService.WORKSPACE
  const origPaths = { ...workspaceService.paths }

  // Create workspace structure in tmpDir
  const dirs = ['skills', 'baselines', 'projects', 'cli/temp_session', 'cli/cache', 'logs', 'versions']
  for (const d of dirs) {
    fs.mkdirSync(path.join(tmpDir, d), { recursive: true })
  }

  // Write CLI config
  fs.writeFileSync(
    path.join(tmpDir, 'cli', 'config.json'),
    JSON.stringify({
      cli_path: 'claude',
      default_model: 'claude-opus-4-6',
      default_timeout_seconds: 60,
      default_retry_count: 2,
      temp_session_ttl_days: 7,
      context: { token_threshold: 80000, auto_compress: true, auto_export: true },
      updated_at: '2024-01-01T00:00:00Z',
    }, null, 2),
    'utf-8'
  )

  // Monkey-patch the workspaceService module
  workspaceService.WORKSPACE = tmpDir

  workspaceService.paths.workspace = () => tmpDir
  workspaceService.paths.skills = (purpose, provider, dir) => {
    if (purpose && provider && dir) return path.join(tmpDir, 'skills', purpose, provider, dir)
    if (purpose && provider) return path.join(tmpDir, 'skills', purpose, provider)
    if (purpose) return path.join(tmpDir, 'skills', purpose)
    return path.join(tmpDir, 'skills')
  }
  workspaceService.paths.baselines = (purpose, provider, dir) => {
    if (purpose && provider && dir) return path.join(tmpDir, 'baselines', purpose, provider, dir)
    if (purpose && provider) return path.join(tmpDir, 'baselines', purpose, provider)
    if (purpose) return path.join(tmpDir, 'baselines', purpose)
    return path.join(tmpDir, 'baselines')
  }
  workspaceService.paths.projects = (dir) => {
    if (dir) return path.join(tmpDir, 'projects', dir)
    return path.join(tmpDir, 'projects')
  }
  workspaceService.paths.cliConfig = () => path.join(tmpDir, 'cli', 'config.json')
  workspaceService.paths.cliSessions = () => path.join(tmpDir, 'cli', 'sessions.json')
  workspaceService.paths.cliTempSession = () => path.join(tmpDir, 'cli', 'temp_session')
  workspaceService.paths.cliCache = () => path.join(tmpDir, 'cli', 'cache')
  workspaceService.paths.logs = () => path.join(tmpDir, 'logs')
  workspaceService.paths.versions = () => path.join(tmpDir, 'versions')

  return () => {
    workspaceService.WORKSPACE = origWorkspace
    Object.assign(workspaceService.paths, origPaths)
  }
}

module.exports = { createTmpDir, overrideWorkspace }
