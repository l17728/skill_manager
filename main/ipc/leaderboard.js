'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const leaderboardService = require('../services/leaderboard-service')

module.exports = function registerLeaderboardHandlers(_mainWindow) {
  // Query leaderboard — grouped or flat, with optional filters
  ipcMain.handle('leaderboard:query', wrapHandler(async (opts) =>
    leaderboardService.queryLeaderboard(opts || {}),
  ))

  // One-shot summaries for all skills (drives Skill list test badges)
  ipcMain.handle('leaderboard:getTestSummaries', wrapHandler(async () =>
    leaderboardService.getTestSummaries(),
  ))

  // Export current filtered results to CSV or JSON
  ipcMain.handle('leaderboard:export', wrapHandler(async ({ baselineId, skillId, format } = {}) =>
    leaderboardService.exportLeaderboard({ baselineId, skillId, format }),
  ))
}
