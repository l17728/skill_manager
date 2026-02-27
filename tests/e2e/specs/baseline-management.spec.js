'use strict'

/**
 * baseline-management.spec.js
 *
 * End-to-end tests for the Baselines management page.
 * Generated from: tests/e2e/nl-test-scripts/baseline-management.md
 *
 * Test strategy:
 *   - One Electron instance shared across the entire describe block (beforeAll/afterAll)
 *   - Fresh isolated workspace pre-seeded with 2 baselines
 *     · Seed Baseline Alpha — 3 cases (used for delete-case test)
 *     · Seed Baseline Beta  — 2 cases (used for rollback test)
 *   - Tests run sequentially (workers:1 in playwright.config.js)
 *   - TC-B-005 (rollback) is self-contained: creates v2 then rolls back to v1 on Beta
 *   - TC-B-006 (delete case) uses the pre-seeded cases in Alpha; no prior test dependency
 *   - All assertions are state-based (Playwright auto-wait); no fixed sleeps
 *     except 450ms debounce wait after search input
 *   - Auto-tag test skipped (requires real Claude CLI + API key)
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp, CDP_PORT }      = require('../helpers/app-launcher')
const { createTestWorkspace }      = require('../helpers/workspace-factory')
const AppPage      = require('../pages/app-page')
const BaselinePage = require('../pages/baseline-page')

test.describe('Baseline Management', () => {
  // ─── Shared state ────────────────────────────────────────────────────────────
  let browser, page, app, workspace
  let appPage, baselinePage

  // ─── Setup / Teardown ────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // 1. Create fresh isolated workspace with 2 pre-seeded baselines
    workspace = createTestWorkspace({
      baselines: [
        {
          key: 'alpha',
          name: 'Seed Baseline Alpha',
          purpose: 'coding',
          provider: 'internal',
          cases: [
            { name: 'Case 1', input: 'Add two numbers', expected_output: '3' },
            { name: 'Case 2', input: 'Reverse a string', expected_output: 'olleh' },
            { name: 'Case 3', input: 'Sort a list', expected_output: '[1,2,3]' },
          ],
        },
        {
          key: 'beta',
          name: 'Seed Baseline Beta',
          purpose: 'writing',
          provider: 'external',
          // seedVersion:'v2' means the directory is named baseline_xxx_v2 and history contains
          // a v1→v2 entry, so the UI shows a Restore button for v1 without needing prompt()
          seedVersion: 'v2',
          cases: [
            { name: 'Case A', input: 'Write a haiku', expected_output: 'haiku poem' },
            { name: 'Case B', input: 'Summarise paragraph', expected_output: 'summary' },
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
    appPage      = new AppPage(page)
    baselinePage = new BaselinePage(page)

    // 6. Navigate to Baselines page
    await appPage.navigateTo('baseline')
  })

  test.afterAll(async () => {
    try { await browser.disconnect() } catch (_) {}
    if (app) await app.close()
    workspace.cleanup()
  })

  // ─── TC-B-001: Pre-seeded baselines visible ───────────────────────────────────

  test('TC-B-001: pre-seeded baselines are visible in list', async () => {
    await baselinePage.expectBaselineInList('Seed Baseline Alpha')
    await baselinePage.expectBaselineInList('Seed Baseline Beta')
  })

  // ─── TC-B-002: Select baseline shows detail panel ────────────────────────────

  test('TC-B-002: select baseline shows detail panel with correct name', async () => {
    await baselinePage.selectBaseline('Seed Baseline Alpha')
    await baselinePage.expectDetailShowing('Seed Baseline Alpha')
  })

  // ─── TC-B-003: Import baseline via manual tab ─────────────────────────────────

  test('TC-B-003: import baseline via manual tab — appears in list', async () => {
    await baselinePage.importBaseline({
      name:     'Imported Test Baseline',
      purpose:  'testing',
      provider: 'test-corp',
    })

    await appPage.expectSuccessNotification()
    await baselinePage.expectBaselineInList('Imported Test Baseline')
  })

  // ─── TC-B-004: Search filters list ───────────────────────────────────────────

  test('TC-B-004: search by keyword filters the baseline list', async () => {
    await baselinePage.search('Beta')

    await baselinePage.expectBaselineInList('Seed Baseline Beta')
    await baselinePage.expectBaselineNotInList('Seed Baseline Alpha')

    // Clear search to restore full list for subsequent tests
    await baselinePage.search('')
    await baselinePage.expectBaselineInList('Seed Baseline Alpha')
  })

  // ─── TC-B-005: Version rollback creates new version ──────────────────────────
  // Seed Baseline Beta is pre-seeded at v2 (history contains v1→v2 entry), so the
  // UI already shows a Restore button for v1 — no prompt() required.

  test('TC-B-005: rollback to v1 — creates new version in history', async () => {
    await baselinePage.selectBaseline('Seed Baseline Beta')

    // Beta is at v2, so v2 is "current" and v1 shows a Restore button
    await baselinePage.expectVersionInHistory('v2')

    // Rollback to v1 → creates v3
    await baselinePage.rollbackVersion('v1')
    await appPage.expectSuccessNotification()
    await baselinePage.expectVersionInHistory('v3')
  })

  // ─── TC-B-006: Delete case reduces case count ─────────────────────────────────

  test('TC-B-006: delete first case of Seed Baseline Alpha — case count decreases', async () => {
    await baselinePage.selectBaseline('Seed Baseline Alpha')

    // Seed Baseline Alpha has 3 pre-seeded cases
    await expect(page.locator('#baseline-detail-body')).toContainText('Test Cases (3)', { timeout: 8000 })

    // Handle the confirm() dialog for case deletion
    page.once('dialog', (dialog) => dialog.accept())

    // Click the first "Del" button in the cases table
    await page.locator('#baseline-detail-body [data-case-action="delete"]').first().click()

    await appPage.expectSuccessNotification()
    await expect(page.locator('#baseline-detail-body')).toContainText('Test Cases (2)', { timeout: 8000 })
  })

  // ─── TC-B-007: Auto-tag (requires CLI — skipped) ──────────────────────────────

  test.skip('TC-B-007: auto-tag trigger — requires real Claude CLI + API key', async () => {
    await baselinePage.selectBaseline('Seed Baseline Alpha')
    await baselinePage.autotagBtn.click()
    await appPage.expectNotificationContaining('Auto-tagging')
  })
})
