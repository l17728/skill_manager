'use strict'

const workspaceService = require('../services/workspace-service')
const logService = require('../services/log-service')

function ok(data)  { return { success: true, data } }
function err(code, message) { return { success: false, error: { code, message } } }

/**
 * Wrap a handler function with standard error handling.
 * All IPC errors are logged here centrally so no individual handler needs to repeat it.
 */
function wrapHandler(fn) {
  return async (event, args) => {
    try {
      const result = await fn(args || {})
      return ok(result)
    } catch (e) {
      const code    = e.code    || 'INTERNAL_ERROR'
      const message = e.message || String(e)
      logService.error('ipc', `Handler error [${code}]`, {
        message,
        args: args ? JSON.stringify(args).slice(0, 200) : undefined,
        stack: e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : undefined,
      })
      return err(code, message)
    }
  }
}

module.exports = { ok, err, wrapHandler }
