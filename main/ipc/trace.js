'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const traceService = require('../services/trace-service')

module.exports = function registerTraceHandlers(mainWindow) {
  ipcMain.handle('trace:getProjectEnv', wrapHandler(async ({ projectId }) =>
    traceService.getProjectEnv(projectId),
  ))

  ipcMain.handle('trace:compareEnvs', wrapHandler(async ({ projectIdA, projectIdB }) =>
    traceService.compareEnvs(projectIdA, projectIdB),
  ))
}
