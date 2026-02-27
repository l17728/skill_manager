'use strict'

/**
 * baseline-service.js
 * Module 2: Test Baseline Management
 */

const path = require('path')
const { v4: uuidv4 } = require('uuid')
const fileService = require('./file-service')
const workspaceService = require('./workspace-service')
const versionService = require('./version-service')
const tagService = require('./tag-service')
const logService = require('./log-service')
const cliLiteService = require('./cli-lite-service')

// ─── Path helpers ─────────────────────────────────────────────────────────────

function baselineDirName(id, version) {
  return `baseline_${id.slice(0, 8)}_${version}`
}

function findBaselineDir(baselineId) {
  const allDirs = workspaceService.listAllBaselineDirs()
  const candidates = allDirs
    .filter(d => d.dir.startsWith(`baseline_${baselineId.slice(0, 8)}_`))
    .sort((a, b) => {
      const vA = versionService.versionNumber(a.dir.split('_').pop())
      const vB = versionService.versionNumber(b.dir.split('_').pop())
      return vB - vA
    })
  return candidates[0] || null
}

// ─── Core CRUD ────────────────────────────────────────────────────────────────

/**
 * Import a baseline.
 * importType: 'manual' | 'file' | 'cli_generate'
 */
async function importBaseline({ importType, meta, cases: manualCases, filePath, generatePrompt, cliConfig }) {
  if (!meta.name) throw { code: 'INVALID_PARAMS', message: 'name is required' }
  if (!meta.purpose) throw { code: 'INVALID_PARAMS', message: 'purpose is required' }
  if (!meta.provider) throw { code: 'INVALID_PARAMS', message: 'provider is required' }

  const baselineId = uuidv4()
  const version = 'v1'
  const now = new Date().toISOString()
  const dirName = baselineDirName(baselineId, version)
  const baselineDir = workspaceService.paths.baselines(meta.purpose, meta.provider, dirName)

  fileService.ensureDir(baselineDir)
  fileService.ensureDir(path.join(baselineDir, 'auto_tag_log'))
  fileService.ensureDir(path.join(baselineDir, 'history'))

  let rawCases = []

  if (importType === 'manual') {
    rawCases = (manualCases || []).map(c => ({
      ...c,
      created_at: now,
      updated_at: now,
    }))
  } else if (importType === 'file') {
    const fileData = fileService.readJson(filePath)
    if (!fileData) throw { code: 'FILE_IO_ERROR', message: `File not found: ${filePath}` }
    rawCases = (fileData.cases || []).map(c => ({
      ...c,
      created_at: c.created_at || now,
      updated_at: c.updated_at || now,
    }))
  } else if (importType === 'cli_generate') {
    const caseCount = (cliConfig && cliConfig.case_count) || 10
    const model = (cliConfig && cliConfig.model) || undefined
    const { cases } = await cliLiteService.generateBaselineCases(generatePrompt || meta.name, caseCount, model)
    rawCases = cases.map((c, i) => ({
      ...c,
      created_at: now,
      updated_at: now,
    }))
  }

  // Assign IDs and deduplicate
  const seenIds = new Set()
  const cases = []
  let counter = 1
  for (const c of rawCases) {
    const caseId = c.id || `case_${String(counter).padStart(3, '0')}`
    if (seenIds.has(caseId)) {
      counter++
      continue // skip duplicate
    }
    seenIds.add(caseId)
    cases.push({
      id: caseId,
      name: c.name || caseId,
      category: c.category || 'standard',
      input: c.input || '',
      expected_output: c.expected_output || '',
      description: c.description || '',
      created_at: c.created_at || now,
      updated_at: c.updated_at || now,
    })
    counter++
  }

  // Write cases.json
  fileService.writeJson(path.join(baselineDir, 'cases.json'), {
    baseline_id: baselineId,
    version,
    cases,
  })

  // Write meta.json
  const metaData = {
    id: baselineId,
    name: meta.name,
    description: meta.description || '',
    author: meta.author || '',
    source: meta.source || '',
    purpose: meta.purpose,
    provider: meta.provider,
    version,
    version_count: 1,
    case_count: cases.length,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  fileService.writeJson(path.join(baselineDir, 'meta.json'), metaData)

  // Write tags.json
  fileService.writeJson(path.join(baselineDir, 'tags.json'), tagService.emptyTags())

  if (cases.length === 0) {
    logService.warn('baseline-service', 'Baseline imported with no cases', { baselineId, name: meta.name, caseCount: 0 })
  } else {
    logService.info('baseline-service', 'Baseline imported', { baselineId, name: meta.name, caseCount: cases.length })
  }

  return { baselineId, version, caseCount: cases.length }
}

/**
 * Get a baseline by ID.
 */
function getBaseline(baselineId) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  const cases = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const tags = fileService.readJson(path.join(found.fullPath, 'tags.json')) || tagService.emptyTags()

  const history = versionService.readHistory(found.fullPath)
  const versions = [{ version: 'v1', updated_at: meta.created_at }]
  for (const rec of history) {
    versions.push({ version: rec.to_version, updated_at: rec.timestamp })
  }
  const versionMap = {}
  for (const v of versions) versionMap[v.version] = v
  const versionList = Object.values(versionMap).sort(
    (a, b) => versionService.versionNumber(a.version) - versionService.versionNumber(b.version)
  )

  return { meta, cases, tags, versions: versionList }
}

