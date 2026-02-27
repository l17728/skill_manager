'use strict'

/**
 * skill-service.test.js
 * TDD Test Cases: UC1-1 through UC1-12
 */

const path = require('path')
const fs = require('fs')
const { createTmpDir, overrideWorkspace } = require('../helpers/fs-helper')
const skillFixture = require('../fixtures/skill.fixture')

// Load services (must be required after workspace override)
let workspaceService, skillService

let tmpDir, cleanup, restoreWorkspace

beforeAll(() => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir
  cleanup = tmp.cleanup

  // Re-require fresh modules with patched workspace
  jest.resetModules()
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)

  // Now require services that depend on workspaceService (same module cache)
  skillService = require('../../main/services/skill-service')
})

afterAll(() => {
  restoreWorkspace()
  cleanup()
})

// ─── UC1-1: Import Skill ────────────────────────────────────────────────────

describe('UC1-1: importSkill', () => {
  let importedSkillId

  test('should create directory structure with meta/content/tags', () => {
    const result = skillService.importSkill(skillFixture.basic)
    expect(result.skillId).toBeTruthy()
    expect(result.version).toBe('v1')
    expect(result.path).toBeTruthy()
    importedSkillId = result.skillId

    // Check files exist
    expect(fs.existsSync(path.join(result.path, 'meta.json'))).toBe(true)
    expect(fs.existsSync(path.join(result.path, 'content.txt'))).toBe(true)
    expect(fs.existsSync(path.join(result.path, 'tags.json'))).toBe(true)
    expect(fs.existsSync(path.join(result.path, 'auto_tag_log'))).toBe(true)
    expect(fs.existsSync(path.join(result.path, 'history'))).toBe(true)
  })

  test('meta.json has correct fields', () => {
    const data = skillService.getSkill(importedSkillId)
    const { meta } = data
    expect(meta.id).toBeTruthy()
    expect(meta.name).toBe('Python代码生成助手')
    expect(meta.purpose).toBe('code_generate')
    expect(meta.provider).toBe('provider_internal')
    expect(meta.type).toBe('skill')
    expect(meta.version).toBe('v1')
    expect(meta.version_count).toBe(1)
    expect(meta.status).toBe('active')
    expect(meta.content_file).toBe('content.txt')
    expect(meta.created_at).toBeTruthy()
    expect(meta.updated_at).toBeTruthy()
  })

  test('importSkill with type:agent stores agent type in meta', () => {
    const result = skillService.importSkill({
      importType: 'text',
      content: 'You are an autonomous agent.',
      meta: { name: 'TestAgent', purpose: 'automation', provider: 'test_prov', type: 'agent' },
    })
    const { meta } = skillService.getSkill(result.skillId)
    expect(meta.type).toBe('agent')
  })

  test('importSkill without type defaults to skill', () => {
    const result = skillService.importSkill({
      importType: 'text',
      content: 'You are a skill without explicit type.',
      meta: { name: 'NoTypeSkill', purpose: 'general', provider: 'test_prov' },
    })
    const { meta } = skillService.getSkill(result.skillId)
    expect(meta.type).toBe('skill')
  })

  test('listSkills returns items with type field', () => {
    const res = skillService.listSkills({})
    expect(res.items.length).toBeGreaterThan(0)
    res.items.forEach(item => {
      expect(item.type).toMatch(/^(skill|agent)$/)
    })
  })

  test('content.txt has correct content', () => {
    const data = skillService.getSkill(importedSkillId)
    expect(data.content).toBe(skillFixture.basic.content)
  })

  test('tags.json has empty manual and auto arrays', () => {
    const data = skillService.getSkill(importedSkillId)
    expect(data.tags.manual).toEqual([])
    expect(data.tags.auto).toEqual([])
  })

  test('should throw on missing required meta fields', () => {
    expect(() => skillService.importSkill({
      importType: 'text', content: 'x', meta: { name: '', purpose: 'p', provider: 'q' }
    })).toThrow()
    expect(() => skillService.importSkill({
      importType: 'text', content: 'x', meta: { name: 'n', purpose: '', provider: 'q' }
    })).toThrow()
  })
})

// ─── UC1-2: Add and filter by tags ─────────────────────────────────────────

