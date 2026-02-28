# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Prompt/Skill Comparison, Verification & Optimization Platform** — an Electron desktop app for managing, testing, comparing, and optimizing Claude Skills/Agents. All 11 modules across 5 implementation phases are fully implemented with **314 unit tests + 37 e2e tests passing**.

### Specification Documents (read before modifying any module)

| Document | Purpose | When to read |
|----------|---------|--------------|
| `spec.md` | 51 TDD test cases across 10 modules, 6-dimension 100-point scoring rubric, all UC acceptance criteria | Before adding/changing any feature |
| `schema.md` | Every JSON file schema under `workspace/` (meta.json, tags.json, cases.json, config.json, etc.) | Before any file I/O code |
| `ipc-api.md` | All IPC channel contracts: channel names, request/response shapes, push event payloads | Before any IPC handler or renderer API call |
| `cli-spec.md` | Claude CLI invocation format, all prompt templates, session strategy, auto-tag / baseline-gen prompts | Before any `cli-service` or `cli-lite-service` change |
| `提示词 & Skill 对比验证与优势重组平台 - UI设计描述.md` | Full UI layout spec, page descriptions, component behavior | Before any renderer change |
| `用户案例（User Case）交互图及模块_TODO匹配校验.md` | User flow diagrams and module-level TODO/done tracking | For feature status reference |

## Commands

```bash
npm run dev      # Launch Electron app (development mode, --dev flag)
npm start        # Launch Electron app (production mode)
npm test         # Run all 314 Jest unit tests
npm run test:e2e # Run Playwright e2e tests (launches real Electron; port 9222 must be free)
npm run test:watch    # Jest in watch mode
npm run test:coverage # Jest with coverage report
npm run build    # Package to Windows .exe via electron-builder

# Run a single test file
npx jest tests/unit/skill-service.test.js

# Run tests matching a description
npx jest --testNamePattern="UC1-1"

# Validate Claude CLI spawn fixes (run inside Claude Code session to simulate CLAUDECODE env)
node scripts/validate-cli.js

# Full integration test: checkAvailable + invokeCli + autoTagSkill (makes real API calls)
node scripts/integration-test-cli.js

# Seed sample Skills and Baselines into workspace for manual testing
node scripts/seed-samples.js
```

## Mandatory Review Checklist (every code change)

After **any** modification or addition to service, IPC, or renderer code, verify all three areas before considering the work done:

### 1. Logging complete?
- Every **mutating** service function (create / update / delete / import / rollback / compress / export) must call `logService.info(...)` on success and `logService.warn/error(...)` on failure or edge-case.
- **Read-only** functions (list / get / search / estimate) do not need log calls.
- The log call must include the entity ID and the key changed fields so the JSONL audit trail is useful.

### 2. Tests complete?
- **New public service function** → add at least one unit test case in the corresponding `tests/unit/<service>.test.js`.
- **New or changed IPC handler behavior** (watcher, dedup, push-event timing, error path) → add/update tests in the relevant IPC test file (e.g. `context-ipc.test.js`). Pure service behavior belongs in service test files; IPC-layer behavior (interval, dedup Set, push-event payload) belongs in IPC test files.
- **Changed return shape or error code** → update the test that asserts on it.
- After adding tests run `npm test` and confirm the count increases; update the count in this file (Overview line + Commands line).

### 3. Docs updated?
| What changed | What to update |
|---|---|
| New IPC channel added | Add section to `ipc-api.md`; add method to §十五 preload summary |
| IPC channel removed | Remove from `ipc-api.md` and §十五 |
| IPC return shape changed | Update `ipc-api.md` + `CLAUDE.md §IPC Special Cases` if referenced there |
| New push event | Add to `ipc-api.md §十四` push-event list |
| New test file | Add one-line entry to `CLAUDE.md` tests directory listing |
| Test count changes | Update **both** the Overview line and the `npm test` comment in Commands |
| New service function | No doc required unless it surfaces a new IPC channel |

## Architecture