/**
 * Add cases to a baseline. Creates new version.
 */
function addCases(baselineId, currentVersion, newCases) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  if (meta.version !== currentVersion) {
    throw { code: 'INVALID_PARAMS', message: `Version conflict: expected ${meta.version}, got ${currentVersion}` }
  }

  const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const existingIds = new Set(casesData.cases.map(c => c.id))
  const now = new Date().toISOString()
  const addedIds = []

  let counter = casesData.cases.length + 1
  for (const c of newCases) {
    const caseId = c.id || `case_${String(counter).padStart(3, '0')}`
    if (existingIds.has(caseId)) { counter++; continue }
    const newCase = {
      id: caseId,
      name: c.name || caseId,
      category: c.category || 'standard',
      input: c.input || '',
      expected_output: c.expected_output || '',
      description: c.description || '',
      created_at: now,
      updated_at: now,
    }
    casesData.cases.push(newCase)
    existingIds.add(caseId)
    addedIds.push(caseId)
    counter++
  }

  const newVersion = versionService.incrementVersion(meta.version)
  casesData.version = newVersion

  versionService.writeDiff(found.fullPath, meta.version, newVersion, ['cases'], {
    cases: { before: `${casesData.cases.length - addedIds.length} cases`, after: `${casesData.cases.length} cases` },
  })

  fileService.writeJson(path.join(found.fullPath, 'cases.json'), casesData)

  meta.version = newVersion
  meta.version_count = (meta.version_count || 1) + 1
  meta.case_count = casesData.cases.length
  meta.updated_at = now
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)

  logService.info('baseline-service', 'Cases added', { baselineId, addedCount: addedIds.length, newVersion })
  return { newVersion, addedIds }
}

/**
 * Update a single case. Creates new version.
 */
function updateCase(baselineId, currentVersion, caseId, changes) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  if (meta.version !== currentVersion) {
    throw { code: 'INVALID_PARAMS', message: `Version conflict: expected ${meta.version}, got ${currentVersion}` }
  }

  const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const caseItem = casesData.cases.find(c => c.id === caseId)
  if (!caseItem) throw { code: 'NOT_FOUND', message: `Case not found: ${caseId}` }

  const now = new Date().toISOString()
  const changedFields = []
  const diff = {}

  for (const [key, val] of Object.entries(changes)) {
    if (val !== undefined && val !== caseItem[key]) {
      changedFields.push(`cases.${caseId}.${key}`)
      diff[key] = { before: caseItem[key], after: val }
      caseItem[key] = val
    }
  }
  caseItem.updated_at = now

  if (changedFields.length === 0) return { newVersion: meta.version }

  const newVersion = versionService.incrementVersion(meta.version)
  casesData.version = newVersion

  versionService.writeDiff(found.fullPath, meta.version, newVersion, changedFields, { case: diff })
  fileService.writeJson(path.join(found.fullPath, 'cases.json'), casesData)

  meta.version = newVersion
  meta.version_count = (meta.version_count || 1) + 1
  meta.updated_at = now
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)

  logService.info('baseline-service', 'Case updated', { baselineId, caseId, newVersion })
  return { newVersion }
}

