'use strict'
/**
 * project.js — Project management page
 * Tabs: Overview | Test | Analysis | Recompose | Iteration
 */

const ProjectPage = (() => {
  let currentProjectId    = null
  let currentProjectConfig = null
  let currentTab          = 'overview'
  let currentPage         = 1
  const pageSize          = 20
  let searchTimeout       = null

  // Per-project transient state
  let testState           = 'idle'   // idle | running | paused
  let iterState           = 'idle'   // idle | running
  let recomposePreview    = null
  let savedRecomposeSkillId = null

  // IPC unsubscribers
  let unsubTestProgress    = null
  let unsubAnalysisDone    = null
  let unsubRecomposeDone   = null
  let unsubIterRound       = null

  // ─── List ──────────────────────────────────────────────────────────────────

  async function loadList(keyword = '') {
    const res = await window.api.project.list({ page: currentPage, pageSize })
    if (!res.success) { window.notify('Failed to load projects', 'error'); return }

    const listEl       = document.getElementById('project-list')
    const paginationEl = document.getElementById('project-pagination')

    const items = keyword
      ? res.data.items.filter(p => p.name.toLowerCase().includes(keyword.toLowerCase()))
      : res.data.items

    if (items.length === 0) {
      if (keyword) {
        listEl.innerHTML = `<div class="empty-state" style="padding:30px"><div class="icon">🧪</div><div class="title">No projects found</div><div class="sub">Try a different search term</div></div>`
      } else {
        listEl.innerHTML = `
          <div class="empty-state guide-card" style="padding:30px;text-align:center">
            <div class="icon">🧪</div>
            <div class="title">还没有测试项目</div>
            <div class="sub">选择 Skill 和基线，创建一次对比测试实验</div>
            <button class="btn btn-primary btn-sm" id="empty-project-create-btn" style="margin-top:14px">+ 创建第一个项目</button>
          </div>`
        document.getElementById('empty-project-create-btn').addEventListener('click', () => {
          document.getElementById('project-create-btn').click()
        })
      }
      paginationEl.innerHTML = ''
      return
    }

    listEl.innerHTML = items.map(p => `
      <div class="skill-item" data-id="${p.id}">
        <div class="skill-item-name">${window.escHtml(p.name)}</div>
        <div class="skill-item-meta">
          <span class="tag ${_statusCls(p.status)}">${p.status}</span>
          <span style="color:var(--text-muted)">${p.skillCount} skills · ${p.baselineCount} baselines</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          ${p.completedTasks}/${p.totalTasks} tasks · ${window.fmtDate(p.created_at)}
        </div>
      </div>
    `).join('')

    paginationEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${res.data.total} project(s)</span>`

    listEl.querySelectorAll('.skill-item').forEach(item => {
      item.addEventListener('click', () => openDetail(item.dataset.id))
    })
  }

  function _statusCls(status) {
    return { pending: '', running: 'auto', completed: '', interrupted: 'pending' }[status] || ''
  }

  // ─── Detail open ───────────────────────────────────────────────────────────

  function _unsubAll() {
    if (unsubTestProgress)  { unsubTestProgress();  unsubTestProgress  = null }
    if (unsubAnalysisDone)  { unsubAnalysisDone();  unsubAnalysisDone  = null }
    if (unsubRecomposeDone) { unsubRecomposeDone(); unsubRecomposeDone = null }
    if (unsubIterRound)     { unsubIterRound();     unsubIterRound     = null }
  }

  async function openDetail(projectId) {
    _unsubAll()
    currentProjectId      = projectId
    currentTab            = 'overview'
    recomposePreview      = null
    savedRecomposeSkillId = null
    testState             = 'idle'
    iterState             = 'idle'

    document.querySelectorAll('#project-list .skill-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === projectId)
    })

    const res = await window.api.project.get({ projectId })
    if (!res.success) { window.notify('Failed to load project', 'error'); return }
    currentProjectConfig = res.data.config

    document.getElementById('project-detail-empty').style.display = 'none'
    const detailEl = document.getElementById('project-detail')
    detailEl.style.display = 'flex'
    document.getElementById('project-detail-name').textContent = currentProjectConfig.name

    // Reset to overview tab
    document.querySelectorAll('[data-ptab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ptab === 'overview')
    })
    document.querySelectorAll('.project-tab-pane').forEach(p => p.classList.remove('active'))
    document.getElementById('ptab-overview').classList.add('active')

    renderOverview()
    _renderAux()
    _subscribeEvents()
  }

  function _subscribeEvents() {
    unsubTestProgress = window.api.on('test:progress:update', data => {
      if (data.projectId !== currentProjectId) return
      _updateTestProgressUI(data)
    })
    unsubAnalysisDone = window.api.on('analysis:completed', data => {
      if (data.projectId !== currentProjectId) return
      if (currentTab === 'analysis') loadAnalysisReport()
    })
    unsubRecomposeDone = window.api.on('recompose:completed', data => {
      if (data.projectId !== currentProjectId) return
      if (currentTab === 'recompose') renderRecomposePreview(data.preview)
    })
    unsubIterRound = window.api.on('iteration:round:completed', data => {
      if (data.projectId !== currentProjectId) return
      if (currentTab !== 'iteration') return
      if (data.type === 'all_complete') {
        iterState = 'idle'
        _updateIterButtons()
        loadIterationReport()
      } else {
        _refreshIterProgress()
      }
    })
  }

  // ─── Tab switching ─────────────────────────────────────────────────────────

  function switchTab(tabName) {
    currentTab = tabName
    document.querySelectorAll('[data-ptab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ptab === tabName)
    })
    document.querySelectorAll('.project-tab-pane').forEach(p => p.classList.remove('active'))
    document.getElementById(`ptab-${tabName}`).classList.add('active')

    if      (tabName === 'overview')  renderOverview()
    else if (tabName === 'test')      _loadTestTab()
    else if (tabName === 'analysis')  loadAnalysisReport()
    else if (tabName === 'recompose') _loadRecomposeTab()
    else if (tabName === 'iteration') _loadIterationTab()
  }

  // ─── Overview ──────────────────────────────────────────────────────────────

  function renderOverview() {
    const c  = currentProjectConfig
    const pr = c.progress || {}
    const pct = pr.total_tasks > 0 ? Math.round(pr.completed_tasks / pr.total_tasks * 100) : 0

    const skillsHtml = (c.skills || []).map(s => `
      <div style="padding:6px;background:var(--bg-hover);border-radius:6px;margin-bottom:4px;font-size:12px">
        <span class="version-badge" style="margin-right:6px">${s.version}</span>
        <strong>${window.escHtml(s.name)}</strong>
        <span style="color:var(--text-muted);margin-left:6px">${s.purpose || ''}/${s.provider || ''}</span>
      </div>
    `).join('')

    const baselinesHtml = (c.baselines || []).map(b => `
      <div style="padding:6px;background:var(--bg-hover);border-radius:6px;margin-bottom:4px;font-size:12px">
        <span class="version-badge" style="margin-right:6px">${b.version}</span>
        <strong>${window.escHtml(b.name)}</strong>
      </div>
    `).join('')

    document.getElementById('project-overview-body').innerHTML = `
      <div class="detail-section" style="padding:12px">
        <div class="detail-section-title">Info</div>
        <div class="meta-grid">
          <div class="meta-field"><label>Status</label><div class="val"><span class="tag ${_statusCls(c.status)}">${c.status}</span></div></div>
          <div class="meta-field"><label>Created</label><div class="val">${window.fmtDate(c.created_at)}</div></div>
          <div class="meta-field"><label>Tasks</label><div class="val">${pr.completed_tasks || 0} / ${pr.total_tasks || 0}</div></div>
          <div class="meta-field"><label>Model</label><div class="val">${c.cli_config?.model || '—'}</div></div>
        </div>
        ${c.description ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${window.escHtml(c.description)}</div>` : ''}
        <div style="margin-top:10px">
          <div class="progress-track"><div class="progress-fill ${pct === 100 ? 'done' : ''}" style="width:${pct}%"></div></div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${pct}% complete</div>
        </div>
      </div>
      <div class="detail-section" style="padding:0 12px 12px">
        <div class="detail-section-title">CLI Config</div>
        <div style="font-size:12px;color:var(--text-secondary);background:var(--bg-hover);padding:8px;border-radius:6px">
          Model: <strong>${c.cli_config?.model}</strong> ·
          Timeout: ${c.cli_config?.timeout_seconds}s ·
          Retries: ${c.cli_config?.retry_count}
        </div>
      </div>
      <div class="detail-section" style="padding:0 12px 12px">
        <div class="detail-section-title">Skills (${(c.skills || []).length})</div>
        ${skillsHtml || '<p style="font-size:12px;color:var(--text-muted)">No skills</p>'}
      </div>
      <div class="detail-section" style="padding:0 12px 12px">
        <div class="detail-section-title">Baselines (${(c.baselines || []).length})</div>
        ${baselinesHtml || '<p style="font-size:12px;color:var(--text-muted)">No baselines</p>'}
      </div>
    `
  }

  function _renderAux() {
    document.getElementById('project-aux-body').innerHTML = `
      <div style="padding:12px">
        <div class="detail-section-title" style="margin-bottom:8px">Quick Actions</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn btn-primary btn-sm" data-switch-tab="test" style="text-align:left">▶ Start Test Run</button>
          <button class="btn btn-secondary btn-sm" data-switch-tab="analysis" style="text-align:left">📊 View Analysis</button>
          <button class="btn btn-secondary btn-sm" data-switch-tab="recompose" style="text-align:left">🔀 Recompose Skill</button>
          <button class="btn btn-secondary btn-sm" data-switch-tab="iteration" style="text-align:left">🔄 Iteration Loop</button>
        </div>
        <div class="detail-section-title" style="margin-top:16px;margin-bottom:8px">Environment Trace</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn btn-secondary btn-sm" id="aux-trace-env-btn" style="text-align:left">🔍 View Env Snapshot</button>
          <div style="display:flex;gap:4px;align-items:center">
            <input class="form-input" id="aux-compare-pid" placeholder="Compare project ID…" style="font-size:11px;padding:4px 6px;flex:1">
            <button class="btn btn-secondary btn-sm" id="aux-compare-btn">Compare</button>
          </div>
        </div>
        <div id="aux-trace-result" style="margin-top:10px;font-size:12px"></div>
      </div>
    `
    document.getElementById('aux-trace-env-btn').addEventListener('click', _showEnvSnapshot)
    document.getElementById('aux-compare-btn').addEventListener('click', _compareEnvs)
    document.getElementById('project-aux-body').querySelectorAll('[data-switch-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.switchTab))
    })
  }

  // ─── Test tab ──────────────────────────────────────────────────────────────

  async function _loadTestTab() {
    const body = document.getElementById('test-results-body')
    body.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`

    const res = await window.api.test.getProgress({ projectId: currentProjectId })
    if (!res.success || !res.data) {
      body.innerHTML = `<div class="empty-state"><div class="icon">🧪</div><div class="title">No test data</div><div class="sub">Click Start to run tests</div></div>`
      testState = 'idle'
      _updateTestButtons()
      return
    }

    const data = res.data
    testState = data.status === 'running' ? 'running' : data.status === 'paused' ? 'paused' : 'idle'
    _updateTestButtons()
    _updateTestProgressUI(data)
    if (data.status === 'completed') _loadTestResults()
  }

  function _updateTestButtons() {
    document.getElementById('test-start-btn').style.display  = testState === 'idle'   ? '' : 'none'
    document.getElementById('test-pause-btn').style.display  = testState === 'running' ? '' : 'none'
    document.getElementById('test-resume-btn').style.display = testState === 'paused'  ? '' : 'none'
    document.getElementById('test-stop-btn').style.display   = (testState === 'running' || testState === 'paused') ? '' : 'none'
  }

  function _updateTestProgressUI(data) {
    if (!data) return
    const total     = data.totalTasks     != null ? data.totalTasks     : (data.total     || 0)
    const completed = data.completedTasks != null ? data.completedTasks : (data.completed || 0)
    const pct   = total > 0 ? Math.round(completed / total * 100) : 0
    const barWrap = document.getElementById('test-progress-bar')
    const fill    = document.getElementById('test-progress-fill')
    const label   = document.getElementById('test-progress-label')
    barWrap.style.display = data.status !== 'idle' ? '' : 'none'
    fill.style.width = pct + '%'
    fill.className   = 'progress-fill' + (data.status === 'completed' ? ' done' : data.status === 'error' ? ' error' : '')
    label.textContent = `${completed} / ${total} cases (${pct}%)`
    if (data.status === 'completed') {
      testState = 'idle'
      _updateTestButtons()
      _loadTestResults()
    }
  }

  async function _loadTestResults() {
    const res  = await window.api.test.getResults({ projectId: currentProjectId })
    const body = document.getElementById('test-results-body')
    const summary = res.data?.summary
    if (!res.success || !summary?.ranking?.length) {
      body.innerHTML = `<div class="empty-state"><div class="icon">🧪</div><div class="title">No results yet</div></div>`
      return
    }

    const rankHtml = summary.ranking.map((r, i) => `
      <div class="round-row ${i === 0 ? 'best' : ''}">
        <div class="round-badge">#${r.rank}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${window.escHtml(r.skill_name)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${r.skill_version} · ${r.completed_cases} cases</div>
        </div>
        <div class="score-${r.avg_score >= 80 ? 'hi' : r.avg_score >= 60 ? 'mid' : 'lo'}" style="font-size:16px;font-weight:700">${r.avg_score}</div>
      </div>
    `).join('')

    // Layer 2: 6-dimension comparison table
    const DIMS = [
      ['Functional Correctness', 'functional_correctness', 30],
      ['Robustness',             'robustness',             20],
      ['Readability',            'readability',            15],
      ['Conciseness',            'conciseness',            15],
      ['Complexity Control',     'complexity_control',     10],
      ['Format Compliance',      'format_compliance',      10],
    ]
    const skillHeaders = summary.ranking.map(r =>
      `<th>${window.escHtml(r.skill_name)} <span class="version-badge">${window.escHtml(r.skill_version)}</span></th>`
    ).join('')
    const dimRows = DIMS.map(([label, key, max]) => {
      const cells = summary.ranking.map(r => {
        const v = (r.score_breakdown || {})[key]
        if (v == null) return `<td style="color:var(--text-muted)">—</td>`
        const cls = v >= max * 0.8 ? 'score-hi' : v >= max * 0.6 ? 'score-mid' : 'score-lo'
        return `<td class="${cls}" style="font-weight:600">${Math.round(v)}<span style="font-size:10px;color:var(--text-muted)">/${max}</span></td>`
      }).join('')
      return `<tr><td class="dim-label">${window.escHtml(label)}</td>${cells}</tr>`
    }).join('')

    const dimTable = summary.ranking.length > 1 ? `
      <div style="margin-top:16px">
        <div class="detail-section-title">Dimension Comparison</div>
        <div style="overflow-x:auto;margin-top:8px">
          <table class="dim-table">
            <thead><tr><th>Dimension</th>${skillHeaders}</tr></thead>
            <tbody>${dimRows}</tbody>
          </table>
        </div>
      </div>
    ` : ''

    body.innerHTML = `
      <div style="padding:12px">
        <div class="detail-section-title">Rankings</div>
        <div style="margin-top:8px">${rankHtml}</div>
        <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">${summary.total_cases} total cases</div>
        ${dimTable}
      </div>
    `
  }

  async function _startTest() {
    if (!currentProjectId || testState === 'running') return
    testState = 'running'
    _updateTestButtons()
    document.getElementById('test-progress-bar').style.display = ''
    const res = await window.api.test.start({ projectId: currentProjectId })
    if (!res.success) {
      testState = 'idle'; _updateTestButtons()
      window.notify('Failed to start test: ' + res.error?.message, 'error')
    } else {
      window.notify('Test started', 'info')
    }
  }

  async function _pauseTest() {
    const res = await window.api.test.pause({ projectId: currentProjectId })
    if (!res.success) return
    testState = 'paused'; _updateTestButtons()
  }

  async function _resumeTest() {
    const res = await window.api.test.resume({ projectId: currentProjectId })
    if (!res.success) return
    testState = 'running'; _updateTestButtons()
  }

  async function _stopTest() {
    const res = await window.api.test.stop({ projectId: currentProjectId })
    if (!res.success) return
    testState = 'idle'; _updateTestButtons()
    window.notify('Test stopped', 'info')
  }

  // ─── Prerequisite banner helper (P0-1) ────────────────────────────────────

  const _TAB_LABELS = { test: 'Test', analysis: 'Analysis', recompose: 'Recompose', iteration: 'Iteration' }

  function _showPrereqBanner(bodyEl, message, targetTab) {
    bodyEl.innerHTML = `
      <div class="prereq-banner">
        <span class="prereq-banner-msg">⚠ ${message}</span>
        <button class="btn btn-sm" data-prereq-tab="${targetTab}">→ 前往 ${_TAB_LABELS[targetTab] || targetTab}</button>
      </div>
    `
    bodyEl.querySelector('[data-prereq-tab]').addEventListener('click', () => switchTab(targetTab))
  }

  // ─── Analysis tab ──────────────────────────────────────────────────────────

  async function loadAnalysisReport() {
    const body = document.getElementById('analysis-body')
    // P0-1: prerequisite — test must be completed
    if (currentProjectConfig?.status !== 'completed') {
      _showPrereqBanner(body, '请先完成测试，才能运行分析', 'test')
      return
    }
    body.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`
    const res = await window.api.analysis.getReport({ projectId: currentProjectId })
    if (!res.success || !res.data) {
      body.innerHTML = `<div class="empty-state"><div class="icon">📊</div><div class="title">No analysis report</div><div class="sub">Click "Run Analysis" to generate</div></div>`
      return
    }
    _renderAnalysisReport(res.data)
  }

  function _renderAnalysisReport(report) {
    const body = document.getElementById('analysis-body')

    const dimHtml = report.dimension_leaders
      ? Object.entries(report.dimension_leaders).map(([dim, sid]) => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(58,58,82,0.4);font-size:12px">
            <span style="color:var(--text-muted)">${window.escHtml(dim.replace(/_/g, ' '))}</span>
            <span style="color:var(--accent-light)">${window.escHtml(String(sid || ''))}</span>
          </div>
        `).join('') : ''

    const segHtml = (report.advantage_segments || []).map(seg => `
      <div class="segment-card">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
          <span class="segment-type-badge">${window.escHtml(seg.type || '')}</span>
          <span style="font-size:11px;color:var(--text-muted)">${window.escHtml(seg.dimension || '')}</span>
          <span style="font-size:11px;color:var(--text-secondary);margin-left:auto">${window.escHtml(seg.skill_name)}</span>
        </div>
        <div style="font-size:12px;font-family:monospace;padding:6px;background:var(--bg-panel);border-radius:4px;word-break:break-all">${window.escHtml(seg.content)}</div>
        ${seg.reason ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${window.escHtml(seg.reason)}</div>` : ''}
      </div>
    `).join('')

    const issueHtml = (report.issues || []).map(iss => `
      <div style="font-size:12px;color:var(--error);padding:4px 0">${window.escHtml(String(iss))}</div>
    `).join('')

    body.innerHTML = `
      <div style="padding:12px">
        <div class="detail-section-title">Best Skill</div>
        <div style="padding:8px;background:var(--bg-hover);border-radius:6px;margin-bottom:12px;font-size:13px">
          <strong>${window.escHtml(report.best_skill_name || report.best_skill_id || '—')}</strong>
        </div>
        ${dimHtml ? `<div class="detail-section-title" style="margin-bottom:6px">Dimension Leaders</div><div style="margin-bottom:12px">${dimHtml}</div>` : ''}
        ${segHtml ? `<div class="detail-section-title" style="margin-bottom:6px">Advantage Segments (${(report.advantage_segments || []).length})</div>${segHtml}` : ''}
        ${issueHtml ? `<div class="detail-section-title" style="margin-top:12px;margin-bottom:6px">Issues</div>${issueHtml}` : ''}
      </div>
    `
  }

  async function _runAnalysis() {
    const body = document.getElementById('analysis-body')
    body.innerHTML = `<div class="empty-state"><div class="spinner"></div><div style="margin-top:12px;color:var(--text-muted);font-size:12px">Running analysis…</div></div>`
    const res = await window.api.analysis.run({ projectId: currentProjectId })
    if (!res.success) {
      window.notify('Analysis failed: ' + res.error?.message, 'error')
      loadAnalysisReport()
    } else {
      window.notify('Analysis started', 'info')
    }
  }

  async function _exportAnalysis() {
    const destPath = prompt('Enter export file path (e.g. C:\\reports\\analysis.md):')
    if (!destPath) return
    const res = await window.api.analysis.exportReport({ projectId: currentProjectId, destPath })
    if (!res.success) { window.notify('Export failed', 'error'); return }
    window.notify('Exported: ' + destPath, 'success')
  }

  // ─── Recompose tab ─────────────────────────────────────────────────────────

  async function _loadRecomposeTab() {
    if (recomposePreview) { renderRecomposePreview(recomposePreview); return }
    const body = document.getElementById('recompose-body')
    document.getElementById('recompose-save-open-btn').style.display = 'none'
    // P0-1: prerequisite — analysis report must exist
    body.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`
    const analysisRes = await window.api.analysis.getReport({ projectId: currentProjectId })
    if (!analysisRes.success || !analysisRes.data) {
      _showPrereqBanner(body, '请先运行差异分析，才能执行重组', 'analysis')
      return
    }
    body.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔀</div>
        <div class="title">Recompose Skill</div>
        <div class="sub">Click "Execute" to build an optimised skill from advantage segments</div>
      </div>
    `
  }

  async function _executeRecompose() {
    const reportRes = await window.api.analysis.getReport({ projectId: currentProjectId })
    // Pass segment IDs so the service filters to these segments;
    // retentionRules is a free-text string injected into the prompt.
    const selectedSegmentIds = (reportRes.data?.advantage_segments || []).map(seg => seg.id)
    const retentionRules     = ''   // user hasn't specified custom rules — service uses default text

    const body = document.getElementById('recompose-body')
    body.innerHTML = `<div class="empty-state"><div class="spinner"></div><div style="margin-top:12px;color:var(--text-muted);font-size:12px">Recomposing…</div></div>`
    document.getElementById('recompose-save-open-btn').style.display = 'none'

    const res = await window.api.recompose.execute({ projectId: currentProjectId, retentionRules, selectedSegmentIds })
    if (!res.success) {
      window.notify('Recompose failed: ' + res.error?.message, 'error')
      body.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><div class="title">Recompose failed</div></div>`
    } else {
      window.notify('Recompose started', 'info')
    }
  }

  function renderRecomposePreview(preview) {
    if (!preview) return
    recomposePreview = preview
    const body = document.getElementById('recompose-body')
    body.innerHTML = `
      <div style="padding:12px">
        <div class="detail-section-title">Recomposed Preview</div>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">${preview.segmentCount} segments · ${preview.sourceSkillCount} source skills</div>
        <div class="content-box" style="max-height:420px">${window.escHtml(preview.content || '')}</div>
      </div>
    `
    document.getElementById('recompose-save-open-btn').style.display = ''
  }

  function _openSaveRecomposeModal() {
    // P0-3: pre-fill from first source skill so user only needs to adjust the name
    const firstSkill = currentProjectConfig?.skills?.[0]
    document.getElementById('recompose-save-name').value     = firstSkill ? `${firstSkill.name}-融合版` : ''
    document.getElementById('recompose-save-purpose').value  = firstSkill?.purpose || ''
    document.getElementById('recompose-save-provider').value = firstSkill?.provider || 'recomposed'
    window.openModal('recompose-save-modal')
  }

  async function _confirmSaveRecompose() {
    const name     = document.getElementById('recompose-save-name').value.trim()
    const purpose  = document.getElementById('recompose-save-purpose').value.trim()
    const provider = document.getElementById('recompose-save-provider').value.trim()
    if (!name || !purpose || !provider) { window.notify('All fields required', 'error'); return }

    const res = await window.api.recompose.save({
      projectId: currentProjectId,
      content: recomposePreview?.content || '',
      meta: { name, purpose, provider },
    })
    if (!res.success) { window.notify('Save failed: ' + res.error?.message, 'error'); return }

    savedRecomposeSkillId = res.data.skillId
    window.closeModal('recompose-save-modal')
    window.notify(`Saved: ${name}`, 'success')

    const skillInput = document.getElementById('iter-skill-id')
    if (skillInput) skillInput.value = savedRecomposeSkillId
  }

  // ─── Iteration tab ─────────────────────────────────────────────────────────

  async function _loadIterationTab() {
    // Pre-fill skill ID
    const skillInput = document.getElementById('iter-skill-id')
    if (skillInput && !skillInput.value) {
      skillInput.value = savedRecomposeSkillId || currentProjectConfig?.skills?.[0]?.ref_id || ''
    }

    // Wire mode selector → show/hide advanced row
    const modeSelect = document.getElementById('iter-mode')
    if (modeSelect && !modeSelect._aoWired) {
      modeSelect._aoWired = true
      modeSelect.addEventListener('change', function () {
        const advRow = document.getElementById('iter-advanced-row')
        if (!advRow) return
        if (this.value === 'standard') {
          advRow.style.display = 'none'
        } else {
          advRow.style.display = 'flex'
          if (this.value === 'explore') {
            document.getElementById('iter-beam-width').value         = '2'
            document.getElementById('iter-plateau-threshold').value  = '1.0'
            document.getElementById('iter-plateau-rounds').value     = '2'
          } else if (this.value === 'adaptive') {
            document.getElementById('iter-beam-width').value         = '2'
            document.getElementById('iter-plateau-threshold').value  = '0.5'
            document.getElementById('iter-plateau-rounds').value     = '1'
          }
        }
      })
    }

    await loadIterationReport()
  }

  async function loadIterationReport() {
    const body = document.getElementById('iteration-body')
    body.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`
    const res = await window.api.iteration.getReport({ projectId: currentProjectId })
    if (!res.success || !res.data) {
      body.innerHTML = `<div class="empty-state"><div class="icon">🔄</div><div class="title">No iteration report</div><div class="sub">Configure rounds and click Start</div></div>`
      return
    }
    _renderIterationReport(res.data)
  }

  const _STRAT_COLORS = {
    GREEDY:           { bg: 'rgba(59,130,246,0.2)',   text: '#60a5fa' },
    DIMENSION_FOCUS:  { bg: 'rgba(124,106,247,0.2)',  text: '#a78bfa' },
    SEGMENT_EXPLORE:  { bg: 'rgba(16,185,129,0.2)',   text: '#34d399' },
    CROSS_POLLINATE:  { bg: 'rgba(245,158,11,0.2)',   text: '#fbbf24' },
    RANDOM_SUBSET:    { bg: 'rgba(239,68,68,0.2)',    text: '#f87171' },
  }

  function _stratBadge(strategy) {
    const c = _STRAT_COLORS[strategy] || _STRAT_COLORS.GREEDY
    return `<span style="font-size:10px;padding:1px 5px;border-radius:3px;font-weight:600;background:${c.bg};color:${c.text}">${window.escHtml(strategy || 'GREEDY')}</span>`
  }

  function _renderIterationReport(report) {
    const body = document.getElementById('iteration-body')

    const roundsHtml = (report.rounds || []).map(r => `
      <div class="round-row ${r.round === report.best_round ? 'best' : ''}">
        <div class="round-badge">R${r.round}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            ${_stratBadge(r.strategy || 'GREEDY')}
            <span style="font-size:12px;color:var(--text-secondary)">${window.escHtml(r.skill_id || '')}</span>
          </div>
          ${r.score_delta != null
            ? `<div style="font-size:11px;color:${r.score_delta >= 0 ? 'var(--success)' : 'var(--error)'}">Δ${r.score_delta >= 0 ? '+' : ''}${Number(r.score_delta).toFixed(1)}</div>`
            : ''}
        </div>
        <div class="score-${r.avg_score >= 80 ? 'hi' : r.avg_score >= 60 ? 'mid' : 'lo'}" style="font-size:16px;font-weight:700">${Number(r.avg_score).toFixed(1)}</div>
      </div>
    `).join('')

    const bestBlock = report.best_round ? `
      <div style="margin-top:12px;padding:8px;background:rgba(124,106,247,0.1);border:1px solid var(--accent);border-radius:6px;font-size:12px">
        Best: Round ${report.best_round} · Score: <strong class="score-hi">${Number(report.best_avg_score).toFixed(1)}</strong>
        ${report.stop_reason ? `<span style="margin-left:8px;color:var(--text-muted)">(${window.escHtml(report.stop_reason)})</span>` : ''}
      </div>
    ` : ''

    body.innerHTML = `
      <div style="padding:12px">
        ${report.status === 'running' ? `<div style="margin-bottom:8px;font-size:12px;color:var(--accent-light)">Iteration in progress…</div>` : ''}
        <div class="detail-section-title">Rounds (${report.total_rounds || (report.rounds || []).length})</div>
        <div style="margin:8px 0">${roundsHtml || '<div style="font-size:12px;color:var(--text-muted)">No rounds yet</div>'}</div>
        ${bestBlock}
        <div id="iter-exploration-log-section" style="margin-top:16px"></div>
      </div>
    `

    // Load exploration log if iteration is complete
    if (report.stop_reason) {
      _loadExplorationLog()
    }
  }

  async function _refreshIterProgress() {
    const res = await window.api.iteration.getProgress({ projectId: currentProjectId })
    if (res.success && res.data) {
      _renderIterationReport({ rounds: res.data.rounds || [], total_rounds: (res.data.rounds || []).length, status: 'running' })
    }
  }

  async function _loadExplorationLog() {
    const section = document.getElementById('iter-exploration-log-section')
    if (!section) return
    const res = await window.api.iteration.getExplorationLog({ projectId: currentProjectId })
    if (!res.success || !res.data) return
    _renderExplorationLog(res.data, section)
  }

  function _renderExplorationLog(log, container) {
    const logRounds = log.rounds || []
    if (logRounds.length === 0) return

    const plateauLabels = { 0: 'None', 1: 'Mild', 2: 'Moderate', 3: 'Severe' }

    const roundsHtml = logRounds.map(lr => {
      const candHtml = (lr.candidates || []).map(c => {
        const scoreStr = c.avg_score != null ? Number(c.avg_score).toFixed(1) : '—'
        const winnerMark = c.won ? ' <strong style="color:var(--success)">★ WINNER</strong>' : ''
        const errStr = c.error ? ` <span style="color:var(--error)">(${window.escHtml(String(c.error).slice(0, 60))})</span>` : ''
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">
            ${_stratBadge(c.strategy || 'GREEDY')}
            <span style="color:var(--text-secondary)">${window.escHtml(c.skill_id || '—')}</span>
            <span style="color:var(--text-primary);font-weight:600">${scoreStr}</span>
            ${winnerMark}${errStr}
          </div>`
      }).join('')

      const plateauLabel = plateauLabels[lr.plateau_level] || String(lr.plateau_level || 0)
      return `
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">
            Between Round ${lr.round} → ${lr.round + 1}
            <span style="margin-left:8px">Plateau: ${window.escHtml(plateauLabel)}</span>
          </div>
          <div style="padding:6px 10px;background:var(--bg-hover);border-radius:4px;border:1px solid var(--border)">
            ${candHtml || '<span style="color:var(--text-muted);font-size:12px">No candidates</span>'}
          </div>
        </div>`
    }).join('')

    const bestEver = log.best_ever
    const bestHtml = bestEver ? `
      <div style="padding:6px 10px;background:rgba(16,185,129,0.1);border:1px solid var(--success);border-radius:4px;font-size:12px">
        Best ever: Round ${bestEver.round}
        · ${_stratBadge(bestEver.strategy || 'GREEDY')}
        · Score <strong class="score-hi">${Number(bestEver.avg_score).toFixed(1)}</strong>
        · <span style="color:var(--text-secondary)">${window.escHtml(bestEver.skill_id || '')}</span>
      </div>` : ''

    container.innerHTML = `
      <div class="detail-section-title">Beam Exploration Log</div>
      <div style="margin:8px 0">${roundsHtml}</div>
      ${bestHtml}
    `
  }

  function _updateIterButtons() {
    document.getElementById('iteration-start-btn').style.display = iterState === 'idle'    ? '' : 'none'
    document.getElementById('iteration-stop-btn').style.display  = iterState === 'running' ? '' : 'none'
  }

  async function _startIteration() {
    if (!currentProjectId || iterState === 'running') return
    const skillId = (document.getElementById('iter-skill-id')?.value || '').trim()
      || currentProjectConfig?.skills?.[0]?.ref_id
    if (!skillId) { window.notify('No starting skill available', 'error'); return }

    const maxRounds     = parseInt(document.getElementById('iter-max-rounds')?.value) || 3
    const threshRaw     = parseInt(document.getElementById('iter-stop-threshold')?.value) || 0
    const stopThreshold = threshRaw > 0 ? threshRaw : undefined

    // AEIO mode → beam params
    const mode = document.getElementById('iter-mode')?.value || 'standard'
    let beamWidth = 1, plateauThreshold = 1.0, plateauRoundsBeforeEscape = 2
    if (mode !== 'standard') {
      beamWidth               = parseInt(document.getElementById('iter-beam-width')?.value) || 2
      plateauThreshold        = parseFloat(document.getElementById('iter-plateau-threshold')?.value) || 1.0
      plateauRoundsBeforeEscape = parseInt(document.getElementById('iter-plateau-rounds')?.value) || 2
    }
    const retentionRules = document.getElementById('iter-retention-rules')?.value?.trim() || ''

    iterState = 'running'; _updateIterButtons()
    _renderIterationReport({ rounds: [], total_rounds: 0, status: 'running' })

    const res = await window.api.iteration.start({
      projectId: currentProjectId,
      recomposedSkillId: skillId,
      maxRounds,
      stopThreshold,
      beamWidth,
      plateauThreshold,
      plateauRoundsBeforeEscape,
      retentionRules,
    })
    if (!res.success) {
      iterState = 'idle'; _updateIterButtons()
      window.notify('Failed to start iteration: ' + res.error?.message, 'error')
    } else {
      window.notify('Iteration started', 'info')
    }
  }

  async function _stopIteration() {
    const res = await window.api.iteration.stop({ projectId: currentProjectId })
    if (!res.success) return
    iterState = 'idle'; _updateIterButtons()
    window.notify('Iteration stopped', 'info')
    loadIterationReport()
  }

  // ─── Trace (Module 10) ────────────────────────────────────────────────────

  async function _showEnvSnapshot() {
    const result = document.getElementById('aux-trace-result')
    result.innerHTML = '<span style="color:var(--text-muted)">Loading…</span>'
    const res = await window.api.trace.getProjectEnv({ projectId: currentProjectId })
    if (!res.success) { result.innerHTML = `<span style="color:var(--error)">${window.escHtml(String(res.error?.message || ''))}</span>`; return }
    const env = res.data
    result.innerHTML = `
      <div style="background:var(--bg-hover);border-radius:6px;padding:8px;color:var(--text-secondary)">
        <div>CLI: <strong>${window.escHtml(String(env.cliVersion || ''))}</strong></div>
        <div>Model: <strong>${window.escHtml(String(env.modelVersion || ''))}</strong></div>
        <div>Skills: ${window.escHtml((env.skills || []).map(s => `${s.id}@${s.version}`).join(', '))}</div>
        <div>Timeout: ${Number(env.cliConfig?.timeout_seconds) || 0}s</div>
      </div>
    `
  }

  async function _compareEnvs() {
    const otherPid = document.getElementById('aux-compare-pid').value.trim()
    if (!otherPid) { window.notify('Enter a project ID to compare', 'error'); return }
    const result = document.getElementById('aux-trace-result')
    result.innerHTML = '<span style="color:var(--text-muted)">Comparing…</span>'
    const res = await window.api.trace.compareEnvs({ projectIdA: currentProjectId, projectIdB: otherPid })
    if (!res.success) { result.innerHTML = `<span style="color:var(--error)">${window.escHtml(String(res.error?.message || ''))}</span>`; return }
    const { identical, differences } = res.data
    if (identical) {
      result.innerHTML = `<div style="color:var(--success);font-size:12px">✓ Environments are identical</div>`
      return
    }
    result.innerHTML = `
      <div style="font-size:12px;color:var(--warning);margin-bottom:4px">${differences.length} difference(s):</div>
      ${differences.map(d => `
        <div style="padding:4px 0;border-bottom:1px solid rgba(58,58,82,0.4);font-size:11px">
          <span style="color:var(--text-muted)">${window.escHtml(String(d.field || ''))}</span><br>
          <span style="color:var(--error)">${window.escHtml(String(d.valueA || ''))}</span> → <span style="color:var(--success)">${window.escHtml(String(d.valueB || ''))}</span>
        </div>
      `).join('')}
    `
  }

  // ─── Export / Delete ──────────────────────────────────────────────────────

  async function exportProject() {
    if (!currentProjectId) return
    const destPath = prompt('Enter destination directory path for export:')
    if (!destPath) return
    const res = await window.api.project.export({ projectId: currentProjectId, destPath })
    if (!res.success) { window.notify('Export failed: ' + res.error.message, 'error'); return }
    window.notify('Exported to: ' + res.data.exportedPath, 'success')
  }

  async function deleteProject() {
    if (!currentProjectId) return
    if (!confirm('Delete this project? This cannot be undone.')) return
    _unsubAll()
    const res = await window.api.project.delete({ projectId: currentProjectId })
    if (!res.success) { window.notify('Delete failed', 'error'); return }
    window.notify('Project deleted', 'success')
    currentProjectId = null; currentProjectConfig = null
    document.getElementById('project-detail').style.display = 'none'
    document.getElementById('project-detail-empty').style.display = 'flex'
    document.getElementById('project-aux-body').innerHTML = ''
    loadList()
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async function _openCreateModal() {
    const [skillsRes, baselinesRes] = await Promise.all([
      window.api.skill.list({ page: 1, pageSize: 100 }),
      window.api.baseline.list({ page: 1, pageSize: 100 }),
    ])

    document.getElementById('project-skills-select').innerHTML =
      (skillsRes.data?.items || []).map(s =>
        `<option value="${s.id}">${window.escHtml(s.name)} (${s.version}) — ${window.escHtml(s.purpose)}/${window.escHtml(s.provider)}</option>`
      ).join('')

    document.getElementById('project-baselines-select').innerHTML =
      (baselinesRes.data?.items || []).map(b =>
        `<option value="${b.id}">${window.escHtml(b.name)} (${b.version}) — ${b.caseCount} cases</option>`
      ).join('')

    document.getElementById('project-name').value        = ''
    document.getElementById('project-description').value = ''
    window.openModal('project-create-modal')
  }

  async function _confirmCreate() {
    const name = document.getElementById('project-name').value.trim()
    if (!name) { window.notify('Project name required', 'error'); return }

    const skillIds    = Array.from(document.getElementById('project-skills-select').selectedOptions).map(o => o.value)
    const baselineIds = Array.from(document.getElementById('project-baselines-select').selectedOptions).map(o => o.value)
    if (!skillIds.length)    { window.notify('Select at least one skill', 'error');    return }
    if (!baselineIds.length) { window.notify('Select at least one baseline', 'error'); return }

    const model   = document.getElementById('project-model').value.trim() || 'claude-opus-4-6'
    const timeout = parseInt(document.getElementById('project-timeout').value) || 60

    const res = await window.api.project.create({
      name,
      description: document.getElementById('project-description').value.trim(),
      skillIds,
      baselineIds,
      cliConfig: { model, timeout_seconds: timeout, retry_count: 2 },
    })
    if (!res.success) { window.notify('Create failed: ' + res.error.message, 'error'); return }
    window.closeModal('project-create-modal')
    window.notify(`Project created: ${res.data.totalTasks} tasks`, 'success')
    loadList()
    openDetail(res.data.projectId)
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('project-create-btn').addEventListener('click', _openCreateModal)
    document.getElementById('project-create-confirm').addEventListener('click', _confirmCreate)
    document.getElementById('project-export-btn').addEventListener('click', exportProject)
    document.getElementById('project-delete-btn').addEventListener('click', deleteProject)

    // Tab buttons
    document.querySelectorAll('[data-ptab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.ptab))
    })

    // Test buttons
    document.getElementById('test-start-btn').addEventListener('click', _startTest)
    document.getElementById('test-pause-btn').addEventListener('click', _pauseTest)
    document.getElementById('test-resume-btn').addEventListener('click', _resumeTest)
    document.getElementById('test-stop-btn').addEventListener('click', _stopTest)

    // Analysis buttons
    document.getElementById('analysis-run-btn').addEventListener('click', _runAnalysis)
    document.getElementById('analysis-export-btn').addEventListener('click', _exportAnalysis)

    // Recompose buttons
    document.getElementById('recompose-execute-btn').addEventListener('click', _executeRecompose)
    document.getElementById('recompose-save-open-btn').addEventListener('click', _openSaveRecomposeModal)
    document.getElementById('recompose-save-confirm').addEventListener('click', _confirmSaveRecompose)

    // Iteration buttons
    document.getElementById('iteration-start-btn').addEventListener('click', _startIteration)
    document.getElementById('iteration-stop-btn').addEventListener('click', _stopIteration)

    const searchEl = document.getElementById('project-search')
    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => loadList(searchEl.value.trim()), 350)
    })

    loadList()
  }

  return { init, loadList, openDetail, switchTab }
})()

window.ProjectPage = ProjectPage
