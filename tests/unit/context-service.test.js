'use strict'

/**
 * context-service.test.js
 * TDD Test Cases: UC5-1 through UC5-5
 *
 * Tests token estimation, context export, compression, and auto-compress logic.
 * Uses real session-service (file-backed) with workspace override.
 * Mocks cliService.invokeCliResume via jest.spyOn to avoid real CLI calls.
 */

const path = require('path')
const fs = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

let tmpDir, cleanup, restoreWorkspace
let contextService, sessionService, cliService

beforeAll(() => {
  const tmp = createTmpDir('ctx-test-')
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

  // Load services in dependency order (workspace already patched)
  sessionService = require('../../main/services/session-service')
  cliService = require('../../main/services/cli-service')
  contextService = require('../../main/services/context-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── estimateTokens (pure) ─────────────────────────────────────────────────

describe('estimateTokens', () => {
  test('returns 0 for empty string', () => {
    expect(contextService.estimateTokens('')).toBe(0)
    expect(contextService.estimateTokens(null)).toBe(0)
  })

  test('estimates English text: ~4 chars/token', () => {
    const text = 'a'.repeat(400)  // 400 chars → 100 tokens
    expect(contextService.estimateTokens(text)).toBe(100)
  })

  test('estimates Chinese text: ~1.5 chars/token', () => {
    const text = '的'.repeat(300)  // 300 Chinese chars → ceil(300/1.5) = 200 tokens
    expect(contextService.estimateTokens(text)).toBe(200)
  })

  test('handles mixed Chinese + English', () => {
    const result = contextService.estimateTokens('你好world')
    expect(result).toBeGreaterThan(0)
  })
})

// ─── getRiskLevel ─────────────────────────────────────────────────────────

describe('getRiskLevel', () => {
  const threshold = 80000

  test('normal when usage < 60%', () => {
    expect(contextService.getRiskLevel(0, threshold)).toBe('normal')
    expect(contextService.getRiskLevel(40000, threshold)).toBe('normal')  // 50%
    expect(contextService.getRiskLevel(47999, threshold)).toBe('normal')  // 59.9%
  })

  test('warning when usage is 60% to < 80%', () => {
    expect(contextService.getRiskLevel(48000, threshold)).toBe('warning')  // exactly 60%
    expect(contextService.getRiskLevel(60000, threshold)).toBe('warning')  // 75%
    expect(contextService.getRiskLevel(63999, threshold)).toBe('warning')  // 79.9%
  })

  test('critical when usage >= 80%', () => {
    expect(contextService.getRiskLevel(64000, threshold)).toBe('critical')  // exactly 80%
    expect(contextService.getRiskLevel(80000, threshold)).toBe('critical')  // 100%
    expect(contextService.getRiskLevel(100000, threshold)).toBe('critical') // overflow
  })
})

// ─── UC5-1: Threshold hit → auto context save triggered ───────────────────

describe('UC5-1: threshold triggers auto-compress', () => {
  test('action=compressed when projected tokens exceed 80% threshold', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-1' })
    // 63000 tokens = 78.75% of 80000 threshold
    sessionService.updateSession(session.sessionId, { estimatedTokens: 63000 })

    // Mock CLI resume (called inside compressContext)
    jest.spyOn(cliService, 'invokeCliResume').mockResolvedValueOnce({
      type: 'result',
      is_error: false,
      result: 'short summary',
      session_id: session.sessionId,
      duration_ms: 300,
    })

    // 63000 + 3000 = 66000 = 82.5% → critical → compress
    const result = await contextService.checkAndAutoCompress(session.sessionId, 3000)

    expect(result.action).toBe('compressed')
    expect(result.exportedFilePath).toBeTruthy()
    expect(fs.existsSync(result.exportedFilePath)).toBe(true)
    expect(cliService.invokeCliResume).toHaveBeenCalled()
  })

  test('action=none when projected tokens are below 80% threshold', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-1b' })
    sessionService.updateSession(session.sessionId, { estimatedTokens: 10000 })

    const resumeSpy = jest.spyOn(cliService, 'invokeCliResume')

    // 10000 + 5000 = 15000 → 18.75% → normal
    const result = await contextService.checkAndAutoCompress(session.sessionId, 5000)

    expect(result.action).toBe('none')
    expect(result.estimatedTokens).toBe(15000)
    expect(resumeSpy).not.toHaveBeenCalled()
  })
})

// ─── UC5-2: Auto-generate context MD file ────────────────────────────────

describe('UC5-2: exportContext generates .md file', () => {
  test('exports context text to logs directory as .md file', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-2' })
    const contextText = '# Session Context\n\nSome test results here.\n'

    const exportedPath = await contextService.exportContext(
      session.sessionId,
      null,  // no projectId → use global logs
      contextText
    )

    expect(exportedPath).toMatch(/context_export_\d+\.md$/)
    expect(fs.existsSync(exportedPath)).toBe(true)
    const content = fs.readFileSync(exportedPath, 'utf-8')
    expect(content).toBe(contextText)
  })

  test('records export in session.contextExports', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-2b' })
    const exportedPath = await contextService.exportContext(
      session.sessionId, null, 'context content'
    )

    const updated = sessionService.getSession(session.sessionId)
    expect(updated.contextExports).toHaveLength(1)
    expect(updated.contextExports[0].path).toBe(exportedPath)
    expect(updated.contextExports[0].exportedAt).toBeTruthy()
  })

  test('multiple exports accumulate in session.contextExports', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-2c' })
    await contextService.exportContext(session.sessionId, null, 'export 1')
    await contextService.exportContext(session.sessionId, null, 'export 2')

    const updated = sessionService.getSession(session.sessionId)
    expect(updated.contextExports).toHaveLength(2)
  })

  test('generates default content when no contextText provided', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-2d' })
    const exportedPath = await contextService.exportContext(session.sessionId, null, null)

    expect(fs.existsSync(exportedPath)).toBe(true)
    const content = fs.readFileSync(exportedPath, 'utf-8')
    expect(content).toContain(session.sessionId)
  })
})

