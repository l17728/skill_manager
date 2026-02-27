'use strict'

/**
 * seed-samples.js
 * Imports 3 sample assets (skill + agent + baseline) into workspace.
 * Run: node scripts/seed-samples.js
 */

const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')

const skillService = require(path.join(root, 'main/services/skill-service'))
const baselineService = require(path.join(root, 'main/services/baseline-service'))
const workspaceService = require(path.join(root, 'main/services/workspace-service'))

// Ensure workspace dirs exist
workspaceService.initWorkspace()

// ─── 1. Skill: Python 代码生成专家 ─────────────────────────────────────────────
const skillContent = fs.readFileSync(
  path.join(__dirname, '..', 'samples', 'skill_python_coder.txt'),
  'utf-8'
)

try {
  const skillResult = skillService.importSkill({
    importType: 'text',
    content: skillContent,
    meta: {
      name: 'Python代码生成专家',
      purpose: 'sample',
      provider: 'sample_provider',
      description: 'Python代码生成Skill，按PEP8规范、类型注解、异常处理生成可运行代码',
      author: 'sample',
    },
  })
  console.log(`✅ Skill imported: ${skillResult.skillId} (${skillResult.version})`)
} catch (e) {
  console.error('❌ Skill import failed:', e)
}

// ─── 2. Agent: 代码审查专家 ────────────────────────────────────────────────────
const agentContent = fs.readFileSync(
  path.join(__dirname, '..', 'samples', 'agent_code_reviewer.txt'),
  'utf-8'
)

try {
  const agentResult = skillService.importSkill({
    importType: 'text',
    content: agentContent,
    meta: {
      name: '代码审查Agent',
      purpose: 'sample',
      provider: 'sample_provider',
      description: '六维度代码审查Agent，输出结构化JSON评分报告（满分100）',
      author: 'sample',
    },
  })
  console.log(`✅ Agent imported: ${agentResult.skillId} (${agentResult.version})`)
} catch (e) {
  console.error('❌ Agent import failed:', e)
}

// ─── 3. Baseline: Python基础测试集 ─────────────────────────────────────────────
const baselineData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'samples', 'baseline_python_basics.json'),
    'utf-8'
  )
)

;(async () => {
  try {
    const baselineResult = await baselineService.importBaseline({
      importType: 'manual',
      cases: baselineData.cases,   // parameter is "cases", not "manualCases"
      meta: {
        name: 'Python基础测试集',
        purpose: 'sample',
        provider: 'sample_provider',
        description: '7个Python基础编程测试用例：标准3个 / 边界2个 / 异常2个',
        author: 'sample',
      },
    })
    console.log(`✅ Baseline imported: ${baselineResult.baselineId} (${baselineResult.version}), cases: ${baselineResult.caseCount}`)
  } catch (e) {
    console.error('❌ Baseline import failed:', e)
  }

  console.log('\nDone. Workspace:')
  console.log('  Skills:', workspaceService.paths.skills('sample', 'sample_provider'))
  console.log('  Baselines:', workspaceService.paths.baselines('sample', 'sample_provider'))
})()
