'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const recomposeService = require('../services/recompose-service')

module.exports = function registerRecomposeHandlers(mainWindow) {
  function send(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  ipcMain.handle('recompose:execute', wrapHandler(async ({ projectId, retentionRules, selectedSegmentIds, strategy }) => {
    return recomposeService.executeRecompose(
      projectId,
      { retentionRules, selectedSegmentIds, strategy },
      { onComplete: (data) => send('recompose:completed', data) },
    )
  }))

  ipcMain.handle('recompose:save', wrapHandler(async ({ projectId, content, meta }) => {
    return recomposeService.saveRecomposedSkill(projectId, { content, meta })
  }))
}
