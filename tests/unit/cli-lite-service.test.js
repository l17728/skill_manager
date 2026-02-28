'use strict'

/**
 * cli-lite-service.test.js
 *
 * Tests for generateBaselineCases() in cli-lite-service.js.
 *
 * Because cli-lite-service.js imports invokeCli via:
 *   const invokeCli = cliService.invokeCli
 * (assigned at require-time), jest.spyOn cannot intercept later calls.
 * The only reliable approach is to mock 'child_process' at module level so
 * that the spawn() inside cli-service.js is controlled by the test.
 */

jest.mock('child_process')

const { EventEmitter } = require('events')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build a fake spawn process that emits stdout/close or an error after a delay.
 * Mirrors the helper in purpose-suggestion.test.js.
 */
function makeMockProc({ stdoutData = '', exitCode = 0, delay = 5, errorEvent = null } = {}) {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: jest.fn(), end: jest.fn(), on: jest.fn() }
  proc.kill = jest.fn()
  proc.on('error', () => {}) // prevent unhandled-error crash

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

/**
 * Wrap model text in the JSON envelope that invokeCli expects from the Claude CLI.
 */
function cliResponse(modelText) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 100,
    result: modelText,
  })
}

// ─── Module setup ─────────────────────────────────────────────────────────────

let tmpDir, cleanup, restoreWorkspace
let cliLiteService, childProcess

beforeAll(() => {
  const tmp = createTmpDir('cli-lite-svc-')
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  childProcess = require('child_process')

  const ws = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(ws, tmpDir)

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

// ─── generateBaselineCases ────────────────────────────────────────────────────

const SAMPLE_CASES = [
  {
    name: '基础加法',
    category: 'standard',
    input: '实现两数之和函数，返回a+b的结果',
    expected_output: '函数正确返回两个数之和',
    description: '标准正常输入测试',
  },
  {
    name: '零值边界',
    category: 'boundary',
    input: '输入a=0, b=0',
    expected_output: '返回0',
    description: '边界值零测试',
  },
]

describe('generateBaselineCases', () => {
  test('success: returns cases array and rawOutput on valid CLI response', async () => {
    childProcess.spawn.mockReturnValueOnce(makeMockProc({
      stdoutData: cliResponse(JSON.stringify({ cases: SAMPLE_CASES })),
    }))

    const result = await cliLiteService.generateBaselineCases('实现Python排序函数', 2)

    expect(Array.isArray(result.cases)).toBe(true)
    expect(result.cases).toHaveLength(2)
    expect(result.cases[0].name).toBe('基础加法')
    expect(result.cases[0].category).toBe('standard')
    expect(typeof result.rawOutput).toBe('string')
    expect(result.rawOutput.length).toBeGreaterThan(0)
  })

  test('CLI_NOT_AVAILABLE: rethrows with code and generateBaselineCases context prefix', async () => {
    childProcess.spawn.mockReturnValueOnce(
      makeMockProc({ errorEvent: { code: 'ENOENT', message: 'spawn ENOENT' } })
    )

    await expect(
      cliLiteService.generateBaselineCases('test task description', 5)
    ).rejects.toMatchObject({
      code: 'CLI_NOT_AVAILABLE',
      message: expect.stringContaining('generateBaselineCases'),
    })
  })

  test('CLI_EXECUTION_ERROR: rethrows with structured code on non-zero exit', async () => {
    childProcess.spawn.mockReturnValueOnce(
      makeMockProc({ exitCode: 1, stdoutData: '' })
    )

    await expect(
      cliLiteService.generateBaselineCases('test task description', 5)
    ).rejects.toMatchObject({
      code: 'CLI_EXECUTION_ERROR',
      message: expect.stringContaining('generateBaselineCases'),
    })
  })

  test('OUTPUT_PARSE_FAILED: throws when CLI response has no cases field', async () => {
    childProcess.spawn.mockReturnValueOnce(makeMockProc({
      stdoutData: cliResponse(JSON.stringify({ status: 'ok', data: [] })),
    }))

    await expect(
      cliLiteService.generateBaselineCases('test task description', 5)
    ).rejects.toMatchObject({ code: 'OUTPUT_PARSE_FAILED' })
  })

  test('uses the provided model argument when specified', async () => {
    childProcess.spawn.mockReturnValueOnce(makeMockProc({
      stdoutData: cliResponse(JSON.stringify({ cases: SAMPLE_CASES })),
    }))

    await cliLiteService.generateBaselineCases('排序函数', 2, 'claude-haiku-4-5-20251001')

    // spawn(cliPath, args, opts) — args is calls[0][1]
    const spawnArgs = childProcess.spawn.mock.calls[0][1]
    expect(spawnArgs).toContain('claude-haiku-4-5-20251001')
  })
})
