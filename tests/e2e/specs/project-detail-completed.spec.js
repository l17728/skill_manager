'use strict'

/**
 * project-detail-completed.spec.js
 *
 * End-to-end tests for the Project detail view tabs using a
 * PRE-SEEDED completed project (no real CLI required).
 *
 * Strategy:
 *   - Workspace factory writes a completed project directory with:
 *       results/summary.json   — drives Test tab rankings
 *       analysis_report.json   — drives Analysis tab
 *       iterations/iteration_report.json — drives Iteration tab
 *   - All IPC calls (test:getProgress, analysis:getReport, iteration:getReport)
 *     are read-only disk ops — no Claude CLI involvement
 *   - One Electron instance shared across all tests in this suite
 */

const { test, expect, chromium } = require('@playwright/test')
const { launchApp, CDP_PORT }    = require('../helpers/app-launcher')
const { createTestWorkspace }    = require('../helpers/workspace-factory')
const AppPage     = require('../pages/app-page')
const ProjectPage = require('../pages/project-page')

const COMPLETED_PROJECT_NAME = 'Completed Test Project'
const BEST_SKILL_NAME        = 'Alpha Coder'
const PROJECT_ID             = 'completed-proj-e2e-test-001'

// ─── Pre-built data fixtures ─────────────────────────────────────────────────

const SUMMARY = {
  project_id:   PROJECT_ID,
  generated_at: new Date().toISOString(),
  total_cases:  2,
  ranking: [{
    skill_id:        'skill-alpha-001',
    skill_name:      BEST_SKILL_NAME,
    skill_version:   'v1',
    completed_cases: 2,
    failed_cases:    0,
    avg_score:       85.0,
    score_breakdown: {
      functional_correctness: 25, robustness: 16, readability: 13,
      conciseness: 13, complexity_control: 9, format_compliance: 9,
    },
    rank: 1,
  }],
}

const ANALYSIS_REPORT = {
  project_id:     PROJECT_ID,
  generated_at:   new Date().toISOString(),
  best_skill_id:  'skill-alpha-001',
  best_skill_name: BEST_SKILL_NAME,
  dimension_leaders: {
    functional_correctness: 'skill-alpha-001',
    robustness:             'skill-alpha-001',
  },
  advantage_segments: [{
    id:         'seg_001',
    skill_id:   'skill-alpha-001',
    skill_name: BEST_SKILL_NAME,
    type:       'role',
    dimension:  'functional_correctness',
    content:    'You are an expert Python developer with 10 years of experience.',
    reason:     'Strong role definition improves functional correctness.',
  }],
  issues: [],
}

const ITERATION_REPORT = {
  project_id:    PROJECT_ID,
  generated_at:  new Date().toISOString(),
  status:        'completed',
  total_rounds:  2,
  best_round:    2,
  best_avg_score: 90.0,
  stop_reason:   'max_rounds',
  rounds: [
    { round: 1, skill_id: 'skill-alpha-001', avg_score: 85.0, score_delta: null,  strategy: 'GREEDY' },
    { round: 2, skill_id: 'skill-iter-v2',   avg_score: 90.0, score_delta: 5.0,   strategy: 'DIMENSION_FOCUS' },
  ],
}

// ─── Suite ───────────────────────────────────────────────────────────────────

