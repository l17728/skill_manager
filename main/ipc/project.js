'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const projectService = require('../services/project-service')

module.exports = function registerProjectHandlers(mainWindow) {
  ipcMain.handle('project:create', wrapHandler(async (args) => {
    return projectService.createProject(args)
  }))

  ipcMain.handle('project:list', wrapHandler(async (args) => {
    return projectService.listProjects(args)
  }))

  ipcMain.handle('project:get', wrapHandler(async ({ projectId }) => {
    return projectService.getProject(projectId)
  }))

  ipcMain.handle('project:export', wrapHandler(async ({ projectId, destPath }) => {
    return projectService.exportProject(projectId, destPath)
  }))

  ipcMain.handle('project:delete', wrapHandler(async ({ projectId }) => {
    return projectService.deleteProject(projectId)
  }))
}
