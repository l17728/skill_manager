'use strict'

const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './specs',
  timeout: 60000,           // 60s per test — accounts for Electron startup + IPC round-trips
  retries: 0,               // No auto-retry; failures should be investigated
  workers: 1,               // Sequential: only one Electron instance runs at a time (shared CDP port)
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/e2e/reports', open: 'never' }],
  ],
  use: {
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10000,   // Playwright action timeout (click, fill, etc.)
  },
})
