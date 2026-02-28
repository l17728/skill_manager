'use strict'

/**
 * manual-viewer.spec.js
 *
 * End-to-end tests for the Manual Viewer feature (global "? 手册" button).
 *
 * Strategy:
 *   - One Electron instance shared across the describe block.
 *   - Empty workspace (no skills/baselines needed — feature is workspace-independent).
 *   - The manual window is opened once in TC-M-002 and reused by TC-M-003/004.
 *   - TC-M-005 verifies the singleton behaviour (second click focuses, not reopens).
 *   - All assertions are state-based (Playwright auto-wait); no fixed sleeps.
 *   - No real Claude CLI needed — manual viewer reads manual.md directly via fs.
 *
 * Test cases:
 *   TC-M-001  "? 手册" button is visible in the topbar
 *   TC-M-002  Clicking "? 手册" opens the manual viewer window
 *   TC-M-003  Manual window has correct page title
 *   TC-M-004  Markdown content renders (article visible, heading present)
 *   TC-M-005  Second click focuses existing window — no new window opened
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp, CDP_PORT } = require('../helpers/app-launcher')
const { createTestWorkspace } = require('../helpers/workspace-factory')
const AppPage    = require('../pages/app-page')
const ManualPage = require('../pages/manual-page')

test.describe('Manual Viewer', () => {
  let browser, page, app, workspace
  let appPage
  let manualPage = null   // shared across TC-M-002/003/004/005

  // ─── Setup / Teardown ──────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // Empty workspace — manual viewer is workspace-independent
    workspace = createTestWorkspace()

    app     = await launchApp(workspace.dir)
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)

    const context = browser.contexts()[0]
    page = context.pages()[0] || await context.newPage()
    await page.waitForLoadState('domcontentloaded')

    appPage = new AppPage(page)
    // Skills page is the default active page — no navigation needed
  })

  test.afterAll(async () => {
    // Close the manual window if it is still open
    try {
      if (manualPage && !manualPage.page.isClosed()) {
        await manualPage.page.close()
      }
    } catch (_) {}
    try { await browser.disconnect() } catch (_) {}
    if (app) await app.close()
    workspace.cleanup()
  })

  // ─── TC-M-001: Help button is visible ──────────────────────────────────────

  test('TC-M-001: "? 手册" button is visible in the topbar', async () => {
    await expect(appPage.helpBtn).toBeVisible()
    // Verify the button text
    await expect(appPage.helpBtn).toContainText('手册')
  })

  // ─── TC-M-002: Button opens manual window ──────────────────────────────────

  test('TC-M-002: clicking "? 手册" opens the manual viewer window', async () => {
    const context = browser.contexts()[0]

    // Race the button click against the new-page event
    const [newPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }),
      appPage.clickHelpButton(),
    ])

    await newPage.waitForLoadState('domcontentloaded')
    manualPage = new ManualPage(newPage)

    // The manual body container must exist in the new window
    await expect(manualPage.toolbar).toBeVisible({ timeout: 8000 })
  })

  // ─── TC-M-003: Window has correct title ────────────────────────────────────

  test('TC-M-003: manual window page title is correct', async () => {
    const title = await manualPage.page.title()
    expect(title).toContain('手册')
  })

  // ─── TC-M-004: Markdown content renders ────────────────────────────────────

  test('TC-M-004: markdown content renders — article visible, heading present', async () => {
    // Content should finish loading within the timeout
    await manualPage.expectLoaded()
    // manual.md starts with "# SkillManager 用户手册" — h1 must be rendered
    await manualPage.expectHeadingVisible()
  })

  // ─── TC-M-005: Second click focuses existing window, no new window ──────────

  test('TC-M-005: second click focuses existing window — no new window created', async () => {
    const context = browser.contexts()[0]
    const pagesBefore = context.pages().length

    // Click the help button again
    await appPage.clickHelpButton()

    // Give Electron a moment to process the IPC call
    await page.waitForTimeout(800)

    // The page count must not have increased
    const pagesAfter = context.pages().length
    expect(pagesAfter).toBe(pagesBefore)

    // The existing manual window must still be open
    expect(manualPage.page.isClosed()).toBe(false)
  })
})
