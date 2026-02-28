'use strict'
window.addEventListener('DOMContentLoaded', async () => {
  const loading = document.getElementById('manual-loading')
  const error   = document.getElementById('manual-error')
  const content = document.getElementById('manual-content')
  try {
    const res = await window.api.manual.getContent()
    loading.style.display = 'none'
    if (res && res.success) {
      content.innerHTML = res.data
      content.style.display = 'block'
    } else {
      error.textContent = '手册加载失败：' + (res ? res.error : '未知错误')
      error.style.display = 'block'
    }
  } catch (e) {
    loading.style.display = 'none'
    error.textContent = '手册加载失败：' + e.message
    error.style.display = 'block'
  }
})
