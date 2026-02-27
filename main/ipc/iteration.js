'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const iterationService = require('../services/iteration-service')

module.exports = function registerIterationHandlers(mainWindow) {
  function send(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  ipcMain.handle('iteration:start', wrapHandler(async ({
    projectId, recomposedSkillId, maxRounds, stopThreshold, retentionRules, selectedSegmentIds,
    beamWidth, plateauThreshold, plateauRoundsBeforeEscape,
  }) => {
    return iterationService.startIteration(
      projectId,
      {
        recomposedSkillId, maxRounds, stopThreshold, retentionRules, selectedSegmentIds,
        beamWidth, plateauThreshold, plateauRoundsBeforeEscape,
      },
      {
        onRoundComplete: (data) => send('iteration:round:completed', data),
        onAllComplete:   (data) => send('iteration:round:completed', { ...data, type: 'all_complete' }),
      },
    )
  }))

  ipcMain.handle('iteration:pause', wrapHandler(async ({ projectId }) =>
    iterationService.pauseIteration(projectId),
  ))

  ipcMain.handle('iteration:stop', wrapHandler(async ({ projectId }) =>
    iterationService.stopIteration(projectId),
  ))

  ipcMain.handle('iteration:getProgress', wrapHandler(async ({ projectId }) =>
    iterationService.getProgress(projectId),
  ))

  ipcMain.handle('iteration:getReport', wrapHandler(async ({ projectId }) =>
    iterationService.getIterationReport(projectId),
  ))

  ipcMain.handle('iteration:getExplorationLog', wrapHandler(async ({ projectId }) =>
    iterationService.getExplorationLog(projectId),
  ))
}
