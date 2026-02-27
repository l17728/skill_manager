'use strict'

/**
 * cli-service.js — Full CLI execution engine (Phase 2).
 *
 * Provides:
 *   invokeCli(prompt, options)          — single-shot print mode
 *   invokeCliResume(prompt, sessionId, options) — resume existing session
 *   invokeWithRetry(prompt, options, maxRetries) — retry wrapper
 *   checkAvailable()                    — detect CLI availability
 *   getCliVersion()                     — read version string
 *   parseStructuredOutput(rawResult)    — multi-strategy JSON extraction
 */

const { spawn } = require('child_process')
const fileService = require('./file-service')
const workspaceService = require('./workspace-service')
const logService = require('./log-service')
const cliEvents = require('./cli-events')

// On Windows, npm-global CLIs are installed as .cmd files.
// Node.js spawn without a shell does NOT resolve PATHEXT (.cmd, .bat), so
// 'claude' would fail with ENOENT.  Using shell:true delegates resolution to
// cmd.exe, exactly as if the user typed 'claude' at the prompt.
const SPAWN_SHELL = process.platform === 'win32'

// Last known CLI availability (for change-detection events)
let _lastKnownAvailable = null

// ─── Config ────────────────────────────────────────────────────────────────

function getCliConfig() {
  const cfg = fileService.readJson(workspaceService.paths.cliConfig())
  return cfg || {
    cli_path: 'claude',
    default_model: 'claude-opus-4-6',
    default_timeout_seconds: 60,
    default_retry_count: 2,
  }
}

// ─── Version / Availability ────────────────────────────────────────────────

/**
 * Get CLI version string (e.g. "1.2.0"). Returns "unknown" on failure.
 */
async function getCliVersion() {
  const cfg = getCliConfig()
  const cliPath = cfg.cli_path || 'claude'

  return new Promise((resolve) => {
    const proc = spawn(cliPath, ['--version'], { shell: SPAWN_SHELL })
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { out += d })
    proc.on('close', () => {
      const match = out.match(/\d+\.\d+\.\d+/)
      resolve(match ? match[0] : 'unknown')
    })
    proc.on('error', () => resolve('unknown'))
  })
}

/**
 * Check whether the CLI is available. Emits 'status:change' on state transitions.
 */
async function checkAvailable() {
  try {
    const version = await getCliVersion()
    const available = version !== 'unknown'
    if (_lastKnownAvailable !== available) {
      _lastKnownAvailable = available
      cliEvents.emit('status:change', { available, cliVersion: available ? version : undefined })
    }
    return { available, cliVersion: available ? version : undefined }
  } catch (e) {
    if (_lastKnownAvailable !== false) {
      _lastKnownAvailable = false
      cliEvents.emit('status:change', { available: false })
    }
    return { available: false, errorReason: e.message || String(e) }
  }
}

// ─── Output Parsing ────────────────────────────────────────────────────────

/**
 * Extract structured JSON from a raw CLI result string.
 * Tries three strategies: direct parse → code block → first { }
 */
function parseStructuredOutput(rawResult) {
  // 1. Direct parse
  try { return JSON.parse(rawResult) } catch (_) {}

  // 2. Extract ```json ... ``` block
  const codeBlockMatch = rawResult.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch (_) {}
  }

  // 3. Extract first { to last }
  const jsonMatch = rawResult.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]) } catch (_) {}
  }

  throw { code: 'OUTPUT_PARSE_FAILED', raw: rawResult }
}

// ─── Core invokeCli ────────────────────────────────────────────────────────

/**
 * Execute a single CLI call in print mode.
 *
 * @param {string} prompt
 * @param {object} options
 * @param {string} [options.model]
 * @param {string} [options.systemPrompt]
 * @param {string} [options.workingDir]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<CliResult>}
 */
