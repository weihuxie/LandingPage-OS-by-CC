/**
 * Single-field rewrite suggester (pattern ① "Per-field AI 改写" from
 * AI-introduction design doc).
 *
 * Produces 3 alternative rewrites for ONE field, given:
 *  - field path (e.g. "hero.headline" — informs LLM what kind of text it is)
 *  - current value (the LLM rewrites, doesn't generate from scratch)
 *  - product context (name + tagline + value prop + audience)
 *  - locale (output language)
 *  - optional user hint ("更国际化", "加数字", "更短")
 *
 * Why a separate adapter family (and not a tool-call-style structured
 * output like regenerateModuleViaClaude):
 *  - Output is dead simple — 3 strings + 3 reasons. Tool schema is
 *    overkill and adds another failure mode (schema mismatch).
 *  - Plain text + JSON parsing via the existing extractJsonObject helper
 *    is plenty robust at this output size.
 *  - DeepSeek's OpenAI-compatible JSON mode works just by setting
 *    response_format: 'json_object' — same idea on both providers without
 *    the tool_choice incompatibility tax.
 */
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonObject, hasClaudeKey } from './llm-claude';
import { hasDeepseekKey, isReasonerFamily } from './llm-deepseek';
import { LLMRequiredError, LLMCallError } from './errors';
import type { PageLocale, ProductInputs, StrategySummary } from './types';
import { buildDeepseekClient } from './llm-openai';

export interface FieldSuggestion {
  text: string;
  /** Why this variant — one short sentence the user can scan to pick. */
  reason: string;
}

export interface FieldSuggestRequest {
  fieldPath: string;
  fieldLabel: string;
  currentValue: string;
  hint?: string;
  inputs: ProductInputs;
  strategy: StrategySummary | null;
  locale: PageLocale;
}

const SYSTEM = `You are a senior B2B SaaS landing-page copywriter. The user is editing ONE field of a page and asks for 3 alternative rewrites. Return STRICT JSON in the shape:

{ "alternatives": [
  { "text": "...", "reason": "..." },
  { "text": "...", "reason": "..." },
  { "text": "...", "reason": "..." }
] }

Rules:
- Output exactly 3 alternatives. Each "text" is the field value only — no quotes, no field name prefix, no markdown.
- The 3 should attack the field from 3 different angles (e.g. cost-led / outcome-led / proof-led; or short / medium / long; or formal / punchy / story).
- Each "reason" is ONE short sentence (≤ 20 words) saying what makes this variant different — for the user to pick.
- Match the locale: native idiom and rhythm, not literal translation.
- If the field is a CTA / button, prefer concrete action verbs and specific outcomes (avoid "Learn more").
- If the field is a headline / subhead, prefer one quantifiable promise (number / %  / × / 倍) per variant.
- Do NOT add commentary outside the JSON. No prose, no fences, just the object.`;

function buildUserPrompt(req: FieldSuggestRequest): string {
  const lines: string[] = [];
  lines.push(`Field: ${req.fieldPath} (${req.fieldLabel})`);
  lines.push(`Locale: ${req.locale}`);
  lines.push(`Product: ${req.inputs.name}`);
  if (req.inputs.tagline) lines.push(`Tagline: ${req.inputs.tagline}`);
  if (req.inputs.value) lines.push(`Core value: ${req.inputs.value}`);
  if (req.inputs.market) lines.push(`Market: ${req.inputs.market}`);
  const audience = [req.inputs.industry, req.inputs.companySize, req.inputs.role]
    .filter(Boolean)
    .join(' · ');
  if (audience) lines.push(`Audience: ${audience}`);
  if (req.strategy) {
    lines.push('');
    lines.push('Strategy summary:');
    lines.push(`- Audience: ${req.strategy.audience.slice(0, 4).join(' | ')}`);
    lines.push(`- Goal: ${req.strategy.goal.slice(0, 3).join(' | ')}`);
    lines.push(`- Narrative: ${req.strategy.narrative.slice(0, 3).join(' | ')}`);
  }
  lines.push('');
  lines.push(`Current value of ${req.fieldPath}:`);
  lines.push(req.currentValue || '(empty)');
  if (req.hint) {
    lines.push('');
    lines.push(`User hint: ${req.hint}`);
  }
  lines.push('');
  lines.push(`Return 3 rewrites of ${req.fieldPath} in ${req.locale}, JSON only.`);
  return lines.join('\n');
}

interface ParsedResponse {
  alternatives?: Array<{ text?: unknown; reason?: unknown }>;
}

function normalize(parsed: ParsedResponse | null): FieldSuggestion[] {
  if (!parsed || !Array.isArray(parsed.alternatives)) return [];
  return parsed.alternatives
    .map((a) => ({
      text: typeof a?.text === 'string' ? a.text.trim() : '',
      reason: typeof a?.reason === 'string' ? a.reason.trim() : '',
    }))
    .filter((a) => a.text.length > 0)
    .slice(0, 3);
}

const HARDCODED_CLAUDE_DEFAULT = 'claude-opus-4-20250514';
const HARDCODED_DEEPSEEK_DEFAULT = 'deepseek-chat';

export async function suggestFieldViaClaude(
  req: FieldSuggestRequest,
  modelOverride?: string,
): Promise<FieldSuggestion[]> {
  if (!hasClaudeKey()) {
    throw new LLMRequiredError('module-regen', 'ANTHROPIC_API_KEY');
  }
  const client = new Anthropic();
  const model = modelOverride?.trim() || HARDCODED_CLAUDE_DEFAULT;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserPrompt(req) }],
    });
    const textBlock = res.content.find((b) => b.type === 'text');
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const parsed = extractJsonObject<ParsedResponse>(raw);
    const out = normalize(parsed);
    if (out.length === 0) {
      throw new LLMCallError('claude', 'module-regen', new Error('no usable alternatives in response'));
    }
    return out;
  } catch (err) {
    if (err instanceof LLMCallError) throw err;
    throw new LLMCallError('claude', 'module-regen', err);
  }
}

export async function suggestFieldViaDeepseek(
  req: FieldSuggestRequest,
  modelOverride?: string,
): Promise<FieldSuggestion[]> {
  if (!hasDeepseekKey()) {
    throw new LLMRequiredError('module-regen', 'DEEPSEEK_API_KEY');
  }
  let model = modelOverride?.trim() || HARDCODED_DEEPSEEK_DEFAULT;
  // Reasoner family doesn't support tool_choice / json_object reliably.
  // Field-suggest is JSON-only; safer to coerce to deepseek-chat.
  if (isReasonerFamily(model)) {
    console.warn(`[field-suggest] deepseek model ${model} is reasoner family — coercing to ${HARDCODED_DEEPSEEK_DEFAULT}`);
    model = HARDCODED_DEEPSEEK_DEFAULT;
  }
  const client = buildDeepseekClient();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(req) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = extractJsonObject<ParsedResponse>(raw);
    const out = normalize(parsed);
    if (out.length === 0) {
      throw new LLMCallError('deepseek', 'module-regen', new Error('no usable alternatives in response'));
    }
    return out;
  } catch (err) {
    if (err instanceof LLMCallError) throw err;
    throw new LLMCallError('deepseek', 'module-regen', err);
  }
}