describe('UC1-2: addTag and filter by tags', () => {
  let skillId

  beforeAll(() => {
    skillId = skillService.importSkill(skillFixture.minimal).skillId
  })

  test('addTag returns a tagId', () => {
    const result = skillService.addTag(skillId, 'Python')
    expect(result.tagId).toBeTruthy()
  })

  test('adding multiple tags stores them correctly', () => {
    skillService.addTag(skillId, '代码生成')
    skillService.addTag(skillId, '函数实现')
    const { tags } = skillService.getSkill(skillId)
    expect(tags.manual.length).toBeGreaterThanOrEqual(3)
    const values = tags.manual.map(t => t.value)
    expect(values).toContain('Python')
    expect(values).toContain('代码生成')
    expect(values).toContain('函数实现')
  })

  test('listSkills can filter by tags', () => {
    const result = skillService.listSkills({ tags: ['Python'] })
    const ids = result.items.map(i => i.id)
    expect(ids).toContain(skillId)
  })

  test('listSkills with non-matching tag returns no match', () => {
    const result = skillService.listSkills({ tags: ['NonExistentTag12345'] })
    const ids = result.items.map(i => i.id)
    expect(ids).not.toContain(skillId)
  })
})

// ─── UC1-3: Update Skill → new version ──────────────────────────────────────

describe('UC1-3: updateSkill → new version', () => {
  let skillId, v1Content

  beforeAll(() => {
    v1Content = '原始内容 v1'
    skillId = skillService.importSkill({
      importType: 'text',
      content: v1Content,
      meta: { name: 'VersionTestSkill', purpose: 'test_purpose', provider: 'test_prov' },
    }).skillId
  })

  test('updating content creates new version', () => {
    const result = skillService.updateSkill({
      skillId,
      currentVersion: 'v1',
      changes: { content: '新内容 v2' },
    })
    expect(result.newVersion).toBe('v2')
  })

  test('new version is reflected in meta', () => {
    const { meta } = skillService.getSkill(skillId)
    expect(meta.version).toBe('v2')
    expect(meta.version_count).toBe(2)
  })

  test('history diff record exists', () => {
    const found = skillService.findSkillDir(skillId)
    const histDir = path.join(found.fullPath, 'history')
    const files = fs.readdirSync(histDir)
    expect(files.length).toBeGreaterThan(0)
    const diffFile = require('../../main/services/file-service').readJson(
      path.join(histDir, files[0])
    )
    expect(diffFile.from_version).toBe('v1')
    expect(diffFile.to_version).toBe('v2')
    expect(diffFile.diff.content.before).toBe(v1Content)
    expect(diffFile.diff.content.after).toBe('新内容 v2')
  })
})

// ─── UC1-4: Full-text search ─────────────────────────────────────────────────

describe('UC1-4: searchSkills', () => {
  beforeAll(() => {
    skillService.importSkill(skillFixture.forSearch)
  })

  test('keyword in name returns match', () => {
    const result = skillService.searchSkills({ keyword: 'JS代码审查' })
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.some(i => i.name === 'JS代码审查')).toBe(true)
  })

  test('keyword in content returns match', () => {
    const result = skillService.searchSkills({ keyword: 'JavaScript专用代码审查' })
    expect(result.items.length).toBeGreaterThan(0)
  })

  test('non-existent keyword returns empty', () => {
    const result = skillService.searchSkills({ keyword: 'ZZZNOTEXISTINGKEYWORD999' })
    expect(result.items.length).toBe(0)
  })

  test('matchedIn field indicates match location', () => {
    const result = skillService.searchSkills({ keyword: 'JavaScript专用代码审查' })
    expect(result.items[0].matchedIn).toBeTruthy()
    expect(Array.isArray(result.items[0].matchedIn)).toBe(true)
  })
})

// ─── UC1-5: Rollback to previous version ────────────────────────────────────

describe('UC1-5: rollbackVersion', () => {
  let skillId, v1Content

  beforeAll(() => {
    v1Content = 'v1原始内容'
    skillId = skillService.importSkill({
      importType: 'text',
      content: v1Content,
      meta: { name: 'RollbackSkill', purpose: 'rollback_test', provider: 'test_prov' },
    }).skillId

    // Create v2
    skillService.updateSkill({ skillId, currentVersion: 'v1', changes: { content: 'v2新内容' } })
  })

  test('rollback creates a new version (not overwrite)', () => {
    const result = skillService.rollbackVersion(skillId, 'v1')
    expect(result.newVersion).toBe('v3')
  })

  test('content is restored to v1', () => {
    const { content } = skillService.getSkill(skillId)
    expect(content).toBe(v1Content)
  })

  test('version count increased', () => {
    const { meta } = skillService.getSkill(skillId)
    expect(meta.version_count).toBe(3)
  })
})