// ─── UC5-3: Compression significantly reduces context size ───────────────

describe('UC5-3: compressContext reduces token count', () => {
  test('tokensAfter is less than tokensBefore after compression', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-3' })
    const longText = 'a'.repeat(2000)  // ~500 tokens
    sessionService.updateSession(session.sessionId, {
      estimatedTokens: contextService.estimateTokens(longText),
    })

    // Mock CLI resume to return a short summary
    jest.spyOn(cliService, 'invokeCliResume').mockResolvedValueOnce({
      type: 'result',
      is_error: false,
      result: 'Short.',  // ~2 tokens
      session_id: session.sessionId,
      duration_ms: 500,
    })

    const result = await contextService.compressContext(session.sessionId, {
      contextText: longText,
      workingDir: tmpDir,
    })

    expect(result.tokensBefore).toBeGreaterThan(0)
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore)
    expect(result.exportedFilePath).toBeTruthy()
    expect(cliService.invokeCliResume).toHaveBeenCalledWith(
      expect.any(String),
      session.sessionId,
      expect.objectContaining({ workingDir: tmpDir })
    )
  })

  test('session estimatedTokens is updated to compressed value', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-3b' })
    sessionService.updateSession(session.sessionId, { estimatedTokens: 10000 })

    jest.spyOn(cliService, 'invokeCliResume').mockResolvedValueOnce({
      type: 'result',
      is_error: false,
      result: 'Hi',  // 1 token
      session_id: session.sessionId,
      duration_ms: 200,
    })

    await contextService.compressContext(session.sessionId, {
      contextText: 'big context',
      workingDir: tmpDir,
    })

    const updated = sessionService.getSession(session.sessionId)
    expect(updated.estimatedTokens).toBeLessThan(10)  // 'Hi' → ~1 token
  })
})

// ─── UC5-4: After compression, testing can continue ──────────────────────

