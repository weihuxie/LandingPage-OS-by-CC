import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LandingPage OS by CC',
  description: 'Hybrid-LLM multi-product landing page operating system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