// ─── UC1-6: Auto-tag trigger ─────────────────────────────────────────────────

describe('UC1-6: triggerAutoTag (single)', () => {
  let skillId

  beforeAll(() => {
    skillId = skillService.importSkill({
      importType: 'text',
      content: 'You are a helpful Python coding assistant.',
      meta: { name: 'AutoTagSkill', purpose: 'code_help', provider: 'test_prov' },
    }).skillId
  })

  test('triggerAutoTag returns taskId', async () => {
    // We mock cli-lite-service for this test since we don't have a real CLI
    const cliLite = require('../../main/services/cli-lite-service')
    const originalAutoTagSkill = cliLite.autoTagSkill
    cliLite.autoTagSkill = jest.fn().mockResolvedValue({
      logRecord: {
        session_id: 'tmp_sess_1234567890',
        triggered_at: new Date().toISOString(),
        triggered_by: 'user',
        target_type: 'skill',
        target_id: skillId,
        status: 'completed',
        duration_ms: 1000,
        cli_version: '1.0.0',
        model_version: 'claude-opus-4-6',
        raw_output: '{"tags":["Python助手","代码生成"]}',
        parsed_tags: [{ value: 'Python助手' }, { value: '代码生成' }],
        error: null,
      },
      parsedTags: ['Python助手', '代码生成'],
      status: 'completed',
    })

    const { taskId, runTag } = await skillService.triggerAutoTag(skillId)
    expect(taskId).toBeTruthy()

    // Run the actual tag operation
    const tagResult = await runTag()
    expect(tagResult.status).toBe('completed')

    // Restore
    cliLite.autoTagSkill = originalAutoTagSkill
  })

  test('auto_tag_log is created after trigger', () => {
    const found = skillService.findSkillDir(skillId)
    const logDir = path.join(found.fullPath, 'auto_tag_log')
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
  })

  test('tags.json has pending auto tags', () => {
    const { tags } = skillService.getSkill(skillId)
    expect(tags.auto.length).toBeGreaterThan(0)
    expect(tags.auto.every(t => t.status === 'pending')).toBe(true)
  })
})

// ─── UC1-7: Batch auto-tag ────────────────────────────────────────────────────

describe('UC1-7: triggerAutoTagBatch', () => {
  let skillIds = []

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const { skillId } = skillService.importSkill({
        importType: 'text',
        content: `Batch skill ${i}: assists with coding tasks.`,
        meta: { name: `BatchSkill${i}`, purpose: 'batch_test', provider: 'test_prov' },
      })
      skillIds.push(skillId)
    }

    // Mock CLI calls for batch
    const cliLite = require('../../main/services/cli-lite-service')
    cliLite.autoTagSkill = jest.fn()
      .mockResolvedValueOnce({
        logRecord: {
          session_id: 'tmp_sess_batch1',
          triggered_at: new Date().toISOString(),
          triggered_by: 'batch',
          target_type: 'skill',
          target_id: skillIds[0],
          status: 'completed',
          duration_ms: 500,
          cli_version: '1.0.0',
          model_version: 'claude-opus-4-6',
          raw_output: '{"tags":["批量1"]}',
          parsed_tags: [{ value: '批量1' }],
          error: null,
        },
        parsedTags: ['批量1'],
        status: 'completed',
      })
      .mockRejectedValueOnce(new Error('CLI failed for skill 1'))
  })

  test('batch processes all skills serially', async () => {
    const { batchId, results } = await skillService.triggerAutoTagBatch(skillIds)
    expect(batchId).toBeTruthy()
    expect(results.length).toBe(2)
  })

  test('failed skill is marked in results', async () => {
    // Re-run to ensure we see failure behavior
    const cliLite = require('../../main/services/cli-lite-service')
    cliLite.autoTagSkill = jest.fn().mockRejectedValue(new Error('CLI_NOT_AVAILABLE'))

    const { results } = await skillService.triggerAutoTagBatch([skillIds[0]])
    expect(results[0].status).toBe('failed')
  })
})

