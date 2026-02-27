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
}
