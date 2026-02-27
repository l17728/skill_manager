'use strict'

/**
 * ipc/cli.js — IPC handlers for CLI module (Module 4).
 *
 * Handles: cli:checkAvailable, cli:getConfig, cli:updateConfig,
 *          cli:session:list, cli:session:close, cli:session:export
 */

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const fileService = require('../services/file-service')
const workspaceService = require('../services/workspace-service')
const cliService = require('../services/cli-service')
const sessionService = require('../services/session-service')
const cliEvents = require('../services/cli-events')

module.exports = function registerCliHandlers(mainWindow) {
  // ─── Availability & Config ──────────────────────────────────────────────

  ipcMain.handle('cli:checkAvailable', wrapHandler(async () => {
    return cliService.checkAvailable()
  }))

  ipcMain.handle('cli:getConfig', wrapHandler(async () => {
    return fileService.readJson(workspaceService.paths.cliConfig())
  }))

  ipcMain.handle('cli:updateConfig', wrapHandler(async ({ changes }) => {
    const configPath = workspaceService.paths.cliConfig()
    const current = fileService.readJson(configPath) || {}
    const updated = { ...current, ...changes, updated_at: new Date().toISOString() }
    // Handle nested context update
    if (changes.context) {
      updated.context = { ...(current.context || {}), ...changes.context }
    }
    fileService.writeJson(configPath, updated)
    return { updated: true }
  }))

  // ─── Session Management ─────────────────────────────────────────────────

  ipcMain.handle('cli:session:list', wrapHandler(async () => {
    const sessions = sessionService.listSessions()
    return {
      sessions: sessions.map(s => ({
        sessionId:       s.sessionId,
        type:            s.type,
        purpose:         s.purpose,
        projectId:       s.projectId || null,
        createdAt:       s.createdAt,
        estimatedTokens: s.estimatedTokens || 0,
        status:          s.status,
      })),
    }
  }))

  ipcMain.handle('cli:session:close', wrapHandler(async ({ sessionId }) => {
    sessionService.closeSession(sessionId)
    return { closed: true }
  }))

  ipcMain.handle('cli:session:export', wrapHandler(async ({ sessionId, destPath }) => {
    const session = sessionService.getSession(sessionId)
    if (!session) throw { code: 'NOT_FOUND', message: `Session not found: ${sessionId}` }

    const path = require('path')
    const exportPath = path.join(destPath, `session_${sessionId}.json`)
    fileService.ensureDir(destPath)
    fileService.writeJson(exportPath, session)
    return { exportedPath: exportPath }
  }))

  // ─── Push CLI status changes to renderer ───────────────────────────────

  cliEvents.on('status:change', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cli:status:change', data)
    }
  })
}
