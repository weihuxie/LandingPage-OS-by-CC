/**
 * DeepSeek capability probe — `/v1` endpoint, multi-model × multi-protocol
 * stability matrix.
 *
 * Sibling to `probe-deepseek-anthropic.ts` (that one tests the /anthropic
 * dialect; this one tests /v1 OpenAI-compat). Together they answer
 * the question: "which protocols does each DeepSeek model support on my
 * key, and how stable is each path?"
 *
 * What this script does:
 *   For each (model, protocol) cell:
 *     · Send N rounds of the same minimal strategy-shape probe call
 *     · Classify each round: ok | empty-content | parse-fail | http-err
 *     · Track latency (avg + worst)
 *   Then print a markdown-style matrix + per-cell verdict.
 *
 * Why this exists:
 *   - 2026-05 finding: DeepSeek V4 rejects `tool_choice: {type:'function',
 *     ...}` (400) but supports `response_format: {type:'json_object'}`.
 *     The adapter now dispatches on isV4Family() — see llm-deepseek.ts.
 *     When DeepSeek fixes V4 tool_choice (or breaks something else),
 *     we want a fast way to re-verify without re-implementing the probe
 *     each time.
 *   - DeepSeek doc warns "json_object 模式 API 有概率返回空 content".
 *     One-shot probes can hide that — need N rounds to gauge stability.
 *   - Admin configuring `/admin/llm` may want to verify their key works
 *     against a specific model before flipping primary. Running this
 *     locally (CLI) is the simplest "is this configuration sane" check.
 *
 * Usage (key never leaves your laptop):
 *   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-models.ts
 *   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-models.ts --rounds 5
 *   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-models.ts --models deepseek-chat,deepseek-v4-flash
 *   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-models.ts --protocols json_object
 *
 * Cost: 18 calls × ~200 tokens each at default settings ≈ $0.002. Free.
 *
 * Exit codes:
 *   0  all cells pass at >= 80% rate
 *   1  some cell fails (matrix printed for diagnostics)
 *   2  no DEEPSEEK_API_KEY / fatal setup error
 */
import OpenAI from 'openai';

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY env not set. Run with:');
  console.error('   DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-models.ts');
  process.exit(2);
}

// ---------- CLI args ----------

type Protocol = 'tool_choice' | 'json_object';

