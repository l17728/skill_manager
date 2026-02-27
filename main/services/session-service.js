'use strict'

/**
 * session-service.js — CLI session lifecycle management.
 *
 * Sessions are stored in workspace/cli/sessions.json.
 * In-memory operations are backed by file I/O on every mutation.
 */

const path = require('path')
const fileService = require('./file-service')
const workspaceService = require('./workspace-service')

function sessionsFilePath() {
  return path.join(workspaceService.paths.workspace(), 'cli', 'sessions.json')
}

function loadData() {
  const data = fileService.readJson(sessionsFilePath())
  return data || { sessions: {} }
}

function saveData(data) {
  const filePath = sessionsFilePath()
  fileService.ensureDir(path.dirname(filePath))
  fileService.writeJson(filePath, data)
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

/**
 * Create a new session record.
 * @param {object} opts
 * @param {'project'|'temp'} opts.type
 * @param {string} opts.purpose
 * @param {string|null} [opts.projectId]
 * @returns {object} session
 */
function createSession({ type = 'temp', purpose = '', projectId = null } = {}) {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const session = {
    sessionId,
    type,
    purpose,
    projectId,
    createdAt: new Date().toISOString(),
    estimatedTokens: 0,
    status: 'active',
    contextExports: [],
  }

  const data = loadData()
  data.sessions[sessionId] = session
  saveData(data)
  return session
}

/**
 * Get a session by ID. Returns null if not found.
 */
function getSession(sessionId) {
  const data = loadData()
  return data.sessions[sessionId] || null
}

/**
 * Update fields on an existing session. Returns updated session or null.
 */
function updateSession(sessionId, changes) {
  const data = loadData()
  if (!data.sessions[sessionId]) return null
  Object.assign(data.sessions[sessionId], changes)
  saveData(data)
  return data.sessions[sessionId]
}

/**
 * Mark a session as closed.
 */
function closeSession(sessionId) {
  return updateSession(sessionId, { status: 'closed', closedAt: new Date().toISOString() })
}

/**
 * List all session records (all statuses).
 */
function listSessions() {
  const data = loadData()
  return Object.values(data.sessions)
}

/**
 * Mark temp sessions older than ttl_days as expired.
 * Returns count of sessions cleaned.
 */
function cleanExpiredSessions() {
  const cfg = fileService.readJson(workspaceService.paths.cliConfig()) || {}
  const ttlDays = cfg.temp_session_ttl_days || 7
  const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000

  const data = loadData()
  let cleaned = 0
  for (const session of Object.values(data.sessions)) {
    if (session.type === 'temp' && session.status === 'active') {
      if (new Date(session.createdAt).getTime() < cutoffMs) {
        session.status = 'expired'
        cleaned++
      }
    }
  }
  saveData(data)
  return cleaned
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  closeSession,
  listSessions,
  cleanExpiredSessions,
}
