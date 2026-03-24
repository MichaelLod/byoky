import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MiniApps — Byoky',
  description:
    'Browse and run AI-powered miniapps that use your own API keys. No accounts, no costs — just connect your Byoky wallet.',
};

export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
