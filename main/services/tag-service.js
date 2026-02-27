'use strict'

const { v4: uuidv4 } = require('uuid')
const fileService = require('./file-service')

/**
 * Add a manual tag to a tags.json.
 * @param {object} tags   - current tags object (manual: [...], auto: [...])
 * @param {string} value
 * @returns {{ tags: object, tagId: string }}
 */
function addManualTag(tags, value) {
  const tagId = uuidv4()
  tags.manual.push({
    id: tagId,
    value,
    created_at: new Date().toISOString(),
  })
  return { tags, tagId }
}

/**
 * Remove a tag by id (from manual or auto array).
 */
function removeTag(tags, tagId, tagType) {
  if (tagType === 'manual') {
    tags.manual = tags.manual.filter(t => t.id !== tagId)
  } else {
    tags.auto = tags.auto.filter(t => t.id !== tagId)
  }
  return tags
}

/**
 * Update a tag's value in manual or auto array.
 */
function updateTag(tags, tagId, tagType, newValue) {
  if (tagType === 'manual') {
    const tag = tags.manual.find(t => t.id === tagId)
    if (tag) tag.value = newValue
  } else {
    const tag = tags.auto.find(t => t.id === tagId)
    if (tag) tag.value = newValue
  }
  return tags
}

/**
 * Add pending auto tags to tags.json (from a CLI auto-tag run).
 * @param {object} tags
 * @param {string[]} values  - tag values from CLI
 * @param {string} logRef    - relative path to the auto_tag_log file
 * @returns {{ tags: object, addedIds: string[] }}
 */
function addPendingAutoTags(tags, values, logRef) {
  const now = new Date().toISOString()
  const addedIds = []
  for (const value of values) {
    const id = uuidv4()
    tags.auto.push({
      id,
      value,
      status: 'pending',
      generated_at: now,
      approved_at: null,
      rejected_at: null,
      log_ref: logRef,
    })
    addedIds.push(id)
  }
  return { tags, addedIds }
}

/**
 * Review auto tags: approve / reject / modify.
 * @param {object} tags
 * @param {{ tagId: string, action: 'approve'|'reject'|'modify', newValue?: string }[]} reviews
 * @returns {{ tags: object, updated: number }}
 */
function reviewAutoTags(tags, reviews) {
  let updated = 0
  const now = new Date().toISOString()
  for (const review of reviews) {
    const tag = tags.auto.find(t => t.id === review.tagId)
    if (!tag) continue
    if (review.action === 'approve') {
      tag.status = 'approved'
      tag.approved_at = now
    } else if (review.action === 'reject') {
      tag.status = 'rejected'
      tag.rejected_at = now
    } else if (review.action === 'modify') {
      tag.status = 'approved'
      tag.value = review.newValue
      tag.approved_at = now
    }
    updated++
  }
  return { tags, updated }
}

/**
 * Get all effective tags (manual + approved auto) as string array.
 */
function getEffectiveTags(tags) {
  const manual = (tags.manual || []).map(t => t.value)
  const autoApproved = (tags.auto || []).filter(t => t.status === 'approved').map(t => t.value)
  return [...manual, ...autoApproved]
}

/**
 * Count pending auto tags.
 */
function getPendingCount(tags) {
  return (tags.auto || []).filter(t => t.status === 'pending').length
}

/**
 * Create an empty tags structure.
 */
function emptyTags() {
  return { manual: [], auto: [] }
}

module.exports = {
  addManualTag,
  removeTag,
  updateTag,
  addPendingAutoTags,
  reviewAutoTags,
  getEffectiveTags,
  getPendingCount,
  emptyTags,
}
