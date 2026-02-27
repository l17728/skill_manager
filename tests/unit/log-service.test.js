'use strict'

/**
 * log-service.test.js
 * Tests for session lifecycle, idempotent endSession, and workspace isolation.
 * Covers fixes for:
 *   - Problem 3: SIGTERM/SIGINT — endSession idempotency prevents duplicate log entries
 *   - Problem 2: test pollution — verify logs go to overridden tmp workspace
 */

const fs = require('fs')
const path = require('path')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let workspaceService, logService
let tmpDir, cleanup, restoreWorkspace

beforeAll(() => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)
  logService = require('../../main/services/log-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

// ─── Session lifecycle ────────────────────────────────────────────────────────

describe('session lifecycle', () => {
  test('startSession creates a timestamped .jsonl file with Session started entry', () => {
    const sessionFile = logService.startSession({ testMeta: 'lifecycle' })

    expect(sessionFile).toMatch(/\.jsonl$/)
    expect(fs.existsSync(sessionFile)).toBe(true)

    const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n').filter(Boolean)
    const entry = JSON.parse(lines[0])
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('Session started')
    expect(entry.module).toBe('system')
    expect(entry.detail.testMeta).toBe('lifecycle')
    expect(entry.detail.pid).toBe(process.pid)
    expect(logService.currentSessionFile()).toBe(sessionFile)
  })

  test('log() writes to the active session file', () => {
    const sessionFile = logService.currentSessionFile()
    logService.info('test-module', 'hello world', { key: 'val' })

    const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1])
    expect(last.level).toBe('info')
    expect(last.module).toBe('test-module')
    expect(last.message).toBe('hello world')
    expect(last.detail.key).toBe('val')
  })

  test('endSession writes Session ended entry with reason and clears currentSessionFile', () => {
    const sessionFile = logService.currentSessionFile()
    logService.endSession('test-shutdown')

    const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1])
    expect(last.message).toBe('Session ended')
    expect(last.detail.reason).toBe('test-shutdown')
    expect(last.detail.pid).toBe(process.pid)
    expect(logService.currentSessionFile()).toBeNull()
  })
})

// ─── endSession idempotency (Problem 3 fix) ──────────────────────────────────

describe('endSession idempotency', () => {
  test('second endSession call is a no-op — no new content written to any log file', () => {
    const sessionFile = logService.startSession({ scenario: 'idempotent' })
    logService.endSession('first')

    // Snapshot all log file sizes after first (legitimate) endSession
    const logsDir = path.join(tmpDir, 'logs')
    const filesBefore = fs.readdirSync(logsDir)
    const sizesBefore = {}
    for (const f of filesBefore) {
      sizesBefore[f] = fs.statSync(path.join(logsDir, f)).size
    }

    // Second call — should be a no-op since _sessionFile is null
    logService.endSession('second')

    const filesAfter = fs.readdirSync(logsDir)
    expect(filesAfter.length).toBe(filesBefore.length)  // no new files
    for (const f of filesBefore) {
      const sizeAfter = fs.statSync(path.join(logsDir, f)).size
      expect(sizeAfter).toBe(sizesBefore[f])  // no extra bytes written
    }
  })

  test('SIGTERM scenario: signal handler + will-quit both call endSession — only one entry written', () => {
    const sessionFile = logService.startSession({ scenario: 'sigterm-double-end' })
    // Count lines already in this file (may include entries from earlier tests in same second)
    const lineCountAfterStart = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n').filter(Boolean).length

    // Simulate SIGTERM handler calling endSession first
    logService.endSession('sigterm')
    expect(logService.currentSessionFile()).toBeNull()

    // Simulate app.on('will-quit') calling endSession again — should be no-op
    logService.endSession('normal')

    // Only examine lines written by THIS test (after startSession)
    const allLines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n').filter(Boolean)
    const testLines = allLines.slice(lineCountAfterStart)
    const endedEntries = testLines.map(l => JSON.parse(l)).filter(e => e.message === 'Session ended')
    expect(endedEntries).toHaveLength(1)
    expect(endedEntries[0].detail.reason).toBe('sigterm')
  })
})

// ─── Workspace isolation (Problem 2 fix) ─────────────────────────────────────

describe('workspace isolation', () => {
  test('log files are written to the overridden tmp workspace, not the real workspace', () => {
    logService.startSession({ context: 'isolation-test' })
    logService.info('isolation', 'message goes to tmp workspace')
    logService.endSession('test')

    const logsInTmp = fs.readdirSync(path.join(tmpDir, 'logs')).filter(f => f.endsWith('.jsonl'))
    expect(logsInTmp.length).toBeGreaterThan(0)

    // Real workspace/logs should NOT contain these test entries
    // (we can verify the tmp dir is separate from real workspace)
    const realWorkspaceLogs = path.join(__dirname, '../../workspace/logs')
    if (fs.existsSync(realWorkspaceLogs)) {
      const realFiles = fs.readdirSync(realWorkspaceLogs).filter(f => f.endsWith('.jsonl'))
      // None of the real log files should be the same as tmp log files
      for (const f of logsInTmp) {
        expect(realFiles).not.toContain(f)
      }
    }
  })
})
