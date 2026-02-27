'use strict'

/**
 * app-launcher.js
 *
 * Launches the Electron app with:
 *   --remote-debugging-port=<CDP_PORT>   enables Playwright CDP connection
 *   --workspace=<dir>                    points app at an isolated test workspace
 *
 * Usage:
 *   const { launchApp, CDP_PORT } = require('./app-launcher')
 *   const app = await launchApp(workspaceDir)
 *   // ... connect Playwright, run tests ...
 *   await app.close()
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

const CDP_PORT = 9222
const ROOT_DIR = path.join(__dirname, '../../../')

/**
 * Launch the Electron app and wait until the CDP endpoint is available.
 * @param {string} workspaceDir  Absolute path to the test workspace directory
 * @returns {Promise<{ close(): Promise<void> }>}
 */
async function launchApp(workspaceDir) {
  // require('electron') returns the absolute path to the electron binary
  const electronPath = require('electron')
  const startedAt = Date.now()

  // Before spawning, wait for the port to be free in case a previous instance
  // hasn't released it yet (common on Windows where sockets linger after exit).
  await _waitForPortFree(CDP_PORT, 8000)

  console.log(`[app-launcher] Launching Electron — workspace: ${workspaceDir}`)
  console.log(`[app-launcher] Electron binary: ${electronPath}`)

  const proc = spawn(
    electronPath,
    [
      ROOT_DIR,
      `--remote-debugging-port=${CDP_PORT}`,
      `--workspace=${workspaceDir}`,
      // Suppress sandbox on CI / headless environments
      '--no-sandbox',
      '--disable-gpu',
    ],
    {
      cwd: ROOT_DIR,
      detached: false,
      stdio: 'pipe',
      // Do NOT use shell:true here — electronPath is an absolute .exe path on Windows,
      // no PATHEXT resolution needed
    }
  )

  proc.on('error', (err) => {
    console.error(`[app-launcher] Electron spawn error: ${err.message}`)
  })

  proc.on('exit', (code, signal) => {
    console.log(`[app-launcher] Electron exited — code: ${code}, signal: ${signal}`)
  })

  // Pipe stderr/stdout so test output isn't swallowed silently
  proc.stdout.on('data', (d) => process.stdout.write(`[electron] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[electron] ${d}`))

  // Wait for CDP endpoint to become available (max 20s)
  await _waitForCdp(CDP_PORT, 20000)
  console.log(`[app-launcher] CDP ready on port ${CDP_PORT} — startup took ${Date.now() - startedAt}ms`)

  return {
    /** Terminate the Electron process and wait for it to exit. */
    async close() {
      console.log('[app-launcher] Closing Electron...')
      return new Promise((resolve) => {
        // If Electron already exited (e.g. browser.close() killed it), resolve immediately.
        if (proc.exitCode !== null || proc.killed) {
          console.log(`[app-launcher] Electron already exited (code: ${proc.exitCode}), skipping SIGTERM.`)
          resolve()
          return
        }

        const onExit = () => {
          console.log('[app-launcher] Electron closed.')
          resolve()
        }
        proc.once('exit', onExit)

        try {
          proc.kill('SIGTERM')
        } catch (e) {
          console.warn(`[app-launcher] SIGTERM failed: ${e.message}`)
        }

        // Force-kill after 3s if SIGTERM is not enough; then resolve regardless
        setTimeout(() => {
          try { proc.kill('SIGKILL') } catch (_) {}
          proc.removeListener('exit', onExit)
          resolve()
        }, 3000)
      })
    },
  }
}

/**
 * Poll by attempting an actual bind() until the port becomes bindable.
 *
 * Why not connect()? On Windows, a port in TIME_WAIT state:
 *   - Rejects connect() with ECONNREFUSED  → looks "free" to connect-based checks
 *   - Rejects bind()   with EADDRINUSE     → Electron still can't start its CDP server
 *
 * The only reliable way to know Electron *can* bind is to try binding ourselves.
 */
async function _waitForPortFree(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const bindable = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))        // EADDRINUSE → not yet free
      server.once('listening', () => {
        server.close(() => resolve(true))               // bound successfully → free
      })
      server.listen(port, '127.0.0.1')
    })
    if (bindable) return
    await new Promise((r) => setTimeout(r, 200))
  }
  console.warn(`[app-launcher] Port ${port} still in use after ${timeoutMs}ms, proceeding anyway`)
}

/**
 * Poll http://localhost:<port>/json/version until it responds or times out.
 */
async function _waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`)
      if (res.ok) return
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  throw new Error(
    `CDP not available on port ${port} after ${timeoutMs}ms. ` +
    `Last error: ${lastErr ? lastErr.message : 'unknown'}`
  )
}

module.exports = { launchApp, CDP_PORT }
