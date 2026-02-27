'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const baselineService = require('../services/baseline-service')

module.exports = function registerBaselineHandlers(mainWindow) {
  ipcMain.handle('baseline:import', wrapHandler(async (args) => {
    return baselineService.importBaseline(args)
  }))

  ipcMain.handle('baseline:list', wrapHandler(async (args) => {
    return baselineService.listBaselines(args)
  }))

  ipcMain.handle('baseline:get', wrapHandler(async ({ baselineId }) => {
    return baselineService.getBaseline(baselineId)
  }))

  ipcMain.handle('baseline:case:add', wrapHandler(async ({ baselineId, currentVersion, cases }) => {
    return baselineService.addCases(baselineId, currentVersion, cases)
  }))

  ipcMain.handle('baseline:case:update', wrapHandler(async ({ baselineId, currentVersion, caseId, changes }) => {
    return baselineService.updateCase(baselineId, currentVersion, caseId, changes)
  }))

  ipcMain.handle('baseline:case:delete', wrapHandler(async ({ baselineId, currentVersion, caseId }) => {
    return baselineService.deleteCase(baselineId, currentVersion, caseId)
  }))

  ipcMain.handle('baseline:autoTag:trigger', wrapHandler(async ({ baselineId }) => {
    const { taskId, runTag } = await baselineService.triggerAutoTag(baselineId, 'user')
    runTag().then(result => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('autoTag:progress:update', {
          taskId,
          targetType: 'baseline',
          targetId: baselineId,
          status: result.status,
          result: result.status === 'completed' ? {
            parsedTags: (result.parsedTags || []).map(v => ({ value: v })),
            pendingCount: (result.parsedTags || []).length,
          } : undefined,
        })
      }
    }).catch(() => {})
    return { taskId }
  }))

  ipcMain.handle('baseline:autoTag:triggerBatch', wrapHandler(async ({ baselineIds }) => {
    const batchId = `batch_${Date.now()}`
    baselineService.triggerAutoTagBatch(baselineIds).then(({ results }) => {
      for (const res of results) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('autoTag:progress:update', {
            taskId: res.taskId,
            batchId,
            targetType: 'baseline',
            targetId: res.baselineId,
            status: res.status,
            result: res.status === 'completed' ? {
              parsedTags: (res.parsedTags || []).map(v => ({ value: v })),
              pendingCount: (res.parsedTags || []).length,
            } : undefined,
            error: res.error,
          })
        }
      }
    }).catch(() => {})
    return { batchId, totalCount: baselineIds.length }
  }))

  ipcMain.handle('baseline:autoTag:review', wrapHandler(async ({ baselineId, reviews }) => {
    return baselineService.reviewAutoTags(baselineId, reviews)
  }))

  ipcMain.handle('baseline:version:list', wrapHandler(async ({ baselineId }) => {
    return baselineService.listVersions(baselineId)
  }))

  ipcMain.handle('baseline:version:diff', wrapHandler(async ({ baselineId, fromVersion, toVersion }) => {
    return baselineService.getDiff(baselineId, fromVersion, toVersion)
  }))

  ipcMain.handle('baseline:version:rollback', wrapHandler(async ({ baselineId, targetVersion }) => {
    return baselineService.rollbackVersion(baselineId, targetVersion)
  }))
}
