'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { registerAllHandlers } = require('./ipc/index')
const workspaceService = require('./services/workspace-service')
const logService = require('./services/log-service')

let mainWindow

// ─── Process-level error handlers (must be registered as early as possible) ──

process.on('uncaughtException', (err) => {
  logService.error('main', 'Uncaught exception — process will exit', {
    message: err.message,
    stack: (err.stack || '').split('\n').slice(0, 8).join(' | '),
  })
  // Give the log a moment to flush before exiting
  setTimeout(() => process.exit(1), 200)
})

process.on('unhandledRejection', (reason) => {
  logService.error('main', 'Unhandled promise rejection', {
    reason: reason instanceof Error
      ? { message: reason.message, stack: (reason.stack || '').split('\n').slice(0, 6).join(' | ') }
      : String(reason),
  })
  // Do NOT exit — unhandledRejection is usually non-fatal in Electron
})

// SIGTERM / SIGINT: write "Session ended" before the process is killed
process.on('SIGTERM', () => {
  logService.endSession('sigterm')
  app.quit()
})
process.on('SIGINT', () => {
  logService.endSession('sigint')
  app.quit()
})

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'Skill Manager',
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
    logService.info('main', 'Window ready and shown')
  })

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Capture renderer errors in the session log
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logService.error('main', 'Renderer process gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    })
    console.error('[RENDERER CRASH]', details)
  })

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // level: 0=verbose, 1=info, 2=warning, 3=error
    if (level === 3) {
      logService.error('renderer', message, { source: sourceId, line })
      console.error(`[RENDERER ERR] ${message} (${sourceId}:${line})`)
    } else if (level === 2) {
      logService.warn('renderer', message, { source: sourceId, line })
    }
  })

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    logService.info('main', 'Window closed')
    mainWindow = null
  })
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Support --workspace=<path> for e2e testing (fresh isolated workspace per test run)
  const wsArg = process.argv.find(a => a.startsWith('--workspace='))
  if (wsArg) workspaceService.setWorkspace(wsArg.slice('--workspace='.length))

  // Start session log first — every subsequent log goes into this file
  workspaceService.initWorkspace()
  const sessionFile = logService.startSession({
    electron: process.versions.electron,
    chrome:   process.versions.chrome,
    workspace: workspaceService.paths.workspace(),
    argv: process.argv.slice(2),
  })
  logService.info('main', 'App starting', { sessionFile })
  // Log workspace override if active (set before initWorkspace via --workspace= flag)
  if (wsArg) {
    logService.info('main', 'Workspace override active (e2e test mode)', {
      workspacePath: workspaceService.paths.workspace(),
    })
  }

  try {
    logService.info('main', 'Workspace initialized', { path: workspaceService.paths.workspace() })
  } catch (e) {
    logService.error('main', 'Workspace init failed', { error: e.message })
  }

  createWindow()
  registerAllHandlers(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Write "Session ended" before the process exits
app.on('will-quit', () => {
  logService.info('main', 'App shutting down')
  logService.endSession('normal')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