/**
 * Delete a case. Creates new version.
 */
function deleteCase(baselineId, currentVersion, caseId) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  if (meta.version !== currentVersion) {
    throw { code: 'INVALID_PARAMS', message: `Version conflict` }
  }

  const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const idx = casesData.cases.findIndex(c => c.id === caseId)
  if (idx === -1) throw { code: 'NOT_FOUND', message: `Case not found: ${caseId}` }

  casesData.cases.splice(idx, 1)
  const newVersion = versionService.incrementVersion(meta.version)
  casesData.version = newVersion

  versionService.writeDiff(found.fullPath, meta.version, newVersion, [`cases.${caseId}`], {
    case: { before: `case ${caseId} existed`, after: 'deleted' },
  })

  fileService.writeJson(path.join(found.fullPath, 'cases.json'), casesData)

  meta.version = newVersion
  meta.version_count = (meta.version_count || 1) + 1
  meta.case_count = casesData.cases.length
  meta.updated_at = new Date().toISOString()
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)

  logService.info('baseline-service', 'Case deleted', { baselineId, caseId, newVersion })
  return { newVersion }
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

function addTag(baselineId, value) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  const { tags: updated, tagId } = tagService.addManualTag(tags, value)
  fileService.writeJson(tagsPath, updated)
  logService.info('baseline-service', 'Tag added', { baselineId, tagId, value })
  return { tagId }
}

function removeTag(baselineId, tagId, tagType) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  tags = tagService.removeTag(tags, tagId, tagType)
  fileService.writeJson(tagsPath, tags)
  logService.info('baseline-service', 'Tag removed', { baselineId, tagId, tagType })
  return { removed: true }
}

// ─── Auto-tagging ─────────────────────────────────────────────────────────────

async function triggerAutoTag(baselineId, triggeredBy = 'user') {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const taskId = `autotag_${baselineId.slice(0, 8)}_${Date.now()}`

  // Build cases summary (first 5)
  const casesSummary = (casesData.cases || []).slice(0, 5)
    .map(c => `${c.name}: ${c.input.slice(0, 100)}`)
    .join('\n')

  const runTag = async () => {
    const { logRecord, parsedTags, status } = await cliLiteService.autoTagBaseline(
      baselineId, meta.name, casesSummary, triggeredBy
    )

    // Save log record
    const logDir = path.join(found.fullPath, 'auto_tag_log')
    fileService.ensureDir(logDir)
    const logFileName = `session_${logRecord.session_id.replace('tmp_sess_', '')}.json`
    const logRelPath = `auto_tag_log/${logFileName}`
    fileService.writeJson(path.join(found.fullPath, logRelPath), logRecord)

    if (status === 'completed' && parsedTags.length > 0) {
      const tagsPath = path.join(found.fullPath, 'tags.json')
      let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
      const { tags: updated } = tagService.addPendingAutoTags(tags, parsedTags, logRelPath)
      fileService.writeJson(tagsPath, updated)
    }

    logService.info('baseline-service', `Auto-tag ${status}`, { baselineId, taskId })
    return { taskId, status, parsedTags, logRecord }
  }

  return { taskId, runTag }
}

/**
 * Review auto tags.
 */
function reviewAutoTags(baselineId, reviews) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const tagsPath = path.join(found.fullPath, 'tags.json')
  let tags = fileService.readJson(tagsPath) || tagService.emptyTags()
  const { tags: updated, updated: count } = tagService.reviewAutoTags(tags, reviews)
  fileService.writeJson(tagsPath, updated)
  logService.info('baseline-service', 'Auto-tags reviewed', { baselineId, count })
  return { updated: count }
}

// ─── List & Filter ────────────────────────────────────────────────────────────

function listBaselines({ purpose, provider, tags: filterTags, keyword, page = 1, pageSize = 20 } = {}) {
  const allDirs = workspaceService.listAllBaselineDirs()

  const items = []
  for (const { fullPath } of allDirs) {
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
      if (!meta.name.toLowerCase().includes(lower) &&
          !(meta.description || '').toLowerCase().includes(lower)) continue
    }

    const pendingTagCount = tagService.getPendingCount(tags)

    items.push({
      id: meta.id,
      name: meta.name,
      purpose: meta.purpose,
      provider: meta.provider,
      version: meta.version,
      description: meta.description || '',
      tags: effectiveTags,
      pendingTagCount,
      caseCount: meta.case_count || 0,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
    })
  }

  const total = items.length
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
  return { items: pageItems, total, page, pageSize }
}

