'use strict'

const path = require('path')
const fileService = require('./file-service')

/**
 * Increment a version string like "v1" → "v2"
 */
function incrementVersion(version) {
  const n = parseInt(version.replace('v', ''), 10)
  return `v${n + 1}`
}

/**
 * Parse version number from a version string like "v3" → 3
 */
function versionNumber(version) {
  return parseInt(version.replace('v', ''), 10)
}

/**
 * Write a history diff record to the asset's history/ directory.
 * @param {string} assetDir  - absolute path to skill or baseline dir
 * @param {string} fromVersion
 * @param {string} toVersion
 * @param {string[]} changedFields
 * @param {object} diff  - { content: {before, after}, meta: { fieldName: {before, after} } }
 */
function writeDiff(assetDir, fromVersion, toVersion, changedFields, diff) {
  const historyDir = path.join(assetDir, 'history')
  fileService.ensureDir(historyDir)

  // Filename: v1_to_v2_20240101130000.json
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const filename = `${fromVersion}_to_${toVersion}_${ts}.json`

  fileService.writeJson(path.join(historyDir, filename), {
    from_version: fromVersion,
    to_version: toVersion,
    timestamp: new Date().toISOString(),
    changed_fields: changedFields,
    diff,
  })
}

/**
 * Read all history records for an asset, sorted by to_version ascending.
 * @param {string} assetDir
 * @returns {object[]}
 */
function readHistory(assetDir) {
  const historyDir = path.join(assetDir, 'history')
  const files = fileService.listFiles(historyDir).filter(f => f.endsWith('.json'))
  const records = []
  for (const file of files) {
    const record = fileService.readJson(path.join(historyDir, file))
    if (record) records.push(record)
  }
  // Sort by to_version number ascending
  records.sort((a, b) => versionNumber(a.to_version) - versionNumber(b.to_version))
  return records
}

/**
 * Get a specific diff record (from_version → to_version).
 */
function getDiff(assetDir, fromVersion, toVersion) {
  const history = readHistory(assetDir)
  return history.find(r => r.from_version === fromVersion && r.to_version === toVersion) || null
}

module.exports = {
  incrementVersion,
  versionNumber,
  writeDiff,
  readHistory,
  getDiff,
}
