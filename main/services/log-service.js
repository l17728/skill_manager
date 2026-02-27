'use strict'

const path = require('path')
const fs = require('fs')
const workspaceService = require('./workspace-service')

// Active session log file path — set by startSession(), null until then.
let _sessionFile = null

/** Resolve the logs directory (lazy, supports test workspace overrides). */
function _logDir() {
  return workspaceService.paths.logs()
}

/**
 * Start a new log session.
 * Creates a timestamped JSONL file and writes the "Session started" entry.
 * Should be called once at app startup, before any other log calls.
 *
 * @param {object} [meta]  Extra metadata to include in the startup entry.
 * @returns {string}       Path to the session log file.
 */
function startSession(meta = {}) {
  const now = new Date()
  const logDir = _logDir()
  fs.mkdirSync(logDir, { recursive: true })

  // Filename: 2026-02-26_17-30-00.jsonl
  const ts = now.toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .slice(0, 19)

  _sessionFile = path.join(logDir, `${ts}.jsonl`)

  _write(_sessionFile, {
    timestamp: now.toISOString(),
    level: 'info',
    module: 'system',
    message: 'Session started',
    detail: {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ...meta,
    },
  })

  return _sessionFile
}

/**
 * Write the "Session ended" entry to the current session log.
 * Should be called on app shutdown.
 *
 * @param {string} [reason]  e.g. 'normal', 'crash', 'sigterm'
 */
function endSession(reason = 'normal') {
  if (!_sessionFile) return  // already ended or never started — no-op
  log('info', 'system', 'Session ended', { reason, pid: process.pid })
  _sessionFile = null
}

// ─── Core log function ────────────────────────────────────────────────────────

/**
 * Append one log entry.
 * Uses the active session file when available; falls back to a daily file
 * if called before startSession() (e.g. during module initialisation).
 */
function log(level, module, message, detail) {
  try {
    const now = new Date()
    // Fall back to daily file if no session has been started yet
    const logFile = _sessionFile
      || path.join(_logDir(), `${now.toISOString().slice(0, 10)}.jsonl`)

    const entry = { timestamp: now.toISOString(), level, module, message }
    if (detail !== undefined) entry.detail = detail

    _write(logFile, entry)
  } catch (_) {
    // Log failures must never crash the app
  }
}

/** Write a single entry to a file, creating parent dirs as needed. */
function _write(filePath, entry) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (_) {}
}

function info(module, message, detail)  { log('info',  module, message, detail) }
function warn(module, message, detail)  { log('warn',  module, message, detail) }
function error(module, message, detail) { log('error', module, message, detail) }

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Query log entries across all session files in the logs directory.
 * Works with both old daily files and new per-session files.
 */
function queryLogs({
  level, module: modFilter, startTime, endTime, keyword,
  page = 1, pageSize = 20,
} = {}) {
  const start = startTime ? new Date(startTime) : null
  const end   = endTime   ? new Date(endTime)   : null

  let files = []
  try {
    files = fs.readdirSync(_logDir())
      .filter(f => f.endsWith('.jsonl'))
      .sort()  // chronological by filename
  } catch (_) {
    return { items: [], total: 0, page, pageSize }
  }

  const entries = []
  for (const file of files) {
    let lines
    try {
      lines = fs.readFileSync(path.join(_logDir(), file), 'utf-8').split('\n').filter(Boolean)
    } catch (_) { continue }

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (level     && entry.level   !== level)      continue
        if (modFilter && entry.module  !== modFilter)  continue
        if (start     && new Date(entry.timestamp) < start) continue
        if (end       && new Date(entry.timestamp) > end)   continue
        if (keyword   && !JSON.stringify(entry).includes(keyword)) continue
        entries.push(entry)
      } catch (_) {}
    }
  }

  const total = entries.length
  const items = entries.slice((page - 1) * pageSize, page * pageSize)
  return { items, total, page, pageSize }
}

/**
 * Return the path of the current session log file (for display purposes).
 */
function currentSessionFile() {
  return _sessionFile
}

module.exports = { startSession, endSession, log, info, warn, error, queryLogs, currentSessionFile }
