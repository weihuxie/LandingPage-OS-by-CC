/**
 * 能力探针:先问 /api/capabilities 再决定跳过哪些 [需 KEY] 用例。
 *
 * 不直接读 process.env.ANTHROPIC_API_KEY — 因为测试脚本和 dev server 可能
 * 不是同一进程(CI 上尤其明显)。以服务端实际能力为准。
 */
import type { APIRequestContext } from '@playwright/test';

export type Capabilities = {
  hasClaude: boolean;
  hasOpenAI: boolean;
  hasGemini: boolean;
  hasDeploy: boolean;
  ready: {
    createProject: boolean;
    addLocale: boolean;
    deploy: boolean;
  };
};

let cache: Capabilities | null = null;

export async function getCapabilities(request: APIRequestContext): Promise<Capabilities> {
  if (cache) return cache;
  const res = await request.get('/api/capabilities');
  cache = (await res.json()) as Capabilities;
  return cache;
}

/** 每个 describe 或 test 用 test.skip(...) 包一下 */
export async function skipIfNoClaude(request: APIRequestContext): Promise<string | null> {
  const caps = await getCapabilities(request);
  return caps.hasClaude ? null : 'requires ANTHROPIC_API_KEY';
}

export async function skipIfNoAddLocale(request: APIRequestContext): Promise<string | null> {
  const caps = await getCapabilities(request);
  return caps.ready.addLocale ? null : 'requires ANTHROPIC_API_KEY + OPENAI_API_KEY';
}

/** 用于 [无 KEY] 专项用例 — 反向跳过:有 key 时不跑 */
export async function skipIfHasClaude(request: APIRequestContext): Promise<string | null> {
  const caps = await getCapabilities(request);
  return caps.hasClaude ? null : null; // 总是允许跑,断言层自己判 hasClaude
}
