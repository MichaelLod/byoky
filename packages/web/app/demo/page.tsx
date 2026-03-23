import type { Metadata } from 'next';
import { DemoApp } from './DemoApp';
import './demo.css';

export const metadata: Metadata = {
  title: 'Demo',
  description:
    'Interactive demo of the Byoky SDK — see how apps connect to your AI API keys through the Byoky browser wallet.',
  alternates: {
    canonical: '/demo',
  },
};

export default function DemoPage() {
  return <DemoApp />;
}
