'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// All IPC channel names allowed for invoke
const INVOKE_CHANNELS = [
  'skill:import', 'skill:list', 'skill:get', 'skill:update', 'skill:delete', 'skill:search',
  'skill:tag:add', 'skill:tag:remove', 'skill:tag:update',
  'skill:autoTag:trigger', 'skill:autoTag:triggerBatch', 'skill:autoTag:review',
  'skill:version:list', 'skill:version:diff', 'skill:version:rollback',
  'skill:purpose:suggest',

  'baseline:import', 'baseline:list', 'baseline:get',
  'baseline:case:add', 'baseline:case:update', 'baseline:case:delete',
  'baseline:autoTag:trigger', 'baseline:autoTag:triggerBatch', 'baseline:autoTag:review',
  'baseline:version:list', 'baseline:version:diff', 'baseline:version:rollback',

  'project:create', 'project:list', 'project:get', 'project:export', 'project:delete', 'project:clone',

  'cli:checkAvailable', 'cli:getConfig', 'cli:updateConfig',
  'cli:session:list', 'cli:session:close', 'cli:session:export',

  'context:getStatus', 'context:compress', 'context:updateConfig',

  'test:start', 'test:pause', 'test:resume', 'test:stop',
  'test:getProgress', 'test:getResults', 'test:retryCase', 'test:exportResults',

  'analysis:run', 'analysis:getReport', 'analysis:exportReport',

  'recompose:execute', 'recompose:save',

  'iteration:start', 'iteration:pause', 'iteration:stop',
  'iteration:getProgress', 'iteration:getReport', 'iteration:getExplorationLog',

  'trace:getProjectEnv', 'trace:compareEnvs',

  'leaderboard:query', 'leaderboard:getTestSummaries', 'leaderboard:export',

  'workspace:init', 'workspace:saveTemplate', 'workspace:backup', 'search:global', 'log:query',

  'manual:open', 'manual:getContent',
]

// All event channels allowed for on()
const EVENT_CHANNELS = [
  'autoTag:progress:update',
  'test:progress:update',
  'analysis:completed',
  'recompose:completed',
  'iteration:round:completed',
  'context:warning',
  'cli:status:change',
]

