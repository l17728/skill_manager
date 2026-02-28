'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { registerAllHandlers } = require('./ipc/index')
const workspaceService = require('./services/workspace-service')
const logService = require('./services/log-service')

// Disable GPU hardware acceleration to prevent silent renderer crashes on
// systems with incompatible GPU drivers (common on Windows 11 with Electron 28).
app.disableHardwareAcceleration()

// Enforce single-instance: if another instance is already running, focus it
// and quit this one. Without this, a zombie process from a prior crash can
// make the second launch appear to "do nothing".
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

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

// ─── Second-instance handler ─────────────────────────────────────────────────

app.on('second-instance', () => {
  // A second instance was launched — focus the existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.moveTop()
  }
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
    backgroundColor: '#1a1a2e',  // dark background to avoid white flash
  })

  // Fallback: if ready-to-show never fires (e.g. renderer hangs), show the
  // window after 15 s so the user at least sees *something* instead of silence.
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      logService.warn('main', 'ready-to-show did not fire within 15s — forcing window show')
      mainWindow.show()
    }
  }, 15000)

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback)
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
  if (wsArg) {
    // E2E test mode: use the provided temp directory
    workspaceService.setWorkspace(wsArg.slice('--workspace='.length))
  } else if (app.isPackaged) {
    // Production (packaged .exe): the ASAR archive is read-only, so the default
    // path (__dirname/../../workspace) would point inside app.asar and every
    // mkdirSync / writeFileSync call would throw ENOTDIR.
    // Use app.getPath('userData') instead — always writable on Windows:
    //   C:\Users\<user>\AppData\Roaming\SkillManager\workspace
    workspaceService.setWorkspace(path.join(app.getPath('userData'), 'workspace'))
  }
  // Dev mode: workspace/ at project root (default in workspace-service.js) — leave as-is.

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
