'use strict'

const { expect } = require('@playwright/test')

/**
 * ProjectPage — Page Object Model for the Project management page.
 * Core interactions: create project, view detail, switch tabs,
 * start/stop test, navigate to analysis/recompose/iteration.
 */
class ProjectPage {
  constructor(page) {
    this.page = page

    this.createBtn   = page.locator('#project-create-btn')
    this.searchInput = page.locator('#project-search')
    this.projectList = page.locator('#project-list')

    this.detailEmpty = page.locator('#project-detail-empty')
    this.detailPanel = page.locator('#project-detail')
    this.detailName  = page.locator('#project-detail-name')
    this.cloneBtn    = page.locator('#project-clone-btn')
    this.exportBtn   = page.locator('#project-export-btn')
    this.deleteBtn   = page.locator('#project-delete-btn')

    // Tab buttons
    this.tabOverview   = page.locator('[data-ptab="overview"]')
    this.tabTest       = page.locator('[data-ptab="test"]')
    this.tabAnalysis   = page.locator('[data-ptab="analysis"]')
    this.tabRecompose  = page.locator('[data-ptab="recompose"]')
    this.tabIteration  = page.locator('[data-ptab="iteration"]')

    // Test tab
    this.testStartBtn  = page.locator('#test-start-btn')
    this.testPauseBtn  = page.locator('#test-pause-btn')
    this.testStopBtn   = page.locator('#test-stop-btn')
    this.testProgress  = page.locator('#test-progress-bar')

    // Analysis tab
    this.analysisRunBtn = page.locator('#analysis-run-btn')

    // Recompose tab
    this.recomposeBtn = page.locator('#recompose-execute-btn')

    // Iteration tab
    this.iterStartBtn  = page.locator('#iteration-start-btn')
    this.iterStopBtn   = page.locator('#iteration-stop-btn')
    this.iterSkillId   = page.locator('#iter-skill-id')
    this.iterMaxRounds = page.locator('#iter-max-rounds')

    // Iteration tab controls
    this.iterModeSelect = page.locator('#iter-mode')

    // Tab content bodies
    this.overviewBody   = page.locator('#project-overview-body')
    this.testResultsBody = page.locator('#test-results-body')
    this.analysisBody   = page.locator('#analysis-body')
    this.recomposeBody  = page.locator('#recompose-body')
    this.iterationBody  = page.locator('#iteration-body')

    // Create modal
    this.createModal    = page.locator('#project-create-modal')
    this.projectName    = page.locator('#project-name')
    this.projectModel   = page.locator('#project-model')
    this.createConfirm  = page.locator('#project-create-confirm')
  }

  /**
   * Create a project via the create modal.
   * Selects the first available skill and baseline by index.
   */
  async createProject({ name }) {
    await this.createBtn.click()
    await expect(this.createModal).toBeVisible({ timeout: 5000 })
    await this.projectName.fill(name)
    // Select all options in both multi-selects (Ctrl+A equivalent: selectOption with all values)
    const skillOptions = await this.page.locator('#project-skills-select option').all()
    const skillValues  = await Promise.all(skillOptions.map(o => o.getAttribute('value')))
    await this.page.locator('#project-skills-select').selectOption(skillValues)
    const baselineOptions = await this.page.locator('#project-baselines-select option').all()
    const baselineValues  = await Promise.all(baselineOptions.map(o => o.getAttribute('value')))
    await this.page.locator('#project-baselines-select').selectOption(baselineValues)
    await this.createConfirm.click()
  }

  async clickClone() {
    await this.cloneBtn.click()
  }

  async clickDelete() {
    await this.deleteBtn.click()
  }

  async selectProject(name) {
    // Use exact text match on .skill-item-name to avoid matching clone/prefix variants
    await this.projectList
      .locator('.skill-item')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .first()
      .click()
    await this.expectDetailShowing(name)
  }

  async switchTab(tabName) {
    await this.page.locator(`[data-ptab="${tabName}"]`).click()
    await expect(
      this.page.locator(`#ptab-${tabName}`)
    ).toBeVisible({ timeout: 5000 })
  }

  // ─── Assertions ────────────────────────────────────────────────────────────

  async expectProjectInList(name, { timeout = 8000 } = {}) {
    // Use exact text match to avoid partial matches (e.g. clone has same prefix)
    await expect(
      this.projectList
        .locator('.skill-item')
        .filter({ has: this.page.getByText(name, { exact: true }) })
        .first()
    ).toBeVisible({ timeout })
  }

  async expectDetailShowing(name, { timeout = 8000 } = {}) {
    await expect(this.detailPanel).toBeVisible({ timeout })
    await expect(this.detailName).toHaveText(name, { timeout })
  }

  /** Verify the test tab is in idle state: Start visible, Pause/Stop/Resume hidden. */
  async expectTestTabIdle({ timeout = 5000 } = {}) {
    await expect(this.testStartBtn).toBeVisible({ timeout })
    await expect(this.testPauseBtn).toBeHidden({ timeout })
    await expect(this.testStopBtn).toBeHidden({ timeout })
  }

  /** Search the project list and wait for the list to re-render (debounce = 350ms). */
  async searchProjects(keyword, { waitMs = 500 } = {}) {
    await this.searchInput.fill(keyword)
    await this.page.waitForTimeout(waitMs)
  }

  /** Assert the project list contains exactly N visible skill-item rows. */
  async expectProjectCount(n, { timeout = 5000 } = {}) {
    await expect(this.projectList.locator('.skill-item')).toHaveCount(n, { timeout })
  }
}

module.exports = ProjectPage
