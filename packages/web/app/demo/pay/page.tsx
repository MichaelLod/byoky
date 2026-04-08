import type { Metadata } from 'next';
import { PayDemo } from './PayDemo';

export const metadata: Metadata = {
  title: 'Pay with Byoky Demo',
  description: 'See how the "Pay with Byoky" button works — AI chat powered by user wallets.',
};

export default function PayDemoPage() {
  return <PayDemo />;
}