test.describe('Project Detail — Completed Project', () => {
  let browser, page, app, workspace
  let appPage, projectPage

  test.beforeAll(async () => {
    workspace = createTestWorkspace({
      skills: [{
        key:      'alpha',
        name:     BEST_SKILL_NAME,
        purpose:  'coding',
        provider: 'test',
        content:  'You are an expert Python developer.',
      }],
      projects: [{
        key:      'completed',
        id:       PROJECT_ID,
        name:     COMPLETED_PROJECT_NAME,
        status:   'completed',
        skills: [{
          ref_id:     'skill-alpha-001',
          name:       BEST_SKILL_NAME,
          version:    'v1',
          local_path: 'skills/skill_alpha_v1',
        }],
        baselines: [{
          ref_id:     'baseline-alpha-001',
          name:       'Alpha Baseline',
          version:    'v1',
          local_path: 'baselines/coding/test/baseline_alphax_v1',
        }],
        progress: { total_tasks: 4, completed_tasks: 4, failed_tasks: 0, last_checkpoint: 4 },
        summary:         SUMMARY,
        analysisReport:  ANALYSIS_REPORT,
        iterationReport: ITERATION_REPORT,
      }],
    })

    app = await launchApp(workspace.dir)
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)
    const context = browser.contexts()[0]
    page = context.pages()[0] || await context.newPage()
    await page.waitForLoadState('domcontentloaded')

    appPage     = new AppPage(page)
    projectPage = new ProjectPage(page)

    await appPage.navigateTo('project')
    // Seeded project appears in list automatically — open it
    await projectPage.selectProject(COMPLETED_PROJECT_NAME)
  })

  test.afterAll(async () => {
    try { await browser.disconnect() } catch (_) {}
    if (app) await app.close()
    workspace.cleanup()
  })

  // ─── TC-PC-001: Test tab shows completed rankings ─────────────────────────

  test('TC-PC-001: test tab shows completed ranking from pre-seeded summary', async () => {
    await projectPage.switchTab('test')

    // Progress bar shows 100%
    await expect(
      page.locator('#test-progress-label')
    ).toHaveText(/4 \/ 4 cases \(100%\)/, { timeout: 8000 })

    // Rankings rendered — at least one .round-row
    await expect(
      projectPage.testResultsBody.locator('.round-row').first()
    ).toBeVisible({ timeout: 8000 })

    // Best skill name visible in ranking
    await expect(
      projectPage.testResultsBody.getByText(BEST_SKILL_NAME)
    ).toBeVisible()

    // Score visible (85.0)
    await expect(
      projectPage.testResultsBody.getByText('85')
    ).toBeVisible()
  })

  // ─── TC-PC-002: Analysis tab renders pre-seeded report ───────────────────

  test('TC-PC-002: analysis tab renders best skill and advantage segments', async () => {
    await projectPage.switchTab('analysis')

    // "Best Skill" section heading
    await expect(
      projectPage.analysisBody.getByText('Best Skill')
    ).toBeVisible({ timeout: 8000 })

    // Best skill name in the report (appears in Best Skill box and in segment card — use first)
    await expect(
      projectPage.analysisBody.getByText(BEST_SKILL_NAME).first()
    ).toBeVisible()

    // Advantage segments section heading
    await expect(
      projectPage.analysisBody.getByText(/Advantage Segments/)
    ).toBeVisible()

    // Segment card visible
    await expect(
      projectPage.analysisBody.locator('.segment-card').first()
    ).toBeVisible()

    // Segment type badge (role)
    await expect(
      projectPage.analysisBody.locator('.segment-type-badge', { hasText: 'role' })
    ).toBeVisible()
  })

  // ─── TC-PC-003: Iteration tab renders round history ───────────────────────

  test('TC-PC-003: iteration tab renders rounds and best score from pre-seeded report', async () => {
    await projectPage.switchTab('iteration')

    // "Rounds (2)" heading
    await expect(
      projectPage.iterationBody.getByText('Rounds (2)')
    ).toBeVisible({ timeout: 8000 })

    // Two round rows
    await expect(
      projectPage.iterationBody.locator('.round-row')
    ).toHaveCount(2)

    // Round 1 and Round 2 badges
    await expect(projectPage.iterationBody.getByText('R1')).toBeVisible()
    await expect(projectPage.iterationBody.getByText('R2')).toBeVisible()

    // Best block visible — "Best: Round 2 · Score: 90.0"
    await expect(
      projectPage.iterationBody.getByText(/Best: Round 2/)
    ).toBeVisible()

    // Strategy badge (GREEDY shows as '全面强化' after P2-2 localisation)
    await expect(
      projectPage.iterationBody.getByText('全面强化')
    ).toBeVisible()
  })
})
