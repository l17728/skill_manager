'use strict'

const { expect } = require('@playwright/test')

/**
 * AppPage — Global app elements shared across all pages.
 * Covers: navigation tabs, CLI status indicator, toast notifications.
 */
class AppPage {
  constructor(page) {
    this.page = page

    // Navigation
    this.navSkill    = page.locator('.nav-tab[data-page="skill"]')
    this.navBaseline = page.locator('.nav-tab[data-page="baseline"]')
    this.navProject  = page.locator('.nav-tab[data-page="project"]')

    // Help / manual button
    this.helpBtn = page.locator('#help-btn')

    // CLI status
    this.cliDot          = page.locator('#cli-dot')
    this.cliVersionLabel = page.locator('#cli-version-label')

    // Notifications
    this.notifyContainer = page.locator('#notify-container')
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  async navigateTo(pageName) {
    await this.page.locator(`.nav-tab[data-page="${pageName}"]`).click()
    // Wait for the target page to become active
    await expect(
      this.page.locator(`#page-${pageName}`)
    ).toHaveClass(/active/, { timeout: 5000 })
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  /** Wait for any success toast to appear (uses .first() to tolerate multiple simultaneous toasts) */
  async expectSuccessNotification(timeout = 8000) {
    await expect(
      this.notifyContainer.locator('.notify.success').first()
    ).toBeVisible({ timeout })
  }

  /** Wait for any error toast to appear (uses .first() to tolerate multiple simultaneous toasts) */
  async expectErrorNotification(timeout = 8000) {
    await expect(
      this.notifyContainer.locator('.notify.error').first()
    ).toBeVisible({ timeout })
  }

  /** Wait for a toast containing specific text */
  async expectNotificationContaining(text, timeout = 8000) {
    await expect(
      this.notifyContainer.locator('.notify', { hasText: text })
    ).toBeVisible({ timeout })
  }

  // ─── Help / Manual ─────────────────────────────────────────────────────────

  /**
   * Click the "? 手册" button in the topbar.
   * Returns a Promise so the caller can race it with context.waitForEvent('page').
   */
  async clickHelpButton() {
    await this.helpBtn.click()
  }

  // ─── CLI Status ────────────────────────────────────────────────────────────

  async expectCliOnline(timeout = 10000) {
    await expect(this.cliDot).toHaveClass(/online/, { timeout })
  }

  async expectCliOffline() {
    await expect(this.cliDot).toHaveClass(/offline/, { timeout: 5000 })
  }
}

module.exports = AppPage
