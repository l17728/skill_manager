'use strict'

const { expect } = require('@playwright/test')

/**
 * RankingsPage — Page Object Model for the Rankings & Leaderboard page.
 *
 * Covers:
 *   navigation, filter bar (search, baseline, purpose, period, stale),
 *   rank view, timeline view, export, staleness badges,
 *   skill test badge on the Skills page.
 */
class RankingsPage {
  constructor(page) {
    this.page = page

    // ─── Filter bar ──────────────────────────────────────────────────────────
    this.searchInput    = page.locator('#rankings-search')
    this.baselineSel    = page.locator('#rankings-baseline-select')
    this.purposeSel     = page.locator('#rankings-purpose-select')
    this.periodSel      = page.locator('#rankings-period-select')
    this.includeStale   = page.locator('#rankings-include-stale')
    this.clearBtn       = page.locator('#rankings-clear-btn')
    this.exportBtn      = page.locator('#rankings-export-btn')
    this.viewRankBtn    = page.locator('#rankings-view-rank-btn')
    this.viewTimelineBtn = page.locator('#rankings-view-timeline-btn')

    // ─── Content areas ───────────────────────────────────────────────────────
    this.listBody     = page.locator('#rankings-list-body')
    this.timelineBody = page.locator('#rankings-timeline-body')
    this.emptyState   = page.locator('#rankings-empty')
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  async navigate() {
    await this.page.locator('[data-page="rankings"]').click()
    // wait for initial render — list body is always present; use .first() to avoid
    // strict-mode violation when both list-body and empty-state are in the DOM
    await expect(
      this.page.locator('#rankings-list-body, #rankings-empty').first()
    ).toBeVisible({ timeout: 5000 })
  }

  // ─── Filter actions ───────────────────────────────────────────────────────────

  async search(keyword) {
    await this.searchInput.fill(keyword)
    // 300ms debounce
    await this.page.waitForTimeout(350)
  }

  async selectBaseline(name) {
    await this.baselineSel.selectOption({ label: name })
    await this.page.waitForTimeout(200)
  }

  async selectPurpose(purpose) {
    await this.purposeSel.selectOption({ label: purpose })
    await this.page.waitForTimeout(200)
  }

  async selectPeriod(days) {
    await this.periodSel.selectOption(String(days))
    await this.page.waitForTimeout(200)
  }

  async toggleStale(checked) {
    const current = await this.includeStale.isChecked()
    if (current !== checked) await this.includeStale.click()
    await this.page.waitForTimeout(200)
  }

  async clearFilters() {
    await this.clearBtn.click()
    await this.page.waitForTimeout(200)
  }

  // ─── View toggle ──────────────────────────────────────────────────────────────

  async switchToTimeline() {
    await this.viewTimelineBtn.click()
    await this.page.waitForTimeout(200)
  }

  async switchToRank() {
    await this.viewRankBtn.click()
    await this.page.waitForTimeout(200)
  }

  // ─── Assertions ───────────────────────────────────────────────────────────────

  async expectGroupVisible(baselineName) {
    await expect(
      this.listBody.locator('.rankings-group-title', { hasText: baselineName }).first()
    ).toBeVisible({ timeout: 5000 })
  }

  async expectSkillInGroup(skillName) {
    await expect(
      this.listBody.locator('.rankings-skill-name', { hasText: skillName }).first()
    ).toBeVisible({ timeout: 5000 })
  }

  async expectSkillNotVisible(skillName) {
    await expect(
      this.listBody.locator('.rankings-skill-name', { hasText: skillName }).first()
    ).not.toBeVisible({ timeout: 3000 })
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible({ timeout: 5000 })
  }

  async expectScoreVisible(score) {
    await expect(
      this.listBody.locator('.rankings-score', { hasText: String(score) })
    ).toBeVisible({ timeout: 5000 })
  }

  async expectStalenessIcon(icon) {
    await expect(
      this.listBody.locator('.staleness-badge', { hasText: icon })
    ).toBeVisible({ timeout: 5000 })
  }

  async expectTimelineChart() {
    await expect(
      this.timelineBody.locator('svg')
    ).toBeVisible({ timeout: 5000 })
  }

  async expectBreakdownVisible(skillName) {
    // Click the row to expand breakdown
    const row = this.listBody.locator('.rankings-row', { hasText: skillName }).first()
    await row.click()
    await expect(
      row.locator('+ .rankings-row-breakdown')
    ).toBeVisible({ timeout: 3000 })
  }

  async expectBaselineOption(name) {
    await expect(this.baselineSel.locator('option', { hasText: name })).toBeVisible({ timeout: 3000 })
  }

  async expectPurposeOption(purpose) {
    await expect(this.purposeSel.locator('option', { hasText: purpose })).toBeVisible({ timeout: 3000 })
  }
}

module.exports = RankingsPage
