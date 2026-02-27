'use strict'

const { expect } = require('@playwright/test')

/**
 * BaselinePage — Page Object Model for the Baseline management page.
 * Core interactions: import, select, view cases, version rollback.
 */
class BaselinePage {
  constructor(page) {
    this.page = page

    this.importBtn    = page.locator('#baseline-import-btn')
    this.searchInput  = page.locator('#baseline-search')
    this.baselineList = page.locator('#baseline-list')
    this.pagination   = page.locator('#baseline-pagination')

    this.detailEmpty  = page.locator('#baseline-detail-empty')
    this.detailPanel  = page.locator('#baseline-detail')
    this.detailName   = page.locator('#baseline-detail-name')
    this.addCaseBtn   = page.locator('#baseline-add-case-btn')
    this.autotagBtn   = page.locator('#baseline-autotag-btn')
    this.detailBody   = page.locator('#baseline-detail-body')
    this.auxBody      = page.locator('#baseline-aux-body')

    // Import modal
    this.importModal    = page.locator('#baseline-import-modal')
    this.importName     = page.locator('#baseline-import-name')
    this.importPurpose  = page.locator('#baseline-import-purpose')
    this.importProvider = page.locator('#baseline-import-provider')
    this.importConfirm  = page.locator('#baseline-import-confirm')
  }

  /**
   * Import a baseline via the Manual tab (0 cases — just name/purpose/provider).
   */
  async importBaseline({ name, purpose, provider }) {
    await this.importBtn.click()
    await expect(this.importModal).toBeVisible({ timeout: 5000 })
    // Ensure Manual tab is active (it is by default, but be explicit)
    await this.importModal.locator('.import-tab[data-tab="manual"]').click()
    await this.importName.fill(name)
    await this.importPurpose.fill(purpose)
    await this.importProvider.fill(provider)
    await this.importConfirm.click()
  }

  async selectBaseline(name) {
    await this.baselineList
      .locator('.skill-item', { hasText: name })
      .first()
      .click()
    await this.expectDetailShowing(name)
  }

  async rollbackVersion(version) {
    await this.auxBody
      .locator(`[data-rollback-version="${version}"]`)
      .click()
  }

  async search(keyword) {
    await this.searchInput.fill(keyword)
    await this.page.waitForTimeout(450)
  }

  // ─── Assertions ────────────────────────────────────────────────────────────

  async expectBaselineInList(name, { timeout = 8000 } = {}) {
    await expect(
      this.baselineList.locator('.skill-item', { hasText: name })
    ).toBeVisible({ timeout })
  }

  async expectBaselineNotInList(name, { timeout = 8000 } = {}) {
    await expect(
      this.baselineList.locator('.skill-item', { hasText: name })
    ).toHaveCount(0, { timeout })
  }

  async expectDetailShowing(name, { timeout = 8000 } = {}) {
    await expect(this.detailPanel).toBeVisible({ timeout })
    await expect(this.detailName).toHaveText(name, { timeout })
  }

  async expectVersionInHistory(version, { timeout = 8000 } = {}) {
    await expect(
      this.auxBody.locator('.version-badge', { hasText: version })
    ).toBeVisible({ timeout })
  }
}

module.exports = BaselinePage