**Tech stack**: Electron (main = Node.js, renderer = vanilla HTML/CSS/JS). All Claude model interactions go through the **Claude Code CLI** (`claude` subprocess) — no direct API calls. Storage is file-based only under `workspace/`.

### Three-Layer Code Structure

```
main/
  index.js              # Electron entry, BrowserWindow, IPC registration, SIGTERM/SIGINT handlers
  preload.js            # contextBridge — exposes window.api to renderer
  ipc/                  # One file per module; registers ipcMain.handle() via wrapHandler()
    helpers.js          # wrapHandler(fn) — wraps all handlers into { success, data } | { success:false, error }
    index.js            # Registers all IPC modules
    skill.js / baseline.js / project.js / cli.js / context.js
    test.js / analysis.js / recompose.js / iteration.js / trace.js / workspace.js
  services/             # All business logic; pure Node.js, no Electron deps
    workspace-service.js   # All path resolution (workspaceService.paths.*). NEVER hardcode workspace paths.
    file-service.js        # All fs ops: readJson, writeJson, ensureDir, listDirs, copyDir
    log-service.js         # JSONL session logging to workspace/logs/
    version-service.js     # Version increment (v1→v2), diff writing, history reading
    tag-service.js         # Shared tag logic for skill + baseline
    skill-service.js       # Skill CRUD, version, tag, search, auto-tag trigger
    baseline-service.js    # Baseline CRUD, case management, version, auto-tag trigger
    project-service.js     # Project create, copy assets, config, export
    cli-service.js         # Full CLI engine: invokeCli, invokeCliResume, invokeWithRetry, checkAvailable
    cli-lite-service.js    # Lightweight CLI wrapper for auto-tagging (calls cli-service internally)
    cli-events.js          # EventEmitter for CLI status:change events
    session-service.js     # Claude session lifecycle management
    context-service.js     # Context window management, token counting
    test-service.js        # Comparative test run orchestration (parallel per-skill)
    analysis-service.js    # Difference analysis, advantage segment extraction
    recompose-service.js   # Skill recomposition from advantage segments
    iteration-service.js   # Iteration loop: recompose → test → analyze
    trace-service.js       # Environment traceability (snapshot, compare)
renderer/
  index.html            # 3-page layout (Skills / Baselines / Projects), CSP meta tag
  css/main.css          # Dark theme, CSS variables
  js/
    app.js              # Navigation routing, CLI status polling, DOMContentLoaded init
    pages/
      skill.js          # Skill management page IIFE → window.SkillPage
      baseline.js       # Baseline management page IIFE → window.BaselinePage
      project.js        # Project management page IIFE → window.ProjectPage
      rankings.js       # Rankings & Leaderboard page IIFE → window.RankingsPage
    components/
      modal.js          # openModal(id) / closeModal(id)
      notify.js         # window.notify(message, type) toast notifications
tests/
  unit/                 # One test file per service; TDD with Jest
    renderer-csp.test.js   # Verifies no inline onclick= handlers exist in renderer pages
    log-service.test.js    # Session lifecycle, idempotency, SIGTERM scenario, workspace isolation
    context-ipc.test.js    # context:warning watcher: dedup, tier upgrade, post-compress notify, clearInterval
    skill-service.test.js  baseline-service.test.js  project-service.test.js
    cli-service.test.js    context-service.test.js   test-service.test.js
    analysis-service.test.js  recompose-service.test.js  iteration-service.test.js
    trace-service.test.js  purpose-suggestion.test.js
  helpers/
    fs-helper.js        # createTmpDir(), overrideWorkspace() — used by every unit test suite
  e2e/                  # Playwright end-to-end tests (real Electron via CDP)
    playwright.config.js          # workers:1, timeout:60s, sequential
    helpers/
      app-launcher.js             # spawn Electron + --remote-debugging-port=9222, bind-based port-free check, wait for CDP
      workspace-factory.js        # createTestWorkspace({ skills, baselines, projects }), _seedSkill(), _seedBaseline(), _seedProject()
    pages/
      app-page.js                 # navigation, notify assertions, CLI status
      skill-page.js               # full SkillPage POM (import, select, edit, tag, search, rollback, delete)
      baseline-page.js            # BaselinePage POM (importBaseline, selectBaseline, rollbackVersion, …)
      project-page.js             # ProjectPage POM (createProject, clickDelete, switchTab, …)
      rankings-page.js            # RankingsPage POM (navigate, search, filter, view toggle, assertions)
    specs/
      skill-management.spec.js    # TC-001~TC-008,TC-010 active, TC-009 skipped (needs live CLI)
      baseline-management.spec.js # TC-B-001~TC-B-006 active, TC-B-007 skipped (needs live CLI)
      project-management.spec.js       # TC-P-001~TC-P-004,TC-P-006~TC-P-010 active, TC-P-005 skipped (needs live CLI)
      project-detail-completed.spec.js # TC-PC-001~TC-PC-003: pre-seeded completed project, no CLI
      rankings.spec.js                 # TC-R-001~TC-R-010: Rankings & Leaderboard (no CLI needed)
    action-reference/
      action-reference.json       # function-call-style UI API doc for Claude agent test generation
    nl-test-scripts/
      skill-management.md         # natural-language test descriptions (source for spec generation)
scripts/
  validate-cli.js       # Validates 4 CLI spawn fixes; must run inside Claude Code session
  integration-test-cli.js  # End-to-end: checkAvailable + invokeCli + autoTagSkill (real API calls)
  seed-samples.js       # Seeds workspace with sample Skills/Baselines for manual testing
```

