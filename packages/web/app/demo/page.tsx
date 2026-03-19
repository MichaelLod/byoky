import type { Metadata } from 'next';
import { DemoApp } from './DemoApp';
import './demo.css';

export const metadata: Metadata = {
  title: 'Demo — Byoky',
  description: 'Interactive demo of the Byoky SDK',
};

export default function DemoPage() {
  return <DemoApp />;
}
