'use strict'

/**
 * context-ipc.test.js
 *
 * Unit tests for the context:warning push-event watcher in main/ipc/context.js.
 *
 * Behaviours tested:
 *   - Emits context:warning when a session reaches warning or critical tier
 *   - Dedup via _warned Set — same session+tier fires only once
 *   - _warned cleared when riskLevel drops to 'normal', allowing re-fire
 *   - Warning → critical upgrade fires a second (distinct) notification
 *   - No emission when the window is destroyed
 *   - Post-compress: _warned cleared + context:warning sent with autoActionTaken:'compress'
 *   - Interval cleared on window 'closed' event
 */

jest.useFakeTimers()

// ── Mock electron (must be before any require of context.js) ─────────────────
const _ipcHandlers = {}
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, fn) => { _ipcHandlers[channel] = fn }),
  },
}))

// ── Mock services ─────────────────────────────────────────────────────────────
const mockGetContextStatus = jest.fn().mockReturnValue([])
const mockCompressContext  = jest.fn()

jest.mock('../../main/services/context-service', () => ({
  getContextStatus: mockGetContextStatus,
  compressContext:  mockCompressContext,
}))
jest.mock('../../main/services/file-service', () => ({
  readJson:  jest.fn(() => ({})),
  writeJson: jest.fn(),
}))
jest.mock('../../main/services/workspace-service', () => ({
  paths: { cliConfig: () => '/tmp/test-config.json' },
}))
jest.mock('../../main/services/log-service', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}))

// ── Load the IPC module under test ────────────────────────────────────────────
const registerContextHandlers = require('../../main/ipc/context')

