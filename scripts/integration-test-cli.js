'use strict'

/**
 * integration-test-cli.js
 *
 * 集成测试：直接载入 cli-service / cli-lite-service，在当前 Node 进程中
 * （带 CLAUDECODE 环境变量）执行真实 API 调用，验证修复后的完整链路。
 *
 * 测试项：
 *   1. checkAvailable()   — CLI 版本检测
 *   2. invokeCli()        — 单次调用，返回结构化 JSON
 *   3. autoTagSkill()     — 真实 Skill 自动打标签（含 cliLiteService 封装层）
 */

const path = require('path')

// ─── 设置 workspace 到真实目录（非测试临时目录）────────────────────────────────
const workspaceService = require('../main/services/workspace-service')
// workspaceService 已指向 D:\skillmanager\workspace（真实路径）

const cliService  = require('../main/services/cli-service')
const cliLite     = require('../main/services/cli-lite-service')

// ─── 颜色 ─────────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m'
const ok  = (m) => console.log(`  ${G}✓${X} ${m}`)
const err = (m) => console.log(`  ${R}✗${X} ${m}`)
const hdr = (m) => console.log(`\n${Y}【${m}】${X}`)
const inf = (m) => console.log(`  ${C}ℹ${X} ${m}`)

// ─── 测试运行器 ───────────────────────────────────────────────────────────────
async function run(label, fn) {
  process.stdout.write(`  ⏳ ${label} ...`)
  const t = Date.now()
  try {
    const r = await fn()
    const ms = Date.now() - t
    process.stdout.write(`\r`)
    ok(`${label} (${ms}ms)`)
    return { ok: true, result: r, ms }
  } catch (e) {
    const ms = Date.now() - t
    process.stdout.write(`\r`)
    err(`${label} (${ms}ms) — ${e.code || e.message || JSON.stringify(e)}`)
    return { ok: false, error: e, ms }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C}══════════════════════════════════════════════════${X}`)
  console.log(`${C}   Skill Manager — CLI 集成测试${X}`)
  console.log(`${C}══════════════════════════════════════════════════${X}`)
  inf(`CLAUDECODE 环境变量: ${process.env.CLAUDECODE ? `${R}已设置${X}` : `${G}未设置${X}`}`)
  inf(`platform: ${process.platform}, SPAWN_SHELL: ${process.platform === 'win32'}`)

  const results = []

  // ─── 1. CLI 版本检测 ────────────────────────────────────────────────────────
  hdr('Test 1: checkAvailable()')
  const t1 = await run('cliService.checkAvailable()', async () => {
    const r = await cliService.checkAvailable()
    if (!r.available) throw { code: 'CLI_NOT_AVAILABLE', message: r.errorReason }
    inf(`CLI 版本: ${r.cliVersion}`)
    return r
  })
  results.push(t1)

  // ─── 2. 单次 invokeCli 调用 ─────────────────────────────────────────────────
  hdr('Test 2: invokeCli() — 简单指令')
  const t2 = await run('invokeCli("say: pong")', async () => {
    const r = await cliService.invokeCli('Reply with exactly one word: pong', {
      model: 'claude-haiku-4-5-20251001',   // 最快的模型，减少等待
    })
    if (r.is_error) throw { code: 'MODEL_ERROR', message: r.result }
    inf(`result: "${r.result.trim()}", duration_ms: ${r.duration_ms}, session: ${(r.session_id||'').slice(0,8)}…`)
    return r
  })
  results.push(t2)

  // ─── 3. autoTagSkill 完整链路 ───────────────────────────────────────────────
  hdr('Test 3: autoTagSkill() — 端到端自动打标签')
  const sampleContent = `你是一个专业的 Python 代码生成助手。
当用户描述一个编程任务时，你需要：
1. 理解任务需求并生成高质量的 Python 代码
2. 代码必须包含完整的函数定义和注释
3. 对于复杂任务，提供使用示例
4. 确保代码符合 PEP8 规范`

  const t3 = await run('cliLite.autoTagSkill(skillId, content)', async () => {
    const { logRecord, parsedTags, status } = await cliLite.autoTagSkill(
      'test-skill-001',
      sampleContent,
      'integration-test'
    )
    if (status !== 'completed') throw { code: 'AUTOTAG_FAILED', message: logRecord.error }
    inf(`生成标签 (${parsedTags.length}个): [${parsedTags.join(', ')}]`)
    inf(`CLI 版本: ${logRecord.cli_version}, duration: ${logRecord.duration_ms}ms`)
    return { parsedTags, logRecord }
  })
  results.push(t3)

  // ─── 汇总 ─────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length
  const total  = results.length

  console.log(`\n${C}──────────────── 汇总 ────────────────${X}`)
  console.log(`  通过: ${G}${passed}${X} / ${total}`)
  results.forEach((r, i) => {
    const label = ['checkAvailable', 'invokeCli', 'autoTagSkill'][i]
    console.log(`  ${r.ok ? G+'✓'+X : R+'✗'+X} ${label} (${r.ms}ms)`)
  })
  console.log()

  process.exit(passed === total ? 0 : 1)
}

main().catch(e => { console.error('\n未预期错误:', e); process.exit(1) })
