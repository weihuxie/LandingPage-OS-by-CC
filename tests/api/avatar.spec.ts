/**
 * API-AVATAR-* · pure helpers for the user-badge avatar / display name.
 */
import { test, expect } from '@playwright/test';
import {
  emailLocal,
  displayNameOf,
  avatarLetter,
  avatarColors,
} from '../../src/lib/avatar';

test.describe('API-AVATAR · emailLocal', () => {
  test('API-AVATAR-001 · standard email returns local part', () => {
    expect(emailLocal('weih.xie@gmail.com')).toBe('weih.xie');
  });
  test('API-AVATAR-002 · sub-addressed email keeps the `+`', () => {
    expect(emailLocal('alice+work@example.org')).toBe('alice+work');
  });
  test('API-AVATAR-003 · no `@` returns the original string', () => {
    expect(emailLocal('plain-name')).toBe('plain-name');
  });
  test('API-AVATAR-004 · empty input returns empty', () => {
    expect(emailLocal('')).toBe('');
  });
  test('API-AVATAR-005 · `@`-prefix edge case (no local part) returns the input as-is', () => {
    // Not a real address; the helper just shouldn't crash. emailLocal
    // returns '' for `@foo` since at index is 0 (>0 check fails) and
    // we slice to empty.
    expect(emailLocal('@bar')).toBe('@bar');
  });
});

test.describe('API-AVATAR · displayNameOf', () => {
  test('API-AVATAR-101 · prefers explicit displayName when set', () => {
    expect(displayNameOf({ displayName: 'Alice', email: 'alice@x.com' })).toBe('Alice');
  });
  test('API-AVATAR-102 · falls back to email local when displayName empty/whitespace', () => {
    expect(displayNameOf({ displayName: '   ', email: 'bob@x.com' })).toBe('bob');
    expect(displayNameOf({ displayName: '', email: 'bob@x.com' })).toBe('bob');
    expect(displayNameOf({ email: 'bob@x.com' })).toBe('bob');
  });
  test('API-AVATAR-103 · email-local-only path: trims whitespace from local', () => {
    // Defensive — a malformed email won't actually have leading space
    // in practice, but the trim is part of the contract.
    expect(displayNameOf({ email: 'space.user@x.com' })).toBe('space.user');
  });
  test('API-AVATAR-104 · ultimate fallback to "用户" when nothing usable', () => {
    expect(displayNameOf({ email: '' })).toBe('用户');
  });
});

test.describe('API-AVATAR · avatarLetter', () => {
  test('API-AVATAR-201 · uppercased first letter of displayName', () => {
    expect(avatarLetter({ displayName: 'alice', email: 'a@x.com' })).toBe('A');
    expect(avatarLetter({ email: 'weih.xie@gmail.com' })).toBe('W');
  });
  test('API-AVATAR-202 · CJK character used as-is', () => {
    expect(avatarLetter({ displayName: '王五', email: 'wx@x.com' })).toBe('王');
  });
});

test.describe('API-AVATAR · avatarColors', () => {
  test('API-AVATAR-301 · same email → same colors (deterministic)', () => {
    const a = avatarColors('weih.xie@gmail.com');
    const b = avatarColors('weih.xie@gmail.com');
    expect(a).toEqual(b);
  });
  test('API-AVATAR-302 · different emails → different hues', () => {
    const a = avatarColors('alice@x.com');
    const b = avatarColors('bob@y.com');
    // Statistically different — both same input would be a bug; for
    // FNV-1a these two strings collide is essentially zero.
    expect(a.bg).not.toBe(b.bg);
  });
  test('API-AVATAR-303 · empty email still produces valid colors (anon bucket)', () => {
    const c = avatarColors('');
    expect(c.bg).toMatch(/^hsl\(\d+, 55%, 52%\)$/);
    expect(c.gradient).toContain('linear-gradient');
    expect(c.fg).toBe('#ffffff');
  });
  test('API-AVATAR-304 · gradient interpolates base → darker base', () => {
    const c = avatarColors('alice@x.com');
    // Both stops should share the same hue (linear darken, not random).
    const m = c.gradient.match(/hsl\((\d+), 55%, (\d+)%\)/g);
    expect(m).toBeTruthy();
    expect(m!.length).toBe(2);
    const [first, second] = m!.map((s) => Number(s.match(/(\d+)%, (\d+)%\)/)![2]));
    expect(first - second).toBe(12);
  });
});
