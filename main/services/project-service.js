'use strict'

/**
 * project-service.js
 * Module 3: Test Project Management
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fileService = require('./file-service')
const workspaceService = require('./workspace-service')
const logService = require('./log-service')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 30)
}

function projectDirName(name) {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  return `project_${slugify(name)}_${ts}`
}

function findProjectDir(projectId) {
  const allDirs = workspaceService.listAllProjectDirs()
  for (const { dir, fullPath } of allDirs) {
    const cfg = fileService.readJson(path.join(fullPath, 'config.json'))
    if (cfg && cfg.id === projectId) return { dir, fullPath }
  }
  return null
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Create a new project.
 * Copies skill/baseline assets into project directory.
 */
async function createProject({ name, description, skillIds, baselineIds, cliConfig, contextConfig }) {
  if (!name) throw { code: 'INVALID_PARAMS', message: 'name is required' }
  if (!skillIds || skillIds.length === 0) throw { code: 'INVALID_PARAMS', message: 'skillIds required' }
  if (!baselineIds || baselineIds.length === 0) throw { code: 'INVALID_PARAMS', message: 'baselineIds required' }

  const projectId = uuidv4()
  const dirName = projectDirName(name)
  const projectPath = workspaceService.paths.projects(dirName)

  fileService.ensureDir(projectPath)
  fileService.ensureDir(path.join(projectPath, 'skills'))
  fileService.ensureDir(path.join(projectPath, 'baselines'))
  fileService.ensureDir(path.join(projectPath, '.claude'))
  fileService.ensureDir(path.join(projectPath, 'logs'))
  fileService.ensureDir(path.join(projectPath, 'results'))

  const now = new Date().toISOString()

  // Copy skills
  const skillService = require('./skill-service')
  const baselineService = require('./baseline-service')

  const skillRefs = []
  let totalCases = 0

  for (const skillId of skillIds) {
    const found = skillService.findSkillDir(skillId)
    if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

    const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
    const destDir = path.join(projectPath, 'skills', found.dir)
    fileService.copyDir(found.fullPath, destDir)

    skillRefs.push({
      ref_id: skillId,
      name: meta.name,
      purpose: meta.purpose,
      provider: meta.provider,
      version: meta.version,
      local_path: `skills/${found.dir}`,
    })
  }

  const baselineRefs = []
  for (const baselineId of baselineIds) {
    const found = baselineService.findBaselineDir(baselineId)
    if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

    const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
    const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
    totalCases += (casesData && casesData.cases ? casesData.cases.length : 0)

    const destDir = path.join(projectPath, 'baselines', found.dir)
    fileService.copyDir(found.fullPath, destDir)

    baselineRefs.push({
      ref_id: baselineId,
      name: meta.name,
      version: meta.version,
      local_path: `baselines/${found.dir}`,
    })
  }

  const totalTasks = skillIds.length * totalCases

  const config = {
    id: projectId,
    name,
    description: description || '',
    status: 'pending',
    created_at: now,
    updated_at: now,
    original_skill_ids: skillIds,   // permanent record of original skills — used by AEIO iteration
    iteration_config: {             // AEIO iteration defaults; overridden at iteration:start
      mode:                        'standard', // 'standard' | 'explore' | 'adaptive'
      beam_width:                  1,
      plateau_threshold:           1.0,
      plateau_rounds_before_escape: 2,
    },
    skills: skillRefs,
    baselines: baselineRefs,
    cli_config: {
      model: (cliConfig && cliConfig.model) || 'claude-opus-4-6',
      timeout_seconds: (cliConfig && cliConfig.timeout_seconds) || 60,
      retry_count: (cliConfig && cliConfig.retry_count) || 2,
      extra_flags: (cliConfig && cliConfig.extra_flags) || [],
    },
    context_config: {
      token_threshold: (contextConfig && contextConfig.token_threshold) || 80000,
      auto_compress: (contextConfig && contextConfig.auto_compress) !== false,
      auto_export: (contextConfig && contextConfig.auto_export) !== false,
    },
    progress: {
      total_tasks: totalTasks,
      completed_tasks: 0,
      failed_tasks: 0,
      last_checkpoint: null,
    },
  }

  fileService.writeJson(path.join(projectPath, 'config.json'), config)

  logService.info('project-service', 'Project created', { projectId, name, totalTasks })

  return { projectId, projectPath, totalTasks }
}

/**
 * Get a project by ID.
 */
function getProject(projectId) {
  const found = findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const config = fileService.readJson(path.join(found.fullPath, 'config.json'))
  const hasResults = fileService.exists(path.join(found.fullPath, 'results', 'summary.json'))
  const hasAnalysis = fileService.exists(path.join(found.fullPath, 'analysis_report.json'))
  const hasIterations = fileService.exists(path.join(found.fullPath, 'iterations'))

  return { config, hasResults, hasAnalysis, hasIterations }
}

/**
 * List projects with optional status filter.
 */
function listProjects({ status, page = 1, pageSize = 20 } = {}) {
  const allDirs = workspaceService.listAllProjectDirs()

  const items = []
  for (const { dir, fullPath } of allDirs) {
    const config = fileService.readJson(path.join(fullPath, 'config.json'))
    if (!config) continue
    if (status && config.status !== status) continue

    items.push({
      id: config.id,
      name: config.name,
      status: config.status,
      skillCount: (config.skills || []).length,
      baselineCount: (config.baselines || []).length,
      totalTasks: config.progress ? config.progress.total_tasks : 0,
      completedTasks: config.progress ? config.progress.completed_tasks : 0,
      created_at: config.created_at,
    })
  }

  // Sort by created_at desc
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  const total = items.length
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
  return { items: pageItems, total, page, pageSize }
}

/**
 * Update project status.
 */
function updateProjectStatus(projectId, newStatus) {
  const found = findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const configPath = path.join(found.fullPath, 'config.json')
  const config = fileService.readJson(configPath)
  const prevStatus = config.status
  config.status = newStatus
  config.updated_at = new Date().toISOString()
  fileService.writeJson(configPath, config)
  logService.info('project-service', 'Project status updated', { projectId, prevStatus, newStatus })
  return { updated: true }
}

/**
 * Export a project to a destination directory.
 */
function exportProject(projectId, destPath) {
  const found = findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  const exportedPath = path.join(destPath, found.dir)
  fileService.copyDir(found.fullPath, exportedPath)

  logService.info('project-service', 'Project exported', { projectId, exportedPath })
  return { exportedPath }
}

/**
 * Delete a project.
 */
function deleteProject(projectId) {
  const found = findProjectDir(projectId)
  if (!found) throw { code: 'NOT_FOUND', message: `Project not found: ${projectId}` }

  fileService.removeDir(found.fullPath)
  logService.info('project-service', 'Project deleted', { projectId })
  return { deleted: true }
}

module.exports = {
  createProject,
  getProject,
  listProjects,
  updateProjectStatus,
  exportProject,
  deleteProject,
  findProjectDir,
}