// ─── UC1-8: Review auto tags ─────────────────────────────────────────────────

describe('UC1-8: reviewAutoTags', () => {
  let skillId

  beforeAll(async () => {
    skillId = skillService.importSkill({
      importType: 'text',
      content: 'Review test skill content.',
      meta: { name: 'ReviewSkill', purpose: 'review_test', provider: 'test_prov' },
    }).skillId

    // Manually inject pending auto tags
    const found = skillService.findSkillDir(skillId)
    const tagsPath = path.join(found.fullPath, 'tags.json')
    const fileService = require('../../main/services/file-service')
    fileService.writeJson(tagsPath, {
      manual: [],
      auto: [
        { id: 'tag-review-1', value: '待审核标签1', status: 'pending', generated_at: new Date().toISOString(), approved_at: null, rejected_at: null, log_ref: 'auto_tag_log/test.json' },
        { id: 'tag-review-2', value: '待审核标签2', status: 'pending', generated_at: new Date().toISOString(), approved_at: null, rejected_at: null, log_ref: 'auto_tag_log/test.json' },
        { id: 'tag-review-3', value: '待审核标签3', status: 'pending', generated_at: new Date().toISOString(), approved_at: null, rejected_at: null, log_ref: 'auto_tag_log/test.json' },
      ],
    })
  })

  test('approve action sets status to approved', () => {
    const result = skillService.reviewAutoTags(skillId, [
      { tagId: 'tag-review-1', action: 'approve' },
    ])
    expect(result.updated).toBe(1)
    const { tags } = skillService.getSkill(skillId)
    const t = tags.auto.find(t => t.id === 'tag-review-1')
    expect(t.status).toBe('approved')
    expect(t.approved_at).toBeTruthy()
  })

  test('reject action sets status to rejected', () => {
    skillService.reviewAutoTags(skillId, [{ tagId: 'tag-review-2', action: 'reject' }])
    const { tags } = skillService.getSkill(skillId)
    const t = tags.auto.find(t => t.id === 'tag-review-2')
    expect(t.status).toBe('rejected')
    expect(t.rejected_at).toBeTruthy()
  })

  test('modify action updates value and approves', () => {
    skillService.reviewAutoTags(skillId, [{ tagId: 'tag-review-3', action: 'modify', newValue: '已修改标签' }])
    const { tags } = skillService.getSkill(skillId)
    const t = tags.auto.find(t => t.id === 'tag-review-3')
    expect(t.status).toBe('approved')
    expect(t.value).toBe('已修改标签')
  })

  test('approved tag appears in effective tags', () => {
    const result = skillService.listSkills({ tags: ['待审核标签1'] })
    const ids = result.items.map(i => i.id)
    expect(ids).toContain(skillId)
  })
})

// ─── UC1-9: List with pagination and time filter ─────────────────────────────

describe('UC1-9: listSkills with pagination', () => {
  beforeAll(() => {
    // Import a few skills for listing
    for (let i = 0; i < 3; i++) {
      skillService.importSkill({
        importType: 'text',
        content: `Pagination test content ${i}`,
        meta: { name: `PaginationSkill${i}`, purpose: 'pagination_test', provider: 'test_prov' },
      })
    }
  })

  test('pagination returns correct page size', () => {
    const result = skillService.listSkills({ purpose: 'pagination_test', page: 1, pageSize: 2 })
    expect(result.items.length).toBeLessThanOrEqual(2)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(2)
    expect(result.total).toBeGreaterThanOrEqual(3)
  })

  test('page 2 returns different items', () => {
    const p1 = skillService.listSkills({ purpose: 'pagination_test', page: 1, pageSize: 2 })
    const p2 = skillService.listSkills({ purpose: 'pagination_test', page: 2, pageSize: 2 })
    const p1Ids = p1.items.map(i => i.id)
    const p2Ids = p2.items.map(i => i.id)
    // No overlap
    expect(p1Ids.some(id => p2Ids.includes(id))).toBe(false)
  })

  test('contentPreview is present and max 200 chars', () => {
    const result = skillService.listSkills({ purpose: 'pagination_test', page: 1, pageSize: 10 })
    for (const item of result.items) {
      expect(typeof item.contentPreview).toBe('string')
      expect(item.contentPreview.length).toBeLessThanOrEqual(200)
    }
  })

  test('sortBy created_at desc is default', () => {
    const result = skillService.listSkills({ purpose: 'pagination_test', page: 1, pageSize: 10 })
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].created_at >= result.items[i + 1].created_at).toBe(true)
    }
  })
})