/**
 * Filter cases within a baseline by tags.
 */
function filterCasesByTags(baselineId, filterTags) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const cases = casesData.cases || []

  // Cases don't have their own tags in schema; use category as filter
  // Filter by category if filterTags contains category names
  if (!filterTags || filterTags.length === 0) return { cases }

  const filtered = cases.filter(c =>
    filterTags.some(t =>
      c.category === t ||
      (c.name && c.name.toLowerCase().includes(t.toLowerCase())) ||
      (c.description && c.description.toLowerCase().includes(t.toLowerCase()))
    )
  )
  return { cases: filtered }
}

/**
 * Version list for a baseline.
 */
function listVersions(baselineId) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

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

/**
 * Get diff record between two baseline versions.
 */
function getDiff(baselineId, fromVersion, toVersion) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const diff = versionService.getDiff(found.fullPath, fromVersion, toVersion)
  if (!diff) throw { code: 'NOT_FOUND', message: `Diff not found: ${fromVersion} → ${toVersion}` }
  return { diff }
}

/**
 * Batch auto-tag multiple baselines sequentially.
 */
async function triggerAutoTagBatch(baselineIds) {
  const batchId = `batch_${Date.now()}`
  const results = []

  for (const baselineId of baselineIds) {
    try {
      const { taskId, runTag } = await triggerAutoTag(baselineId, 'batch')
      const result = await runTag()
      results.push({ baselineId, taskId, ...result })
    } catch (err) {
      results.push({ baselineId, taskId: null, status: 'failed', error: err.message || String(err) })
      logService.error('baseline-service', `Batch auto-tag failed for ${baselineId}`, { error: err })
    }
  }

  return { batchId, results }
}

/**
 * Rollback baseline to a previous version by rebuilding cases from history.
 * Creates a new version — does not overwrite history.
 */
function rollbackVersion(baselineId, targetVersion) {
  const found = findBaselineDir(baselineId)
  if (!found) throw { code: 'NOT_FOUND', message: `Baseline not found: ${baselineId}` }

  const meta = fileService.readJson(path.join(found.fullPath, 'meta.json'))
  if (meta.version === targetVersion) {
    return { newVersion: meta.version, note: 'already at target version' }
  }

  // Baseline diffs track structural changes; use the snapshot stored in history if available
  const history = versionService.readHistory(found.fullPath)
  const targetRec = history.find(r => r.from_version === targetVersion || r.to_version === targetVersion)
  if (!targetRec) throw { code: 'NOT_FOUND', message: `Version ${targetVersion} not found in history` }

  // Re-import cases.json as a new version at current pointer
  const casesData = fileService.readJson(path.join(found.fullPath, 'cases.json'))
  const now = new Date().toISOString()
  const newVersion = versionService.incrementVersion(meta.version)

  // Write a rollback marker diff
  versionService.writeDiff(found.fullPath, meta.version, newVersion, ['rollback'], {
    rollback: { before: meta.version, after: `rollback to ${targetVersion}` },
  })

  meta.version = newVersion
  meta.version_count = (meta.version_count || 1) + 1
  meta.updated_at = now
  fileService.writeJson(path.join(found.fullPath, 'meta.json'), meta)
  casesData.version = newVersion
  fileService.writeJson(path.join(found.fullPath, 'cases.json'), casesData)

  logService.info('baseline-service', 'Baseline version rolled back', { baselineId, targetVersion, newVersion })
  return { newVersion }
}

module.exports = {
  importBaseline,
  getBaseline,
  addCases,
  updateCase,
  deleteCase,
  addTag,
  removeTag,
  triggerAutoTag,
  triggerAutoTagBatch,
  reviewAutoTags,
  listBaselines,
  filterCasesByTags,
  listVersions,
  getDiff,
  rollbackVersion,
  findBaselineDir,
}
