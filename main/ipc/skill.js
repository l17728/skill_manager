'use strict'

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const skillService = require('../services/skill-service')
const workspaceService = require('../services/workspace-service')
const cliLiteService = require('../services/cli-lite-service')

module.exports = function registerSkillHandlers(mainWindow) {
  ipcMain.handle('skill:import', wrapHandler(async (args) => {
    return skillService.importSkill(args)
  }))

  ipcMain.handle('skill:list', wrapHandler(async (args) => {
    return skillService.listSkills(args)
  }))

  ipcMain.handle('skill:get', wrapHandler(async ({ skillId }) => {
    return skillService.getSkill(skillId)
  }))

  ipcMain.handle('skill:update', wrapHandler(async (args) => {
    return skillService.updateSkill(args)
  }))

  ipcMain.handle('skill:delete', wrapHandler(async ({ skillId }) => {
    return skillService.deleteSkill(skillId)
  }))

  ipcMain.handle('skill:search', wrapHandler(async (args) => {
    return skillService.searchSkills(args)
  }))

  ipcMain.handle('skill:tag:add', wrapHandler(async ({ skillId, value }) => {
    return skillService.addTag(skillId, value)
  }))

  ipcMain.handle('skill:tag:remove', wrapHandler(async ({ skillId, tagId, tagType }) => {
    return skillService.removeTag(skillId, tagId, tagType)
  }))

  ipcMain.handle('skill:tag:update', wrapHandler(async ({ skillId, tagId, tagType, newValue }) => {
    return skillService.updateTagValue(skillId, tagId, tagType, newValue)
  }))

  ipcMain.handle('skill:autoTag:trigger', wrapHandler(async ({ skillId }) => {
    const { taskId, runTag } = await skillService.triggerAutoTag(skillId, 'user')
    // Run async in background, push event on completion
    runTag().then(result => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('autoTag:progress:update', {
          taskId,
          targetType: 'skill',
          targetId: skillId,
          status: result.status,
          result: result.status === 'completed' ? {
            parsedTags: result.parsedTags.map(v => ({ value: v })),
            pendingCount: result.parsedTags.length,
          } : undefined,
          error: result.status === 'failed' ? 'Auto-tag failed' : undefined,
        })
      }
    }).catch(() => {})
    return { taskId }
  }))

  ipcMain.handle('skill:autoTag:triggerBatch', wrapHandler(async ({ skillIds }) => {
    const batchId = `batch_${Date.now()}`
    const totalCount = skillIds.length
    // Run async in background
    skillService.triggerAutoTagBatch(skillIds).then(({ results }) => {
      for (const res of results) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('autoTag:progress:update', {
            taskId: res.taskId,
            batchId,
            targetType: 'skill',
            targetId: res.skillId,
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
    return { batchId, totalCount }
  }))

  ipcMain.handle('skill:autoTag:review', wrapHandler(async ({ skillId, reviews }) => {
    return skillService.reviewAutoTags(skillId, reviews)
  }))

  ipcMain.handle('skill:version:list', wrapHandler(async ({ skillId }) => {
    return skillService.listVersions(skillId)
  }))

  ipcMain.handle('skill:version:diff', wrapHandler(async ({ skillId, fromVersion, toVersion }) => {
    return skillService.getDiff(skillId, fromVersion, toVersion)
  }))

  ipcMain.handle('skill:version:rollback', wrapHandler(async ({ skillId, targetVersion }) => {
    return skillService.rollbackVersion(skillId, targetVersion)
  }))

  ipcMain.handle('skill:purpose:suggest', wrapHandler(async ({ newPurpose }) => {
    const existingPurposes = workspaceService.getExistingPurposes('skill')
    return cliLiteService.suggestPurposeMerge(newPurpose, existingPurposes)
  }))
}
