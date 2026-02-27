'use strict'

/**
 * skill-service.js
 * Module 1: Skill & Agent Asset Management
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fileService = require('./file-service')
const workspaceService = require('./workspace-service')
const versionService = require('./version-service')
const tagService = require('./tag-service')
const logService = require('./log-service')
const cliLiteService = require('./cli-lite-service')

// ─── Path helpers ────────────────────────────────────────────────────────────

/**
 * Build the directory name for a skill version.
 * e.g. skill_a1b2c3d4_v1
 */
function skillDirName(id, version) {
  return `skill_${id.slice(0, 8)}_${version}`
}

/**
 * Find the current (latest) directory for a skill ID.
 * Returns { dir, purpose, provider, fullPath } or null.
 */
function findSkillDir(skillId) {
  const allDirs = workspaceService.listAllSkillDirs()
  const candidates = allDirs
    .filter(d => d.dir.startsWith(`skill_${skillId.slice(0, 8)}_`))
    .sort((a, b) => {
      const vA = versionService.versionNumber(a.dir.split('_').pop())
      const vB = versionService.versionNumber(b.dir.split('_').pop())
      return vB - vA // highest version first
    })
  return candidates[0] || null
}

/**
 * Find ALL version directories for a skill ID, sorted v1 → vN.
 */
function findAllSkillVersionDirs(skillId) {
  return workspaceService.listAllSkillDirs()
    .filter(d => d.dir.startsWith(`skill_${skillId.slice(0, 8)}_`))
    .sort((a, b) => {
      const vA = versionService.versionNumber(a.dir.split('_').pop())
      const vB = versionService.versionNumber(b.dir.split('_').pop())
      return vA - vB
    })
}

// ─── Core CRUD ───────────────────────────────────────────────────────────────

/**
 * Import a Skill.
 * importType: 'text' | 'file'
 * content: prompt text or file path
 * meta: { name, purpose, provider, description?, author?, source? }
 */
function importSkill({ importType, content, meta }) {
  if (!meta.name) throw { code: 'INVALID_PARAMS', message: 'name is required' }
  if (!meta.purpose) throw { code: 'INVALID_PARAMS', message: 'purpose is required' }
  if (!meta.provider) throw { code: 'INVALID_PARAMS', message: 'provider is required' }

  let skillContent = content
  if (importType === 'file') {
    skillContent = fileService.readText(content)
    if (skillContent === null) throw { code: 'FILE_IO_ERROR', message: `File not found: ${content}` }
  }

  const skillId = uuidv4()
  const version = 'v1'
  const now = new Date().toISOString()
  const dirName = skillDirName(skillId, version)
  const skillDir = workspaceService.paths.skills(meta.purpose, meta.provider, dirName)

  fileService.ensureDir(skillDir)
  fileService.ensureDir(path.join(skillDir, 'auto_tag_log'))
  fileService.ensureDir(path.join(skillDir, 'history'))

  // Write content.txt
  fileService.writeText(path.join(skillDir, 'content.txt'), skillContent)

  // Write meta.json
  const metaData = {
    id: skillId,
    name: meta.name,
    description: meta.description || '',
    author: meta.author || '',
    source: meta.source || '',
    purpose: meta.purpose,
    provider: meta.provider,
    type: meta.type || 'skill',
    version,
    version_count: 1,
    content_file: 'content.txt',
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  fileService.writeJson(path.join(skillDir, 'meta.json'), metaData)

  // Write tags.json
  fileService.writeJson(path.join(skillDir, 'tags.json'), tagService.emptyTags())

  logService.info('skill-service', 'Skill imported', { skillId, name: meta.name, type: metaData.type })

  return { skillId, version, path: skillDir }
}

/**
 * Get a skill by ID. Returns full data.
 */
function getSkill(skillId) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  const content = fileService.readText(path.join(found.fullPath, 'content.txt')) || ''
  const tags = fileService.readJson(path.join(found.fullPath, 'tags.json')) || tagService.emptyTags()

  // Build versions list from history
  const history = versionService.readHistory(found.fullPath)
  const versions = [{ version: 'v1', updated_at: meta.created_at }]
  for (const rec of history) {
    versions.push({ version: rec.to_version, updated_at: rec.timestamp })
  }
  // Deduplicate, keep last entry for each version
  const versionMap = {}
  for (const v of versions) versionMap[v.version] = v
  const versionList = Object.values(versionMap).sort(
    (a, b) => versionService.versionNumber(a.version) - versionService.versionNumber(b.version)
  )

  const hasProvenance = fileService.exists(path.join(found.fullPath, 'provenance.json'))

  return { meta, content, tags, versions: versionList, hasProvenance }
}

