'use strict'

/**
 * purpose-suggestion.test.js
 *
 * Tests for:
 *   - workspaceService.getExistingPurposes()
 *   - cliLiteService.suggestPurposeMerge()
 */

jest.mock('child_process')

const { EventEmitter } = require('events')
const path = require('path')
const fs = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

// ─── Mock helpers ───────────────────────────────────────────────────────────

/**
 * Build a fake spawn process that emits structured stdout after a short delay.
 * Both stdout and stdin are mocked so invokeCli can call proc.stdin.write().
 */
function makeMockProc({ stdoutData = '', exitCode = 0, delay = 5, errorEvent = null } = {}) {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: jest.fn(), end: jest.fn(), on: jest.fn() }
  proc.kill = jest.fn()
  proc.on('error', () => {})

  setTimeout(() => {
    if (errorEvent) {
      const err = Object.assign(new Error(errorEvent.message || 'spawn error'), errorEvent)
      proc.emit('error', err)
    } else {
      if (stdoutData) proc.stdout.emit('data', stdoutData)
      proc.emit('close', exitCode)
    }
  }, delay)

  return proc
}

/** Wrap a model response JSON so invokeCli can resolve it. */
function cliResponse(modelText) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 100,
    result: modelText,
  })
}

// ─── Module setup ─────────────────────────────────────────────────────────

let tmpDir, cleanup, restoreWorkspace
let workspaceService, cliLiteService, childProcess

beforeAll(() => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  childProcess = require('child_process')
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)
  cliLiteService = require('../../main/services/cli-lite-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

beforeEach(() => {
  if (childProcess.spawn && childProcess.spawn.mockReset) {
    childProcess.spawn.mockReset()
  }
})

// ─── getExistingPurposes ───────────────────────────────────────────────────

describe('getExistingPurposes', () => {
  test('returns empty array when no skills exist', () => {
    const purposes = workspaceService.getExistingPurposes('skill')
    expect(Array.isArray(purposes)).toBe(true)
    expect(purposes).toHaveLength(0)
  })

  test('returns purpose names from skills directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'skills', 'code_generate'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'skills', 'code_review'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'skills', 'doc_write'), { recursive: true })

    const purposes = workspaceService.getExistingPurposes('skill')
    expect(purposes).toContain('code_generate')
    expect(purposes).toContain('code_review')
    expect(purposes).toContain('doc_write')
    expect(purposes).toHaveLength(3)
  })

  test('defaults to skill type when no arg provided', () => {
    const purposes = workspaceService.getExistingPurposes()
    expect(Array.isArray(purposes)).toBe(true)
  })

  test('returns empty array for baseline type when no baselines exist', () => {
    const purposes = workspaceService.getExistingPurposes('baseline')
    expect(Array.isArray(purposes)).toBe(true)
    expect(purposes).toHaveLength(0)
  })

  test('returns baseline purposes from baselines directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'baselines', 'code_test'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'baselines', 'integration_test'), { recursive: true })

    const purposes = workspaceService.getExistingPurposes('baseline')
    expect(purposes).toContain('code_test')
    expect(purposes).toContain('integration_test')
    expect(purposes).toHaveLength(2)
  })
})

// ─── suggestPurposeMerge ──────────────────────────────────────────────────

describe('suggestPurposeMerge', () => {
  test('returns shouldMerge=false immediately when no existing purposes', async () => {
    const result = await cliLiteService.suggestPurposeMerge('code_generate', [])
    expect(result.shouldMerge).toBe(false)
    expect(result.suggestedPurpose).toBeNull()
    // Should NOT call Claude at all
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  test('returns shouldMerge=false immediately when existingPurposes is null', async () => {
    const result = await cliLiteService.suggestPurposeMerge('code_generate', null)
    expect(result.shouldMerge).toBe(false)
    expect(result.suggestedPurpose).toBeNull()
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  test('returns merge suggestion when Claude recommends merging', async () => {
    childProcess.spawn.mockReturnValueOnce(makeMockProc({
      stdoutData: cliResponse(JSON.stringify({
        should_merge: true,
        suggested_purpose: 'code_generate',
        reason: '新 purpose "code_generation" 与已有 "code_generate" 语义高度重合，建议合并。',
      })),
    }))

    const result = await cliLiteService.suggestPurposeMerge(
      'code_generation',
      ['code_generate', 'code_review'],
    )

    expect(result.shouldMerge).toBe(true)
    expect(result.suggestedPurpose).toBe('code_generate')
    expect(result.reason).toMatch(/code_generation|code_generate|合并/)
  })

  test('returns shouldMerge=false when Claude recommends keeping new purpose', async () => {
    childProcess.spawn.mockReturnValueOnce(makeMockProc({
      stdoutData: cliResponse(JSON.stringify({
        should_merge: false,
        suggested_purpose: null,
        reason: '新 purpose "unit_test_generation" 侧重于生成单元测试，与现有分类语义差异明显，建议保留。',
      })),
    }))

    const result = await cliLiteService.suggestPurposeMerge(
      'unit_test_generation',
      ['code_generate', 'code_review'],
    )

    expect(result.shouldMerge).toBe(false)
    expect(result.suggestedPurpose).toBeNull()
    expect(result.reason).toBeTruthy()
  })

  test('returns shouldMerge=false when CLI is unavailable (ENOENT)', async () => {
    childProcess.spawn
      .mockReturnValueOnce(makeMockProc({ errorEvent: { code: 'ENOENT', message: 'spawn ENOENT' } }))

    const result = await cliLiteService.suggestPurposeMerge('code_generate', ['code_review'])
    expect(result.shouldMerge).toBe(false)
    expect(result.suggestedPurpose).toBeNull()
  })

  test('returns shouldMerge=false when CLI exits with non-zero code', async () => {
    childProcess.spawn
      .mockReturnValueOnce(makeMockProc({ stdoutData: 'Claude CLI 1.2.3\n' }))
      .mockReturnValueOnce(makeMockProc({ exitCode: 1, stdoutData: '' }))

    const result = await cliLiteService.suggestPurposeMerge('code_generate', ['code_review'])
    expect(result.shouldMerge).toBe(false)
  })

  test('returns shouldMerge=false when CLI returns unparseable output', async () => {
    childProcess.spawn
      .mockReturnValueOnce(makeMockProc({ stdoutData: 'Claude CLI 1.2.3\n' }))
      .mockReturnValueOnce(makeMockProc({
        stdoutData: cliResponse('Sorry, I cannot process this request.'),
      }))

    const result = await cliLiteService.suggestPurposeMerge('code_generate', ['code_review'])
    expect(result.shouldMerge).toBe(false)
  })
})
