import type { Project, PageModule, HeroContent, FormContent } from './types';
import { reportHeroTemplate } from './template-detection';

export interface LintFinding {
  severity: 'error' | 'warn' | 'info';
  rule: string;
  message: string;
  moduleId?: string;
}

/**
 * Visual & conversion red-line linter (PRD v5.1 §5.2).
 * Pure function — runs both in editor and in CI.
 */
export function auditProject(project: Project): LintFinding[] {
  const out: LintFinding[] = [];

  // R1: only one primary CTA
  const heroes = project.modules.filter((m) => m.type === 'hero');
  const ctas = project.modules.filter((m) => m.type === 'cta');
  if (heroes.length + ctas.length > 2) {
    out.push({
      severity: 'warn',
      rule: 'single-primary-cta',
      message: '页面存在超过两个强 CTA 区块，建议合并或降级次要 CTA。',
    });
  }

  // R2: Hero headline length
  for (const m of heroes) {
    const h = m.content as HeroContent;
    if (h.headline && h.headline.length > 60) {
      out.push({
        severity: 'warn',
        rule: 'hero-headline-length',
        message: `Hero 标题 ${h.headline.length} 字，偏长。移动端可能折行太多，建议 ≤ 40。`,
        moduleId: m.id,
      });
    }
    if (project.inputs.locale !== 'en' && h.headline && h.headline === h.headline.toUpperCase() && /[A-Z]/.test(h.headline)) {
      out.push({
        severity: 'warn',
        rule: 'no-all-caps-non-en',
        message: '非英文市场应避免标题全大写。',
        moduleId: m.id,
      });
    }
  }

  // R2b: Hero is still a raw template fingerprint — fatal quality bug.
  // If Claude hydration failed silently, the page may be shipping
  // "每周有 11 小时" / "3.8 倍 ROI" style fake-grounded copy that does
  // not reflect the user's actual product. Treat as error so the publish
  // gate refuses and the editor banner surfaces the problem.
  const heroReport = reportHeroTemplate(project.modules, project.inputs.name);
  if (heroReport.anyTemplate) {
    const parts: string[] = [];
    if (heroReport.headline) parts.push('主标题');
    if (heroReport.bullets) parts.push('要点');
    out.push({
      severity: 'error',
      rule: 'hero-is-template',
      message: `Hero 的${parts.join(' / ')}仍是未被替换的模板占位文案，与当前产品信息不匹配。请点击重新生成，或手动改写后再发布。`,
      moduleId: heroes[0]?.id,
    });
  }

  // R3: Form length — too many fields hurts CVR.
  // Skip when mode='external': fields aren't rendered, the external tool
  // owns field count. Instead warn if externalUrl is missing — that form
  // renders as a dead card otherwise.
  const forms = project.modules.filter((m) => m.type === 'form');
  for (const f of forms) {
    const c = f.content as FormContent;
    if (c.mode === 'external') {
      if (!c.externalUrl || !/^https?:\/\//i.test(c.externalUrl)) {
        out.push({
          severity: 'error',
          rule: 'form-external-url-missing',
          message: '表单设为外链模式，但 External URL 为空或格式不正确。',
          moduleId: f.id,
        });
      }
      continue;
    }
    if (c.fields && c.fields.length > 5) {
      out.push({
        severity: 'warn',
        rule: 'form-too-long',
        message: `表单字段数 ${c.fields.length}，建议 ≤ 5 以保护转化。`,
        moduleId: f.id,
      });
    }
  }

  // R4: JP market should have a certification / trust signal
  if (project.inputs.market === 'JP') {
    const hasProof = project.modules.some(
      (m) => m.type === 'socialProof' || m.type === 'testimonial',
    );
    if (!hasProof) {
      out.push({
        severity: 'error',
        rule: 'jp-needs-trust',
        message: '日本市场页面缺少信任模块（客户背书或认证）。建议添加。',
      });
    }
  }

  // R5: primary color contrast vs white — avoid light pastels on white
  const hex = (project.theme.primary || '').replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.78) {
      out.push({
        severity: 'warn',
        rule: 'contrast-primary-too-light',
        message: '主色对白底对比度偏弱，CTA 可能不够显眼。建议加深。',
      });
    }
  }

  // R6: module count too low
  if (project.modules.length < 5) {
    out.push({
      severity: 'info',
      rule: 'too-few-modules',
      message: `页面模块 ${project.modules.length} 个，信息量偏少，可能不足以建立信任。`,
    });
  }

  return out;
}
