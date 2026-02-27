'use strict'

/**
 * cli-service.test.js
 * TDD Test Cases: UC4-1 through UC4-4
 *
 * Uses jest.mock('child_process') + jest.resetModules() to test the CLI engine
 * without requiring a real Claude installation.
 *
 * IMPORTANT: childProcess and cliService must be required AFTER jest.resetModules()
 * so they share the same mock instance.
 */

jest.mock('child_process')

const { EventEmitter } = require('events')
const path = require('path')
const os = require('os')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')

// ─── Mock helpers ──────────────────────────────────────────────────────────

/**
 * Create a mock process that simulates child_process.spawn behavior.
 */
function makeMockProc({ stdoutData = '', stderrData = '', exitCode = 0, delay = 5, errorEvent = null, neverClose = false } = {}) {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  // Mock stdin so invokeCli/invokeCliResume can call proc.stdin.write/end/on
  proc.stdin = { write: jest.fn(), end: jest.fn(), on: jest.fn() }

  // Always add a no-op error handler to prevent unhandled-error crashes
  // if a timer fires after the test-added listener is gone.
  proc.on('error', () => {})

  proc.kill = jest.fn(() => {
    // Simulate OS behavior: killed process emits close
    setImmediate(() => proc.emit('close', null))
  })

  if (!neverClose) {
    setTimeout(() => {
      if (errorEvent) {
        const err = Object.assign(new Error(errorEvent.message || 'spawn error'), errorEvent)
        proc.emit('error', err)
      } else {
        if (stdoutData) proc.stdout.emit('data', stdoutData)
        if (stderrData) proc.stderr.emit('data', stderrData)
        proc.emit('close', exitCode)
      }
    }, delay)
  }

  return proc
}

// ─── Module setup ──────────────────────────────────────────────────────────
// MUST get childProcess and cliService from the SAME module cache session
// (after jest.resetModules()) so that spawn mock is shared.

let childProcess
let cliService
let workspaceService
let tmpDir, cleanup, restoreWorkspace

