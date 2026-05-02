/**
 * Pure helpers for applying judge-suggestion fieldPath strings to module
 * content (Phase 3 of judge agent).
 *
 * Supported path syntax:
 *   - 'headline'           → content.headline
 *   - 'items[2].title'     → content.items[2].title
 *   - 'bullets[0]'         → content.bullets[0]
 *
 * The judge prompt is instructed to use these forms; anything else
 * (deep nesting, dotted, mixed) returns null and the caller falls
 * back to the "copy to clipboard" path so the user can paste manually.
 */

const PATH_RE = /^([a-zA-Z][a-zA-Z0-9_]*)((\[\d+\])?(\.[a-zA-Z][a-zA-Z0-9_]*)?)?$/;

export function parseFieldPath(path: string): null | {
  field: string;
  index?: number;
  subField?: string;
} {
  const m = path.trim().match(PATH_RE);
  if (!m) return null;
  const [, field, rest] = m;
  if (!field) return null;
  if (!rest) return { field };
  const idxMatch = rest.match(/\[(\d+)\]/);
  const subMatch = rest.match(/\.([a-zA-Z][a-zA-Z0-9_]*)$/);
  return {
    field,
    index: idxMatch ? Number(idxMatch[1]) : undefined,
    subField: subMatch ? subMatch[1] : undefined,
  };
}

/**
 * Apply a string value at the parsed path. Returns a NEW content
 * object (immutable). Returns null if the path doesn't resolve to
 * an existing string slot — caller should handle that as "fall back
 * to clipboard mode" (don't silently lose the user's intent).
 */
export function applyFieldPath(
  content: Record<string, unknown>,
  path: string,
  value: string,
): Record<string, unknown> | null {
  const parsed = parseFieldPath(path);
  if (!parsed) return null;
  const { field, index, subField } = parsed;

  // Top-level string: content.headline = ...
  if (index === undefined && !subField) {
    if (typeof content[field] !== 'string') return null;
    return { ...content, [field]: value };
  }

  // Array element of strings: content.bullets[2] = ...
  if (index !== undefined && !subField) {
    const arr = content[field];
    if (!Array.isArray(arr) || index >= arr.length) return null;
    if (typeof arr[index] !== 'string') return null;
    const next = [...arr];
    next[index] = value;
    return { ...content, [field]: next };
  }

  // Array element object's string property: content.items[2].title = ...
  if (index !== undefined && subField) {
    const arr = content[field];
    if (!Array.isArray(arr) || index >= arr.length) return null;
    const item = arr[index];
    if (!item || typeof item !== 'object') return null;
    const itemObj = item as Record<string, unknown>;
    if (typeof itemObj[subField] !== 'string') return null;
    const nextItem = { ...itemObj, [subField]: value };
    const next = [...arr];
    next[index] = nextItem;
    return { ...content, [field]: next };
  }

  return null;
}
