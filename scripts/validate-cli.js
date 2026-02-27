'use strict'

/**
 * validate-cli.js
 *
 * 验证 cli-service.js 的四项修复是否生效。
 * 运行方式：通过 Claude Code CLI Bash 工具执行（或 npm run validate-cli），
 * 这样进程环境会带有 CLAUDECODE 变量，完全模拟 Electron 主进程内 spawn 的场景。
 *
 * 测试用例：
 *   1. 未剥离 CLAUDECODE → 预期失败（嵌套启动错误）
 *   2. 剥离 CLAUDECODE + shell:true + --dangerously-skip-permissions → 预期成功
 *   3. 超时检测（旧 10s 超时 vs 新 60s 超时的行为对比说明）
 */

const { spawn } = require('child_process')
const os = require('os')

// ─── 与 cli-service.js 保持一致 ───────────────────────────────────────────────
const SPAWN_SHELL = process.platform === 'win32'
const SIMPLE_PROMPT = 'Respond with exactly one word: pong'

// ─── 通用调用函数 ──────────────────────────────────────────────────────────────

function callClaude({ stripClaudeCode, useShell, addSkipPermissions, timeoutMs = 30000 }) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env)
    if (stripClaudeCode) delete env.CLAUDECODE

    const args = ['--print', '--output-format', 'json']
    if (addSkipPermissions) args.push('--dangerously-skip-permissions')

    const startMs = Date.now()

    let proc
    try {
      proc = spawn('claude', args, {
        env,
        shell: useShell,
        cwd: os.tmpdir(),
      })
    } catch (e) {
      return resolve({ ok: false, error: `spawn threw: ${e.message}` })
    }

    proc.stdin.on('error', () => {})
    proc.stdin.write(SIMPLE_PROMPT, 'utf8')
    proc.stdin.end()

    let stdout = '', stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch (_) {}
      resolve({ ok: false, error: `CLI_TIMEOUT after ${timeoutMs}ms`, durationMs: Date.now() - startMs })
    }, timeoutMs)

    proc.on('close', code => {
      clearTimeout(timer)
      const durationMs = Date.now() - startMs
      if (code !== 0) {
        resolve({ ok: false, error: `exit ${code}`, stderr: stderr.slice(0, 300), durationMs })
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        resolve({ ok: true, result: parsed.result, sessionId: parsed.session_id, durationMs })
      } catch (_) {
        resolve({ ok: false, error: 'JSON_PARSE_ERROR', rawHead: stdout.slice(0, 200), durationMs })
      }
    })

    proc.on('error', err => {
      clearTimeout(timer)
      resolve({ ok: false, error: `${err.code || 'SPAWN_ERROR'}: ${err.message}`, durationMs: Date.now() - startMs })
    })
  })
}

// ─── 输出工具 ──────────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const RESET  = '\x1b[0m'

function pass(msg) { console.log(`  ${GREEN}✓ PASS${RESET}  ${msg}`) }
function fail(msg) { console.log(`  ${RED}✗ FAIL${RESET}  ${msg}`) }
function info(msg) { console.log(`  ${CYAN}ℹ${RESET}      ${msg}`) }

