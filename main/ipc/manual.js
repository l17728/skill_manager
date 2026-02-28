'use strict'

const fs = require('fs')
const path = require('path')
const { ipcMain, app } = require('electron')
const { marked } = require('marked')

/**
 * Returns the path to manual.md appropriate for dev vs packaged mode.
 * Dev:      <project-root>/manual.md
 * Packaged: <resourcesPath>/manual.md  (copied via extraResources)
 */
function getManualPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'manual.md')
    : path.join(__dirname, '../../manual.md')
}

/**
 * Register IPC handlers for the manual viewer.
 * @param {Function} createManualWindow - factory that opens/focuses the manual BrowserWindow
 */
function registerManualHandlers(createManualWindow) {
  ipcMain.handle('manual:open', () => { createManualWindow() })

  ipcMain.handle('manual:getContent', () => {
    try {
      const md = fs.readFileSync(getManualPath(), 'utf-8')
      return { success: true, data: marked.parse(md) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { getManualPath, registerManualHandlers }
