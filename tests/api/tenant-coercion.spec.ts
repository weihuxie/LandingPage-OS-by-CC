/**
 * API-TEN-COER-* · S2 tenant coercion + scoped reads.
 *
 * Pre-S2 KV blobs only carry `ownerId:'default'`. After S2 the canonical
 * field is `tenantId`. Storage readers must coerce so callers always see
 * `tenantId` populated, even on legacy rows. Filtering by tenantId must
 * include legacy rows under the LEGACY_TENANT_ID sentinel.
 *
 * Pure-function tests — don't need KV / dev server / API keys.
 */
import { test, expect } from '@playwright/test';
import { LEGACY_TENANT_ID } from '../../src/lib/storage';

test.describe('API-TEN-COER · Tenant coercion + scoping', () => {
  test('API-TEN-COER-001 · LEGACY_TENANT_ID sentinel matches "default"', () => {
    // The string value 'default' is what every pre-S2 row in KV carries.
    // If we ever change the constant we must also migrate KV; this test
    // catches the "renamed in code, forgot the data" mismatch.
    expect(LEGACY_TENANT_ID).toBe('default');
  });
});
