import { unstable_noStore as noStore } from 'next/cache';
import { readLLMConfig, DEFAULT_LLM_CONFIG, MODEL_OPTIONS } from '@/lib/llm-config';
import { hasClaudeKey } from '@/lib/llm-claude';
import { hasDeepseekKey } from '@/lib/llm-deepseek';
import { hasOpenAIKey } from '@/lib/llm-openai';
import { hasGeminiKey } from '@/lib/llm-gemini';
import AdminLLMForm from './AdminLLMForm';
import LogoutButton from './LogoutButton';

// Same data-cache discipline as the rest of the app: explicit dynamic
// rendering + noStore() so the admin never edits a stale config (see
// CLAUDE.md §一.4.1 for the Data-Cache footgun this avoids).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminLLMPage() {
  noStore();
  const config = await readLLMConfig();
  const providerStatus = {
    claude: hasClaudeKey(),
    deepseek: hasDeepseekKey(),
    openai: hasOpenAIKey(),
    gemini: hasGeminiKey(),
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">LLM 配置</h1>
          <p className="mt-1 text-sm text-ink-500">
            全局配置：设定各提供商用的具体模型版本、不同场景路由到哪家、单点失败时是否自动切换。用户侧无感。
          </p>
        </div>
        <LogoutButton />
      </div>

      <div className="mt-4 rounded-lg border border-ink-100 bg-white p-4 text-sm">
        <div className="font-medium">当前 API Key 状态</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusPill label="Claude" ok={providerStatus.claude} env="ANTHROPIC_API_KEY" />
          <StatusPill label="DeepSeek" ok={providerStatus.deepseek} env="DEEPSEEK_API_KEY" />
          <StatusPill label="GPT-4o" ok={providerStatus.openai} env="OPENAI_API_KEY" />
          <StatusPill label="Gemini" ok={providerStatus.gemini} env="GOOGLE_API_KEY" />
        </div>
        <div className="mt-2 text-xs text-ink-500">
          未配 key 的提供商：你可以先在下方保留路由选项，实际调用会返回 503。
        </div>
      </div>

      <AdminLLMForm
        initialConfig={config}
        defaults={DEFAULT_LLM_CONFIG}
        modelOptions={MODEL_OPTIONS}
        providerStatus={providerStatus}
      />
    </div>
  );
}

function StatusPill({ label, ok, env }: { label: string; ok: boolean; env: string }) {
  return (
    <span
      title={ok ? `${env} configured` : `${env} missing`}
      className={`pill ${
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-300 bg-red-50 text-red-800'
      }`}
    >
      {ok ? '🟢' : '🔴'} {label}
    </span>
  );
}
