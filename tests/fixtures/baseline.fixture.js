'use strict'

const baselineFixture = {
  manual: {
    importType: 'manual',
    meta: {
      name: 'Python代码生成标准测试集',
      description: '覆盖函数生成等标准测试用例',
      author: '李四',
      purpose: 'code_generate_test',
      provider: 'provider_internal',
    },
    cases: [
      {
        id: 'case_001',
        name: '基础斐波那契函数生成',
        category: 'standard',
        input: '用Python写一个计算斐波那契数列第n项的函数，需要处理n为0和负数的情况',
        expected_output: '函数需包含：正确的递推逻辑、对n<=0的边界处理、必要的注释',
        description: '测试基础算法实现能力',
      },
      {
        id: 'case_002',
        name: '超长输入边界测试',
        category: 'boundary',
        input: '用Python实现一个排序函数，输入列表可能包含None值',
        expected_output: '函数需能处理None值过滤',
        description: '测试边界条件',
      },
    ],
  },
  withDuplicates: {
    importType: 'manual',
    meta: {
      name: '去重测试集',
      purpose: 'dedup_test',
      provider: 'test_provider',
    },
    cases: [
      { id: 'case_001', name: '测试1', category: 'standard', input: '输入1', expected_output: '输出1' },
      { id: 'case_001', name: '测试1重复', category: 'standard', input: '输入1重复', expected_output: '输出1重复' },
      { id: 'case_002', name: '测试2', category: 'boundary', input: '输入2', expected_output: '输出2' },
    ],
  },
}

module.exports = baselineFixture
