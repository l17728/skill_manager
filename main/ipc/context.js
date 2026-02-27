'use strict'

/**
 * ipc/context.js — IPC handlers for context auto-management (Module 5).
 *
 * Handles: context:getStatus, context:compress, context:updateConfig
 * Push events: context:warning — emitted when any active session enters warning (≥60%) or
 *   critical (≥80%) risk level. Polled every 15 s so the renderer can prompt the user.
 */

const { ipcMain } = require('electron')
const { wrapHandler } = require('./helpers')
const fileService = require('../services/file-service')
const workspaceService = require('../services/workspace-service')
const contextService = require('../services/context-service')

// Track which sessions have already been warned at each risk tier so we don't
// spam the renderer on every tick. Cleared when a session is compressed.
const _warned = new Set()   // `${sessionId}:${riskLevel}`

module.exports = function registerContextHandlers(mainWindow) {
  // ── Request handlers ──────────────────────────────────────────────────────

  ipcMain.handle('context:getStatus', wrapHandler(async () => {
    const sessions = contextService.getContextStatus()
    return { sessions }
  }))

  ipcMain.handle('context:compress', wrapHandler(async ({ sessionId }) => {
    const result = await contextService.compressContext(sessionId)
    // After compression clear the warning dedup state so future warnings fire again
    _warned.delete(`${sessionId}:warning`)
    _warned.delete(`${sessionId}:critical`)
    // Notify renderer that compression happened
    if (mainWindow && !mainWindow.isDestroyed()) {
      const sessions = contextService.getContextStatus()
      const s = sessions.find(x => x.sessionId === sessionId)
      mainWindow.webContents.send('context:warning', {
        sessionId,
        estimatedTokens: result.tokensAfter,
        threshold: s ? s.threshold : 0,
        usagePercent: s ? s.usagePercent : 0,
        autoActionTaken: 'compress',
      })
    }
    return result
  }))

  ipcMain.handle('context:updateConfig', wrapHandler(async ({ projectId, changes }) => {
    if (projectId) {
      // Per-project config (not implemented in Phase 2, reserved for Phase 3)
      // For now fall through to global update
    }
    const configPath = workspaceService.paths.cliConfig()
    const current = fileService.readJson(configPath) || {}
    const currentCtx = current.context || {}
    current.context = { ...currentCtx, ...changes }
    current.updated_at = new Date().toISOString()
    fileService.writeJson(configPath, current)
    return { updated: true }
  }))

  // ── Periodic context:warning watcher (every 15 s) ─────────────────────────
  // Emits context:warning to the renderer whenever a session reaches warning
  // (≥60%) or critical (≥80%) usage so the UI can prompt the user.

  const _interval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    let sessions
    try {
      sessions = contextService.getContextStatus()
    } catch (_) {
      return
    }

    for (const s of sessions) {
      if (s.riskLevel === 'normal') {
        // Clear dedup state once session is back to normal
        _warned.delete(`${s.sessionId}:warning`)
        _warned.delete(`${s.sessionId}:critical`)
        continue
      }

      const key = `${s.sessionId}:${s.riskLevel}`
      if (_warned.has(key)) continue   // already notified at this tier
      _warned.add(key)

      mainWindow.webContents.send('context:warning', {
        sessionId:       s.sessionId,
        estimatedTokens: s.estimatedTokens,
        threshold:       s.threshold,
        usagePercent:    s.usagePercent,
        autoActionTaken: null,          // warning only; user must trigger compress manually
      })
    }
  }, 15000)

  // Clean up interval when the window is closed to avoid memory leaks
  mainWindow.once('closed', () => clearInterval(_interval))
}
