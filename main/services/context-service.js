'use strict'

/**
 * context-service.js — Token estimation and context auto-management.
 *
 * Provides:
 *   estimateTokens(text)              — simple token count estimate
 *   getRiskLevel(tokens, threshold)   — 'normal' | 'warning' | 'critical'
 *   getContextStatus()                — current status of all active sessions
 *   exportContext(sessionId, projectDir, text) — save context .md file
 *   compressContext(sessionId, opts)  — export + CLI compress + update session
 *   checkAndAutoCompress(sessionId, additionalTokens, opts) — auto-compress if threshold exceeded
 */

const path = require('path')
const fileService = require('./file-service')
const workspaceService = require('./workspace-service')
const sessionService = require('./session-service')
const cliService = require('./cli-service')
const logService = require('./log-service')

const COMPRESS_PROMPT = `请对我们之前的对话历史进行摘要压缩，以便继续后续的测试工作。

【压缩要求】
1. 保留所有已完成的测试结果（Skill名称、用例ID、得分、关键输出）
2. 保留当前测试进度（已完成第几条，下一条是什么）
3. 保留重要的错误记录和失败原因
4. 删除冗余的中间过程、重复信息和不影响后续测试的内容
5. 压缩后字数控制在原文的30%以内

请直接输出压缩后的摘要文本，格式清晰，便于在新会话中作为上下文使用。`

// ─── Token estimation ──────────────────────────────────────────────────────

/**
 * Estimate token count for a text string.
 * Chinese characters: ~1.5 chars/token; other: ~4 chars/token.
 */
function estimateTokens(text) {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * Compute risk level based on usage percentage.
 */
function getRiskLevel(estimatedTokens, threshold) {
  const pct = estimatedTokens / threshold
  if (pct >= 0.8) return 'critical'
  if (pct >= 0.6) return 'warning'
  return 'normal'
}

// ─── Status ────────────────────────────────────────────────────────────────

/**
 * Get context status for all active sessions.
 */
function getContextStatus() {
  const cfg = fileService.readJson(workspaceService.paths.cliConfig()) || {}
  const threshold = (cfg.context && cfg.context.token_threshold) || 80000

  const sessions = sessionService.listSessions().filter(s => s.status === 'active')
  return sessions.map(s => ({
    sessionId: s.sessionId,
    estimatedTokens: s.estimatedTokens || 0,
    threshold,
    usagePercent: Math.round((s.estimatedTokens || 0) / threshold * 100),
    riskLevel: getRiskLevel(s.estimatedTokens || 0, threshold),
  }))
}

// ─── Export ────────────────────────────────────────────────────────────────

/**
 * Save the current context text to a .md file.
 * Prefers projectId's logs/ directory; falls back to global workspace/logs/.
 *
 * @param {string} sessionId
 * @param {string|null} projectId
 * @param {string} contextText  — full context content to save
 * @returns {string} absolute path of the exported file
 */
async function exportContext(sessionId, projectId, contextText) {
  let exportDir = workspaceService.paths.logs()

  if (projectId) {
    const allDirs = workspaceService.listAllProjectDirs()
    const proj = allDirs.find(p => {
      const cfg = fileService.readJson(path.join(p.fullPath, 'config.json'))
      return cfg && cfg.id === projectId
    })
    if (proj) {
      exportDir = path.join(proj.fullPath, 'logs')
    }
  }

  fileService.ensureDir(exportDir)
  const timestamp = Date.now()
  const exportPath = path.join(exportDir, `context_export_${timestamp}.md`)

  const content = contextText ||
    `# Context Export\nSession: ${sessionId}\nExported: ${new Date().toISOString()}\n`
  fileService.writeText(exportPath, content)

  // Append to session's contextExports list
  const session = sessionService.getSession(sessionId)
  if (session) {
    const exports = Array.isArray(session.contextExports) ? session.contextExports : []
    exports.push({ path: exportPath, exportedAt: new Date().toISOString() })
    sessionService.updateSession(sessionId, { contextExports: exports })
  }

  return exportPath
}

// ─── Compress ──────────────────────────────────────────────────────────────

/**
 * Export the current session context and compress it via CLI --resume.
 *
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.contextText]  — current context text to export/estimate
 * @param {string} [opts.workingDir]   — CLI working directory
 * @returns {{ tokensBefore, tokensAfter, exportedFilePath }}
 */
async function compressContext(sessionId, opts = {}) {
  const session = sessionService.getSession(sessionId)
  if (!session) throw { code: 'SESSION_NOT_FOUND', sessionId }

  const tokensBefore = session.estimatedTokens || 0

  // 1. Export current context
  const exportedFilePath = await exportContext(sessionId, session.projectId, opts.contextText)
  logService.info('context-service', 'compressContext: context exported', { sessionId, tokensBefore, exportedFilePath })

  // 2. Call CLI --resume to compress
  let tokensAfter = tokensBefore
  try {
    const result = await cliService.invokeCliResume(
      COMPRESS_PROMPT,
      sessionId,
      {
        workingDir: opts.workingDir || workspaceService.paths.cliTempSession(),
        timeoutMs: 60000,
      }
    )
    const compressedText = result.result || ''
    tokensAfter = estimateTokens(compressedText)
    sessionService.updateSession(sessionId, { estimatedTokens: tokensAfter })
    logService.info('context-service', 'compressContext: compressed', { sessionId, tokensBefore, tokensAfter, reduction: tokensBefore - tokensAfter })
  } catch (err) {
    // Compression failure is non-fatal — context was still exported
    logService.warn('context-service', 'compressContext: CLI compress failed (non-fatal)', { sessionId, errCode: err.code, errMsg: err.message || String(err) })
  }

  return { tokensBefore, tokensAfter, exportedFilePath }
}

// ─── Auto-compress ─────────────────────────────────────────────────────────

/**
 * Check if adding `additionalTokens` would exceed the threshold.
 * If so, trigger compression (when auto_compress is enabled).
 * Always updates the session's token count.
 *
 * @param {string} sessionId
 * @param {number} additionalTokens
 * @param {object} [opts]  — passed to compressContext
 * @returns {{ action: 'none'|'compressed', ... }}
 */
async function checkAndAutoCompress(sessionId, additionalTokens, opts = {}) {
  const cfg = fileService.readJson(workspaceService.paths.cliConfig()) || {}
  const contextCfg = cfg.context || {}
  const threshold = contextCfg.token_threshold || 80000

  const session = sessionService.getSession(sessionId)
  if (!session) return { action: 'none' }

  const current = session.estimatedTokens || 0
  const projected = current + additionalTokens
  const pct = projected / threshold

  if (pct >= 0.8 && contextCfg.auto_compress !== false) {
    // Export and compress
    const result = await compressContext(sessionId, opts)
    return { action: 'compressed', ...result }
  }

  // Below threshold — just update token count
  sessionService.updateSession(sessionId, { estimatedTokens: projected })
  return { action: 'none', estimatedTokens: projected }
}

module.exports = {
  estimateTokens,
  getRiskLevel,
  getContextStatus,
  exportContext,
  compressContext,
  checkAndAutoCompress,
}
