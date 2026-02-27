'use strict'

const registerSkillHandlers     = require('./skill')
const registerBaselineHandlers  = require('./baseline')
const registerProjectHandlers   = require('./project')
const registerWorkspaceHandlers = require('./workspace')
const registerCliHandlers       = require('./cli')
const registerContextHandlers   = require('./context')
const registerTestHandlers      = require('./test')
const registerAnalysisHandlers   = require('./analysis')
const registerRecomposeHandlers  = require('./recompose')
const registerIterationHandlers  = require('./iteration')
const registerTraceHandlers      = require('./trace')

/**
 * Register all IPC handlers.
 * @param {BrowserWindow} mainWindow - the main Electron window (for push events)
 */
function registerAllHandlers(mainWindow) {
  registerSkillHandlers(mainWindow)
  registerBaselineHandlers(mainWindow)
  registerProjectHandlers(mainWindow)
  registerWorkspaceHandlers(mainWindow)
  registerCliHandlers(mainWindow)
  registerContextHandlers(mainWindow)
  registerTestHandlers(mainWindow)
  registerAnalysisHandlers(mainWindow)
  registerRecomposeHandlers(mainWindow)
  registerIterationHandlers(mainWindow)
  registerTraceHandlers(mainWindow)
}

module.exports = { registerAllHandlers }
