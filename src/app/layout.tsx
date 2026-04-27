import type { Metadata } from 'next';
import { fontVariables } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'LandingPage OS by CC',
  description: 'Hybrid-LLM multi-product landing page operating system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // fontVariables exposes --font-inter / --font-noto-sans-sc / etc on
    // <html> so PageRenderer's font-stack CSS variable can reference any
    // loaded face. App shell still uses Tailwind's OS-native font-sans.
    <html lang="en" suppressHydrationWarning className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
