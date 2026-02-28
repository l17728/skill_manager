'use strict'

const { expect } = require('@playwright/test')

/**
 * ManualPage — Page Object Model for the manual viewer BrowserWindow.
 *
 * The manual viewer opens as a *separate* Electron BrowserWindow, so this POM
 * receives the Playwright `Page` object that represents that second window,
 * obtained via `context.waitForEvent('page')` in the spec.
 */
class ManualPage {
  constructor(page) {
    this.page = page

    this.toolbar = page.locator('#manual-toolbar')
    this.title   = page.locator('.manual-title')
    this.loading = page.locator('#manual-loading')
    this.error   = page.locator('#manual-error')
    this.content = page.locator('#manual-content')
  }

  /**
   * Wait until the markdown content is fully rendered.
   * The loading div disappears and #manual-content becomes visible.
   */
  async waitForContent(timeout = 12000) {
    await expect(this.content).toBeVisible({ timeout })
  }

  /**
   * Assert that content loaded successfully (no error, no spinner).
   */
  async expectLoaded() {
    await this.waitForContent()
    await expect(this.error).toBeHidden()
    await expect(this.loading).toBeHidden()
  }

  /**
   * Assert at least one heading element rendered inside the article.
   */
  async expectHeadingVisible() {
    await expect(
      this.content.locator('h1, h2, h3').first()
    ).toBeVisible({ timeout: 5000 })
  }
}

module.exports = ManualPage