### IPC Pattern

Every IPC call follows `{ success, data } | { success: false, error: { code, message } }` via `wrapHandler()` in `main/ipc/helpers.js`. Renderer calls `window.api.<module>.<method>(args)` and checks `res.success`.

Push events from main → renderer: `mainWindow.webContents.send(channel, data)`. Renderer subscribes via `window.api.on(channel, cb)` which returns an unsubscribe function. Always unsubscribe on page/project switch to prevent memory leaks.

### Service Layer Conventions

- Services have **no Electron imports** — testable in pure Node.js.
- `workspace-service.js` owns all path resolution (`workspaceService.paths.*`). Never hardcode workspace paths.
- `file-service.js` wraps all fs operations (`readJson`, `writeJson`, `ensureDir`, `listDirs`, `copyDir`).
- `version-service.js` handles version increment (`v1→v2`), diff writing, history reading.
- `log-service.js` appends JSONL to `workspace/logs/`. Call `startSession()` at startup, `endSession()` at shutdown.
- Async background operations (CLI calls, batch jobs) use `setImmediate` / detached Promises. The IPC handler returns `{ taskId }` immediately, then sends a push event on completion.

### Workspace Layout

```
workspace/
  skills/[purpose]/[provider]/skill_<id>_v<N>/
    content.txt   meta.json   tags.json   history/   auto_tag_log/
  baselines/[purpose]/[provider]/baseline_<id>_v<N>/
    cases.json    meta.json   tags.json   history/
  projects/project_<id>_<timestamp>/
    config.json           # Skills, baselines, cli_config, status, progress
    skills/               # Copied skill dirs (immutable during test run)
    baselines/            # Copied baseline dirs
    .claude/              # Project-isolated CLI session
    results/              # Per-skill-version result JSONs + summary.json
    analysis_report.json
    iterations/           # round_N/config.json + iteration_report.json + exploration_log.json
    logs/
  cli/
    config.json           # Global CLI config (model, timeout, token thresholds)
    temp_session/         # Auto-tag CLI sessions (isolated from project sessions)
    sessions.json         # Session registry
    cache/                # CLI response cache
  logs/                   # System-wide JSONL logs (one file per session)
  versions/               # Global version diffs (legacy path)
```

### Renderer Page Architecture

Each page (`skill.js`, `baseline.js`, `project.js`, `rankings.js`) is an IIFE that returns a public API (`{ init, ... }`) assigned to `window.<PageName>`. `app.js` calls `SkillPage.init()`, `BaselinePage.init()`, `ProjectPage.init()`, `RankingsPage.init()` on `DOMContentLoaded`.