/**
 * Update a skill (content and/or meta). Creates a new version.
 */
function updateSkill({ skillId, currentVersion, changes }) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  if (meta.version !== currentVersion) {
    throw { code: 'INVALID_PARAMS', message: `Version conflict: expected ${meta.version}, got ${currentVersion}` }
  }

  const oldContent = fileService.readText(path.join(found.fullPath, 'content.txt')) || ''
  const changedFields = []
  const diff = {}

  if (changes.content !== undefined && changes.content !== oldContent) {
    changedFields.push('content')
    diff.content = { before: oldContent, after: changes.content }
  }

  if (changes.meta) {
    const metaDiff = {}
    for (const [key, val] of Object.entries(changes.meta)) {
      if (val !== undefined && val !== meta[key]) {
        changedFields.push(`meta.${key}`)
        metaDiff[key] = { before: meta[key], after: val }
      }
    }
    if (Object.keys(metaDiff).length > 0) diff.meta = metaDiff
  }

  if (changedFields.length === 0) {
    return { newVersion: meta.version, updatedAt: meta.updated_at }
  }

  const newVersion = versionService.incrementVersion(meta.version)
  const now = new Date().toISOString()

  // Write diff
  versionService.writeDiff(found.fullPath, meta.version, newVersion, changedFields, diff)

  // Update content
  if (changes.content !== undefined) {
    fileService.writeText(path.join(found.fullPath, 'content.txt'), changes.content)
  }

  // Update meta
  if (changes.meta) {
    Object.assign(meta, changes.meta)
  }
  meta.version = newVersion
  meta.version_count = (meta.version_count || 1) + 1
  meta.updated_at = now
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)

  logService.info('skill-service', 'Skill updated', { skillId, newVersion })

  return { newVersion, updatedAt: now }
}

/**
 * Delete a skill (move to archived status; keeps files).
 */
function deleteSkill(skillId) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  meta.status = 'archived'
  meta.updated_at = new Date().toISOString()
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)

  logService.info('skill-service', 'Skill deleted (archived)', { skillId })
  return { deleted: true }
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

function addTag(skillId, value) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  const { tags: updated, tagId } = tagService.addManualTag(tags, value)
  fileService.writeJson(tagsPath, updated)
  logService.info('skill-service', 'Tag added', { skillId, tagId, value })
  return { tagId }
}

function removeTag(skillId, tagId, tagType) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  tags = tagService.removeTag(tags, tagId, tagType)
  fileService.writeJson(tagsPath, tags)
  logService.info('skill-service', 'Tag removed', { skillId, tagId, tagType })
  return { removed: true }
}

function updateTagValue(skillId, tagId, tagType, newValue) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  tags = tagService.updateTag(tags, tagId, tagType, newValue)
  fileService.writeJson(tagsPath, tags)
  logService.info('skill-service', 'Tag value updated', { skillId, tagId, tagType, newValue })
  return { updated: true }
}

// ─── Auto-tagging ────────────────────────────────────────────────────────────

/**
 * Trigger auto-tagging for a single skill (async).
 * Returns immediately with taskId; saves results to tags.json + auto_tag_log/.
 */
async function triggerAutoTag(skillId, triggeredBy = 'user') {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const skillContent = fileService.readText(path.join(found.fullPath, 'content.txt')) || ''
  const taskId = `autotag_${skillId.slice(0, 8)}_${Date.now()}`

  // Run CLI call (async, non-blocking for caller)
  const runTag = async () => {
    const { logRecord, parsedTags, status } = await cliLiteService.autoTagSkill(skillId, skillContent, triggeredBy)

    // Save log record
    const logDir = path.join(found.fullPath, 'auto_tag_log')
    fileService.ensureDir(logDir)
    const logFileName = `session_${logRecord.session_id.replace('tmp_sess_', '')}.json`
    const logRelPath = `auto_tag_log/${logFileName}`
    fileService.writeJson(path.join(found.fullPath, logRelPath), logRecord)

    // Add pending tags if successful
    if (status === 'completed' && parsedTags.length > 0) {
      const tagsPath = path.join(found.fullPath, 'tags.json')
      let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
      const { tags: updated } = tagService.addPendingAutoTags(tags, parsedTags, logRelPath)
      fileService.writeJson(tagsPath, updated)
    }

    logService.info('skill-service', `Auto-tag ${status}`, { skillId, taskId, tags: parsedTags })
    return { taskId, status, parsedTags }
  }

  return { taskId, runTag }
}

