'use strict'
// modal.js — Generic modal management

function openModal(id) {
  document.getElementById(id).classList.add('open')
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open')
}

// Close on overlay click or .modal-close button
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open')
  }
  if (e.target.classList.contains('modal-close')) {
    e.target.closest('.modal-overlay').classList.remove('open')
  }
})

// Import-tab switching (used in both skill and baseline import modals)
document.querySelectorAll('.import-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const modal = tab.closest('.modal')
    const tabKey = tab.dataset.tab
    modal.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    modal.querySelectorAll('.tab-content').forEach(tc => {
      tc.classList.toggle('active', tc.id === `tab-${tabKey}`)
    })
  })
})

window.openModal = openModal
window.closeModal = closeModal
