/**
 * Verification probe: does DeepSeek's /anthropic endpoint support
 * Anthropic-style tool_use with V4 models?
 *
 * Hypothesis: DeepSeek V4 doesn't support OpenAI-style `tool_choice`,
 * but exposes a separate Anthropic-protocol endpoint at
 * `https://api.deepseek.com/anthropic` which speaks Claude's tool_use
 * dialect. If V4 routes through this endpoint successfully, we can
 * reuse the existing Claude adapter shape and unblock V4 in this repo
 * without waiting for DeepSeek's OpenAI-tool_choice implementation.
 *
 * What this script does:
 *   1. Hit /anthropic endpoint with deepseek-v4-pro + tool_use
 *   2. Same with deepseek-v4-flash
 *   3. Same with deepseek-chat (V3 sanity check — should always work)
 *   4. Print structured pass/fail per model
 *
 * Usage (you run this, key never leaves your laptop):
 *   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-anthropic.ts
 *
 * Required: tsx (devDep) or `npx -p typescript -p tsx tsx ...`
 *
 * Cost note: each call ≤ 200 tokens, ~$0.0001. Three calls total. Free.
 */
import Anthropic from '@anthropic-ai/sdk';

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY env not set. Run with:');
  console.error('   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-anthropic.ts');
  process.exit(1);
}

// Point Anthropic SDK at DeepSeek's anthropic-compatible endpoint.
const client = new Anthropic({
  apiKey: API_KEY,
  baseURL: 'https://api.deepseek.com/anthropic',
});

// A minimal tool that mirrors the strategy-generation shape we use in
// llm-claude.ts. If the model returns a valid `input` matching this
// schema, the protocol works for our use case.
const TOOL = {
  name: 'emit_strategy_summary',
  description: 'Emit the four-part strategy summary in the target locale.',
  input_schema: {
    type: 'object',
    properties: {
      audience: { type: 'array', items: { type: 'string' } },
      goal: { type: 'array', items: { type: 'string' } },
      narrative: { type: 'array', items: { type: 'string' } },
      local: { type: 'array', items: { type: 'string' } },
    },
    required: ['audience', 'goal', 'narrative', 'local'],
  },
};

const TEST_PROMPT = `Generate a B2B SaaS strategy summary for "Acme CRM" — a sales pipeline tool. Locale: zh-CN. Output 3-5 short Chinese strings per array.`;

interface ProbeResult {
  model: string;
  ok: boolean;
  durationMs: number;
  toolCallShape?: unknown;
  parsedKeys?: string[];
  error?: string;
}

async function probeOne(model: string): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [TOOL] as any,
      tool_choice: { type: 'tool', name: 'emit_strategy_summary' } as any,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    });

    // Walk the content array looking for tool_use block. Anthropic
    // returns content: [{type: 'tool_use', input: {...}}] when tool_choice
    // forces a specific tool.
    const toolBlock = (resp.content as any[]).find((b: any) => b.type === 'tool_use');
    if (!toolBlock) {
      return {
        model,
        ok: false,
        durationMs: Date.now() - t0,
        error: 'no tool_use block in response — model returned text only',
        toolCallShape: resp.content,
      };
    }
    const input = toolBlock.input;
    const keys = Object.keys(input ?? {});
    const required = ['audience', 'goal', 'narrative', 'local'];
    const missing = required.filter((k) => !keys.includes(k));
    if (missing.length > 0) {
      return {
        model,
        ok: false,
        durationMs: Date.now() - t0,
        error: `tool_use returned but missing keys: ${missing.join(', ')}`,
        parsedKeys: keys,
      };
    }
    return {
      model,
      ok: true,
      durationMs: Date.now() - t0,
      parsedKeys: keys,
      toolCallShape: input,
    };
  } catch (e: any) {
    return {
      model,
      ok: false,
      durationMs: Date.now() - t0,
      error:
        e?.status != null
          ? `HTTP ${e.status}: ${e?.message ?? 'unknown'}`
          : e?.message ?? String(e),
    };
  }
}

async function main() {
  const targets = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'];
  console.log(`\n  Probing DeepSeek /anthropic endpoint (${client.baseURL})\n`);
  for (const model of targets) {
    process.stdout.write(`  ${model.padEnd(22)} … `);
    const result = await probeOne(model);
    if (result.ok) {
      console.log(
        `✅ ok (${result.durationMs}ms) — keys: ${result.parsedKeys?.join(', ')}`,
      );
      console.log(
        `      sample: ${JSON.stringify(result.toolCallShape).slice(0, 160)}…`,
      );
    } else {
      console.log(`❌ fail (${result.durationMs}ms)`);
      console.log(`      ${result.error}`);
      if (result.toolCallShape) {
        console.log(
          `      response shape: ${JSON.stringify(result.toolCallShape).slice(0, 200)}`,
        );
      }
    }
  }
  console.log('');
  console.log(
    '  Verdict: if V4 models pass, we can wire DeepSeek through the',
  );
  console.log('  Anthropic SDK + /anthropic baseURL and unlock V4 today.');
  console.log('');
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(2);
});