function parseArgs(argv: string[]): {
  rounds: number;
  models: string[];
  protocols: Protocol[];
} {
  const out = {
    rounds: 3,
    models: ['deepseek-chat', 'deepseek-v4-pro', 'deepseek-v4-flash'],
    protocols: ['tool_choice', 'json_object'] as Protocol[],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rounds') {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0 && n <= 50) out.rounds = n;
      else throw new Error(`--rounds must be 1..50, got ${argv[i]}`);
    } else if (a === '--models') {
      out.models = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--protocols') {
      const parts = argv[++i].split(',').map((s) => s.trim()) as Protocol[];
      const bad = parts.find((p) => p !== 'tool_choice' && p !== 'json_object');
      if (bad) throw new Error(`--protocols entries must be tool_choice or json_object, got "${bad}"`);
      out.protocols = parts;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-models.ts [options]

Options:
  --rounds N             Number of rounds per (model, protocol) cell. Default 3, max 50.
  --models a,b,c         Comma-separated model ids. Default: deepseek-chat,deepseek-v4-pro,deepseek-v4-flash
  --protocols a,b        Comma-separated protocols: tool_choice and/or json_object. Default both.
  -h, --help             Show this help.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a} (use --help to list options)`);
    }
  }
  return out;
}

let args: ReturnType<typeof parseArgs>;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error('❌', (e as Error).message);
  process.exit(2);
}

// ---------- Probe payload ----------

const client = new OpenAI({ apiKey: API_KEY, baseURL: 'https://api.deepseek.com/v1' });

// Mirrors the strategy-emit tool shape from llm-deepseek.ts so the probe
// stresses the same JSON contract we use in production.
const STRATEGY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'emit_strategy_summary',
    description: 'Emit the four-part strategy summary in the target locale.',
    parameters: {
      type: 'object' as const,
      properties: {
        audience: { type: 'array' as const, items: { type: 'string' as const } },
        goal: { type: 'array' as const, items: { type: 'string' as const } },
        narrative: { type: 'array' as const, items: { type: 'string' as const } },
        local: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['audience', 'goal', 'narrative', 'local'],
    },
  },
};

// For json_object mode we describe the same schema in the system prompt
// per DeepSeek's hard requirement ("prompt 必须含 json 关键字 + 给出 JSON
// 格式样例"). The user prompt restates "json" to satisfy the keyword check.
const JSON_MODE_SYSTEM = `You are a B2B SaaS strategist. Output a single valid json object with exactly these keys (each value an array of 3-5 short Chinese strings):
{
  "audience": ["..."],
  "goal": ["..."],
  "narrative": ["..."],
  "local": ["..."]
}
No markdown fences, no commentary — only the json.`;

const USER_PROMPT = 'Generate a strategy summary for "Acme CRM" (B2B sales pipeline tool, locale=zh-CN). Return as json matching the schema.';

// ---------- Result classification ----------

type OutcomeKind = 'ok' | 'empty' | 'parse_fail' | 'schema_miss' | 'http_err';
interface RoundOutcome {
  kind: OutcomeKind;
  ms: number;
  detail?: string;
}

function classifyStrategyShape(obj: unknown): 'ok' | 'schema_miss' {
  if (!obj || typeof obj !== 'object') return 'schema_miss';
  const o = obj as Record<string, unknown>;
  const ok =
    Array.isArray(o.audience) &&
    Array.isArray(o.goal) &&
    Array.isArray(o.narrative) &&
    Array.isArray(o.local);
  return ok ? 'ok' : 'schema_miss';
}

async function probeRound(model: string, protocol: Protocol): Promise<RoundOutcome> {
  const t0 = Date.now();
  try {
    if (protocol === 'tool_choice') {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: 1024,
        temperature: 0.4,
        messages: [{ role: 'user', content: USER_PROMPT }],
        tools: [STRATEGY_TOOL],
        tool_choice: { type: 'function', function: { name: 'emit_strategy_summary' } },
      });
      const tc = resp.choices[0]?.message?.tool_calls?.[0];
      if (!tc || tc.type !== 'function') {
        const text = resp.choices[0]?.message?.content;
        if (!text) return { kind: 'empty', ms: Date.now() - t0, detail: `finish=${resp.choices[0]?.finish_reason ?? '?'}` };
        return { kind: 'parse_fail', ms: Date.now() - t0, detail: `no function tool_call, content head=${text.slice(0, 60)}` };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(tc.function.arguments); }
      catch { return { kind: 'parse_fail', ms: Date.now() - t0, detail: 'tool_call.arguments not parseable JSON' }; }
      const shape = classifyStrategyShape(parsed);
      return { kind: shape, ms: Date.now() - t0 };
    } else {
      // json_object mode
      const resp = await client.chat.completions.create({
        model,
        max_tokens: 1024,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: JSON_MODE_SYSTEM },
          { role: 'user', content: USER_PROMPT },
        ],
      });
      const text = resp.choices[0]?.message?.content;
      if (!text || !text.trim()) {
        return { kind: 'empty', ms: Date.now() - t0, detail: `finish=${resp.choices[0]?.finish_reason ?? '?'}` };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { return { kind: 'parse_fail', ms: Date.now() - t0, detail: `content not parseable, head=${text.slice(0, 60)}` }; }
      const shape = classifyStrategyShape(parsed);
      return { kind: shape, ms: Date.now() - t0 };
    }
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status;
    const msg = (e as { message?: string })?.message ?? String(e);
    return { kind: 'http_err', ms: Date.now() - t0, detail: status ? `HTTP ${status}: ${msg.slice(0, 120)}` : msg.slice(0, 120) };
  }
}

// ---------- Aggregation ----------

interface CellSummary {
  model: string;
  protocol: Protocol;
  outcomes: RoundOutcome[];
}

function summarize(cell: CellSummary): {
  okN: number;
  emptyN: number;
  parseFailN: number;
  schemaMissN: number;
  httpErrN: number;
  total: number;
  passRate: number;
  avgMs: number;
  p95Ms: number;
  worstErr?: string;
} {
  const total = cell.outcomes.length;
  const buckets = { ok: 0, empty: 0, parse_fail: 0, schema_miss: 0, http_err: 0 };
  for (const o of cell.outcomes) buckets[o.kind]++;
  const mss = cell.outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const avg = mss.reduce((s, n) => s + n, 0) / total;
  const p95 = mss[Math.min(mss.length - 1, Math.floor(total * 0.95))];
  // First non-ok detail makes for the most informative error hint.
  const worst = cell.outcomes.find((o) => o.kind !== 'ok');
  return {
    okN: buckets.ok,
    emptyN: buckets.empty,
    parseFailN: buckets.parse_fail,
    schemaMissN: buckets.schema_miss,
    httpErrN: buckets.http_err,
    total,
    passRate: buckets.ok / total,
    avgMs: Math.round(avg),
    p95Ms: Math.round(p95),
    worstErr: worst?.detail,
  };
}

// ---------- Main loop ----------

async function main() {
  console.log(`\n  DeepSeek capability probe (/v1 endpoint, key=${API_KEY!.slice(0, 7)}…${API_KEY!.slice(-4)})`);
  console.log(`  ${args.models.length} model(s) × ${args.protocols.length} protocol(s) × ${args.rounds} round(s) = ${args.models.length * args.protocols.length * args.rounds} call(s)\n`);

  const cells: CellSummary[] = [];
  for (const model of args.models) {
    for (const protocol of args.protocols) {
      const outcomes: RoundOutcome[] = [];
      for (let r = 0; r < args.rounds; r++) {
        process.stdout.write(`  ${model.padEnd(20)} ${protocol.padEnd(12)} round ${r + 1}/${args.rounds} … `);
        const out = await probeRound(model, protocol);
        outcomes.push(out);
        const tag = out.kind === 'ok' ? '✅' : out.kind === 'empty' ? '⭕ empty' : out.kind === 'parse_fail' ? '⚠️ parse' : out.kind === 'schema_miss' ? '⚠️ schema' : '❌ http';
        const detail = out.detail ? ` ${out.detail.slice(0, 80)}` : '';
        console.log(`${tag} ${out.ms}ms${out.kind !== 'ok' ? detail : ''}`);
      }
      cells.push({ model, protocol, outcomes });
    }
  }

  // Print matrix.
  console.log('\n  === Capability Matrix ===\n');
  const colWidths = { model: 22, protocol: 14, pass: 14, latency: 26, fail: 30, verdict: 18 };
  const header =
    'Model'.padEnd(colWidths.model) +
    'Protocol'.padEnd(colWidths.protocol) +
    'Pass'.padEnd(colWidths.pass) +
    'Latency'.padEnd(colWidths.latency) +
    'Failure modes'.padEnd(colWidths.fail) +
    'Verdict'.padEnd(colWidths.verdict);
  console.log('  ' + header);
  console.log('  ' + '─'.repeat(header.length));

  let allCellsOk = true;
  for (const cell of cells) {
    const s = summarize(cell);
    const passStr = `${s.okN}/${s.total} (${Math.round(s.passRate * 100)}%)`;
    const latStr = `avg ${s.avgMs}ms p95 ${s.p95Ms}ms`;
    const failParts: string[] = [];
    if (s.emptyN) failParts.push(`empty=${s.emptyN}`);
    if (s.parseFailN) failParts.push(`parse_fail=${s.parseFailN}`);
    if (s.schemaMissN) failParts.push(`schema_miss=${s.schemaMissN}`);
    if (s.httpErrN) failParts.push(`http_err=${s.httpErrN}`);
    const failStr = failParts.length ? failParts.join(' ') : '(none)';
    let verdict: string;
    if (s.passRate >= 0.8) verdict = '✅ usable';
    else if (s.passRate > 0) verdict = '⚠️ flaky';
    else verdict = '❌ unsupported';
    if (s.passRate < 0.8) allCellsOk = false;
    console.log(
      '  ' +
        cell.model.padEnd(colWidths.model) +
        cell.protocol.padEnd(colWidths.protocol) +
        passStr.padEnd(colWidths.pass) +
        latStr.padEnd(colWidths.latency) +
        failStr.padEnd(colWidths.fail) +
        verdict.padEnd(colWidths.verdict),
    );
    if (s.worstErr && s.okN === 0) {
      console.log('  ' + ' '.repeat(colWidths.model + colWidths.protocol) + `  └─ ${s.worstErr.slice(0, 100)}`);
    }
  }

  // Hint actionable conclusion based on common patterns.
  console.log('');
  const v4Cells = cells.filter((c) => /^deepseek-v4/i.test(c.model));
  const v4ToolChoice = v4Cells.find((c) => c.protocol === 'tool_choice');
  const v4JsonMode = v4Cells.find((c) => c.protocol === 'json_object');
  if (v4ToolChoice && v4JsonMode) {
    const tcPass = summarize(v4ToolChoice).passRate;
    const jmPass = summarize(v4JsonMode).passRate;
    if (tcPass === 0 && jmPass >= 0.8) {
      console.log('  Verdict: V4 still rejects tool_choice (DeepSeek not yet fixed).');
      console.log('  The adapter routes V4 through json_object — leave isV4Family() as-is.');
    } else if (tcPass >= 0.8 && jmPass >= 0.8) {
      console.log('  Verdict: V4 now supports BOTH protocols! 🎉');
      console.log('  Consider simplifying llm-deepseek.ts — remove the isV4Family() branch and let V4 use the same tool_choice path as V3.');
    } else if (tcPass > 0 && tcPass < 0.8) {
      console.log('  Verdict: V4 tool_choice is FLAKY (some rounds pass, some 400). Risky to switch off the json_object path yet.');
    } else if (jmPass === 0) {
      console.log('  Verdict: V4 json_object path is also broken. Check the key, the model id, or DeepSeek status page.');
    }
  }
  console.log('');
  process.exit(allCellsOk ? 0 : 1);
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(2);
});