function invokeCli(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const cfg = getCliConfig()
    const model = options.model || cfg.default_model
    const timeoutMs = options.timeoutMs || cfg.default_timeout_seconds * 1000
    const cliPath = cfg.cli_path || 'claude'

    // Note: prompt is sent via stdin, NOT as a positional arg.
    // This avoids the Windows CreateProcess command-line length limit (~32 KB)
    // and handles all special chars / newlines safely.
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', model,
      '--dangerously-skip-permissions',  // required: non-TTY Electron spawn cannot respond to permission prompts
    ]
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }

    // Strip CLAUDECODE to allow spawning claude from within a Claude Code session
    // (Claude Code sets CLAUDECODE in its own env; child processes that inherit it
    // are refused with "Cannot be launched inside another Claude Code session")
    const spawnEnv = Object.assign({}, process.env)
    delete spawnEnv.CLAUDECODE

    const proc = spawn(cliPath, args, {
      cwd: options.workingDir || workspaceService.paths.cliTempSession(),
      env: spawnEnv,
      shell: SPAWN_SHELL,
    })

    logService.info('cli-service', 'invokeCli start', {
      model,
      promptLen: prompt.length,
      workingDir: options.workingDir || workspaceService.paths.cliTempSession(),
    })

    // Write prompt to stdin and signal EOF so the CLI starts processing
    proc.stdin.on('error', () => {}) // suppress EPIPE if process dies early
    proc.stdin.write(prompt, 'utf8')
    proc.stdin.end()

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    function settle(fn) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        fn()
      }
    }

    // Manual timeout — fires, kills process, then waits for close event
    const timer = setTimeout(() => {
      timedOut = true
      try { proc.kill('SIGTERM') } catch (_) {}
    }, timeoutMs)

    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })

    proc.on('close', (code) => {
      settle(() => {
        if (timedOut) {
          logService.warn('cli-service', 'invokeCli timeout', { model, timeoutMs, promptLen: prompt.length })
          reject({ code: 'CLI_TIMEOUT' })
          return
        }
        if (code !== 0) {
          if (/rate.?limit|429/i.test(stderr)) {
            logService.warn('cli-service', 'invokeCli rate-limited', { model, exitCode: code, stderr: stderr.slice(0, 300) })
            reject({ code: 'RATE_LIMITED', stderr, exitCode: code })
          } else {
            logService.error('cli-service', 'invokeCli execution error', { model, exitCode: code, stderr: stderr.slice(0, 300) })
            reject({ code: 'CLI_EXECUTION_ERROR', stderr, exitCode: code })
          }
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          if (parsed.is_error) {
            logService.error('cli-service', 'invokeCli model error', { model, result: String(parsed.result).slice(0, 200) })
            reject({ code: 'CLI_MODEL_ERROR', message: parsed.result })
          } else {
            logService.info('cli-service', 'invokeCli success', { model, duration_ms: parsed.duration_ms, resultLen: (parsed.result || '').length })
            resolve(parsed)
          }
        } catch (_) {
          logService.error('cli-service', 'invokeCli output parse error', { model, rawLen: stdout.length, rawHead: stdout.slice(0, 200) })
          reject({ code: 'CLI_OUTPUT_PARSE_ERROR', raw: stdout })
        }
      })
    })

    proc.on('error', err => {
      settle(() => {
        if (err.code === 'ENOENT') {
          logService.error('cli-service', 'CLI not found (ENOENT)', { cliPath })
          if (_lastKnownAvailable !== false) {
            _lastKnownAvailable = false
            cliEvents.emit('status:change', { available: false })
          }
          reject({ code: 'CLI_NOT_AVAILABLE' })
        } else {
          logService.error('cli-service', 'invokeCli spawn error', { cliPath, errMsg: err.message })
          reject({ code: 'CLI_EXECUTION_ERROR', message: err.message })
        }
      })
    })
  })
}

// ─── invokeCliResume ────────────────────────────────────────────────────────

/**
 * Resume an existing CLI session and continue the conversation.
 *
 * @param {string} prompt
 * @param {string} sessionId
 * @param {object} options
 * @param {string} [options.workingDir]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<CliResult>}
 */
function invokeCliResume(prompt, sessionId, options = {}) {
  return new Promise((resolve, reject) => {
    const cfg = getCliConfig()
    const timeoutMs = options.timeoutMs || cfg.default_timeout_seconds * 1000
    const cliPath = cfg.cli_path || 'claude'

    // Prompt sent via stdin (same reason as invokeCli: Windows arg-length safety)
    const args = ['--resume', sessionId, '--print', '--output-format', 'json', '--dangerously-skip-permissions']

    const spawnEnv = Object.assign({}, process.env)
    delete spawnEnv.CLAUDECODE

    const proc = spawn(cliPath, args, {
      cwd: options.workingDir || workspaceService.paths.cliTempSession(),
      env: spawnEnv,
      shell: SPAWN_SHELL,
    })

    proc.stdin.on('error', () => {})
    proc.stdin.write(prompt, 'utf8')
    proc.stdin.end()

    let stdout = ''
    let stderr = ''
    let settled = false

    function settle(fn) {
      if (!settled) { settled = true; clearTimeout(timer); fn() }
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch (_) {}
      settle(() => reject({ code: 'CLI_TIMEOUT' }))
    }, timeoutMs)

    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })

    proc.on('close', (code) => {
      settle(() => {
        if (code !== 0) {
          reject({ code: 'CLI_EXECUTION_ERROR', stderr, exitCode: code })
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (_) {
          reject({ code: 'CLI_OUTPUT_PARSE_ERROR', raw: stdout })
        }
      })
    })

    proc.on('error', err => {
      settle(() => {
        if (err.code === 'ENOENT') reject({ code: 'CLI_NOT_AVAILABLE' })
        else reject({ code: 'CLI_EXECUTION_ERROR', message: err.message })
      })
    })
  })
}

// ─── invokeWithRetry ────────────────────────────────────────────────────────

/**
 * Invoke CLI with automatic retry. Rate-limited errors wait 30s before retry.
 *
 * @param {string} prompt
 * @param {object} options — passed to invokeCli
 * @param {number} [maxRetries] — overrides config default
 * @returns {Promise<CliResult>}
 */
async function invokeWithRetry(prompt, options = {}, maxRetries) {
  const cfg = getCliConfig()
  const retries = maxRetries !== undefined ? maxRetries : cfg.default_retry_count

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await invokeCli(prompt, options)
    } catch (err) {
      lastError = err
      if (err.code === 'RATE_LIMITED' && attempt < retries) {
        logService.warn('cli-service', `Rate-limited, waiting 30s before retry ${attempt + 1}/${retries}`, { model: options.model })
        await _sleep(30000)
        continue
      }
      if (attempt < retries) {
        logService.warn('cli-service', `Retrying attempt ${attempt + 1}/${retries}`, { errCode: err.code })
        continue
      }
    }
  }
  logService.error('cli-service', 'invokeWithRetry exhausted all retries', { errCode: lastError && lastError.code })
  throw lastError
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  getCliVersion,
  checkAvailable,
  invokeCli,
  invokeCliResume,
  invokeWithRetry,
  parseStructuredOutput,
}
