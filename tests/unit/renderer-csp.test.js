'use strict'

/**
 * renderer-csp.test.js
 *
 * Verifies that renderer page JS files contain no inline onclick= handlers,
 * which are blocked by Electron's Content Security Policy (script-src 'self').
 *
 * Root cause: CSP in renderer/index.html sets `script-src 'self'`, which
 * blocks all inline event handlers such as onclick="fn()". The fix replaces
 * all such handlers with data-* attributes + addEventListener calls.
 *
 * Also verifies that external data interpolated into innerHTML is always
 * wrapped with window.escHtml() to prevent XSS-injected inline handlers.
 *
 * Also verifies that main/index.js uses sandbox:true in webPreferences.
 */

const fs = require('fs')
const path = require('path')

const PAGES_DIR = path.join(__dirname, '../../renderer/js/pages')
const PAGE_FILES = ['skill.js', 'baseline.js', 'project.js', 'rankings.js']

describe('CSP: no inline onclick= handlers in renderer pages', () => {
  PAGE_FILES.forEach(filename => {
    test(`${filename} has no inline onclick= attribute handlers`, () => {
      const filePath = path.join(PAGES_DIR, filename)
      const src = fs.readFileSync(filePath, 'utf-8')
      // Match onclick= inside template literals or HTML strings
      const matches = src.match(/onclick\s*=/g)
      expect(matches).toBeNull()
    })
  })

  test('skill.js pagination uses data-action attributes instead of onclick', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'skill.js'), 'utf-8')
    expect(src).toContain('data-action="prev"')
    expect(src).toContain('data-action="next"')
    expect(src).toContain('data-total=')
  })

  test('skill.js "+ Add" button uses id instead of onclick', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'skill.js'), 'utf-8')
    expect(src).toContain('id="skill-add-tag-btn"')
    // Confirm the listener is registered with addEventListener
    expect(src).toContain("getElementById('skill-add-tag-btn').addEventListener")
  })

  test('skill.js Approve/Reject buttons use data-review-action + addEventListener', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'skill.js'), 'utf-8')
    expect(src).toContain('data-review-action="approve"')
    expect(src).toContain('data-review-action="reject"')
    expect(src).toContain('data-tag-id=')
    expect(src).toContain('[data-review-action]')
    expect(src).toContain('btn.dataset.reviewAction')
  })

  test('skill.js version Restore buttons use data-rollback-version + addEventListener', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'skill.js'), 'utf-8')
    expect(src).toContain('data-rollback-version=')
    expect(src).toContain('[data-rollback-version]')
    expect(src).toContain('btn.dataset.rollbackVersion')
  })

  test('baseline.js pagination uses data-action attributes instead of onclick', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'baseline.js'), 'utf-8')
    expect(src).toContain('data-action="prev"')
    expect(src).toContain('data-action="next"')
  })

  test('baseline.js case Edit/Del buttons use data-case-action + addEventListener', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'baseline.js'), 'utf-8')
    expect(src).toContain('data-case-action="edit"')
    expect(src).toContain('data-case-action="delete"')
    expect(src).toContain('data-case-id=')
    expect(src).toContain('[data-case-action]')
    expect(src).toContain('btn.dataset.caseAction')
  })

  test('baseline.js version Restore buttons use data-rollback-version + addEventListener', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'baseline.js'), 'utf-8')
    expect(src).toContain('data-rollback-version=')
    expect(src).toContain('[data-rollback-version]')
    expect(src).toContain('btn.dataset.rollbackVersion')
  })

  test('project.js Quick Actions buttons use data-switch-tab + addEventListener', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'project.js'), 'utf-8')
    expect(src).toContain('data-switch-tab="test"')
    expect(src).toContain('data-switch-tab="analysis"')
    expect(src).toContain('data-switch-tab="recompose"')
    expect(src).toContain('data-switch-tab="iteration"')
    expect(src).toContain('[data-switch-tab]')
    expect(src).toContain('btn.dataset.switchTab')
  })

  test('rankings.js expand rows use data-expandable + addEventListener', () => {
    const src = fs.readFileSync(path.join(PAGES_DIR, 'rankings.js'), 'utf-8')
    expect(src).toContain('data-expandable=')
    expect(src).toContain('[data-expandable]')
    expect(src).toContain('addEventListener')
  })
})

