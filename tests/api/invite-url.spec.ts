/**
 * API-INVITE-URL-* · pure helpers for the invite link modal (S4 partial).
 */
import { test, expect } from '@playwright/test';
import {
  buildInviteUrl,
  formatRemaining,
  formatRelative,
} from '../../src/lib/invite-url';

test.describe('API-INVITE-URL · buildInviteUrl', () => {
  test('API-INVITE-URL-001 · with origin builds absolute URL', () => {
    expect(buildInviteUrl('abc123', 'https://landingpage.aiverygen.ai'))
      .toBe('https://landingpage.aiverygen.ai/invite/abc123');
  });

  test('API-INVITE-URL-002 · null origin builds relative path (SSR safe)', () => {
    expect(buildInviteUrl('abc123', null)).toBe('/invite/abc123');
  });

  test('API-INVITE-URL-003 · origin trailing slash NOT auto-stripped (caller responsibility)', () => {
    // Documents the contract: caller passes window.location.origin
    // which never has trailing slash. We don't double-defend.
    expect(buildInviteUrl('x', 'https://example.com/'))
      .toBe('https://example.com//invite/x');
  });
});

test.describe('API-INVITE-URL · formatRemaining', () => {
  const NOW = 1_000_000_000_000; // arbitrary fixed epoch for tests

  test('API-INVITE-URL-101 · expired returns 已过期', () => {
    expect(formatRemaining(NOW - 1, NOW)).toBe('已过期');
    expect(formatRemaining(NOW, NOW)).toBe('已过期');
  });

  test('API-INVITE-URL-102 · ≥1 day returns N 天后过期', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(formatRemaining(NOW + 14 * day, NOW)).toBe('14 天后过期');
    expect(formatRemaining(NOW + day + 1000, NOW)).toBe('1 天后过期');
  });

  test('API-INVITE-URL-103 · <1 day, ≥1 hour returns hours', () => {
    const hour = 60 * 60 * 1000;
    expect(formatRemaining(NOW + 5 * hour, NOW)).toBe('5 小时后过期');
    expect(formatRemaining(NOW + hour + 1000, NOW)).toBe('1 小时后过期');
  });

  test('API-INVITE-URL-104 · <1 hour returns minutes', () => {
    expect(formatRemaining(NOW + 5 * 60 * 1000, NOW)).toBe('5 分钟后过期');
    expect(formatRemaining(NOW + 30 * 60 * 1000, NOW)).toBe('30 分钟后过期');
  });
});

test.describe('API-INVITE-URL · formatRelative', () => {
  const NOW = 1_000_000_000_000;

  test('API-INVITE-URL-201 · <1 min returns 刚刚', () => {
    expect(formatRelative(NOW - 30 * 1000, NOW)).toBe('刚刚');
    expect(formatRelative(NOW, NOW)).toBe('刚刚');
  });

  test('API-INVITE-URL-202 · <1 hour returns minutes', () => {
    expect(formatRelative(NOW - 5 * 60 * 1000, NOW)).toBe('5 分钟前');
  });

  test('API-INVITE-URL-203 · <1 day returns hours', () => {
    expect(formatRelative(NOW - 5 * 60 * 60 * 1000, NOW)).toBe('5 小时前');
  });

  test('API-INVITE-URL-204 · ≥1 day returns days', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(formatRelative(NOW - 3 * day, NOW)).toBe('3 天前');
  });
});
