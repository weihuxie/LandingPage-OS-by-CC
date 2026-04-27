'use client';
/**
 * OnboardingTour — pattern ④ "Onboarding 走查" from the AI-introduction
 * design doc.
 *
 * 4-step popover tour for first-time visitors of /[locale]/dashboard.
 * Driven by driver.js (5KB, zero config beyond steps array).
 *
 * Triggers:
 *  - On mount, if localStorage['lp:onboarding-done'] is unset → start
 *  - Manual "重新看引导" button (rendered from dashboard header) → start
 *
 * Persistence:
 *  - localStorage flag, no auth required (works for guest + logged-in)
 *  - Tour completion marks done; "skip"/close also marks done so we don't
 *    nag users who deliberately dismissed
 *  - Resetting the flag is a one-line localStorage.removeItem() — exposed
 *    via the global `window.lpRestartOnboarding` helper for re-trigger
 *
 * Anchors (DOM selectors must match elements in dashboard/page.tsx):
 *  - [data-tour="header-title"]   → Step 1: welcome
 *  - [data-tour="new-product"]    → Step 2: 新建产品 button
 *  - [data-tour="status-strip"]   → Step 3: system status pills
 *  - [data-tour="products-grid"]  → Step 4: products grid (or empty state)
 *
 * Why dashboard-only (not editor too):
 *  - Cross-page tours add complexity (resume after navigation) for
 *    little ROI — the moment the user clicks "新建产品" they're in a
 *    wizard with its own affordances
 *  - Editor has its own onboarding hooks (HelpTip on every important
 *    field — pattern ③) that scale better than a one-time popover
 */
import { useEffect } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { restartAllIntros } from './IntroCard';

const STORAGE_KEY = 'lp:onboarding-done';
const VERSION_KEY = 'lp:onboarding-version';
/** Bump this when the tour content changes meaningfully — users who
 *  saw v1 will see v2 again on next visit. Keeps the tour useful as
 *  the product evolves without constantly nagging stable users. */
const CURRENT_VERSION = '1';

type Props = {
  /** When false (e.g. dashboard is empty / no products yet), tweak the
   *  step 4 copy so it matches the actual UI ("here's where products
   *  WILL appear" rather than "here are your products"). */
  hasProducts: boolean;
};

function buildSteps(hasProducts: boolean): DriveStep[] {
  return [
    {
      element: '[data-tour="header-title"]',
      popover: {
        title: '👋 欢迎来到 LandingPage OS',
        description:
          '这是你的产品落地页工作台。30 秒带你过一遍核心动作——可以随时点 Skip 跳过。',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="new-product"]',
      popover: {
        title: '新建产品',
        description:
          '点这里启动向导：填 3 个问题，AI 自动生成 4 个语言版本的落地页（zh-CN / zh-TW / ja / en）。',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="status-strip"]',
      popover: {
        title: 'LLM 与存储健康状态',
        description:
          '生成 / 翻译用的 4 家模型 + 数据存储后端的实时配置情况。任一项变红，对应的功能会返回 503，记得去 Vercel 加 key。',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="products-grid"]',
      popover: {
        title: hasProducts ? '你的产品列表' : '产品会出现在这里',
        description: hasProducts
          ? '每张卡片下方有所有 locale 的 落地页。点卡片进编辑器；右上角 ⋮ 菜单管理 / 删除。'
          : '现在还是空的——点右上角"+ 新建产品"开始第一个。完成创建后这里会出现卡片。',
        side: 'top',
        align: 'start',
      },
    },
  ];
}

let driverInstance: Driver | null = null;

function startTour(hasProducts: boolean) {
  // Defensive cleanup if a previous run somehow left an instance behind.
  if (driverInstance) {
    try {
      driverInstance.destroy();
    } catch {}
    driverInstance = null;
  }
  driverInstance = driver({
    showProgress: true,
    progressText: '{{current}} / {{total}}',
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成 ✓',
    showButtons: ['next', 'previous', 'close'],
    steps: buildSteps(hasProducts),
    onDestroyed: () => {
      // Fires on both "完成" and "skip/close" — either way the user
      // doesn't want to see this again until manually re-triggered.
      try {
        localStorage.setItem(STORAGE_KEY, '1');
        localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
      } catch {
        // Private mode / disabled localStorage — fail silently. Worst
        // case: tour reappears next visit. Not catastrophic.
      }
      driverInstance = null;
    },
  });
  driverInstance.drive();
}

/** Tiny restart trigger — a separate Client Component so the dashboard
 *  Server Component can use it as a JSX child without making the whole
 *  page client-rendered. Reads the global helper that OnboardingTour
 *  registers on mount. Renders nothing if the helper isn't available
 *  yet (e.g. user clicks before the auto-tour effect ran), but in
 *  practice the auto-tour runs in the same tick so this is a non-issue. */
export function RestartTourButton() {
  return (
    <button
      type="button"
      onClick={() => {
        // Two systems coexist:
        //   1) driver.js multi-step popover for the dashboard layout
        //      (lpRestartOnboarding registered by OnboardingTour effect)
        //   2) IntroCard inline dismissible panels scattered across the
        //      app (LocalizationPreviewModal, etc.) — restartAllIntros
        //      clears their localStorage flags + dispatches an event
        //      that re-mounted cards listen for.
        // Trigger both — clicking "重新看引导" should restore everything.
        restartAllIntros();
        const fn = (window as any).lpRestartOnboarding;
        if (typeof fn === 'function') fn();
      }}
      className="text-xs text-ink-500 underline-offset-2 hover:text-brand-600 hover:underline"
      title="重新走一遍快速引导（包括所有页面的小白指引）"
    >
      🎯 重新看引导
    </button>
  );
}

export default function OnboardingTour({ hasProducts }: Props) {
  useEffect(() => {
    // Expose a global re-trigger so the dashboard header's "重新看引导"
    // link can call it without having to import this component's API.
    // Typed loosely to avoid declaring a global module augmentation just
    // for one helper.
    (window as any).lpRestartOnboarding = () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(VERSION_KEY);
      } catch {}
      startTour(hasProducts);
    };

    // Auto-start if first visit OR if version bumped since last completion.
    let done: string | null = null;
    let version: string | null = null;
    try {
      done = localStorage.getItem(STORAGE_KEY);
      version = localStorage.getItem(VERSION_KEY);
    } catch {
      // localStorage blocked — skip auto-start. Manual trigger still works
      // (it just won't persist completion).
      return;
    }
    if (done && version === CURRENT_VERSION) return;

    // Defer one tick — driver.js needs the anchored DOM elements to be
    // mounted. SSR'd dashboard markup is in place by the time we hit
    // useEffect, but a microtask defer lets any pending paint settle.
    const id = setTimeout(() => startTour(hasProducts), 200);
    return () => clearTimeout(id);
  }, [hasProducts]);

  // The tour is rendered into a driver.js-managed overlay — this React
  // component only owns the lifecycle. No JSX needed.
  return null;
}
