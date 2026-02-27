'use strict'

const { expect } = require('@playwright/test')

/**
 * SkillPage — Page Object Model for the Skills management page.
 *
 * Covers all user-facing actions:
 *   import, select, edit, add/remove tag, tag review (approve/reject),
 *   search, filter, pagination, version rollback, delete.
 *
 * All assertion methods use Playwright state-based waiting
 * (no fixed sleeps) and throw descriptive errors on timeout.
 */
class SkillPage {
  constructor(page) {
    this.page = page

    // ─── List section ────────────────────────────────────────────────────────
    this.importBtn    = page.locator('#skill-import-btn')
    this.searchInput  = page.locator('#skill-search')
    this.tagInput     = page.locator('#skill-tag-input')
    this.activeTagsEl = page.locator('#skill-active-tags')
    this.purposeInput = page.locator('#skill-purpose-input')
    this.providerInput= page.locator('#skill-provider-input')
    this.skillList    = page.locator('#skill-list')
    this.pagination   = page.locator('#skill-pagination')

    // ─── Detail section ──────────────────────────────────────────────────────
    this.detailEmpty  = page.locator('#skill-detail-empty')
    this.detailPanel  = page.locator('#skill-detail')
    this.detailName   = page.locator('#skill-detail-name')
    this.editBtn      = page.locator('#skill-edit-btn')
    this.autotagBtn   = page.locator('#skill-autotag-btn')
    this.deleteBtn    = page.locator('#skill-delete-btn')
    this.detailBody   = page.locator('#skill-detail-body')
    this.auxBody      = page.locator('#skill-aux-body')

    // ─── Import modal ────────────────────────────────────────────────────────
    this.importModal    = page.locator('#skill-import-modal')
    this.importName     = page.locator('#skill-import-name')
    this.importPurpose  = page.locator('#skill-import-purpose')
    this.importProvider = page.locator('#skill-import-provider')
    this.importType     = page.locator('#skill-import-type')
    this.importContent  = page.locator('#skill-import-content')
    this.importConfirm  = page.locator('#skill-import-confirm')

    // ─── Edit modal ──────────────────────────────────────────────────────────
    this.editModal   = page.locator('#skill-edit-modal')
    this.editName    = page.locator('#skill-edit-name')
    this.editContent = page.locator('#skill-edit-content')
    this.editConfirm = page.locator('#skill-edit-confirm')

    // ─── Add-tag modal ───────────────────────────────────────────────────────
    this.addTagModal   = page.locator('#add-tag-modal')
    this.addTagValue   = page.locator('#add-tag-value')
    this.addTagConfirm = page.locator('#add-tag-confirm')
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  /**
   * Open the import modal, fill in all fields (text/paste tab), and confirm.
   * @param {{ name, purpose, provider, content, description?, author?, type? }} opts
   */
  async importSkill(opts) {
    await this.importBtn.click()
    await expect(this.importModal).toHaveClass(/open/, { timeout: 3000 })

    await this.importName.fill(opts.name)
    await this.importPurpose.fill(opts.purpose)
    await this.importPurpose.blur()   // triggers purpose-suggestion check
    await this.importProvider.fill(opts.provider)

    if (opts.type) {
      await this.importType.selectOption(opts.type)
    }

    // Ensure "Text" import tab is active (first tab / default)
    const textTab = this.page.locator('#skill-import-modal .import-tab[data-tab="text"]')
    if (await textTab.count() > 0) {
      await textTab.click()
    }

    await this.importContent.fill(opts.content)
    await this.importConfirm.click()
  }

  /**
   * Click a skill in the list by its display name.
   */
  async selectSkill(name) {
    await this.skillList
      .locator('.skill-item', { hasText: name })
      .first()
      .click()
    await this.expectDetailShowing(name)
  }

  /**
   * Open the edit modal and update one or both of: name, content.
   */
  async editSkill(opts) {
    await this.editBtn.click()
    await expect(this.editModal).toHaveClass(/open/, { timeout: 3000 })

    if (opts.name     !== undefined) await this.editName.fill(opts.name)
    if (opts.content  !== undefined) await this.editContent.fill(opts.content)

    await this.editConfirm.click()
  }

  /**
   * Click "+ Add" tag button, fill value, confirm.
   */
  async addTag(value) {
    // The add-tag button is inside detail-body, rendered dynamically
    await this.detailBody.locator('#skill-add-tag-btn').click()
    await expect(this.addTagModal).toHaveClass(/open/, { timeout: 3000 })
    await this.addTagValue.fill(value)
    await this.addTagConfirm.click()
  }

  /**
   * Click the × chip to remove an active list-filter tag.
   */
  async removeActiveFilter(tag) {
    await this.activeTagsEl
      .locator(`.filter-chip-remove[data-tag="${tag}"]`)
      .click()
  }

  /**
   * Type into the search box (debounced, waits 400ms after typing).
   * Pass empty string to clear.
   */
  async search(keyword) {
    await this.searchInput.fill(keyword)
    // Debounce is 350ms; wait a bit longer to ensure list reload
    await this.page.waitForTimeout(450)
  }

  /**
   * Approve or reject a pending auto-tag in the detail body.
   * @param {string} tagId
   * @param {'approve'|'reject'} action
   */
  async reviewAutoTag(tagId, action) {
    await this.detailBody
      .locator(`[data-review-action="${action}"][data-tag-id="${tagId}"]`)
      .click()
  }

  /**
   * Click the Restore button for a specific version in the aux panel.
   * @param {string} version  e.g. 'v1'
   */
  async rollbackVersion(version) {
    await this.auxBody
      .locator(`[data-rollback-version="${version}"]`)
      .click()
  }

  /**
   * Click the Delete button (caller must handle the confirm() dialog).
   */
  async clickDelete() {
    await this.deleteBtn.click()
  }

  // ─── Assertions ────────────────────────────────────────────────────────────

  /** Skill with given name is visible in the list */
  async expectSkillInList(name, { timeout = 8000 } = {}) {
    await expect(
      this.skillList.locator('.skill-item', { hasText: name })
    ).toBeVisible({ timeout })
  }

  /** Skill with given name is NOT in the list */
  async expectSkillNotInList(name, { timeout = 8000 } = {}) {
    await expect(
      this.skillList.locator('.skill-item', { hasText: name })
    ).toHaveCount(0, { timeout })
  }

  /** Detail panel shows the specified skill name */
  async expectDetailShowing(name, { timeout = 8000 } = {}) {
    await expect(this.detailPanel).toBeVisible({ timeout })
    await expect(this.detailName).toHaveText(name, { timeout })
  }

  /** Detail panel is in the empty/unselected state */
  async expectDetailEmpty() {
    await expect(this.detailEmpty).toBeVisible({ timeout: 5000 })
  }

  /** A tag with given value is visible anywhere in the detail body */
  async expectTagVisible(value, { timeout = 8000 } = {}) {
    await expect(
      this.detailBody.locator('.tag', { hasText: value })
    ).toBeVisible({ timeout })
  }

  /** A tag is no longer visible in the detail body */
  async expectTagNotVisible(value) {
    await expect(
      this.detailBody.locator('.tag', { hasText: value })
    ).toHaveCount(0, { timeout: 5000 })
  }

  /** A version badge is visible in the version history (aux panel) */
  async expectVersionInHistory(version, { timeout = 8000 } = {}) {
    await expect(
      this.auxBody.locator('.version-badge', { hasText: version })
    ).toBeVisible({ timeout })
  }

  /**
   * The "current" version badge in the Metadata section matches expected.
   * The first .version-badge inside detail-body is the current version.
   */
  async expectCurrentVersion(version, { timeout = 8000 } = {}) {
    await expect(
      this.detailBody.locator('.version-badge').first()
    ).toHaveText(version, { timeout })
  }

  /** Number of skills visible in the list matches count */
  async expectSkillCount(count, { timeout = 8000 } = {}) {
    await expect(
      this.skillList.locator('.skill-item')
    ).toHaveCount(count, { timeout })
  }

  /**
   * A type badge for the given skill name is visible in the list with the expected type.
   * @param {string} name  skill name in the list item
   * @param {'skill'|'agent'} type  expected type label ('S' for skill, 'A' for agent)
   */
  async expectTypeBadge(name, type, { timeout = 8000 } = {}) {
    const expectedText = type === 'agent' ? 'A' : 'S'
    await expect(
      this.skillList
        .locator('.skill-item', { hasText: name })
        .first()
        .locator(`.type-badge.${type}`)
    ).toHaveText(expectedText, { timeout })
  }
}

module.exports = SkillPage
