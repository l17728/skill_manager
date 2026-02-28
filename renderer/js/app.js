'use strict'
/**
 * app.js — Global initialization, navigation routing, CLI status check
 */

// ─── Navigation ────────────────────────────────────────────────────────────

function activatePage(pageName) {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.page === pageName)
  })
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === `page-${pageName}`)
  })
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => activatePage(tab.dataset.page))
})

// ─── CLI Status ────────────────────────────────────────────────────────────

async function checkCli() {
  const dot = document.getElementById('cli-dot')
  const label = document.getElementById('cli-version-label')
  try {
    const res = await window.api.cli.checkAvailable()
    if (res.success && res.data.available) {
      dot.className = 'status-dot online'
      label.textContent = `CLI v${res.data.cliVersion || '?'}`
    } else {
      dot.className = 'status-dot offline'
      label.textContent = 'CLI: unavailable'
    }
  } catch (_) {
    dot.className = 'status-dot offline'
    label.textContent = 'CLI: error'
  }
}

// ─── App Init ──────────────────────────────────────────────────────────────

async function init() {
  // Initialize workspace
  try {
    await window.api.workspace.init()
  } catch (e) {
    console.error('Workspace init failed:', e)
  }

  // Check CLI availability
  checkCli()
  // Recheck every 60s
  setInterval(checkCli, 60000)

  // Init pages
  SkillPage.init()
  BaselinePage.init()
  ProjectPage.init()
  RankingsPage.init()

  // Help / manual button
  document.getElementById('help-btn').addEventListener('click', () => {
    window.api.manual.open()
  })

  // Listen for CLI status changes
  window.api.on('cli:status:change', (data) => {
    const dot = document.getElementById('cli-dot')
    const label = document.getElementById('cli-version-label')
    dot.className = `status-dot ${data.available ? 'online' : 'offline'}`
    label.textContent = data.available ? `CLI v${data.cliVersion || '?'}` : 'CLI: unavailable'
  })
}

document.addEventListener('DOMContentLoaded', init)
