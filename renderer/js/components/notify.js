'use strict'
// notify.js — Notification toast component

const notifyContainer = document.getElementById('notify-container')

function notify(message, type = 'info', duration = 3500) {
  const el = document.createElement('div')
  el.className = `notify ${type}`
  el.textContent = message
  notifyContainer.appendChild(el)

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('show'))
  })

  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 300)
  }, duration)
}

window.notify = notify
