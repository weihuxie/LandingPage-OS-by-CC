/**
 * API-DS-RSN-* · DeepSeek 适配层对 reasoner 系不支持 tool_choice 的兜底。
 *
 * 不需要真实 API key——纯函数 + 错误结构测试。
 */
import { test, expect } from '@playwright/test';
import {
  isReasonerFamily,
  isToolChoiceUnsupportedError,
} from '../../src/lib/llm-deepseek';

test.describe('API-DS-RSN · DeepSeek reasoner-family fallback', () => {
  test('API-DS-RSN-001 · isReasonerFamily 命中已知 reasoner 别名', () => {
    // 全部应判定为 reasoner 系，resolveModel 时应转 deepseek-chat
    const matches = [
      'deepseek-reasoner',
      'deepseek-r1',
      'deepseek-r2',
      'DeepSeek-Reasoner', // 大小写
      'deepseek-reasoner-pro', // boundary 匹配
      ' deepseek-r1 ', // 带空格
    ];
    for (const m of matches) {
      expect(isReasonerFamily(m), m).toBe(true);
    }
  });

  test('API-DS-RSN-002 · isReasonerFamily 不误伤合法 chat 系', () => {
    const passes = [
      'deepseek-chat',
      'deepseek-coder',
      'deepseek-v3',
      'deepseek-v3-chat',
      'gpt-4o', // 不是 deepseek 但安全
    ];
    for (const m of passes) {
      expect(isReasonerFamily(m), m).toBe(false);
    }
  });

  test('API-DS-RSN-003 · isToolChoiceUnsupportedError 识别 DeepSeek 400 错误', () => {
    // 模拟 OpenAI SDK 抛出的错误结构
    const err1 = Object.assign(new Error('400 deepseek-reasoner does not support this tool_choice'), { status: 400 });
    expect(isToolChoiceUnsupportedError(err1)).toBe(true);

    // 经 wrapper 改写过的 message 也应识别
    const err2 = { status: 400, message: 'Model deepseek-r1 does not support this tool_choice' };
    expect(isToolChoiceUnsupportedError(err2)).toBe(true);

    // 嵌在 error.message 字段里也行
    const err3 = { status: 400, error: { message: 'does not support this tool_choice' } };
    expect(isToolChoiceUnsupportedError(err3)).toBe(true);
  });

  test('API-DS-RSN-004 · isToolChoiceUnsupportedError 不误伤其他 400', () => {
    const err1 = Object.assign(new Error('400 invalid prompt'), { status: 400 });
    expect(isToolChoiceUnsupportedError(err1)).toBe(false);

    const err2 = Object.assign(new Error('429 rate limited'), { status: 429 });
    expect(isToolChoiceUnsupportedError(err2)).toBe(false);

    expect(isToolChoiceUnsupportedError(null)).toBe(false);
    expect(isToolChoiceUnsupportedError('string')).toBe(false);
  });
});