contextBridge.exposeInMainWorld('api', {
  // Skill module
  skill: {
    import:  (args) => ipcRenderer.invoke('skill:import', args),
    list:    (args) => ipcRenderer.invoke('skill:list', args),
    get:     (args) => ipcRenderer.invoke('skill:get', args),
    update:  (args) => ipcRenderer.invoke('skill:update', args),
    delete:  (args) => ipcRenderer.invoke('skill:delete', args),
    search:  (args) => ipcRenderer.invoke('skill:search', args),
    tag: {
      add:    (args) => ipcRenderer.invoke('skill:tag:add', args),
      remove: (args) => ipcRenderer.invoke('skill:tag:remove', args),
      update: (args) => ipcRenderer.invoke('skill:tag:update', args),
    },
    autoTag: {
      trigger:      (args) => ipcRenderer.invoke('skill:autoTag:trigger', args),
      triggerBatch: (args) => ipcRenderer.invoke('skill:autoTag:triggerBatch', args),
      review:       (args) => ipcRenderer.invoke('skill:autoTag:review', args),
    },
    version: {
      list:     (args) => ipcRenderer.invoke('skill:version:list', args),
      diff:     (args) => ipcRenderer.invoke('skill:version:diff', args),
      rollback: (args) => ipcRenderer.invoke('skill:version:rollback', args),
    },
    purposeSuggest: (args) => ipcRenderer.invoke('skill:purpose:suggest', args),
  },

  // Baseline module
  baseline: {
    import:  (args) => ipcRenderer.invoke('baseline:import', args),
    list:    (args) => ipcRenderer.invoke('baseline:list', args),
    get:     (args) => ipcRenderer.invoke('baseline:get', args),
    case: {
      add:    (args) => ipcRenderer.invoke('baseline:case:add', args),
      update: (args) => ipcRenderer.invoke('baseline:case:update', args),
      delete: (args) => ipcRenderer.invoke('baseline:case:delete', args),
    },
    autoTag: {
      trigger:      (args) => ipcRenderer.invoke('baseline:autoTag:trigger', args),
      triggerBatch: (args) => ipcRenderer.invoke('baseline:autoTag:triggerBatch', args),
      review:       (args) => ipcRenderer.invoke('baseline:autoTag:review', args),
    },
    version: {
      list:     (args) => ipcRenderer.invoke('baseline:version:list', args),
      diff:     (args) => ipcRenderer.invoke('baseline:version:diff', args),
      rollback: (args) => ipcRenderer.invoke('baseline:version:rollback', args),
    },
  },

  // Project module
  project: {
    create: (args) => ipcRenderer.invoke('project:create', args),
    list:   (args) => ipcRenderer.invoke('project:list', args),
    get:    (args) => ipcRenderer.invoke('project:get', args),
    export: (args) => ipcRenderer.invoke('project:export', args),
    delete: (args) => ipcRenderer.invoke('project:delete', args),
    clone:  (args) => ipcRenderer.invoke('project:clone', args),
  },

  // CLI module
  cli: {
    checkAvailable: (args) => ipcRenderer.invoke('cli:checkAvailable', args),
    getConfig:      (args) => ipcRenderer.invoke('cli:getConfig', args),
    updateConfig:   (args) => ipcRenderer.invoke('cli:updateConfig', args),
    session: {
      list:   (args) => ipcRenderer.invoke('cli:session:list', args),
      close:  (args) => ipcRenderer.invoke('cli:session:close', args),
      export: (args) => ipcRenderer.invoke('cli:session:export', args),
    },
  },

  // Workspace / global
  workspace: {
    init:         () => ipcRenderer.invoke('workspace:init'),
    saveTemplate: () => ipcRenderer.invoke('workspace:saveTemplate'),
    backup:       (args) => ipcRenderer.invoke('workspace:backup', args),
  },
  search: {
    global: (args) => ipcRenderer.invoke('search:global', args),
  },
  log: {
    query: (args) => ipcRenderer.invoke('log:query', args),
  },

  // Context module (Module 5)
  context: {
    getStatus:    (args) => ipcRenderer.invoke('context:getStatus', args),
    compress:     (args) => ipcRenderer.invoke('context:compress', args),
    updateConfig: (args) => ipcRenderer.invoke('context:updateConfig', args),
  },

  // Test module (Module 6)
  test: {
    start:         (args) => ipcRenderer.invoke('test:start', args),
    pause:         (args) => ipcRenderer.invoke('test:pause', args),
    resume:        (args) => ipcRenderer.invoke('test:resume', args),
    stop:          (args) => ipcRenderer.invoke('test:stop', args),
    getProgress:   (args) => ipcRenderer.invoke('test:getProgress', args),
    getResults:    (args) => ipcRenderer.invoke('test:getResults', args),
    retryCase:     (args) => ipcRenderer.invoke('test:retryCase', args),
    exportResults: (args) => ipcRenderer.invoke('test:exportResults', args),
  },

  // Analysis module (Module 7)
  analysis: {
    run:          (args) => ipcRenderer.invoke('analysis:run', args),
    getReport:    (args) => ipcRenderer.invoke('analysis:getReport', args),
    exportReport: (args) => ipcRenderer.invoke('analysis:exportReport', args),
  },

  // Recompose module (Module 8)
  recompose: {
    execute: (args) => ipcRenderer.invoke('recompose:execute', args),
    save:    (args) => ipcRenderer.invoke('recompose:save', args),
  },

  // Iteration module (Module 9)
  iteration: {
    start:              (args) => ipcRenderer.invoke('iteration:start', args),
    pause:              (args) => ipcRenderer.invoke('iteration:pause', args),
    stop:               (args) => ipcRenderer.invoke('iteration:stop', args),
    getProgress:        (args) => ipcRenderer.invoke('iteration:getProgress', args),
    getReport:          (args) => ipcRenderer.invoke('iteration:getReport', args),
    getExplorationLog:  (args) => ipcRenderer.invoke('iteration:getExplorationLog', args),
  },

  // Trace module (Module 10)
  trace: {
    getProjectEnv: (args) => ipcRenderer.invoke('trace:getProjectEnv', args),
    compareEnvs:   (args) => ipcRenderer.invoke('trace:compareEnvs', args),
  },

  // Manual viewer
  manual: {
    open:       () => ipcRenderer.invoke('manual:open'),
    getContent: () => ipcRenderer.invoke('manual:getContent'),
  },

  // Leaderboard module (Module 11)
  leaderboard: {
    query:            (args) => ipcRenderer.invoke('leaderboard:query', args),
    getTestSummaries: ()     => ipcRenderer.invoke('leaderboard:getTestSummaries'),
    export:           (args) => ipcRenderer.invoke('leaderboard:export', args),
  },

  /**
   * Subscribe to a push event from main process.
   * Returns an unsubscribe function.
   */
  on: (channel, callback) => {
    if (!EVENT_CHANNELS.includes(channel)) {
      console.warn(`Unknown event channel: ${channel}`)
      return () => {}
    }
    const listener = (_event, data) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
