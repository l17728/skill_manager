'use strict'
/**
 * rankings.js — Rankings & Leaderboard page (Module 11)
 *
 * Displays cross-project leaderboard with staleness indicators,
 * grouping by baseline, and optional timeline chart.
 */

const RankingsPage = (() => {

  // ─── State ──────────────────────────────────────────────────────────────────
  let _view   = 'rank'   // 'rank' | 'timeline'
  let _filter = { search: '', baselineId: '', purpose: '', period: '', includeStale: true }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id) }

  function _debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
  }

  function _scoreClass(s) { return s >= 80 ? 'score-hi' : s >= 60 ? 'score-mid' : 'score-lo' }

  const _STALE = {
    current:          { icon: '✓', label: '当前',         cls: 'stale-current' },
    skill_updated:    { icon: '⚠', label: 'Skill 已更新', cls: 'stale-warn'    },
    baseline_updated: { icon: '◆', label: '基线已更新',   cls: 'stale-danger'  },
    both_updated:     { icon: '✕', label: '均已更新',     cls: 'stale-error'   },
  }

  function _stalenessHtml(staleness) {
    const m = _STALE[staleness] || { icon: '?', label: staleness, cls: '' }
    return `<span class="staleness-badge ${window.escHtml(m.cls)}" title="${window.escHtml(m.label)}">${m.icon}</span>`
  }

  function _breakdownHtml(bd) {
    if (!bd) return ''
    const dims = [
      ['FC',   bd.functional_correctness],
      ['Rob',  bd.robustness],
      ['Read', bd.readability],
      ['Con',  bd.conciseness],
      ['CC',   bd.complexity_control],
      ['Fmt',  bd.format_compliance],
    ]
    return '<div class="score-breakdown">' + dims.map(([lbl, val]) => {
      const v = val != null ? Math.round(val) : '—'
      return `<span class="bd-dim"><span class="bd-dim-label">${lbl}</span><span class="bd-dim-val ${_scoreClass(val || 0)}">${v}</span></span>`
    }).join('') + '</div>'
  }

  function _recordRowHtml(r, rank) {
    const hasBd = r.scoreBreakdown && Object.keys(r.scoreBreakdown).length > 0
    return `
      <div class="rankings-row${rank === 1 ? ' best' : ''}" ${hasBd ? 'data-expandable="1"' : ''}>
        <span class="rankings-rank">#${rank}</span>
        <span class="rankings-skill-name">
          ${window.escHtml(r.skillName)}
          <span class="version-badge">${window.escHtml(r.skillVersionTested)}</span>
          <span class="rankings-project-ref">${window.escHtml(r.projectName || '')}</span>
        </span>
        <span class="rankings-score ${_scoreClass(r.avgScore)}">${r.avgScore}</span>
        <span class="rankings-cases">${r.completedCases}</span>
        <span>${_stalenessHtml(r.staleness)}</span>
        <span class="rankings-tested-at">${window.fmtDate(r.testedAt)}</span>
      </div>
      ${hasBd ? `<div class="rankings-row-breakdown hidden">${_breakdownHtml(r.scoreBreakdown)}</div>` : ''}
    `
  }

  // ─── Dropdown rebuilder ──────────────────────────────────────────────────────
  function _rebuildDropdowns(data) {
    const items = data.groups
      ? data.groups.flatMap(g => g.records)
      : (data.records || [])

    const baselines = new Map()
    const purposes  = new Set()
    for (const r of items) {
      if (!baselines.has(r.baselineId)) baselines.set(r.baselineId, r.baselineName || r.baselineId)
      if (r.baselinePurpose) purposes.add(r.baselinePurpose)
    }

    const bSel = _el('rankings-baseline-select')
    const bVal = bSel.value
    bSel.innerHTML = '<option value="">全部基线</option>' +
      [...baselines.entries()].map(([id, name]) =>
        `<option value="${window.escHtml(id)}"${id === bVal ? ' selected' : ''}>${window.escHtml(name)}</option>`
      ).join('')

    const pSel = _el('rankings-purpose-select')
    const pVal = pSel.value
    pSel.innerHTML = '<option value="">全部用途</option>' +
      [...purposes].map(p =>
        `<option value="${window.escHtml(p)}"${p === pVal ? ' selected' : ''}>${window.escHtml(p)}</option>`
      ).join('')
  }

  // ─── Query builder ───────────────────────────────────────────────────────────
  function _buildOpts() {
    const opts = { includeStale: _filter.includeStale }
    if (_filter.baselineId) opts.baselineId = _filter.baselineId
    if (_filter.purpose)    opts.purpose    = _filter.purpose
    if (_filter.period) {
      const d = new Date()
      d.setDate(d.getDate() - parseInt(_filter.period, 10))
      opts.dateFrom = d.toISOString().slice(0, 10)
    }
    return opts
  }

  // ─── Client-side search filter ───────────────────────────────────────────────
  function _applySearch(records) {
    if (!_filter.search) return records
    const kw = _filter.search.toLowerCase()
    return records.filter(r =>
      (r.skillName    || '').toLowerCase().includes(kw) ||
      (r.baselineName || '').toLowerCase().includes(kw)
    )
  }

  // ─── Render: Rank view ───────────────────────────────────────────────────────
  function _renderRankView(data) {
    const body  = _el('rankings-list-body')
    const empty = _el('rankings-empty')
    let html = ''
    let hasAny = false

    if (data.groups) {
      for (const g of data.groups) {
        const recs = _applySearch(g.records)
        if (!recs.length) continue
        hasAny = true
        html += `
          <div class="rankings-group">
            <div class="rankings-group-header">
              <span class="rankings-group-title">${window.escHtml(g.baselineName || g.baselineId)}</span>
              <span class="rankings-group-meta">${g.skillCount} skills · ${g.baselineCaseCount} cases</span>
              ${g.baselinePurpose ? `<span class="category-badge">${window.escHtml(g.baselinePurpose)}</span>` : ''}
              ${g.baselineVersionCurrent ? `<span class="version-badge">${window.escHtml(g.baselineVersionCurrent)}</span>` : ''}
            </div>
            <div class="rankings-table">
              <div class="rankings-table-header">
                <span>#</span><span>Skill</span><span>Score</span><span>Cases</span><span>状态</span><span>时间</span>
              </div>
              ${recs.map((r, i) => _recordRowHtml(r, i + 1)).join('')}
            </div>
          </div>
        `
      }
    } else {
      const recs = _applySearch(data.records || [])
      if (recs.length) {
        hasAny = true
        html = `
          <div class="rankings-group">
            <div class="rankings-table">
              <div class="rankings-table-header">
                <span>#</span><span>Skill</span><span>Score</span><span>Cases</span><span>状态</span><span>时间</span>
              </div>
              ${recs.map((r, i) => _recordRowHtml(r, i + 1)).join('')}
            </div>
          </div>
        `
      }
    }

    if (!hasAny) {
      body.innerHTML = ''
      empty.classList.remove('hidden')
      return
    }
    body.innerHTML = html
    empty.classList.add('hidden')

    // Expand/collapse score breakdown on click
    body.querySelectorAll('.rankings-row[data-expandable]').forEach(row => {
      row.addEventListener('click', () => {
        const next = row.nextElementSibling
        if (next && next.classList.contains('rankings-row-breakdown')) {
          next.classList.toggle('hidden')
          row.classList.toggle('expanded')
        }
      })
    })
  }

  // ─── Render: Timeline view ───────────────────────────────────────────────────
  function _renderTimeline(data) {
    const body = _el('rankings-timeline-body')
    if (!_filter.baselineId) {
      body.innerHTML = '<div class="rankings-timeline-placeholder">请先选择一个基线以查看时间线视图</div>'
      return
    }
    const allRecs = data
      ? _applySearch(data.records || (data.groups || []).flatMap(g => g.records))
      : []

    if (!allRecs.length) {
      body.innerHTML = '<div class="empty-state"><div class="icon">📈</div><div class="title">暂无数据</div></div>'
      return
    }

    // Group by skill
    const bySkill = new Map()
    for (const r of allRecs) {
      if (!bySkill.has(r.skillId)) bySkill.set(r.skillId, { name: r.skillName, points: [] })
      bySkill.get(r.skillId).points.push({ date: r.testedAt, score: r.avgScore, ver: r.skillVersionTested })
    }

    const COLORS  = ['#7c6af7', '#4ade80', '#facc15', '#f87171', '#22d3ee', '#fb923c']
    const W = 560, H = 200, PX = 40, PY = 20
    const allDates = [...new Set(allRecs.map(r => r.testedAt.slice(0, 10)))].sort()
    const dCount   = allDates.length
    const xOf = d => PX + (dCount > 1 ? (allDates.indexOf(d.slice(0, 10)) / (dCount - 1)) * (W - PX * 2) : (W - PX * 2) / 2)
    const yOf = s => PY + (1 - s / 100) * (H - PY * 2)

    let paths = '', dots = '', legend = ''
    let ci = 0
    for (const [, sk] of bySkill) {
      const c   = COLORS[ci % COLORS.length]
      const pts = sk.points.slice().sort((a, b) => a.date < b.date ? -1 : 1)
      const polyPts = pts.map(p => `${xOf(p.date)},${yOf(p.score)}`).join(' ')
      paths += `<polyline points="${window.escHtml(polyPts)}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`
      for (const p of pts) {
        const x = xOf(p.date), y = yOf(p.score)
        dots += `<circle cx="${x}" cy="${y}" r="4" fill="${c}"><title>${window.escHtml(sk.name)} ${window.escHtml(p.ver)}: ${p.score}</title></circle>`
      }
      legend += `<span class="timeline-legend-item"><span class="timeline-dot" style="background:${c}"></span>${window.escHtml(sk.name)}</span>`
      ci++
    }

    let yLines = '', xLabels = ''
    for (const s of [0, 25, 50, 75, 100]) {
      const y = yOf(s)
      yLines += `<line x1="${PX}" y1="${y}" x2="${W - PX}" y2="${y}" stroke="#333" stroke-width="0.5"/>
                 <text x="${PX - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="#888">${s}</text>`
    }
    allDates.forEach((d, i) => {
      const x = PX + (dCount > 1 ? (i / (dCount - 1)) * (W - PX * 2) : (W - PX * 2) / 2)
      xLabels += `<text x="${x}" y="${H - 2}" font-size="9" text-anchor="middle" fill="#888">${d.slice(5)}</text>`
    })

    body.innerHTML = `
      <div class="timeline-chart-wrap">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible">
          ${yLines}${paths}${dots}${xLabels}
        </svg>
        <div class="timeline-legend">${legend}</div>
      </div>
    `
  }

  // ─── Main refresh ─────────────────────────────────────────────────────────────
  async function _refresh() {
    const res = await window.api.leaderboard.query(_buildOpts())
    if (!res.success) {
      window.notify('Rankings load failed: ' + (res.error && res.error.message), 'error')
      return
    }
    const data = res.data
    _rebuildDropdowns(data)
    if (_view === 'rank') _renderRankView(data)
    else                  _renderTimeline(data)
  }

  // ─── View toggle ──────────────────────────────────────────────────────────────
  function _setView(v) {
    _view = v
    _el('rankings-view-rank-btn').classList.toggle('active', v === 'rank')
    _el('rankings-view-timeline-btn').classList.toggle('active', v === 'timeline')
    _el('rankings-list-body').classList.toggle('hidden', v !== 'rank')
    _el('rankings-timeline-body').classList.toggle('hidden', v !== 'timeline')
    _refresh()
  }

  // ─── Filter binding ───────────────────────────────────────────────────────────
  function _bindFilters() {
    const searchEl = _el('rankings-search')
    searchEl.addEventListener('input', _debounce(() => {
      _filter.search = searchEl.value.trim()
      _refresh()
    }, 300))

    _el('rankings-baseline-select').addEventListener('change', e => { _filter.baselineId = e.target.value; _refresh() })
    _el('rankings-purpose-select').addEventListener('change',  e => { _filter.purpose    = e.target.value; _refresh() })
    _el('rankings-period-select').addEventListener('change',   e => { _filter.period     = e.target.value; _refresh() })
    _el('rankings-include-stale').addEventListener('change',   e => { _filter.includeStale = e.target.checked; _refresh() })

    _el('rankings-clear-btn').addEventListener('click', () => {
      _filter = { search: '', baselineId: '', purpose: '', period: '', includeStale: true }
      searchEl.value = ''
      _el('rankings-baseline-select').value = ''
      _el('rankings-purpose-select').value  = ''
      _el('rankings-period-select').value   = ''
      _el('rankings-include-stale').checked = true
      _refresh()
    })

    _el('rankings-export-btn').addEventListener('click', async () => {
      const opts = _buildOpts()
      const res = await window.api.leaderboard.export({ baselineId: opts.baselineId, format: 'csv' })
      if (res.success) window.notify('已导出: ' + res.data.filePath, 'success')
      else window.notify('导出失败: ' + (res.error && res.error.message), 'error')
    })

    _el('rankings-view-rank-btn').addEventListener('click',     () => _setView('rank'))
    _el('rankings-view-timeline-btn').addEventListener('click', () => _setView('timeline'))
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Initialise the Rankings page. Called from app.js on DOMContentLoaded.
   */
  async function init() {
    _bindFilters()
    await _refresh()
  }

  /**
   * Navigate to Rankings page with pre-set filters.
   * Called from Skill list test-badge click or other pages.
   *
   * @param {object} opts
   * @param {string} [opts.skillName]   - pre-fill search box with skill name
   * @param {string} [opts.baselineId]  - select a specific baseline
   */
  function navigateWithFilter(opts) {
    if (opts.baselineId) {
      _filter.baselineId = opts.baselineId
      _el('rankings-baseline-select').value = opts.baselineId
    }
    if (opts.skillName) {
      _filter.search = opts.skillName
      _el('rankings-search').value = opts.skillName
    }
    // Switch to Rankings tab
    const tab = document.querySelector('[data-page="rankings"]')
    if (tab) tab.click()
    _refresh()
  }

  return { init, navigateWithFilter }
})()

window.RankingsPage = RankingsPage
