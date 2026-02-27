'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const testService = require('../services/test-service')

module.exports = function registerTestHandlers(mainWindow) {
  function onProgress(data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('test:progress:update', data)
    }
  }

  ipcMain.handle('test:start', wrapHandler(async ({ projectId }) => {
    return testService.startTest(projectId, { onProgress })
  }))

  ipcMain.handle('test:pause', wrapHandler(async ({ projectId }) => {
    return testService.pauseTest(projectId)
  }))

  ipcMain.handle('test:resume', wrapHandler(async ({ projectId }) => {
    return testService.resumeTest(projectId, { onProgress })
  }))

  ipcMain.handle('test:stop', wrapHandler(async ({ projectId }) => {
    return testService.stopTest(projectId)
  }))

  ipcMain.handle('test:getProgress', wrapHandler(async ({ projectId }) => {
    return testService.getProgress(projectId)
  }))

  ipcMain.handle('test:getResults', wrapHandler(async (args) => {
    return testService.getResults(args.projectId, args)
  }))

  ipcMain.handle('test:retryCase', wrapHandler(async ({ projectId, skillId, caseId }) => {
    return testService.retryCase(projectId, skillId, caseId, { onProgress })
  }))

  ipcMain.handle('test:exportResults', wrapHandler(async ({ projectId, format, destPath }) => {
    return testService.exportResults(projectId, { format, destPath })
  }))
}
