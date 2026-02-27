'use strict'

/**
 * project-management.spec.js
 *
 * End-to-end tests for the Projects management page.
 * Generated from: tests/e2e/nl-test-scripts/project-management.md
 *
 * Test strategy:
 *   - One Electron instance shared across the entire describe block (beforeAll/afterAll)
 *   - Fresh isolated workspace pre-seeded with 1 skill + 1 baseline (required for project creation)
 *   - Tests run sequentially (workers:1 in playwright.config.js)
 *   - TC-P-001 creates the project used by TC-P-002, TC-P-003, TC-P-004
 *   - TC-P-004 (delete) runs last to avoid affecting other tests
 *   - All assertions are state-based (Playwright auto-wait); no fixed sleeps
 *   - Start-test skipped (requires real Claude CLI + API key)
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp, CDP_PORT }     = require('../helpers/app-launcher')
const { createTestWorkspace }     = require('../helpers/workspace-factory')
const AppPage     = require('../pages/app-page')
const ProjectPage = require('../pages/project-page')

const PROJECT_NAME = 'E2E Test Project'

test.describe('Project Management', () => {
  // ─── Shared state ────────────────────────────────────────────────────────────
  let browser, page, app, workspace
  let appPage, projectPage

  // ─── Setup / Teardown ────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // 1. Create fresh isolated workspace with 1 skill + 1 baseline
    workspace = createTestWorkspace({
      skills: [
        {
          key: 'alpha',
          name: 'Proj Skill Alpha',
          purpose: 'coding',
          provider: 'anthropic',
          content: 'You are a coding assistant.',
        },
      ],
      baselines: [
        {
          key: 'alpha',
          name: 'Proj Baseline Alpha',
          purpose: 'coding',
          provider: 'internal',
          cases: [
            { name: 'Case 1', input: 'Write hello world', expected_output: 'print("hello")' },
            { name: 'Case 2', input: 'Fizzbuzz', expected_output: 'FizzBuzz' },
          ],
        },
      ],
    })

    // 2. Launch Electron with isolated workspace + CDP port
    app = await launchApp(workspace.dir)

    // 3. Connect Playwright via CDP
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)
    const context = browser.contexts()[0]
    page = context.pages()[0] || await context.newPage()

    // 4. Wait for renderer to be fully initialized
    await page.waitForLoadState('domcontentloaded')

    // 5. Instantiate Page Object Models
    appPage     = new AppPage(page)
    projectPage = new ProjectPage(page)

    // 6. Navigate to Projects page
    await appPage.navigateTo('project')
  })

  test.afterAll(async () => {
    try { await browser.disconnect() } catch (_) {}
    if (app) await app.close()
    workspace.cleanup()
  })

  // ─── TC-P-001: Create project ─────────────────────────────────────────────────

  test('TC-P-001: create project — appears in list', async () => {
    await projectPage.createProject({ name: PROJECT_NAME })

    await appPage.expectSuccessNotification()
    await projectPage.expectProjectInList(PROJECT_NAME)
  })

  // ─── TC-P-002: Select project shows detail panel ──────────────────────────────

  test('TC-P-002: select project shows detail panel with correct name', async () => {
    await projectPage.selectProject(PROJECT_NAME)
    await projectPage.expectDetailShowing(PROJECT_NAME)
  })

  // ─── TC-P-003: Switch between all 5 tabs ─────────────────────────────────────

  test('TC-P-003: all 5 project tabs are accessible', async () => {
    await projectPage.selectProject(PROJECT_NAME)

    for (const tab of ['test', 'analysis', 'recompose', 'iteration', 'overview']) {
      await projectPage.switchTab(tab)
    }
  })

  // ─── TC-P-006: Overview tab content ──────────────────────────────────────────

  test('TC-P-006: overview tab shows skill and baseline names', async () => {
    await projectPage.selectProject(PROJECT_NAME)
    await projectPage.switchTab('overview')

    // "Skills (1)" section heading appears
    await expect(
      projectPage.overviewBody.getByText('Skills (1)')
    ).toBeVisible({ timeout: 5000 })

    // Skill name visible in overview
    await expect(
      projectPage.overviewBody.getByText('Proj Skill Alpha')
    ).toBeVisible()

    // "Baselines (1)" section heading appears
    await expect(
      projectPage.overviewBody.getByText('Baselines (1)')
    ).toBeVisible()

    // Baseline name visible in overview
    await expect(
      projectPage.overviewBody.getByText('Proj Baseline Alpha')
    ).toBeVisible()
  })

  // ─── TC-P-007: Test tab idle state ────────────────────────────────────────────

  test('TC-P-007: test tab shows Start button in idle state', async () => {
    await projectPage.switchTab('test')
    await projectPage.expectTestTabIdle()
  })

  // ─── TC-P-008: Recompose tab empty state ──────────────────────────────────────

  test('TC-P-008: recompose tab shows empty state before execution', async () => {
    await projectPage.switchTab('recompose')
    await expect(
      projectPage.recomposeBody.getByText('Recompose Skill')
    ).toBeVisible({ timeout: 5000 })
  })

  // ─── TC-P-009: Iteration tab controls ────────────────────────────────────────

  test('TC-P-009: iteration tab shows mode selector and Start button', async () => {
    await projectPage.switchTab('iteration')
    await expect(projectPage.iterModeSelect).toBeVisible({ timeout: 5000 })
    await expect(projectPage.iterStartBtn).toBeVisible()
    // Standard mode: advanced row should be hidden
    await expect(page.locator('#iter-advanced-row')).toBeHidden()
    // Switching to Explore reveals advanced row
    await projectPage.iterModeSelect.selectOption('explore')
    await expect(page.locator('#iter-advanced-row')).toBeVisible()
    // Restore to standard
    await projectPage.iterModeSelect.selectOption('standard')
  })

  // ─── TC-P-010: Search filters project list ────────────────────────────────────

  test('TC-P-010: search by name filters the project list', async () => {
    // Matching search — project should be visible
    await projectPage.searchProjects('E2E')
    await projectPage.expectProjectInList(PROJECT_NAME)

    // Non-matching search — list becomes empty
    await projectPage.searchProjects('ZZZNOMATCH')
    await expect(
      page.locator('#project-list .empty-state')
    ).toBeVisible({ timeout: 5000 })

    // Clear search — restore list
    await projectPage.searchProjects('')
    await projectPage.expectProjectInList(PROJECT_NAME)
  })

  // ─── TC-P-004: Delete project removes from list ───────────────────────────────

  test('TC-P-004: delete project — removed from list', async () => {
    await projectPage.selectProject(PROJECT_NAME)

    // Register dialog handler BEFORE triggering delete
    page.once('dialog', (dialog) => {
      console.log(`[TC-P-004] Accepting confirm dialog: "${dialog.message()}"`)
      dialog.accept()
    })

    await projectPage.clickDelete()

    await expect(
      projectPage.projectList.locator('.skill-item', { hasText: PROJECT_NAME })
    ).toHaveCount(0, { timeout: 8000 })
  })

  // ─── TC-P-005: Start test (requires CLI — skipped) ────────────────────────────

  test.skip('TC-P-005: start test run — requires real Claude CLI + API key', async () => {
    await projectPage.selectProject(PROJECT_NAME)
    await projectPage.switchTab('test')
    await projectPage.testStartBtn.click()
    await appPage.expectNotificationContaining('Test started')
  })
})