describe('UC5-4: after compression, normal operations continue', () => {
  test('session remains active after compression with reduced token count', async () => {
    const session = sessionService.createSession({ type: 'project', purpose: 'test-uc5-4' })
    sessionService.updateSession(session.sessionId, { estimatedTokens: 70000 })

    jest.spyOn(cliService, 'invokeCliResume').mockResolvedValueOnce({
      type: 'result',
      is_error: false,
      result: 'Compressed context summary',
      session_id: session.sessionId,
      duration_ms: 300,
    })

    await contextService.compressContext(session.sessionId, {
      contextText: 'large context',
      workingDir: tmpDir,
    })

    const updated = sessionService.getSession(session.sessionId)
    expect(updated.status).toBe('active')
    expect(updated.estimatedTokens).toBeLessThan(70000)
  })

  test('checkAndAutoCompress returns none when well below threshold', async () => {
    const session = sessionService.createSession({ type: 'project', purpose: 'test-uc5-4b' })
    sessionService.updateSession(session.sessionId, { estimatedTokens: 5000 })

    const result = await contextService.checkAndAutoCompress(session.sessionId, 1000)

    expect(result.action).toBe('none')
    expect(result.estimatedTokens).toBe(6000)
  })
})

// ─── UC5-5: Temp session auto-compress doesn't affect tag generation ──────

describe('UC5-5: temp session compress + tag generation', () => {
  test('exportContext on a temp session writes to global logs', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'auto-tag' })

    const exportPath = await contextService.exportContext(
      session.sessionId,
      null,  // temp sessions have no projectId
      'tag context'
    )

    // Should be in global logs dir (tmpDir/logs/)
    expect(exportPath).toContain(path.join(tmpDir, 'logs'))
    expect(fs.existsSync(exportPath)).toBe(true)
  })

  test('compress failure is non-fatal: exportedFilePath is still returned', async () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-5' })
    sessionService.updateSession(session.sessionId, { estimatedTokens: 1000 })

    // Simulate CLI failure during compression
    jest.spyOn(cliService, 'invokeCliResume').mockRejectedValueOnce({ code: 'CLI_TIMEOUT' })

    const result = await contextService.compressContext(session.sessionId, {
      contextText: 'some context',
      workingDir: tmpDir,
    })

    // Even though CLI failed, export file should exist
    expect(result.exportedFilePath).toBeTruthy()
    expect(fs.existsSync(result.exportedFilePath)).toBe(true)
    expect(result.tokensBefore).toBeGreaterThanOrEqual(0)
  })

  test('getContextStatus reports session risk level correctly', () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'test-uc5-5c' })
    // 70000 / 80000 = 87.5% → critical
    sessionService.updateSession(session.sessionId, { estimatedTokens: 70000 })

    const statuses = contextService.getContextStatus()
    const sessionStatus = statuses.find(s => s.sessionId === session.sessionId)

    expect(sessionStatus).toBeTruthy()
    expect(sessionStatus.estimatedTokens).toBe(70000)
    expect(sessionStatus.threshold).toBe(80000)
    expect(sessionStatus.riskLevel).toBe('critical')
    expect(sessionStatus.usagePercent).toBe(88)
  })
})

// ─── session-service basics ───────────────────────────────────────────────

describe('session-service: createSession / getSession / closeSession', () => {
  test('createSession stores session and returns sessionId', () => {
    const session = sessionService.createSession({ type: 'project', purpose: 'testing' })
    expect(session.sessionId).toMatch(/^sess_/)
    expect(session.status).toBe('active')
    expect(session.estimatedTokens).toBe(0)
  })

  test('getSession retrieves stored session', () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'get-test' })
    const retrieved = sessionService.getSession(session.sessionId)
    expect(retrieved.sessionId).toBe(session.sessionId)
    expect(retrieved.purpose).toBe('get-test')
  })

  test('updateSession mutates session fields', () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'update-test' })
    sessionService.updateSession(session.sessionId, { estimatedTokens: 1234 })
    const updated = sessionService.getSession(session.sessionId)
    expect(updated.estimatedTokens).toBe(1234)
  })

  test('closeSession marks session as closed', () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'close-test' })
    sessionService.closeSession(session.sessionId)
    const closed = sessionService.getSession(session.sessionId)
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toBeTruthy()
  })

  test('cleanExpiredSessions marks old temp sessions as expired', () => {
    const session = sessionService.createSession({ type: 'temp', purpose: 'expire-test' })
    // Manually set createdAt to 8 days ago (beyond 7-day TTL)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    sessionService.updateSession(session.sessionId, { createdAt: eightDaysAgo })

    const cleaned = sessionService.cleanExpiredSessions()
    expect(cleaned).toBeGreaterThan(0)

    const expired = sessionService.getSession(session.sessionId)
    expect(expired.status).toBe('expired')
  })
})
