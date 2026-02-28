'use strict'
/**
 * skill.js — Skill management page
 */

const SkillPage = (() => {
  let currentSkillId = null
  let currentVersion = null
  let currentPage = 1
  const pageSize = 20
  let searchTimeout = null

  // ─── Filter state ──────────────────────────────────────────────────────────
  let activeTagFilters = []   // string[]
  let activePurpose    = ''
  let activeProvider   = ''

  // ─── Test summaries cache (for badge display) ──────────────────────────────
  let _testSummaries = null   // null = not loaded yet; {} = no results

  // ─── List ──────────────────────────────────────────────────────────────────

  async function loadList(keyword = '') {
    const res = await window.api.skill.list({
      keyword:  keyword || undefined,
      tags:     activeTagFilters.length > 0 ? activeTagFilters : undefined,
      purpose:  activePurpose  || undefined,
      provider: activeProvider || undefined,
      sortBy:   'updated_at',
      sortOrder: 'desc',
      page:     currentPage,
      pageSize,
    })
    if (!res.success) { window.notify('Failed to load skills: ' + res.error.message, 'error'); return }

    const listEl       = document.getElementById('skill-list')
    const paginationEl = document.getElementById('skill-pagination')

    if (res.data.items.length === 0) {
      const hasFilter = keyword || activeTagFilters.length || activePurpose || activeProvider
      if (hasFilter) {
        listEl.innerHTML = `<div class="empty-state" style="padding:30px"><div class="icon">🔮</div><div class="title">No skills found</div><div class="sub">Try clearing filters</div></div>`
      } else {
        listEl.innerHTML = `
          <div class="empty-state guide-card" style="padding:30px;text-align:center">
            <div class="icon">🔮</div>
            <div class="title">还没有 Skill</div>
            <div class="sub">导入第一个提示词，开始体验对比与优化</div>
            <button class="btn btn-primary btn-sm" id="empty-skill-import-btn" style="margin-top:14px">+ 导入第一个 Skill</button>
          </div>`
        document.getElementById('empty-skill-import-btn').addEventListener('click', () => {
          document.getElementById('skill-import-btn').click()
        })
      }
      paginationEl.innerHTML = ''
      return
    }

    listEl.innerHTML = res.data.items.map(skill => `
      <div class="skill-item" data-id="${skill.id}" data-preview="${escHtml(skill.contentPreview || '')}">
        <div class="skill-item-name">${escHtml(skill.name)}</div>
        <div class="skill-item-meta">
          <span class="type-badge ${escHtml(skill.type || 'skill')}">${skill.type === 'agent' ? 'A' : 'S'}</span>
          <span class="version-badge">${skill.version}</span>
          <span class="category-badge clickable-tag" data-tag="${escHtml(skill.purpose)}" style="cursor:pointer">${escHtml(skill.purpose)}</span>
          <span style="color:var(--text-muted);font-size:11px">${escHtml(skill.provider)}</span>
          ${skill.pendingTagCount > 0 ? `<span class="tag pending">${skill.pendingTagCount} pending</span>` : ''}
        </div>
        <div class="tags-wrap">
          ${skill.tags.slice(0, 4).map(t => `<span class="tag clickable-tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`).join('')}
        </div>
        <div class="skill-item-preview">${escHtml((skill.contentPreview || '').slice(0, 80))}</div>
      </div>
    `).join('')

    // Pagination
    const total      = res.data.total
    const totalPages = Math.ceil(total / pageSize)
    paginationEl.innerHTML = total > pageSize ? `
      <button data-action="prev" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
      <span>${currentPage} / ${totalPages} (${total})</span>
      <button data-action="next" data-total="${totalPages}" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>
    ` : `<span style="font-size:12px;color:var(--text-muted)">${total} skill(s)</span>`

    paginationEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'prev') prevPage()
        else nextPage(parseInt(btn.dataset.total))
      })
    })

    // Click handler: open detail
    listEl.querySelectorAll('.skill-item').forEach(item => {
      item.addEventListener('click', () => openDetail(item.dataset.id))
    })

    // Click handler: tag / purpose badge → add to filter
    listEl.querySelectorAll('.clickable-tag').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        addTagFilter(el.dataset.tag)
      })
    })

    // Hover preview
    setupHoverPreview(listEl)

    // Test score badges (async — non-blocking)
    _injectTestBadges(listEl)
  }

  function prevPage() { if (currentPage > 1) { currentPage--; loadList(_currentKeyword()) } }
  function nextPage(total) { if (currentPage < total) { currentPage++; loadList(_currentKeyword()) } }
  function _currentKeyword() { return document.getElementById('skill-search').value.trim() }

  // ─── Test badges ───────────────────────────────────────────────────────────

  /**
   * Fetch test summaries (cached per session) and inject score badges into
   * each visible skill-item. Clicking a badge navigates to the Rankings page.
   */
  async function _injectTestBadges(listEl) {
    if (!_testSummaries) {
      const res = await window.api.leaderboard.getTestSummaries()
      _testSummaries = res.success ? (res.data || {}) : {}
    }
    listEl.querySelectorAll('.skill-item').forEach(item => {
      const sid     = item.dataset.id
      const summary = _testSummaries[sid]
      if (!summary) return

      const sc  = summary.best_score >= 80 ? 'hi' : summary.best_score >= 60 ? 'mid' : 'lo'
      const stale = summary.staleness !== 'current' ? ' stale' : ''
      const badge = document.createElement('span')
      badge.className = `skill-test-badge ${sc}${stale}`
      badge.title = `最高分: ${summary.best_score} · 基线: ${summary.best_baseline_name} · ${summary.test_count} 次测试`
      badge.textContent = `✓ ${summary.best_score}`
      badge.addEventListener('click', e => {
        e.stopPropagation()
        const name = (item.querySelector('.skill-item-name') || {}).textContent || ''
        if (window.RankingsPage) window.RankingsPage.navigateWithFilter({ skillName: name.trim() })
      })
      const meta = item.querySelector('.skill-item-meta')
      if (meta) meta.appendChild(badge)
    })
  }

  /** Invalidate test summaries cache (call after a test run completes). */
  function _clearTestSummariesCache() { _testSummaries = null }

  // ─── Detail ────────────────────────────────────────────────────────────────

  async function openDetail(skillId) {
    currentSkillId = skillId

    // Highlight in list
    document.querySelectorAll('.skill-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === skillId)
    })

    const res = await window.api.skill.get({ skillId })
    if (!res.success) { window.notify('Failed to load skill', 'error'); return }

    const { meta, content, tags, versions } = res.data
    currentVersion = meta.version

    document.getElementById('skill-detail-empty').style.display = 'none'
    const detailEl = document.getElementById('skill-detail')
    detailEl.style.display = 'flex'
    document.getElementById('skill-detail-name').textContent = meta.name

    // Detail body
    const effectiveTags = [
      ...tags.manual.map(t => `<span class="tag" data-id="${t.id}" data-type="manual">${escHtml(t.value)} <span class="tag-remove" style="cursor:pointer;margin-left:2px">×</span></span>`),
      ...tags.auto.filter(t => t.status === 'approved').map(t => `<span class="tag auto" data-id="${t.id}" data-type="auto">${escHtml(t.value)} <span class="tag-remove" style="cursor:pointer;margin-left:2px">×</span></span>`),
    ]
    const pendingTags = tags.auto.filter(t => t.status === 'pending')

    document.getElementById('skill-detail-body').innerHTML = `
      <div class="detail-section">
        <div class="detail-section-title">Metadata</div>
        <div class="meta-grid">
          <div class="meta-field"><label>ID</label><div class="val" style="font-size:11px;color:var(--text-muted)">${meta.id}</div></div>
          <div class="meta-field"><label>Version</label><div class="val"><span class="version-badge">${meta.version}</span></div></div>
          <div class="meta-field"><label>Purpose</label><div class="val">${escHtml(meta.purpose)}</div></div>
          <div class="meta-field"><label>Provider</label><div class="val">${escHtml(meta.provider)}</div></div>
          <div class="meta-field"><label>Type</label><div class="val"><span class="type-badge ${escHtml(meta.type || 'skill')}">${meta.type === 'agent' ? 'Agent' : 'Skill'}</span></div></div>
          <div class="meta-field"><label>Author</label><div class="val">${escHtml(meta.author || '—')}</div></div>
          <div class="meta-field"><label>Updated</label><div class="val">${fmtDate(meta.updated_at)}</div></div>
        </div>
        ${meta.description ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${escHtml(meta.description)}</div>` : ''}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Tags
          <button class="btn btn-secondary btn-sm" style="margin-left:8px" id="skill-add-tag-btn">+ Add</button>
        </div>
        <div class="tags-wrap" id="skill-tags-wrap">
          ${effectiveTags.join('') || '<span style="color:var(--text-muted);font-size:12px">No tags</span>'}
        </div>
      </div>

      ${pendingTags.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">⏳ Pending Auto-Tags (${pendingTags.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${pendingTags.map(t => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px;background:var(--bg-hover);border-radius:6px">
              <span class="tag pending">${escHtml(t.value)}</span>
              <button class="btn btn-secondary btn-sm" data-review-action="approve" data-tag-id="${t.id}">Approve</button>
              <button class="btn btn-danger btn-sm" data-review-action="reject" data-tag-id="${t.id}">Reject</button>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="detail-section">
        <div class="detail-section-title">Prompt Content</div>
        <div class="content-box">${escHtml(content)}</div>
      </div>
    `

    // Tag remove handlers
    document.getElementById('skill-tags-wrap').querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const tag = btn.closest('.tag')
        removeTag(tag.dataset.id, tag.dataset.type)
      })
    })

    // "+ Add" tag button
    document.getElementById('skill-add-tag-btn').addEventListener('click', addTagDialog)

    // Pending auto-tag Approve / Reject buttons
    document.getElementById('skill-detail-body').querySelectorAll('[data-review-action]').forEach(btn => {
      btn.addEventListener('click', () => reviewTag(btn.dataset.tagId, btn.dataset.reviewAction))
    })

    // Aux panel: versions
    const versionHtml = versions.map(v => `
      <div class="version-item">
        <span class="version-badge">${v.version}</span>
        <span style="font-size:11px;color:var(--text-muted);flex:1">${fmtDate(v.updated_at)}</span>
        ${v.version !== meta.version ? `<button class="btn btn-secondary btn-sm" data-rollback-version="${v.version}">Restore</button>` : '<span style="font-size:11px;color:var(--success)">current</span>'}
      </div>
    `).reverse().join('')

    document.getElementById('skill-aux-body').innerHTML = `
      <div class="detail-section" style="padding:12px">
        <div class="detail-section-title">Version History (${versions.length})</div>
        ${versionHtml}
      </div>
    `

    document.getElementById('skill-aux-body').querySelectorAll('[data-rollback-version]').forEach(btn => {
      btn.addEventListener('click', () => rollback(btn.dataset.rollbackVersion))
    })
  }

  // ─── Tag Operations ────────────────────────────────────────────────────────

  function addTagDialog() {
    document.getElementById('add-tag-value').value = ''
    window.openModal('add-tag-modal')
    document.getElementById('add-tag-value').focus()
  }

  async function confirmAddTag() {
    const value = document.getElementById('add-tag-value').value.trim()
    if (!value) { window.notify('Tag value is empty', 'error'); return }
    const res = await window.api.skill.tag.add({ skillId: currentSkillId, value })
    if (!res.success) { window.notify('Failed to add tag', 'error'); return }
    window.closeModal('add-tag-modal')
    window.notify('Tag added', 'success')
    openDetail(currentSkillId)
  }

  async function removeTag(tagId, tagType) {
    const res = await window.api.skill.tag.remove({ skillId: currentSkillId, tagId, tagType })
    if (!res.success) { window.notify('Failed to remove tag', 'error'); return }
    window.notify('Tag removed', 'success')
    openDetail(currentSkillId)
  }

  async function reviewTag(tagId, action) {
    const res = await window.api.skill.autoTag.review({
      skillId: currentSkillId,
      reviews: [{ tagId, action }],
    })
    if (!res.success) { window.notify('Review failed', 'error'); return }
    window.notify(`Tag ${action}d`, 'success')
    openDetail(currentSkillId)
  }

  // ─── Edit ──────────────────────────────────────────────────────────────────

  async function openEdit() {
    if (!currentSkillId) return
    const res = await window.api.skill.get({ skillId: currentSkillId })
    if (!res.success) return
    const { meta, content } = res.data
    document.getElementById('skill-edit-name').value = meta.name
    document.getElementById('skill-edit-description').value = meta.description || ''
    document.getElementById('skill-edit-author').value = meta.author || ''
    document.getElementById('skill-edit-type').value = meta.type || 'skill'
    document.getElementById('skill-edit-content').value = content
    window.openModal('skill-edit-modal')
  }

  async function confirmEdit() {
    const name = document.getElementById('skill-edit-name').value.trim()
    const description = document.getElementById('skill-edit-description').value.trim()
    const author = document.getElementById('skill-edit-author').value.trim()
    const type = document.getElementById('skill-edit-type').value
    const content = document.getElementById('skill-edit-content').value

    const res = await window.api.skill.update({
      skillId: currentSkillId,
      currentVersion,
      changes: {
        content,
        meta: { name, description, author, type },
      },
    })
    if (!res.success) { window.notify('Save failed: ' + res.error.message, 'error'); return }
    window.closeModal('skill-edit-modal')
    window.notify(`Saved as ${res.data.newVersion}`, 'success')
    loadList()
    openDetail(currentSkillId)
  }

  // ─── Auto-Tag ──────────────────────────────────────────────────────────────

  async function triggerAutoTag() {
    if (!currentSkillId) return
    const res = await window.api.skill.autoTag.trigger({ skillId: currentSkillId })
    if (!res.success) { window.notify('Auto-tag trigger failed', 'error'); return }
    window.notify('Auto-tagging started… will update when complete', 'info')
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  async function rollback(targetVersion) {
    if (!currentSkillId) return
    const res = await window.api.skill.version.rollback({ skillId: currentSkillId, targetVersion })
    if (!res.success) { window.notify('Rollback failed', 'error'); return }
    window.notify(`Restored to ${targetVersion} as ${res.data.newVersion}`, 'success')
    loadList()
    openDetail(currentSkillId)
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async function deleteSkill() {
    if (!currentSkillId) return
    if (!confirm('Archive this skill? It will be hidden but files remain on disk.')) return
    const res = await window.api.skill.delete({ skillId: currentSkillId })
    if (!res.success) { window.notify('Delete failed', 'error'); return }
    window.notify('Skill archived', 'success')
    currentSkillId = null
    document.getElementById('skill-detail').style.display = 'none'
    document.getElementById('skill-detail-empty').style.display = 'flex'
    document.getElementById('skill-aux-body').innerHTML = ''
    loadList()
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  let _suggestedPurpose = null   // tracks the merge-suggestion target

  async function onPurposeBlur() {
    const newPurpose = document.getElementById('skill-import-purpose').value.trim()
    const suggEl = document.getElementById('skill-purpose-suggestion')
    suggEl.style.display = 'none'
    if (!newPurpose) return

    const res = await window.api.skill.purposeSuggest({ newPurpose })
    if (!res.success || !res.data.shouldMerge) return

    _suggestedPurpose = res.data.suggestedPurpose
    document.getElementById('skill-purpose-suggestion-text').textContent = res.data.reason
    document.getElementById('skill-purpose-merge-btn').textContent = `Use "${_suggestedPurpose}"`
    suggEl.style.display = 'block'
  }

  function acceptMergeSuggestion() {
    if (_suggestedPurpose) {
      document.getElementById('skill-import-purpose').value = _suggestedPurpose
      _suggestedPurpose = null
    }
    document.getElementById('skill-purpose-suggestion').style.display = 'none'
  }

  function dismissMergeSuggestion() {
    _suggestedPurpose = null
    document.getElementById('skill-purpose-suggestion').style.display = 'none'
  }

  async function confirmImport() {
    const activeTab = document.querySelector('#skill-import-modal .import-tab.active').dataset.tab
    const name = document.getElementById('skill-import-name').value.trim()
    const purpose = document.getElementById('skill-import-purpose').value.trim()
    const provider = document.getElementById('skill-import-provider').value.trim()
    const description = document.getElementById('skill-import-description').value.trim()
    const author = document.getElementById('skill-import-author').value.trim()

    if (!name || !purpose || !provider) { window.notify('Name, Purpose, Provider are required', 'error'); return }

    let importType, content
    if (activeTab === 'text') {
      importType = 'text'
      content = document.getElementById('skill-import-content').value
      if (!content.trim()) { window.notify('Content is empty', 'error'); return }
    } else {
      importType = 'file'
      content = document.getElementById('skill-import-filepath').value.trim()
      if (!content) { window.notify('File path is empty', 'error'); return }
    }

    const type = document.getElementById('skill-import-type').value

    const res = await window.api.skill.import({
      importType, content,
      meta: { name, purpose, provider, description, author, type },
    })
    if (!res.success) { window.notify('Import failed: ' + res.error.message, 'error'); return }
    window.closeModal('skill-import-modal')
    window.notify('Skill imported successfully', 'success')
    loadList()
  }

  // ─── Search & Filter ──────────────────────────────────────────────────────

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
    document.getElementById('skill-purpose-input').value  = ''
    document.getElementById('skill-provider-input').value = ''
    currentPage = 1
    _renderActiveFilters()
    loadList(_currentKeyword())
  }

  function _renderActiveFilters() {
    const container = document.getElementById('skill-active-tags')
    if (!container) return
    const chips = activeTagFilters.map(t => `
      <span class="filter-chip">
        ${escHtml(t)}
        <span class="filter-chip-remove" data-tag="${escHtml(t)}">×</span>
      </span>
    `).join('')
    const hasFilters = activeTagFilters.length > 0 || activePurpose || activeProvider
    container.innerHTML = chips + (hasFilters ? `<span class="filter-chip" style="background:var(--text-muted);cursor:pointer" id="skill-clear-filters">clear all</span>` : '')
    container.querySelectorAll('.filter-chip-remove').forEach(el => {
      el.addEventListener('click', () => removeTagFilter(el.dataset.tag))
    })
    const clearBtn = document.getElementById('skill-clear-filters')
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters)
  }

  function setupSearch() {
    const searchEl = document.getElementById('skill-search')
    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => { currentPage = 1; loadList(searchEl.value.trim()) }, 350)
    })

    // Tag filter: Enter key adds chip
    const tagInputEl = document.getElementById('skill-tag-input')
    tagInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = tagInputEl.value.trim()
        if (val) { addTagFilter(val); tagInputEl.value = '' }
      }
    })

    // Purpose / Provider: debounced
    const purposeEl  = document.getElementById('skill-purpose-input')
    const providerEl = document.getElementById('skill-provider-input')
    let ft = null
    const onChange = () => {
      clearTimeout(ft)
      ft = setTimeout(() => {
        activePurpose  = purposeEl.value.trim()
        activeProvider = providerEl.value.trim()
        currentPage    = 1
        _renderActiveFilters()
        loadList(_currentKeyword())
      }, 350)
    }
    purposeEl.addEventListener('input', onChange)
    providerEl.addEventListener('input', onChange)
  }

  // ─── Hover Preview ────────────────────────────────────────────────────────

  function setupHoverPreview(container) {
    const preview = document.getElementById('hover-preview')
    container.querySelectorAll('.skill-item').forEach(item => {
      item.addEventListener('mouseenter', (e) => {
        const text = item.dataset.preview
        if (!text) return
        preview.textContent = text
        preview.style.display = 'block'
        positionPreview(e)
      })
      item.addEventListener('mousemove', positionPreview)
      item.addEventListener('mouseleave', () => {
        preview.style.display = 'none'
      })
    })
  }

  function positionPreview(e) {
    const preview = document.getElementById('hover-preview')
    const x = e.clientX + 16
    const y = e.clientY + 8
    preview.style.left = Math.min(x, window.innerWidth - 340) + 'px'
    preview.style.top = Math.min(y, window.innerHeight - 200) + 'px'
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('skill-import-btn').addEventListener('click', () => {
      // Reset form
      ['skill-import-name','skill-import-purpose','skill-import-provider',
       'skill-import-description','skill-import-author','skill-import-content',
       'skill-import-filepath'].forEach(id => {
        const el = document.getElementById(id)
        if (el) el.value = ''
      })
      document.getElementById('skill-import-type').value = 'skill'
      // Hide suggestion banner and reset state
      document.getElementById('skill-purpose-suggestion').style.display = 'none'
      _suggestedPurpose = null
      window.openModal('skill-import-modal')
    })

    document.getElementById('skill-import-confirm').addEventListener('click', confirmImport)
    document.getElementById('skill-edit-btn').addEventListener('click', openEdit)
    document.getElementById('skill-edit-confirm').addEventListener('click', confirmEdit)
    document.getElementById('skill-autotag-btn').addEventListener('click', triggerAutoTag)
    document.getElementById('skill-delete-btn').addEventListener('click', deleteSkill)
    document.getElementById('add-tag-confirm').addEventListener('click', confirmAddTag)

    // Purpose merge suggestion
    document.getElementById('skill-import-purpose').addEventListener('blur', onPurposeBlur)
    document.getElementById('skill-purpose-merge-btn').addEventListener('click', acceptMergeSuggestion)
    document.getElementById('skill-purpose-keep-btn').addEventListener('click', dismissMergeSuggestion)

    // Enter key on add-tag input
    document.getElementById('add-tag-value').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmAddTag()
    })

    setupSearch()

    // Listen for auto-tag completion events
    window.api.on('autoTag:progress:update', (data) => {
      if (data.targetType !== 'skill') return
      if (data.status === 'completed') {
        window.notify(`Auto-tag complete: ${data.result.pendingCount} tags pending review`, 'info')
        if (data.targetId === currentSkillId) openDetail(currentSkillId)
        loadList()
      } else if (data.status === 'failed') {
        window.notify('Auto-tag failed', 'error')
      }
    })

    loadList()
  }

  return {
    init, loadList, openDetail,
    addTagFilter,
    addTagDialog, confirmAddTag,
    reviewTag,
    rollback,
    prevPage, nextPage,
    clearTestSummariesCache: _clearTestSummariesCache,
  }
})()

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

window.SkillPage = SkillPage
window.escHtml = escHtml
window.fmtDate = fmtDate