/**
 * Batch trigger auto-tagging for multiple skills. Runs serially.
 */
async function triggerAutoTagBatch(skillIds) {
  const batchId = `batch_${Date.now()}`
  const results = []

  for (const skillId of skillIds) {
    try {
      const { taskId, runTag } = await triggerAutoTag(skillId, 'batch')
      const result = await runTag()
      results.push({ skillId, taskId, ...result })
    } catch (err) {
      results.push({ skillId, taskId: null, status: 'failed', error: err.message || String(err) })
      logService.error('skill-service', `Batch auto-tag failed for ${skillId}`, { error: err })
    }
  }

  return { batchId, results }
}

/**
 * Review auto tags: approve / reject / modify.
 */
function reviewAutoTags(skillId, reviews) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  const { tags: updated, updated: count } = tagService.reviewAutoTags(tags, reviews)
  fileService.writeJson(tagsPath, updated)

  logService.info('skill-service', 'Auto-tags reviewed', { skillId, count })
  return { updated: count }
}

// ─── Versioning ───────────────────────────────────────────────────────────────

function listVersions(skillId) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  const history = versionService.readHistory(found.fullPath)

  const versions = [{ version: 'v1', updated_at: meta.created_at, changedFields: [] }]
  for (const rec of history) {
    versions.push({
      version: rec.to_version,
      updated_at: rec.timestamp,
      changedFields: rec.changed_fields || [],
    })
  }

  // Deduplicate
  const seen = new Set()
  const unique = versions.filter(v => {
    if (seen.has(v.version)) return false
    seen.add(v.version)
    return true
  })

  return {
    versions: unique.sort((a, b) =>
      versionService.versionNumber(a.version) - versionService.versionNumber(b.version)
    ),
  }
}

function getDiff(skillId, fromVersion, toVersion) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const diff = versionService.getDiff(found.fullPath, fromVersion, toVersion)
  if (!diff) throw { code: 'NOT_FOUND', message: `Diff not found: ${fromVersion} → ${toVersion}` }
  return { diff }
}

/**
 * Rollback to a previous version. Creates a new version (does not overwrite history).
 */
function rollbackVersion(skillId, targetVersion) {
  const found = findSkillDir(skillId)
  if (!found) throw { code: 'NOT_FOUND', message: `Skill not found: ${skillId}` }

  const history = versionService.readHistory(found.fullPath)
  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))

  // Find the content at targetVersion
  let restoredContent
  if (targetVersion === 'v1') {
    // The v1 content is what was written at the beginning; we track it via history
    // v1 content = current content with all diffs reversed
    // Simpler approach: trace from history
    restoredContent = _getContentAtVersion(found.fullPath, targetVersion, history)
  } else {
    restoredContent = _getContentAtVersion(found.fullPath, targetVersion, history)
  }

  if (restoredContent === null) {
    throw { code: 'NOT_FOUND', message: `Cannot find content for version ${targetVersion}` }
  }

  const currentContent = fileService.readText(path.join(found.fullPath, 'content.txt')) || ''
  const newVersion = versionService.incrementVersion(meta.version)
  const now = new Date().toISOString()

  versionService.writeDiff(found.fullPath, meta.version, newVersion, ['content'], {
    content: { before: currentContent, after: restoredContent },
  })

  fileService.writeText(path.join(found.fullPath, 'content.txt'), restoredContent)

  meta.version = newVersion
  meta.version_count = (meta.version_count || 1) + 1
  meta.updated_at = now
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)

  logService.info('skill-service', 'Skill rolled back', { skillId, targetVersion, newVersion })
  return { newVersion }
}

/**
 * Reconstruct content at a specific version by walking history records.
 */
function _getContentAtVersion(skillDir, targetVersion, history) {
  // current content
  const currentContent = fileService.readText(path.join(skillDir, 'content.txt')) || ''
  const meta = fileService.readJson(path.join(skillDir, 'meta.json'))
  const currentVersion = meta.version

  if (targetVersion === currentVersion) return currentContent

  // Walk history backward from current version to target
  const sortedHistory = [...history].sort((a, b) =>
    versionService.versionNumber(b.to_version) - versionService.versionNumber(a.to_version)
  )

  let content = currentContent
  let version = currentVersion

  for (const rec of sortedHistory) {
    if (rec.to_version !== version) continue
    if (rec.diff && rec.diff.content) {
      content = rec.diff.content.before
    }
    version = rec.from_version
    if (version === targetVersion) return content
  }

  // If targetVersion is v1 and we've walked all the way back
  if (version === targetVersion) return content

  // Fallback: if no content changes in history, current content = v1 content
  return currentContent
}