// ── Window factory ────────────────────────────────────────────────────────────
function makeWindow() {
  const closedListeners = []
  const send = jest.fn()
  return {
    isDestroyed: jest.fn(() => false),
    webContents: { send },
    once: (evt, fn) => { if (evt === 'closed') closedListeners.push(fn) },
    _emit: (evt) => { if (evt === 'closed') closedListeners.forEach(fn => fn()) },
    _send: send,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared window: registered once in beforeAll.
// Each test uses a *unique* sessionId so _warned state never crosses tests.
// ─────────────────────────────────────────────────────────────────────────────
let win

beforeAll(() => {
  win = makeWindow()
  registerContextHandlers(win)
})

afterAll(() => {
  win._emit('closed')       // clears the interval
  jest.clearAllTimers()
})

beforeEach(() => {
  win._send.mockClear()
  mockGetContextStatus.mockReset().mockReturnValue([])
  mockCompressContext.mockReset()
})

// ── 1. Basic emission ─────────────────────────────────────────────────────────

test('emits context:warning on first warning tick', () => {
  mockGetContextStatus.mockReturnValue([
    { sessionId: 'w1', riskLevel: 'warning', estimatedTokens: 60000, threshold: 80000, usagePercent: 75 },
  ])

  jest.advanceTimersByTime(15000)

  expect(win._send).toHaveBeenCalledTimes(1)
  expect(win._send).toHaveBeenCalledWith('context:warning', {
    sessionId:       'w1',
    estimatedTokens: 60000,
    threshold:       80000,
    usagePercent:    75,
    autoActionTaken: null,
  })
})

// ── 2. Dedup ──────────────────────────────────────────────────────────────────

test('dedup — same session+tier does not fire twice', () => {
  mockGetContextStatus.mockReturnValue([
    { sessionId: 'w2', riskLevel: 'warning', estimatedTokens: 61000, threshold: 80000, usagePercent: 76 },
  ])

  jest.advanceTimersByTime(15000)   // first tick  → fires
  jest.advanceTimersByTime(15000)   // second tick → deduplicated

  expect(win._send).toHaveBeenCalledTimes(1)
})

// ── 3. Reset after normal ──────────────────────────────────────────────────────

test('fires again after riskLevel drops to normal and rises again', () => {
  // Tick 1 — warning fires
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'w3', riskLevel: 'warning', estimatedTokens: 62000, threshold: 80000, usagePercent: 77 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(1)

  // Tick 2 — normal → dedup cleared, no emission
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'w3', riskLevel: 'normal', estimatedTokens: 30000, threshold: 80000, usagePercent: 37 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(1)   // still 1

  // Tick 3 — warning again → fires once more
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'w3', riskLevel: 'warning', estimatedTokens: 63000, threshold: 80000, usagePercent: 78 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(2)
})

// ── 4. Warning → critical upgrade ─────────────────────────────────────────────

test('warning→critical upgrade fires a second notification', () => {
  // Tick 1 — warning
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'w4', riskLevel: 'warning', estimatedTokens: 65000, threshold: 80000, usagePercent: 81 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(1)

  // Tick 2 — critical (different key in _warned)
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'w4', riskLevel: 'critical', estimatedTokens: 73000, threshold: 80000, usagePercent: 91 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(2)
  expect(win._send).toHaveBeenLastCalledWith('context:warning', expect.objectContaining({
    sessionId:    'w4',
    usagePercent: 91,
  }))
})

// ── 5. Window destroyed ───────────────────────────────────────────────────────

test('does not emit when window.isDestroyed() returns true', () => {
  win.isDestroyed.mockReturnValueOnce(true)
  mockGetContextStatus.mockReturnValue([
    { sessionId: 'w5', riskLevel: 'warning', estimatedTokens: 60000, threshold: 80000, usagePercent: 75 },
  ])

  jest.advanceTimersByTime(15000)
  expect(win._send).not.toHaveBeenCalled()

  // Restore for later tests
  win.isDestroyed.mockReturnValue(false)
})

// ── 6. Post-compress notification ────────────────────────────────────────────

test('compress handler clears _warned and sends context:warning with autoActionTaken:compress', async () => {
  // First, put session 'wc' into the _warned set by firing a warning
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'wc', riskLevel: 'warning', estimatedTokens: 66000, threshold: 80000, usagePercent: 82 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(1)   // warning fired

  // Set up compress mock
  mockCompressContext.mockResolvedValue({ tokensAfter: 35000 })
  mockGetContextStatus.mockReturnValue([
    { sessionId: 'wc', riskLevel: 'warning', estimatedTokens: 35000, threshold: 80000, usagePercent: 43 },
  ])

  // Invoke compress handler directly (wrapHandler passes (event, args))
  const compressHandler = _ipcHandlers['context:compress']
  expect(compressHandler).toBeDefined()
  await compressHandler({}, { sessionId: 'wc' })

  // Should send the post-compress context:warning
  expect(win._send).toHaveBeenCalledTimes(2)
  expect(win._send).toHaveBeenLastCalledWith('context:warning', expect.objectContaining({
    sessionId:       'wc',
    autoActionTaken: 'compress',
  }))

  // _warned should be cleared: next watcher tick should fire again
  win._send.mockClear()
  mockGetContextStatus.mockReturnValueOnce([
    { sessionId: 'wc', riskLevel: 'warning', estimatedTokens: 67000, threshold: 80000, usagePercent: 83 },
  ])
  jest.advanceTimersByTime(15000)
  expect(win._send).toHaveBeenCalledTimes(1)   // fires again after compress cleared _warned
})

// ── 7. Interval cleared on 'closed' ──────────────────────────────────────────
// NOTE: this test re-calls registerContextHandlers() which overwrites _ipcHandlers,
// so it must run last to avoid polluting earlier handler-invocation tests.

test('clearInterval is called when window emits "closed"', () => {
  const clearSpy = jest.spyOn(global, 'clearInterval')
  // Use a fresh window so the closed listener belongs to it
  const w2 = makeWindow()
  registerContextHandlers(w2)
  w2._emit('closed')
  expect(clearSpy).toHaveBeenCalled()
  clearSpy.mockRestore()
})
