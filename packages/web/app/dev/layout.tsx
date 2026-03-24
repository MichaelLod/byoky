import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developer Hub',
  description: 'Build AI apps on Byoky. Connect your wallet, pick a template, push to GitHub — all from the browser.',
  alternates: { canonical: '/dev' },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
