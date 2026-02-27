'use strict'

/**
 * cli-events.js — Singleton EventEmitter for CLI status events.
 *
 * Emits:
 *   'status:change' → { available: boolean, cliVersion?: string }
 */

const { EventEmitter } = require('events')

const cliEvents = new EventEmitter()
cliEvents.setMaxListeners(20)

module.exports = cliEvents
