'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const workspaceService = require('../services/workspace-service')
const logService = require('../services/log-service')
const fileService = require('../services/file-service')

module.exports = function registerWorkspaceHandlers() {
  ipcMain.handle('workspace:init', wrapHandler(async () => {
    return workspaceService.initWorkspace()
  }))

  ipcMain.handle('search:global', wrapHandler(async ({ keyword, scopes, page = 1, pageSize = 20 }) => {
    if (!keyword) return { skills: [], baselines: [], projects: [], total: 0 }

    const skillService = require('../services/skill-service')
    const baselineService = require('../services/baseline-service')
    const projectService = require('../services/project-service')

    const useScopes = scopes || ['skills', 'baselines', 'projects']
    const lower = keyword.toLowerCase()
    const results = { skills: [], baselines: [], projects: [], total: 0 }

    if (useScopes.includes('skills')) {
      const found = skillService.searchSkills({ keyword, page: 1, pageSize: 50 })
      results.skills = found.items.map(i => ({ id: i.id, name: i.name, matchedIn: i.matchedIn }))
    }

    if (useScopes.includes('baselines')) {
      const allDirs = workspaceService.listAllBaselineDirs()
      const path = require('path')
      for (const { fullPath } of allDirs) {
        const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
        if (!meta || meta.status === 'archived') continue
        const matchedIn = []
        if (meta.name.toLowerCase().includes(lower)) matchedIn.push('name')
        if ((meta.description || '').toLowerCase().includes(lower)) matchedIn.push('description')
        if (matchedIn.length > 0) results.baselines.push({ id: meta.id, name: meta.name, matchedIn })
      }
    }

    if (useScopes.includes('projects')) {
      const allDirs = workspaceService.listAllProjectDirs()
      const path = require('path')
      for (const { fullPath } of allDirs) {
        const config = fileService.readJson(path.join(fullPath, 'config.json'))
        if (!config) continue
        const matchedIn = []
        if (config.name.toLowerCase().includes(lower)) matchedIn.push('name')
        if ((config.description || '').toLowerCase().includes(lower)) matchedIn.push('description')
        if (matchedIn.length > 0) results.projects.push({ id: config.id, name: config.name, matchedIn })
      }
    }

    results.total = results.skills.length + results.baselines.length + results.projects.length
    return results
  }))

  ipcMain.handle('log:query', wrapHandler(async (args) => {
    return logService.queryLogs(args)
  }))

  // P3-1: Backup workspace directory to user-specified destination
  ipcMain.handle('workspace:backup', wrapHandler(async ({ destDir }) => {
    if (!destDir) throw { code: 'INVALID_PARAMS', message: 'destDir is required' }
    const path = require('path')
    const srcDir = workspaceService.paths.workspace()
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const dest = path.join(destDir, `skillmanager_backup_${timestamp}`)
    fileService.copyDir(srcDir, dest)
    logService.info('workspace', 'workspace backup created', { dest })
    return { path: dest }
  }))

  // P1-3: Save a baseline cases.json template to the workspace root
  ipcMain.handle('workspace:saveTemplate', wrapHandler(async () => {
    const path = require('path')
    const dest = path.join(workspaceService.paths.workspace(), 'cases_template.json')
    const template = [
      { name: '用例1', input: '你的输入内容（问题或指令）', expected_output: '期望的正确输出（参考答案）' },
      { name: '用例2', input: '第二道题的输入', expected_output: '第二道题的期望输出' },
    ]
    fileService.writeJson(dest, template)
    logService.info('workspace', 'cases template saved', { dest })
    return { path: dest }
  }))
}
