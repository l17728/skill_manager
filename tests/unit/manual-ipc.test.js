'use strict'

/**
 * manual-ipc.test.js
 *
 * Unit tests for main/ipc/manual.js:
 *   - getManualPath() returns correct path in dev vs packaged mode
 *   - manual:getContent returns { success:true, data } when file readable
 *   - manual:getContent returns { success:false, error } when file missing
 *   - manual:open calls the createManualWindow factory
 */

// ── Capture ipcMain.handle registrations ─────────────────────────────────────
// Variables referenced inside jest.mock() factory must be prefixed with "mock"
const mockHandlers = {}
let mockIsPackaged = false

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, fn) => { mockHandlers[channel] = fn }),
  },
  app: {
    get isPackaged() { return mockIsPackaged },
  },
}))

// ── Mock fs ───────────────────────────────────────────────────────────────────
const mockReadFileSync = jest.fn()
jest.mock('fs', () => ({
  readFileSync: (...args) => mockReadFileSync(...args),
}))

// ── Mock marked ───────────────────────────────────────────────────────────────
const mockMarkedParse = jest.fn((md) => `<p>${md}</p>`)
jest.mock('marked', () => ({
  marked: { parse: (...args) => mockMarkedParse(...args) },
}))

// ── Load module under test ────────────────────────────────────────────────────
const { getManualPath, registerManualHandlers } = require('../../main/ipc/manual')

const mockCreateManualWindow = jest.fn()
registerManualHandlers(mockCreateManualWindow)

// ─────────────────────────────────────────────────────────────────────────────

describe('getManualPath()', () => {
  const path = require('path')

  afterEach(() => { mockIsPackaged = false })

  test('dev mode: returns path ending with manual.md relative to project root', () => {
    mockIsPackaged = false
    const result = getManualPath()
    expect(result.replace(/\\/g, '/')).toMatch(/manual\.md$/)
    // Should not use resourcesPath in dev mode
    const rp = process.resourcesPath || ''
    if (rp) expect(result).not.toContain(rp)
  })

  test('packaged mode: returns path.join(process.resourcesPath, "manual.md")', () => {
    mockIsPackaged = true
    const orig = process.resourcesPath
    process.resourcesPath = '/fake/resources'
    try {
      expect(getManualPath()).toBe(path.join('/fake/resources', 'manual.md'))
    } finally {
      process.resourcesPath = orig
    }
  })
})

describe('manual:getContent handler', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset()
    mockMarkedParse.mockReset()
    mockMarkedParse.mockImplementation((md) => `<p>${md}</p>`)
  })

  test('success: returns { success:true, data } when file is readable', async () => {
    mockReadFileSync.mockReturnValue('# Hello\nWorld')
    const result = await mockHandlers['manual:getContent']()
    expect(result).toEqual({ success: true, data: '<p># Hello\nWorld</p>' })
    expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringMatching(/manual\.md$/), 'utf-8')
    expect(mockMarkedParse).toHaveBeenCalledWith('# Hello\nWorld')
  })

  test('error: returns { success:false, error } when file not found (ENOENT)', async () => {
    const err = new Error('ENOENT: no such file or directory, open \'/path/manual.md\'')
    mockReadFileSync.mockImplementation(() => { throw err })
    const result = await mockHandlers['manual:getContent']()
    expect(result).toEqual({ success: false, error: err.message })
    expect(mockMarkedParse).not.toHaveBeenCalled()
  })

  test('error: returns { success:false, error } for any fs read failure', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('EACCES: permission denied') })
    const result = await mockHandlers['manual:getContent']()
    expect(result.success).toBe(false)
    expect(result.error).toContain('EACCES')
  })
})

describe('manual:open handler', () => {
  beforeEach(() => { mockCreateManualWindow.mockReset() })

  test('calls createManualWindow()', async () => {
    await mockHandlers['manual:open']()
    expect(mockCreateManualWindow).toHaveBeenCalledTimes(1)
  })
})
