'use strict'
/**
 * baseline.js — Baseline management page
 */

const BaselinePage = (() => {
  let currentBaselineId = null
  let currentVersion = null
  let currentPage = 1
  const pageSize = 20
  let searchTimeout = null

  // ─── Filter state ──────────────────────────────────────────────────────────
  let activeTagFilters = []
  let activePurpose    = ''
  let activeProvider   = ''

  // ─── List ──────────────────────────────────────────────────────────────────

  async function loadList(keyword = '') {
    const res = await window.api.baseline.list({
      keyword:  keyword || undefined,
      tags:     activeTagFilters.length > 0 ? activeTagFilters : undefined,
      purpose:  activePurpose  || undefined,
      provider: activeProvider || undefined,
      page:     currentPage,
      pageSize,
    })
    if (!res.success) { window.notify('Failed to load baselines', 'error'); return }

    const listEl       = document.getElementById('baseline-list')
    const paginationEl = document.getElementById('baseline-pagination')

    if (res.data.items.length === 0) {
      const hasFilter = keyword || activeTagFilters.length || activePurpose || activeProvider
      if (hasFilter) {
        listEl.innerHTML = `<div class="empty-state" style="padding:30px"><div class="icon">📋</div><div class="title">No baselines found</div><div class="sub">Try clearing filters</div></div>`
      } else {
        listEl.innerHTML = `
          <div class="empty-state guide-card" style="padding:30px;text-align:center">
            <div class="icon">📋</div>
            <div class="title">还没有测试基线</div>
            <div class="sub">先创建一套"标准试卷"，再用它来评测 Skill</div>
            <button class="btn btn-primary btn-sm" id="empty-baseline-import-btn" style="margin-top:14px">+ 导入第一套基线</button>
          </div>`
        document.getElementById('empty-baseline-import-btn').addEventListener('click', () => {
          document.getElementById('baseline-import-btn').click()
        })
      }
      paginationEl.innerHTML = ''
      return
    }

    listEl.innerHTML = res.data.items.map(b => `
      <div class="skill-item" data-id="${b.id}">
        <div class="skill-item-name">${window.escHtml(b.name)}</div>
        <div class="skill-item-meta">
          <span class="version-badge">${b.version}</span>
          <span class="category-badge clickable-tag" data-tag="${window.escHtml(b.purpose)}" style="cursor:pointer">${window.escHtml(b.purpose)}</span>
          <span style="color:var(--text-muted);font-size:11px">${window.escHtml(b.provider)}</span>
          <span style="color:var(--text-muted)">${b.caseCount} cases</span>
          ${b.pendingTagCount > 0 ? `<span class="tag pending">${b.pendingTagCount} pending</span>` : ''}
        </div>
        <div class="tags-wrap">
          ${(b.tags || []).slice(0, 3).map(t => `<span class="tag clickable-tag" data-tag="${window.escHtml(t)}">${window.escHtml(t)}</span>`).join('')}
        </div>
      </div>
    `).join('')

    const total      = res.data.total
    const totalPages = Math.ceil(total / pageSize)
    paginationEl.innerHTML = total > pageSize ? `
      <button data-action="prev" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
      <span>${currentPage} / ${totalPages} (${total})</span>
      <button data-action="next" data-total="${totalPages}" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>
    ` : `<span style="font-size:12px;color:var(--text-muted)">${total} baseline(s)</span>`

    paginationEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'prev') prevPage()
        else nextPage(parseInt(btn.dataset.total))
      })
    })

    listEl.querySelectorAll('.skill-item').forEach(item => {
      item.addEventListener('click', () => openDetail(item.dataset.id))
    })

    // Tag / purpose click → add to filter
    listEl.querySelectorAll('.clickable-tag').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        addTagFilter(el.dataset.tag)
      })
    })
  }

  function _currentKeyword() { return document.getElementById('baseline-search').value.trim() }
  function prevPage() { if (currentPage > 1) { currentPage--; loadList(_currentKeyword()) } }
  function nextPage(total) { if (currentPage < total) { currentPage++; loadList(_currentKeyword()) } }

  // ─── Detail ────────────────────────────────────────────────────────────────

  async function openDetail(baselineId) {
    currentBaselineId = baselineId

    document.querySelectorAll('#baseline-list .skill-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === baselineId)
    })

    const res = await window.api.baseline.get({ baselineId })
    if (!res.success) { window.notify('Failed to load baseline', 'error'); return }

    const { meta, cases, tags, versions } = res.data
    currentVersion = meta.version

    document.getElementById('baseline-detail-empty').style.display = 'none'
    const detailEl = document.getElementById('baseline-detail')
    detailEl.style.display = 'flex'
    document.getElementById('baseline-detail-name').textContent = meta.name

    const effectiveTags = [
      ...tags.manual.map(t => `<span class="tag">${window.escHtml(t.value)}</span>`),
      ...tags.auto.filter(t => t.status === 'approved').map(t => `<span class="tag auto">${window.escHtml(t.value)}</span>`),
    ]

    // Build cases table
    const casesHtml = (cases.cases || []).map(c => `
      <tr>
        <td><code>${c.id}</code></td>
        <td>${window.escHtml(c.name)}</td>
        <td><span class="category-badge ${c.category}">${c.category}</span></td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${window.escHtml(c.input)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-case-action="edit" data-case-id="${c.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-case-action="delete" data-case-id="${c.id}">Del</button>
        </td>
      </tr>
    `).join('')

    document.getElementById('baseline-detail-body').innerHTML = `
      <div class="detail-section" style="padding:12px">
        <div class="detail-section-title">Metadata</div>
        <div class="meta-grid">
          <div class="meta-field"><label>Version</label><div class="val"><span class="version-badge">${meta.version}</span></div></div>
          <div class="meta-field"><label>Cases</label><div class="val">${meta.case_count}</div></div>
          <div class="meta-field"><label>Purpose</label><div class="val">${window.escHtml(meta.purpose)}</div></div>
          <div class="meta-field"><label>Provider</label><div class="val">${window.escHtml(meta.provider)}</div></div>
        </div>
      </div>
      <div class="detail-section" style="padding:12px">
        <div class="detail-section-title">Tags</div>
        <div class="tags-wrap">${effectiveTags.join('') || '<span style="color:var(--text-muted);font-size:12px">No tags</span>'}</div>
      </div>
      <div class="detail-section" style="padding:0 12px 12px">
        <div class="detail-section-title" style="padding:8px 0">Test Cases (${(cases.cases || []).length})</div>
        <div style="overflow-x:auto">
          <table class="cases-table">
            <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Input</th><th>Actions</th></tr></thead>
            <tbody>${casesHtml || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No cases</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `

    // Case Edit / Delete button handlers
    document.getElementById('baseline-detail-body').querySelectorAll('[data-case-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.caseAction === 'edit') editCase(btn.dataset.caseId)
        else deleteCase(btn.dataset.caseId)
      })
    })

    // Aux: versions
    document.getElementById('baseline-aux-body').innerHTML = `
      <div style="padding:12px">
        <div class="detail-section-title">Version History (${versions.length})</div>
        ${versions.map(v => `
          <div class="version-item">
            <span class="version-badge">${v.version}</span>
            <span style="font-size:11px;color:var(--text-muted);flex:1">${window.fmtDate(v.updated_at)}</span>
            ${v.version === meta.version
              ? '<span style="font-size:11px;color:var(--success)">current</span>'
              : `<button class="btn btn-secondary btn-sm" data-rollback-version="${v.version}">Restore</button>`}
          </div>
        `).reverse().join('')}
      </div>
    `

    document.getElementById('baseline-aux-body').querySelectorAll('[data-rollback-version]').forEach(btn => {
      btn.addEventListener('click', () => rollback(btn.dataset.rollbackVersion))
    })
  }

  // ─── Case Management ───────────────────────────────────────────────────────

  async function addCaseDialog() {
    if (!currentBaselineId) return
    const name = prompt('Case name:')
    if (!name) return
    const category = prompt('Category (standard/boundary/exception):', 'standard') || 'standard'
    const input = prompt('Input:')
    if (!input) return
    const expected_output = prompt('Expected output:')
    if (!expected_output) return

    const res = await window.api.baseline.case.add({
      baselineId: currentBaselineId,
      currentVersion,
      cases: [{ name, category, input, expected_output }],
    })
    if (!res.success) { window.notify('Failed to add case', 'error'); return }
    window.notify('Case added', 'success')
    openDetail(currentBaselineId)
    loadList()
  }

  async function editCase(caseId) {
    // Simple inline edit via prompts
    const res = await window.api.baseline.get({ baselineId: currentBaselineId })
    if (!res.success) return
    const c = res.data.cases.cases.find(x => x.id === caseId)
    if (!c) return

    const input = prompt('Edit input:', c.input)
    if (input === null) return
    const expected = prompt('Edit expected output:', c.expected_output)
    if (expected === null) return

    const upd = await window.api.baseline.case.update({
      baselineId: currentBaselineId,
      currentVersion,
      caseId,
      changes: { input, expected_output: expected },
    })
    if (!upd.success) { window.notify('Update failed', 'error'); return }
    window.notify('Case updated', 'success')
    openDetail(currentBaselineId)
    loadList()
  }

  async function deleteCase(caseId) {
    if (!confirm(`Delete case ${caseId}?`)) return
    const res = await window.api.baseline.case.delete({
      baselineId: currentBaselineId,
      currentVersion,
      caseId,
    })
    if (!res.success) { window.notify('Delete failed', 'error'); return }
    window.notify('Case deleted', 'success')
    openDetail(currentBaselineId)
    loadList()
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  async function rollback(targetVersion) {
    if (!currentBaselineId) return
    const res = await window.api.baseline.version.rollback({ baselineId: currentBaselineId, targetVersion })
    if (!res.success) { window.notify('Rollback failed: ' + res.error?.message, 'error'); return }
    window.notify(`Restored to ${targetVersion} as ${res.data.newVersion}`, 'success')
    loadList()
    openDetail(currentBaselineId)
  }

  // ─── Auto-Tag ─────────────────────────────────────────────────────────────

  async function triggerAutoTag() {
    if (!currentBaselineId) return
    const res = await window.api.baseline.autoTag.trigger({ baselineId: currentBaselineId })
    if (!res.success) { window.notify('Auto-tag trigger failed', 'error'); return }
    window.notify('Auto-tagging started…', 'info')
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  async function confirmImport() {
    const activeTab = document.querySelector('#baseline-import-modal .import-tab.active').dataset.tab
    const name = document.getElementById('baseline-import-name').value.trim()
    const purpose = document.getElementById('baseline-import-purpose').value.trim()
    const provider = document.getElementById('baseline-import-provider').value.trim()
    if (!name || !purpose || !provider) { window.notify('Name, Purpose, Provider required', 'error'); return }

    let importArgs = { meta: { name, purpose, provider } }

    if (activeTab === 'manual') {
      importArgs.importType = 'manual'
      importArgs.cases = []
    } else if (activeTab === 'bfile') {
      importArgs.importType = 'file'
      importArgs.filePath = document.getElementById('baseline-import-filepath').value.trim()
      if (!importArgs.filePath) { window.notify('File path required', 'error'); return }
    } else {
      importArgs.importType = 'cli_generate'
      importArgs.generatePrompt = document.getElementById('baseline-import-prompt').value.trim()
      const countEl = document.getElementById('baseline-import-count')
      importArgs.cliConfig = { case_count: parseInt(countEl.value) || 10 }
      if (!importArgs.generatePrompt) { window.notify('Task description required', 'error'); return }
    }

    const res = await window.api.baseline.import(importArgs)
    if (!res.success) { window.notify('Import failed: ' + res.error.message, 'error'); return }
    window.closeModal('baseline-import-modal')
    window.notify(`Baseline imported: ${res.data.caseCount} cases`, 'success')
    loadList()
  }

  // ─── Filter ────────────────────────────────────────────────────────────────

  function addTagFilter(tag) {
    if (!tag || activeTagFilters.includes(tag)) return
    activeTagFilters.push(tag)
    currentPage = 1
    _renderActiveFilters()
    loadList(_currentKeyword())
  }

  function removeTagFilter(tag) {
    activeTagFilters = activeTagFilters.filter(t => t !== tag)
    currentPage = 1
    _renderActiveFilters()
    loadList(_currentKeyword())
  }

  function clearAllFilters() {
    activeTagFilters = []
    activePurpose    = ''
    activeProvider   = ''
    document.getElementById('baseline-purpose-input').value  = ''
    document.getElementById('baseline-provider-input').value = ''
    currentPage = 1
    _renderActiveFilters()
    loadList(_currentKeyword())
  }

  function _renderActiveFilters() {
    const container = document.getElementById('baseline-active-tags')
    if (!container) return
    const chips = activeTagFilters.map(t => `
      <span class="filter-chip">
        ${window.escHtml(t)}
        <span class="filter-chip-remove" data-tag="${window.escHtml(t)}">×</span>
      </span>
    `).join('')
    const hasFilters = activeTagFilters.length > 0 || activePurpose || activeProvider
    container.innerHTML = chips + (hasFilters ? `<span class="filter-chip" style="background:var(--text-muted);cursor:pointer" id="baseline-clear-filters">clear all</span>` : '')
    container.querySelectorAll('.filter-chip-remove').forEach(el => {
      el.addEventListener('click', () => removeTagFilter(el.dataset.tag))
    })
    const clearBtn = document.getElementById('baseline-clear-filters')
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters)
  }

  // ─── P1-2: Autocomplete datalist for Purpose / Provider ──────────────────

  async function _fillPurposeProviderDatalist() {
    const res = await window.api.baseline.list({ pageSize: 200 })
    if (!res.success) return
    const purposes  = [...new Set((res.data.items || []).map(b => b.purpose).filter(Boolean))]
    const providers = [...new Set((res.data.items || []).map(b => b.provider).filter(Boolean))]
    const pdl = document.getElementById('baseline-purpose-datalist')
    const rdl = document.getElementById('baseline-provider-datalist')
    if (pdl) pdl.innerHTML = purposes.map(v => `<option value="${window.escHtml(v)}">`).join('')
    if (rdl) rdl.innerHTML = providers.map(v => `<option value="${window.escHtml(v)}">`).join('')
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('baseline-import-btn').addEventListener('click', () => {
      ['baseline-import-name','baseline-import-purpose','baseline-import-provider',
       'baseline-import-filepath','baseline-import-prompt'].forEach(id => {
        const el = document.getElementById(id)
        if (el) el.value = ''
      })
      // P1-2: Populate autocomplete datalists
      _fillPurposeProviderDatalist()
      window.openModal('baseline-import-modal')
    })

    document.getElementById('baseline-import-confirm').addEventListener('click', confirmImport)
    document.getElementById('baseline-add-case-btn').addEventListener('click', addCaseDialog)
    document.getElementById('baseline-autotag-btn').addEventListener('click', triggerAutoTag)

    // P1-3: Download cases.json template
    document.getElementById('baseline-download-template-btn').addEventListener('click', async () => {
      const res = await window.api.workspace.saveTemplate()
      if (!res.success) { window.notify('模板保存失败', 'error'); return }
      window.notify(`模板已保存到：${res.data.path}`, 'success')
    })

    const searchEl = document.getElementById('baseline-search')
    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => { currentPage = 1; loadList(searchEl.value.trim()) }, 350)
    })

    // Tag filter: Enter key
    const tagInputEl = document.getElementById('baseline-tag-input')
    tagInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = tagInputEl.value.trim()
        if (val) { addTagFilter(val); tagInputEl.value = '' }
      }
    })

    // Purpose / Provider: debounced
    const purposeEl  = document.getElementById('baseline-purpose-input')
    const providerEl = document.getElementById('baseline-provider-input')
    let ft = null
    const onFilterChange = () => {
      clearTimeout(ft)
      ft = setTimeout(() => {
        activePurpose  = purposeEl.value.trim()
        activeProvider = providerEl.value.trim()
        currentPage    = 1
        _renderActiveFilters()
        loadList(_currentKeyword())
      }, 350)
    }
    purposeEl.addEventListener('input', onFilterChange)
    providerEl.addEventListener('input', onFilterChange)

    window.api.on('autoTag:progress:update', (data) => {
      if (data.targetType !== 'baseline') return
      if (data.status === 'completed') {
        window.notify(`Baseline auto-tag: ${data.result.pendingCount} tags pending`, 'info')
        if (data.targetId === currentBaselineId) openDetail(currentBaselineId)
        loadList(_currentKeyword())
      }
    })

    loadList()
  }

  return { init, loadList, openDetail, addTagFilter, editCase, deleteCase, rollback, prevPage, nextPage }
})()

window.BaselinePage = BaselinePage
