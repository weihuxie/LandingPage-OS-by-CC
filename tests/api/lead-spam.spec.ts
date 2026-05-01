/**
 * API-LEAD-SPAM-* · 留资表单 honeypot 检测纯函数测试
 *
 * 覆盖：
 *  - 空 / 空白 / undefined / 错类型 → 不触发（真用户路径）
 *  - 任何非空字符串 → 触发（bot 自动填表路径）
 *
 * 不依赖 KV / API key / DOM。
 */
import { test, expect } from '@playwright/test';
import { isHoneypotTriggered } from '../../src/lib/lead-spam';

test.describe('API-LEAD-SPAM · honeypot detection', () => {
  test('API-LEAD-SPAM-001 · 真用户不触发 — 空 / 空白 / 缺失', () => {
    expect(isHoneypotTriggered({})).toBe(false);
    expect(isHoneypotTriggered({ company_url: '' })).toBe(false);
    expect(isHoneypotTriggered({ company_url: '   ' })).toBe(false);
    expect(isHoneypotTriggered({ company_url: '\t\n' })).toBe(false);
    expect(isHoneypotTriggered({ name: 'Alice' })).toBe(false); // 字段不存在
  });

  test('API-LEAD-SPAM-002 · bot 触发 — 任何非空字符串', () => {
    expect(isHoneypotTriggered({ company_url: 'http://spam.com' })).toBe(true);
    expect(isHoneypotTriggered({ company_url: 'a' })).toBe(true);
    expect(isHoneypotTriggered({ company_url: '   x   ' })).toBe(true);
  });

  test('API-LEAD-SPAM-003 · 错类型不触发 — 防止 false positive', () => {
    // 万一 bot 提交 number / null / array，按"非字符串"看，不当 bot
    // (因为 schema 校验会另外挡掉，honeypot 只管它该管的事)
    expect(isHoneypotTriggered({ company_url: 123 })).toBe(false);
    expect(isHoneypotTriggered({ company_url: null })).toBe(false);
    expect(isHoneypotTriggered({ company_url: undefined })).toBe(false);
    expect(isHoneypotTriggered({ company_url: ['x'] })).toBe(false);
    expect(isHoneypotTriggered({ company_url: { v: 'x' } })).toBe(false);
  });

  test('API-LEAD-SPAM-004 · body 本身的边界情况', () => {
    expect(isHoneypotTriggered(null)).toBe(false);
    expect(isHoneypotTriggered(undefined)).toBe(false);
    expect(isHoneypotTriggered('not-an-object')).toBe(false);
    expect(isHoneypotTriggered(42)).toBe(false);
  });
});