**Layout**: `renderer/index.html` has a top bar + single `#content` area (no sidebar). The `#sidebar` element and all `.sidebar-*` CSS were removed — the top bar tabs (Skills / Baselines / Projects) are sufficient navigation for a 3-page app, and removing the 200px sidebar gives more horizontal space to the 3-column content layout.

**Project page** has 5 tabs (Overview / Test / Analysis / Recompose / Iteration) switched by `switchTab(name)`. Each tab loads lazily. IPC push event subscriptions are created on `openDetail()` and cleaned up on project switch via `_unsubAll()`.

**CSP rule**: `renderer/index.html` sets `script-src 'self'` — this blocks ALL inline `onclick="..."` attribute handlers. Always use `data-*` attributes + `addEventListener` for dynamically-generated HTML buttons. Never use `element.innerHTML = '...<button onclick="fn()">...'`.

**escHtml rule**: Every piece of external data (from CLI output, service results, user-supplied strings) interpolated into `innerHTML` template literals **must** be wrapped with `window.escHtml()`. Failure to do so allows XSS payloads like `<img onerror="...">` to inject inline event handlers, which the CSP then blocks and logs as a violation. Verified by `tests/unit/renderer-csp.test.js`.

**Sandbox rule**: `main/index.js` `webPreferences` must set `sandbox: true` (Electron 28+). With `sandbox: false` (deprecated), Electron internal code runs in the renderer context and can also trigger CSP violations. `preload.js` only uses `require('electron')` so it remains fully compatible with `sandbox: true`.

### Module Map

| Module | Service | IPC file | Test file |
|--------|---------|----------|-----------|
| 1 Skill management | `skill-service.js` | `ipc/skill.js` | `skill-service.test.js` |
| 2 Baseline management | `baseline-service.js` | `ipc/baseline.js` | `baseline-service.test.js` |
| 3 Project management | `project-service.js` | `ipc/project.js` | `project-service.test.js` |
| 4 CLI engine | `cli-service.js`, `cli-lite-service.js`, `session-service.js`, `cli-events.js` | `ipc/cli.js` | `cli-service.test.js` |
| 5 Context management | `context-service.js` | `ipc/context.js` | `context-service.test.js` |
| 6 Comparative testing | `test-service.js` | `ipc/test.js` | `test-service.test.js` |
| 7 Difference analysis | `analysis-service.js` | `ipc/analysis.js` | `analysis-service.test.js` |
| 8 Skill recomposition | `recompose-service.js` | `ipc/recompose.js` | `recompose-service.test.js` |
| 9 Iteration loop | `iteration-service.js` | `ipc/iteration.js` | `iteration-service.test.js` |
| 10 Env traceability | `trace-service.js` | `ipc/trace.js` | `trace-service.test.js` |
| 11 Rankings & Leaderboard | `leaderboard-service.js` | `ipc/leaderboard.js` | `leaderboard-service.test.js` |

### Test Isolation Pattern

Every test suite uses `createTmpDir()` + `overrideWorkspace()` in `beforeAll` so tests never touch the real `workspace/`. Services are re-required **after** `jest.resetModules()` and workspace override so they pick up the temp path. Mocks for async services (CLI calls) use `jest.spyOn` + `setImmediate(() => callback(...))` to simulate async completion without real I/O.

```js
// Standard pattern — every test suite
let tmpDir, cleanup, restoreWorkspace
beforeAll(() => {
  const tmp = createTmpDir()
  tmpDir = tmp.tmpDir; cleanup = tmp.cleanup
  jest.resetModules()
  workspaceService = require('../../main/services/workspace-service')
  restoreWorkspace = overrideWorkspace(workspaceService, tmpDir)
  myService = require('../../main/services/my-service')  // require AFTER override
})
afterAll(() => { restoreWorkspace(); cleanup() })
```

## Key Implementation Details

### CLI Engine (`cli-service.js`)

Four critical production fixes — do not revert:

1. **CLAUDECODE env stripping**: `delete spawnEnv.CLAUDECODE` before every `spawn()`. Claude Code sets this env var; child `claude` processes that inherit it refuse to start with "Cannot be launched inside another Claude Code session".
2. **Windows ENOENT**: `const SPAWN_SHELL = process.platform === 'win32'` + `shell: SPAWN_SHELL`. On Windows, npm-global CLIs are `.cmd` files; `spawn` without a shell cannot resolve them.
3. **`--dangerously-skip-permissions`**: Required for non-TTY Electron spawn — there is no terminal to respond to permission prompts.
4. **Timeout**: `autoTagSkill`/`autoTagBaseline` use `timeoutMs: 60000`. Real API calls take 15–25 seconds; the original 10 s caused consistent failures.

`cli-lite-service.js` wraps `cli-service.js` for auto-tagging only. All real CLI calls go through `cli-service.invokeCli()`.

### Log Service (`log-service.js` + `main/index.js`)

- `endSession()` is **idempotent**: returns immediately if `_sessionFile` is null. This prevents double-write when SIGTERM handler and `will-quit` both call it.
- `main/index.js` registers `process.on('SIGTERM')` and `process.on('SIGINT')` to call `logService.endSession()` before `app.quit()`.
- Log files are JSONL, one file per session, named `YYYY-MM-DD_HH-MM-SS.jsonl`.

### Version System

- Editing `content` or any `meta` field triggers version increment (`v1 → v2`).
- Rollback **creates a new version** (never overwrites history). Skill rollback reconstructs content from diff chain; baseline rollback writes a rollback marker entry.
- All diffs stored in `history/` under the skill/baseline directory.

### Tag System

Tags have two origins: `manual` (user-added) and `auto` (CLI-generated). Auto-tags have a status lifecycle: `pending → approved | rejected`. Only `approved` auto-tags appear in the effective tag set. The `pendingTagCount` field in list responses drives the "N pending" badge in the UI.

### Auto-Tag Sessions

Auto-tag CLI calls use `workspace/cli/temp_session/` — isolated from project `.claude/` sessions. Failures are logged to `auto_tag_log/` under the skill/baseline directory and marked `failed`, but never propagate to project test sessions.

### Iteration Loop (`iteration-service.js`)

Implements the **AEIO (Adaptive Exploration Iteration Engine)**. Runs recompose → test → analyze in a loop via `_doOneRound()`. Supports:

- **`stopThreshold`**: early exit when `avg_score ≥ threshold`
- **Beam Search** (`beamWidth > 1`): between each pair of rounds, generates `beamWidth` candidate Skills with different strategies, tests each independently, and selects the best-scoring one for the next round
- **Strategy Profiles**: `GREEDY` | `DIMENSION_FOCUS` | `SEGMENT_EXPLORE` | `CROSS_POLLINATE` | `RANDOM_SUBSET` — selected by `_selectStrategies(round, plateauLevel, beamWidth)`
- **Plateau Detection**: `_detectPlateauLevel(rounds, threshold, consecutiveLimit)` returns 0–3 level driving strategy escalation
- **`original_skill_ids`**: stored in `config.json` at project creation; `buildAnalysisPrompt` uses them to tag skills as `【原始参照】` vs `【迭代候选】`, preserving reference quality tracking across rounds
- **Meta-prompt Score History**: `recompose-service.buildMetaPromptTail()` injects full score history, strategy direction, and stagnant dimensions into each recompose prompt
- **`exploration_log.json`**: full beam candidate history per inter-round period, readable via `iteration:getExplorationLog`

Uses **lazy-requires** of `testService`/`analysisService`/`recomposeService` to break circular dependency chains.

**Test count formula**: `maxRounds + (maxRounds - 1) * beamWidth` calls to `testService.startTest` per full iteration run.

UI exposes three modes: **Standard** (beamWidth=1), **Explore** (beamWidth=2, normal plateau), **Adaptive** (beamWidth=2, aggressive plateau escape).

### Scoring Rubric

6-dimension 100-point scale evaluated via CLI: Functional Correctness (30), Robustness (20), Readability (15), Conciseness (15), Complexity Control (10), Format Compliance (10).

