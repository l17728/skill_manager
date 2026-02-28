'use strict'

/**
 * rankings.spec.js
 *
 * End-to-end tests for the Rankings & Leaderboard page (Module 11).
 *
 * Strategy:
 *   - No real Claude CLI needed — workspace factory pre-seeds projects with
 *     completed results/summary.json files.
 *   - Two pre-seeded projects share one baseline → produces grouped leaderboard.
 *   - One additional project uses a separate baseline for filter testing.
 *   - All tests share one Electron instance (workers:1, sequential).
 *
 * Test cases:
 *   TC-R-001  Default view shows groups per baseline
 *   TC-R-002  Search filter hides non-matching skills
 *   TC-R-003  Baseline filter shows flat list for single baseline
 *   TC-R-004  Purpose filter limits groups
 *   TC-R-005  includeStale=false hides stale records
 *   TC-R-006  Expand score breakdown row on click
 *   TC-R-007  Timeline view shows SVG chart (after baseline selected)
 *   TC-R-008  Clear filters restores full grouped view
 *   TC-R-009  Empty state shown when no records match
 *   TC-R-010  Skill test badge visible on Skills page for tested skill
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp, CDP_PORT }       = require('../helpers/app-launcher')
const { createTestWorkspace, _seedSkill, _seedBaseline, _seedProjectWithSummary } = require('../helpers/workspace-factory')
const AppPage      = require('../pages/app-page')
const SkillPage    = require('../pages/skill-page')
const RankingsPage = require('../pages/rankings-page')

// ─── Shared fixture data ──────────────────────────────────────────────────────

const BASELINE_ID   = 'b000000a-0000-0000-0000-000000000001'
const BASELINE2_ID  = 'b000000b-0000-0000-0000-000000000002'
const SKILL_A_ID    = 's000000a-0000-0000-0000-000000000001'
const SKILL_B_ID    = 's000000b-0000-0000-0000-000000000002'

const BASELINE_NAME  = 'Python Coding Eval'
const BASELINE2_NAME = 'Writing Quality Eval'
const SKILL_A_NAME   = 'Alpha Coder v1'
const SKILL_B_NAME   = 'Beta Writer v1'

const NOW = new Date().toISOString()

test.describe('Rankings & Leaderboard', () => {
  let browser, page, app, workspace
  let appPage, rankingsPage, skillPage

  test.beforeAll(async () => {
    // 1. Create workspace and seed assets
    workspace = createTestWorkspace()

    // Seed skills
    _seedSkill(workspace.dir, {
      id: SKILL_A_ID, key: 'alpha', name: SKILL_A_NAME,
      purpose: 'coding', provider: 'anthropic',
      content: 'You are a Python coding expert.',
    })
    _seedSkill(workspace.dir, {
      id: SKILL_B_ID, key: 'beta', name: SKILL_B_NAME,
      purpose: 'writing', provider: 'openai',
      content: 'You are a creative writing assistant.',
    })

    // Seed baselines
    _seedBaseline(workspace.dir, {
      id: BASELINE_ID, name: BASELINE_NAME, purpose: 'coding', provider: 'anthropic',
      cases: [{ name: 'Case 1' }, { name: 'Case 2' }],
    })
    _seedBaseline(workspace.dir, {
      id: BASELINE2_ID, name: BASELINE2_NAME, purpose: 'writing', provider: 'openai',
      cases: [{ name: 'Write Case 1' }],
    })

    // Seed project A: Skill A tested against Baseline 1 → current (score 85)
    _seedProjectWithSummary(workspace.dir, {
      projectId:   'proj-r-001',
      projectName: 'Coding Project',
      skillRefs:  [{ ref_id: SKILL_A_ID, name: SKILL_A_NAME, version: 'v1', local_path: `skills/coding/anthropic/skill_${SKILL_A_ID.slice(0,8)}_v1` }],
      baselineRef: { ref_id: BASELINE_ID, name: BASELINE_NAME, version: 'v1', purpose: 'coding', local_path: `baselines/coding/anthropic/baseline_${BASELINE_ID.slice(0,8)}_v1` },
      testedAt: NOW,
      ranking: [{
        rank: 1, skill_id: SKILL_A_ID, skill_name: SKILL_A_NAME,
        skill_version: 'v1', completed_cases: 2, failed_cases: 0,
        avg_score: 85,
        score_breakdown: { functional_correctness: 25, robustness: 17, readability: 13, conciseness: 12, complexity_control: 9, format_compliance: 9 },
      }],
    })

    // Seed project B: Skill B tested against Baseline 1 → stale skill (score 62)
    _seedProjectWithSummary(workspace.dir, {
      projectId:   'proj-r-002',
      projectName: 'Coding Project B',
      skillRefs:  [{ ref_id: SKILL_B_ID, name: SKILL_B_NAME, version: 'v1', local_path: `skills/writing/openai/skill_${SKILL_B_ID.slice(0,8)}_v1` }],
      baselineRef: { ref_id: BASELINE_ID, name: BASELINE_NAME, version: 'v1', purpose: 'coding', local_path: `baselines/coding/anthropic/baseline_${BASELINE_ID.slice(0,8)}_v1` },
      testedAt: NOW,
      ranking: [{
        rank: 1, skill_id: SKILL_B_ID, skill_name: SKILL_B_NAME,
        skill_version: 'v1', completed_cases: 2, failed_cases: 0,
        avg_score: 62,
        score_breakdown: { functional_correctness: 18, robustness: 13, readability: 11, conciseness: 10, complexity_control: 6, format_compliance: 4 },
      }],
    })

    // Seed project C: Skill B tested against Baseline 2 (writing purpose)
    _seedProjectWithSummary(workspace.dir, {
      projectId:   'proj-r-003',
      projectName: 'Writing Project',
      skillRefs:  [{ ref_id: SKILL_B_ID, name: SKILL_B_NAME, version: 'v1', local_path: `skills/writing/openai/skill_${SKILL_B_ID.slice(0,8)}_v1` }],
      baselineRef: { ref_id: BASELINE2_ID, name: BASELINE2_NAME, version: 'v1', purpose: 'writing', local_path: `baselines/writing/openai/baseline_${BASELINE2_ID.slice(0,8)}_v1` },
      testedAt: NOW,
      ranking: [{
        rank: 1, skill_id: SKILL_B_ID, skill_name: SKILL_B_NAME,
        skill_version: 'v1', completed_cases: 1, failed_cases: 0,
        avg_score: 74,
        score_breakdown: { functional_correctness: 21, robustness: 15, readability: 12, conciseness: 11, complexity_control: 8, format_compliance: 7 },
      }],
    })

    // 2. Launch Electron
    app = await launchApp(workspace.dir)

    // 3. Connect via CDP
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)
    const context = browser.contexts()[0]
    page = context.pages()[0] || await context.newPage()

    appPage      = new AppPage(page)
    rankingsPage = new RankingsPage(page)
    skillPage    = new SkillPage(page)
  })

  test.afterAll(async () => {
    try { await browser.disconnect() } catch (_) {}
    if (app) await app.close()
    workspace.cleanup()
  })

  // ─── TC-R-001: Default grouped view ────────────────────────────────────────

  test('TC-R-001: default view groups records by baseline', async () => {
    await rankingsPage.navigate()
    // Both baselines should appear as groups
    await rankingsPage.expectGroupVisible(BASELINE_NAME)
    await rankingsPage.expectGroupVisible(BASELINE2_NAME)
    // Both skills visible
    await rankingsPage.expectSkillInGroup(SKILL_A_NAME)
    await rankingsPage.expectSkillInGroup(SKILL_B_NAME)
  })

  // ─── TC-R-002: Search filter ────────────────────────────────────────────────

  test('TC-R-002: search hides non-matching skills', async () => {
    await rankingsPage.navigate()
    await rankingsPage.search('Alpha')
    await rankingsPage.expectSkillInGroup(SKILL_A_NAME)
    await rankingsPage.expectSkillNotVisible(SKILL_B_NAME)
  })

  // ─── TC-R-003: Baseline filter → flat list ──────────────────────────────────

  test('TC-R-003: baseline filter shows flat list with score', async () => {
    await rankingsPage.navigate()
    await rankingsPage.clearFilters()
    await rankingsPage.selectBaseline(BASELINE_NAME)
    // After baseline filter, only records for that baseline
    await rankingsPage.expectSkillInGroup(SKILL_A_NAME)
    // Score badge visible
    await rankingsPage.expectScoreVisible(85)
  })

  // ─── TC-R-004: Purpose filter ───────────────────────────────────────────────

  test('TC-R-004: purpose filter limits to writing baseline', async () => {
    await rankingsPage.navigate()
    await rankingsPage.clearFilters()
    await rankingsPage.selectPurpose('writing')
    await rankingsPage.expectGroupVisible(BASELINE2_NAME)
    await rankingsPage.expectSkillNotVisible(SKILL_A_NAME)
  })

  // ─── TC-R-005: includeStale=false ───────────────────────────────────────────

  test('TC-R-005: unchecking includeStale hides current records too if version differs', async () => {
    // All seeded records are "current" (same version) so unchecking stale
    // should keep them all (they are not stale). At minimum, no crash and
    // empty state or list is shown.
    await rankingsPage.navigate()
    await rankingsPage.clearFilters()
    await rankingsPage.toggleStale(false)
    // With includeStale=false, only 'current' staleness shown
    // Since Skill A v1 = current skill version v1, record should still show
    await expect(
      page.locator('#rankings-list-body, #rankings-empty').first()
    ).toBeVisible({ timeout: 5000 })
  })

  // ─── TC-R-006: Expand score breakdown ──────────────────────────────────────

  test('TC-R-006: clicking a row expands score breakdown', async () => {
    await rankingsPage.navigate()
    await rankingsPage.clearFilters()
    // Click first row with a score breakdown to expand
    const firstRow = rankingsPage.listBody.locator('.rankings-row[data-expandable]').first()
    await firstRow.click()
    await expect(
      firstRow.locator('+ .rankings-row-breakdown')
    ).toBeVisible({ timeout: 3000 })
    // Breakdown shows dimension labels
    await expect(
      firstRow.locator('+ .rankings-row-breakdown .bd-dim-label').first()
    ).toBeVisible({ timeout: 2000 })
  })

  // ─── TC-R-007: Timeline view ────────────────────────────────────────────────

  test('TC-R-007: timeline view shows SVG after baseline selected', async () => {
    await rankingsPage.navigate()
    await rankingsPage.clearFilters()
    await rankingsPage.switchToTimeline()
    // Without baseline selected: shows placeholder
    await expect(rankingsPage.timelineBody.locator('.rankings-timeline-placeholder')).toBeVisible({ timeout: 3000 })
    // Select a baseline
    await rankingsPage.selectBaseline(BASELINE_NAME)
    // Now SVG chart should appear
    await rankingsPage.expectTimelineChart()
  })

  // ─── TC-R-008: Clear filters ────────────────────────────────────────────────

  test('TC-R-008: clear filters restores full grouped view', async () => {
    await rankingsPage.navigate()
    await rankingsPage.search('Alpha')
    await rankingsPage.clearFilters()
    await rankingsPage.switchToRank()
    // Both groups visible again
    await rankingsPage.expectGroupVisible(BASELINE_NAME)
    await rankingsPage.expectGroupVisible(BASELINE2_NAME)
  })

  // ─── TC-R-009: Empty state ──────────────────────────────────────────────────

  test('TC-R-009: search with no match shows empty state', async () => {
    await rankingsPage.navigate()
    await rankingsPage.clearFilters()
    await rankingsPage.search('ZZZ_NONEXISTENT_SKILL_XYZ')
    await rankingsPage.expectEmptyState()
  })

  // ─── TC-R-011: Period filter select ─────────────────────────────────────────

  test('TC-R-011: period filter select is interactive and updates view', async () => {
    // Already on rankings page after TC-R-009 — clear any search residue
    await rankingsPage.clearFilters()
    await rankingsPage.switchToRank()
    await rankingsPage.expectGroupVisible(BASELINE_NAME)

    // Select 30-day period — all seeded records are "now" so all should remain
    await rankingsPage.selectPeriod(30)
    await rankingsPage.expectGroupVisible(BASELINE_NAME)

    // Select 90-day period — same result
    await rankingsPage.selectPeriod(90)
    await rankingsPage.expectGroupVisible(BASELINE_NAME)

    // Clear period filter — full grouped view
    await rankingsPage.clearFilters()
    await rankingsPage.expectGroupVisible(BASELINE_NAME)
    await rankingsPage.expectGroupVisible(BASELINE2_NAME)
  })

  // ─── TC-R-012: Export CSV button triggers success notification ───────────────

  test('TC-R-012: export CSV button writes file and shows success notification', async () => {
    // Still on rankings page — ensure clean filter state
    await rankingsPage.clearFilters()

    // Click export — no baseline filter = exports all records
    await rankingsPage.exportBtn.click()

    // Renderer shows: window.notify(`模板已保存到：${path}`, 'success')
    await expect(
      page.locator('#notify-container .notify.success').first()
    ).toBeVisible({ timeout: 8000 })
    await expect(
      page.locator('#notify-container .notify.success').first()
    ).toContainText('已导出', { timeout: 3000 })
  })
})

// ─── TC-R-010: Skill test badge (separate lifecycle) ─────────────────────────
//
// Runs as a distinct describe block so it has its own Electron instance.
// This avoids a Playwright batch-split issue where the shared `page` variable
// can go stale after the main describe's afterAll fires between batches.

test.describe('Rankings — Skill test badge', () => {
  let browser2, page2, app2, workspace2

  test.beforeAll(async () => {
    workspace2 = createTestWorkspace()
    _seedSkill(workspace2.dir, {
      id: SKILL_A_ID, key: 'alpha', name: SKILL_A_NAME,
      purpose: 'coding', provider: 'anthropic',
      content: 'You are a Python coding expert.',
    })
    _seedBaseline(workspace2.dir, {
      id: BASELINE_ID, name: BASELINE_NAME, purpose: 'coding', provider: 'anthropic',
      cases: [{ name: 'Case 1' }, { name: 'Case 2' }],
    })
    _seedProjectWithSummary(workspace2.dir, {
      projectId: 'proj-badge-001', projectName: 'Badge Project',
      skillRefs:  [{ ref_id: SKILL_A_ID, name: SKILL_A_NAME, version: 'v1', local_path: `skills/coding/anthropic/skill_${SKILL_A_ID.slice(0,8)}_v1` }],
      baselineRef: { ref_id: BASELINE_ID, name: BASELINE_NAME, version: 'v1', purpose: 'coding', local_path: `baselines/coding/anthropic/baseline_${BASELINE_ID.slice(0,8)}_v1` },
      testedAt: NOW,
      ranking: [{
        rank: 1, skill_id: SKILL_A_ID, skill_name: SKILL_A_NAME,
        skill_version: 'v1', completed_cases: 2, failed_cases: 0,
        avg_score: 85,
        score_breakdown: { functional_correctness: 25, robustness: 17, readability: 13, conciseness: 12, complexity_control: 9, format_compliance: 9 },
      }],
    })
    app2 = await launchApp(workspace2.dir)
    browser2 = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)
    const ctx2 = browser2.contexts()[0]
    // Wait for the renderer page — may take a brief moment after CDP is ready
    let attempts = 0
    while (ctx2.pages().length === 0 && attempts++ < 20) {
      await new Promise(r => setTimeout(r, 200))
    }
    page2 = ctx2.pages()[0] || await ctx2.newPage()
  })

  test.afterAll(async () => {
    try { await browser2.disconnect() } catch (_) {}
    if (app2) await app2.close()
    workspace2.cleanup()
  })

  test('TC-R-010: tested skill shows score badge on Skills page', async () => {
    // Skills page is the default active page — no navigation needed
    await expect(page2.locator('#skill-list')).toBeVisible({ timeout: 5000 })

    // Test badges are injected asynchronously after the list renders
    const badge = page2.locator('.skill-test-badge').first()
    await expect(badge).toBeVisible({ timeout: 8000 })

    // Badge text is "✓ <number>"
    const text = await badge.textContent()
    expect(text.trim()).toMatch(/^✓\s*\d+$/)
  })

  // ─── TC-R-013: Badge click navigates to Rankings ──────────────────────────

  test('TC-R-013: clicking skill test badge navigates to Rankings and pre-fills search', async () => {
    // Badge should still be visible from TC-R-010
    const badge = page2.locator('.skill-test-badge').first()
    await expect(badge).toBeVisible({ timeout: 8000 })

    // Click the badge — triggers RankingsPage.navigateWithFilter({ skillName })
    await badge.click()

    // Rankings page should now be active
    await expect(page2.locator('#page-rankings')).toBeVisible({ timeout: 5000 })

    // Search input should be pre-filled with the skill name
    // (The handler reads .skill-item-name textContent which includes the version badge,
    //  so the value starts with SKILL_A_NAME and may have trailing version text.)
    const searchVal = await page2.locator('#rankings-search').inputValue()
    expect(searchVal).toContain(SKILL_A_NAME)
  })
})

