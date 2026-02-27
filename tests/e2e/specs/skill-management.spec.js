'use strict'

/**
 * skill-management.spec.js
 *
 * End-to-end tests for the Skills management page.
 * Generated from: tests/e2e/nl-test-scripts/skill-management.md
 * Reviewed and committed 2026-02-27.
 *
 * Test strategy:
 *   - One Electron instance shared across the entire describe block (beforeAll/afterAll)
 *   - Fresh isolated workspace pre-seeded with 2 skills
 *   - Tests run sequentially (workers:1 in playwright.config.js)
 *   - Each test calls selectSkill() itself — no assumption about prior test state
 *   - TC-007 creates v2 itself (editSkill) before rolling back, so it doesn't depend on TC-004
 *   - TC-008 uses the skill imported by TC-001; if TC-001 passes, TC-008 is safe
 *   - All assertions are state-based (Playwright auto-wait); no fixed sleeps
 *     except the 450ms debounce wait after search input
 *   - Auto-tag test skipped (requires real Claude CLI + API key)
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp, CDP_PORT } = require('../helpers/app-launcher')
const { createTestWorkspace }  = require('../helpers/workspace-factory')
const AppPage   = require('../pages/app-page')
const SkillPage = require('../pages/skill-page')

test.describe('Skill Management', () => {
  // ─── Shared state ────────────────────────────────────────────────────────────
  let browser, page, app, workspace
  let appPage, skillPage

  // ─── Setup / Teardown ────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // 1. Create fresh isolated workspace with 2 pre-seeded skills
    workspace = createTestWorkspace({
      skills: [
        {
          key: 'alpha',
          name: 'Seed Skill Alpha',
          purpose: 'coding',
          provider: 'anthropic',
          content: 'You are a helpful coding assistant. Provide clear, concise code solutions.',
        },
        {
          key: 'beta',
          name: 'Seed Skill Beta',
          purpose: 'writing',
          provider: 'openai',
          content: 'You are a creative writing assistant. Help craft compelling narratives.',
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
    appPage   = new AppPage(page)
    skillPage = new SkillPage(page)

    // 6. Navigate to Skills page (default page; explicit for safety)
    await appPage.navigateTo('skill')
  })

  test.afterAll(async () => {
    // Disconnect Playwright without killing the browser (CDP-connected).
    // browser.close() on a CDP connection sends Browser.close and terminates Electron,
    // which races with app.close(). Using disconnect() avoids that race:
    // app.close() owns process termination via SIGTERM.
    try { await browser.disconnect() } catch (_) {}
    // Then terminate Electron
    if (app) await app.close()
    workspace.cleanup()
  })

  // ─── TC-001: Import skill via text paste ─────────────────────────────────────

  test('TC-001: import skill via paste — appears in list', async () => {
    await skillPage.importSkill({
      name:     'Imported Test Skill',
      purpose:  'testing',
      provider: 'test-corp',
      content:  'This is the test skill content for automated testing.',
      type:     'skill',
    })

    await appPage.expectSuccessNotification()
    await skillPage.expectSkillInList('Imported Test Skill')
  })

  // ─── TC-002: Pre-seeded skills visible ───────────────────────────────────────

  test('TC-002: pre-seeded skills are visible in list', async () => {
    await skillPage.expectSkillInList('Seed Skill Alpha')
    await skillPage.expectSkillInList('Seed Skill Beta')
  })

  // ─── TC-003: Select skill shows detail panel ─────────────────────────────────

  test('TC-003: select skill shows detail panel with correct name', async () => {
    await skillPage.selectSkill('Seed Skill Alpha')
    await skillPage.expectDetailShowing('Seed Skill Alpha')
  })

  // ─── TC-004: Edit skill content creates new version ──────────────────────────

  test('TC-004: edit skill content — new version appears in history', async () => {
    // Each test selects the skill itself — no dependency on TC-003's state
    await skillPage.selectSkill('Seed Skill Alpha')

    await skillPage.editSkill({
      content: 'Updated content after automated edit.',
    })

    await appPage.expectSuccessNotification()
    // Version history panel should now contain v2
    await skillPage.expectVersionInHistory('v2')
  })

  // ─── TC-005: Add manual tag ───────────────────────────────────────────────────

  test('TC-005: add manual tag — tag appears in detail', async () => {
    await skillPage.selectSkill('Seed Skill Alpha')

    await skillPage.addTag('my-auto-test-tag')

    await appPage.expectSuccessNotification()
    await skillPage.expectTagVisible('my-auto-test-tag')
  })

  // ─── TC-006: Search filters list ─────────────────────────────────────────────

  test('TC-006: search by keyword filters the skill list', async () => {
    await skillPage.search('Beta')

    await skillPage.expectSkillInList('Seed Skill Beta')
    await skillPage.expectSkillNotInList('Seed Skill Alpha')

    // Clear search to restore full list for subsequent tests
    await skillPage.search('')
    await skillPage.expectSkillInList('Seed Skill Alpha')
  })

  // ─── TC-007: Version rollback creates new version ────────────────────────────

  test('TC-007: rollback to v1 — creates new version in history', async () => {
    // Independent setup: select Beta (not Alpha) so we can edit it fresh
    // and rollback without caring about TC-004's state on Alpha
    await skillPage.selectSkill('Seed Skill Beta')

    // Create v2 so we have a v1 to rollback to
    await skillPage.editSkill({ content: 'Beta content edited for rollback test.' })
    await appPage.expectSuccessNotification()
    await skillPage.expectVersionInHistory('v2')

    // Now rollback to v1 → should create v3
    await skillPage.rollbackVersion('v1')
    await appPage.expectSuccessNotification()
    await skillPage.expectVersionInHistory('v3')
  })

  // ─── TC-008: Delete skill removes from list ───────────────────────────────────

  test('TC-008: delete skill — removed from list', async () => {
    // Relies on TC-001 having imported "Imported Test Skill".
    // If TC-001 passed, the skill is in this workspace's filesystem.
    await skillPage.selectSkill('Imported Test Skill')

    // Register dialog handler BEFORE triggering delete
    page.once('dialog', (dialog) => {
      console.log(`[TC-008] Accepting confirm dialog: "${dialog.message()}"`)
      dialog.accept()
    })

    await skillPage.clickDelete()

    await skillPage.expectSkillNotInList('Imported Test Skill')
  })

  // ─── TC-009: Auto-tag (requires CLI — skipped) ───────────────────────────────

  test.skip('TC-009: auto-tag trigger — requires real Claude CLI + API key', async () => {
    await skillPage.selectSkill('Seed Skill Alpha')
    await skillPage.autotagBtn.click()
    await appPage.expectNotificationContaining('Auto-tagging')
  })

  // ─── TC-010: Import as agent — shows A badge ─────────────────────────────────

  test('TC-010: import as agent — A badge visible in list', async () => {
    await skillPage.importSkill({
      name:     'My Test Agent',
      purpose:  'automation',
      provider: 'test-corp',
      content:  'You are an autonomous agent that performs tasks.',
      type:     'agent',
    })

    await appPage.expectSuccessNotification()
    await skillPage.expectSkillInList('My Test Agent')
    await skillPage.expectTypeBadge('My Test Agent', 'agent')
  })
})
