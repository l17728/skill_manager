'use strict'

const skillFixture = {
  basic: {
    importType: 'text',
    content: '你是一个专业的Python开发者，擅长生成高质量、可维护的Python代码。请遵循PEP8规范。',
    meta: {
      name: 'Python代码生成助手',
      description: '专用于生成高质量Python代码的Skill',
      author: '张三',
      source: '内部研发',
      purpose: 'code_generate',
      provider: 'provider_internal',
      type: 'skill',
    },
  },
  minimal: {
    importType: 'text',
    content: 'You are a helpful assistant.',
    meta: {
      name: 'MinimalSkill',
      purpose: 'general',
      provider: 'test_provider',
      type: 'skill',
    },
  },
  forSearch: {
    importType: 'text',
    content: 'JavaScript专用代码审查助手，负责检查代码质量和潜在Bug。',
    meta: {
      name: 'JS代码审查',
      description: '专注JavaScript代码审查',
      purpose: 'code_review',
      provider: 'provider_b',
    },
  },
}

module.exports = skillFixture