// ─── List & Search ────────────────────────────────────────────────────────────

/**
 * List skills with optional filtering and pagination.
 */
function listSkills({ purpose, provider, tags: filterTags, keyword, sortBy = 'created_at', sortOrder = 'desc', page = 1, pageSize = 20 } = {}) {
  const allDirs = workspaceService.listAllSkillDirs()

  const items = []
  for (const { dir, purpose: p, provider: prov, fullPath } of allDirs) {
    const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
    if (!meta || meta.status === 'archived') continue

    if (purpose && meta.purpose !== purpose) continue
    if (provider && meta.provider !== provider) continue

    const tags = fileService.readJson(path.join(fullPath, 'tags.json')) || tagService.emptyTags()
    const effectiveTags = tagService.getEffectiveTags(tags)

    if (filterTags && filterTags.length > 0) {
      if (!filterTags.every(t => effectiveTags.includes(t))) continue
    }

    if (keyword) {
      const lower = keyword.toLowerCase()
      const nameMatch = meta.name.toLowerCase().includes(lower)
      const descMatch = (meta.description || '').toLowerCase().includes(lower)
      if (!nameMatch && !descMatch) continue
    }

    const content = fileService.readText(path.join(fullPath, 'content.txt')) || ''
    const contentPreview = content.slice(0, 200)
    const pendingTagCount = tagService.getPendingCount(tags)

    items.push({
      id: meta.id,
      name: meta.name,
      purpose: meta.purpose,
      provider: meta.provider,
      type: meta.type || 'skill',
      version: meta.version,
      description: meta.description || '',
      tags: effectiveTags,
      pendingTagCount,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      contentPreview,
    })
  }

  // Sort
  items.sort((a, b) => {
    let valA = a[sortBy] || ''
    let valB = b[sortBy] || ''
    if (sortBy === 'name') {
      valA = valA.toLowerCase()
      valB = valB.toLowerCase()
    }
    if (sortOrder === 'asc') return valA < valB ? -1 : valA > valB ? 1 : 0
    return valA > valB ? -1 : valA < valB ? 1 : 0
  })

  const total = items.length
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)

  return { items: pageItems, total, page, pageSize }
}

/**
 * Full-text search across skills.
 */
function searchSkills({ keyword, scope, page = 1, pageSize = 20 } = {}) {
  if (!keyword) return { items: [], total: 0, page, pageSize }

  const searchScope = scope || ['name', 'description', 'tags', 'content']
  const lower = keyword.toLowerCase()
  const allDirs = workspaceService.listAllSkillDirs()

  const items = []
  for (const { fullPath } of allDirs) {
    const meta = fileService.readJson(path.join(fullPath, 'meta.json'))
    if (!meta || meta.status === 'archived') continue

    const tags = fileService.readJson(path.join(fullPath, 'tags.json')) || tagService.emptyTags()
    const effectiveTags = tagService.getEffectiveTags(tags)
    const content = fileService.readText(path.join(fullPath, 'content.txt')) || ''
    const pendingTagCount = tagService.getPendingCount(tags)
    const contentPreview = content.slice(0, 200)

    const matchedIn = []

    if (searchScope.includes('name') && meta.name.toLowerCase().includes(lower)) matchedIn.push('name')
    if (searchScope.includes('description') && (meta.description || '').toLowerCase().includes(lower)) matchedIn.push('description')
    if (searchScope.includes('tags') && effectiveTags.some(t => t.toLowerCase().includes(lower))) matchedIn.push('tags')
    if (searchScope.includes('content') && content.toLowerCase().includes(lower)) matchedIn.push('content')

    if (matchedIn.length === 0) continue

    items.push({
      id: meta.id,
      name: meta.name,
      purpose: meta.purpose,
      provider: meta.provider,
      type: meta.type || 'skill',
      version: meta.version,
      description: meta.description || '',
      tags: effectiveTags,
      pendingTagCount,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      contentPreview,
      matchedIn,
    })
  }

  const total = items.length
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
  return { items: pageItems, total, page, pageSize }
}

module.exports = {
  importSkill,
  getSkill,
  updateSkill,
  deleteSkill,
  addTag,
  removeTag,
  updateTagValue,
  triggerAutoTag,
  triggerAutoTagBatch,
  reviewAutoTags,
  listVersions,
  getDiff,
  rollbackVersion,
  listSkills,
  searchSkills,
  // Exposed for testing
  findSkillDir,
}