// ─── UC1-10: getSkill - full detail ──────────────────────────────────────────

describe('UC1-10: getSkill full detail', () => {
  let skillId

  beforeAll(() => {
    skillId = skillService.importSkill(skillFixture.basic).skillId
  })

  test('returns meta, content, tags, and versions', () => {
    const data = skillService.getSkill(skillId)
    expect(data.meta).toBeTruthy()
    expect(data.content).toBeTruthy()
    expect(data.tags).toBeTruthy()
    expect(Array.isArray(data.versions)).toBe(true)
    expect(data.versions.length).toBeGreaterThan(0)
  })

  test('hasProvenance is false for non-recomposed skill', () => {
    const data = skillService.getSkill(skillId)
    expect(data.hasProvenance).toBe(false)
  })

  test('throws NOT_FOUND for unknown id', () => {
    expect(() => skillService.getSkill('00000000-0000-0000-0000-000000000000')).toThrow()
  })
})

// ─── UC1-11: Edit content + meta → version with both fields in diff ──────────

describe('UC1-11: updateSkill with content and meta', () => {
  let skillId

  beforeAll(() => {
    skillId = skillService.importSkill({
      importType: 'text',
      content: 'original content',
      meta: { name: 'EditBothSkill', description: 'original desc', purpose: 'edit_test', provider: 'test_prov' },
    }).skillId
  })

  test('update both content and meta.description creates new version', () => {
    const result = skillService.updateSkill({
      skillId,
      currentVersion: 'v1',
      changes: {
        content: 'updated content',
        meta: { description: 'updated description' },
      },
    })
    expect(result.newVersion).toBe('v2')
  })

  test('diff contains both content and meta changes', () => {
    const found = skillService.findSkillDir(skillId)
    const histDir = path.join(found.fullPath, 'history')
    const files = fs.readdirSync(histDir)
    expect(files.length).toBeGreaterThan(0)
    const fileService = require('../../main/services/file-service')
    const diff = fileService.readJson(path.join(histDir, files[0]))
    expect(diff.changed_fields).toContain('content')
    expect(diff.changed_fields).toContain('meta.description')
  })

  test('getDiff returns correct record', () => {
    const result = skillService.getDiff(skillId, 'v1', 'v2')
    expect(result.diff).toBeTruthy()
    expect(result.diff.diff.content.before).toBe('original content')
    expect(result.diff.diff.content.after).toBe('updated content')
  })
})

// ─── UC1-12: Update auto tag → searchable ─────────────────────────────────────

describe('UC1-12: updateTagValue (auto) → search index synced', () => {
  let skillId, tagId

  beforeAll(() => {
    skillId = skillService.importSkill({
      importType: 'text',
      content: 'Tag sync test skill.',
      meta: { name: 'TagSyncSkill', purpose: 'tag_sync_test', provider: 'test_prov' },
    }).skillId

    // Inject an approved auto tag
    const found = skillService.findSkillDir(skillId)
    const tagsPath = path.join(found.fullPath, 'tags.json')
    tagId = 'tag-sync-id-1'
    const fileService = require('../../main/services/file-service')
    fileService.writeJson(tagsPath, {
      manual: [],
      auto: [{
        id: tagId,
        value: '旧标签值',
        status: 'approved',
        generated_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        rejected_at: null,
        log_ref: 'auto_tag_log/test.json',
      }],
    })
  })

  test('update auto tag value', () => {
    const result = skillService.updateTagValue(skillId, tagId, 'auto', '新标签值')
    expect(result.updated).toBe(true)
  })

  test('new value is searchable', () => {
    const result = skillService.listSkills({ tags: ['新标签值'] })
    expect(result.items.some(i => i.id === skillId)).toBe(true)
  })

  test('old value is no longer searchable', () => {
    const result = skillService.listSkills({ tags: ['旧标签值'] })
    expect(result.items.some(i => i.id === skillId)).toBe(false)
  })
})
