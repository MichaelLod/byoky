import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MiniApp Creator — Byoky',
  description: 'Create AI-powered miniapps with your own API keys. Describe your idea, generate the code, and publish to the MiniApps marketplace.',
  alternates: { canonical: '/dev' },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