beforeAll(() => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  jest.resetModules()
  // After resetModules, re-require to get fresh mock instances
  childProcess = require('child_process')
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)
  cliService = require('../../main/services/cli-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

beforeEach(() => {
  childProcess.spawn.mockReset()
})

// ─── UC4-1: CLI Availability Detection ────────────────────────────────────

describe('UC4-1: checkAvailable', () => {
  test('returns available:true when CLI responds with version string', async () => {
    const proc = makeMockProc({ stdoutData: 'Claude CLI 1.2.3\n' })
    childProcess.spawn.mockReturnValueOnce(proc)

    const result = await cliService.checkAvailable()

    expect(result.available).toBe(true)
    expect(result.cliVersion).toMatch(/\d+\.\d+\.\d+/)
    expect(childProcess.spawn).toHaveBeenCalledWith(
      expect.any(String),
      ['--version'],
      expect.objectContaining({ shell: expect.any(Boolean) })
    )
  })

  test('returns available:false when CLI binary is missing (ENOENT)', async () => {
    const proc = makeMockProc({ errorEvent: { code: 'ENOENT' } })
    childProcess.spawn.mockReturnValueOnce(proc)

    const result = await cliService.checkAvailable()

    expect(result.available).toBe(false)
  })

  test('returns available:false when stdout has no version number', async () => {
    const proc = makeMockProc({ stdoutData: 'no version here', exitCode: 0 })
    childProcess.spawn.mockReturnValueOnce(proc)

    const result = await cliService.checkAvailable()

    expect(result.available).toBe(false)
  })
})

// ─── UC4-2: Single-round conversation with structured result ──────────────

describe('UC4-2: invokeCli returns standard structured result', () => {
  const validResponse = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    session_id: 'sess_abc123',
    result: 'Hello from model',
    cost_usd: 0.001,
  })

  test('resolves with result, session_id, duration_ms on success', async () => {
    const proc = makeMockProc({ stdoutData: validResponse })
    childProcess.spawn.mockReturnValueOnce(proc)

    const result = await cliService.invokeCli('test prompt', {
      model: 'claude-opus-4-6',
      workingDir: tmpDir,
    })

    expect(result.result).toBe('Hello from model')
    expect(result.session_id).toBe('sess_abc123')
    expect(result.duration_ms).toBe(1234)
    expect(result.is_error).toBe(false)
  })

  test('passes --print --output-format json --model args to spawn; prompt via stdin', async () => {
    const proc = makeMockProc({ stdoutData: validResponse })
    childProcess.spawn.mockReturnValueOnce(proc)

    await cliService.invokeCli('my prompt', {
      model: 'claude-opus-4-6',
      workingDir: tmpDir,
    })

    const [_cmd, args, spawnOpts] = childProcess.spawn.mock.calls[0]
    expect(args).toContain('--print')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    expect(args).toContain('--model')
    expect(args).toContain('claude-opus-4-6')
    // Required for non-interactive Electron spawn (no TTY for permission prompts)
    expect(args).toContain('--dangerously-skip-permissions')
    // Prompt is sent via stdin, NOT as a positional arg
    expect(args).not.toContain('my prompt')
    expect(proc.stdin.write).toHaveBeenCalledWith('my prompt', 'utf8')
    // CLAUDECODE must be stripped to allow nesting inside a Claude Code session
    expect(spawnOpts.env).toBeDefined()
    expect(spawnOpts.env.CLAUDECODE).toBeUndefined()
    // On Windows, shell:true is required to resolve .cmd files (PATHEXT)
    if (process.platform === 'win32') {
      expect(spawnOpts.shell).toBe(true)
    }
  })

  test('passes --system-prompt when provided', async () => {
    const proc = makeMockProc({ stdoutData: validResponse })
    childProcess.spawn.mockReturnValueOnce(proc)

    await cliService.invokeCli('user input', {
      model: 'claude-opus-4-6',
      systemPrompt: 'You are a helper',
      workingDir: tmpDir,
    })

    const [_cmd, args] = childProcess.spawn.mock.calls[0]
    expect(args).toContain('--system-prompt')
    expect(args).toContain('You are a helper')
  })

  test('rejects with CLI_EXECUTION_ERROR on non-zero exit code', async () => {
    const proc = makeMockProc({ exitCode: 1, stderrData: 'some error output' })
    childProcess.spawn.mockReturnValueOnce(proc)

    await expect(
      cliService.invokeCli('test', { model: 'claude-opus-4-6', workingDir: tmpDir })
    ).rejects.toMatchObject({ code: 'CLI_EXECUTION_ERROR' })
  })

  test('rejects with RATE_LIMITED when stderr contains rate limit', async () => {
    const proc = makeMockProc({ exitCode: 1, stderrData: 'Error: rate limit exceeded (429)' })
    childProcess.spawn.mockReturnValueOnce(proc)

    await expect(
      cliService.invokeCli('test', { model: 'claude-opus-4-6', workingDir: tmpDir })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  test('rejects with CLI_OUTPUT_PARSE_ERROR on non-JSON stdout', async () => {
    const proc = makeMockProc({ stdoutData: 'not valid json here', exitCode: 0 })
    childProcess.spawn.mockReturnValueOnce(proc)

    await expect(
      cliService.invokeCli('test', { model: 'claude-opus-4-6', workingDir: tmpDir })
    ).rejects.toMatchObject({ code: 'CLI_OUTPUT_PARSE_ERROR' })
  })

  test('rejects with CLI_NOT_AVAILABLE on ENOENT error', async () => {
    const proc = makeMockProc({ errorEvent: { code: 'ENOENT' } })
    childProcess.spawn.mockReturnValueOnce(proc)

    await expect(
      cliService.invokeCli('test', { model: 'claude-opus-4-6', workingDir: tmpDir })
    ).rejects.toMatchObject({ code: 'CLI_NOT_AVAILABLE' })
  })
})

// ─── UC4-3: Timeout auto-terminates process ───────────────────────────────

describe('UC4-3: timeout kills process and rejects with CLI_TIMEOUT', () => {
  test('rejects with CLI_TIMEOUT after timeoutMs elapses', async () => {
    // neverClose=true: proc never emits 'close' on its own — only when kill() is called
    const proc = makeMockProc({ neverClose: true })
    childProcess.spawn.mockReturnValueOnce(proc)

    await expect(
      cliService.invokeCli('slow prompt', {
        model: 'claude-opus-4-6',
        workingDir: tmpDir,
        timeoutMs: 60,  // short timeout for testing
      })
    ).rejects.toMatchObject({ code: 'CLI_TIMEOUT' })

    expect(proc.kill).toHaveBeenCalled()
  }, 3000)

  test('resolves normally when response arrives before timeout', async () => {
    const resp = JSON.stringify({
      type: 'result', is_error: false, result: 'fast', session_id: 's', duration_ms: 10,
    })
    const proc = makeMockProc({ stdoutData: resp, delay: 5 })
    childProcess.spawn.mockReturnValueOnce(proc)

    const result = await cliService.invokeCli('fast prompt', {
      model: 'claude-opus-4-6',
      workingDir: tmpDir,
      timeoutMs: 5000,
    })

    expect(result.result).toBe('fast')
  })
})

// ─── UC4-4: Session isolation via working directory ───────────────────────

describe('UC4-4: different projects use isolated sessions (different cwd)', () => {
  test('each invokeCli call uses its own workingDir as cwd', async () => {
    const resp = JSON.stringify({
      type: 'result', is_error: false, result: 'ok', session_id: 's1', duration_ms: 100,
    })

    const proc1 = makeMockProc({ stdoutData: resp })
    const proc2 = makeMockProc({ stdoutData: resp })
    childProcess.spawn
      .mockReturnValueOnce(proc1)
      .mockReturnValueOnce(proc2)

    const dirA = path.join(tmpDir, 'project_session_A')
    const dirB = path.join(tmpDir, 'project_session_B')

    await cliService.invokeCli('prompt', { model: 'claude-opus-4-6', workingDir: dirA })
    await cliService.invokeCli('prompt', { model: 'claude-opus-4-6', workingDir: dirB })

    const calls = childProcess.spawn.mock.calls
    expect(calls[0][2].cwd).toBe(dirA)
    expect(calls[1][2].cwd).toBe(dirB)
  })

  test('invokeCliResume passes --resume sessionId in args', async () => {
    const resp = JSON.stringify({
      type: 'result', is_error: false, result: 'compressed', session_id: 'sess_resume', duration_ms: 200,
    })
    const proc = makeMockProc({ stdoutData: resp })
    childProcess.spawn.mockReturnValueOnce(proc)

    const result = await cliService.invokeCliResume('compress this', 'sess_resume', {
      workingDir: tmpDir,
    })

    const [_cmd, args] = childProcess.spawn.mock.calls[0]
    expect(args).toContain('--resume')
    expect(args).toContain('sess_resume')
    expect(result.result).toBe('compressed')
  })
})

// ─── parseStructuredOutput ────────────────────────────────────────────────

describe('parseStructuredOutput', () => {
  test('parses valid JSON directly', () => {
    const result = cliService.parseStructuredOutput('{"tags":["a","b"]}')
    expect(result.tags).toEqual(['a', 'b'])
  })

  test('extracts JSON from markdown code block', () => {
    const raw = '```json\n{"tags":["x"]}\n```'
    expect(cliService.parseStructuredOutput(raw).tags).toEqual(['x'])
  })

  test('extracts first { } block from mixed text', () => {
    const raw = 'some prefix {"scores":{"total":85}} suffix'
    expect(cliService.parseStructuredOutput(raw).scores.total).toBe(85)
  })

  test('throws OUTPUT_PARSE_FAILED when all strategies fail', () => {
    expect(() => cliService.parseStructuredOutput('completely invalid')).toThrow()
  })
})