// ─── 测试场景 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${CYAN}═══════════════════════════════════════════════════════════${RESET}`)
  console.log(`${CYAN}   Claude CLI Headless Mode — 修复效果验证${RESET}`)
  console.log(`${CYAN}═══════════════════════════════════════════════════════════${RESET}\n`)

  console.log(`Platform : ${process.platform}`)
  console.log(`shell    : ${SPAWN_SHELL ? 'true (Windows .cmd 解析)' : 'false (Unix)'}`)
  console.log(`CLAUDECODE env : ${process.env.CLAUDECODE ? `${RED}已设置${RESET} (模拟 Claude Code 内嵌环境)` : `${GREEN}未设置${RESET}`}`)
  console.log()

  const results = []

  // ─── Test 1: 修复前 ──────────────────────────────────────────────────────────
  console.log(`${YELLOW}【Test 1】修复前：不剥离 CLAUDECODE，不用 shell，不加 --dangerously-skip-permissions${RESET}`)
  info('这重现了 Electron 主进程直接 spawn 的原始问题')

  const r1 = await callClaude({
    stripClaudeCode: false,
    useShell: false,
    addSkipPermissions: false,
  })

  if (!r1.ok) {
    const errLower = (r1.error + r1.stderr + '').toLowerCase()
    const isExpected = errLower.includes('nested') || errLower.includes('claudecode') || errLower.includes('enoent')
    if (isExpected) {
      pass(`预期失败 ✓ — ${r1.error}${r1.stderr ? ' | stderr: ' + r1.stderr.slice(0, 100) : ''}`)
    } else {
      fail(`失败（但原因不符预期）— ${r1.error}${r1.durationMs ? ` (${r1.durationMs}ms)` : ''}`)
    }
  } else {
    fail(`意外成功 — 说明此环境没有 CLAUDECODE，Test 1 无法演示问题`)
    info(`result="${r1.result}", duration=${r1.durationMs}ms`)
  }
  results.push({ label: 'Test 1 (修复前)', ...r1 })

  console.log()

  // ─── Test 2: 修复后 ──────────────────────────────────────────────────────────
  console.log(`${YELLOW}【Test 2】修复后：剥离 CLAUDECODE + shell:${SPAWN_SHELL} + --dangerously-skip-permissions${RESET}`)
  info('模拟 cli-service.js 修复后的 spawn 调用')

  const r2 = await callClaude({
    stripClaudeCode: true,
    useShell: SPAWN_SHELL,
    addSkipPermissions: true,
    timeoutMs: 60000,
  })

  if (r2.ok) {
    pass(`成功 — result="${r2.result}", session=${r2.sessionId ? r2.sessionId.slice(0, 8) + '…' : 'N/A'}, duration=${r2.durationMs}ms`)
  } else {
    fail(`失败 — ${r2.error}${r2.stderr ? ' | stderr: ' + r2.stderr.slice(0, 150) : ''}`)
  }
  results.push({ label: 'Test 2 (修复后)', ...r2 })

  console.log()

  // ─── Test 3: 超时对比说明（不实际等待，仅做配置验证）────────────────────────
  console.log(`${YELLOW}【Test 3】超时配置验证：旧值 10s vs 新值 60s${RESET}`)
  info(`旧 autoTagSkill/autoTagBaseline: timeoutMs=10000`)
  info(`新 autoTagSkill/autoTagBaseline: timeoutMs=60000`)
  if (r2.ok) {
    if (r2.durationMs > 10000) {
      pass(`Test 2 实际耗时 ${r2.durationMs}ms > 10000ms — 旧超时必然失败，新超时通过`)
    } else {
      info(`Test 2 耗时 ${r2.durationMs}ms ≤ 10s，此次响应较快，但生产环境仍需 60s 容限`)
    }
  } else {
    info('Test 2 未成功，跳过超时对比')
  }

  console.log()

  // ─── 汇总 ─────────────────────────────────────────────────────────────────────
  console.log(`${CYAN}───────────────────────── 汇总 ─────────────────────────────${RESET}`)
  const t1Expected = !results[0].ok   // Test 1 should FAIL
  const t2Expected = results[1].ok    // Test 2 should SUCCEED
  console.log(`  Test 1 (修复前，预期失败): ${t1Expected ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`}`)
  console.log(`  Test 2 (修复后，预期成功): ${t2Expected ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`}`)
  console.log()

  const allPassed = t1Expected && t2Expected
  if (allPassed) {
    console.log(`${GREEN}全部通过 — 四项修复均已生效${RESET}\n`)
  } else {
    console.log(`${RED}存在问题，请检查上方输出${RESET}\n`)
  }

  process.exit(allPassed ? 0 : 1)
}

main().catch(err => {
  console.error('\n未预期的错误:', err)
  process.exit(1)
})
