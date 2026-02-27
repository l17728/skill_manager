'use strict'

const projectFixture = {
  basic: {
    name: '对比实验-Python代码生成',
    description: '对比测试项目',
    cliConfig: {
      model: 'claude-opus-4-6',
      timeout_seconds: 60,
      retry_count: 2,
    },
    contextConfig: {
      token_threshold: 80000,
      auto_compress: true,
      auto_export: true,
    },
  },
}

module.exports = projectFixture
