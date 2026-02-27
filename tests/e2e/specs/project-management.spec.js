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