### IPC Special Cases

- **`recompose:save`** expects `{ projectId, content, meta: { name, purpose, provider } }` — not flat fields.
- **`skill:autotag:trigger`** and **`baseline:autotag:trigger`** return `{ taskId }` immediately; completion arrives via push event `autoTag:progress:update`.
- **`test:start`** returns `{ started: true }`; progress via `test:progress:update` (includes `projectStatus` field); when `projectStatus === 'completed'` the test run is done — there is no separate `test:completed` event. Skills run in parallel; cases within each skill are sequential. Each skill gets an isolated workingDir under `.claude/skill_<8chars>/`.

### Renderer Event Handler Pattern (CSP)

`script-src 'self'` blocks inline `onclick=`. Always bind dynamically-rendered buttons **after** setting `innerHTML`:

```js
// WRONG — blocked by CSP:
container.innerHTML = `<button onclick="doSomething('${id}')">Click</button>`

// CORRECT — use data-* + addEventListener:
container.innerHTML = `<button data-action="approve" data-id="${id}">Click</button>`
container.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id))
})
```

## E2E Testing (Playwright + Electron CDP)

### How it works

`npm run test:e2e` launches a real Electron process with `--remote-debugging-port=9222` and `--workspace=<tmpdir>`. Playwright connects via `chromium.connectOverCDP()`. A fresh isolated workspace is seeded with schema-correct JSON files by `workspace-factory.js` — no production `workspace/` data is touched.

`workspace-service.js` exposes `setWorkspace(p)` (runtime override) so `main/index.js` can redirect all paths to the test dir when `--workspace=<path>` is present in argv.

### Windows TIME_WAIT port-free check

On Windows, after an Electron process exits, the CDP port remains in **TIME_WAIT** state for a few seconds. During this state:
- `connect()` → immediate `ECONNREFUSED` (looks free to connection-based checks)
- `bind()` → `WSAEADDRINUSE` (Electron still cannot start its CDP server)

`app-launcher.js` calls `_waitForPortFree()` at the **start of `launchApp()`** (before spawning Electron) using a **bind-based check**: it creates a temporary `net.createServer().listen(port)` and only proceeds when that bind succeeds. This is the only reliable way to confirm the port is actually available for a new `bind()` call.

### Adding new e2e tests

1. Write a natural-language script in `tests/e2e/nl-test-scripts/` (see `skill-management.md` as template).
2. Generate a `.spec.js` using Claude with `tests/e2e/action-reference/action-reference.json` as the UI API reference.
3. Human-review the generated spec, then commit to `tests/e2e/specs/`.

### Critical seeding convention

`skill-service.js` names skill dirs as `skill_${id.slice(0, 8)}_v<N>` and searches by that prefix. `_seedSkill()` in `workspace-factory.js` **must** follow the same convention — seeding with the full UUID breaks `findSkillDir()` and causes `getSkill → NOT_FOUND`.

Same applies to `_seedBaseline()` — dir name must be `baseline_${id.slice(0, 8)}_v<N>`.

`_seedBaseline` accepts an optional `seedVersion` (`'v1'` default, or `'v2'`). When `seedVersion:'v2'`, the directory is named `baseline_xxx_v2`, `meta.version` is `'v2'`, and history entries are written for v1→v2. This lets rollback tests run without `window.prompt()` (which Electron does not support).

### afterAll pattern for CDP tests

```js
test.afterAll(async () => {
  try { await browser.disconnect() } catch (_) {}  // drop CDP connection; do NOT use browser.close()
  if (app) await app.close()                        // app.close() owns SIGTERM
  workspace.cleanup()
})
```

`browser.close()` on a CDP connection sends `Browser.close` to Electron and races with `app.close()`. Use `browser.disconnect()` instead and let `app.close()` terminate the process cleanly.

### Strict mode for notifications

`expectSuccessNotification()` / `expectErrorNotification()` in `app-page.js` use `.first()`. Multiple toasts can coexist in `#notify-container` (e.g. an earlier test's toast still fading out); without `.first()` Playwright throws a strict-mode violation.