describe('CSP: external data in innerHTML uses escHtml (project.js)', () => {  let src
  beforeAll(() => {
    src = fs.readFileSync(path.join(PAGES_DIR, 'project.js'), 'utf-8')
  })

  test('dimension leaders dim key is escaped', () => {
    expect(src).toContain('window.escHtml(dim.replace(/_/g, \' \'))')
  })

  test('dimension leaders sid value is escaped', () => {
    expect(src).toContain('window.escHtml(String(sid || \'\'))')
  })

  test('advantage segment type is escaped', () => {
    expect(src).toContain('window.escHtml(seg.type || \'\')')
  })

  test('advantage segment dimension is escaped', () => {
    expect(src).toContain('window.escHtml(seg.dimension || \'\')')
  })

  test('env snapshot cliVersion is escaped', () => {
    expect(src).toContain('window.escHtml(String(env.cliVersion || \'\'))')
  })

  test('env snapshot modelVersion is escaped', () => {
    expect(src).toContain('window.escHtml(String(env.modelVersion || \'\'))')
  })

  test('env snapshot skills list is escaped', () => {
    expect(src).toContain('window.escHtml((env.skills || []).map(s =>')
  })

  test('trace comparison d.field is escaped', () => {
    expect(src).toContain('window.escHtml(String(d.field || \'\'))')
  })

  test('trace comparison d.valueA is escaped', () => {
    expect(src).toContain('window.escHtml(String(d.valueA || \'\'))')
  })

  test('trace comparison d.valueB is escaped', () => {
    expect(src).toContain('window.escHtml(String(d.valueB || \'\'))')
  })

  test('create modal skill purpose/provider are escaped', () => {
    expect(src).toContain('window.escHtml(s.purpose)')
    expect(src).toContain('window.escHtml(s.provider)')
  })
})

describe('CSP: external data in innerHTML uses escHtml (rankings.js)', () => {
  let src
  beforeAll(() => {
    src = fs.readFileSync(path.join(PAGES_DIR, 'rankings.js'), 'utf-8')
  })

  test('skill name is escaped in record row', () => {
    expect(src).toContain('window.escHtml(r.skillName)')
  })

  test('skill version badge is escaped', () => {
    expect(src).toContain('window.escHtml(r.skillVersionTested)')
  })

  test('project name is escaped', () => {
    expect(src).toContain("window.escHtml(r.projectName || '')")
  })

  test('baseline option values and labels are escaped', () => {
    expect(src).toContain('window.escHtml(id)')
    expect(src).toContain('window.escHtml(name)')
  })

  test('group title baseline name is escaped', () => {
    expect(src).toContain('window.escHtml(g.baselineName || g.baselineId)')
  })

  test('timeline polyline points are escaped', () => {
    expect(src).toContain('window.escHtml(polyPts)')
  })

  test('timeline skill name in legend is escaped', () => {
    expect(src).toContain('window.escHtml(sk.name)')
  })
})

describe('CSP: Electron sandbox setting', () => {
  test('main/index.js uses sandbox:true in webPreferences', () => {
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '../../main/index.js'),
      'utf-8'
    )
    expect(mainSrc).toContain('sandbox: true')
    expect(mainSrc).not.toContain('sandbox: false')
  })
})

describe('CSP: manual.js renderer', () => {
  let src
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../../renderer/js/manual.js'), 'utf-8')
  })

  test('manual.js has no inline onclick= attribute handlers', () => {
    expect(src.match(/onclick\s*=/g)).toBeNull()
  })

  test('manual.js does not interpolate IPC data into innerHTML with escHtml omitted', () => {
    // content.innerHTML = res.data is trusted Markdown-rendered HTML from our own file.
    // Verify there is no raw user-supplied string concatenated into innerHTML.
    // The only innerHTML assignment should be res.data (marked.parse output).
    const inlineStrings = src.match(/innerHTML\s*=\s*`[^`]*\$\{(?!.*window\.escHtml)[^}]+\}/g)
    expect(inlineStrings).toBeNull()
  })
})
