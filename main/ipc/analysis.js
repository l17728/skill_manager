'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const analysisService = require('../services/analysis-service')

module.exports = function registerAnalysisHandlers(mainWindow) {
  function send(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  ipcMain.handle('analysis:run', wrapHandler(async ({ projectId }) => {
    return analysisService.runAnalysis(projectId, {
      onComplete: (data) => send('analysis:completed', data),
    })
  }))

  ipcMain.handle('analysis:getReport', wrapHandler(async ({ projectId }) => {
    return analysisService.getReport(projectId)
  }))

  ipcMain.handle('analysis:exportReport', wrapHandler(async ({ projectId, format, destPath }) => {
    return analysisService.exportReport(projectId, { format, destPath })
  }))
}
